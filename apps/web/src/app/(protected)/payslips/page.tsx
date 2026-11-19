import type { Metadata } from 'next';
import { PayslipsWorkspace } from '../../../components/payslips-workspace';
import { ShellState } from '../../../components/shell-state';
import {
  getAgencyJson,
  loadAuthorityOptions,
  loadEmployeeOptions,
} from '../../../lib/payroll-page-data';
import type { PayrollPeriodList } from '../../../lib/payroll-periods';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Employee Payslips' };
export const dynamic = 'force-dynamic';

const forbidden = (
  <ShellState
    code="403"
    title="You can’t open this page"
    message="Your active Agency Membership does not permit reading Payroll Periods. Return to the Dashboard to continue."
  />
);

export default async function PayslipsPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'payroll.periods.read')) return forbidden;

  const canManageDeductions = hasPermission(session, 'payroll.deductions.manage');
  const [list, employees, authorities] = await Promise.all([
    getAgencyJson(session, '/payroll-periods'),
    loadEmployeeOptions(session),
    canManageDeductions ? loadAuthorityOptions(session) : Promise.resolve([]),
  ]);
  if (list.status === 403) return forbidden;
  const value = list.value as Partial<PayrollPeriodList> | null;
  if (!Array.isArray(value?.periods) || !Array.isArray(value.payComponents)) {
    throw new Error('Payroll Periods could not be loaded.');
  }

  return (
    <PayslipsWorkspace
      agencyId={session.agencyId}
      authorities={authorities}
      canCalculate={hasPermission(session, 'payroll.periods.calculate')}
      canCreate={hasPermission(session, 'payroll.periods.create')}
      canManageDeductions={canManageDeductions}
      employees={employees}
      initialList={value as PayrollPeriodList}
    />
  );
}
