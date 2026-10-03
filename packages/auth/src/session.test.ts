import { expect, it } from 'vitest';
import {
  createSessionToken,
  hashSessionToken,
  isSessionActive,
  isWithinReauthenticationWindow,
  sessionExpiry,
} from './session';

it('creates a token that is only represented by its deterministic hash', () => {
  const token = createSessionToken();

  expect(token).toHaveLength(43);
  expect(hashSessionToken(token)).toEqual(hashSessionToken(token));
  expect(hashSessionToken(token).toString('hex')).not.toContain(token);
});

it('enforces the idle and absolute session limits', () => {
  const createdAt = new Date('2026-08-11T00:00:00.000Z');
  const session = {
    createdAt,
    lastSeenAt: new Date('2026-08-11T00:20:00.000Z'),
    expiresAt: sessionExpiry(createdAt),
    revokedAt: null,
  };

  expect(isSessionActive(session, new Date('2026-08-11T00:49:59.999Z'))).toBe(true);
  expect(isSessionActive(session, new Date('2026-08-11T00:50:00.000Z'))).toBe(false);
  expect(isSessionActive(session, new Date('2026-08-11T08:00:00.000Z'))).toBe(false);
});

it('opens the Reauthentication Window for 5 minutes after the User proved who they are', () => {
  const authTime = new Date('2026-08-11T00:00:00.000Z');

  expect(isWithinReauthenticationWindow(authTime, new Date('2026-08-11T00:04:59.999Z'))).toBe(true);
  expect(isWithinReauthenticationWindow(authTime, new Date('2026-08-11T00:05:00.001Z'))).toBe(
    false,
  );
  expect(isWithinReauthenticationWindow(null, authTime)).toBe(false);
});
