import type { ReactNode } from 'react';
import { SessionProvider } from '../components/session-provider';
import './tailwind.css';
import 'maplibre-gl/dist/maplibre-gl.css';

export const metadata = { title: 'ติดตามแหล่งหญ้าทะเล | Seagrass', description: 'แผนที่และข้อมูลแหล่งหญ้าทะเลฝั่งอันดามัน' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="th"><body><SessionProvider>{children}</SessionProvider></body></html>;
}
