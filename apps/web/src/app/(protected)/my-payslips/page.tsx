import type { Metadata } from 'next';
import { MyPayslips, type OwnPayslip } from '../../../components/my-payslips';
import { ShellState } from '../../../components/shell-state';
import { getAgencyJson } from '../../../lib/payroll-page-data';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'My Payslips' };
export const dynamic = 'force-dynamic';

const forbidden = (
  <ShellState
    code="403"
    title="You can’t open My Payslips"
    message="Your active Agency Membership does not permit reading your payslips. Return to the Dashboard to continue."
  />
);

export default async function MyPayslipsPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'payroll.payslips.read')) return forbidden;

  const list = await getAgencyJson(session, '/payslips');
  if (list.status === 403) return forbidden;
  const payslips = (list.value as { payslips?: unknown } | null)?.payslips;
  if (!Array.isArray(payslips)) throw new Error('Your payslips could not be loaded.');

  return <MyPayslips agencyId={session.agencyId} payslips={payslips as OwnPayslip[]} />;
}
