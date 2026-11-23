'use client';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { ApiError } from '../../services/http-client';
import { useSession } from '../../stores/session-context';
import type { ResourceStore } from '../../stores/resource-store';
export function useResource<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  retry: number,
  resource: ResourceStore<T>,
) {
  const { store, generation, phase, session, busy } = useSession();
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  const readyKey = phase === 'ready' && !busy ? key : null;
  const identity = resource.identity(readyKey, retry, generation);
  useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  useEffect(
    () =>
      resource.load(identity, (signal) => loadRef.current(signal), {
        authenticated: Boolean(session),
        isCurrent: store.isCurrent,
        unauthorized: store.unauthorized,
        isUnauthorized: (error) => error instanceof ApiError && error.status === 401,
      }),
    [identity, resource, store, session],
  );
  return resource.read(identity, Boolean(key), store.isCurrent);
}
