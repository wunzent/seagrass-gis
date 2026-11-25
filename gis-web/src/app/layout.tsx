import type { ReactNode } from 'react';
import { plex } from '../assets/fonts/fonts';
import { SessionProvider } from '../features/auth/session-provider';
import { SessionNotices } from '../features/auth/session-controls';
import '../assets/styles/globals.css';
import '../assets/styles/maplibre.css';

export const metadata = {
  title: 'ติดตามแหล่งหญ้าทะเล | Seagrass',
  description: 'แผนที่และข้อมูลแหล่งหญ้าทะเลฝั่งอันดามัน',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" className={plex.variable}>
      <body>
        <SessionProvider>
          {children}
          <SessionNotices />
        </SessionProvider>
      </body>
    </html>
  );
}
