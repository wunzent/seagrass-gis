import type { ReactNode } from 'react';
import { IBM_Plex_Sans_Thai } from 'next/font/google';
import { SessionProvider } from '../components/session-provider';
import './tailwind.css';
import 'maplibre-gl/dist/maplibre-gl.css';

// Self-hosted at build time by next/font, so the CSP font-src 'self' still holds. Tabular figures suit survey data.
const plex = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-plex',
});

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
