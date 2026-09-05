import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getConfig } from '@lingkod-hr/config';
import { ShellState } from '../../../components/shell-state';
import {
  PdsWorkspace,
  type PdsDetailData,
  type PdsVersionListData,
} from '../../../components/pds-workspace';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'My Personal Data Sheet' };
export const dynamic = 'force-dynamic';

function hasScopedPermission(
  session: Awaited<ReturnType<typeof getActiveSession>>,
  code: string,
  scopePolicy: 'AGENCY' | 'OWN',
): boolean {
  return session.permissions.some(
    (grant) => grant.code === code && grant.scopePolicy === scopePolicy,
  );
}

export default async function MyPdsPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'personnel.pds.read')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit personal PDS work. Return to the Dashboard to continue."
      />
    );
  }
  const config = getConfig();
  const cookieStore = await cookies();
  const headers = { cookie: cookieStore.toString(), origin: new URL(config.APP_URL).origin };
  const listResponse = await fetch(`${config.API_URL}/api/v1/agencies/${session.agencyId}/my-pds`, {
    headers,
    cache: 'no-store',
  });
  if (listResponse.status === 404) {
    return (
      <ShellState
        code="Not found"
        title="No Employee link is available"
        message="Link your Agency Membership to an Employee record before creating a personal PDS."
      />
    );
  }
  if (listResponse.status === 403) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit personal PDS work. Return to the Dashboard to continue."
      />
    );
  }
  if (!listResponse.ok) throw new Error('Your PDS could not be loaded.');
  const listValue: unknown = await listResponse.json();
  if (
    typeof listValue !== 'object' ||
    listValue === null ||
    typeof (listValue as PdsVersionListData).employeeId !== 'string' ||
    !Array.isArray((listValue as PdsVersionListData).citizenshipCountries) ||
    !Array.isArray((listValue as PdsVersionListData).versions)
  ) {
    throw new Error('Your PDS response was invalid.');
  }
  const list = listValue as PdsVersionListData;
  const versionId = list.draft?.id ?? list.current?.id ?? null;
  let detail: PdsDetailData | null = null;
  if (versionId) {
    const detailResponse = await fetch(
      `${config.API_URL}/api/v1/agencies/${session.agencyId}/pds/${versionId}`,
      { headers, cache: 'no-store' },
    );
    if (!detailResponse.ok) throw new Error('Your PDS details could not be loaded.');
    const detailValue: unknown = await detailResponse.json();
    if (
      typeof detailValue !== 'object' ||
      detailValue === null ||
      typeof (detailValue as PdsDetailData).id !== 'string'
    ) {
      throw new Error('Your PDS details response was invalid.');
    }
    detail = detailValue as PdsDetailData;
  }
  const canUpdateOwn =
    hasScopedPermission(session, 'personnel.pds.update', 'AGENCY') ||
    hasScopedPermission(session, 'personnel.pds.update', 'OWN');
  const canAgencyUpdate = hasScopedPermission(session, 'personnel.pds.update', 'AGENCY');
  const canOwnCertify = hasScopedPermission(session, 'personnel.pds.certify', 'OWN');
  const canAgencyCertify = hasScopedPermission(session, 'personnel.pds.certify', 'AGENCY');
  return (
    <PdsWorkspace
      agencyId={session.agencyId}
      initialList={list}
      initialDetail={detail}
      canUpdate={canUpdateOwn}
      canSubmit={hasScopedPermission(session, 'personnel.pds.update', 'OWN')}
      canReturn={canAgencyUpdate}
      canCertify={canOwnCertify}
      canVerify={canAgencyCertify}
      canCorrect={canUpdateOwn}
      canGenerateOutputs={canAgencyUpdate}
      canBrowseEvidence={hasPermission(session, 'documents.evidence.read')}
      createUrl={`/api/v1/agencies/${session.agencyId}/my-pds`}
      backHref="/dashboard"
    />
  );
}
