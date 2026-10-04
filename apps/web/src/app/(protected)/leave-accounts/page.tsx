import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { ShellState } from '../../../components/shell-state';
import {
  LeaveAccountWorkspace,
  type LeaveAccountListResponse,
} from '../../../components/leave-account-workspace';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Leave Accounts' };
export const dynamic = 'force-dynamic';

export default async function LeaveAccountsPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'leave.accounts.read')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Leave Account work. Return to the Dashboard to continue."
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
  const listResponse = await fetch(base + '/leave-accounts', { headers, cache: 'no-store' });
  if (listResponse.status === 403) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Leave Account work. Return to the Dashboard to continue."
      />
    );
  }
  if (!listResponse.ok) {
    throw new Error('Leave Accounts could not be loaded.');
  }
  const list: unknown = await listResponse.json();
  if (
    typeof list !== 'object' ||
    list === null ||
    !Array.isArray((list as { accounts?: unknown }).accounts)
  ) {
    throw new Error('The Leave Account response was invalid.');
  }

  return (
    <LeaveAccountWorkspace
      agencyId={session.agencyId}
      canAdjust={hasPermission(session, 'leave.credits.adjust')}
      initial={list as LeaveAccountListResponse}
    />
  );
}
