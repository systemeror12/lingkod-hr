import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from './database-context';
import { resolveEmployeeScope, type EmployeeScope } from './employee-scope';

export type AttendanceEmployeeScope = Exclude<EmployeeScope, { kind: 'NONE' }>;

/**
 * Resolve the exact Attendance Employee scope of one permission grant (see
 * `resolveEmployeeScope`). An unresolvable or empty scope returns null so the
 * owning service can deny the read.
 */
export async function resolveAttendanceEmployeeScope(
  context: RequestContext,
  permissionCode: string,
): Promise<AttendanceEmployeeScope | null> {
  // Without a grant there is nothing to resolve, so no transaction is opened.
  if (!hasPermission(context, permissionCode)) return null;
  const scope = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
    resolveEmployeeScope(transaction, context, permissionCode),
  );
  if (scope.kind === 'NONE') return null;
  if (scope.kind === 'SCOPED' && scope.employeeIds.length === 0) return null;
  return scope;
}
