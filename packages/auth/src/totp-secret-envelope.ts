import {
  decryptProtectedValue,
  encryptProtectedValue,
  ProtectedValueError,
  type ProtectedValueKey,
} from '@lingkod-hr/config';

export interface TotpSecretOwner {
  userId: string;
  factorId: string;
}

function metadataFor(owner: TotpSecretOwner): string {
  return JSON.stringify({ purpose: 'totp', userId: owner.userId, factorId: owner.factorId });
}

/** Encrypts a TOTP secret with `DATA_ENCRYPTION_KEY`, bound to its User and factor. */
export function sealTotpSecret(
  secret: string,
  key: ProtectedValueKey,
  owner: TotpSecretOwner,
): Buffer {
  return encryptProtectedValue(secret, key, { metadata: metadataFor(owner) }).envelope;
}

/**
 * Decrypts a TOTP secret and checks that it was sealed for this User and factor. Any failure is a
 * server error, never a wrong code.
 */
export function openTotpSecret(
  envelope: Buffer,
  key: ProtectedValueKey,
  owner: TotpSecretOwner,
): string {
  const opened = decryptProtectedValue(envelope, key);
  if (opened.metadata.toString('utf8') !== metadataFor(owner)) {
    throw new ProtectedValueError('The TOTP secret belongs to another factor.');
  }
  return opened.plaintext;
}
