import { createExternalStore } from './external-store.ts';
import type { SessionState } from '../lib/session.ts';

export function createSessionStore(now: () => number = Date.now) {
  const initial: SessionState = {
    session: null,
    phase: 'checking',
    busy: null,
    generation: 0,
    logoutPending: false,
    error: '',
    errorSource: null,
    rateLimitedUntil: 0,
    expiryNotice: null,
  };
  const sink = createExternalStore<SessionState>(initial);
  return {
    ...sink,
    /** What the server rendered. Hydration must use it: the identity restored from storage can land before a
     * lazily hydrated subtree (the map is a dynamic import), and rendering it there mismatches the server HTML. */
    getServerSnapshot: () => initial,
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
