import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getConfig } from '@lingkod-hr/config';
import {
  ServiceRecordWorkspace,
  type ServiceRecordListResponse,
} from '../../../components/service-record-workspace';
import { ShellState } from '../../../components/shell-state';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Service Records' };
export const dynamic = 'force-dynamic';

export default async function ServiceRecordsPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'personnel.service_records.read')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Service Record access."
      />
    );
  }
  const config = getConfig();
  const cookieStore = await cookies();
  const response = await fetch(
    `${config.API_URL}/api/v1/agencies/${session.agencyId}/service-records`,
    {
      headers: { cookie: cookieStore.toString(), origin: new URL(config.APP_URL).origin },
      cache: 'no-store',
    },
  );
  if (response.status === 403)
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Service Record access."
      />
    );
  if (response.status === 404)
    return (
      <ShellState
        code="Not found"
        title="Service Records could not be found"
        message="Service Records are not available in this Agency Context."
      />
    );
  if (!response.ok) throw new Error('Service Records could not be loaded.');
  const value: unknown = await response.json();
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as { records?: unknown }).records) ||
    !(
      (value as { nextCursor?: unknown }).nextCursor === null ||
      typeof (value as { nextCursor?: unknown }).nextCursor === 'string'
    )
  )
    throw new Error('The Service Record response was invalid.');

  return (
    <ServiceRecordWorkspace
      agencyId={session.agencyId}
      canGenerate={hasPermission(session, 'personnel.service_records.generate')}
      canReplace={
        hasPermission(session, 'personnel.service_records.replace') &&
        hasPermission(session, 'documents.evidence.read')
      }
      initial={value as ServiceRecordListResponse}
    />
  );
}
