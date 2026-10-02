import { expect, it } from 'vitest';
import { verifyPassword } from './password-hash';
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from './recovery-codes';

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

it('hashes a Recovery Code in its normalized form with the password hash', async () => {
  const hash = await hashRecoveryCode('abcde-fg234');

  expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  await expect(verifyPassword(hash, 'ABCDEFG234')).resolves.toBe(true);
});
