export type Role = 'viewer' | 'editor' | 'admin';
export interface SessionUser { id: string; email: string; role: Role }
/** Resolved by auth_middleware from the gis_access cookie and an active DB session; null for anonymous requests. */
export interface AuthenticatedContext { user: SessionUser; sid: string; expiresAt: Date }
/** `users` row as read by UsersRepository. */
export interface UserRecord { id: string; email: string; role: Role; password_hash: string }
