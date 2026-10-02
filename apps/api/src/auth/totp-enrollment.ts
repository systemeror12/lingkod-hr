import type { Prisma } from '@prisma/client';
import {
  acceptTotpCode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  openTotpSecret,
  sealTotpSecret,
  type TotpSecretOwner,
  totpUri,
} from '@lingkod-hr/auth';
import type { ProtectedValueKey } from '@lingkod-hr/config';
import { prismaBytes } from '../invitations/invitation-utils';

/*
 * TOTP enrollment held on a pending authentication row, whatever its purpose: sign-in, Invitation
 * Activation, or re-enrollment after a Factor Reset. The secret is sealed for the User and the
 * pending row's id, which becomes the factor id, so nothing is written to the User's factor or
 * Recovery Codes until the caller's final transaction.
 */

export const ENROLL_SCAN_STAGE = 'ENROLL_SCAN';
export const ENROLL_CODES_STAGE = 'ENROLL_CODES';

/** A new secret for `owner`, sealed, and the `otpauth://` URI that shows it to `account`. */
export function beginTotpEnrollment(
  key: ProtectedValueKey,
  owner: TotpSecretOwner,
  account: string,
): { envelope: Buffer; otpauthUri: string } {
  const secret = generateTotpSecret();
  return { envelope: sealTotpSecret(secret, key, owner), otpauthUri: totpUri(secret, account) };
}

/**
 * Checks the code that confirms a pending secret. When it matches, returns its step and a new set
 * of Recovery Codes with their hashes; the codes are shown once and only the hashes are kept.
 */
export async function confirmTotpEnrollment(
  key: ProtectedValueKey,
  owner: TotpSecretOwner,
  envelope: Buffer,
  code: string,
  at: Date = new Date(),
): Promise<{ step: number; recoveryCodes: string[]; recoveryCodeHashes: string[] } | null> {
  const step = acceptTotpCode(openTotpSecret(envelope, key, owner), code, 0, at);
  if (step === null) return null;
  const recoveryCodes = generateRecoveryCodes();
  return {
    step,
    recoveryCodes,
    recoveryCodeHashes: await Promise.all(recoveryCodes.map(hashRecoveryCode)),
  };
}

/**
 * Writes the factor and Recovery Codes of a confirmed enrollment. The transaction must be in the
 * User's context; the caller deletes the pending row in the same transaction.
 */
export async function writeTotpEnrollment(
  transaction: Prisma.TransactionClient,
  pending: {
    id: string;
    enrollmentSecretEnvelope: Uint8Array | null;
    enrollmentAcceptedStep: bigint | null;
    recoveryCodeHashes: string[];
  },
  userId: string,
): Promise<void> {
  if (!pending.enrollmentSecretEnvelope || pending.enrollmentAcceptedStep === null) {
    throw new Error('The enrollment was not confirmed.');
  }
  await transaction.userTotpFactor.create({
    data: {
      id: pending.id,
      userId,
      secretEnvelope: prismaBytes(Buffer.from(pending.enrollmentSecretEnvelope)),
      lastAcceptedStep: pending.enrollmentAcceptedStep,
    },
  });
  await transaction.userRecoveryCode.createMany({
    data: pending.recoveryCodeHashes.map((codeHash) => ({ userId, codeHash })),
  });
}
