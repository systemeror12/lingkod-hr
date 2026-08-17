import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { AuditWorkspace } from '../../../components/audit-workspace';
import { ShellState } from '../../../components/shell-state';
import { isAuditEventListResponse } from '../../../lib/audit-contract';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Audit Log' };

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'audit.events.read')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Audit Log review. Return to the Dashboard to continue."
      />
    );
  }

  const config = getConfig();
  const cookieStore = await cookies();
  const response = await fetch(
    `${config.API_URL}/api/v1/agencies/${session.agencyId}/audit-events?limit=25`,
    {
      headers: { cookie: cookieStore.toString(), origin: new URL(config.APP_URL).origin },
      cache: 'no-store',
    },
  );
  if (response.status === 403) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Audit Log review. Return to the Dashboard to continue."
      />
    );
  }
  if (response.status === 404) {
    return (
      <ShellState
        code="Not found"
        title="The Audit Log could not be found"
        message="The Audit Log is not available in this Agency Context."
      />
    );
  }
  if (!response.ok) throw new Error('Audit Log could not be loaded.');
  const value: unknown = await response.json();
  if (!isAuditEventListResponse(value)) {
    throw new Error('The Audit Log returned an invalid response.');
  }
  return <AuditWorkspace agencyId={session.agencyId} initial={value} />;
}
