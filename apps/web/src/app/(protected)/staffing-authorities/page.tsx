import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { ShellState } from '../../../components/shell-state';
import {
  StaffingAuthorityWorkspace,
  type StaffingAuthorityListResponse,
} from '../../../components/staffing-authority-workspace';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Staffing Authorities' };
export const dynamic = 'force-dynamic';

export default async function StaffingAuthoritiesPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'staffing.authorities.read')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Staffing Authority work. Return to the Dashboard to continue."
      />
    );
  }

  const config = getConfig();
  const cookieStore = await cookies();
  const response = await fetch(
    `${config.API_URL}/api/v1/agencies/${session.agencyId}/staffing-authorities`,
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
        message="Your active Agency Membership does not permit Staffing Authority work. Return to the Dashboard to continue."
      />
    );
  }
  if (response.status === 404) {
    return (
      <ShellState
        code="Not found"
        title="The Staffing Authority register could not be found"
        message="The Staffing Authority register is not available in this Agency Context."
      />
    );
  }
  if (!response.ok) throw new Error('Staffing Authorities could not be loaded.');
  const value: unknown = await response.json();
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as { authorities?: unknown }).authorities)
  ) {
    throw new Error('The Staffing Authority response was invalid.');
  }

  return (
    <StaffingAuthorityWorkspace
      agencyId={session.agencyId}
      initial={value as StaffingAuthorityListResponse}
      canCreate={hasPermission(session, 'staffing.authorities.create')}
      canUpdate={hasPermission(session, 'staffing.authorities.update')}
      canValidateEvidence={hasPermission(session, 'staffing.authorities.evidence.validate')}
      canActivate={hasPermission(session, 'staffing.authorities.activate')}
      canSupersede={hasPermission(session, 'staffing.authorities.supersede')}
      canRevoke={hasPermission(session, 'staffing.authorities.revoke')}
    />
  );
}
