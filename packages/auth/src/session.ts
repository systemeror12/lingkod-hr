import { createHash, randomBytes } from 'node:crypto';

export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000;

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
