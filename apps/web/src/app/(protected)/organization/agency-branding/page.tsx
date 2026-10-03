import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getConfig } from '@lingkod-hr/config';
import {
  AgencySealWorkspace,
  type SavedAgencySeal,
} from '../../../../components/agency-seal-workspace';
import { ShellState } from '../../../../components/shell-state';
import { getActiveSession, hasPermission } from '../../../../lib/session';

export const metadata: Metadata = { title: 'Seal and building photo' };

export default async function AgencyBrandingPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'organization.agency.read')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Agency Profile work."
      />
    );
  }
  const config = getConfig();
  const cookieStore = await cookies();
  const response = await fetch(
    `${config.API_URL}/api/v1/agencies/${session.agencyId}/agency-profile/seal`,
    {
      headers: { cookie: cookieStore.toString(), origin: new URL(config.APP_URL).origin },
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error('The Agency seal could not be loaded.');
  const initial = (await response.json()) as { seal: SavedAgencySeal | null };
  return (
    <AgencySealWorkspace
      agencyId={session.agencyId}
      agency={session.agency}
      initial={initial.seal}
      canUpdate={hasPermission(session, 'organization.agency.update')}
    />
  );
}
