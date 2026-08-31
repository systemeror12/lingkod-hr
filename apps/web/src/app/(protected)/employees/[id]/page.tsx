import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getConfig } from '@lingkod-hr/config';
import { getActiveSession, hasPermission } from '../../../../lib/session';
import { ShellState } from '../../../../components/shell-state';
import {
  EmployeeDetailView,
  type EmployeeDetailData,
} from '../../../../components/employee-directory-client';

export const metadata: Metadata = { title: 'Employee Details' };
export const dynamic = 'force-dynamic';

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getActiveSession();
  if (!hasPermission(session, 'personnel.employees.read')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Employee directory work. Return to the Dashboard to continue."
      />
    );
  }
  const config = getConfig();
  const cookieStore = await cookies();
  const response = await fetch(
    `${config.API_URL}/api/v1/agencies/${session.agencyId}/employees/${id}`,
    {
      headers: { cookie: cookieStore.toString(), origin: new URL(config.APP_URL).origin },
      cache: 'no-store',
    },
  );
  if (response.status === 403) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Employee directory work. Return to the Dashboard to continue."
      />
    );
  }
  if (response.status === 404) {
    return (
      <ShellState
        code="Not found"
        title="The Employee record could not be found"
        message="The Employee record is not available in this Agency Context."
      />
    );
  }
  if (!response.ok) throw new Error('The Employee record could not be loaded.');
  const value: unknown = await response.json();
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as EmployeeDetailData).id !== 'string' ||
    !Array.isArray((value as EmployeeDetailData).linkableMemberships)
  ) {
    throw new Error('The Employee record response was invalid.');
  }
  return (
    <EmployeeDetailView
      agencyId={session.agencyId}
      initial={value as EmployeeDetailData}
      canUpdate={hasPermission(session, 'personnel.employees.update')}
      canReadPds={hasPermission(session, 'personnel.pds.read')}
    />
  );
}
