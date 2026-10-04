import { expect, it } from 'vitest';
import { openTotpSecret, sealTotpSecret } from './totp-secret-envelope';

const key = Buffer.alloc(32, 3);
const owner = {
  userId: '00000000-0000-4000-8000-000000000001',
  factorId: '00000000-0000-4000-8000-000000000002',
};

it('seals a TOTP secret in a PV1 envelope that opens for the same User and factor', () => {
  const envelope = sealTotpSecret('JBSWY3DPEHPK3PXP', key, owner);

  expect(envelope.subarray(0, 3).toString('ascii')).toBe('PV1');
  expect(envelope.includes(Buffer.from('JBSWY3DPEHPK3PXP'))).toBe(false);
  expect(openTotpSecret(envelope, key, owner)).toBe('JBSWY3DPEHPK3PXP');
});

it('refuses an envelope copied onto another User or factor', () => {
  const envelope = sealTotpSecret('JBSWY3DPEHPK3PXP', key, owner);

  expect(() =>
    openTotpSecret(envelope, key, { ...owner, userId: '00000000-0000-4000-8000-000000000009' }),
  ).toThrow();
  expect(() =>
    openTotpSecret(envelope, key, { ...owner, factorId: '00000000-0000-4000-8000-000000000009' }),
  ).toThrow();
});

it('refuses an envelope sealed with another key', () => {
  const envelope = sealTotpSecret('JBSWY3DPEHPK3PXP', key, owner);

  expect(() => openTotpSecret(envelope, Buffer.alloc(32, 4), owner)).toThrow();
});
