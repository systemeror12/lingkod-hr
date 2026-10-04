import type { Metadata } from 'next';
import { SalnComplianceSection } from '../../../components/saln-compliance-section';
import { ShellState } from '../../../components/shell-state';
import { PageHeader } from '../../../components/ui/page-header';
import { getActiveSession } from '../../../lib/session';

export const metadata: Metadata = { title: 'My SALN Compliance' };

export default async function MySalnPage() {
  const session = await getActiveSession();
  const canReadOwn = session.permissions.some(
    ({ code, scopePolicy }) => code === 'personnel.saln_compliance.read' && scopePolicy === 'OWN',
  );
  if (!canReadOwn) {
    return (
      <ShellState
        code="403"
        title="You can’t open My SALN Compliance"
        message="Your active Agency Membership does not permit own-record SALN compliance access."
      />
    );
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Personnel' }, { label: 'My SALN Compliance' }]}
        title="My SALN Compliance"
      />
      <SalnComplianceSection
        agencyId={session.agencyId}
        endpoint={`/api/v1/agencies/${session.agencyId}/employees/me/saln-compliance`}
        canRead
        canManage={false}
        canCorrect={false}
        canReadHistory={false}
        canReadEvidence={false}
      />
    </div>
  );
}
