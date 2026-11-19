import type { Metadata } from 'next';
import { DeductionObligationsWorkspace } from '../../../components/deduction-obligations-workspace';
import { ShellState } from '../../../components/shell-state';
import { loadAuthorityOptions, loadEmployeeOptions } from '../../../lib/payroll-page-data';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Deduction Obligations' };
export const dynamic = 'force-dynamic';

export default async function DeductionObligationsPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'payroll.deductions.manage')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit managing Deduction Obligations. Return to the Dashboard to continue."
      />
    );
  }

  const [employees, authorities] = await Promise.all([
    loadEmployeeOptions(session),
    loadAuthorityOptions(session),
  ]);

  return (
    <DeductionObligationsWorkspace
      agencyId={session.agencyId}
      authorities={authorities}
      employees={employees}
    />
  );
}
