'use client';

import Link from 'next/link';
import { Button } from '../../components/ui/button';
import { AccountOnly } from '../../guards/session-guard';
import { useSession } from '../../stores/session-context';

export function SessionControls({ view }: { view?: 'checking' | 'account' | 'guest' } = {}) {
  const { phase, busy, logoutPending, error, errorSource, rateLimitedUntil, expiryNotice, store } = useSession();
  const waiting = logoutPending && rateLimitedUntil > 0;
  return (
    <div className="session-controls" aria-label="สถานะผู้ใช้">
      {expiryNotice && (
        <div className="expiry-notice" role={expiryNotice === 'expired' ? 'alert' : 'status'}>
          <p>
            {expiryNotice === 'expired'
              ? 'เซสชันหมดอายุแล้ว ข้อมูลที่ต้องเข้าสู่ระบบถูกซ่อน กรุณาเข้าสู่ระบบใหม่'
              : 'เซสชันจะหมดอายุในอีก 1 นาที บันทึกงานที่ค้างไว้ แล้วเข้าสู่ระบบใหม่เมื่อหมดอายุ'}
          </p>
          {expiryNotice === 'expired' && (
            <Link className="session-link" href="/login">
              เข้าสู่ระบบใหม่
            </Link>
          )}
          <Button variant="outline" onClick={() => store.dismissNotice()}>
            ปิด
          </Button>
        </div>
      )}
      {(view ? view === 'checking' : phase === 'checking') ? (
        <p role="status">กำลังตรวจสอบผู้ใช้…</p>
      ) : (
        <AccountOnly
          fallback={
            !logoutPending ? (
              <Link className="session-link" href="/login">
                เข้าสู่ระบบ
              </Link>
            ) : null
          }
        >
          {(session) => (
            <>
              <p className="session-user">
                {session.user.email}
                <br />
                <span>สิทธิ์: {session.user.role}</span>
              </p>
              <Button variant="outline" disabled={Boolean(busy)} onClick={() => void store.logout()}>
                {busy === 'logout' ? 'กำลังออกจากระบบ…' : 'ออกจากระบบ'}
              </Button>
            </>
          )}
        </AccountOnly>
      )}
      {/* Login errors belong to the login form's summary; only logout problems are shown and retried here. */}
      {error && errorSource === 'logout' && (
        <div className="session-notice" role="alert">
          <p>{error}</p>
          <Button variant="outline" disabled={Boolean(busy) || waiting} onClick={() => void store.logout()}>
            {waiting ? 'กรุณารอสักครู่' : 'ลองออกจากระบบอีกครั้ง'}
          </Button>
        </div>
      )}
    </div>
  );
}
