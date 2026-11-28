import type { Metadata } from 'next';
import { PayrollCorrectionsWorkspace } from '../../../components/payroll-corrections-workspace';
import { ShellState } from '../../../components/shell-state';
import { adjustmentListPath, type PayrollAdjustment } from '../../../lib/payroll-corrections';
import {
  getAgencyJson,
  loadAuthorityOptions,
  loadEmployeeOptions,
} from '../../../lib/payroll-page-data';
import type { PayrollPeriodList } from '../../../lib/payroll-periods';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Payroll Corrections' };
export const dynamic = 'force-dynamic';

const forbidden = (
  <ShellState
    code="403"
    title="You can’t open this page"
    message="Your active Agency Membership does not permit reading Payroll Periods. Return to the Dashboard to continue."
  />
);

export default async function PayrollCorrectionsPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'payroll.periods.read')) return forbidden;

  const canRequestVoid = hasPermission(session, 'payroll.periods.void');
  const [adjustments, periods, employees, authorities] = await Promise.all([
    getAgencyJson(session, adjustmentListPath('OPEN')),
    getAgencyJson(session, '/payroll-periods'),
    loadEmployeeOptions(session),
    canRequestVoid ? loadAuthorityOptions(session) : Promise.resolve([]),
  ]);
  if (adjustments.status === 403 || periods.status === 403) return forbidden;
  const rows = (adjustments.value as { adjustments?: PayrollAdjustment[] } | null)?.adjustments;
  const periodList = periods.value as Partial<PayrollPeriodList> | null;
  if (!Array.isArray(rows) || !Array.isArray(periodList?.periods)) {
    throw new Error('Payroll Corrections could not be loaded.');
  }

  return (
    <PayrollCorrectionsWorkspace
      agencyId={session.agencyId}
      authorities={authorities}
      canAdjust={hasPermission(session, 'payroll.inputs.adjust')}
      canApproveVoid={hasPermission(session, 'payroll.periods.approve_void')}
      canRequestVoid={canRequestVoid}
      employees={employees}
      evidenceReadable={hasPermission(session, 'documents.evidence.read')}
      initialAdjustments={rows}
      initialPeriods={periodList.periods}
    />
  );
}
