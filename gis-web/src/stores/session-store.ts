import { createExternalStore } from './external-store.ts';
import type { SessionState } from '../lib/session.ts';

export function createSessionStore(now: () => number = Date.now) {
  const sink = createExternalStore<SessionState>({
    session: null,
    phase: 'checking',
    busy: null,
    generation: 0,
    logoutPending: false,
    error: '',
    errorSource: null,
    rateLimitedUntil: 0,
    expiryNotice: null,
  });
  return {
    ...sink,
    isCurrent(generation: number) {
      const state = sink.getSnapshot();
      return (
        generation === state.generation &&
        state.phase === 'ready' &&
        !state.busy &&
        (!state.session || Date.parse(state.session.expires_at) > now())
      );
    },
  };
}
export type SessionStore = ReturnType<typeof createSessionStore>;
