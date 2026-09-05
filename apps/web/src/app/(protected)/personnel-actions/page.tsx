import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getConfig } from '@lingkod-hr/config';
import {
  PersonnelActionWorkspace,
  type PersonnelActionListResponse,
} from '../../../components/personnel-action-workspace';
import { ShellState } from '../../../components/shell-state';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Personnel Actions' };
export const dynamic = 'force-dynamic';

export default async function PersonnelActionsPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'personnel.actions.read')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Personnel Action work."
      />
    );
  }

  const config = getConfig();
  const cookieStore = await cookies();
  const response = await fetch(
    `${config.API_URL}/api/v1/agencies/${session.agencyId}/personnel-actions`,
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
        message="Your active Agency Membership does not permit Personnel Action work."
      />
    );
  }
  if (response.status === 404) {
    return (
      <ShellState
        code="Not found"
        title="The Personnel Action register could not be found"
        message="The register is not available in this Agency Context."
      />
    );
  }
  if (!response.ok) throw new Error('Personnel Actions could not be loaded.');
  const value: unknown = await response.json();
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as { actions?: unknown }).actions)
  ) {
    throw new Error('The Personnel Action response was invalid.');
  }

  return (
    <PersonnelActionWorkspace
      agencyId={session.agencyId}
      canApprove={hasPermission(session, 'personnel.actions.approve')}
      canAudit={hasPermission(session, 'personnel.actions.audit.read')}
      canCancel={hasPermission(session, 'personnel.actions.cancel')}
      canCancelApproved={hasPermission(session, 'personnel.actions.cancel_approved')}
      canCorrect={hasPermission(session, 'personnel.actions.correct')}
      canEffectuate={hasPermission(session, 'personnel.actions.effectuate')}
      canEndorse={hasPermission(session, 'personnel.actions.endorse')}
      canPrepare={hasPermission(session, 'personnel.actions.create')}
      canReject={hasPermission(session, 'personnel.actions.reject')}
      canReturn={hasPermission(session, 'personnel.actions.return')}
      canSubmit={hasPermission(session, 'personnel.actions.submit')}
      initial={value as PersonnelActionListResponse}
      membershipId={session.membershipId}
    />
  );
}
