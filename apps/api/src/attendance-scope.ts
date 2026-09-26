import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from './database-context';

export type AttendanceEmployeeScope =
  { kind: 'AGENCY' } | { kind: 'SCOPED'; employeeIds: string[] };

/**
 * Resolve the exact Attendance Employee scope of one permission grant. An
 * AGENCY grant covers every Employee in the Agency; OWN resolves the caller's
 * Employee and ASSIGNED_OFFICE resolves the active Service Segments of the
 * caller's primary Organization Unit. An unresolvable scope returns null so
 * the owning service can deny the read.
 */
export async function resolveAttendanceEmployeeScope(
  context: RequestContext,
  permissionCode: string,
): Promise<AttendanceEmployeeScope | null> {
  const grants = context.permissions.filter((grant) => grant.code === permissionCode);
  if (grants.length === 0) return null;
  if (grants.some((grant) => grant.scopePolicy === 'AGENCY')) {
    return { kind: 'AGENCY' };
  }
  const scopePolicies = new Set(grants.map((grant) => grant.scopePolicy));
  const employeeIds = new Set<string>();
  await withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
    if (scopePolicies.has('OWN')) {
      const membership = await transaction.agencyMembership.findFirst({
        where: { agencyId: context.agencyId, id: context.membershipId },
        select: { employeeId: true },
      });
      if (membership?.employeeId) employeeIds.add(membership.employeeId);
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
  if (employeeIds.size === 0) return null;
  return { kind: 'SCOPED', employeeIds: [...employeeIds] };
}
