import { argon2Sync } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  hashPassword,
  passwordNeedsRehash,
  verifyPassword,
  verifyPasswordAgainstDummy,
} from './password-hash';

function phcWithParameters(password: string, memory: number, passes: number): string {
  const salt = Buffer.alloc(16, 9);
  const tag = argon2Sync('argon2id', {
    message: password,
    nonce: salt,
    memory,
    passes,
    parallelism: 1,
    tagLength: 32,
  });
  const encode = (value: Buffer) => value.toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=${memory},t=${passes},p=1$${encode(salt)}$${encode(tag)}`;
}

it('hashes a password as an Argon2id PHC string that verifies only the same password', async () => {
  const hash = await hashPassword('correct horse battery staple');

  expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
  await expect(verifyPassword(hash, 'correct horse battery staple')).resolves.toBe(true);
  await expect(verifyPassword(hash, 'correct horse battery stapl')).resolves.toBe(false);
  expect(await hashPassword('correct horse battery staple')).not.toBe(hash);
});

it('treats NFKC-equivalent passwords as the same password', async () => {
  const hash = await hashPassword('ｐａｓｓｐｈｒａｓｅ with full-width letters');

  await expect(verifyPassword(hash, 'passphrase with full-width letters')).resolves.toBe(true);
});

it('verifies older parameters and reports that they need a rehash', async () => {
  const legacy = phcWithParameters('an older stored passphrase', 19456, 2);

  await expect(verifyPassword(legacy, 'an older stored passphrase')).resolves.toBe(true);
  expect(passwordNeedsRehash(legacy)).toBe(true);
  expect(passwordNeedsRehash(await hashPassword('a current passphrase'))).toBe(false);
});

it('refuses malformed hashes without throwing', async () => {
  await expect(verifyPassword('$argon2i$v=19$m=65536,t=3,p=1$abc$def', 'x')).resolves.toBe(false);
  await expect(verifyPassword('not-a-hash', 'x')).resolves.toBe(false);
});

it('runs a full verification against a dummy hash and never matches', async () => {
  await expect(verifyPasswordAgainstDummy('any passphrase at all')).resolves.toBe(false);
});
