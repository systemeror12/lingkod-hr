import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getConfig } from '@lingkod-hr/config';
import { getActiveSession, hasPermission } from '../../../lib/session';
import { ShellState } from '../../../components/shell-state';
import {
  AppointmentsWorkspace,
  type AppointmentSettings,
  type AppointmentSummary,
  type DocumentVersionOption,
  type EligibleSelection,
} from '../../../components/appointments-workspace';

export const metadata: Metadata = { title: 'Appointments' };
export const dynamic = 'force-dynamic';

async function getJson(url: string, cookie: string, origin: string): Promise<unknown | null> {
  const response = await fetch(url, {
    headers: { cookie, origin },
    cache: 'no-store',
  });
  if (response.status === 403 || response.status === 404) return null;
  if (!response.ok) throw new Error('The Appointments workspace could not be loaded.');
  const text = await response.text();
  if (text.trim() === '') return null;
  return JSON.parse(text);
}

function arrayValue<T>(value: unknown, key: string): T[] {
  if (typeof value !== 'object' || value === null) return [];
  const result = (value as Record<string, unknown>)[key];
  return Array.isArray(result) ? (result as T[]) : [];
}

function booleanValue(value: unknown, key: string): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return (value as Record<string, unknown>)[key] === true;
}

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ selected?: string }>;
}) {
  const session = await getActiveSession();
  if (!hasPermission(session, 'appointments.records.read')) {
    return (
      <ShellState
        code="403"
        title="You can’t open Appointments"
        message="Your active Agency Membership does not permit Appointment work. Return to the Dashboard to continue."
      />
    );
  }

  const config = getConfig();
  const cookie = (await cookies()).toString();
  const origin = new URL(config.APP_URL).origin;
  const base = `${config.API_URL}/api/v1/agencies/${session.agencyId}`;
  const [appointmentValue, selectionValue, settingsValue, documentValue] = await Promise.all([
    getJson(`${base}/appointments?limit=100`, cookie, origin),
    getJson(`${base}/appointments/eligible-selections`, cookie, origin),
    getJson(`${base}/appointment-settings`, cookie, origin),
    hasPermission(session, 'documents.evidence.read')
      ? getJson(`${base}/documents/versions`, cookie, origin)
      : Promise.resolve(null),
  ]);
  const params = await searchParams;

  return (
    <AppointmentsWorkspace
      agencyId={session.agencyId}
      membershipId={session.membershipId}
      displayName={session.identity.displayName}
      initialAppointments={arrayValue<AppointmentSummary>(appointmentValue, 'appointments')}
      initialSelections={arrayValue<EligibleSelection>(selectionValue, 'selections')}
      initialSelectionsHasMore={booleanValue(selectionValue, 'hasMore')}
      initialSettings={(settingsValue as AppointmentSettings | null) ?? null}
      documents={arrayValue<DocumentVersionOption>(documentValue, 'documents')}
      canCreate={hasPermission(session, 'appointments.records.create')}
      canSubmit={hasPermission(session, 'appointments.records.submit')}
      canReturn={hasPermission(session, 'appointments.records.return')}
      canEndorse={hasPermission(session, 'appointments.records.endorse')}
      canIssue={hasPermission(session, 'appointments.records.issue')}
      canCancel={hasPermission(session, 'appointments.records.cancel')}
      canManageSettings={hasPermission(session, 'appointments.settings.manage')}
      initialSelected={params.selected ?? null}
    />
  );
}
