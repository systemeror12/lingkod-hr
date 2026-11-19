'use client';

import { useState, type FormEvent } from 'react';
import type { AuthorityOption, EmployeeOption } from '../lib/payroll-page-data';
import { moneyLabel } from '../lib/payroll-periods';
import { payeeCategoryLabel } from '../lib/payroll-rules';
import { dateLabel } from '../lib/overtime-format';
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
import { StatusTag, type StatusDisplay } from './ui/status-tag';
import { Table, Td, Th, Tr } from './ui/table';

type ObligationStatus = 'ACTIVE' | 'SUPERSEDED' | 'ENDED';

/** One version of an obligation as `GET /employees/:employeeId/deduction-obligations` lists it. */
export interface DeductionObligation {
  id: string;
  employeeId: string;
  payeeCategory: string;
  payeeName: string;
  issuerReference: string;
  incurredOn: string;
  outstandingBalance: string;
  scheduledAmount: string;
  authorityDocumentVersionId: string;
  payeeRuleVersionId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: ObligationStatus;
  supersedesObligationId: string | null;
  changeReason: string | null;
  endReason: string | null;
}

/** A superseded or ended version is history, never the terms in force. */
const statusDisplay: Record<ObligationStatus, StatusDisplay> = {
  ACTIVE: { label: 'Active', tone: 'info' },
  SUPERSEDED: { label: 'Superseded', tone: 'neutral' },
  ENDED: { label: 'Ended', tone: 'neutral' },
};

type Obligations =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; obligations: DeductionObligation[] };

const emptyDraft = {
  payeeCategory: '',
  payeeName: '',
  issuerReference: '',
  incurredOn: '',
  outstandingBalance: '',
  scheduledAmount: '',
  effectiveFrom: '',
  authorityDocumentVersionId: '',
};

