'use client';

import { createContext, useContext, useSyncExternalStore } from 'react';
import type { DemoRole } from '../lib/session.ts';
import type { SessionStore } from './session-store.ts';

type SessionFacade = Pick<SessionStore, 'getSnapshot' | 'subscribe' | 'isCurrent'> & {
  restore(): Promise<void>;
  resume(): Promise<void>;
  login(email: string, password: string): Promise<boolean>;
  demoRoles(): Promise<DemoRole[] | null>;
  demoLogin(role: DemoRole): Promise<boolean>;
  logout(): Promise<void>;
  unauthorized(): void;
  dispose(): void;
};
export const SessionContext = createContext<SessionFacade | null>(null);
export function useSession() {
  const store = useContext(SessionContext);
  if (!store) throw new Error('SessionProvider required');
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...state, store };
}
