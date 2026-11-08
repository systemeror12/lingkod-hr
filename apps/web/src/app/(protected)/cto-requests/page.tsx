import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { ShellState } from '../../../components/shell-state';
import {
  CtoRequestWorkspace,
  type CtoRequestListResponse,
} from '../../../components/cto-request-workspace';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'CTO Requests' };
export const dynamic = 'force-dynamic';

const denied = (
  <ShellState
    code="403"
    title="You can’t open this page"
    message="Your active Agency Membership does not permit reading CTO Requests. Return to the Dashboard to continue."
  />
);

/** Reading CTO Requests needs `overtime.coc.read` within scope (hris-controls §5.19, #545). */
export default async function CtoRequestsPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'overtime.coc.read')) return denied;

  const config = getConfig();
  const cookieStore = await cookies();
  const response = await fetch(
    config.API_URL + '/api/v1/agencies/' + session.agencyId + '/cto-requests',
    {
      headers: { cookie: cookieStore.toString(), origin: new URL(config.APP_URL).origin },
      cache: 'no-store',
    },
  );
  if (response.status === 403) return denied;
  if (!response.ok) throw new Error('CTO Requests could not be loaded.');
  const list: unknown = await response.json();
  if (
    typeof list !== 'object' ||
    list === null ||
    !Array.isArray((list as { requests?: unknown }).requests)
  ) {
    throw new Error('The CTO Request response was invalid.');
  }

  return (
    <CtoRequestWorkspace
      agencyId={session.agencyId}
      initial={list as CtoRequestListResponse}
      canCreate={hasPermission(session, 'overtime.cto.create')}
      canRecordForOthers={
        session.permissions.some(
          (grant) => grant.code === 'overtime.cto.create' && grant.scopePolicy === 'AGENCY',
        ) && hasPermission(session, 'personnel.employees.read')
      }
      canSubmit={hasPermission(session, 'overtime.cto.submit')}
      canWithdraw={hasPermission(session, 'overtime.cto.withdraw')}
      canRecommend={hasPermission(session, 'overtime.cto.recommend')}
      canReturn={hasPermission(session, 'overtime.cto.return')}
      canApprove={hasPermission(session, 'overtime.cto.approve')}
      canReject={hasPermission(session, 'overtime.cto.reject')}
      canCancel={hasPermission(session, 'overtime.cto.cancel')}
    />
  );
}
