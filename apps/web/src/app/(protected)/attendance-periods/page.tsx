import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { ShellState } from '../../../components/shell-state';
import { AttendancePeriodsWorkspace } from '../../../components/attendance-periods-workspace';
import type { AttendancePeriodListResponse } from '../../../components/dtrs-workspace';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Attendance Periods' };
export const dynamic = 'force-dynamic';

function hasPeriods(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { periods?: unknown }).periods)
  );
}

export default async function AttendancePeriodsPage() {
  const session = await getActiveSession();
  const canRead = hasPermission(session, 'attendance.reports.read');
  const canSubmit = hasPermission(session, 'attendance.periods.submit');
  const canReturn = hasPermission(session, 'attendance.periods.return');
  const canApprove = hasPermission(session, 'attendance.periods.approve');
  const canLock = hasPermission(session, 'attendance.periods.lock');
  const canReadPublication = hasPermission(session, 'attendance.payroll_publications.read');
  if (!canRead && !canSubmit && !canReturn && !canApprove && !canLock) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Attendance Period review or lock work. Return to the Dashboard to continue."
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
  const periodsResponse = canRead
    ? await fetch(base + '/attendance-periods', { headers, cache: 'no-store' })
    : null;
  if (periodsResponse?.status === 403) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Attendance Period review work. Return to the Dashboard to continue."
      />
    );
  }
  if (periodsResponse && !periodsResponse.ok) {
    throw new Error('Attendance Periods could not be loaded.');
  }
  const periods: unknown = periodsResponse ? await periodsResponse.json() : null;
  if (periods !== null && !hasPeriods(periods)) {
    throw new Error('The Attendance Period response was invalid.');
  }

  return (
    <AttendancePeriodsWorkspace
      agencyId={session.agencyId}
      canApprove={canApprove}
      canLock={canLock}
      canRead={canRead}
      canReadPublication={canReadPublication}
      canReturn={canReturn}
      canSubmit={canSubmit}
      initialPeriods={(periods as AttendancePeriodListResponse | null) ?? { periods: [] }}
    />
  );
}
