import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getConfig } from '@lingkod-hr/config';
import { getActiveSession, hasPermission } from '../../../lib/session';
import { manilaToday } from '../../../lib/manila-date';
import { ShellState } from '../../../components/shell-state';
import {
  PlantillaPositionWorkspace,
  type PlantillaPositionListResponse,
} from '../../../components/plantilla-position-workspace';

export const metadata: Metadata = { title: 'Plantilla Positions' };
export const dynamic = 'force-dynamic';

export default async function PlantillaPositionsPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'positions.items.read')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Plantilla Position work. Return to the Dashboard to continue."
      />
    );
  }
  const config = getConfig();
  const cookieStore = await cookies();
  const response = await fetch(
    `${config.API_URL}/api/v1/agencies/${session.agencyId}/plantilla-positions?asOf=${manilaToday()}`,
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
        message="Your active Agency Membership does not permit Plantilla Position work. Return to the Dashboard to continue."
      />
    );
  }
  if (response.status === 404) {
    return (
      <ShellState
        code="Not found"
        title="The Plantilla Position catalog could not be found"
        message="The Plantilla Position catalog is not available in this Agency Context."
      />
    );
  }
  if (!response.ok) throw new Error('Plantilla Positions could not be loaded.');
  const value: unknown = await response.json();
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as { positions?: unknown }).positions)
  ) {
    throw new Error('The Plantilla Position response was invalid.');
  }
  return (
    <PlantillaPositionWorkspace
      agencyId={session.agencyId}
      initial={value as PlantillaPositionListResponse}
      canCreate={hasPermission(session, 'positions.items.create')}
      canUpdate={hasPermission(session, 'positions.items.update')}
    />
  );
}
