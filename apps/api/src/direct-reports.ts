import type { Prisma } from '@prisma/client';

/**
 * Filters for records in effect on one date (ADR 0007). Approving a
 * future-dated change closes the current record early, so a closed record
 * still counts until its effective end; voided records never count.
 */
function inEffectFilters(agencyId: string, asOf: string) {
  const day = new Date(`${asOf}T00:00:00.000Z`);
  const inEffect = {
    effectiveFrom: { lte: day },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
  };
  return {
    inEffect,
    unitInEffect: {
      agencyId,
      status: { in: ['ACTIVE', 'SUPERSEDED'] },
      domainStatus: 'ACTIVE',
      ...inEffect,
    },
    notVoided: { not: 'VOIDED' },
  };
}

/**
 * Resolve the Employees who report directly to one Supervisor Employee on a
 * date (ADR 0007). The Supervisor heads every active Organization Unit whose
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
  const { inEffect, unitInEffect, notVoided } = inEffectFilters(agencyId, asOf);

  const heldPositions = await transaction.positionIncumbency.findMany({
    where: { agencyId, employeeId: supervisorEmployeeId, status: notVoided, ...inEffect },
    select: { positionId: true },
  });
  if (heldPositions.length === 0) return [];
  const headedUnits = await transaction.organizationUnitVersion.findMany({
    where: { ...unitInEffect, headPositionId: { in: heldPositions.map((row) => row.positionId) } },
    select: { organizationUnitId: true },
  });
  if (headedUnits.length === 0) return [];
  const unitIds = headedUnits.map((row) => row.organizationUnitId);

  const members = await transaction.serviceSegment.findMany({
    where: { agencyId, status: notVoided, organizationUnitId: { in: unitIds }, ...inEffect },
    select: { employeeId: true },
  });
  const childUnits = await transaction.organizationUnitVersion.findMany({
    where: { ...unitInEffect, parentUnitId: { in: unitIds }, headPositionId: { not: null } },
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
            status: notVoided,
            positionId: { in: childHeadPositionIds },
            ...inEffect,
          },
          select: { employeeId: true },
        });

  const employeeIds = new Set([...members, ...childHeads].map((row) => row.employeeId));
  employeeIds.delete(supervisorEmployeeId);
  return [...employeeIds];
}

/**
 * Resolve the Supervisor Employees of one Employee on a date, the inverse of
 * `findDirectReportEmployeeIds`: S is returned exactly when the Employee is
 * one of S's direct reports. They are the heads of the units the Employee
 * serves in and, for a unit the Employee heads, the head of its parent unit.
 * A concurrent Service Segment in another unit can yield more than one
 * Supervisor; callers that need one decide what that means.
 *
 * Run it inside the caller's request transaction so RLS keeps it within the
 * active Agency.
 */
export async function findSupervisorEmployeeIds(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  employeeId: string,
  asOf: string,
): Promise<string[]> {
  const { inEffect, unitInEffect, notVoided } = inEffectFilters(agencyId, asOf);

  const segments = await transaction.serviceSegment.findMany({
    where: { agencyId, employeeId, status: notVoided, ...inEffect },
    select: { organizationUnitId: true },
  });
  const heldPositions = await transaction.positionIncumbency.findMany({
    where: { agencyId, employeeId, status: notVoided, ...inEffect },
    select: { positionId: true },
  });
  const headedUnits =
    heldPositions.length === 0
      ? []
      : await transaction.organizationUnitVersion.findMany({
          where: {
            ...unitInEffect,
            parentUnitId: { not: null },
            headPositionId: { in: heldPositions.map((row) => row.positionId) },
          },
          select: { parentUnitId: true },
        });
  const supervisingUnitIds = [
    ...segments.map((row) => row.organizationUnitId),
    ...headedUnits.flatMap((row) => (row.parentUnitId ? [row.parentUnitId] : [])),
  ];
  if (supervisingUnitIds.length === 0) return [];

  const supervisingUnits = await transaction.organizationUnitVersion.findMany({
    where: {
      ...unitInEffect,
      organizationUnitId: { in: supervisingUnitIds },
      headPositionId: { not: null },
    },
    select: { headPositionId: true },
  });
  const headPositionIds = supervisingUnits.flatMap((row) =>
    row.headPositionId ? [row.headPositionId] : [],
  );
  if (headPositionIds.length === 0) return [];
  const heads = await transaction.positionIncumbency.findMany({
    where: { agencyId, status: notVoided, positionId: { in: headPositionIds }, ...inEffect },
    select: { employeeId: true },
  });

  const supervisorIds = new Set(heads.map((row) => row.employeeId));
  supervisorIds.delete(employeeId);
  return [...supervisorIds];
}
