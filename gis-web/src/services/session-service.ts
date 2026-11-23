import { createAuthService } from './auth-service.ts';
import type { createExternalStore } from '../stores/external-store.ts';
import {
  loginMessage,
  parseSession,
  validateLogin,
  type DemoRole,
  type Session,
  type SessionState,
} from '../lib/session.ts';

type Options = {
  fetcher?: typeof fetch;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (timer: unknown) => void;
};
type SessionSink = ReturnType<typeof createExternalStore<SessionState>>;
export function createSessionService(sink: SessionSink, options: Options = {}) {
  const request = createAuthService(options.fetcher);
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = options.cancel ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
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
    cancel(expiry);
    expiry = undefined;
    publish({
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
      clearIdentity({ error: '', busy: sink.getSnapshot().busy === 'logout' ? 'logout' : null });
    }
  }
  function accept(session: Session) {
    cancel(expiry);
    const previous = sink.getSnapshot().session;
    const same =
      previous?.user.id === session.user.id &&
      previous.user.email === session.user.email &&
      previous.user.role === session.user.role;
    publish({
      session: same && previous.expires_at === session.expires_at ? previous : session,
      phase: 'ready',
      busy: null,
      error: '',
      generation: sink.getSnapshot().generation + (same ? 0 : 1),
    });
    expiry = schedule(expire, Math.min(Date.parse(session.expires_at) - now(), 2147483647));
  }
  async function restore() {
    if (sink.getSnapshot().logoutPending || sink.getSnapshot().busy) return;
    const op = begin();
    if (sink.getSnapshot().phase === 'checking') publish({ error: '' });
    try {
      const response = await request('me', op.signal);
      if (!current(op.id)) return;
      if (response.status === 401) {
        clearIdentity({ error: '' });
        return;
      }
      if (!response.ok) throw new Error('Restore failed');
      const session = parseSession(await response.json(), now());
      if (current(op.id)) accept(session);
    } catch {
      if (current(op.id))
        publish({
          phase: 'ready',
          errorSource: 'restore',
          error: 'ตรวจสอบสถานะผู้ใช้ไม่สำเร็จ ลองใหม่ได้ ข้อมูลสาธารณะยังใช้งานได้',
        });
    }
  }
  async function login(email: string, password: string) {
    const invalid = validateLogin(email, password);
    if (invalid.email || invalid.password) return false;
    return submitLogin('login', { email: email.trim(), password });
  }
  async function demoRoles(): Promise<DemoRole[] | null> {
    try {
      const response = await request('demo-login', new AbortController().signal, { method: 'GET' });
      if (response.status !== 200) return null;
      const value: unknown = await response.json();
      const roles = (value as { roles?: unknown } | null)?.roles;
      if (!Array.isArray(roles) || !roles.every((role) => ['viewer', 'editor', 'admin'].includes(role))) return null;
      return roles;
    } catch {
      return null;
    }
  }
  async function demoLogin(role: DemoRole) {
    return submitLogin('demo-login', { role }, (status) =>
      [400, 401, 404].includes(status) ? 'เข้าสู่ระบบด้วยบัญชีสาธิตไม่สำเร็จ ลองใหม่หรือกรอกเอง' : loginMessage(status),
    );
  }
  async function submitLogin(
    path: string,
    body: { email: string; password: string } | { role: DemoRole },
    message: (status: number) => string = loginMessage,
  ) {
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
        publish({ busy: null, errorSource: 'login', error: message(response.status) });
        return false;
      }
      const session = parseSession(await response.json(), now());
      if (!current(op.id)) return false;
      accept(session);
      return true;
    } catch {
      if (current(op.id)) publish({ busy: null, errorSource: 'login', error: message(503) });
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
  return {
    restore,
    login,
    demoRoles,
    demoLogin,
    logout,
    resume: async () => {
      expire();
      if (sink.getSnapshot().logoutPending) {
        if (retry === undefined) await logout();
      } else await restore();
    },
    unauthorized: () => {
      if (sink.getSnapshot().busy) return;
      controller?.abort();
      operation++;
      clearIdentity({ busy: null, error: '' });
    },
    dispose: () => {
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
