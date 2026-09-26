import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { getConfig } from '@lingkod-hr/config';
import { buttonVariants } from '../../../components/ui/button';
import { getActiveSession, hasPermission } from '../../../lib/session';
import { ShellState } from '../../../components/shell-state';
import { StateCode, StateSurface } from '../../../components/state-surface';
import { EmployeeStatus, formatEmployeeDate } from '../../../components/employee-directory';
import { PageHeader } from '../../../components/ui/page-header';
import { Panel } from '../../../components/ui/panel';
import { Table, Td, Th, Tr } from '../../../components/ui/table';

export const metadata: Metadata = { title: 'Employees' };
export const dynamic = 'force-dynamic';

interface EmployeeRow {
  id: string;
  employeeNumber: string;
  legalName: string;
  membershipId: string | null;
  createdAt: string;
}

export default async function EmployeesPage() {
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
  const response = await fetch(`${config.API_URL}/api/v1/agencies/${session.agencyId}/employees`, {
    headers: { cookie: cookieStore.toString(), origin: new URL(config.APP_URL).origin },
    cache: 'no-store',
  });
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
        title="The Employee directory could not be found"
        message="The Employee directory is not available in this Agency Context."
      />
    );
  }
  if (!response.ok) throw new Error('The Employee directory could not be loaded.');
  const value: unknown = await response.json();
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as { employees?: unknown }).employees)
  ) {
    throw new Error('The Employee directory response was invalid.');
  }
  const employees = (value as { employees: EmployeeRow[] }).employees;
  const linked = employees.filter((employee) => employee.membershipId).length;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Personnel' }]}
        title="Employee directory"
        actions={
          <Link href="/employees/new" className={buttonVariants({ variant: 'primary' })}>
            Create employee
          </Link>
        }
      />

      {employees.length === 0 ? (
        <StateSurface labelledBy="employees-empty-title">
          <StateCode>Empty</StateCode>
          <h2 className="m-0 text-panel-title text-ink" id="employees-empty-title">
            No Employee records yet
          </h2>
          <p className="m-0 max-w-[500px] text-body text-ink-muted">
            No Employee records have been created in this Agency. Create a preboarding Employee to
            start a stable identity record before active service begins.
          </p>
        </StateSurface>
      ) : (
        <Panel
          title="Employees"
          flush
          actions={
            <p className="m-0 text-caption text-ink-muted">
              {linked} membership linked · {employees.length - linked} need link
            </p>
          }
        >
          <Table>
            <thead>
              <tr>
                <Th>Employee no.</Th>
                <Th>Name</Th>
                <Th>Membership</Th>
                <Th kind="date">Created</Th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <Tr key={employee.id}>
                  <Td className="whitespace-nowrap">{employee.employeeNumber}</Td>
                  <Td className="whitespace-nowrap">
                    <Link
                      href={`/employees/${employee.id}`}
                      className="font-[600] text-primary no-underline hover:underline"
                    >
                      {employee.legalName}
                    </Link>
                  </Td>
                  <Td>
                    <EmployeeStatus linked={Boolean(employee.membershipId)} />
                  </Td>
                  <Td kind="date">{formatEmployeeDate(employee.createdAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </>
  );
}
