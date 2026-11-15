import type { Metadata } from 'next';
import {
  PayrollApplicabilityWorkspace,
  type ApplicabilityList,
} from '../../../components/payroll-applicability-workspace';
import { ShellState } from '../../../components/shell-state';
import {
  getAgencyJson,
  loadAuthorityOptions,
  loadEmployeeOptions,
} from '../../../lib/payroll-page-data';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Payroll Applicability' };
export const dynamic = 'force-dynamic';

const forbidden = (
  <ShellState
    code="403"
    title="You can’t open this page"
    message="Your active Agency Membership does not permit reading Agency Payroll Applicability. Return to the Dashboard to continue."
  />
);

export default async function PayrollApplicabilityPage() {
  const session = await getActiveSession();
  const canManage = hasPermission(session, 'payroll.compensation.manage');
  if (!canManage && !hasPermission(session, 'payroll.compensation.read')) return forbidden;

  const [list, employees, authorities] = await Promise.all([
    getAgencyJson(session, '/agency-payroll-applicabilities'),
    loadEmployeeOptions(session),
    canManage ? loadAuthorityOptions(session) : Promise.resolve([]),
  ]);
  if (list.status === 403) return forbidden;
  const value = list.value as Partial<ApplicabilityList> | null;
  if (!Array.isArray(value?.applicabilities) || !Array.isArray(value.payComponents)) {
    throw new Error('Agency Payroll Applicability could not be loaded.');
  }

  return (
    <PayrollApplicabilityWorkspace
      agencyId={session.agencyId}
      canManage={canManage}
      employees={employees}
      authorities={authorities}
      initialList={{ applicabilities: value.applicabilities, payComponents: value.payComponents }}
    />
  );
}
