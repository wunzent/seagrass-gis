export const MAX_BODY_BYTES = 128 * 1024;

export function upstreamUrl(requestUrl: string, internalUrl: string): URL {
  const incoming = new URL(requestUrl);
  const base = new URL(internalUrl);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  )
    throw new Error('Invalid API origin');
  if (!incoming.pathname.startsWith('/api/')) throw new Error('Invalid proxy path');
  const path = incoming.pathname.slice(4);
  if (path.startsWith('//') || /%2f|%5c|%2e|\\/i.test(path) || path.includes('..'))
    throw new Error('Invalid proxy path');
  // Only the documented API resources are exposed through this application.
  if (
    !/^\/(?:sites(?:\.geojson|\/[^/]+(?:\/surveys)?)?|auth\/(?:login|demo-login|me|logout)|provinces\.geojson|surveys\.geojson)$/.test(
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

class PayloadTooLarge extends Error {}

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
    for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append('set-cookie', cookie);
    if (
      request.method === 'POST' &&
      ['/auth/login', '/auth/demo-login'].includes(target.pathname) &&
      upstream.ok &&
      /^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(contentType ?? '')
    ) {
      const payload = await upstream.json();
      delete payload.access_token;
      delete payload.token_type;
      return new Response(JSON.stringify(payload), { status: upstream.status, headers: responseHeaders });
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return errorResponse(503, 'SERVICE_UNAVAILABLE');
  }
}
