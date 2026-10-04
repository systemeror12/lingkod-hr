import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { ShellState } from '../../../components/shell-state';
import {
  LeavePolicyWorkspace,
  type LeaveCatalogueResponse,
  type LeaveTypeListResponse,
} from '../../../components/leave-policy-workspace';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Leave Policies' };
export const dynamic = 'force-dynamic';

export default async function LeavePoliciesPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'leave.types.read')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Leave Policy work. Return to the Dashboard to continue."
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
  const [catalogueResponse, listResponse] = await Promise.all([
    fetch(base + '/leave-catalogue', { headers, cache: 'no-store' }),
    fetch(base + '/leave-types', { headers, cache: 'no-store' }),
  ]);
  if (catalogueResponse.status === 403 || listResponse.status === 403) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Leave Policy work. Return to the Dashboard to continue."
      />
    );
  }
  if (!catalogueResponse.ok || !listResponse.ok) {
    throw new Error('Leave Policies could not be loaded.');
  }
  const catalogue: unknown = await catalogueResponse.json();
  const list: unknown = await listResponse.json();
  if (
    typeof catalogue !== 'object' ||
    catalogue === null ||
    !Array.isArray((catalogue as { entries?: unknown }).entries) ||
    typeof list !== 'object' ||
    list === null ||
    !Array.isArray((list as { leaveTypes?: unknown }).leaveTypes)
  ) {
    throw new Error('The Leave Policy response was invalid.');
  }

  return (
    <LeavePolicyWorkspace
      agencyId={session.agencyId}
      canManage={hasPermission(session, 'leave.types.manage')}
      catalogue={catalogue as LeaveCatalogueResponse}
      initial={list as LeaveTypeListResponse}
    />
  );
}
