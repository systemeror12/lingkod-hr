import type { Prisma } from '@prisma/client';

/**
 * Internal read contract. Call only after checking the invitation and setting its Agency context.
 * Returns the private object keys of the seal and of the building photo while it is shown.
 */
export async function readAgencyBrandKeys(
  transaction: Prisma.TransactionClient,
  agencyId: string,
): Promise<{ sealKey: string | null; photoKey: string | null }> {
  const [seal, photo] = await Promise.all([
    transaction.agencySeal.findUnique({ where: { agencyId }, select: { objectKey: true } }),
    transaction.agencyBuildingPhoto.findUnique({
      where: { agencyId },
      select: { objectKey: true, shown: true },
    }),
  ]);
  return {
    sealKey: seal?.objectKey ?? null,
    photoKey: photo?.shown ? photo.objectKey : null,
  };
}
