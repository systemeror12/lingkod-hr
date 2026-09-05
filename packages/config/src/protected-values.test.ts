import { expect, it } from 'vitest';
import {
  ProtectedValueError,
  decryptProtectedValue,
  encryptProtectedValue,
  maskProtectedValue,
  normalizeProtectedValue,
  parseProtectedValueKey,
  sanitizeProtectedValueMetadata,
} from './protected-values';

const hexKey = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const base64Key = Buffer.from(hexKey, 'hex').toString('base64');

it('parses canonical 64-hex and base64 keys', () => {
  expect(parseProtectedValueKey(hexKey)).toEqual(Buffer.from(hexKey, 'hex'));
  expect(parseProtectedValueKey(base64Key)).toEqual(Buffer.from(hexKey, 'hex'));
});

it('normalizes and masks protected values', () => {
  expect(normalizeProtectedValue('  TIN-123  ')).toBe('TIN-123');
  expect(maskProtectedValue('TIN-123')).toBe('***-123');
  expect(maskProtectedValue('AB', { visibleSuffix: 0, maskCharacter: '#' })).toBe('##');
  expect(() => normalizeProtectedValue('TIN-123\u0000')).toThrow(ProtectedValueError);
});

it('seals and opens protected values with authenticated metadata', () => {
  const key = parseProtectedValueKey(hexKey);
  const sealed = encryptProtectedValue('  TIN-1234  ', key, {
    metadata: 'employee:123|type:tin',
  });

  expect(sealed.maskedValue).toBe('****1234');
  expect(sealed.envelope.subarray(0, 3).toString('ascii')).toBe('PV1');

  const opened = decryptProtectedValue(sealed.envelope, key);
  expect(opened.plaintext).toBe('TIN-1234');
  expect(opened.metadata.toString('utf8')).toBe('employee:123|type:tin');

  const tamperedMetadata = Buffer.from(sealed.envelope);
  tamperedMetadata[14 + 12 + 16] ^= 0x01;
  expect(() => decryptProtectedValue(tamperedMetadata, key)).toThrow(ProtectedValueError);
});

it('fails safely for tampered envelopes and bad keys', () => {
  const key = parseProtectedValueKey(hexKey);
  const sealed = encryptProtectedValue('secret value', key, {
    metadata: 'employee:123|type:tin',
  });

  const tampered = Buffer.from(sealed.envelope);
  tampered[tampered.length - 1] ^= 0x01;

  expect(() => decryptProtectedValue(tampered, key)).toThrow(ProtectedValueError);
  expect(() => decryptProtectedValue(sealed.envelope, Buffer.alloc(31))).toThrow(
    /Invalid protected value key\./,
  );
  expect(() => parseProtectedValueKey('not-a-key')).toThrow(ProtectedValueError);
});

it('removes protected fields from nested metadata', () => {
  expect(
    sanitizeProtectedValueMetadata({
      maskedValue: '******6789',
      accountNumber: '0123456789',
      after: { encryptedAccountNumber: 'ciphertext', reason: 'Correction' },
      nested: [{ plaintext: 'secret', safe: true }],
    }),
  ).toEqual({
    maskedValue: '******6789',
    after: { reason: 'Correction' },
    nested: [{ safe: true }],
  });
});
