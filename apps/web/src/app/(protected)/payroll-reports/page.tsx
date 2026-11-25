import type { Metadata } from 'next';
import { PayrollReports } from '../../../components/payroll-reports';
import { ShellState } from '../../../components/shell-state';
import { getAgencyJson } from '../../../lib/payroll-page-data';
import type { PayrollPeriodList } from '../../../lib/payroll-periods';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Payroll Reports' };
export const dynamic = 'force-dynamic';

const forbidden = (
  <ShellState
    code="403"
    title="You can’t open this page"
    message="Your active Agency Membership does not permit reading Payroll Periods and their outputs. Return to the Dashboard to continue."
  />
);

/** Payroll → Reports: one Finalized period's outputs. Today it lists the Payment Export. */
export default async function PayrollReportsPage() {
  const session = await getActiveSession();
  if (
    !hasPermission(session, 'payroll.periods.read') ||
    !hasPermission(session, 'payroll.payment_exports.generate')
  ) {
    return forbidden;
  }

  const list = await getAgencyJson(session, '/payroll-periods');
  if (list.status === 403) return forbidden;
  const periods = (list.value as Partial<PayrollPeriodList> | null)?.periods;
  if (!Array.isArray(periods)) throw new Error('Payroll Periods could not be loaded.');

  return (
    <PayrollReports
      agencyId={session.agencyId}
      canGeneratePaymentExport={hasPermission(session, 'payroll.payment_exports.generate')}
      periods={periods.filter((period) => period.status === 'FINALIZED')}
    />
  );
}
