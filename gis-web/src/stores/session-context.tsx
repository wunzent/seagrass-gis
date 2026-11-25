'use client';

import { createContext, useContext, useSyncExternalStore } from 'react';
import type { SessionStore } from './session-store.ts';

type SessionFacade = Pick<SessionStore, 'getSnapshot' | 'getServerSnapshot' | 'subscribe' | 'isCurrent'> & {
  restore(): Promise<void>;
  login(email: string, password: string): Promise<boolean>;
  logout(): Promise<void>;
  unauthorized(): void;
  dismissNotice(): void;
  dispose(): void;
};
export const SessionContext = createContext<SessionFacade | null>(null);
export function useSession() {
  const store = useContext(SessionContext);
  if (!store) throw new Error('SessionProvider required');
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return { ...state, store };
}
