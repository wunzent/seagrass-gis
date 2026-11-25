import type { ReactNode, RefObject } from 'react';
import { TabsList, TabsTrigger } from '../../components/ui/tabs';
import { SessionControls } from '../auth/session-controls';

export function TopNav({
  view,
  sessionControls,
  navigationRef,
}: {
  view: 'map' | 'table';
  sessionControls?: ReactNode;
  navigationRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <header className="topbar">
      <h1>ติดตามแหล่งหญ้าทะเล</h1>
      <nav ref={navigationRef} className="topbar-nav" aria-label="เมนูหลัก">
        <TabsList aria-label="มุมมอง">
          <TabsTrigger value="map" data-view="map" aria-current={view === 'map' ? 'page' : undefined}>
            แผนที่
          </TabsTrigger>
          <TabsTrigger value="table" data-view="table" aria-current={view === 'table' ? 'page' : undefined}>
            ตารางแหล่งหญ้าทะเล
          </TabsTrigger>
        </TabsList>
      </nav>
      {sessionControls ?? <SessionControls />}
    </header>
  );
}
