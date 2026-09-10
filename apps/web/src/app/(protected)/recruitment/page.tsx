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
  type VacancyApplication,
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
  const canReadApplications = hasPermission(session, 'recruitment.applications.read');
  if (!canReadRequests && !canReadPublications && !canReadApplications) {
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
  const [requestValue, publicationValue, applicationValue, positionValue, documentValue] =
    await Promise.all([
      canReadRequests
        ? getJson(`${base}/recruitment/requests-to-fill`, cookie, origin)
        : Promise.resolve(null),
      canReadPublications
        ? getJson(`${base}/recruitment/vacancy-publications`, cookie, origin)
        : Promise.resolve(null),
      canReadApplications
        ? getJson(`${base}/recruitment/applications`, cookie, origin)
        : Promise.resolve(null),
      hasPermission(session, 'positions.items.read')
        ? getJson(`${base}/plantilla-positions?asOf=${manilaToday()}`, cookie, origin)
        : Promise.resolve(null),
      hasPermission(session, 'documents.evidence.read')
        ? getJson(`${base}/documents/versions`, cookie, origin)
        : Promise.resolve(null),
    ]);
  const params = await searchParams;
  const initialSection =
    params.section === 'publications'
      ? 'publications'
      : params.section === 'applications'
        ? 'applications'
        : 'requests';
  const initialView =
    params.view === 'kanban'
      ? 'kanban'
      : params.view === 'form'
        ? 'form'
        : params.view === 'tree'
          ? 'tree'
          : 'tree';
  const initialNew =
    params.new === 'request' || params.new === 'publication' || params.new === 'application'
      ? params.new
      : null;

  return (
    <RecruitmentWorkspace
      agencyId={session.agencyId}
      membershipId={session.membershipId}
      displayName={session.identity.displayName}
      initialRequests={arrayValue<RecruitmentRequest>(requestValue, 'requests')}
      initialPublications={arrayValue<VacancyPublication>(publicationValue, 'publications')}
      initialApplications={arrayValue<VacancyApplication>(applicationValue, 'applications')}
      positions={arrayValue<PlantillaPositionOption>(positionValue, 'positions')}
      documents={arrayValue<DocumentOption>(documentValue, 'documents')}
      initialSection={initialSection}
      initialView={initialView}
      initialSelected={params.selected}
      initialNew={initialNew}
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
      canReadApplications={canReadApplications}
      canCreateApplication={hasPermission(session, 'recruitment.applications.create')}
      canUpdateApplication={hasPermission(session, 'recruitment.applications.update')}
      canScreenApplication={hasPermission(session, 'recruitment.applications.screen')}
      canDisqualifyApplication={hasPermission(session, 'recruitment.applications.disqualify')}
      canWithdrawApplication={hasPermission(session, 'recruitment.applications.withdraw')}
      canCloseApplication={hasPermission(session, 'recruitment.applications.close')}
      canManageAssessments={hasPermission(session, 'recruitment.assessments.manage')}
      canManageInterviews={hasPermission(session, 'recruitment.interviews.manage')}
    />
  );
}
