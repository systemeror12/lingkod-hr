import type { Metadata } from 'next';
import { ShellState } from '../../../components/shell-state';
import { PageHeader } from '../../../components/ui/page-header';
import { canManageHrmoInvitations, hasPermission } from '../../../lib/navigation';
import { getActiveSession } from '../../../lib/session';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { InvitationPanel } from './invitation-panel';
import { type AgencyMember, MemberList } from './member-list';

export const metadata: Metadata = { title: 'Users & Access' };

export const dynamic = 'force-dynamic';

interface PendingInvitationResponse {
  pendingCount: number;
  hasMore: boolean;
  invitations: Array<{
    id: string;
    email: string;
    roleCode: string | null;
    expiresAt: string;
    status: 'PENDING';
  }>;
}

function forbidden() {
  return (
    <ShellState
      code="403"
      title="You can’t open this page"
      message="Your active Agency Membership does not permit reading Users & Access."
    />
  );
}

export default async function UsersAccessPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'security.users.read')) return forbidden();

  const config = getConfig();
  const cookieStore = await cookies();
  const read = (path: string) =>
    fetch(`${config.API_URL}/api/v1/agencies/${session.agencyId}/${path}`, {
      headers: { cookie: cookieStore.toString(), origin: new URL(config.APP_URL).origin },
      cache: 'no-store',
    });
  const invitesUsers = canManageHrmoInvitations(session);
  const [membersResponse, invitationsResponse] = await Promise.all([
    read('members'),
    invitesUsers ? read('invitations') : null,
  ]);
  if (membersResponse.status === 403 || invitationsResponse?.status === 403) return forbidden();
  if (!membersResponse.ok || (invitationsResponse && !invitationsResponse.ok)) {
    throw new Error('Users & Access could not be loaded.');
  }
  const { members } = (await membersResponse.json()) as { members: AgencyMember[] };
  const invitations = invitationsResponse
    ? ((await invitationsResponse.json()) as PendingInvitationResponse)
    : null;

  return (
    <div className="grid gap-5">
      {invitations ? (
        <InvitationPanel agencyId={session.agencyId} initial={invitations} />
      ) : (
        <PageHeader
          breadcrumbs={[{ label: 'Oversight' }, { label: 'Users & Access' }]}
          title="Users & Access"
        />
      )}
      <MemberList
        agencyId={session.agencyId}
        currentUserId={session.userId}
        canResetFactor={hasPermission(session, 'security.mfa.reset_factor')}
        canLock={hasPermission(session, 'security.users.lock')}
        canUnlock={hasPermission(session, 'security.users.unlock')}
        initial={members}
      />
    </div>
  );
}
