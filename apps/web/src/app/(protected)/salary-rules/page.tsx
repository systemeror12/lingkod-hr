import type { Metadata } from 'next';
import { SalaryRulesWorkspace } from '../../../components/salary-rules-workspace';
import { ShellState } from '../../../components/shell-state';
import { getAgencyJson } from '../../../lib/payroll-page-data';
import type { RuleVersionSummary } from '../../../lib/payroll-rules';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Salary Rules' };
export const dynamic = 'force-dynamic';

const forbidden = (
  <ShellState
    code="403"
    title="You can’t open this page"
    message="Your active Agency Membership does not permit reading compensation and its rule versions. Return to the Dashboard to continue."
  />
);

/** `?version=<id>` opens that version, as the Compensation panel links its schedule source. */
export default async function SalaryRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ version?: string }>;
}) {
  const session = await getActiveSession();
  if (!hasPermission(session, 'payroll.compensation.read')) return forbidden;

  const [list, params] = await Promise.all([
    getAgencyJson(session, '/national-payroll-rule-versions'),
    searchParams,
  ]);
  if (list.status === 403) return forbidden;
  const versions = (list.value as { versions?: unknown } | null)?.versions;
  if (!Array.isArray(versions))
    throw new Error('National Payroll Rule Versions could not be loaded.');

  return (
    <SalaryRulesWorkspace
      agencyId={session.agencyId}
      versions={versions as RuleVersionSummary[]}
      initialOpenId={params.version ?? null}
    />
  );
}
