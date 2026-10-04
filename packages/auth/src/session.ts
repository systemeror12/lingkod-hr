import { createHash, randomBytes } from 'node:crypto';

export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
/** How long after proving who they are a User may take a sensitive action without proving it again. */
export const REAUTHENTICATION_WINDOW_MS = 5 * 60 * 1000;

export interface SessionActivity {
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export function sessionExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS);
}

export function isSessionActive(session: SessionActivity, now = new Date()): boolean {
  return (
    session.revokedAt === null &&
    now.getTime() < session.expiresAt.getTime() &&
    now.getTime() - session.lastSeenAt.getTime() < SESSION_IDLE_TIMEOUT_MS
  );
}

/** Whether a session's `authTime` is recent enough for a sensitive action. */
export function isWithinReauthenticationWindow(authTime: Date | null, now = new Date()): boolean {
  return authTime !== null && now.getTime() - authTime.getTime() <= REAUTHENTICATION_WINDOW_MS;
}
