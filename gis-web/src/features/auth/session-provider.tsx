'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createSessionStore } from '../../stores/session-store.ts';
import { createSessionService, SESSION_STORAGE_KEY } from '../../services/session-service.ts';
import { SessionContext } from '../../stores/session-context';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => {
    const sink = createSessionStore();
    return {
      getSnapshot: sink.getSnapshot,
      getServerSnapshot: sink.getServerSnapshot,
      subscribe: sink.subscribe,
      isCurrent: sink.isCurrent,
      ...createSessionService(sink),
    };
  });
  useEffect(() => {
    // No /auth/me: the identity remembered at login is shown, and the API checks the session on every call
    // (401 or X-Auth-Session: invalid drops it). Another tab logging in or out updates this one through storage.
    void store.restore();
    const sync = (event: StorageEvent) => {
      if (event.key === null || event.key === SESSION_STORAGE_KEY) void store.restore();
    };
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('storage', sync);
      store.dispose();
    };
  }, [store]);
  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>;
}
