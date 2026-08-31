import type { Metadata } from 'next';
import { getActiveSession, hasPermission } from '../../../../lib/session';
import { ShellState } from '../../../../components/shell-state';
import { EmployeeCreateForm } from '../../../../components/employee-directory-client';

export const metadata: Metadata = { title: 'Create Employee' };
export const dynamic = 'force-dynamic';

export default async function NewEmployeePage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'personnel.employees.create')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Employee creation. Return to the Dashboard to continue."
      />
    );
  }
  return <EmployeeCreateForm agencyId={session.agencyId} />;
}
