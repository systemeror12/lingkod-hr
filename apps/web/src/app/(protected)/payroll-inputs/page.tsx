import type { Metadata } from 'next';
import { ShellState } from '../../../components/shell-state';
import {
  PayrollInputsWorkspace,
  type PayrollInput,
} from '../../../components/payroll-inputs-workspace';
import { getAgencyJson, loadEmployeeOptions } from '../../../lib/payroll-page-data';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'Payroll Inputs' };
export const dynamic = 'force-dynamic';

const forbidden = (
  <ShellState
    code="403"
    title="You can’t open this page"
    message="Your active Agency Membership does not permit reading Payroll Inputs. Return to the Dashboard to continue."
  />
);

export default async function PayrollInputsPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'payroll.inputs.read')) return forbidden;

  const [inputs, employees] = await Promise.all([
    getAgencyJson(session, '/payroll-inputs'),
    loadEmployeeOptions(session),
  ]);
  if (inputs.status === 403) return forbidden;
  const list = (inputs.value as { inputs?: unknown } | null)?.inputs;
  if (!Array.isArray(list)) throw new Error('Payroll Inputs could not be loaded.');

  return (
    <PayrollInputsWorkspace
      agencyId={session.agencyId}
      employees={employees}
      initialInputs={list as PayrollInput[]}
    />
  );
}
