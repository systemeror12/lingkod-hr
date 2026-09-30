import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { ShellState } from '../../../components/shell-state';
import {
  LeaveApplicationWorkspace,
  type LeaveApplicationListResponse,
} from '../../../components/leave-application-workspace';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Leave Applications' };
export const dynamic = 'force-dynamic';

export default async function LeaveApplicationsPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'leave.applications.create')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Leave Application work. Return to the Dashboard to continue."
      />
    );
  }

  const config = getConfig();
  const cookieStore = await cookies();
  const headers = {
    cookie: cookieStore.toString(),
    origin: new URL(config.APP_URL).origin,
  };
  const base = config.API_URL + '/api/v1/agencies/' + session.agencyId;
  const listResponse = await fetch(base + '/leave-applications', { headers, cache: 'no-store' });
  if (listResponse.status === 403) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Leave Application work. Return to the Dashboard to continue."
      />
    );
  }
  if (!listResponse.ok) {
    throw new Error('Leave Applications could not be loaded.');
  }
  const list: unknown = await listResponse.json();
  if (
    typeof list !== 'object' ||
    list === null ||
    !Array.isArray((list as { applications?: unknown }).applications)
  ) {
    throw new Error('The Leave Application response was invalid.');
  }

  return (
    <LeaveApplicationWorkspace
      agencyId={session.agencyId}
      canRecordForOthers={session.permissions.some(
        (grant) => grant.code === 'leave.applications.create' && grant.scopePolicy === 'AGENCY',
      )}
      canSubmit={hasPermission(session, 'leave.applications.submit')}
      canWithdraw={hasPermission(session, 'leave.applications.withdraw')}
      canRoute={hasPermission(session, 'leave.applications.route')}
      canCertify={hasPermission(session, 'leave.credits.certify')}
      canRecommend={hasPermission(session, 'leave.applications.recommend')}
      canApprove={hasPermission(session, 'leave.applications.approve')}
      canReject={hasPermission(session, 'leave.applications.reject')}
      canReturn={hasPermission(session, 'leave.applications.return')}
      canRequestCancel={hasPermission(session, 'leave.applications.request_cancel')}
      canCancel={hasPermission(session, 'leave.applications.cancel')}
      canRejectCancel={hasPermission(session, 'leave.applications.reject_cancel')}
      initial={list as LeaveApplicationListResponse}
    />
  );
}
