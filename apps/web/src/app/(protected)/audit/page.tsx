import type { Metadata } from 'next';
import { ShellState } from '../../../components/shell-state';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Audit Log' };

export default async function AuditPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'audit.events.read')) {
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
      code="Audit Log"
      title="No activity selected"
      message="Authorized Agency activity will be available for read-only review from this workspace."
    />
  );
}
