import { createHmac } from 'node:crypto';

/**
 * Keyed email hash (HMAC-SHA-256 with `BLIND_INDEX_KEY`) for counting sign-in attempts and
 * recording Security Events without storing the raw email.
 */
export function hashEmail(email: string, blindIndexKey: string): Buffer {
  return createHmac('sha256', blindIndexKey).update(email.trim().toLowerCase()).digest();
}
