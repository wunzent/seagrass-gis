import { proxyTile } from '../../../lib/proxy';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return proxyTile(request, process.env.TILES_INTERNAL_URL ?? '');
}
