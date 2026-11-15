'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { dateLabel } from '../lib/overtime-format';
import type { AuthorityOption, EmployeeOption } from '../lib/payroll-page-data';
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
import { Table, Td, Th, Tr } from './ui/table';

type Scope = 'AGENCY' | 'EMPLOYEE';

/** One record as `GET /agency-payroll-applicabilities` lists it. */
export interface Applicability {
  id: string;
  payComponentId: string;
  payComponentCode: string;
  payComponentName: string;
  scope: Scope;
  employeeId: string | null;
  authorityDocumentVersionId: string;
  authorityDocumentNo: string | null;
  fundingReference: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  recordedByName: string | null;
  recordedAt: string;
}

export interface ApplicabilityList {
  applicabilities: Applicability[];
  /** The conditional catalogue components a record can name. */
  payComponents: { id: string; code: string; name: string; isGaaRevalidated: boolean }[];
}

/** The API returns at most this many records, latest effective first. */
const LIST_LIMIT = 200;

const scopeLabel: Record<Scope, string> = { AGENCY: 'Whole Agency', EMPLOYEE: 'One Employee' };

const emptyDraft = {
  payComponentId: '',
  scope: 'AGENCY' as Scope,
  employeeId: '',
  authorityDocumentVersionId: '',
  fundingReference: '',
  effectiveFrom: '',
  effectiveTo: '',
};

const emptyEnd = { effectiveTo: '', reason: '' };

function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

/**
 * Agency Payroll Applicability: the records that make a conditional pay component apply, from its
 * effective date, to the whole Agency or one named Employee. A holder of
 * `payroll.compensation.manage` records and ends them; everyone else reads them. The API decides
 * every refusal, including the GAA year limit and overlaps; this screen shows its reason.
 */
