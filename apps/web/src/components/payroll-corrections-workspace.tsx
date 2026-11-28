'use client';

import Link from 'next/link';
import { Fragment, useCallback, useState, type FormEvent, type ReactNode } from 'react';
import {
  ADJUSTMENT_FILTERS,
  adjustmentFilterLabel,
  adjustmentListPath,
  adjustmentProgress,
  adjustmentStatusDisplay,
  causeDetail,
  causeOriginLabel,
  recalculationNotice,
  voidStateDisplay,
  voidStateOf,
  type AdjustmentFilter,
  type PayrollAdjustment,
  type PayrollAdjustmentPeriodRef,
  type PayrollRecalculationResult,
} from '../lib/payroll-corrections';
import { cn } from '../lib/class-names';
import { dateLabel } from '../lib/overtime-format';
import type { AuthorityOption, EmployeeOption } from '../lib/payroll-page-data';
import { instantLabel, type PayrollPeriod, type PayrollPeriodList } from '../lib/payroll-periods';
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
import { Field, FormError, inputClass, labelClass } from './ui/field';
import { PageHeader, type Breadcrumb } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag } from './ui/status-tag';
import { Table, Td, Th, Tr } from './ui/table';

/** The correction methods #330 allows, each offered only to an actor whose permission it needs. */
export type CorrectionMethod = 'ADJUSTMENT' | 'VOID';

const methodLabel: Record<CorrectionMethod, string> = {
  ADJUSTMENT: 'Payroll Adjustment',
  VOID: 'Void and replace',
};

const methodHint: Record<CorrectionMethod, string> = {
  ADJUSTMENT:
    'Payroll recalculates the finalized period and keeps the difference. The next regular period carries it, or a special period marked as the supplemental payroll.',
  VOID: 'A different Payroll Approver approves the void; the replacement is a new regular period for the same month.',
};

type Adjustments =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; rows: PayrollAdjustment[] };

type Decision = { periodId: string; action: 'approve' | 'decline'; reason: string };

const emptyDraft = { periodId: '', employeeId: '', reason: '', documentVersionId: '' };

