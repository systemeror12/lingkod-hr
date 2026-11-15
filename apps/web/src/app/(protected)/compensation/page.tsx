import type { Metadata } from 'next';
import { CompensationWorkspace } from '../../../components/compensation-workspace';
import { ShellState } from '../../../components/shell-state';
import { loadEmployeeOptions } from '../../../lib/payroll-page-data';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Compensation' };
export const dynamic = 'force-dynamic';

export default async function CompensationPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'payroll.compensation.read')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit reading compensation. Return to the Dashboard to continue."
      />
    );
  }
  return (
    <CompensationWorkspace
      agencyId={session.agencyId}
      employees={await loadEmployeeOptions(session)}
    />
  );
}
