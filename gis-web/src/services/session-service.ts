import { createAuthService } from './auth-service.ts';
import { markSessionChanged, onSessionInvalid } from './http-client.ts';
import type { createExternalStore } from '../stores/external-store.ts';
import { loginMessage, parseSession, validateLogin, type Session, type SessionState } from '../lib/session.ts';

type Options = {
  fetcher?: typeof fetch;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (timer: unknown) => void;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
};
/** Only the safe identity (id, email, role, expiry) is remembered; the JWT stays in the HttpOnly cookie. */
export const SESSION_STORAGE_KEY = 'gis-session';
function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
type SessionSink = ReturnType<typeof createExternalStore<SessionState>>;
export function createSessionService(sink: SessionSink, options: Options = {}) {
  const request = createAuthService(options.fetcher);
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = options.cancel ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const remember = (session: Session) => {
    try {
      storage?.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Storage can be full or blocked; the identity then lasts until reload.
    }
  };
  /** Removes the key only when it is unreadable or still holds `mine`; another tab's newer login is left alone. */
  const forget = (mine: Session | null) => {
    try {
      const raw = storage?.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;
      let stored: Session | null = null;
      try {
        stored = parseSession(JSON.parse(raw), now());
      } catch {
        stored = null;
      }
      if (!stored || (mine && stored.user.id === mine.user.id && stored.expires_at === mine.expires_at))
        storage?.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Same as above.
    }
  };
  let settled = false;
  let stopListening: (() => void) | undefined;
  // Idempotent so React StrictMode's effect re-run (dispose, then restore again) re-attaches the listener.
  const listen = () => {
    stopListening ??= onSessionInvalid(() => {
      if (sink.getSnapshot().session) unauthorized();
    });
  };
  let controller: AbortController | undefined;
  let expiry: unknown, retry: unknown;
  let logoutDeadline: number | undefined;
  let retryDelay = 3000;
  let operation = 0;
  const publish = (patch: Partial<SessionState>) => {
    sink.setState((state) => ({ ...state, ...(patch.error === '' ? { errorSource: null } : {}), ...patch }));
  };
  function begin() {
    controller?.abort();
    controller = new AbortController();
    return { id: ++operation, signal: controller.signal };
  }
  const current = (id: number) => operation === id;
  function clearIdentity(patch: Partial<SessionState> = {}) {
    forget(sink.getSnapshot().session);
    cancel(expiry);
    expiry = undefined;
    publish({
      expiryNotice: null,
      session: null,
      phase: 'ready',
      generation: sink.getSnapshot().generation + (sink.getSnapshot().session ? 1 : 0),
      ...patch,
    });
  }
  function expire() {
    const session = sink.getSnapshot().session;
    if (session && Date.parse(session.expires_at) <= now()) {
      // Keep an in-flight revocation alive even when the local deadline passes.
      if (sink.getSnapshot().busy !== 'logout') {
        controller?.abort();
        operation++;
      }
      const loggingOut = sink.getSnapshot().busy === 'logout';
      clearIdentity({ error: '', busy: loggingOut ? 'logout' : null, expiryNotice: loggingOut ? null : 'expired' });
    }
  }
  function accept(session: Session) {
    cancel(expiry);
    const previous = sink.getSnapshot().session;
    const same =
      previous?.user.id === session.user.id &&
      previous.user.email === session.user.email &&
      previous.user.role === session.user.role;
    const remaining = Date.parse(session.expires_at) - now();
    // The first restore on load is not a change; later identities (login, another tab) make older markers stale.
    if (!same && settled) markSessionChanged();
    remember(session);
    publish({
      session: same && previous.expires_at === session.expires_at ? previous : session,
      phase: 'ready',
      busy: null,
      error: '',
      generation: sink.getSnapshot().generation + (same ? 0 : 1),
      expiryNotice: null,
    });
    expiry = schedule(expire, Math.min(remaining, 2147483647));
  }
  /** No request: the server checks the session on every API call; a dead one comes back as 401 or X-Auth-Session. */
  async function restore() {
    listen();
    if (sink.getSnapshot().logoutPending || sink.getSnapshot().busy) return;
    let session: Session | null = null;
    try {
      const raw = storage?.getItem(SESSION_STORAGE_KEY);
      if (raw) session = parseSession(JSON.parse(raw), now());
    } catch {
      session = null;
    }
    if (session) accept(session);
    else clearIdentity({ error: '' });
    settled = true;
  }
  async function login(email: string, password: string) {
    const invalid = validateLogin(email, password);
    if (invalid.email || invalid.password) return false;
    listen();
    settled = true;
    return submitLogin('login', { email: email.trim(), password });
  }
  async function submitLogin(path: string, body: { email: string; password: string }) {
    if (sink.getSnapshot().busy || sink.getSnapshot().logoutPending) return false;
    const op = begin();
    publish({ busy: 'login', error: '' });
    try {
      const response = await request(path, op.signal, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
        body: JSON.stringify(body),
      });
      if (!current(op.id)) return false;
      if (!response.ok) {
        publish({ busy: null, errorSource: 'login', error: loginMessage(response.status) });
        return false;
      }
      const session = parseSession(await response.json(), now());
      if (!current(op.id)) return false;
      accept(session);
      return true;
    } catch {
      if (current(op.id)) publish({ busy: null, errorSource: 'login', error: loginMessage(503) });
      return false;
    }
  }
  async function logout() {
    if (sink.getSnapshot().busy) return;
    if (sink.getSnapshot().logoutPending && now() < Math.min(sink.getSnapshot().rateLimitedUntil, logoutDeadline!)) {
      // Timers can fire early or observe a clock adjustment; keep the remaining wait scheduled.
      if (retry === undefined)
        retry = schedule(
          () => {
            retry = undefined;
            void logout();
          },
          Math.min(sink.getSnapshot().rateLimitedUntil, logoutDeadline!) - now(),
        );
      return;
    }
    cancel(retry);
    retry = undefined;
    if (!sink.getSnapshot().logoutPending) {
      const session = sink.getSnapshot().session;
      logoutDeadline = session ? Date.parse(session.expires_at) : now();
      retryDelay = 3000;
      publish({ rateLimitedUntil: 0 });
    } else if (now() >= logoutDeadline!) {
      publish({ logoutPending: false, rateLimitedUntil: 0, error: '' });
      return;
    }
    let wait = retryDelay;
    const op = begin();
    publish({ busy: 'logout', rateLimitedUntil: 0, error: '' });
    try {
      const response = await request('logout', op.signal, { method: 'POST', headers: { 'X-CSRF-Protection': '1' } });
      if (!current(op.id)) return;
      if (response.status === 403) {
        publish({
          busy: null,
          errorSource: 'logout',
          error: 'ออกจากระบบไม่สำเร็จ คำขอไม่ผ่าน CSRF กรุณาตรวจสอบการตั้งค่า Origin',
        });
        if (sink.getSnapshot().logoutPending)
          retry = schedule(
            () => {
              retry = undefined;
              void logout();
            },
            Math.max(0, logoutDeadline! - now()),
          );
        return;
      }
      if (response.status === 429) {
        const after = response.headers.get('Retry-After');
        const seconds = after === null ? NaN : Number(after);
        const delay = Number.isFinite(seconds) ? seconds * 1000 : after ? Date.parse(after) - now() : 0;
        wait = Math.max(60000, Number.isFinite(delay) ? delay : 0);
        publish({ rateLimitedUntil: now() + wait });
      }
      if (response.status !== 204) throw new Error('Revocation unconfirmed');
      clearIdentity({ busy: null, logoutPending: false, rateLimitedUntil: 0, error: '' });
    } catch {
      if (!current(op.id)) return;
      clearIdentity({
        busy: null,
        logoutPending: true,
        errorSource: 'logout',
        error: 'ซ่อนข้อมูลส่วนตัวแล้ว แต่เซิร์ฟเวอร์ยังไม่ยืนยันการออกจากระบบ กำลังลองใหม่',
      });
      if (now() >= logoutDeadline!) {
        publish({ logoutPending: false, rateLimitedUntil: 0, error: '' });
        return;
      }
      retry = schedule(
        () => {
          retry = undefined;
          void logout();
        },
        Math.min(wait, logoutDeadline! - now()),
      );
      retryDelay = Math.min(retryDelay * 2, 30000);
    }
  }
  function unauthorized() {
    if (sink.getSnapshot().busy) return;
    const known = Boolean(sink.getSnapshot().session);
    controller?.abort();
    operation++;
    clearIdentity({ busy: null, error: '', expiryNotice: known ? 'expired' : null });
  }
  return {
    restore,
    login,
    logout,
    unauthorized,
    dismissNotice: () => publish({ expiryNotice: null }),
    dispose: () => {
      stopListening?.();
      stopListening = undefined;
      controller?.abort();
      operation++;
      cancel(expiry);
      cancel(retry);
      retry = undefined;
    },
  };
}
export type SessionService = ReturnType<typeof createSessionService>;

export { validateLogin, publicData, loginMessage } from '../lib/session.ts';
