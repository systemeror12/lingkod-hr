'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import type { EmployeeOption } from '../lib/payroll-page-data';
import {
  authorizedInputStatusDisplay,
  decimalLabel,
  type AuthorizedInputStatus,
} from '../lib/payroll-inputs';
import { dateLabel } from '../lib/overtime-format';
import { Facts } from './payroll-inputs-workspace';
import { StateSurface } from './state-surface';
import { Button } from './ui/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { Field, FormError, inputClass } from './ui/field';
import { PageHeader, type Breadcrumb } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag } from './ui/status-tag';
import { Table, Td, Th, Tr } from './ui/table';

type Scope = 'AGENCY' | 'EMPLOYEE';
type ValueKind = 'AMOUNT' | 'RATE' | 'QUANTITY';
type PaymentSchedule = 'ONCE' | 'EACH_REGULAR_PERIOD';

/** One input as `GET /authorized-payroll-component-inputs` lists it. */
export interface AuthorizedInput {
  id: string;
  payComponentId: string;
  payComponentCode: string;
  payComponentName: string;
  scope: Scope;
  employeeId: string | null;
  valueKind: ValueKind;
  value: string;
  paymentSchedule: PaymentSchedule;
  authorityDocumentVersionId: string;
  authorityDocumentNo: string | null;
  sourceReference: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: AuthorizedInputStatus;
  recordedByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
}

export interface AuthorizedInputList {
  inputs: AuthorizedInput[];
  /** The catalogue components that accept an Authorized Payroll Component Input. */
  payComponents: { id: string; code: string; name: string; category: string }[];
}

/** A finalized Document Version the recorder may name as the authority. */
export interface AuthorityOption {
  id: string;
  label: string;
}

const scopeLabel: Record<Scope, string> = { AGENCY: 'Whole Agency', EMPLOYEE: 'One Employee' };
const valueKindLabel: Record<ValueKind, string> = {
  AMOUNT: 'Amount',
  RATE: 'Rate',
  QUANTITY: 'Quantity',
};
const scheduleLabel: Record<PaymentSchedule, string> = {
  ONCE: 'Once',
  EACH_REGULAR_PERIOD: 'Each regular payroll',
};

const emptyDraft = {
  payComponentId: '',
  scope: 'EMPLOYEE' as Scope,
  employeeId: '',
  valueKind: 'AMOUNT' as ValueKind,
  value: '',
  paymentSchedule: 'ONCE' as PaymentSchedule,
  authorityDocumentVersionId: '',
  sourceReference: '',
  effectiveFrom: '',
  effectiveTo: '',
};

function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

/**
 * Authorized Payroll Component Inputs: a list, a form to record one, and the input's own form,
 * where someone other than its recorder approves it. The API decides every refusal; this screen
 * shows its reason.
 */
