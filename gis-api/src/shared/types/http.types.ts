/** Minimal Express request/response surface used by controllers and middleware (avoids a dependency on @types/express). */
export interface HttpRequest {
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string };
  is(type: string): string | false | null;
  auth?: import('../../auth/entities/user.entity').AuthenticatedContext | null;
}
export interface HttpResponse { setHeader(name: string, value: string): unknown }
