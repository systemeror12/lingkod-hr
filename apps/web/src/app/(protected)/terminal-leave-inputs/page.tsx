import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { ShellState } from '../../../components/shell-state';
import {
  TerminalLeaveInputWorkspace,
  type TerminalLeaveInputAssessmentListResponse,
  type TerminalLeaveInputCandidateListResponse,
} from '../../../components/terminal-leave-input-workspace';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Terminal Leave Inputs' };
export const dynamic = 'force-dynamic';

export default async function TerminalLeaveInputsPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'leave.terminal_inputs.read')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Terminal Leave Input work. Return to the Dashboard to continue."
      />
    );
  }

  const config = getConfig();
  const cookieStore = await cookies();
  const headers = {
    cookie: cookieStore.toString(),
    origin: new URL(config.APP_URL).origin,
  };
  const base = config.API_URL + '/api/v1/agencies/' + session.agencyId + '/terminal-leave-inputs';
  const [candidatesResponse, assessmentsResponse] = await Promise.all([
    fetch(base + '/candidates', { headers, cache: 'no-store' }),
    fetch(base + '/assessments', { headers, cache: 'no-store' }),
  ]);
  if (candidatesResponse.status === 403 || assessmentsResponse.status === 403) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Terminal Leave Input work. Return to the Dashboard to continue."
      />
    );
  }
  if (!candidatesResponse.ok || !assessmentsResponse.ok) {
    throw new Error('Terminal Leave Inputs could not be loaded.');
  }
  const candidates: unknown = await candidatesResponse.json();
  const assessments: unknown = await assessmentsResponse.json();
  if (!Array.isArray((candidates as { candidates?: unknown }).candidates)) {
    throw new Error('The Terminal Leave Input candidate response was invalid.');
  }
  if (!Array.isArray((assessments as { assessments?: unknown }).assessments)) {
    throw new Error('The Terminal Leave Input assessment response was invalid.');
  }

  return (
    <TerminalLeaveInputWorkspace
      agencyId={session.agencyId}
      canPreserve={hasPermission(session, 'leave.terminal_inputs.preserve')}
      initialCandidates={candidates as TerminalLeaveInputCandidateListResponse}
      initialAssessments={assessments as TerminalLeaveInputAssessmentListResponse}
    />
  );
}
