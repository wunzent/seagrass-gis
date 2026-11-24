export class ApiError extends Error {
  status: number;
  constructor(status: number) {
    super(
      status === 404
        ? 'ไม่พบแหล่งนี้แล้ว กรุณาเลือกรายการใหม่'
        : status === 400
          ? 'ตัวกรองหรือขอบเขตไม่ถูกต้อง กรุณาตรวจสอบ'
          : status === 403
            ? 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้'
            : status === 401
              ? 'เซสชันหมดอายุ กรุณาลองใหม่เพื่อดูข้อมูลสาธารณะ'
              : 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่',
    );
    this.status = status;
  }
}
const sessionInvalidListeners = new Set<() => void>();
let sessionEpoch = 0;
/** Called when a new identity is accepted; a marker on a request sent before that belongs to the old state. */
export function markSessionChanged() {
  sessionEpoch++;
}
/** Called when an API response says the cookie's session is gone (`X-Auth-Session: invalid`). Returns an unsubscribe. */
export function onSessionInvalid(listener: () => void) {
  sessionInvalidListeners.add(listener);
  return () => {
    sessionInvalidListeners.delete(listener);
  };
}
export async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const epoch = sessionEpoch;
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal });
  if (response.headers.get('x-auth-session') === 'invalid' && epoch === sessionEpoch)
    for (const listener of [...sessionInvalidListeners]) listener();
  if (!response.ok) throw new ApiError(response.status);
  return response.json();
}

export function requestAuth(fetcher: typeof fetch, path: string, signal: AbortSignal, init: RequestInit = {}) {
  return fetcher(`/api/auth/${path}`, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
  });
}
