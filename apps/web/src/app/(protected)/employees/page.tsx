import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { getConfig } from '@lingkod-hr/config';
import { buttonVariants } from '../../../components/ui/button';
import { getActiveSession, hasPermission } from '../../../lib/session';
import { ShellState } from '../../../components/shell-state';
import {
  EmployeeInitials,
  EmployeePageTitle,
  EmployeeStatus,
  formatEmployeeDate,
} from '../../../components/employee-directory';

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
      <header className="mb-7 flex flex-col gap-5 min-[700px]:flex-row min-[700px]:items-end min-[700px]:justify-between">
        <EmployeePageTitle
          eyebrow="Personnel records"
          title="Employee directory"
          description="Create and inspect stable employee identity records before active service begins."
        />
        <Link
          href="/employees/new"
          className={buttonVariants({ variant: 'primary', size: 'default' })}
        >
          Create employee
        </Link>
      </header>

      <div className="mb-5 grid border-y border-line bg-paper min-[700px]:grid-cols-3">
        {[
          ['PREBOARDING', employees.length],
          ['MEMBERSHIP LINKED', linked],
          ['NEEDS LINK', employees.length - linked],
        ].map(([label, count]) => (
          <div
            key={label}
            className="flex items-baseline justify-between border-b border-line px-5 py-4 last:border-0 min-[700px]:border-r min-[700px]:border-b-0 min-[700px]:last:border-r-0"
          >
            <span className="text-[10px] font-bold tracking-[.08em] text-muted">{label}</span>
            <strong className="font-mono text-2xl text-midnight">{count}</strong>
          </div>
        ))}
      </div>

      <section className="overflow-hidden rounded-[4px] border border-line bg-paper">
        {employees.length === 0 ? (
          <p className="m-0 px-5 py-8 text-sm text-muted">
            No Employee records have been created in this Agency.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-[#f9fafc] text-[10px] tracking-[.08em] text-muted uppercase">
                  <th className="px-5 py-3 font-bold">Employee</th>
                  <th className="px-5 py-3 font-bold">Employee no.</th>
                  <th className="px-5 py-3 font-bold">Membership</th>
                  <th className="px-5 py-3 font-bold">Created</th>
                  <th className="w-16">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => {
                  const href = `/employees/${employee.id}`;
                  return (
                    <tr
                      key={employee.id}
                      className="border-b border-line last:border-0 hover:bg-[#f8fafd]"
                    >
                      <td className="px-5 py-4">
                        <Link
                          href={href}
                          className="flex items-center gap-3 text-left no-underline"
                        >
                          <EmployeeInitials name={employee.legalName} />
                          <span>
                            <strong className="block text-sm font-[650] text-ink">
                              {employee.legalName}
                            </strong>
                            <span className="text-xs text-muted">PREBOARDING</span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-ink">
                        {employee.employeeNumber}
                      </td>
                      <td className="px-5 py-4">
                        <EmployeeStatus linked={Boolean(employee.membershipId)} />
                      </td>
                      <td className="px-5 py-4 text-xs text-muted">
                        {formatEmployeeDate(employee.createdAt)}
                      </td>
                      <td className="px-5">
                        <Link
                          href={href}
                          className="text-lg text-cobalt no-underline"
                          aria-label={`Open ${employee.legalName}`}
                        >
                          →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
