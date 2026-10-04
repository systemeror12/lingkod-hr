import type { Prisma } from '@prisma/client';

/**
 * Resolve the Employees who report directly to one Supervisor Employee on a
 * date (ADR 0005). The Supervisor heads every active Organization Unit whose
 * head Plantilla Position they hold. Their direct reports are the Employees
 * serving in those units and the heads of their immediate child units, one
 * level only. The Supervisor is never their own direct report.
 *
 * Run it inside the caller's request transaction so RLS keeps it within the
 * active Agency.
 */
export async function findDirectReportEmployeeIds(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  supervisorEmployeeId: string,
  asOf: string,
): Promise<string[]> {
  const day = new Date(`${asOf}T00:00:00.000Z`);
  const inEffect = {
    effectiveFrom: { lte: day },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
  };
  const activeUnit = { agencyId, status: 'ACTIVE', domainStatus: 'ACTIVE', ...inEffect };

  const heldPositions = await transaction.positionIncumbency.findMany({
    where: { agencyId, employeeId: supervisorEmployeeId, status: 'ACTIVE', ...inEffect },
    select: { positionId: true },
  });
  if (heldPositions.length === 0) return [];
  const headedUnits = await transaction.organizationUnitVersion.findMany({
    where: { ...activeUnit, headPositionId: { in: heldPositions.map((row) => row.positionId) } },
    select: { organizationUnitId: true },
  });
  if (headedUnits.length === 0) return [];
  const unitIds = headedUnits.map((row) => row.organizationUnitId);

  const members = await transaction.serviceSegment.findMany({
    where: { agencyId, status: 'ACTIVE', organizationUnitId: { in: unitIds }, ...inEffect },
    select: { employeeId: true },
  });
  const childUnits = await transaction.organizationUnitVersion.findMany({
    where: { ...activeUnit, parentUnitId: { in: unitIds }, headPositionId: { not: null } },
    select: { headPositionId: true },
  });
  const childHeadPositionIds = childUnits.flatMap((row) =>
    row.headPositionId ? [row.headPositionId] : [],
  );
  const childHeads =
    childHeadPositionIds.length === 0
      ? []
      : await transaction.positionIncumbency.findMany({
          where: {
            agencyId,
            status: 'ACTIVE',
            positionId: { in: childHeadPositionIds },
            ...inEffect,
          },
          select: { employeeId: true },
        });

  const employeeIds = new Set([...members, ...childHeads].map((row) => row.employeeId));
  employeeIds.delete(supervisorEmployeeId);
  return [...employeeIds];
}
