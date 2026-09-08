import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getConfig } from '@lingkod-hr/config';
import { getActiveSession, hasPermission } from '../../../lib/session';
import { manilaToday } from '../../../lib/manila-date';
import { ShellState } from '../../../components/shell-state';
import {
  RecruitmentWorkspace,
  type DocumentOption,
  type PlantillaPositionOption,
  type RecruitmentRequest,
  type VacancyPublication,
} from '../../../components/recruitment-workspace';

export const metadata: Metadata = { title: 'Recruitment' };
export const dynamic = 'force-dynamic';

async function getJson(url: string, cookie: string, origin: string): Promise<unknown | null> {
  const response = await fetch(url, {
    headers: { cookie, origin },
    cache: 'no-store',
  });
  if (response.status === 403 || response.status === 404) return null;
  if (!response.ok) throw new Error('The Recruitment workspace could not be loaded.');
  return response.json();
}

function arrayValue<T>(value: unknown, key: string): T[] {
  if (typeof value !== 'object' || value === null) return [];
  const result = (value as Record<string, unknown>)[key];
  return Array.isArray(result) ? (result as T[]) : [];
}

export default async function RecruitmentPage({
  searchParams,
}: {
  searchParams: Promise<{
    section?: string;
    view?: string;
    selected?: string;
    new?: string;
  }>;
}) {
  const session = await getActiveSession();
  const canReadRequests = hasPermission(session, 'recruitment.requests.read');
  const canReadPublications = hasPermission(session, 'recruitment.vacancies.read');
  if (!canReadRequests && !canReadPublications) {
    return (
      <ShellState
        code="403"
        title="You can’t open Recruitment"
        message="Your active Agency Membership does not permit Recruitment work. Return to the Dashboard to continue."
      />
    );
  }

  const config = getConfig();
  const cookie = (await cookies()).toString();
  const origin = new URL(config.APP_URL).origin;
  const base = `${config.API_URL}/api/v1/agencies/${session.agencyId}`;
  const [requestValue, publicationValue, positionValue, documentValue] = await Promise.all([
    canReadRequests
      ? getJson(`${base}/recruitment/requests-to-fill`, cookie, origin)
      : Promise.resolve(null),
    canReadPublications
      ? getJson(`${base}/recruitment/vacancy-publications`, cookie, origin)
      : Promise.resolve(null),
    hasPermission(session, 'positions.items.read')
      ? getJson(`${base}/plantilla-positions?asOf=${manilaToday()}`, cookie, origin)
      : Promise.resolve(null),
    hasPermission(session, 'documents.evidence.read')
      ? getJson(`${base}/documents/versions`, cookie, origin)
      : Promise.resolve(null),
  ]);
  const params = await searchParams;

  return (
    <RecruitmentWorkspace
      agencyId={session.agencyId}
      displayName={session.identity.displayName}
      initialRequests={arrayValue<RecruitmentRequest>(requestValue, 'requests')}
      initialPublications={arrayValue<VacancyPublication>(publicationValue, 'publications')}
      positions={arrayValue<PlantillaPositionOption>(positionValue, 'positions')}
      documents={arrayValue<DocumentOption>(documentValue, 'documents')}
      initialSection={params.section === 'publications' ? 'publications' : 'requests'}
      initialView={params.view === 'form' ? 'form' : 'tree'}
      initialSelected={params.selected}
      initialNew={params.new === 'request' || params.new === 'publication' ? params.new : null}
      canCreateRequest={hasPermission(session, 'recruitment.requests.create')}
      canSubmitRequest={hasPermission(session, 'recruitment.requests.submit')}
      canReviewRequest={hasPermission(session, 'recruitment.requests.review')}
      canRebaselineRequest={hasPermission(session, 'recruitment.requests.rebaseline')}
      canApproveRequest={hasPermission(session, 'recruitment.requests.approve')}
      canRejectRequest={hasPermission(session, 'recruitment.requests.reject')}
      canCancelRequest={hasPermission(session, 'recruitment.requests.cancel')}
      canCloseRequest={hasPermission(session, 'recruitment.requests.close')}
      canCreatePublication={hasPermission(session, 'recruitment.vacancies.create')}
      canSubmitPublication={hasPermission(session, 'recruitment.vacancies.submit')}
      canPublishPublication={hasPermission(session, 'recruitment.vacancies.publish')}
      canClosePublication={hasPermission(session, 'recruitment.vacancies.close')}
      canCancelPublication={hasPermission(session, 'recruitment.vacancies.cancel')}
      canRepublishPublication={hasPermission(session, 'recruitment.vacancies.republish')}
      canReadRequests={canReadRequests}
      canReadPublications={canReadPublications}
    />
  );
}
