'use client';
import type { DemoRole } from '../lib/session';
import type { ReactNode } from 'react';
import { useSession } from '../stores/session-context';
export function GuestOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const { session } = useSession();
  return session ? fallback : children;
}
export function AccountOnly({
  children,
  fallback = null,
}: {
  children: (session: NonNullable<ReturnType<typeof useSession>['session']>) => ReactNode;
  fallback?: ReactNode;
}) {
  const { session } = useSession();
  return session ? children(session) : fallback;
}

// Route pages provide feature slots; no navigation or additional authorization is introduced.
export function SessionRoute({
  checking,
  account,
  guest,
}: {
  checking: ReactNode;
  account: ReactNode;
  guest: ReactNode;
}) {
  const { phase, session } = useSession();
  return phase === 'checking' ? checking : session ? account : guest;
}
export function RequireRole({
  roles,
  children,
  fallback = null,
}: {
  roles: readonly DemoRole[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { session } = useSession();
  return session && roles.includes(session.user.role) ? children : fallback;
}
