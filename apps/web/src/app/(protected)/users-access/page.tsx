import type { Metadata } from 'next';
import { ShellState } from '../../../components/shell-state';
import { canManageHrmoInvitations } from '../../../lib/navigation';
import { getActiveSession } from '../../../lib/session';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { InvitationPanel } from './invitation-panel';

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

export default async function UsersAccessPage() {
  const session = await getActiveSession();
  if (!canManageHrmoInvitations(session)) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit invitation and role assignment work."
      />
    );
  }

  const config = getConfig();
  const cookieStore = await cookies();
  const response = await fetch(
    `${config.API_URL}/api/v1/agencies/${session.agencyId}/invitations`,
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
        message="Your active Agency Membership does not permit invitation and role assignment work."
      />
    );
  }
  if (!response.ok) throw new Error('Users & Access could not be loaded.');
  const initial = (await response.json()) as PendingInvitationResponse;
  return <InvitationPanel agencyId={session.agencyId} initial={initial} />;
}
