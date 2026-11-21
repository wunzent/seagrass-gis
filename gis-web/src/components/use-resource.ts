'use client';

import { useEffect, useMemo, useState } from 'react';
import { latestRequest } from '../lib/map-state';
import { ApiError, fetchJson } from '../lib/sites';
import { useSession } from './session-provider';
import { publicData } from '../lib/session';

export function useResource<T>(url: string | null, retry: number) {
  const { store, generation, phase, session, busy } = useSession();
  const readyUrl = phase === 'ready' && !busy ? url : null;
  const requests = useMemo(latestRequest, []);
  const identity = useMemo(() => ({ url: readyUrl, retry, generation }), [readyUrl, retry, generation]);
  const [result, setResult] = useState<{ identity: typeof identity; data?: T; error?: Error }>();
  useEffect(() => {
    if (!identity.url) { requests.cancel(); return; }
    const request = requests.start();
    fetchJson<T>(identity.url, request.signal).then(
      data => { if (request.current() && store.isCurrent(identity.generation)) setResult({ identity, data: session ? data : publicData(data) }); },
      error => { if (request.current() && store.isCurrent(identity.generation)) {
        if (session && error instanceof ApiError && error.status === 401) { store.unauthorized(); return; }
        setResult({ identity, error: error instanceof Error ? error : new Error('โหลดข้อมูลไม่สำเร็จ') });
      } },
    );
    return () => requests.cancel();
  }, [identity, requests, store, session]);
  const current = readyUrl && result?.identity === identity && store.isCurrent(generation) ? result : undefined;
  return { data: current?.data, error: current?.error, loading: Boolean(url && !current) };
}