export function PayrollApplicabilityWorkspace({
  agencyId,
  canManage,
  employees,
  authorities,
  initialList,
}: {
  agencyId: string;
  canManage: boolean;
  employees: EmployeeOption[];
  authorities: AuthorityOption[];
  initialList: ApplicabilityList;
}) {
  const [list, setList] = useState(initialList);
  const [form, setForm] = useState<{ kind: 'record' } | { kind: 'record-open'; id: string } | null>(
    null,
  );
  const [draft, setDraft] = useState(emptyDraft);
  const [ending, setEnding] = useState(emptyEnd);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const open =
    form?.kind === 'record-open'
      ? list.applicabilities.find(({ id }) => id === form.id)
      : undefined;
  const chosenComponent = list.payComponents.find(({ id }) => id === draft.payComponentId);

  function appliesTo(record: Applicability): ReactNode {
    if (record.employeeId === null) return scopeLabel.AGENCY;
    const employee = employeeById.get(record.employeeId);
    if (!employee) return <span className="font-mono text-caption">{record.employeeId}</span>;
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
      `/api/v1/agencies/${agencyId}/agency-payroll-applicabilities${path}`,
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
      throw new Error(value?.error?.message ?? 'The Agency Payroll Applicability action failed.');
    }
    return value;
  }

  async function refresh(): Promise<void> {
    setList((await request('')) as ApplicabilityList);
  }

  function openRecordForm(): void {
    setDraft(emptyDraft);
    setError('');
    setNotice('');
    setForm({ kind: 'record' });
  }

  function openRecord(id: string): void {
    setEnding(emptyEnd);
    setError('');
    setNotice('');
    setForm({ kind: 'record-open', id });
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
          employeeId: draft.scope === 'EMPLOYEE' ? draft.employeeId || null : null,
          effectiveTo: draft.effectiveTo || null,
        }),
      })) as { id: string };
      await refresh();
      setEnding(emptyEnd);
      setForm({ kind: 'record-open', id: recorded.id });
      setNotice('Recorded.');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'The record could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function end(event: FormEvent<HTMLFormElement>, id: string): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request(`/${encodeURIComponent(id)}/end`, {
        method: 'POST',
        body: JSON.stringify(ending),
      });
      await refresh();
      setEnding(emptyEnd);
      setNotice('Ended.');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'The record could not be ended.');
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof typeof emptyDraft) => (event: { currentTarget: EventTarget }) => {
    const value = targetValue(event);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const setEnd = (key: keyof typeof emptyEnd) => (event: { currentTarget: EventTarget }) => {
    const value = targetValue(event);
    setEnding((current) => ({ ...current, [key]: value }));
  };

  const breadcrumbs: Breadcrumb[] = [{ label: 'Payroll' }, { label: 'Payroll Applicability' }];
  if (form?.kind === 'record') breadcrumbs.push({ label: 'Record applicability' });
  if (open) breadcrumbs.push({ label: open.payComponentName });

  return (
    <Dialog
      presentation="form"
      open={form !== null}
      onOpenChange={(next) => !next && setForm(null)}
    >
      <div className="grid gap-5">
        <PageHeader breadcrumbs={breadcrumbs} title="Payroll Applicability" />

        <div hidden={form !== null} className="grid min-w-0 gap-5">
          <p className="m-0 max-w-[760px] text-small text-ink-muted">
            A conditional pay component applies only under an Agency Payroll Applicability record
            for the whole Agency or for one named Employee, with its authority, funding, and
            effective period. An unconditional component needs no record. Ending a record brings its
            end date forward; nothing else about it changes.
          </p>

          <Panel
            title="Agency Payroll Applicability"
            flush
            actions={
              <>
                <span className="text-caption text-ink-muted">
                  {list.applicabilities.length === 1
                    ? '1 record'
                    : `${list.applicabilities.length} records`}
                  {list.applicabilities.length >= LIST_LIMIT ? `, latest ${LIST_LIMIT} shown` : ''}
                </span>
                {canManage ? (
                  <DialogTrigger asChild>
                    <Button onClick={openRecordForm} type="button" variant="primary">
                      Record applicability
                    </Button>
                  </DialogTrigger>
                ) : null}
              </>
            }
          >
            {list.applicabilities.length === 0 ? (
              <StateSurface compact label="Agency Payroll Applicability">
                <strong className="text-body font-[650] text-ink">No records yet.</strong>
              </StateSurface>
            ) : (
              <Table className="min-w-[900px]">
                <thead>
                  <tr>
                    <Th>Component</Th>
                    <Th>Applies to</Th>
                    <Th kind="date">Effective</Th>
                    <Th>Authority</Th>
                    <Th>Funding</Th>
                  </tr>
                </thead>
                <tbody>
                  {list.applicabilities.map((row) => (
                    <Tr key={row.id} selected={open?.id === row.id}>
                      <Td>
                        <DialogTrigger asChild>
                          <button
                            className="w-fit cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-primary hover:underline"
                            onClick={() => openRecord(row.id)}
                            type="button"
                          >
                            {row.payComponentName}
                          </button>
                        </DialogTrigger>
                        <span className="block text-caption text-ink-muted">
                          {row.payComponentCode}
                        </span>
                      </Td>
                      <Td>{appliesTo(row)}</Td>
                      <Td kind="date">{effectivePeriod(row)}</Td>
                      <Td>{row.authorityDocumentNo ?? 'Document without a number'}</Td>
                      <Td>{row.fundingReference}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        <DialogContent aria-describedby="applicability-description" aria-busy={busy}>
          {form?.kind === 'record' ? (
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void record(event)}>
              <DialogHeader>
                <div className="grid min-w-0 gap-1.5">
                  <DialogTitle>Record Agency Payroll Applicability</DialogTitle>
                  <DialogDescription id="applicability-description">
                    Name the conditional component, who it applies to, its authority and funding,
                    and when it takes effect.
                  </DialogDescription>
                </div>
              </DialogHeader>
              <DialogBody className="grid gap-5 min-[621px]:grid-cols-2">
                <Field htmlFor="applicability-component" label="Pay component">
                  <select
                    className={inputClass}
                    id="applicability-component"
                    value={draft.payComponentId}
                    onChange={set('payComponentId')}
                  >
                    <option value="">Choose a conditional component</option>
                    {list.payComponents.map((component) => (
                      <option key={component.id} value={component.id}>
                        {component.name} ({component.code})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field htmlFor="applicability-scope" label="Applies to">
                  <select
                    className={inputClass}
                    id="applicability-scope"
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
                  <Field htmlFor="applicability-employee" label="Employee">
                    <select
                      className={inputClass}
                      id="applicability-employee"
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
                <Field htmlFor="applicability-authority" label="Authority document">
                  <select
                    className={inputClass}
                    id="applicability-authority"
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
                <Field htmlFor="applicability-funding" label="Funding reference">
                  <input
                    className={inputClass}
                    id="applicability-funding"
                    maxLength={500}
                    value={draft.fundingReference}
                    onChange={set('fundingReference')}
                  />
                </Field>
                <Field htmlFor="applicability-effective-from" label="Effective from">
                  <input
                    className={inputClass}
                    id="applicability-effective-from"
                    type="date"
                    value={draft.effectiveFrom}
                    onChange={set('effectiveFrom')}
                  />
                </Field>
                <Field htmlFor="applicability-effective-to" label="Effective to (optional)">
                  <input
                    className={inputClass}
                    id="applicability-effective-to"
                    type="date"
                    value={draft.effectiveTo}
                    onChange={set('effectiveTo')}
                  />
                </Field>
                {chosenComponent?.isGaaRevalidated ? (
                  <p className="m-0 text-small text-ink-muted min-[621px]:col-span-2">
                    This component is revalidated against each year’s GAA. Renewing it is a new
                    record.
                  </p>
                ) : null}
                <FormError className="min-[621px]:col-span-2" message={error} />
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} type="submit" variant="primary">
                  {busy ? 'Recording…' : 'Record applicability'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}

          {open ? (
            <>
              <DialogHeader>
                <div className="grid min-w-0 gap-1.5">
                  <DialogTitle>{open.payComponentName}</DialogTitle>
                  <DialogDescription id="applicability-description">
                    {open.payComponentCode} · {scopeLabel[open.scope]} · {effectivePeriod(open)}
                    {canManage ? '' : '. Read-only.'}
                  </DialogDescription>
                </div>
              </DialogHeader>
              <DialogBody className="grid gap-6">
                {notice ? (
                  <p role="status" className="m-0 text-small text-success">
                    {notice}
                  </p>
                ) : null}
                <Facts
                  facts={[
                    ['Applies to', appliesTo(open)],
                    ['Effective', effectivePeriod(open)],
                    ['Authority document', open.authorityDocumentNo ?? 'Document without a number'],
                    ['Funding reference', open.fundingReference],
                    [
                      'Recorded',
                      `${open.recordedByName ?? 'Unknown member'} on ${dateLabel(open.recordedAt)}`,
                    ],
                  ]}
                />
                {canManage ? (
                  <form
                    aria-labelledby="applicability-end-title"
                    className="grid gap-4"
                    onSubmit={(event) => void end(event, open.id)}
                  >
                    <h3 className="m-0 text-panel-title text-ink" id="applicability-end-title">
                      End this record
                    </h3>
                    <div className="grid gap-5 min-[621px]:grid-cols-2">
                      <Field htmlFor="applicability-end-date" label="Last effective date">
                        <input
                          className={inputClass}
                          id="applicability-end-date"
                          type="date"
                          value={ending.effectiveTo}
                          onChange={setEnd('effectiveTo')}
                        />
                      </Field>
                      <Field htmlFor="applicability-end-reason" label="Reason">
                        <input
                          className={inputClass}
                          id="applicability-end-reason"
                          maxLength={1000}
                          value={ending.reason}
                          onChange={setEnd('reason')}
                        />
                      </Field>
                    </div>
                    <FormError message={error} />
                    <Button className="w-fit" disabled={busy} type="submit" variant="primary">
                      {busy ? 'Ending…' : 'End record'}
                    </Button>
                  </form>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} type="button" variant="secondary">
                    Close
                  </Button>
                </DialogClose>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </div>
    </Dialog>
  );
}

function effectivePeriod(record: Pick<Applicability, 'effectiveFrom' | 'effectiveTo'>): string {
  return record.effectiveTo
    ? `${dateLabel(record.effectiveFrom)} to ${dateLabel(record.effectiveTo)}`
    : `From ${dateLabel(record.effectiveFrom)}`;
}