function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function message(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

/**
 * An Employee's Deduction Obligations: every version of each, and a form to record one as the
 * issuer validated it. Payroll stores the issuer's balance and scheduled amount and never
 * calculates interest or amortization; the authorized-deductions rule version in effect decides
 * which payees are accepted. The API decides every refusal; this screen shows its reason.
 */
export function DeductionObligationsWorkspace({
  agencyId,
  authorities,
  employees,
}: {
  agencyId: string;
  authorities: AuthorityOption[];
  employees: EmployeeOption[];
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [obligations, setObligations] = useState<Obligations>({ state: 'idle' });
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const employee = employees.find(({ id }) => id === employeeId);

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(`/api/v1/agencies/${agencyId}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    const value = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    if (!response.ok) {
      throw new Error(value?.error?.message ?? 'The Deduction Obligation request failed.');
    }
    return value;
  }

  async function load(id: string): Promise<void> {
    if (!id) {
      setObligations({ state: 'idle' });
      return;
    }
    setObligations({ state: 'loading' });
    try {
      const value = (await request(
        `/employees/${encodeURIComponent(id)}/deduction-obligations`,
      )) as { obligations: DeductionObligation[] };
      setObligations({ state: 'ready', obligations: value.obligations });
    } catch (caught: unknown) {
      setObligations({
        state: 'error',
        message: message(caught, 'The Deduction Obligations could not be loaded.'),
      });
    }
  }

  function choose(id: string): void {
    setEmployeeId(id);
    setNotice('');
    void load(id);
  }

  function openRecord(): void {
    setDraft(emptyDraft);
    setError('');
    setNotice('');
    setRecording(true);
  }

  async function record(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const authority = authorities.find(({ id }) => id === draft.authorityDocumentVersionId);
      await request(`/employees/${encodeURIComponent(employeeId)}/deduction-obligations`, {
        method: 'POST',
        body: JSON.stringify({ ...draft, authorityDocumentId: authority?.documentId ?? '' }),
      });
      await load(employeeId);
      setRecording(false);
      setNotice(`Obligation ${draft.issuerReference} to ${draft.payeeName} recorded.`);
    } catch (caught: unknown) {
      setError(message(caught, 'The Deduction Obligation could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof typeof emptyDraft) => (event: { currentTarget: EventTarget }) => {
    const value = targetValue(event);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const breadcrumbs: Breadcrumb[] = [{ label: 'Payroll' }, { label: 'Deduction Obligations' }];
  if (recording && employee) {
    breadcrumbs.push({ label: employee.legalName }, { label: 'Record obligation' });
  }

  return (
    <Dialog
      presentation="form"
      open={recording}
      onOpenChange={(next) => !next && setRecording(false)}
    >
      <div className="grid gap-5">
        <PageHeader breadcrumbs={breadcrumbs} title="Deduction Obligations" />

        <div hidden={recording} className="grid min-w-0 gap-5">
          <p className="m-0 max-w-[760px] text-small text-ink-muted">
            A loan or other deduction is recorded as its issuer validated it: payee, reference,
            balance, and scheduled amount. Each regular payroll deducts what is due in priority
            order, never taking net pay below the floor its rule version sets, and never calculates
            interest. A change keeps the earlier version.
          </p>
          <div className="max-w-[420px]">
            <Field htmlFor="obligations-employee" label="Employee">
              <select
                className={inputClass}
                id="obligations-employee"
                onChange={(event) => choose(targetValue(event))}
                value={employeeId}
              >
                <option value="">
                  {employees.length === 0 ? 'No Employees you can read' : 'Choose an Employee'}
                </option>
                {employees.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.employeeNumber} · {option.legalName}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {notice && !recording ? (
            <p className="m-0 text-small text-ink" role="status">
              {notice}
            </p>
          ) : null}

          {employee ? (
            <Panel
              title={employee.legalName}
              flush
              actions={
                <DialogTrigger asChild>
                  <Button onClick={openRecord} type="button" variant="primary">
                    Record obligation
                  </Button>
                </DialogTrigger>
              }
            >
              {obligations.state === 'loading' || obligations.state === 'idle' ? (
                <StateSurface busy compact label={`${employee.legalName} obligations`}>
                  Loading obligations…
                </StateSurface>
              ) : obligations.state === 'error' ? (
                <div className="p-4">
                  <FormError message={obligations.message} />
                </div>
              ) : obligations.obligations.length === 0 ? (
                <StateSurface compact label={`${employee.legalName} obligations`}>
                  No Deduction Obligation recorded for this Employee.
                </StateSurface>
              ) : (
                <section aria-label={`${employee.legalName} obligations`}>
                  <Table className="min-w-[1040px]">
                    <thead>
                      <tr>
                        <Th>Payee</Th>
                        <Th>Issuer reference</Th>
                        <Th kind="date">Incurred</Th>
                        <Th kind="numeric">Outstanding balance</Th>
                        <Th kind="numeric">Scheduled amount</Th>
                        <Th kind="date">Effective</Th>
                        <Th>Status</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {obligations.obligations.map((obligation) => {
                        const display = statusDisplay[obligation.status];
                        const reason = obligation.endReason ?? obligation.changeReason;
                        return (
                          <Tr key={obligation.id}>
                            <Td>
                              <strong className="font-[600] text-ink">
                                {obligation.payeeName}
                              </strong>
                              <span className="block text-caption text-ink-muted">
                                {payeeCategoryLabel[obligation.payeeCategory] ??
                                  obligation.payeeCategory}
                              </span>
                            </Td>
                            <Td>{obligation.issuerReference}</Td>
                            <Td kind="date">{dateLabel(obligation.incurredOn)}</Td>
                            <Td kind="numeric">{moneyLabel(obligation.outstandingBalance)}</Td>
                            <Td kind="numeric">{moneyLabel(obligation.scheduledAmount)}</Td>
                            <Td kind="date">
                              {obligation.effectiveTo
                                ? `${dateLabel(obligation.effectiveFrom)} to ${dateLabel(obligation.effectiveTo)}`
                                : `From ${dateLabel(obligation.effectiveFrom)}`}
                            </Td>
                            <Td>
                              <StatusTag tone={display.tone}>{display.label}</StatusTag>
                              {reason ? (
                                <span className="block max-w-[280px] text-caption text-ink-muted">
                                  {reason}
                                </span>
                              ) : null}
                            </Td>
                          </Tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </section>
              )}
            </Panel>
          ) : null}
        </div>

        <DialogContent aria-describedby="obligation-form-description" aria-busy={busy}>
          {recording && employee ? (
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void record(event)}>
              <DialogHeader>
                <div className="grid min-w-0 gap-1.5">
                  <DialogTitle>Record Deduction Obligation</DialogTitle>
                  <DialogDescription id="obligation-form-description">
                    For {employee.legalName} ({employee.employeeNumber}), as the issuer validated
                    it. The payee must be one the authorized-deductions rule version in effect
                    allows.
                  </DialogDescription>
                </div>
              </DialogHeader>
              <DialogBody className="grid gap-5 min-[621px]:grid-cols-2">
                <Field htmlFor="obligation-payee-category" label="Payee category">
                  <select
                    className={inputClass}
                    id="obligation-payee-category"
                    onChange={set('payeeCategory')}
                    required
                    value={draft.payeeCategory}
                  >
                    <option value="">Choose a category</option>
                    {Object.entries(payeeCategoryLabel).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field htmlFor="obligation-payee-name" label="Payee name">
                  <input
                    className={inputClass}
                    id="obligation-payee-name"
                    maxLength={255}
                    onChange={set('payeeName')}
                    required
                    value={draft.payeeName}
                  />
                </Field>
                <Field htmlFor="obligation-issuer-reference" label="Issuer reference">
                  <input
                    className={inputClass}
                    id="obligation-issuer-reference"
                    maxLength={100}
                    onChange={set('issuerReference')}
                    required
                    value={draft.issuerReference}
                  />
                </Field>
                <Field htmlFor="obligation-incurred-on" label="Incurred on">
                  <input
                    className={inputClass}
                    id="obligation-incurred-on"
                    onChange={set('incurredOn')}
                    required
                    type="date"
                    value={draft.incurredOn}
                  />
                </Field>
                <Field htmlFor="obligation-outstanding-balance" label="Outstanding balance">
                  <input
                    className={inputClass}
                    id="obligation-outstanding-balance"
                    inputMode="decimal"
                    onChange={set('outstandingBalance')}
                    required
                    value={draft.outstandingBalance}
                  />
                </Field>
                <Field htmlFor="obligation-scheduled-amount" label="Scheduled amount per payroll">
                  <input
                    className={inputClass}
                    id="obligation-scheduled-amount"
                    inputMode="decimal"
                    onChange={set('scheduledAmount')}
                    required
                    value={draft.scheduledAmount}
                  />
                </Field>
                <Field htmlFor="obligation-effective-from" label="Effective from">
                  <input
                    className={inputClass}
                    id="obligation-effective-from"
                    onChange={set('effectiveFrom')}
                    required
                    type="date"
                    value={draft.effectiveFrom}
                  />
                </Field>
                <Field htmlFor="obligation-authority" label="Authority document">
                  <select
                    className={inputClass}
                    id="obligation-authority"
                    onChange={set('authorityDocumentVersionId')}
                    required
                    value={draft.authorityDocumentVersionId}
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
                <FormError className="min-[621px]:col-span-2" message={error} />
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} type="submit" variant="primary">
                  {busy ? 'Recording…' : 'Record obligation'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </div>
    </Dialog>
  );
}
