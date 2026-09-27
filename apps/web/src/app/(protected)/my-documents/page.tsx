import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getConfig } from '@lingkod-hr/config';
import { EmployeeDocumentsSection } from '../../../components/employee-documents-client';
import { ShellState } from '../../../components/shell-state';
import { PageHeader } from '../../../components/ui/page-header';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'My Documents' };
export const dynamic = 'force-dynamic';

export default async function MyDocumentsPage() {
  const session = await getActiveSession();
  const canReadDocuments = hasPermission(session, 'personnel.documents.read');
  const canUploadOwnDocuments = session.permissions.some(
    ({ code, scopePolicy }) => code === 'personnel.documents.upload' && scopePolicy === 'OWN',
  );
  if (!canReadDocuments) {
    return (
      <ShellState
        code="403"
        title="You can’t open My Documents"
        message="Your active Agency Membership does not permit own-record Personnel Document work."
      />
    );
  }

  const config = getConfig();
  const cookieStore = await cookies();
  const response = await fetch(
    `${config.API_URL}/api/v1/agencies/${session.agencyId}/employees/me`,
    {
      headers: { cookie: cookieStore.toString(), origin: new URL(config.APP_URL).origin },
      cache: 'no-store',
    },
  );
  if (response.status === 403) {
    return (
      <ShellState
        code="403"
        title="You can’t open My Documents"
        message="Your active Agency Membership does not permit own-record Personnel Document work."
      />
    );
  }
  if (response.status === 404) {
    return (
      <ShellState
        code="Not found"
        title="No Employee record is linked"
        message="Ask an Agency administrator to link your active Agency Membership to your Employee record."
      />
    );
  }
  if (!response.ok) throw new Error('Your Employee record could not be loaded.');
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'string') {
    throw new Error('Your Employee record response was invalid.');
  }

  return (
    <div className="grid gap-5">
      <PageHeader breadcrumbs={[{ label: 'Personnel' }]} title="My Documents" />
      <EmployeeDocumentsSection
        agencyId={session.agencyId}
        employeeId={(value as { id: string }).id}
        canRead={canReadDocuments}
        canManage={false}
        canUploadOwn={canUploadOwnDocuments}
        canBrowseSource={false}
        canRemoveOwn={canUploadOwnDocuments}
      />
    </div>
  );
}
