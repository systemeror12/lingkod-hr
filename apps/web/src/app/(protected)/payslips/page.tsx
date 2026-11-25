import type { Metadata } from 'next';
import { PayslipsWorkspace } from '../../../components/payslips-workspace';
import { ShellState } from '../../../components/shell-state';
import {
  getAgencyJson,
  loadAuthorityOptions,
  loadEmployeeOptions,
} from '../../../lib/payroll-page-data';
import { REVIEW_PERMISSIONS, type PayrollPeriodList } from '../../../lib/payroll-periods';
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
  const reviewPermissions = REVIEW_PERMISSIONS.filter((code) => hasPermission(session, code));
  // Billing and checkpoint reviews each cite a finalized Document Version as evidence.
  const citesEvidence =
    canManageDeductions ||
    reviewPermissions.includes('payroll.periods.review_funding') ||
    reviewPermissions.includes('payroll.periods.review_accounting');
  const [list, employees, authorities] = await Promise.all([
    getAgencyJson(session, '/payroll-periods'),
    loadEmployeeOptions(session),
    citesEvidence ? loadAuthorityOptions(session) : Promise.resolve([]),
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
      canReadPayslips={session.permissions.some(
        ({ code, scopePolicy }) => code === 'payroll.payslips.read' && scopePolicy === 'AGENCY',
      )}
      canReadPaymentExports={hasPermission(session, 'payroll.payment_exports.generate')}
      canRecordDisbursement={hasPermission(session, 'payroll.disbursement.update')}
      employees={employees}
      evidenceReadable={hasPermission(session, 'documents.evidence.read')}
      initialList={value as PayrollPeriodList}
      reviewPermissions={reviewPermissions}
    />
  );
}
