import type { Metadata } from 'next';
import { AuthorizedPlaceholder } from '../../../components/authorized-placeholder';

export const metadata: Metadata = { title: 'Users & Access' };

export default function UsersAccessPage() {
  return (
    <AuthorizedPlaceholder
      permission="security.users.read"
      code="Users & Access"
      title="No access work is waiting"
      message="Authorized invitations and membership tasks will appear here when they need attention."
    />
  );
}
