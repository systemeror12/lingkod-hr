import type { Prisma } from '@prisma/client';

/** Internal read contract. Call only after checking the invitation and setting its Agency context. */
export async function readAgencySealKey(
  transaction: Prisma.TransactionClient,
  agencyId: string,
): Promise<string | null> {
  const seal = await transaction.agencySeal.findUnique({
    where: { agencyId },
    select: { objectKey: true },
  });
  return seal?.objectKey ?? null;
}
