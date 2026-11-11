import type { RequestContext } from '@lingkod-hr/auth';
import type { Prisma } from '@prisma/client';
import { findDirectReportEmployeeIds } from './direct-reports';

/**
 * The Employees one permission reaches for the acting Agency Membership: none
 * (no grant), the whole Agency, or an exact Employee id set, which may be empty.
 */
export type EmployeeScope =
  { kind: 'NONE' } | { kind: 'AGENCY' } | { kind: 'SCOPED'; employeeIds: string[] };

/** Whether the scope reaches one Employee. */
export function scopeCovers(scope: EmployeeScope, employeeId: string): boolean {
  if (scope.kind === 'NONE') return false;
  return scope.kind === 'AGENCY' || scope.employeeIds.includes(employeeId);
}

/** The Employee linked to the acting Agency Membership, or null when none is linked. */
export async function ownEmployeeId(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
): Promise<string | null> {
  const membership = await transaction.agencyMembership.findFirst({
    where: { agencyId: context.agencyId, id: context.membershipId },
    select: { employeeId: true },
  });
  return membership?.employeeId ?? null;
}

/**
 * Resolve which Employees one permission's grants reach, inside the caller's
 * transaction (ADR 0011). An AGENCY grant reaches the whole Agency. Otherwise
 * OWN adds the Employee linked to the acting Agency Membership, DIRECT_REPORTS
 * adds that Employee's Direct Reports on today's Manila date (ADR 0007),
 * ASSIGNED_OFFICE adds the active Service Segments of the membership's primary
 * Organization Unit, and RESTRICTED adds nobody. Returns NONE without a grant.
 * Each caller maps NONE and an uncovered Employee to its own error.
 */
export async function resolveEmployeeScope(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  permissionCode: string,
): Promise<EmployeeScope> {
  const grants = context.permissions.filter((grant) => grant.code === permissionCode);
  if (grants.length === 0) return { kind: 'NONE' };
  if (grants.some((grant) => grant.scopePolicy === 'AGENCY')) return { kind: 'AGENCY' };
  const scopePolicies = new Set(grants.map((grant) => grant.scopePolicy));
  const employeeIds = new Set<string>();
  if (scopePolicies.has('OWN') || scopePolicies.has('DIRECT_REPORTS')) {
    const employeeId = await ownEmployeeId(transaction, context);
    if (employeeId && scopePolicies.has('OWN')) employeeIds.add(employeeId);
    if (employeeId && scopePolicies.has('DIRECT_REPORTS')) {
      const reports = await findDirectReportEmployeeIds(
        transaction,
        context.agencyId,
        employeeId,
        manilaToday(),
      );
      for (const reportId of reports) employeeIds.add(reportId);
    }
  }
  if (scopePolicies.has('ASSIGNED_OFFICE') && context.primaryOrganizationUnitId) {
    const segments = await transaction.serviceSegment.findMany({
      where: {
        agencyId: context.agencyId,
        organizationUnitId: context.primaryOrganizationUnitId,
        status: 'ACTIVE',
      },
      select: { employeeId: true },
    });
    for (const segment of segments) employeeIds.add(segment.employeeId);
  }
  return { kind: 'SCOPED', employeeIds: [...employeeIds] };
}

/** Today as a `YYYY-MM-DD` calendar date in Asia/Manila. */
export function manilaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
