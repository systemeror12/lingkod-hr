import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { ShellState } from '../../../components/shell-state';
import {
  AttendanceWorkspace,
  type AttendanceEventListResponse,
  type AttendanceWebClockStatus,
} from '../../../components/attendance-workspace';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Attendance' };
export const dynamic = 'force-dynamic';

function hasEvents(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { events?: unknown }).events)
  );
}

function hasWebClock(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { enabled?: unknown }).enabled === 'boolean'
  );
}

export default async function AttendancePage() {
  const session = await getActiveSession();
  const canReadEvents = hasPermission(session, 'attendance.events.read');
  const canCreateManual = hasPermission(session, 'attendance.events.create_manual');
  const canClock = hasPermission(session, 'attendance.events.clock');
  const canConfigure = hasPermission(session, 'attendance.configuration.read');
  if (!canReadEvents && !canCreateManual && !canClock && !canConfigure) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Attendance work. Return to the Dashboard to continue."
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
  const [eventsResponse, webClockResponse] = await Promise.all([
    canReadEvents
      ? fetch(base + '/attendance/events', { headers, cache: 'no-store' })
      : Promise.resolve(null),
    canConfigure
      ? fetch(base + '/attendance/web-clock', { headers, cache: 'no-store' })
      : Promise.resolve(null),
  ]);
  if (eventsResponse?.status === 403 || webClockResponse?.status === 403) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Attendance work. Return to the Dashboard to continue."
      />
    );
  }
  if ((eventsResponse && !eventsResponse.ok) || (webClockResponse && !webClockResponse.ok)) {
    throw new Error('Attendance could not be loaded.');
  }
  const events: unknown = eventsResponse ? await eventsResponse.json() : null;
  const webClock: unknown = webClockResponse ? await webClockResponse.json() : null;
  if ((events !== null && !hasEvents(events)) || (webClock !== null && !hasWebClock(webClock))) {
    throw new Error('The Attendance response was invalid.');
  }

  return (
    <AttendanceWorkspace
      agencyId={session.agencyId}
      canClock={canClock}
      canConfigure={canConfigure}
      canCreateManual={canCreateManual}
      canReadEvents={canReadEvents}
      initialEvents={events as AttendanceEventListResponse | null}
      initialWebClock={webClock as AttendanceWebClockStatus | null}
    />
  );
}
