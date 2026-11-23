'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createSessionStore } from '../../stores/session-store.ts';
import { createSessionService } from '../../services/session-service.ts';
import { SessionContext } from '../../stores/session-context';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => {
    const sink = createSessionStore();
    return {
      getSnapshot: sink.getSnapshot,
      subscribe: sink.subscribe,
      isCurrent: sink.isCurrent,
      ...createSessionService(sink),
    };
  });
  useEffect(() => {
    void store.restore();
    const resume = () => {
      if (document.visibilityState === 'visible') void store.resume();
    };
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
      store.dispose();
    };
  }, [store]);
  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>;
}
