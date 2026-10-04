import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { getConfig } from '@lingkod-hr/config';
import { buttonVariants } from '../../../components/ui/button';
import { getActiveSession, hasPermission } from '../../../lib/session';
import { ShellState } from '../../../components/shell-state';
import { StateCode, StateSurface } from '../../../components/state-surface';
import {
  EmployeeServiceStatus,
  EmployeeStatus,
  formatEmployeeDate,
} from '../../../components/employee-directory';
import {
  EmployeeRegisterControls,
  type EmployeeRegisterFacets,
} from '../../../components/employee-register-controls';
import {
  employeeRegisterApiQuery,
  employeeRegisterHref,
  readEmployeeRegisterParams,
} from '../../../lib/employee-register';
import { PageHeader } from '../../../components/ui/page-header';
import { Panel } from '../../../components/ui/panel';
import { Table, Td, Th, Tr } from '../../../components/ui/table';

export const metadata: Metadata = { title: 'Employees' };
export const dynamic = 'force-dynamic';

interface EmployeeRow {
  id: string;
  employeeNumber: string;
  legalName: string;
  serviceStatus: string;
  membershipId: string | null;
  createdAt: string;
}

interface EmployeeListResponse {
  employees: EmployeeRow[];
  total: number;
  offset: number;
  facets: EmployeeRegisterFacets;
}

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = readEmployeeRegisterParams(await searchParams);
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
    `${config.API_URL}/api/v1/agencies/${session.agencyId}/employees?${employeeRegisterApiQuery(params)}`,
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
    !Array.isArray((value as { employees?: unknown }).employees) ||
    typeof (value as { total?: unknown }).total !== 'number' ||
    typeof (value as { facets?: unknown }).facets !== 'object'
  ) {
    throw new Error('The Employee directory response was invalid.');
  }
  const { employees, total, offset, facets } = value as EmployeeListResponse;
  const filtered =
    params.q !== '' || params.serviceStatus.length > 0 || params.membership.length > 0;
  const header = (
    <PageHeader
      breadcrumbs={[{ label: 'Personnel' }]}
      title="Employee directory"
      actions={
        <Link href="/employees/new" className={buttonVariants({ variant: 'primary' })}>
          Create employee
        </Link>
      }
    />
  );

  if (total === 0 && !filtered) {
    return (
      <div className="grid gap-5">
        {header}
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
      </div>
    );
  }

  const hasPrevious = params.page > 1;
  const hasNext = offset + employees.length < total;
  return (
    <div className="grid gap-5">
      {header}
      <EmployeeRegisterControls key={params.q} params={params} facets={facets}>
        <Panel
          title="Employees"
          flush
          actions={
            <p className="m-0 text-caption text-ink-muted tabular-nums">
              {employees.length === 0
                ? `No matches · ${total} total`
                : `Showing ${offset + 1}–${offset + employees.length} of ${total}`}
            </p>
          }
        >
          {employees.length === 0 ? (
            <p className="m-0 px-4 py-6 text-body text-ink-muted">
              {total === 0
                ? 'No Employees match this search and these filters. Change the search or clear a filter.'
                : 'This page is past the last Employee. Go back to the first page.'}
            </p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Employee no.</Th>
                  <Th>Name</Th>
                  <Th>Service status</Th>
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
                      <EmployeeServiceStatus status={employee.serviceStatus} />
                    </Td>
                    <Td>
                      <EmployeeStatus linked={Boolean(employee.membershipId)} />
                    </Td>
                    <Td kind="date">{formatEmployeeDate(employee.createdAt)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          {hasPrevious || hasNext ? (
            <nav
              aria-label="Employee pages"
              className="flex items-center justify-between gap-2 border-t border-border px-4 py-2"
            >
              {hasPrevious ? (
                <Link
                  href={employeeRegisterHref({
                    ...params,
                    page: employees.length === 0 ? 1 : params.page - 1,
                  })}
                  className={buttonVariants({ variant: 'secondary' })}
                >
                  {employees.length === 0 ? 'First page' : 'Previous page'}
                </Link>
              ) : (
                <span />
              )}
              {hasNext ? (
                <Link
                  href={employeeRegisterHref({ ...params, page: params.page + 1 })}
                  className={buttonVariants({ variant: 'secondary' })}
                >
                  Next page
                </Link>
              ) : null}
            </nav>
          ) : null}
        </Panel>
      </EmployeeRegisterControls>
    </div>
  );
}
