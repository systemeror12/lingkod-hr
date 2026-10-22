import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from './database-context';
import { findDirectReportEmployeeIds } from './direct-reports';

export type EmployeeScope = { kind: 'AGENCY' } | { kind: 'SCOPED'; employeeIds: string[] };

/**
 * Resolve which Employees one permission's grants cover: the whole Agency, or
 * an exact Employee id set. OWN adds the caller's linked Employee,
 * DIRECT_REPORTS adds that Employee's direct reports on today's Manila date
 * (ADR 0007), and ASSIGNED_OFFICE adds the active Service Segments of the
 * caller's primary Organization Unit. Returns null when the caller holds no
 * grant for the permission; the set may be empty.
 */
export async function resolveEmployeeScope(
  context: RequestContext,
  permissionCode: string,
): Promise<EmployeeScope | null> {
  const grants = context.permissions.filter((grant) => grant.code === permissionCode);
  if (grants.length === 0) return null;
  if (grants.some((grant) => grant.scopePolicy === 'AGENCY')) {
    return { kind: 'AGENCY' };
  }
  const scopePolicies = new Set(grants.map((grant) => grant.scopePolicy));
  const employeeIds = new Set<string>();
  await withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
    if (scopePolicies.has('OWN') || scopePolicies.has('DIRECT_REPORTS')) {
      const membership = await transaction.agencyMembership.findFirst({
        where: { agencyId: context.agencyId, id: context.membershipId },
        select: { employeeId: true },
      });
      const employeeId = membership?.employeeId;
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
  });
  return { kind: 'SCOPED', employeeIds: [...employeeIds] };
}

function manilaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
