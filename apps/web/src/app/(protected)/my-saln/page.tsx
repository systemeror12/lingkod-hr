import type { Metadata } from 'next';
import { EmployeePageTitle } from '../../../components/employee-directory';
import { SalnComplianceSection } from '../../../components/saln-compliance-section';
import { ShellState } from '../../../components/shell-state';
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
    <>
      <header className="mb-7">
        <EmployeePageTitle
          eyebrow="Employee self-service"
          title="My SALN Compliance"
          description="Review your released filing year, type, status, and submission timestamp."
        />
      </header>
      <section className="overflow-hidden rounded-[4px] border border-line bg-paper">
        <SalnComplianceSection
          agencyId={session.agencyId}
          endpoint={`/api/v1/agencies/${session.agencyId}/employees/me/saln-compliance`}
          canRead
          canManage={false}
          canCorrect={false}
          canReadHistory={false}
          canReadEvidence={false}
        />
      </section>
    </>
  );
}
