import { randomInt } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const CODE_LENGTH = 10;
const SET_SIZE = 10;

/** A new set of 10 Recovery Codes, each 10 random base32 characters shown as `xxxxx-xxxxx`. */
export function generateRecoveryCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < SET_SIZE) {
    let code = '';
    for (let index = 0; index < CODE_LENGTH; index += 1) {
      code += BASE32_ALPHABET[randomInt(BASE32_ALPHABET.length)];
    }
    codes.add(`${code.slice(0, 5)}-${code.slice(5)}`.toLowerCase());
  }
  return [...codes];
}

/**
 * The canonical form of a Recovery Code for hashing and matching: case, hyphens, and spaces are
 * ignored. Null when the input cannot be a Recovery Code.
 */
export function normalizeRecoveryCode(input: string): string | null {
  const normalized = input.replace(/[\s-]/g, '').toUpperCase();
  return new RegExp(`^[A-Z2-7]{${CODE_LENGTH}}$`).test(normalized) ? normalized : null;
}
