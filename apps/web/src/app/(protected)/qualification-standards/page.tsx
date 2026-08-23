import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { ShellState } from '../../../components/shell-state';
import {
  QualificationStandardWorkspace,
  type QualificationStandardListResponse,
} from '../../../components/qualification-standard-workspace';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Qualification Standards' };
export const dynamic = 'force-dynamic';

export default async function QualificationStandardsPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'qualification.standards.read')) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit Qualification Standard work. Return to the Dashboard to continue."
      />
    );
  }

  const config = getConfig();
  const cookieStore = await cookies();
  const response = await fetch(
    config.API_URL + '/api/v1/agencies/' + session.agencyId + '/qualification-standards',
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
        message="Your active Agency Membership does not permit Qualification Standard work. Return to the Dashboard to continue."
      />
    );
  }
  if (response.status === 404) {
    return (
      <ShellState
        code="Not found"
        title="The Qualification Standard register could not be found"
        message="The Qualification Standard register is not available in this Agency Context."
      />
    );
  }
  if (!response.ok) throw new Error('Qualification Standards could not be loaded.');
  const value: unknown = await response.json();
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as { standards?: unknown }).standards)
  ) {
    throw new Error('The Qualification Standard response was invalid.');
  }

  return (
    <QualificationStandardWorkspace
      agencyId={session.agencyId}
      initial={value as QualificationStandardListResponse}
      canCreate={hasPermission(session, 'qualification.standards.create')}
      canUpdate={hasPermission(session, 'qualification.standards.update')}
      canValidateEvidence={hasPermission(session, 'qualification.standards.evidence.validate')}
      canActivate={hasPermission(session, 'qualification.standards.activate')}
    />
  );
}
