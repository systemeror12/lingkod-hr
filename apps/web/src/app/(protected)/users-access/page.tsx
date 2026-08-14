import type { Metadata } from 'next';
import { ShellState } from '../../../components/shell-state';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Users & Access' };

export default async function UsersAccessPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'security.users.read')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit this work. Return to the Dashboard to continue."
      />
    );
  }
  return (
    <ShellState
      code="Users & Access"
      title="No access work is waiting"
      message="Authorized invitations and membership tasks will appear here when they need attention."
    />
  );
}
