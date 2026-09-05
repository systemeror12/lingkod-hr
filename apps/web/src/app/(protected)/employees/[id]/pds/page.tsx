import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getConfig } from '@lingkod-hr/config';
import { ShellState } from '../../../../../components/shell-state';
import {
  PdsWorkspace,
  type PdsDetailData,
  type PdsVersionListData,
} from '../../../../../components/pds-workspace';
import { getActiveSession, hasPermission } from '../../../../../lib/session';

export const metadata: Metadata = { title: 'Personal Data Sheet' };
export const dynamic = 'force-dynamic';

function hasAgencyScopedPermission(
  session: Awaited<ReturnType<typeof getActiveSession>>,
  code: string,
): boolean {
  return session.permissions.some((grant) => grant.code === code && grant.scopePolicy === 'AGENCY');
}

export default async function EmployeePdsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getActiveSession();
  if (
    !hasPermission(session, 'personnel.pds.read') ||
    !hasPermission(session, 'personnel.employees.read')
  ) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Employee PDS work. Return to the Dashboard to continue."
      />
    );
  }
  const config = getConfig();
  const cookieStore = await cookies();
  const headers = { cookie: cookieStore.toString(), origin: new URL(config.APP_URL).origin };
  const [employeeResponse, pdsResponse] = await Promise.all([
    fetch(`${config.API_URL}/api/v1/agencies/${session.agencyId}/employees/${id}`, {
      headers,
      cache: 'no-store',
    }),
    fetch(`${config.API_URL}/api/v1/agencies/${session.agencyId}/employees/${id}/pds`, {
      headers,
      cache: 'no-store',
    }),
  ]);
  if (employeeResponse.status === 404 || pdsResponse.status === 404) {
    return (
      <ShellState
        code="Not found"
        title="The Employee PDS could not be found"
        message="The Employee or PDS record is not available in this Agency Context."
      />
    );
  }
  if (employeeResponse.status === 403 || pdsResponse.status === 403) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Employee PDS work. Return to the Dashboard to continue."
      />
    );
  }
  if (!employeeResponse.ok || !pdsResponse.ok)
    throw new Error('The Employee PDS could not be loaded.');
  const employee: unknown = await employeeResponse.json();
  const listValue: unknown = await pdsResponse.json();
  if (
    typeof employee !== 'object' ||
    employee === null ||
    typeof (employee as { legalName?: unknown }).legalName !== 'string' ||
    typeof listValue !== 'object' ||
    listValue === null ||
    typeof (listValue as PdsVersionListData).employeeId !== 'string' ||
    !Array.isArray((listValue as PdsVersionListData).citizenshipCountries) ||
    !Array.isArray((listValue as PdsVersionListData).versions)
  ) {
    throw new Error('The Employee PDS response was invalid.');
  }
  const list = listValue as PdsVersionListData;
  const versionId = list.draft?.id ?? list.current?.id ?? null;
  let detail: PdsDetailData | null = null;
  if (versionId) {
    const detailResponse = await fetch(
      `${config.API_URL}/api/v1/agencies/${session.agencyId}/pds/${versionId}`,
      { headers, cache: 'no-store' },
    );
    if (!detailResponse.ok) throw new Error('The Employee PDS details could not be loaded.');
    const detailValue: unknown = await detailResponse.json();
    if (
      typeof detailValue !== 'object' ||
      detailValue === null ||
      typeof (detailValue as PdsDetailData).id !== 'string'
    ) {
      throw new Error('The Employee PDS details response was invalid.');
    }
    detail = detailValue as PdsDetailData;
  }
  const canAgencyUpdate = hasAgencyScopedPermission(session, 'personnel.pds.update');
  const canAgencyCertify = hasAgencyScopedPermission(session, 'personnel.pds.certify');
  return (
    <PdsWorkspace
      agencyId={session.agencyId}
      employeeName={(employee as { legalName: string }).legalName}
      initialList={list}
      initialDetail={detail}
      canUpdate={canAgencyUpdate}
      canSubmit={false}
      canReturn={canAgencyUpdate}
      canCertify={false}
      canVerify={canAgencyCertify}
      canCorrect={canAgencyUpdate}
      canGenerateOutputs={canAgencyUpdate}
      canBrowseEvidence={hasPermission(session, 'documents.evidence.read')}
      createUrl={`/api/v1/agencies/${session.agencyId}/employees/${id}/pds`}
      backHref={`/employees/${id}`}
    />
  );
}