export function AuthorizedInputsWorkspace({
  agencyId,
  canAdjust,
  employees,
  authorities,
  initialList,
}: {
  agencyId: string;
  canAdjust: boolean;
  employees: EmployeeOption[];
  authorities: AuthorityOption[];
  initialList: AuthorizedInputList;
}) {
  const [list, setList] = useState(initialList);
  const [form, setForm] = useState<{ kind: 'record' } | { kind: 'input'; id: string } | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const open = form?.kind === 'input' ? list.inputs.find(({ id }) => id === form.id) : undefined;

  function employeeLabel(input: AuthorizedInput): ReactNode {
    if (input.employeeId === null) return scopeLabel.AGENCY;
    const employee = employeeById.get(input.employeeId);
    if (!employee) return <span className="font-mono text-caption">{input.employeeId}</span>;
    return (
      <>
        {employee.legalName}
        <span className="block text-caption font-normal text-ink-muted">
          {employee.employeeNumber}
        </span>
      </>
    );
  }

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(
      `/api/v1/agencies/${agencyId}/authorized-payroll-component-inputs${path}`,
      {
        ...init,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...init.headers },
      },
    );
    const value = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    if (!response.ok) {
      throw new Error(
        value?.error?.message ?? 'The Authorized Payroll Component Input action failed.',
      );
    }
    return value;
  }

  async function refresh(): Promise<void> {
    setList((await request('')) as AuthorizedInputList);
  }

  function openRecord(): void {
    setDraft(emptyDraft);
    setError('');
    setNotice('');
    setForm({ kind: 'record' });
  }

  function openInput(id: string): void {
    setError('');
    setNotice('');
    setForm({ kind: 'input', id });
  }

  async function record(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const recorded = (await request('', {
        method: 'POST',
        body: JSON.stringify({
          ...draft,
          employeeId: draft.scope === 'EMPLOYEE' ? draft.employeeId : null,
          effectiveTo: draft.effectiveTo || null,
        }),
      })) as { id: string };
      await refresh();
      setForm({ kind: 'input', id: recorded.id });
      setNotice('Recorded. It takes effect only once someone other than you approves it.');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'The input could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: string): Promise<void> {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request(`/${encodeURIComponent(id)}/approve`, { method: 'POST' });
      await refresh();
      setNotice('Approved.');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'The input could not be approved.');
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof typeof emptyDraft) => (event: { currentTarget: EventTarget }) => {
    const value = targetValue(event);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const breadcrumbs: Breadcrumb[] = [
    { label: 'Payroll' },
    { label: 'Authorized Component Inputs' },
  ];
  if (form?.kind === 'record') breadcrumbs.push({ label: 'Record input' });
  if (open) breadcrumbs.push({ label: open.payComponentName });

  return (
    <Dialog
      presentation="form"
      open={form !== null}
      onOpenChange={(next) => !next && setForm(null)}
    >
      <div className="grid gap-5">
        <PageHeader breadcrumbs={breadcrumbs} title="Authorized Component Inputs" />

        <div hidden={form !== null} className="grid min-w-0 gap-5">
          <p className="m-0 max-w-[760px] text-small text-ink-muted">
            An Agency records an amount, rate, or quantity for a component that national rules leave
            to its own authority, with that authority and its effective period. An input takes
            effect only once someone other than its recorder approves it.
          </p>

          <Panel
            title="Authorized Payroll Component Inputs"
            flush
            actions={
              <>
                <span className="text-caption text-ink-muted">
                  {list.inputs.length === 1 ? '1 input' : `${list.inputs.length} inputs`}
                </span>
                {canAdjust ? (
                  <DialogTrigger asChild>
                    <Button onClick={openRecord} type="button" variant="primary">
                      Record input
                    </Button>
                  </DialogTrigger>
                ) : null}
              </>
            }
          >
            {list.inputs.length === 0 ? (
              <StateSurface compact label="Authorized Payroll Component Inputs">
                <strong className="text-body font-[650] text-ink">No inputs recorded yet.</strong>
              </StateSurface>
            ) : (
              <Table className="min-w-[960px]">
                <thead>
                  <tr>
                    <Th>Component</Th>
                    <Th>Applies to</Th>
                    <Th kind="numeric">Value</Th>
                    <Th>Schedule</Th>
                    <Th kind="date">Effective</Th>
                    <Th>Authority</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {list.inputs.map((input) => {
                    const display = authorizedInputStatusDisplay[input.status];
                    return (
                      <Tr key={input.id} selected={open?.id === input.id}>
                        <Td>
                          <DialogTrigger asChild>
                            <button
                              className="w-fit cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-primary hover:underline"
                              onClick={() => openInput(input.id)}
                              type="button"
                            >
                              {input.payComponentName}
                            </button>
                          </DialogTrigger>
                          <span className="block text-caption text-ink-muted">
                            {input.payComponentCode}
                          </span>
                        </Td>
                        <Td>{employeeLabel(input)}</Td>
                        <Td kind="numeric">
                          {decimalLabel(input.value)}
                          <span className="block text-caption text-ink-muted">
                            {valueKindLabel[input.valueKind]}
                          </span>
                        </Td>
                        <Td>{scheduleLabel[input.paymentSchedule]}</Td>
                        <Td kind="date">{effectivePeriod(input)}</Td>
                        <Td>
                          {input.sourceReference}
                          <span className="block text-caption text-ink-muted">
                            {input.authorityDocumentNo ?? 'Document without a number'}
                          </span>
                        </Td>
                        <Td>
                          <StatusTag tone={display.tone}>{display.label}</StatusTag>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        <DialogContent aria-describedby="authorized-input-description" aria-busy={busy}>
          {form?.kind === 'record' ? (
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void record(event)}>
              <DialogHeader>
                <div className="grid min-w-0 gap-1.5">
                  <DialogTitle>Record Authorized Payroll Component Input</DialogTitle>
                  <DialogDescription id="authorized-input-description">
                    It is recorded, not approved. Someone other than you approves it before it takes
                    effect.
                  </DialogDescription>
                </div>
              </DialogHeader>
              <DialogBody className="grid gap-5 min-[621px]:grid-cols-2">
                <Field htmlFor="authorized-input-component" label="Pay component">
                  <select
                    className={inputClass}
                    id="authorized-input-component"
                    value={draft.payComponentId}
                    onChange={set('payComponentId')}
                  >
                    <option value="">Choose a component</option>
                    {list.payComponents.map((component) => (
                      <option key={component.id} value={component.id}>
                        {component.name} ({component.code})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field htmlFor="authorized-input-scope" label="Applies to">
                  <select
                    className={inputClass}
                    id="authorized-input-scope"
                    value={draft.scope}
                    onChange={set('scope')}
                  >
                    {Object.entries(scopeLabel).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                {draft.scope === 'EMPLOYEE' ? (
                  <Field htmlFor="authorized-input-employee" label="Employee">
                    <select
                      className={inputClass}
                      id="authorized-input-employee"
                      value={draft.employeeId}
                      onChange={set('employeeId')}
                    >
                      <option value="">
                        {employees.length === 0
                          ? 'No Employees you can read'
                          : 'Choose an Employee'}
                      </option>
                      {employees.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.employeeNumber} · {employee.legalName}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
                <Field htmlFor="authorized-input-value-kind" label="Value kind">
                  <select
                    className={inputClass}
                    id="authorized-input-value-kind"
                    value={draft.valueKind}
                    onChange={set('valueKind')}
                  >
                    {Object.entries(valueKindLabel).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field htmlFor="authorized-input-value" label="Value">
                  <input
                    className={inputClass}
                    id="authorized-input-value"
                    inputMode="decimal"
                    value={draft.value}
                    onChange={set('value')}
                  />
                </Field>
                <Field htmlFor="authorized-input-schedule" label="Payment schedule">
                  <select
                    className={inputClass}
                    id="authorized-input-schedule"
                    value={draft.paymentSchedule}
                    onChange={set('paymentSchedule')}
                  >
                    {Object.entries(scheduleLabel).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field htmlFor="authorized-input-authority" label="Authority document">
                  <select
                    className={inputClass}
                    id="authorized-input-authority"
                    value={draft.authorityDocumentVersionId}
                    onChange={set('authorityDocumentVersionId')}
                  >
                    <option value="">
                      {authorities.length === 0
                        ? 'No Document Versions you can read'
                        : 'Choose the authority'}
                    </option>
                    {authorities.map((authority) => (
                      <option key={authority.id} value={authority.id}>
                        {authority.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field htmlFor="authorized-input-source-reference" label="Source reference">
                  <input
                    className={inputClass}
                    id="authorized-input-source-reference"
                    maxLength={500}
                    value={draft.sourceReference}
                    onChange={set('sourceReference')}
                  />
                </Field>
                <Field htmlFor="authorized-input-effective-from" label="Effective from">
                  <input
                    className={inputClass}
                    id="authorized-input-effective-from"
                    type="date"
                    value={draft.effectiveFrom}
                    onChange={set('effectiveFrom')}
                  />
                </Field>
                <Field htmlFor="authorized-input-effective-to" label="Effective to (optional)">
                  <input
                    className={inputClass}
                    id="authorized-input-effective-to"
                    type="date"
                    value={draft.effectiveTo}
                    onChange={set('effectiveTo')}
                  />
                </Field>
                <FormError className="min-[621px]:col-span-2" message={error} />
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} type="submit" variant="primary">
                  {busy ? 'Recording…' : 'Record input'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}

          {open ? (
            <>
              <DialogHeader>
                <div className="grid min-w-0 gap-1.5">
                  <DialogTitle>{open.payComponentName}</DialogTitle>
                  <DialogDescription id="authorized-input-description">
                    {open.payComponentCode} · {scheduleLabel[open.paymentSchedule]} ·{' '}
                    {effectivePeriod(open)}
                  </DialogDescription>
                </div>
                <StatusTag tone={authorizedInputStatusDisplay[open.status].tone}>
                  {authorizedInputStatusDisplay[open.status].label}
                </StatusTag>
              </DialogHeader>
              <DialogBody className="grid gap-5">
                {notice ? (
                  <p role="status" className="m-0 text-small text-success">
                    {notice}
                  </p>
                ) : null}
                <FormError message={error} />
                <Facts
                  facts={[
                    ['Applies to', employeeLabel(open)],
                    ['Value', `${decimalLabel(open.value)} (${valueKindLabel[open.valueKind]})`],
                    ['Payment schedule', scheduleLabel[open.paymentSchedule]],
                    ['Effective', effectivePeriod(open)],
                    ['Authority document', open.authorityDocumentNo ?? 'Document without a number'],
                    ['Source reference', open.sourceReference],
                    ['Recorded by', open.recordedByName ?? 'Unknown member'],
                    [
                      'Approved by',
                      open.approvedAt
                        ? `${open.approvedByName ?? 'Unknown member'} on ${dateLabel(open.approvedAt)}`
                        : 'Not approved yet',
                    ],
                  ]}
                />
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} type="button" variant="secondary">
                    Close
                  </Button>
                </DialogClose>
                {canAdjust && open.status === 'RECORDED' ? (
                  <Button
                    disabled={busy}
                    onClick={() => void approve(open.id)}
                    type="button"
                    variant="primary"
                  >
                    {busy ? 'Approving…' : 'Approve input'}
                  </Button>
                ) : null}
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </div>
    </Dialog>
  );
}

function effectivePeriod(input: Pick<AuthorizedInput, 'effectiveFrom' | 'effectiveTo'>): string {
  return input.effectiveTo
    ? `${dateLabel(input.effectiveFrom)} to ${dateLabel(input.effectiveTo)}`
    : `From ${dateLabel(input.effectiveFrom)}`;
}
