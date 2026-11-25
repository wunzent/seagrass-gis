'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CircleAlertIcon, InfoIcon } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert';
import { AccountOnly } from '../../guards/session-guard';
import { useSession } from '../../stores/session-context';

export function SessionControls({ view }: { view?: 'checking' | 'account' | 'guest' } = {}) {
  const { phase, busy, logoutPending, store } = useSession();
  return (
    <div className="session-controls" aria-label="สถานะผู้ใช้">
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
    </div>
  );
}

export function SessionNotices() {
  const router = useRouter();
  const { busy, logoutPending, error, errorSource, rateLimitedUntil, expiryNotice, store } = useSession();
  const logoutError = errorSource === 'logout' && error;
  const waiting = logoutPending && rateLimitedUntil > 0;

  if (!expiryNotice && !logoutError) return null;

  return (
    <div className="session-notices">
      {expiryNotice && (
        <Alert role="status">
          <InfoIcon aria-hidden="true" />
          <AlertTitle>เซสชันหมดอายุ</AlertTitle>
          <AlertDescription className="grid justify-items-start gap-2">
            <span>ข้อมูลที่ต้องเข้าสู่ระบบถูกซ่อน กรุณาเข้าสู่ระบบใหม่</span>
            <Button
              size="sm"
              onClick={() => {
                store.dismissNotice();
                router.push('/login');
              }}
            >
              ตกลง
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {logoutError && (
        <Alert variant="destructive" role="alert">
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>ออกจากระบบไม่สำเร็จ</AlertTitle>
          <AlertDescription className="grid justify-items-start gap-2">
            <span>{logoutError}</span>
            <Button size="sm" variant="outline" disabled={Boolean(busy) || waiting} onClick={() => void store.logout()}>
              {waiting ? 'กรุณารอสักครู่' : 'ลองออกจากระบบอีกครั้ง'}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
