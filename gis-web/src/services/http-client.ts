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
export async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal });
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
