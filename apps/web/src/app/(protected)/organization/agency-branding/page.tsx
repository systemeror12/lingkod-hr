import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getConfig } from '@lingkod-hr/config';
import {
  AgencyBrandingWorkspace,
  type SavedAgencySeal,
  type SavedBuildingPhoto,
} from '../../../../components/agency-branding-workspace';
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
  const load = async <T,>(path: string, failure: string) => {
    const response = await fetch(
      `${config.API_URL}/api/v1/agencies/${session.agencyId}/agency-profile/${path}`,
      {
        headers: { cookie: cookieStore.toString(), origin: new URL(config.APP_URL).origin },
        cache: 'no-store',
      },
    );
    if (!response.ok) throw new Error(failure);
    return (await response.json()) as T;
  };
  const [{ seal }, { photo }] = await Promise.all([
    load<{ seal: SavedAgencySeal | null }>('seal', 'The Agency seal could not be loaded.'),
    load<{ photo: SavedBuildingPhoto | null }>(
      'building-photo',
      'The building photo could not be loaded.',
    ),
  ]);
  return (
    <AgencyBrandingWorkspace
      agencyId={session.agencyId}
      agency={session.agency}
      initialSeal={seal}
      initialPhoto={photo}
      canUpdate={hasPermission(session, 'organization.agency.update')}
    />
  );
}
