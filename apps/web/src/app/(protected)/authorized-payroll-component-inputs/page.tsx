import type { Metadata } from 'next';
import { ShellState } from '../../../components/shell-state';
import {
  AuthorizedInputsWorkspace,
  type AuthorityOption,
  type AuthorizedInputList,
} from '../../../components/authorized-inputs-workspace';
import { getAgencyJson, loadEmployeeOptions } from '../../../lib/payroll-page-data';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Authorized Component Inputs' };
export const dynamic = 'force-dynamic';

const forbidden = (
  <ShellState
    code="403"
    title="You can’t open this page"
    message="Your active Agency Membership does not permit reading Authorized Payroll Component Inputs. Return to the Dashboard to continue."
  />
);

interface LinkableVersion {
  documentNo: string | null;
  documentType: string;
  version: { id: string; versionNo: number };
}

export default async function AuthorizedPayrollComponentInputsPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'payroll.inputs.read')) return forbidden;
  const canAdjust = hasPermission(session, 'payroll.inputs.adjust');

  const [list, employees, versions] = await Promise.all([
    getAgencyJson(session, '/authorized-payroll-component-inputs'),
    loadEmployeeOptions(session),
    canAdjust && hasPermission(session, 'documents.evidence.read')
      ? getAgencyJson(session, '/documents/versions')
      : Promise.resolve({ status: 200, value: null }),
  ]);
  if (list.status === 403) return forbidden;
  const value = list.value as Partial<AuthorizedInputList> | null;
  if (!Array.isArray(value?.inputs) || !Array.isArray(value.payComponents)) {
    throw new Error('Authorized Payroll Component Inputs could not be loaded.');
  }
  const documents = (versions.value as { documents?: LinkableVersion[] } | null)?.documents ?? [];
  const authorities: AuthorityOption[] = documents.map((document) => ({
    id: document.version.id,
    label: `${document.documentNo ?? document.documentType} · v${document.version.versionNo}`,
  }));

  return (
    <AuthorizedInputsWorkspace
      agencyId={session.agencyId}
      canAdjust={canAdjust}
      employees={employees}
      authorities={authorities}
      initialList={{ inputs: value.inputs, payComponents: value.payComponents }}
    />
  );
}
