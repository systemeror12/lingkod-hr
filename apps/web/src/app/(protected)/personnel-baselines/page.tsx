import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getConfig } from '@lingkod-hr/config';
import { ShellState } from '../../../components/shell-state';
import {
  PersonnelBaselineWorkspace,
  type PersonnelBaselineListResponse,
} from '../../../components/personnel-baseline-workspace';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Personnel Baselines' };
export const dynamic = 'force-dynamic';

export default async function PersonnelBaselinesPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'personnel.baselines.read')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Personnel Baseline work. Return to the Dashboard to continue."
      />
    );
  }

  const config = getConfig();
  const cookieStore = await cookies();
  const response = await fetch(
    `${config.API_URL}/api/v1/agencies/${session.agencyId}/personnel-baselines`,
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
        message="Your active Agency Membership does not permit Personnel Baseline work. Return to the Dashboard to continue."
      />
    );
  }
  if (response.status === 404) {
    return (
      <ShellState
        code="Not found"
        title="The Personnel Baseline register could not be found"
        message="The Personnel Baseline register is not available in this Agency Context."
      />
    );
  }
  if (!response.ok) throw new Error('Personnel Baselines could not be loaded.');
  const value: unknown = await response.json();
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as { baselines?: unknown }).baselines)
  ) {
    throw new Error('The Personnel Baseline response was invalid.');
  }

  return (
    <PersonnelBaselineWorkspace
      agencyId={session.agencyId}
      canAudit={hasPermission(session, 'personnel.baselines.audit.read')}
      canCorrect={hasPermission(session, 'personnel.baselines.correct')}
      canEffectuate={hasPermission(session, 'personnel.baselines.effectuate')}
      canPrepare={hasPermission(session, 'personnel.baselines.prepare')}
      canReview={hasPermission(session, 'personnel.baselines.review')}
      initial={value as PersonnelBaselineListResponse}
    />
  );
}
