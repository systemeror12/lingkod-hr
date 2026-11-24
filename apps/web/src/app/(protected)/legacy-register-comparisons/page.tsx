import type { Metadata } from 'next';
import { LegacyRegisterComparisonsWorkspace } from '../../../components/legacy-register-comparisons-workspace';
import { ShellState } from '../../../components/shell-state';
import type { LegacyRegisterComparisonSummary } from '../../../lib/legacy-register-comparisons';
import { getAgencyJson } from '../../../lib/payroll-page-data';
import type { PayrollPeriodList } from '../../../lib/payroll-periods';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Legacy Register Comparisons' };
export const dynamic = 'force-dynamic';

const forbidden = (
  <ShellState
    code="403"
    title="You can’t open this page"
    message="Your active Agency Membership does not permit comparing legacy payroll registers. Return to the Dashboard to continue."
  />
);

export default async function LegacyRegisterComparisonsPage() {
  const session = await getActiveSession();
  if (
    !hasPermission(session, 'payroll.legacy_registers.compare') ||
    !hasPermission(session, 'payroll.periods.read')
  ) {
    return forbidden;
  }

  const [comparisons, periods] = await Promise.all([
    getAgencyJson(session, '/legacy-register-comparisons'),
    getAgencyJson(session, '/payroll-periods'),
  ]);
  if (comparisons.status === 403 || periods.status === 403) return forbidden;
  const list = (comparisons.value as { comparisons?: LegacyRegisterComparisonSummary[] } | null)
    ?.comparisons;
  const periodList = periods.value as Partial<PayrollPeriodList> | null;
  if (
    !Array.isArray(list) ||
    !Array.isArray(periodList?.periods) ||
    !Array.isArray(periodList.payComponents)
  ) {
    throw new Error('Legacy Register Comparisons could not be loaded.');
  }

  return (
    <LegacyRegisterComparisonsWorkspace
      agencyId={session.agencyId}
      initialComparisons={list}
      payComponents={periodList.payComponents}
      periods={periodList.periods}
    />
  );
}
