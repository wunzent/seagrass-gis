import type { ReactNode } from 'react';
import { SessionControls } from '../auth/session-controls';

export function TopNav({
  view,
  switchView,
  sessionControls,
}: {
  view: 'map' | 'table';
  switchView: (view: 'map' | 'table') => void;
  sessionControls?: ReactNode;
}) {
  return (
    <header className="topbar">
      <h1>ติดตามแหล่งหญ้าทะเล</h1>
      <nav className="topbar-nav" aria-label="เมนูหลัก">
        <button
          type="button"
          className="nav-item"
          aria-current={view === 'map' ? 'page' : undefined}
          onClick={() => switchView('map')}
        >
          แผนที่
        </button>
        <button
          type="button"
          className="nav-item"
          aria-current={view === 'table' ? 'page' : undefined}
          onClick={() => switchView('table')}
        >
          ตารางแหล่งหญ้าทะเล
        </button>
      </nav>
      {sessionControls ?? <SessionControls />}
    </header>
  );
}
