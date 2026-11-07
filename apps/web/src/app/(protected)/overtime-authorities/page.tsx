import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { ShellState } from '../../../components/shell-state';
import {
  OvertimeAuthorityWorkspace,
  type OvertimeAuthorityListResponse,
} from '../../../components/overtime-authority-workspace';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Overtime Authorities' };
export const dynamic = 'force-dynamic';

const denied = (
  <ShellState
    code="403"
    title="You can’t open this page"
    message="Your active Agency Membership does not permit reading Overtime Authorities. Return to the Dashboard to continue."
  />
);

export default async function OvertimeAuthoritiesPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'overtime.authorities.read')) return denied;

  const config = getConfig();
  const cookieStore = await cookies();
  const response = await fetch(
    config.API_URL + '/api/v1/agencies/' + session.agencyId + '/overtime-authorities',
    {
      headers: { cookie: cookieStore.toString(), origin: new URL(config.APP_URL).origin },
      cache: 'no-store',
    },
  );
  if (response.status === 403) return denied;
  if (!response.ok) throw new Error('Overtime Authorities could not be loaded.');
  const list: unknown = await response.json();
  if (
    typeof list !== 'object' ||
    list === null ||
    !Array.isArray((list as { authorities?: unknown }).authorities)
  ) {
    throw new Error('The Overtime Authority response was invalid.');
  }

  return (
    <OvertimeAuthorityWorkspace
      agencyId={session.agencyId}
      initial={list as OvertimeAuthorityListResponse}
      canCreate={hasPermission(session, 'overtime.authorities.create')}
      canSubmit={hasPermission(session, 'overtime.authorities.submit')}
      canCancel={hasPermission(session, 'overtime.authorities.cancel')}
      canReview={hasPermission(session, 'overtime.authorities.review')}
      canApprove={hasPermission(session, 'overtime.authorities.approve')}
      canReject={hasPermission(session, 'overtime.authorities.reject')}
      canRecordService={hasPermission(session, 'overtime.service.record')}
      canSubmitService={hasPermission(session, 'overtime.service.submit')}
      canCertifyService={hasPermission(session, 'overtime.service.certify')}
      canDeclineService={hasPermission(session, 'overtime.service.reject')}
      canReadCocBalance={hasPermission(session, 'overtime.coc.read')}
      canReadCocCertificates={
        hasPermission(session, 'overtime.coc_certificates.prepare') ||
        hasPermission(session, 'overtime.coc_certificates.approve')
      }
      canPrepareCocCertificates={hasPermission(session, 'overtime.coc_certificates.prepare')}
      canApproveCocCertificates={hasPermission(session, 'overtime.coc_certificates.approve')}
      canListEmployees={
        hasPermission(session, 'personnel.employees.read') &&
        hasPermission(session, 'organization.units.read')
      }
    />
  );
}
