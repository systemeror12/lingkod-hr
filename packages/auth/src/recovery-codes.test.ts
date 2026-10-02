import { expect, it } from 'vitest';
import { generateRecoveryCodes, normalizeRecoveryCode } from './recovery-codes';

it('generates a set of 10 distinct codes shown as xxxxx-xxxxx in base32', () => {
  const codes = generateRecoveryCodes();

  expect(codes).toHaveLength(10);
  expect(new Set(codes).size).toBe(10);
  for (const code of codes) expect(code).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
});

it('matches a code without regard to case, hyphens, or spaces', () => {
  expect(normalizeRecoveryCode('abcde-fg234')).toBe('ABCDEFG234');
  expect(normalizeRecoveryCode(' ABCDE FG234 ')).toBe('ABCDEFG234');
  expect(normalizeRecoveryCode('AbCdEfG234')).toBe('ABCDEFG234');
});

it('rejects input that cannot be a Recovery Code', () => {
  expect(normalizeRecoveryCode('abcde-fg23')).toBeNull();
  expect(normalizeRecoveryCode('abcde-fg2345')).toBeNull();
  expect(normalizeRecoveryCode('abcde-fg018')).toBeNull();
  expect(normalizeRecoveryCode('')).toBeNull();
});
