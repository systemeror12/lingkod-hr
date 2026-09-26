import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { ShellState } from '../../../components/shell-state';
import {
  DtrsWorkspace,
  type AttendancePeriodListResponse,
  type DtrDocumentListResponse,
} from '../../../components/dtrs-workspace';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Daily Time Records' };
export const dynamic = 'force-dynamic';

function hasPeriods(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { periods?: unknown }).periods)
  );
}

function hasDtrs(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && Array.isArray((value as { dtrs?: unknown }).dtrs)
  );
}

export default async function AttendanceDtrsPage() {
  const session = await getActiveSession();
  const canReadDays = hasPermission(session, 'attendance.days.read');
  const canReadReports = hasPermission(session, 'attendance.reports.read');
  const canCreate = hasPermission(session, 'attendance.submissions.create');
  const canCreateOnBehalf = hasPermission(session, 'attendance.submissions.create_on_behalf');
  const canSubmit = hasPermission(session, 'attendance.submissions.submit');
  const canReturn = hasPermission(session, 'attendance.submissions.return');
  const canApprove = hasPermission(session, 'attendance.submissions.approve');
  const canCancel = hasPermission(session, 'attendance.submissions.cancel');
  const canGenerate = hasPermission(session, 'attendance.dtr.generate');
  if (!canReadDays && !canReadReports && !canCreate) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Daily Time Record work. Return to the Dashboard to continue."
      />
    );
  }

  const config = getConfig();
  const cookieStore = await cookies();
  const headers = {
    cookie: cookieStore.toString(),
    origin: new URL(config.APP_URL).origin,
  };
  const base = config.API_URL + '/api/v1/agencies/' + session.agencyId;
  const [periodsResponse, dtrsResponse] = await Promise.all([
    canReadDays
      ? fetch(base + '/attendance-periods', { headers, cache: 'no-store' })
      : Promise.resolve(null),
    canReadReports ? fetch(base + '/dtrs', { headers, cache: 'no-store' }) : Promise.resolve(null),
  ]);
  if (periodsResponse?.status === 403 || dtrsResponse?.status === 403) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Daily Time Record work. Return to the Dashboard to continue."
      />
    );
  }
  if ((periodsResponse && !periodsResponse.ok) || (dtrsResponse && !dtrsResponse.ok)) {
    throw new Error('Daily Time Records could not be loaded.');
  }
  const periods: unknown = periodsResponse ? await periodsResponse.json() : null;
  const dtrs: unknown = dtrsResponse ? await dtrsResponse.json() : null;
  if ((periods !== null && !hasPeriods(periods)) || (dtrs !== null && !hasDtrs(dtrs))) {
    throw new Error('The Daily Time Record response was invalid.');
  }

  return (
    <DtrsWorkspace
      agencyId={session.agencyId}
      canApprove={canApprove}
      canCancel={canCancel}
      canCreate={canCreate}
      canCreateOnBehalf={canCreateOnBehalf}
      canGenerate={canGenerate}
      canReadDays={canReadDays}
      canReadReports={canReadReports}
      canReturn={canReturn}
      canSubmit={canSubmit}
      initialDtrs={(dtrs as DtrDocumentListResponse | null) ?? { dtrs: [] }}
      initialPeriods={(periods as AttendancePeriodListResponse | null) ?? { periods: [] }}
    />
  );
}
