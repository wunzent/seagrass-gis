import { requestAuth } from './http-client.ts';

export function createAuthService(fetcher: typeof fetch = fetch) {
  return (path: string, signal: AbortSignal, init: RequestInit = {}) => requestAuth(fetcher, path, signal, init);
}
