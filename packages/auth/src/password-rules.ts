import { COMMON_PASSWORDS } from './common-passwords';

// The #363 password rules, checked only when a password is set: activation, reset, and change.
// They are fixed product-wide, so an existing password is never re-checked against them.

const MIN_LENGTH = 15;
const MAX_LENGTH = 128;
/** Shorter context words, such as an email `jo@…`, would refuse ordinary passwords. */
const MIN_CONTEXT_WORD_LENGTH = 3;
const PRODUCT_WORDS = ['lingkod', 'lingkodhr'];

let commonPasswords: Set<string> | undefined;

export type PasswordRule = 'LENGTH' | 'CONTEXT_WORD' | 'PATTERN' | 'COMMON_PASSWORD';

export interface PasswordRuleFailure {
  rule: PasswordRule;
  /** Names the rule that failed, for the User. */
  message: string;
}

/** Who the password is for. Their email local part and name may not appear in it. */
export interface PasswordOwner {
  email: string;
  name: string;
}

function fold(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

function contextWords({ email, name }: PasswordOwner): string[] {
  const localPart = email.slice(0, Math.max(email.lastIndexOf('@'), 0)) || email;
  const nameParts = fold(name).split(/\s+/);
  return [fold(localPart), nameParts.join(''), ...nameParts, ...PRODUCT_WORDS].filter(
    (word) => [...word].length >= MIN_CONTEXT_WORD_LENGTH,
  );
}

function isRepeatOrAscendingRun(codePoints: number[]): boolean {
  const repeated = codePoints.every((codePoint) => codePoint === codePoints[0]);
  const ascending = codePoints.every(
    (codePoint, index) => index === 0 || codePoint === (codePoints[index - 1] ?? 0) + 1,
  );
  return repeated || ascending;
}

/**
 * Checks a new password against the #363 rules after NFKC normalization, without trimming.
 * Returns the first rule it fails, or null when it may be set.
 */
export function checkNewPassword(
  password: string,
  owner: PasswordOwner,
): PasswordRuleFailure | null {
  const normalized = password.normalize('NFKC');
  const codePoints = [...normalized].map((character) => character.codePointAt(0) ?? 0);
  if (codePoints.length < MIN_LENGTH || codePoints.length > MAX_LENGTH) {
    return {
      rule: 'LENGTH',
      message: `Use ${MIN_LENGTH} to ${MAX_LENGTH} characters. This one has ${codePoints.length}.`,
    };
  }
  const folded = normalized.toLowerCase();
  const compact = folded.replace(/\s+/g, '');
  if (contextWords(owner).some((word) => folded.includes(word) || compact.includes(word))) {
    return {
      rule: 'CONTEXT_WORD',
      message: 'Don’t use your name, your email, or LingkodHR in your password.',
    };
  }
  if (isRepeatOrAscendingRun(codePoints)) {
    return {
      rule: 'PATTERN',
      message: 'Don’t use one repeated character or a plain run such as abcdef or 123456.',
    };
  }
  commonPasswords ??= new Set(COMMON_PASSWORDS.map((entry) => entry.toLowerCase()));
  if (commonPasswords.has(folded)) {
    return {
      rule: 'COMMON_PASSWORD',
      message: 'This password is on a list of common passwords. Choose another.',
    };
  }
  return null;
}
