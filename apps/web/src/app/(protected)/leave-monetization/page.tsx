import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { ShellState } from '../../../components/shell-state';
import {
  LeaveMonetizationWorkspace,
  type MonetizationPage,
} from '../../../components/leave-monetization-workspace';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Leave Monetization' };
export const dynamic = 'force-dynamic';

export default async function LeaveMonetizationPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'leave.accounts.read')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Leave Monetization work. Return to the Dashboard to continue."
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
  const listResponse = await fetch(base + '/leave-monetization', { headers, cache: 'no-store' });
  if (listResponse.status === 403) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Leave Monetization work. Return to the Dashboard to continue."
      />
    );
  }
  if (!listResponse.ok) {
    throw new Error('Leave Monetization could not be loaded.');
  }
  const list: unknown = await listResponse.json();
  if (
    typeof list !== 'object' ||
    list === null ||
    !Array.isArray((list as { items?: unknown }).items)
  ) {
    throw new Error('The Leave Monetization response was invalid.');
  }

  const createScope = session.permissions.some(
    ({ code, scopePolicy }) => code === 'leave.monetization.create' && scopePolicy === 'AGENCY',
  )
    ? 'AGENCY'
    : hasPermission(session, 'leave.monetization.create')
      ? 'OWN'
      : null;

  return (
    <LeaveMonetizationWorkspace
      agencyId={session.agencyId}
      initial={list as MonetizationPage}
      permissions={{
        createScope,
        submit: hasPermission(session, 'leave.monetization.submit'),
        certify: hasPermission(session, 'leave.monetization.certify'),
        returnRequest: hasPermission(session, 'leave.monetization.return'),
        reviewFunding: hasPermission(session, 'leave.monetization.review_funding'),
        approve: hasPermission(session, 'leave.monetization.approve'),
        reject: hasPermission(session, 'leave.monetization.reject'),
        post: hasPermission(session, 'leave.monetization.post'),
        adjust: hasPermission(session, 'leave.monetization.adjust'),
        withdraw: hasPermission(session, 'leave.monetization.withdraw'),
        cancel: hasPermission(session, 'leave.monetization.cancel'),
      }}
    />
  );
}
