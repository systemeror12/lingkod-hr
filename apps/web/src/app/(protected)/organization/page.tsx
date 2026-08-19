import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import {
  AgencyProfileWorkspace,
  type AgencyProfileResponse,
} from '../../../components/agency-profile-workspace';
import { OrganizationHierarchyPrototype } from '../../../components/organization-hierarchy-prototype';
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

export default async function OrganizationPage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string | string[] }>;
}) {
  const requestedVariant = (await searchParams).variant;
  const prototypeVariant =
    process.env.NODE_ENV !== 'production' &&
    typeof requestedVariant === 'string' &&
    ['A', 'B', 'C'].includes(requestedVariant)
      ? requestedVariant
      : null;
  const session = await getActiveSession();
  const canReadProfile = hasPermission(session, 'organization.agency.read');
  const canReadUnits = hasPermission(session, 'organization.units.read');
  if (!canReadProfile && !canReadUnits) {
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
  const requestOptions = {
    headers: { cookie: cookieStore.toString(), origin: new URL(config.APP_URL).origin },
    cache: 'no-store' as const,
  };

  let profile: AgencyProfileResponse | null = null;
  if (canReadProfile) {
    const profileResponse = await fetch(
      `${config.API_URL}/api/v1/agencies/${session.agencyId}/agency-profile`,
      requestOptions,
    );
    if (profileResponse.status === 403) {
      return (
        <ShellState
          code="403"
          title="You can’t open this page"
          message="Your active Agency Membership does not permit Agency Profile work. Return to the Dashboard to continue."
        />
      );
    }
    if (profileResponse.status === 404) {
      return (
        <ShellState
          code="Not found"
          title="The Agency Profile could not be found"
          message="The Agency Profile surface is not available in this Agency Context."
        />
      );
    }
    if (!profileResponse.ok) throw new Error('Agency Profile could not be loaded.');
    profile = (await profileResponse.json()) as AgencyProfileResponse;
  }

  let initial: OrganizationUnitListResponse | null = null;
  if (canReadUnits) {
    const response = await fetch(
      `${config.API_URL}/api/v1/agencies/${session.agencyId}/organization-units`,
      requestOptions,
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
    initial = (await response.json()) as OrganizationUnitListResponse;
  }

  return (
    <div className="grid min-w-0 gap-12">
      {profile && !prototypeVariant ? (
        <AgencyProfileWorkspace
          agencyId={session.agencyId}
          canUpdate={hasPermission(session, 'organization.agency.update')}
          initial={profile}
        />
      ) : null}
      {initial ? (
        <section className="grid min-w-0 gap-7 border-t border-line pt-10">
          {prototypeVariant ? (
            <OrganizationHierarchyPrototype
              agencyName={session.agency.name}
              drafts={initial.units}
              variant={prototypeVariant}
            />
          ) : (
            <OrganizationWorkspace
              agencyId={session.agencyId}
              canCreate={hasPermission(session, 'organization.units.create')}
              initial={initial}
            />
          )}
        </section>
      ) : null}
    </div>
  );
}
