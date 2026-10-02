import { expect, it } from 'vitest';
import { COMMON_PASSWORDS } from './common-passwords';
import { checkNewPassword } from './password-rules';

const owner = { email: 'maria.santos@doh.gov.ph', name: 'Maria Clara Santos' };

it('accepts a long passphrase with spaces and any Unicode', () => {
  expect(checkNewPassword('tahimik na umaga sa Baguio', owner)).toBeNull();
  expect(checkNewPassword('ñandú cuarenta y dos 🌅', owner)).toBeNull();
});

it('counts 15 to 128 code points after NFKC, without trimming', () => {
  expect(checkNewPassword('violet harbor 9', owner)).toBeNull();
  expect(checkNewPassword('violet harbor', owner)?.rule).toBe('LENGTH');
  expect(checkNewPassword(`${'river stone '.repeat(10)}abcdefgh`, owner)).toBeNull();
  expect(checkNewPassword(`${'river stone '.repeat(10)}abcdefghi`, owner)?.rule).toBe('LENGTH');
  // Fourteen emoji are 28 UTF-16 units but 14 code points.
  expect(checkNewPassword('🌅'.repeat(14), owner)?.rule).toBe('LENGTH');
  // NFKC folds each "ﬃ" ligature into three letters, so five of them reach 15.
  expect(checkNewPassword('ﬃ'.repeat(4) + 'ab', owner)?.rule).toBe('LENGTH');
  // Spaces count; a password is never trimmed.
  expect(checkNewPassword('   violet harb ', owner)).toBeNull();
});

it('names the length rule with the count', () => {
  expect(checkNewPassword('violet harbor', owner)?.message).toBe(
    'Use 15 to 128 characters. This one has 13.',
  );
});

it('refuses the email local part, the name, or LingkodHR, in any case', () => {
  for (const password of [
    'my Maria.Santos password',
    'MARIA CLARA SANTOS forever',
    'mariaclarasantos forever',
    'santos family vacation',
    'my lingkod password 1',
    'LingkodHR is my password',
  ]) {
    expect(checkNewPassword(password, owner)?.rule).toBe('CONTEXT_WORD');
  }
  expect(checkNewPassword('quiet morning in the hills', owner)).toBeNull();
});

it('ignores context words too short to mean anything', () => {
  expect(
    checkNewPassword('a long walk by the bay', { email: 'jo@example.test', name: 'Jo Li' }),
  ).toBeNull();
});

it('refuses one repeated character or a plain ascending sequence', () => {
  expect(checkNewPassword('aaaaaaaaaaaaaaaa', owner)?.rule).toBe('PATTERN');
  expect(checkNewPassword('abcdefghijklmnop', owner)?.rule).toBe('PATTERN');
  expect(checkNewPassword('3456789:;<=>?@AB', owner)?.rule).toBe('PATTERN');
  expect(checkNewPassword('abcdefghijklmnoq', owner)).toBeNull();
});

it('refuses a common password regardless of case', () => {
  const common = COMMON_PASSWORDS.find((entry) => /[a-z]/.test(entry)) ?? '';

  expect(checkNewPassword(common, owner)?.rule).toBe('COMMON_PASSWORD');
  expect(checkNewPassword(common.toUpperCase(), owner)?.rule).toBe('COMMON_PASSWORD');
});

it('keeps the pinned list at 15 to 128 code points after NFKC', () => {
  expect(COMMON_PASSWORDS).toHaveLength(5406);
  for (const entry of COMMON_PASSWORDS) {
    expect(entry).toBe(entry.normalize('NFKC'));
    expect([...entry].length).toBeGreaterThanOrEqual(15);
    expect([...entry].length).toBeLessThanOrEqual(128);
  }
});
