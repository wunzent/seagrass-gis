export const ACCESS_COOKIE = 'gis_access';
export function parseCookies(raw: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of (raw ?? '').split(';')) {
    const index = part.indexOf('=');
    const name = part.slice(0, index).trim();
    if (index > 0 && name) result[name] = part.slice(index + 1).trim();
  }
  return result;
}

export function accessCookie(token: string, maxAgeSeconds: number, secure: boolean) {
  return `${ACCESS_COOKIE}=${token}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function clearedAccessCookie(secure: boolean) {
  return `${ACCESS_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
