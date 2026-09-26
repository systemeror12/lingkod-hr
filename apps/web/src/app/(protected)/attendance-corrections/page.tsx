import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { ShellState } from '../../../components/shell-state';
import {
  AttendanceCorrectionsWorkspace,
  type AttendanceCorrectionListResponse,
} from '../../../components/attendance-corrections-workspace';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Attendance Corrections' };
export const dynamic = 'force-dynamic';

function hasCorrections(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { corrections?: unknown }).corrections)
  );
}

export default async function AttendanceCorrectionsPage() {
  const session = await getActiveSession();
  const canRead = hasPermission(session, 'attendance.days.read');
  const canCreate = hasPermission(session, 'attendance.corrections.create');
  const canSubmit = hasPermission(session, 'attendance.corrections.submit');
  const canApprove = hasPermission(session, 'attendance.corrections.approve');
  const canReturn = hasPermission(session, 'attendance.corrections.return');
  const canReject = hasPermission(session, 'attendance.corrections.reject');
  const canAuthorizeLocked = hasPermission(session, 'attendance.corrections.authorize_locked');
  const canCancel = hasPermission(session, 'attendance.corrections.cancel');
  if (!canRead && !canCreate) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Attendance Correction work. Return to the Dashboard to continue."
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
  const response = canRead
    ? await fetch(base + '/attendance-corrections', { headers, cache: 'no-store' })
    : null;
  if (response?.status === 403) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Attendance Correction work. Return to the Dashboard to continue."
      />
    );
  }
  if (response && !response.ok) {
    throw new Error('Attendance Corrections could not be loaded.');
  }
  const corrections: unknown = response ? await response.json() : null;
  if (corrections !== null && !hasCorrections(corrections)) {
    throw new Error('The Attendance Correction response was invalid.');
  }

  return (
    <AttendanceCorrectionsWorkspace
      agencyId={session.agencyId}
      canCreate={canCreate}
      canSubmit={canSubmit}
      canApprove={canApprove}
      canReturn={canReturn}
      canReject={canReject}
      canAuthorizeLocked={canAuthorizeLocked}
      canCancel={canCancel}
      initialCorrections={
        (corrections as AttendanceCorrectionListResponse | null) ?? { corrections: [] }
      }
    />
  );
}
