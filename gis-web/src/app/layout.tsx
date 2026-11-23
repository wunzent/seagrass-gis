import type { ReactNode } from 'react';
import { plex } from '../assets/fonts/fonts';
import { SessionProvider } from '../features/auth/session-provider';
import '../assets/styles/tailwind.css';
import '../assets/styles/maplibre.css';

export const metadata = {
  title: 'ติดตามแหล่งหญ้าทะเล | Seagrass',
  description: 'แผนที่และข้อมูลแหล่งหญ้าทะเลฝั่งอันดามัน',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" className={plex.variable}>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
