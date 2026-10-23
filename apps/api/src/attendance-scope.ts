import type { RequestContext } from '@lingkod-hr/auth';
import { resolveEmployeeScope, type EmployeeScope } from './employee-scope';

export type AttendanceEmployeeScope = EmployeeScope;

/**
 * Resolve the exact Attendance Employee scope of one permission grant (see
 * `resolveEmployeeScope`). An unresolvable or empty scope returns null so the
 * owning service can deny the read.
 */
export async function resolveAttendanceEmployeeScope(
  context: RequestContext,
  permissionCode: string,
): Promise<AttendanceEmployeeScope | null> {
  const scope = await resolveEmployeeScope(context, permissionCode);
  if (scope?.kind === 'SCOPED' && scope.employeeIds.length === 0) return null;
  return scope;
}
