import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { ShellState } from '../../../components/shell-state';
import {
  AttendanceConfigurationWorkspace,
  type HolidayCalendarListResponse,
  type WorkArrangementListResponse,
  type WorkScheduleListResponse,
} from '../../../components/attendance-configuration-workspace';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Attendance Configuration' };
export const dynamic = 'force-dynamic';

function hasItems(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

export default async function AttendanceConfigurationPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'attendance.configuration.manage')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Attendance Configuration work. Return to the Dashboard to continue."
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
  const [schedulesResponse, arrangementsResponse, calendarsResponse] = await Promise.all([
    fetch(base + '/work-schedules', { headers, cache: 'no-store' }),
    fetch(base + '/work-arrangements', { headers, cache: 'no-store' }),
    fetch(base + '/holiday-calendars', { headers, cache: 'no-store' }),
  ]);
  if (
    schedulesResponse.status === 403 ||
    arrangementsResponse.status === 403 ||
    calendarsResponse.status === 403
  ) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Attendance Configuration work. Return to the Dashboard to continue."
      />
    );
  }
  if (!schedulesResponse.ok || !arrangementsResponse.ok || !calendarsResponse.ok) {
    throw new Error('Attendance Configuration could not be loaded.');
  }
  const schedules: unknown = await schedulesResponse.json();
  const arrangements: unknown = await arrangementsResponse.json();
  const calendars: unknown = await calendarsResponse.json();
  if (!hasItems(schedules) || !hasItems(arrangements) || !hasItems(calendars)) {
    throw new Error('The Attendance Configuration response was invalid.');
  }

  return (
    <AttendanceConfigurationWorkspace
      agencyId={session.agencyId}
      arrangements={(arrangements as WorkArrangementListResponse).items}
      calendars={(calendars as HolidayCalendarListResponse).items}
      canActivate={hasPermission(session, 'attendance.configuration.activate')}
      canAssign={hasPermission(session, 'attendance.assignments.manage')}
      canManage={hasPermission(session, 'attendance.configuration.manage')}
      schedules={(schedules as WorkScheduleListResponse).items}
    />
  );
}