function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function message(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

/** A link to a period on Employee Payslips, which opens it there. */
function periodLink(period: { id: string; code: string }): ReactNode {
  return (
    <Link
      className="font-[600] text-primary hover:underline"
      href={`/payslips?period=${encodeURIComponent(period.id)}#period-${period.id}`}
    >
      {period.code}
    </Link>
  );
}

/**
 * Payroll Corrections (#651), an extension of the Payroll workspace: the Agency's Payroll
 * Adjustments, each with its causes and the payroll that carries or posted it; the finalized
 * payrolls with a void requested or done; and one form to open a correction by a method #330
 * allows. The API decides whether a method applies and calculates every difference; this screen
 * shows what it recorded and the reason for each refusal.
 */
export function PayrollCorrectionsWorkspace({
  agencyId,
  authorities,
  employees,
  evidenceReadable,
  initialAdjustments,
  initialPeriods,
  canAdjust,
  canRequestVoid,
  canApproveVoid,
}: {
  agencyId: string;
  authorities: AuthorityOption[];
  employees: EmployeeOption[];
  /** Whether the actor can list the Agency's Document Versions to cite as void support. */
  evidenceReadable: boolean;
  /** The pending adjustments, which the list shows first. */
  initialAdjustments: PayrollAdjustment[];
  initialPeriods: PayrollPeriod[];
  /** `payroll.inputs.adjust` Agency-wide: asks Payroll to recalculate a finalized period. */
  canAdjust: boolean;
  /** `payroll.periods.void`: requests a void. */
  canRequestVoid: boolean;
  /** `payroll.periods.approve_void`: approves or declines another person's void request. */
  canApproveVoid: boolean;
}) {
  const methods: CorrectionMethod[] = [
    ...(canAdjust ? (['ADJUSTMENT'] as const) : []),
    ...(canRequestVoid ? (['VOID'] as const) : []),
  ];
  const [filter, setFilter] = useState<AdjustmentFilter>('OPEN');
  const [adjustments, setAdjustments] = useState<Adjustments>({
    state: 'ready',
    rows: initialAdjustments,
  });
  const [periods, setPeriods] = useState(initialPeriods);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<CorrectionMethod>(methods[0] ?? 'ADJUSTMENT');
  const [draft, setDraft] = useState(emptyDraft);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const periodById = new Map(periods.map((period) => [period.id, period]));
  const finalized = periods.filter((period) => period.status === 'FINALIZED');
  const voids = periods.filter((period) => voidStateOf(period) !== null);
  const employeeName = (id: string) => employeeById.get(id)?.legalName ?? id;

  const request = useCallback(
    async (path: string, init: RequestInit = {}): Promise<unknown> => {
      const response = await fetch(`/api/v1/agencies/${agencyId}${path}`, {
        ...init,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...init.headers },
      });
      const value = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!response.ok) throw new Error(value?.error?.message ?? 'The Payroll request failed.');
      return value;
    },
    [agencyId],
  );

  const loadAdjustments = useCallback(
    async (next: AdjustmentFilter) => {
      setAdjustments({ state: 'loading' });
      try {
        const { adjustments: rows } = (await request(adjustmentListPath(next))) as {
          adjustments: PayrollAdjustment[];
        };
        setAdjustments({ state: 'ready', rows });
      } catch (caught: unknown) {
        setAdjustments({
          state: 'error',
          message: message(caught, 'The Payroll Adjustments could not be read.'),
        });
      }
    },
    [request],
  );

  async function refreshPeriods(): Promise<void> {
    const list = (await request('/payroll-periods')) as PayrollPeriodList;
    setPeriods(list.periods);
  }

  function openForm(): void {
    setDraft(emptyDraft);
    setMethod(methods[0] ?? 'ADJUSTMENT');
    setError('');
    setNotice('');
    setOpen(true);
  }

  const set = (key: keyof typeof emptyDraft) =>
    function update(event: { currentTarget: EventTarget }) {
      const value = targetValue(event);
      setDraft((current) => ({ ...current, [key]: value }));
    };

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const period = periodById.get(draft.periodId);
    if (!period) return;
    setBusy(true);
    setError('');
    try {
      if (method === 'ADJUSTMENT') {
        const result = (await request(`/payroll-periods/${period.id}/adjustments`, {
          method: 'POST',
          body: JSON.stringify({
            reason: draft.reason,
            ...(draft.employeeId ? { employeeId: draft.employeeId } : {}),
          }),
        })) as PayrollRecalculationResult;
        setNotice(recalculationNotice(period.code, result, employeeName));
      } else {
        await request(`/payroll-periods/${period.id}/request-void`, {
          method: 'POST',
          body: JSON.stringify({
            reason: draft.reason,
            documentVersionId: draft.documentVersionId,
            rowVersion: period.rowVersion,
          }),
        });
        setNotice(
          `Void of ${period.code} requested. It stays Finalized until the request is approved.`,
        );
        await refreshPeriods();
      }
      setOpen(false);
      setFilter('OPEN');
      await loadAdjustments('OPEN');
    } catch (caught: unknown) {
      setError(message(caught, 'The correction could not be opened.'));
    } finally {
      setBusy(false);
    }
  }

  async function decide(period: PayrollPeriod, event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!decision) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request(`/payroll-periods/${period.id}/${decision.action}-void`, {
        method: 'POST',
        body: JSON.stringify(
          decision.action === 'approve'
            ? { rowVersion: period.rowVersion }
            : { reason: decision.reason, rowVersion: period.rowVersion },
        ),
      });
      setDecision(null);
      setNotice(
        decision.action === 'approve'
          ? `${period.code} voided. Its replacement is a new regular period for the same month.`
          : `Void request of ${period.code} declined. It stays Finalized.`,
      );
      await refreshPeriods();
      await loadAdjustments(filter);
    } catch (caught: unknown) {
      setError(message(caught, 'The void request could not be decided.'));
    } finally {
      setBusy(false);
    }
  }

  function employeeCell(employeeId: string): ReactNode {
    const employee = employeeById.get(employeeId);
    if (!employee) return <span className="font-mono text-caption break-all">{employeeId}</span>;
    return (
      <>
        {employee.legalName}
        <span className="block text-caption font-normal text-ink-muted">
          {employee.employeeNumber}
        </span>
      </>
    );
  }

  function progressCell(adjustment: PayrollAdjustment): ReactNode {
    const linked: PayrollAdjustmentPeriodRef[] =
      adjustment.status === 'POSTED'
        ? adjustment.postedBy
          ? [adjustment.postedBy]
          : []
        : adjustment.status === 'OPEN'
          ? adjustment.carriedBy
          : [];
    return (
      <>
        {adjustmentProgress(adjustment)}
        {linked.length > 0 ? (
          <span className="block text-caption">
            {linked.map((period, index) => (
              <Fragment key={period.id}>
                {index > 0 ? ', ' : null}
                {periodLink(period)}
              </Fragment>
            ))}
          </span>
        ) : null}
      </>
    );
  }

  const breadcrumbs: Breadcrumb[] = [{ label: 'Payroll' }, { label: 'Payroll Corrections' }];
  if (open) breadcrumbs.push({ label: 'Open correction' });
  const chosen = periodById.get(draft.periodId);

  return (
    <Dialog presentation="form" open={open} onOpenChange={(next) => !next && setOpen(false)}>
      <div className="grid gap-5">
        <PageHeader
          breadcrumbs={breadcrumbs}
          title="Payroll Corrections"
          actions={
            methods.length > 0 ? (
              <DialogTrigger asChild>
                <Button onClick={openForm} type="button" variant="primary">
                  Open correction
                </Button>
              </DialogTrigger>
            ) : null
          }
        />

        <div hidden={open} className="grid min-w-0 gap-5">
          <p className="m-0 max-w-[760px] text-small text-ink-muted">
            A finalized payroll is never edited. It is corrected by a Payroll Adjustment, which a
            later payroll recalculates and carries through its own review chain, or by voiding it
            for a replacement. Payroll decides whether a method applies and calculates every
            difference.
          </p>
          <FormError message={open ? '' : error} />
          {notice && !open ? (
            <p className="m-0 text-small text-ink" role="status">
              {notice}
            </p>
          ) : null}

          <Panel
            title="Payroll Adjustments"
            flush
            actions={
              <>
                <label className="flex items-center gap-2 text-caption text-ink-muted">
                  Show
                  <select
                    className={cn(inputClass, 'h-8 w-auto py-0')}
                    onChange={(event) => {
                      const next = targetValue(event) as AdjustmentFilter;
                      setFilter(next);
                      void loadAdjustments(next);
                    }}
                    value={filter}
                  >
                    {ADJUSTMENT_FILTERS.map((value) => (
                      <option key={value} value={value}>
                        {adjustmentFilterLabel[value]}
                      </option>
                    ))}
                  </select>
                </label>
                {adjustments.state === 'ready' ? (
                  <span className="text-caption text-ink-muted">
                    {adjustments.rows.length === 1
                      ? '1 adjustment'
                      : `${adjustments.rows.length} adjustments`}
                  </span>
                ) : null}
              </>
            }
          >
            {adjustments.state === 'loading' ? (
              <StateSurface busy compact label="Payroll Adjustments">
                Loading Payroll Adjustments…
              </StateSurface>
            ) : adjustments.state === 'error' ? (
              <div className="p-4">
                <FormError message={adjustments.message} />
              </div>
            ) : adjustments.rows.length === 0 ? (
              <StateSurface compact label="Payroll Adjustments">
                {filter === 'OPEN'
                  ? 'No pending Payroll Adjustment.'
                  : `No ${adjustmentFilterLabel[filter].toLowerCase()} Payroll Adjustment.`}
              </StateSurface>
            ) : (
              <Table className="min-w-[960px]">
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Finalized payroll</Th>
                    <Th>Causes</Th>
                    <Th>Payroll</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.rows.map((adjustment) => {
                    const display = adjustmentStatusDisplay[adjustment.status];
                    return (
                      <Tr key={adjustment.id} data-adjustment={adjustment.id}>
                        <Td>{employeeCell(adjustment.employeeId)}</Td>
                        <Td>
                          {periodLink(adjustment.originalPayrollPeriod)}
                          <span className="block text-caption text-ink-muted">
                            Opened {instantLabel(adjustment.openedAt)}
                          </span>
                        </Td>
                        <Td>
                          <ul className="m-0 grid list-none gap-2 p-0">
                            {adjustment.causes.map((cause) => (
                              <li key={cause.id}>
                                <strong className="font-[600] text-ink">
                                  {causeOriginLabel[cause.origin]}
                                </strong>
                                {causeDetail(cause)
                                  .filter(Boolean)
                                  .map((detail) => (
                                    <span
                                      key={detail}
                                      className="block max-w-[360px] text-caption break-words text-ink-muted"
                                    >
                                      {detail}
                                    </span>
                                  ))}
                                <span className="block text-caption text-ink-muted">
                                  {instantLabel(cause.createdAt)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </Td>
                        <Td>{progressCell(adjustment)}</Td>
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

          <Panel
            title="Voids"
            flush
            actions={
              <span className="text-caption text-ink-muted">
                {voids.length === 1 ? '1 payroll' : `${voids.length} payrolls`}
              </span>
            }
          >
            {voids.length === 0 ? (
              <StateSurface compact label="Voids">
                No finalized payroll has a void requested or done.
              </StateSurface>
            ) : (
              <Table className="min-w-[860px]">
                <thead>
                  <tr>
                    <Th>Payroll</Th>
                    <Th>Reason</Th>
                    <Th>Status</Th>
                    {canApproveVoid ? <Th>Action</Th> : null}
                  </tr>
                </thead>
                <tbody>
                  {voids.map((period) => {
                    const state = voidStateOf(period)!;
                    const display = voidStateDisplay[state];
                    const deciding = decision?.periodId === period.id ? decision : null;
                    return (
                      <Fragment key={period.id}>
                        <Tr>
                          <Td>
                            {periodLink(period)}
                            <span className="block text-caption text-ink-muted">
                              {dateLabel(period.periodFrom)} – {dateLabel(period.periodTo)}
                            </span>
                          </Td>
                          <Td>
                            <span className="block max-w-[420px]">{period.voidReason ?? '—'}</span>
                            {period.voidRequestedAt ? (
                              <span className="block text-caption text-ink-muted">
                                Requested {instantLabel(period.voidRequestedAt)}
                              </span>
                            ) : null}
                          </Td>
                          <Td>
                            <StatusTag tone={display.tone}>{display.label}</StatusTag>
                            {period.voidedAt ? (
                              <span className="block text-caption text-ink-muted">
                                {instantLabel(period.voidedAt)}
                              </span>
                            ) : null}
                          </Td>
                          {canApproveVoid ? (
                            <Td>
                              {state === 'REQUESTED' && !deciding ? (
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    onClick={() =>
                                      setDecision({
                                        periodId: period.id,
                                        action: 'approve',
                                        reason: '',
                                      })
                                    }
                                    type="button"
                                    variant="secondary"
                                  >
                                    Approve void
                                    <span className="sr-only"> of {period.code}</span>
                                  </Button>
                                  <Button
                                    onClick={() =>
                                      setDecision({
                                        periodId: period.id,
                                        action: 'decline',
                                        reason: '',
                                      })
                                    }
                                    type="button"
                                    variant="secondary"
                                  >
                                    Decline
                                    <span className="sr-only"> void of {period.code}</span>
                                  </Button>
                                </div>
                              ) : null}
                            </Td>
                          ) : null}
                        </Tr>
                        {deciding ? (
                          <tr>
                            <td
                              className="border-b border-border-subtle bg-canvas px-4 py-3"
                              colSpan={4}
                            >
                              <form
                                aria-label={
                                  deciding.action === 'approve'
                                    ? `Approve void of ${period.code}`
                                    : `Decline void of ${period.code}`
                                }
                                className="grid max-w-[640px] gap-3"
                                onSubmit={(event) => void decide(period, event)}
                              >
                                {deciding.action === 'approve' ? (
                                  <p className="m-0 text-small text-ink">
                                    Approving voids {period.code}: it stays readable, and its
                                    sources go to the replacement.
                                  </p>
                                ) : (
                                  <Field
                                    htmlFor={`decline-void-${period.id}`}
                                    label="Reason for declining"
                                  >
                                    <textarea
                                      className={cn(inputClass, 'min-h-20 py-2')}
                                      id={`decline-void-${period.id}`}
                                      onChange={(event) =>
                                        setDecision({ ...deciding, reason: targetValue(event) })
                                      }
                                      required
                                      value={deciding.reason}
                                    />
                                  </Field>
                                )}
                                <div className="flex flex-wrap gap-2">
                                  <Button disabled={busy} type="submit" variant="primary">
                                    {deciding.action === 'approve'
                                      ? 'Approve void'
                                      : 'Decline void request'}
                                  </Button>
                                  <Button onClick={() => setDecision(null)} type="button">
                                    Cancel
                                  </Button>
                                </div>
                              </form>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        <DialogContent aria-describedby="payroll-correction-description" aria-busy={busy}>
          {open ? (
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void submit(event)}>
              <DialogHeader>
                <div className="grid min-w-0 gap-1.5">
                  <DialogTitle>Open correction</DialogTitle>
                  <DialogDescription id="payroll-correction-description">
                    {methodHint[method]}
                  </DialogDescription>
                </div>
              </DialogHeader>
              <DialogBody className="grid gap-5 min-[621px]:grid-cols-2">
                <fieldset className="m-0 grid gap-2 border-0 p-0 min-[621px]:col-span-2">
                  <legend className={cn(labelClass, 'mb-1')}>Method</legend>
                  {methods.map((value) => (
                    <label key={value} className="flex items-center gap-2 text-small text-ink">
                      <input
                        checked={method === value}
                        name="correction-method"
                        onChange={() => setMethod(value)}
                        type="radio"
                        value={value}
                      />
                      {methodLabel[value]}
                    </label>
                  ))}
                </fieldset>
                <Field htmlFor="correction-period" label="Finalized payroll">
                  <select
                    className={inputClass}
                    id="correction-period"
                    onChange={set('periodId')}
                    required
                    value={draft.periodId}
                  >
                    <option value="">
                      {finalized.length === 0
                        ? 'No Finalized Payroll Period yet'
                        : 'Choose a Payroll Period'}
                    </option>
                    {finalized.map((period) => (
                      <option key={period.id} value={period.id}>
                        {period.code} · {dateLabel(period.periodFrom)} to{' '}
                        {dateLabel(period.periodTo)}
                      </option>
                    ))}
                  </select>
                </Field>
                {method === 'ADJUSTMENT' ? (
                  employees.length > 0 ? (
                    <Field htmlFor="correction-employee" label="Employee">
                      <select
                        className={inputClass}
                        id="correction-employee"
                        onChange={set('employeeId')}
                        value={draft.employeeId}
                      >
                        <option value="">All of its Employees</option>
                        {employees.map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.legalName} · {employee.employeeNumber}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : (
                    // Without personnel.employees.read the register can't be listed, so the
                    // actor names the Employee, or none for all of the period's Employees.
                    <Field htmlFor="correction-employee" label="Employee ID (blank for all)">
                      <input
                        className={inputClass}
                        id="correction-employee"
                        onChange={set('employeeId')}
                        value={draft.employeeId}
                      />
                    </Field>
                  )
                ) : evidenceReadable ? (
                  <Field htmlFor="correction-document" label="Supporting document">
                    <select
                      className={inputClass}
                      id="correction-document"
                      onChange={set('documentVersionId')}
                      required
                      value={draft.documentVersionId}
                    >
                      <option value="">Choose a Document Version</option>
                      {authorities.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  // Without documents.evidence.read the Agency's Document Versions can't be
                  // listed, so the requester names the one that supports the void.
                  <Field htmlFor="correction-document" label="Supporting Document Version ID">
                    <input
                      className={inputClass}
                      id="correction-document"
                      onChange={set('documentVersionId')}
                      required
                      value={draft.documentVersionId}
                    />
                  </Field>
                )}
                <div className="min-[621px]:col-span-2">
                  <Field htmlFor="correction-reason" label="Reason">
                    <textarea
                      className={cn(inputClass, 'min-h-24 py-2')}
                      id="correction-reason"
                      maxLength={2000}
                      onChange={set('reason')}
                      required
                      value={draft.reason}
                    />
                  </Field>
                </div>
                {chosen ? (
                  <p className="m-0 text-caption text-ink-muted min-[621px]:col-span-2">
                    {chosen.code} was finalized{' '}
                    {chosen.finalizedAt ? instantLabel(chosen.finalizedAt) : ''}.
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
                <Button disabled={busy || !draft.periodId} type="submit" variant="primary">
                  {method === 'ADJUSTMENT' ? 'Open Payroll Adjustment' : 'Request void'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </div>
    </Dialog>
  );
}
