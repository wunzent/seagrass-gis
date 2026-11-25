export type Session = { user: { id: string; email: string; role: 'viewer' | 'editor' | 'admin' }; expires_at: string };
export type DemoRole = Session['user']['role'];
export type SessionState = {
  session: Session | null;
  phase: 'checking' | 'ready';
  busy: 'login' | 'logout' | null;
  generation: number;
  logoutPending: boolean;
  error: string;
  errorSource: 'logout' | 'login' | null;
  rateLimitedUntil: number;
  /** Notice after the session ends (timer or a 401 on a data request). */
  expiryNotice: 'expired' | null;
};

// While logout is unconfirmed the cookie may still be valid, so strip creator fields from public data.
export function publicData<T>(value: T): T {
  if (Array.isArray(value)) return value.map(publicData) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'created_by' && key !== 'updated_by')
        .map(([key, item]) => [key, publicData(item)]),
    ) as T;
  return value;
}

export function validateLogin(email: string, password: string) {
  return {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? '' : 'กรุณากรอกอีเมลให้ถูกต้อง',
    password: password ? '' : 'กรุณากรอกรหัสผ่าน',
  };
}
export function parseSession(value: unknown, now: number): Session {
  const input = value as Partial<Session> | null;
  const user = input?.user;
  if (
    !user ||
    typeof user.id !== 'string' ||
    typeof user.email !== 'string' ||
    !['viewer', 'editor', 'admin'].includes(user.role) ||
    typeof input?.expires_at !== 'string' ||
    !Number.isFinite(Date.parse(input.expires_at)) ||
    Date.parse(input.expires_at) <= now
  )
    throw new Error('Invalid session');
  return { user: { id: user.id, email: user.email, role: user.role }, expires_at: input.expires_at };
}
export function loginMessage(status: number) {
  return status === 401
    ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
    : status === 429
      ? 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่'
      : status === 403
        ? 'คำขอไม่ผ่านการตรวจสอบความปลอดภัย กรุณาตรวจสอบการตั้งค่า Origin'
        : status === 400
          ? 'กรุณาตรวจสอบอีเมลและรหัสผ่าน'
          : 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่';
}
