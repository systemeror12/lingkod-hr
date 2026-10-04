import { timingSafeEqual } from 'node:crypto';
import { HOTP, Secret, TOTP } from 'otpauth';

/** RFC 6238 parameters from the sign-in flow: SHA-1, six digits, 30-second step, ±1 step. */
const PERIOD_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1;

/** Creates a 160-bit TOTP secret as base32. */
export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

/** The `otpauth://` URI an authenticator app scans to add the secret for `account`. */
export function totpUri(secret: string, account: string): string {
  return new TOTP({
    issuer: 'LingkodHR',
    label: account,
    secret: Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: DIGITS,
    period: PERIOD_SECONDS,
  }).toString();
}

/** The time step that contains `at`. */
export function totpStep(at: Date = new Date()): number {
  return TOTP.counter({ period: PERIOD_SECONDS, timestamp: at.getTime() });
}

/** The code a correct authenticator shows at `at`. */
export function totpCode(secret: string, at: Date = new Date()): string {
  return TOTP.generate({
    secret: Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: DIGITS,
    period: PERIOD_SECONDS,
    timestamp: at.getTime(),
  });
}

/**
 * Returns the step a code belongs to when it matches within ±1 step of `at` and is newer than
 * `lastAcceptedStep`, otherwise null. The caller must save the returned step with a conditional
 * update so a step is accepted at most once.
 */
export function acceptTotpCode(
  secret: string,
  code: string,
  lastAcceptedStep: number,
  at: Date = new Date(),
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = Secret.fromBase32(secret);
  const current = totpStep(at);
  for (let step = current - WINDOW; step <= current + WINDOW; step += 1) {
    if (step <= lastAcceptedStep) continue;
    const expected = HOTP.generate({
      secret: key,
      algorithm: 'SHA1',
      digits: DIGITS,
      counter: step,
    });
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return step;
  }
  return null;
}
