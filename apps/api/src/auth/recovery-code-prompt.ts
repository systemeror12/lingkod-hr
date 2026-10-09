import type { Prisma } from '@prisma/client';

/*
 * The remaining-codes prompt a Password Reset owes when it spends a Recovery Code (#367). The reset
 * signs no one in, so the prompt waits on the User's password row for the next sign-in.
 */

/** Owes the prompt, in the transaction of the reset that spent the code. */
export async function oweRecoveryCodePrompt(
  transaction: Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<void> {
  await transaction.userPassword.update({
    where: { userId },
    data: { recoveryCodePromptOwedAt: now },
  });
}

/**
 * Clears an owed prompt, in the transaction that opens a session, and answers the Recovery Codes
 * left for it to show; null when none was owed. Of two sign-ins, only the first to commit gets it.
 */
export async function takeRecoveryCodePrompt(
  transaction: Prisma.TransactionClient,
  userId: string,
): Promise<number | null> {
  const owed = await transaction.userPassword.updateMany({
    where: { userId, recoveryCodePromptOwedAt: { not: null } },
    data: { recoveryCodePromptOwedAt: null },
  });
  if (owed.count !== 1) return null;
  return transaction.userRecoveryCode.count({ where: { userId } });
}
