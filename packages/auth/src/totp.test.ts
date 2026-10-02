import { expect, it } from 'vitest';
import { acceptTotpCode, generateTotpSecret, totpCode, totpStep } from './totp';

// RFC 6238 Appendix B: ASCII "12345678901234567890", SHA-1, truncated to six digits.
const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const at = (seconds: number) => new Date(seconds * 1000);

it('generates the RFC 6238 SHA-1 codes', () => {
  expect(totpCode(rfcSecret, at(59))).toBe('287082');
  expect(totpCode(rfcSecret, at(1111111109))).toBe('081804');
  expect(totpCode(rfcSecret, at(1234567890))).toBe('005924');
});

it('accepts a code from the current step or one step either side and returns that step', () => {
  const now = at(1234567890);
  const step = totpStep(now);

  expect(step).toBe(41152263);
  expect(acceptTotpCode(rfcSecret, '005924', 0, now)).toBe(step);
  expect(acceptTotpCode(rfcSecret, totpCode(rfcSecret, at(1234567860)), 0, now)).toBe(step - 1);
  expect(acceptTotpCode(rfcSecret, totpCode(rfcSecret, at(1234567920)), 0, now)).toBe(step + 1);
  expect(acceptTotpCode(rfcSecret, totpCode(rfcSecret, at(1234567830)), 0, now)).toBeNull();
  expect(acceptTotpCode(rfcSecret, '000000', 0, now)).toBeNull();
});

it('refuses a step that was already accepted and older steps inside the window', () => {
  const now = at(1234567890);
  const step = totpStep(now);

  expect(acceptTotpCode(rfcSecret, '005924', step, now)).toBeNull();
  expect(acceptTotpCode(rfcSecret, totpCode(rfcSecret, at(1234567860)), step, now)).toBeNull();
  expect(acceptTotpCode(rfcSecret, totpCode(rfcSecret, at(1234567920)), step, now)).toBe(step + 1);
});

it('refuses input that is not six digits', () => {
  const now = at(1234567890);

  expect(acceptTotpCode(rfcSecret, '05924', 0, now)).toBeNull();
  expect(acceptTotpCode(rfcSecret, '0059245', 0, now)).toBeNull();
  expect(acceptTotpCode(rfcSecret, '00592a', 0, now)).toBeNull();
});

it('generates a 160-bit base32 secret', () => {
  const secret = generateTotpSecret();

  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  expect(generateTotpSecret()).not.toBe(secret);
});
