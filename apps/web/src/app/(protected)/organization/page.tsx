import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import {
  AgencyProfileWorkspace,
  type AgencyProfileResponse,
} from '../../../components/agency-profile-workspace';
import { OrganizationWorkspace } from '../../../components/organization-workspace';
import { ShellState } from '../../../components/shell-state';
import { SectionTabLinks } from '../../../components/ui/section-tabs';
import { getActiveSession, hasPermission } from '../../../lib/session';
import { manilaToday } from '../../../lib/manila-date';

export const metadata: Metadata = { title: 'Organization' };

interface OrganizationUnit {
  id: string;
  code: string;
  officialName: string;
  unitType: 'DEPARTMENT' | 'BUREAU' | 'SERVICE' | 'DIVISION' | 'SECTION' | 'OFFICE' | 'OTHER';
  effectiveDate: string;
  effectiveTo: string | null;
  parentUnitId: string | null;
  versionState: 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' | 'VOIDED';
  lifecycleStatus: 'ACTIVE' | 'INACTIVE' | 'ABOLISHED';
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ABOLISHED';
}

interface OrganizationUnitVersion {
  id: string;
  organizationUnitId: string;
  versionNo: number;
  code: string;
  unitType: OrganizationUnit['unitType'];
  officialName: string;
  parentUnitId: string | null;
  costCenterCode: string | null;
  responsibilityCenterCode: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  versionState: 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' | 'VOIDED';
  lifecycleStatus: 'ACTIVE' | 'INACTIVE' | 'ABOLISHED';
}

interface OrganizationUnitListResponse {
  units: OrganizationUnit[];
  drafts?: OrganizationUnitVersion[];
}

interface OrganizationHierarchyResponse {
  asOf: string;
  eligibleParentIds: string[];
  units: Array<{
    id: string;
    code: string;
    officialName: string;
    unitType: OrganizationUnit['unitType'];
    parentUnitId: string | null;
    effectiveFrom: string;
    effectiveTo: string | null;
    lifecycleStatus: OrganizationUnit['lifecycleStatus'];
    childCount: number;
  }>;
}

export const dynamic = 'force-dynamic';

export default async function OrganizationPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string | string[]; workspace?: string }>;
}) {
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

  const showProfile =
    canReadProfile && ((await searchParams).workspace === 'agency' || !canReadUnits);
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
  let initialHierarchy: OrganizationHierarchyResponse | null = null;
  if (canReadUnits) {
    const requestedAsOf = (await searchParams).asOf;
    const parsedAsOf =
      typeof requestedAsOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(requestedAsOf)
        ? new Date(`${requestedAsOf}T00:00:00.000Z`)
        : null;
    const asOf =
      parsedAsOf &&
      !Number.isNaN(parsedAsOf.getTime()) &&
      parsedAsOf.toISOString().slice(0, 10) === requestedAsOf
        ? requestedAsOf
        : manilaToday();
    const [response, hierarchyResponse] = await Promise.all([
      fetch(
        `${config.API_URL}/api/v1/agencies/${session.agencyId}/organization-units`,
        requestOptions,
      ),
      fetch(
        `${config.API_URL}/api/v1/agencies/${session.agencyId}/organization-units/hierarchy?asOf=${asOf}`,
        requestOptions,
      ),
    ]);
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
    if (!hierarchyResponse.ok) throw new Error('Organization hierarchy could not be loaded.');
    initial = (await response.json()) as OrganizationUnitListResponse;
    initialHierarchy = (await hierarchyResponse.json()) as OrganizationHierarchyResponse;
  }

  const tabs = (
    <SectionTabLinks
      label="Organization workspace"
      tabs={[
        ...(canReadUnits
          ? [{ href: '/organization', label: 'Organization Units', current: !showProfile }]
          : []),
        ...(canReadProfile
          ? [
              {
                href: '/organization?workspace=agency',
                label: 'Agency Profile',
                current: showProfile,
              },
            ]
          : []),
      ]}
    />
  );

  return profile && showProfile ? (
    <AgencyProfileWorkspace
      agencyId={session.agencyId}
      canUpdate={hasPermission(session, 'organization.agency.update')}
      initial={profile}
      tabs={tabs}
    />
  ) : initial && initialHierarchy ? (
    <OrganizationWorkspace
      key={initialHierarchy.asOf}
      agencyId={session.agencyId}
      canAbolish={hasPermission(session, 'organization.units.abolish')}
      canActivate={hasPermission(session, 'organization.units.activate')}
      canCreate={hasPermission(session, 'organization.units.create')}
      canInactivate={hasPermission(session, 'organization.units.inactivate')}
      canUpdate={hasPermission(session, 'organization.units.update')}
      initial={initial}
      initialHierarchy={initialHierarchy}
      tabs={tabs}
    />
  ) : null;
}
