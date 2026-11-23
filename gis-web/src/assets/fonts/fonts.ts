import { IBM_Plex_Sans_Thai } from 'next/font/google';

// Self-hosted at build time by next/font, so the CSP font-src 'self' still holds. Tabular figures suit survey data.
export const plex = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-plex',
});
