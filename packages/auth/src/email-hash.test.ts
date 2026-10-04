import { expect, it } from 'vitest';
import { hashEmail } from './email-hash';

const key = 'test-blind-index-key-0123456789abcdef';

it('hashes the normalized email with HMAC-SHA-256 under the blind-index key', () => {
  expect(hashEmail('marisol.santos@example.test', key).toString('hex')).toBe(
    'bb376a90a7b11528ec895c54fb929d410d16f03a5c8ec588c5eb10bfc2b373f2',
  );
});

it('gives the same hash regardless of case and surrounding spaces', () => {
  expect(hashEmail('  Marisol.Santos@Example.TEST ', key)).toEqual(
    hashEmail('marisol.santos@example.test', key),
  );
});

it('gives a different hash under another key', () => {
  expect(hashEmail('marisol.santos@example.test', `${key}-other`)).not.toEqual(
    hashEmail('marisol.santos@example.test', key),
  );
});
