'use client';

import Link from 'next/link';
import { Button } from '../../components/ui/button';

/** Full-page states for Next route conventions (app/loading, app/error, app/not-found). */
export function RouteLoading() {
  return (
    <main className="route-state">
      <div className="route-state-box" role="status">
        <span className="route-spinner" aria-hidden="true" />
        <p>กำลังโหลดหน้า…</p>
      </div>
    </main>
  );
}

// The error detail is never shown: it can carry server internals. Next logs it in the console instead.
export function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="route-state">
      <div className="route-state-box error-box" role="alert">
        <h1>เกิดข้อผิดพลาดในการแสดงหน้า</h1>
        <p>ลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้กลับไปหน้าแผนที่</p>
        <div className="route-state-actions">
          <Button onClick={() => reset()}>ลองใหม่</Button>
          <Button variant="link" nativeButton={false} render={<Link href="/" />}>
            กลับหน้าแผนที่
          </Button>
        </div>
      </div>
    </main>
  );
}

export function RouteNotFound() {
  return (
    <main className="route-state">
      <div className="route-state-box">
        <h1>ไม่พบหน้าที่ต้องการ</h1>
        <p>ลิงก์อาจผิดหรือหน้านี้ไม่มีอยู่แล้ว</p>
        <Button variant="link" nativeButton={false} render={<Link href="/" />}>
          กลับหน้าแผนที่
        </Button>
      </div>
    </main>
  );
}
