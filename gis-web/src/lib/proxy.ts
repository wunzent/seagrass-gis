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
    { status, headers: { 'cache-control': 'no-store' } },
  );

export async function proxyRequest(request: Request, internalUrl: string, fetcher: typeof fetch = fetch) {
  let target: URL;
  try {
    target = upstreamUrl(request.url, internalUrl);
  } catch {
    return errorResponse(400, 'VALIDATION_ERROR');
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
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
    });
    if (upstream.status >= 300 && upstream.status < 400) return errorResponse(502, 'BAD_GATEWAY');
    const responseHeaders = new Headers({ 'cache-control': 'no-store' });
    const contentType = upstream.headers.get('content-type');
    if (contentType) responseHeaders.set('content-type', contentType);
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter) responseHeaders.set('retry-after', retryAfter);
    for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append('set-cookie', cookie);
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return errorResponse(503, 'SERVICE_UNAVAILABLE');
  }
}
