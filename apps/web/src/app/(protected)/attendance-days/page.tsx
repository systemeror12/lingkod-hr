import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { ShellState } from '../../../components/shell-state';
import {
  AttendanceDaysWorkspace,
  type AttendanceDayListResponse,
  type AttendancePeriodListResponse,
} from '../../../components/attendance-days-workspace';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Attendance Days' };
export const dynamic = 'force-dynamic';

function hasDays(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && Array.isArray((value as { days?: unknown }).days)
  );
}

function hasPeriods(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { periods?: unknown }).periods)
  );
}

export default async function AttendanceDaysPage() {
  const session = await getActiveSession();
  const canRead = hasPermission(session, 'attendance.days.read');
  const canCalculate = hasPermission(session, 'attendance.days.calculate');
  if (!canRead && !canCalculate) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Attendance Day work. Return to the Dashboard to continue."
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
  const [daysResponse, periodsResponse] = await Promise.all([
    canRead
      ? fetch(base + '/attendance-days', { headers, cache: 'no-store' })
      : Promise.resolve(null),
    canRead
      ? fetch(base + '/attendance-periods', { headers, cache: 'no-store' })
      : Promise.resolve(null),
  ]);
  if (daysResponse?.status === 403 || periodsResponse?.status === 403) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Attendance Day work. Return to the Dashboard to continue."
      />
    );
  }
  if ((daysResponse && !daysResponse.ok) || (periodsResponse && !periodsResponse.ok)) {
    throw new Error('Attendance Days could not be loaded.');
  }
  const days: unknown = daysResponse ? await daysResponse.json() : null;
  const periods: unknown = periodsResponse ? await periodsResponse.json() : null;
  if ((days !== null && !hasDays(days)) || (periods !== null && !hasPeriods(periods))) {
    throw new Error('The Attendance Day response was invalid.');
  }

  return (
    <AttendanceDaysWorkspace
      agencyId={session.agencyId}
      canCalculate={canCalculate}
      canRead={canRead}
      initialDays={(days as AttendanceDayListResponse | null) ?? { days: [] }}
      initialPeriods={(periods as AttendancePeriodListResponse | null) ?? { periods: [] }}
    />
  );
}
