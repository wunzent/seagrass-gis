'use client';

import Link from 'next/link';
import { Button } from './ui/button';
import { useSession } from './session-provider';

export function SessionControls() {
  const { session, phase, busy, logoutPending, error, errorSource, rateLimitedUntil, store } = useSession();
  const waiting = logoutPending && rateLimitedUntil > 0;
  return <div className="session-controls" aria-label="สถานะผู้ใช้">
    {phase === 'checking' ? <p role="status">กำลังตรวจสอบผู้ใช้…</p> : session ? <><p className="session-user">{session.user.email}<br /><span>สิทธิ์: {session.user.role}</span></p><Button variant="outline" disabled={Boolean(busy)} onClick={() => void store.logout()}>{busy === 'logout' ? 'กำลังออกจากระบบ…' : 'ออกจากระบบ'}</Button></> : !logoutPending ? <Link className="session-link" href="/login">เข้าสู่ระบบ</Link> : null}
    {error && <div className="session-notice" role="alert"><p>{error}</p><Button variant="outline" disabled={Boolean(busy) || waiting} onClick={() => void (errorSource === 'logout' ? store.logout() : store.restore())}>{waiting ? 'กรุณารอสักครู่' : errorSource === 'logout' ? 'ลองออกจากระบบอีกครั้ง' : 'ตรวจสอบผู้ใช้อีกครั้ง'}</Button></div>}
  </div>;
}
