import type { HttpResponse } from '../types/http.types';

/** JSON API: nothing may load, frame or execute from a response. */
const API_CSP = "default-src 'none'; frame-ancestors 'none'";
/** Swagger UI at /docs: bundled scripts are served from self; its HTML and React components use inline styles; the
 * stylesheet uses data: images; try-it-out fetches the same origin. No 'unsafe-eval' and no inline scripts. */
const DOCS_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const isDocs = (path: string) => path === '/docs' || path.startsWith('/docs/');

/** Express middleware registered first (before Swagger routes), so every response, including 404s and /docs, has it. */
export function securityHeaders(request: { path: string }, response: HttpResponse, next: () => void) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', isDocs(request.path) ? DOCS_CSP : API_CSP);
  next();
}
