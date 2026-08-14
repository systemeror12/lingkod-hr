import type { Metadata } from 'next';
import { ShellState } from '../../../components/shell-state';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Organization' };

export default async function OrganizationPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'organization.units.read')) {
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
      code="Organization"
      title="No Organization Units yet"
      message="Draft Organization Units created in this Agency Context will appear here."
    />
  );
}
