import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { ShellState } from '../../../components/shell-state';
import {
  MandatoryLeaveWorkspace,
  type MandatoryLeaveLatestResponse,
} from '../../../components/mandatory-leave-workspace';
import { manilaToday } from '../../../lib/manila-date';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Mandatory Leave' };
export const dynamic = 'force-dynamic';

function forbidden() {
  return (
    <ShellState
      code="403"
      title="You can’t open this page"
      message="Your active Agency Membership does not permit reading Mandatory Leave Assessments. Return to the Dashboard to continue."
    />
  );
}

export default async function MandatoryLeavePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getActiveSession();
  if (!hasPermission(session, 'leave.mandatory_assessments.read')) return forbidden();

  const requested = (await searchParams).year;
  const year =
    typeof requested === 'string' && /^\d{4}$/.test(requested)
      ? requested
      : manilaToday().slice(0, 4);

  const config = getConfig();
  const cookieStore = await cookies();
  const headers = {
    cookie: cookieStore.toString(),
    origin: new URL(config.APP_URL).origin,
  };
  const base = config.API_URL + '/api/v1/agencies/' + session.agencyId;
  const response = await fetch(base + '/mandatory-leave-assessments/latest?year=' + year, {
    headers,
    cache: 'no-store',
  });
  if (response.status === 403) return forbidden();
  if (!response.ok) {
    throw new Error('Mandatory Leave Assessments could not be loaded.');
  }
  const latest: unknown = await response.json();
  if (
    typeof latest !== 'object' ||
    latest === null ||
    !Array.isArray((latest as { employees?: unknown }).employees)
  ) {
    throw new Error('The Mandatory Leave Assessment response was invalid.');
  }

  return (
    <MandatoryLeaveWorkspace
      key={year}
      agencyId={session.agencyId}
      canEvaluate={hasPermission(session, 'leave.mandatory_assessments.evaluate')}
      canFile={hasPermission(session, 'leave.applications.create')}
      canRecordForOthers={session.permissions.some(
        (grant) => grant.code === 'leave.applications.create' && grant.scopePolicy === 'AGENCY',
      )}
      initial={latest as MandatoryLeaveLatestResponse}
    />
  );
}
