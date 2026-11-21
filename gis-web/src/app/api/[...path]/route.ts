import { proxyRequest } from '../../../lib/proxy';

export const dynamic = 'force-dynamic';
function proxy(request: Request) {
  return proxyRequest(request, process.env.API_INTERNAL_URL ?? 'http://localhost:3002');
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
