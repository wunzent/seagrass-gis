export const MAX_BODY_BYTES = 128 * 1024;

function upstreamOrigin(internalUrl: string) {
  const base = new URL(internalUrl);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  )
    throw new Error('Invalid upstream origin');
  return base;
}

export function upstreamUrl(requestUrl: string, internalUrl: string): URL {
  const incoming = new URL(requestUrl);
  const base = upstreamOrigin(internalUrl);
  if (!incoming.pathname.startsWith('/api/')) throw new Error('Invalid proxy path');
  const path = incoming.pathname.slice(4);
  if (path.startsWith('//') || /%2f|%5c|%2e|\\/i.test(path) || path.includes('..'))
    throw new Error('Invalid proxy path');
  // Only the documented API resources are exposed through this application.
  if (
    !/^\/(?:sites(?:\.geojson|\/[^/]+(?:\/surveys)?)?|auth\/(?:login|me|logout)|provinces\.geojson|surveys\.geojson)$/.test(
      path,
    )
  )
    throw new Error('Invalid proxy path');
  const target = new URL(path, base);
  target.search = incoming.search;
  return target;
}

const errorResponse = (status: number, code: string) =>
  Response.json(
    { error: { code, message: 'ไม่สามารถโหลดข้อมูลได้', details: {} } },
    { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } },
  );

export async function proxyTile(request: Request, internalUrl: string, fetcher: typeof fetch = fetch) {
  const incoming = new URL(request.url);
  const tile = /^\/tiles\/reference_parcels\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/.exec(incoming.pathname);
  if (!tile || incoming.search) return new Response(null, { status: 404 });
  const [z, x, y] = tile.slice(1).map(Number);
  if (z > 22 || x >= 2 ** z || y >= 2 ** z) return new Response(null, { status: 404 });
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } });

  try {
    const target = new URL(`/reference_parcels/${z}/${x}/${y}`, upstreamOrigin(internalUrl));
    const upstream = await fetcher(target, {
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
    });
    if (upstream.status === 200 || upstream.status === 204) {
      return new Response(upstream.status === 200 ? upstream.body : null, {
        status: upstream.status,
        headers: {
          'content-type': 'application/vnd.mapbox-vector-tile',
          'cache-control': 'public, max-age=300',
          'x-content-type-options': 'nosniff',
        },
      });
    }
    await upstream.body?.cancel();
    if (upstream.status === 404) return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
    return errorResponse(502, 'BAD_GATEWAY');
  } catch {
    return errorResponse(503, 'SERVICE_UNAVAILABLE');
  }
}

class PayloadTooLarge extends Error {}

/** ISO time from the JWT `exp` claim (seconds). Not a verification: the token came straight from the API. */
function tokenExpiry(token: unknown): string | undefined {
  if (typeof token !== 'string') return undefined;
  try {
    const claims: unknown = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
    const exp = (claims as { exp?: unknown } | null)?.exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? new Date(exp * 1000).toISOString() : undefined;
  } catch {
    return undefined;
  }
}

async function readLimitedBody(request: Request, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (['GET', 'HEAD'].includes(request.method)) return undefined;
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) throw new PayloadTooLarge();
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const aborted = new Promise<never>((_, reject) => {
    const abort = () => reject(new Error('Body read aborted'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  aborted.catch(() => undefined);
  for (;;) {
    const { done, value } = await Promise.race([reader.read(), aborted]).catch(async (error) => {
      await reader.cancel().catch(() => undefined);
      throw error;
    });
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new PayloadTooLarge();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function proxyRequest(request: Request, internalUrl: string, fetcher: typeof fetch = fetch) {
  let target: URL;
  try {
    target = upstreamUrl(request.url, internalUrl);
  } catch {
    return errorResponse(400, 'VALIDATION_ERROR');
  }
  let body: Uint8Array<ArrayBuffer> | undefined;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15000)]);
  try {
    body = await readLimitedBody(request, signal);
  } catch (error) {
    if (error instanceof PayloadTooLarge) return errorResponse(413, 'PAYLOAD_TOO_LARGE');
    return errorResponse(503, 'SERVICE_UNAVAILABLE');
  }
  try {
    const headers = new Headers();
    for (const name of ['accept', 'content-type', 'cookie', 'origin', 'x-csrf-protection', 'sec-fetch-site']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const upstream = await fetcher(target, {
      method: request.method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'manual',
      signal,
    });
    if (upstream.status >= 300 && upstream.status < 400) return errorResponse(502, 'BAD_GATEWAY');
    const responseHeaders = new Headers({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    const contentType = upstream.headers.get('content-type');
    if (contentType) responseHeaders.set('content-type', contentType);
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter) responseHeaders.set('retry-after', retryAfter);
    // The API marks responses to a dead session so the browser can forget the identity it remembered at login.
    // A request without the cookie (expired, or cleared by a logout elsewhere on localhost) is marked the same way,
    // because the API cannot tell it from an anonymous visitor.
    const hasSessionCookie = /(?:^|;\s*)gis_access=[^;\s]/.test(request.headers.get('cookie') ?? '');
    if (upstream.headers.get('x-auth-session') === 'invalid' || (request.method === 'GET' && !hasSessionCookie))
      responseHeaders.set('x-auth-session', 'invalid');
    for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append('set-cookie', cookie);
    if (
      request.method === 'POST' &&
      target.pathname === '/auth/login' &&
      upstream.ok &&
      /^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(contentType ?? '')
    ) {
      const payload = await upstream.json();
      // The API returns { access_token, user }. The browser never sees the JWT; it gets only the user and the expiry
      // from the token's claim. A token without a readable exp is an API fault: answer 502 and drop its cookie.
      const expiresAt = tokenExpiry(payload.access_token);
      if (!expiresAt) return errorResponse(502, 'BAD_GATEWAY');
      return new Response(JSON.stringify({ user: payload.user, expires_at: expiresAt }), {
        status: upstream.status,
        headers: responseHeaders,
      });
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return errorResponse(503, 'SERVICE_UNAVAILABLE');
  }
}
