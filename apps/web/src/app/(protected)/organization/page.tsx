import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { OrganizationWorkspace } from '../../../components/organization-workspace';
import { ShellState } from '../../../components/shell-state';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Organization' };

interface OrganizationUnit {
  id: string;
  code: string;
  officialName: string;
  unitType: 'DEPARTMENT' | 'BUREAU' | 'SERVICE' | 'DIVISION' | 'SECTION' | 'OFFICE' | 'OTHER';
  effectiveDate: string;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ABOLISHED';
}

interface OrganizationUnitListResponse {
  units: OrganizationUnit[];
}

export const dynamic = 'force-dynamic';

export default async function OrganizationPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'organization.units.read')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Organization work. Return to the Dashboard to continue."
      />
    );
  }

  const config = getConfig();
  const cookieStore = await cookies();
  const response = await fetch(
    `${config.API_URL}/api/v1/agencies/${session.agencyId}/organization-units`,
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
        message="Your active Agency Membership does not permit Organization work. Return to the Dashboard to continue."
      />
    );
  }
  if (response.status === 404) {
    return (
      <ShellState
        code="Not found"
        title="The Organization list could not be found"
        message="The Organization work surface is not available in this Agency Context."
      />
    );
  }
  if (!response.ok) throw new Error('Organization could not be loaded.');
  const initial = (await response.json()) as OrganizationUnitListResponse;
  return (
    <OrganizationWorkspace
      agencyId={session.agencyId}
      canCreate={hasPermission(session, 'organization.units.create')}
      initial={initial}
    />
  );
}
