import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { ShellState } from '../../../components/shell-state';
import {
  AttendanceContextWorkspace,
  type AttendanceContextListResponse,
} from '../../../components/attendance-context-workspace';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Attendance Contexts' };
export const dynamic = 'force-dynamic';

export default async function AttendanceContextsPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'attendance.contexts.read')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Attendance Context work. Return to the Dashboard to continue."
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
  const listResponse = await fetch(base + '/attendance-contexts', { headers, cache: 'no-store' });
  if (listResponse.status === 403) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Attendance Context work. Return to the Dashboard to continue."
      />
    );
  }
  if (!listResponse.ok) {
    throw new Error('Attendance Contexts could not be loaded.');
  }
  const list: unknown = await listResponse.json();
  if (
    typeof list !== 'object' ||
    list === null ||
    !Array.isArray((list as { contexts?: unknown }).contexts)
  ) {
    throw new Error('The Attendance Context response was invalid.');
  }

  return (
    <AttendanceContextWorkspace
      agencyId={session.agencyId}
      canCreate={hasPermission(session, 'attendance.contexts.create')}
      initial={list as AttendanceContextListResponse}
    />
  );
}
