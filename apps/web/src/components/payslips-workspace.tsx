'use client';

import { Fragment, useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { AuthorityOption, EmployeeOption } from '../lib/payroll-page-data';
import { decimalLabel } from '../lib/payroll-inputs';
import {
  contributionTypeLabel,
  confirmedCheckpoints,
  exceptionMessage,
  exceptionStatusDisplay,
  exceptionTypeLabel,
  lineSourceLabel,
  lineTypeLabel,
  moneyLabel,
  instantLabel,
  periodStatusDisplay,
  resultStatusDisplay,
  reviewActions,
  runTypeLabel,
  severityDisplay,
  stageCells,
  startsCollapsed,
  type ContributionBilling,
  type PayrollException,
  type PayrollLine,
  type PayrollPeriod,
  type PayrollPeriodList,
  type PayrollPeriodReview,
  type PayrollResult,
  type PayrollResultDetail,
  type PayrollRunType,
  type ReviewAction,
} from '../lib/payroll-periods';
import { dateLabel } from '../lib/overtime-format';
import { cn } from '../lib/class-names';
import {
  ContributionBillingForm,
  ContributionBillingTable,
  type ContributionBillingInput,
} from './contribution-billings';
import { Facts } from './payroll-inputs-workspace';
import { ContributionsTaxDeductions } from './payslip-deductions';
import { actionLabel, PayrollReview } from './payroll-review';
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

/** How often the list is read again while a calculation runs. */
const CALCULATING_POLL_MS = 3_000;

type PeriodDetail =
  | { key: string; state: 'loading' }
  | { key: string; state: 'error'; message: string }
  | {
      key: string;
      state: 'ready';
      results: PayrollResult[];
      exceptions: PayrollException[];
      billings: ContributionBilling[];
      /** Who acted and what certifying binds; null before the period is calculated. */
      review: PayrollPeriodReview | null;
    };

type Form =
  | { kind: 'create' }
  | { kind: 'payslip'; periodId: string; resultId: string }
  | { kind: 'billing'; periodId: string }
  | null;

type Payslip =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; result: PayrollResultDetail };

type Decision = { exceptionId: string; action: 'acknowledge' | 'resolve'; reason: string };

const emptyDraft = {
  code: '',
  runType: 'REGULAR' as PayrollRunType,
  periodFrom: '',
  periodTo: '',
  cutoffAt: '',
  paymentDate: '',
  payComponentIds: [] as string[],
};

/** What a period's payslips and exceptions were read for; a change reads them again. */
const detailKey = (period: PayrollPeriod) =>
  `${period.id}:${period.calculationVersion}:${period.rowVersion}`;

function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function message(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

/**
 * Employee Payslips, the Payroll workspace (#327): payslips grouped by Payroll Period, each
 * group with its stage, totals, the next step the signed-in actor can take, and its Payroll
 * Exceptions; and the payslip form, whose Salary Computation shows each Payroll Line with its
 * rule version and sources, then its contributions, tax, and deductions. A regular period also
 * lists its issuer contribution billing, which a deductions manager records while it is in Draft.
 * From For review to Finalized, each period shows its Approvals and the review commands the actor's
 * permissions and the period's state allow. The API decides every refusal; this screen shows its
 * reason.
 */
export function PayslipsWorkspace({
  agencyId,
  authorities,
  canCreate,
  canCalculate,
  canManageDeductions,
  employees,
  evidenceReadable = false,
  initialList,
  reviewPermissions = [],
}: {
  agencyId: string;
  authorities: AuthorityOption[];
  canCreate: boolean;
  canCalculate: boolean;
  canManageDeductions: boolean;
  employees: EmployeeOption[];
  /** Whether the actor can list the Agency's Document Versions to cite as review evidence. */
  evidenceReadable?: boolean;
  initialList: PayrollPeriodList;
  /** The review permissions (`REVIEW_PERMISSIONS`) the actor holds Agency-wide. */
  reviewPermissions?: string[];
}) {
  const [list, setList] = useState(initialList);
  // Periods the actor opened or closed; any other starts open unless it is finished.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [details, setDetails] = useState<Record<string, PeriodDetail>>({});
  const [form, setForm] = useState<Form>(null);
  const [payslip, setPayslip] = useState<Payslip | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [acting, setActing] = useState<{ periodId: string; action: ReviewAction } | null>(null);
  const held = new Set(reviewPermissions);
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const periodById = new Map(list.periods.map((period) => [period.id, period]));
  const isOpen = (period: PayrollPeriod) => toggled[period.id] ?? !startsCollapsed(period.status);

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

  const refreshList = useCallback(async () => {
    const next = (await request('/payroll-periods')) as PayrollPeriodList;
    setList(next);
    return next;
  }, [request]);

  const loadDetail = useCallback(
    async (period: PayrollPeriod) => {
      const key = detailKey(period);
      setDetails((current) => ({ ...current, [period.id]: { key, state: 'loading' } }));
      try {
        // A version that is computing has no results yet, and an uncalculated period has none.
        const calculated = period.calculationVersion > 0 && period.status !== 'CALCULATING';
        const [results, exceptions, billings, review] = await Promise.all([
          calculated
            ? (request(`/payroll-periods/${period.id}/results`) as Promise<{
                results: PayrollResult[];
              }>)
            : { results: [] },
          calculated
            ? (request(`/payroll-periods/${period.id}/exceptions`) as Promise<{
                exceptions: PayrollException[];
              }>)
            : { exceptions: [] },
          // Only a regular period takes contribution billing.
          period.runType === 'REGULAR'
            ? (request(`/payroll-periods/${period.id}/contribution-billings`) as Promise<{
                billings: ContributionBilling[];
              }>)
            : { billings: [] },
          calculated
            ? (request(`/payroll-periods/${period.id}`) as Promise<{
                period: PayrollPeriodReview;
              }>)
            : { period: null },
        ]);
        setDetails((current) => ({
          ...current,
          [period.id]: {
            key,
            state: 'ready',
            results: results.results,
            exceptions: exceptions.exceptions,
            billings: billings.billings,
            review: review.period,
          },
        }));
      } catch (caught: unknown) {
        setDetails((current) => ({
          ...current,
          [period.id]: {
            key,
            state: 'error',
            message: message(caught, 'The payslips could not be loaded.'),
          },
        }));
      }
    },
    [request],
  );

  // Read an expanded period's payslips and exceptions when it opens or its version changes.
  useEffect(() => {
    for (const period of list.periods) {
      const open = toggled[period.id] ?? !startsCollapsed(period.status);
      if (open && details[period.id]?.key !== detailKey(period)) void loadDetail(period);
    }
  }, [list, toggled, details, loadDetail]);

  // A calculation runs in the background; read the list again until none is computing.
  const computing = list.periods.some((period) => period.status === 'CALCULATING');
  useEffect(() => {
    if (!computing) return;
    const timer = setTimeout(() => {
      refreshList().catch((caught: unknown) =>
        setError(message(caught, 'The Payroll Periods could not be read again.')),
      );
    }, CALCULATING_POLL_MS);
    return () => clearTimeout(timer);
  }, [computing, list, refreshList]);

  function toggle(period: PayrollPeriod): void {
    setToggled((current) => ({ ...current, [period.id]: !isOpen(period) }));
  }

  function employeeLabel(employeeId: string | null): ReactNode {
    if (employeeId === null) return 'Whole period';
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

  async function startCalculation(period: PayrollPeriod): Promise<void> {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request(`/payroll-periods/${period.id}/calculate`, {
        method: 'POST',
        body: JSON.stringify({ rowVersion: period.rowVersion }),
      });
      await refreshList();
      setNotice(
        `Calculation of ${period.code} started. It is not complete until the period leaves Computing.`,
      );
    } catch (caught: unknown) {
      setError(message(caught, 'The calculation could not be started.'));
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await request('/payroll-periods', {
        method: 'POST',
        body: JSON.stringify({
          ...draft,
          cutoffAt: draft.cutoffAt ? `${draft.cutoffAt}:00+08:00` : '',
          payComponentIds: draft.runType === 'SPECIAL' ? draft.payComponentIds : [],
        }),
      });
      await refreshList();
      setForm(null);
      setNotice(`Payroll Period ${draft.code} created in Draft.`);
    } catch (caught: unknown) {
      setError(message(caught, 'The Payroll Period could not be created.'));
    } finally {
      setBusy(false);
    }
  }

  async function decide(periodId: string, event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!decision) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request(
        `/payroll-periods/${periodId}/exceptions/${decision.exceptionId}/${decision.action}`,
        { method: 'POST', body: JSON.stringify({ reason: decision.reason }) },
      );
      setDecision(null);
      setNotice(
        decision.action === 'acknowledge' ? 'Warning acknowledged.' : 'Exception resolved.',
      );
      const period = periodById.get(periodId);
      if (period) await loadDetail(period);
    } catch (caught: unknown) {
      setError(message(caught, 'The exception could not be decided.'));
    } finally {
      setBusy(false);
    }
  }

  async function recordBilling(periodId: string, input: ContributionBillingInput): Promise<void> {
    setBusy(true);
    setError('');
    try {
      await request(`/payroll-periods/${periodId}/contribution-billings`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      const period = periodById.get(periodId);
      if (period) await loadDetail(period);
      setForm(null);
      const count = input.lines.length;
      setNotice(
        `${contributionTypeLabel[input.contributionType]} billing recorded for ${count === 1 ? '1 Employee' : `${count} Employees`}. The next calculation compares it.`,
      );
    } catch (caught: unknown) {
      setError(message(caught, 'The contribution billing could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  function openBilling(periodId: string): void {
    setError('');
    setNotice('');
    setForm({ kind: 'billing', periodId });
  }

  function evidenceLabel(versionId: string): ReactNode {
    const authority = authorities.find((option) => option.id === versionId);
    if (authority) return authority.label;
    return <span className="font-mono text-caption break-all">{versionId}</span>;
  }

  async function openPayslip(periodId: string, resultId: string): Promise<void> {
    setError('');
    setNotice('');
    setDecision(null);
    setForm({ kind: 'payslip', periodId, resultId });
    setPayslip({ state: 'loading' });
    try {
      const { result } = (await request(`/payroll-periods/${periodId}/results/${resultId}`)) as {
        result: PayrollResultDetail;
      };
      setPayslip({ state: 'ready', result });
    } catch (caught: unknown) {
      setPayslip({ state: 'error', message: message(caught, 'The payslip could not be loaded.') });
    }
  }

  function openCreate(): void {
    setDraft(emptyDraft);
    setError('');
    setNotice('');
    setForm({ kind: 'create' });
  }

  const set = (key: Exclude<keyof typeof emptyDraft, 'payComponentIds'>) =>
    function update(event: { currentTarget: EventTarget }) {
      const value = targetValue(event);
      setDraft((current) => ({ ...current, [key]: value }));
    };

  function reviewOf(period: PayrollPeriod): PayrollPeriodReview | null {
    const detail = details[period.id];
    return detail?.state === 'ready' ? detail.review : null;
  }

  function actionsOf(period: PayrollPeriod): ReviewAction[] {
    const review = reviewOf(period);
    return review ? reviewActions(review, held) : [];
  }

  /** After a review command: read the list and the period again, and say what changed. */
  async function reviewed(periodId: string, done: string): Promise<void> {
    setError('');
    setNotice(done);
    try {
      const next = await refreshList();
      const period = next.periods.find((item) => item.id === periodId);
      if (period) await loadDetail(period);
    } catch (caught: unknown) {
      setError(message(caught, 'The Payroll Periods could not be read again.'));
    }
  }

  function reviewSection(period: PayrollPeriod): ReactNode {
    const review = reviewOf(period);
    if (!review) return null;
    return (
      <PayrollReview
        acting={acting?.periodId === period.id ? acting.action : null}
        actions={actionsOf(period)}
        code={period.code}
        evidenceOptions={authorities}
        evidenceReadable={evidenceReadable}
        onAct={(action) => {
          setActing(action ? { periodId: period.id, action } : null);
          // A period acted on stays open, even once it is finished.
          if (action) setToggled((current) => ({ ...current, [period.id]: true }));
        }}
        onDone={(done) => reviewed(period.id, done)}
        request={request}
        review={review}
      />
    );
  }

  function nextStep(period: PayrollPeriod): ReactNode {
    // The one next step that moves the period forward for this actor; the rest sit in its body.
    const primary = actionsOf(period).find((action) => action.primary);
    if (primary) {
      return (
        <Button
          disabled={busy}
          onClick={() => {
            setNotice('');
            setActing({ periodId: period.id, action: primary });
            setToggled((current) => ({ ...current, [period.id]: true }));
          }}
          type="button"
          variant="primary"
        >
          {actionLabel(primary)}
          <span className="sr-only"> for {period.code}</span>
        </Button>
      );
    }
    if (period.status === 'DRAFT' && canCalculate) {
      return (
        <Button
          disabled={busy}
          onClick={() => void startCalculation(period)}
          type="button"
          variant="primary"
        >
          Start calculation
        </Button>
      );
    }
    return null;
  }

  function exceptionTable(period: PayrollPeriod, exceptions: PayrollException[]): ReactNode {
    return (
      <Table className="min-w-[880px]">
        <thead>
          <tr>
            <Th>Severity</Th>
            <Th>Exception</Th>
            <Th>Employee</Th>
            <Th>Status</Th>
            {canCalculate ? <Th>Action</Th> : null}
          </tr>
        </thead>
        <tbody>
          {exceptions.map((exception) => {
            const reason = exceptionMessage(exception.details);
            const deciding = decision?.exceptionId === exception.id ? decision : null;
            return (
              <Fragment key={exception.id}>
                <Tr>
                  <Td>
                    <StatusTag tone={severityDisplay[exception.severity].tone}>
                      {severityDisplay[exception.severity].label}
                    </StatusTag>
                  </Td>
                  <Td>
                    <strong className="font-[600] text-ink">
                      {exceptionTypeLabel(exception.exceptionType)}
                    </strong>
                    {reason ? (
                      <span className="block max-w-[560px] text-caption text-ink-muted">
                        {reason}
                      </span>
                    ) : null}
                  </Td>
                  <Td>{employeeLabel(exception.employeeId)}</Td>
                  <Td>
                    <StatusTag tone={exceptionStatusDisplay[exception.status].tone}>
                      {exceptionStatusDisplay[exception.status].label}
                    </StatusTag>
                    {exception.reason ? (
                      <span className="block max-w-[280px] text-caption text-ink-muted">
                        {exception.reason}
                      </span>
                    ) : null}
                  </Td>
                  {canCalculate ? (
                    <Td>
                      {exception.status === 'OPEN' && !deciding ? (
                        <div className="flex flex-wrap gap-2">
                          {exception.severity === 'WARNING' ? (
                            <Button
                              onClick={() =>
                                setDecision({
                                  exceptionId: exception.id,
                                  action: 'acknowledge',
                                  reason: '',
                                })
                              }
                              type="button"
                              variant="secondary"
                            >
                              Acknowledge
                            </Button>
                          ) : null}
                          <Button
                            onClick={() =>
                              setDecision({
                                exceptionId: exception.id,
                                action: 'resolve',
                                reason: '',
                              })
                            }
                            type="button"
                            variant="secondary"
                          >
                            Resolve
                          </Button>
                        </div>
                      ) : null}
                    </Td>
                  ) : null}
                </Tr>
                {deciding ? (
                  <tr>
                    <td className="border-b border-border-subtle bg-canvas px-4 py-3" colSpan={5}>
                      <form
                        className="grid max-w-[640px] gap-3"
                        onSubmit={(event) => void decide(period.id, event)}
                      >
                        <Field
                          htmlFor={`exception-reason-${exception.id}`}
                          label={
                            deciding.action === 'acknowledge'
                              ? 'Reason for acknowledging this warning'
                              : 'Reason for resolving this exception'
                          }
                        >
                          <textarea
                            className={cn(inputClass, 'min-h-20 py-2')}
                            id={`exception-reason-${exception.id}`}
                            onChange={(event) =>
                              setDecision({ ...deciding, reason: targetValue(event) })
                            }
                            required
                            value={deciding.reason}
                          />
                        </Field>
                        <div className="flex flex-wrap gap-2">
                          <Button disabled={busy} type="submit" variant="primary">
                            {deciding.action === 'acknowledge'
                              ? 'Acknowledge warning'
                              : 'Resolve exception'}
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
    );
  }

  function periodBody(period: PayrollPeriod): ReactNode {
    const detail = details[period.id];
    const totals = period.totals;
    return (
      <div className="grid gap-5">
        <div className="grid gap-5 p-4">
          <StageBar period={period} review={reviewOf(period)} />
          <Facts
            facts={[
              ['Run type', runTypeLabel[period.runType]],
              ['Period', `${dateLabel(period.periodFrom)} – ${dateLabel(period.periodTo)}`],
              ['Cutoff', instantLabel(period.cutoffAt)],
              ['Payment date', dateLabel(period.paymentDate)],
              [
                'Calculation version',
                period.status === 'CALCULATING'
                  ? `Version ${period.calculationVersion}, computing…`
                  : period.calculationVersion === 0
                    ? 'Not calculated'
                    : `Version ${period.calculationVersion}`,
              ],
              ['Payslips', totals ? String(totals.resultCount) : '—'],
              ['Gross', totals ? moneyLabel(totals.grossAmount) : '—'],
              ['Deductions', totals ? moneyLabel(totals.totalDeductions) : '—'],
              ['Net pay', totals ? moneyLabel(totals.netAmount) : '—'],
            ]}
          />
        </div>
        {detail?.state === 'ready' && detail.review ? (
          <div className="px-4">{reviewSection(period)}</div>
        ) : null}
        {period.status === 'CALCULATING' ? (
          <StateSurface busy compact label={`${period.code} payslips`}>
            <strong className="text-body font-[650] text-ink">
              Computing calculation version {period.calculationVersion}…
            </strong>
            <p className="m-0">
              Payslips and exceptions appear when the calculation finishes. This page checks again
              every few seconds.
            </p>
          </StateSurface>
        ) : !detail || detail.state === 'loading' ? (
          <StateSurface busy compact label={`${period.code} payslips`}>
            Loading payslips…
          </StateSurface>
        ) : detail.state === 'error' ? (
          <div className="px-4 pb-4">
            <FormError message={detail.message} />
          </div>
        ) : (
          <>
            <section aria-label={`${period.code} payslips`} className="grid gap-2">
              <h3 className="m-0 px-4 text-panel-title text-ink">Payslips</h3>
              {detail.results.length === 0 ? (
                <StateSurface compact label={`${period.code} has no payslips`}>
                  {period.calculationVersion === 0
                    ? 'No payslips yet. They appear once the period is calculated.'
                    : 'This calculation version has no payslips.'}
                </StateSurface>
              ) : (
                <Table className="min-w-[760px]">
                  <thead>
                    <tr>
                      <Th>Employee</Th>
                      <Th>Status</Th>
                      <Th kind="numeric">Gross</Th>
                      <Th kind="numeric">Deductions</Th>
                      <Th kind="numeric">Net pay</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.results.map((result) => {
                      const display = resultStatusDisplay(result.status);
                      const employee = employeeById.get(result.employeeId);
                      return (
                        <Tr key={result.id} selected={payslipOpen(result.id)}>
                          <Td>
                            <DialogTrigger asChild>
                              <button
                                className="w-fit cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-primary hover:underline"
                                onClick={() => void openPayslip(period.id, result.id)}
                                type="button"
                              >
                                {employee?.legalName ?? result.employeeId}
                              </button>
                            </DialogTrigger>
                            {employee ? (
                              <span className="block text-caption text-ink-muted">
                                {employee.employeeNumber}
                              </span>
                            ) : null}
                          </Td>
                          <Td>
                            <StatusTag tone={display.tone}>{display.label}</StatusTag>
                          </Td>
                          <Td kind="numeric">{moneyLabel(result.grossAmount)}</Td>
                          <Td kind="numeric">{moneyLabel(result.totalDeductions)}</Td>
                          <Td kind="numeric">{moneyLabel(result.netAmount)}</Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </section>
            {period.calculationVersion > 0 ? (
              <section aria-label={`${period.code} exceptions`} className="grid gap-2 pb-2">
                <h3 className="m-0 px-4 text-panel-title text-ink">Exceptions</h3>
                {detail.exceptions.length === 0 ? (
                  <StateSurface compact label={`${period.code} has no exceptions`}>
                    No exceptions in calculation version {period.calculationVersion}.
                  </StateSurface>
                ) : (
                  exceptionTable(period, detail.exceptions)
                )}
              </section>
            ) : null}
            {period.runType === 'REGULAR' ? (
              <section
                aria-label={`${period.code} contribution billing`}
                className="grid gap-2 pb-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 px-4">
                  <h3 className="m-0 text-panel-title text-ink">Contribution billing</h3>
                  {canManageDeductions && period.status === 'DRAFT' ? (
                    <DialogTrigger asChild>
                      <Button onClick={() => openBilling(period.id)} type="button">
                        Record billing
                        <span className="sr-only"> for {period.code}</span>
                      </Button>
                    </DialogTrigger>
                  ) : null}
                </div>
                <ContributionBillingTable
                  billings={detail.billings}
                  employeeLabel={employeeLabel}
                  evidenceLabel={evidenceLabel}
                />
              </section>
            ) : null}
          </>
        )}
      </div>
    );
  }

  function payslipOpen(resultId: string): boolean {
    return form?.kind === 'payslip' && form.resultId === resultId;
  }

  const openPeriod = form?.kind === 'payslip' ? periodById.get(form.periodId) : undefined;
  const billingPeriod = form?.kind === 'billing' ? periodById.get(form.periodId) : undefined;
  const openResult = payslip?.state === 'ready' ? payslip.result : null;
  const openEmployee = openResult ? employeeById.get(openResult.employeeId) : undefined;
  const openDetail = openPeriod ? details[openPeriod.id] : undefined;
  const openExceptions =
    openResult && openDetail?.state === 'ready'
      ? openDetail.exceptions.filter((exception) => exception.employeeId === openResult.employeeId)
      : [];

  const breadcrumbs: Breadcrumb[] = [{ label: 'Payroll' }, { label: 'Employee Payslips' }];
  if (form?.kind === 'create') breadcrumbs.push({ label: 'New Payroll Period' });
  if (billingPeriod) {
    breadcrumbs.push({ label: billingPeriod.code }, { label: 'Record contribution billing' });
  }
  if (openPeriod) breadcrumbs.push({ label: openPeriod.code });
  if (openResult) breadcrumbs.push({ label: openEmployee?.legalName ?? openResult.employeeId });

  return (
    <Dialog
      presentation="form"
      open={form !== null}
      onOpenChange={(next) => {
        if (next) return;
        setForm(null);
        setPayslip(null);
      }}
    >
      <div className="grid gap-5">
        <PageHeader
          breadcrumbs={breadcrumbs}
          title="Employee Payslips"
          actions={
            canCreate ? (
              <DialogTrigger asChild>
                <Button onClick={openCreate} type="button" variant="primary">
                  New Payroll Period
                </Button>
              </DialogTrigger>
            ) : null
          }
        />

        <div hidden={form !== null} className="grid min-w-0 gap-5">
          <p className="m-0 max-w-[760px] text-small text-ink-muted">
            Payslips are grouped by Payroll Period. A period moves through its stages as a whole:
            its calculation writes one payslip per Employee, and a blocking exception returns it to
            Draft.
          </p>
          <FormError message={form === null ? error : ''} />
          {notice && form === null ? (
            <p className="m-0 text-small text-ink" role="status">
              {notice}
            </p>
          ) : null}

          {list.periods.length === 0 ? (
            <StateSurface compact label="Payroll Periods">
              <strong className="text-body font-[650] text-ink">No Payroll Periods yet.</strong>
              <p className="m-0">A Payroll Preparer creates one to start a payroll.</p>
            </StateSurface>
          ) : (
            list.periods.map((period) => {
              const display = periodStatusDisplay[period.status];
              const open = isOpen(period);
              return (
                <Panel
                  key={period.id}
                  title={period.code}
                  flush
                  data-period={period.code}
                  aria-busy={period.status === 'CALCULATING'}
                  actions={
                    <>
                      <StatusTag tone={display.tone}>{display.label}</StatusTag>
                      <span className="text-caption text-ink-muted">
                        {period.totals
                          ? `${period.totals.resultCount === 1 ? '1 payslip' : `${period.totals.resultCount} payslips`} · Net ${moneyLabel(period.totals.netAmount)}`
                          : period.status === 'CALCULATING'
                            ? 'Totals pending'
                            : 'Not calculated'}
                      </span>
                      {nextStep(period)}
                      <Button aria-expanded={open} onClick={() => toggle(period)} type="button">
                        {open ? 'Collapse' : 'Expand'}
                        <span className="sr-only"> {period.code}</span>
                      </Button>
                    </>
                  }
                >
                  {open ? periodBody(period) : null}
                </Panel>
              );
            })
          )}
        </div>

        <DialogContent aria-describedby="payslips-form-description" aria-busy={busy}>
          {form?.kind === 'create' ? (
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void create(event)}>
              <DialogHeader>
                <div className="grid min-w-0 gap-1.5">
                  <DialogTitle>New Payroll Period</DialogTitle>
                  <DialogDescription id="payslips-form-description">
                    It is created in Draft. Calculation starts once its cutoff has passed.
                  </DialogDescription>
                </div>
              </DialogHeader>
              <DialogBody className="grid gap-5 min-[621px]:grid-cols-2">
                <Field htmlFor="payroll-period-code" label="Code">
                  <input
                    className={inputClass}
                    id="payroll-period-code"
                    maxLength={50}
                    onChange={set('code')}
                    required
                    value={draft.code}
                  />
                </Field>
                <Field htmlFor="payroll-period-run-type" label="Run type">
                  <select
                    className={inputClass}
                    id="payroll-period-run-type"
                    onChange={set('runType')}
                    value={draft.runType}
                  >
                    {Object.entries(runTypeLabel).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field htmlFor="payroll-period-from" label="Period from">
                  <input
                    className={inputClass}
                    id="payroll-period-from"
                    onChange={set('periodFrom')}
                    required
                    type="date"
                    value={draft.periodFrom}
                  />
                </Field>
                <Field htmlFor="payroll-period-to" label="Period to">
                  <input
                    className={inputClass}
                    id="payroll-period-to"
                    onChange={set('periodTo')}
                    required
                    type="date"
                    value={draft.periodTo}
                  />
                </Field>
                <Field htmlFor="payroll-period-cutoff" label="Cutoff (Philippine time)">
                  <input
                    className={inputClass}
                    id="payroll-period-cutoff"
                    onChange={set('cutoffAt')}
                    required
                    type="datetime-local"
                    value={draft.cutoffAt}
                  />
                </Field>
                <Field htmlFor="payroll-period-payment" label="Payment date">
                  <input
                    className={inputClass}
                    id="payroll-period-payment"
                    onChange={set('paymentDate')}
                    required
                    type="date"
                    value={draft.paymentDate}
                  />
                </Field>
                {draft.runType === 'SPECIAL' ? (
                  <fieldset className="m-0 grid gap-2 border-0 p-0 min-[621px]:col-span-2">
                    <legend className={cn(labelClass, 'mb-1')}>Components it pays</legend>
                    <div className="grid gap-1.5 min-[621px]:grid-cols-2">
                      {list.payComponents.map((component) => (
                        <label
                          key={component.id}
                          className="flex items-center gap-2 text-small text-ink"
                        >
                          <input
                            checked={draft.payComponentIds.includes(component.id)}
                            onChange={(event) => {
                              const checked = (
                                event.currentTarget as unknown as {
                                  checked: boolean;
                                }
                              ).checked;
                              setDraft((current) => ({
                                ...current,
                                payComponentIds: checked
                                  ? [...current.payComponentIds, component.id]
                                  : current.payComponentIds.filter((id) => id !== component.id),
                              }));
                            }}
                            type="checkbox"
                          />
                          {component.name}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : null}
                <FormError className="min-[621px]:col-span-2" message={error} />
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} type="submit" variant="primary">
                  Create period
                </Button>
              </DialogFooter>
            </form>
          ) : billingPeriod ? (
            <ContributionBillingForm
              authorities={authorities}
              busy={busy}
              employees={employees}
              error={error}
              onSubmit={(input) => void recordBilling(billingPeriod.id, input)}
              periodCode={billingPeriod.code}
            />
          ) : form?.kind === 'payslip' ? (
            <>
              <DialogHeader>
                <div className="grid min-w-0 gap-1.5">
                  <DialogTitle>
                    {openResult ? (openEmployee?.legalName ?? openResult.employeeId) : 'Payslip'}
                  </DialogTitle>
                  <DialogDescription id="payslips-form-description">
                    {openPeriod
                      ? `${openPeriod.code} · calculation version ${openResult?.calculationVersion ?? openPeriod.calculationVersion}. Read-only.`
                      : 'Read-only.'}
                  </DialogDescription>
                </div>
                {openResult ? (
                  <StatusTag tone={resultStatusDisplay(openResult.status).tone}>
                    {resultStatusDisplay(openResult.status).label}
                  </StatusTag>
                ) : null}
              </DialogHeader>
              <DialogBody className="grid gap-6">
                {openPeriod ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <StageBar period={openPeriod} review={reviewOf(openPeriod)} />
                    {nextStep(openPeriod)}
                  </div>
                ) : null}
                {openPeriod ? reviewSection(openPeriod) : null}
                <FormError message={error} />
                {notice ? (
                  <p className="m-0 text-small text-ink" role="status">
                    {notice}
                  </p>
                ) : null}
                {payslip?.state === 'loading' ? (
                  <StateSurface busy compact label="Payslip">
                    Loading payslip…
                  </StateSurface>
                ) : payslip?.state === 'error' ? (
                  <FormError message={payslip.message} />
                ) : openResult && openPeriod ? (
                  <>
                    <Facts
                      facts={[
                        ['Employee number', openEmployee?.employeeNumber ?? '—'],
                        [
                          'Period',
                          `${dateLabel(openPeriod.periodFrom)} – ${dateLabel(openPeriod.periodTo)}`,
                        ],
                        ['Payment date', dateLabel(openPeriod.paymentDate)],
                        ['Gross', moneyLabel(openResult.grossAmount)],
                        ['Deductions', moneyLabel(openResult.totalDeductions)],
                        ['Net pay', moneyLabel(openResult.netAmount)],
                      ]}
                    />
                    <SalaryComputation result={openResult} />
                    <ContributionsTaxDeductions result={openResult} />
                    {openExceptions.length > 0 ? (
                      <section aria-label="Payslip exceptions" className="grid gap-2">
                        <h3 className="m-0 text-panel-title text-ink">Exceptions</h3>
                        {exceptionTable(openPeriod, openExceptions)}
                      </section>
                    ) : null}
                    <p className="m-0 text-caption break-all text-ink-muted">
                      Calculation hash{' '}
                      <span className="font-mono">{openResult.calculationHash}</span>
                    </p>
                  </>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="secondary">
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

/**
 * The period's stages, each its own cell; only a reached Finalized is green. With the period read,
 * a certified period counts its confirmed checkpoint reviews.
 */
export function StageBar({
  period,
  review = null,
}: {
  period: PayrollPeriod;
  review?: PayrollPeriodReview | null;
}) {
  const confirmed =
    review && review.status === period.status ? confirmedCheckpoints(review).length : 0;
  const cells = stageCells(period.status, confirmed);
  if (!cells) {
    return <StatusTag tone="neutral">{periodStatusDisplay[period.status].label}</StatusTag>;
  }
  return (
    <ol aria-label={`${period.code} stage`} className="m-0 flex list-none flex-wrap gap-1 p-0">
      {cells.map((cell) => {
        const finalized = cell.label === 'Finalized' && cell.state !== 'pending';
        return (
          <li
            key={cell.label}
            aria-current={cell.state === 'current' ? 'step' : undefined}
            className={cn(
              'rounded-tag border px-2.5 py-1 text-caption font-[600] whitespace-nowrap',
              cell.state === 'pending' && 'border-border-subtle text-ink-muted',
              cell.label.startsWith('Reviewed ') && 'border-dashed',
              cell.state !== 'pending' && !finalized && 'border-info text-info',
              cell.state === 'current' && !finalized && 'bg-info/8',
              cell.label === 'Computing…' &&
                'border-dashed border-warning bg-transparent text-warning',
              finalized && 'border-success bg-success/8 text-success',
            )}
          >
            {cell.label}
          </li>
        );
      })}
    </ol>
  );
}

/** One Payroll Line per row, each opening to its rule version and sources, then the totals. */
export function SalaryComputation({ result }: { result: PayrollResultDetail }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section aria-label="Salary Computation" className="grid gap-2">
      <h3 className="m-0 text-panel-title text-ink">Salary Computation</h3>
      {result.lines.length === 0 ? (
        <StateSurface compact label="No Payroll Lines">
          {result.status === 'EXCEPTION'
            ? 'No Payroll Lines: a blocking exception stopped this payslip, so it has zero totals.'
            : 'This payslip has no Payroll Lines.'}
        </StateSurface>
      ) : (
        <Table className="min-w-[900px]">
          <thead>
            <tr>
              <Th>Component</Th>
              <Th>Source record</Th>
              <Th kind="numeric">Quantity</Th>
              <Th kind="numeric">Rate</Th>
              <Th kind="numeric">Amount</Th>
              <Th>Rule version</Th>
              <Th>
                <span className="sr-only">Details</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {result.lines.map((line) => (
              <Fragment key={line.id}>
                <Tr>
                  <Td>
                    <strong className="font-[600] text-ink">{line.payComponent.name}</strong>
                    <span className="block text-caption text-ink-muted">
                      {lineTypeLabel[line.lineType] ?? line.lineType}
                    </span>
                  </Td>
                  <Td>{sourceSummary(line)}</Td>
                  <Td kind="numeric">
                    {line.quantity === null ? '—' : decimalLabel(line.quantity)}
                  </Td>
                  <Td kind="numeric">{line.rate === null ? '—' : decimalLabel(line.rate)}</Td>
                  <Td kind="numeric">{moneyLabel(line.amount)}</Td>
                  <Td>{line.ruleVersion?.code ?? 'No rule version'}</Td>
                  <Td>
                    <Button
                      aria-expanded={open === line.id}
                      onClick={() => setOpen(open === line.id ? null : line.id)}
                      type="button"
                    >
                      {open === line.id ? 'Hide' : 'Sources'}
                      <span className="sr-only"> of {line.payComponent.name}</span>
                    </Button>
                  </Td>
                </Tr>
                {open === line.id ? (
                  <tr>
                    <td className="border-b border-border-subtle bg-canvas px-4 py-3" colSpan={7}>
                      <LineProvenance line={line} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            {(
              [
                ['Gross', result.grossAmount],
                ['Deductions', result.totalDeductions],
                ['Net pay', result.netAmount],
              ] as const
            ).map(([label, value]) => (
              <tr key={label}>
                <th
                  className="border-b border-border-subtle px-4 py-2 text-left font-[650] text-ink"
                  colSpan={4}
                  scope="row"
                >
                  {label}
                </th>
                <td className="border-b border-border-subtle px-4 py-2 text-right font-[650] whitespace-nowrap text-ink">
                  {moneyLabel(value)}
                </td>
                <td className="border-b border-border-subtle" colSpan={2} />
              </tr>
            ))}
          </tfoot>
        </Table>
      )}
    </section>
  );
}

/** The records a line rests on, or its calculation snapshot when it names none. */
export function sourceSummary(line: PayrollLine): string {
  const [first] = line.sources;
  if (!first) return 'Calculation snapshot';
  const more = line.sources.length - 1;
  return `${lineSourceLabel[first.kind]}${more > 0 ? ` and ${more} more` : ''}`;
}

function LineProvenance({ line }: { line: PayrollLine }) {
  return (
    <div className="grid gap-4">
      <Facts
        facts={[
          [
            'Rule version',
            line.ruleVersion ? `${line.ruleVersion.code} · ${line.ruleVersion.name}` : 'None',
          ],
          ['Component code', line.payComponent.code],
          ['Line type', lineTypeLabel[line.lineType] ?? line.lineType],
        ]}
      />
      <div className="grid gap-1">
        <span className="text-caption text-ink-muted">Source records</span>
        {line.sources.length === 0 ? (
          <span className="text-small text-ink">
            None: the line rests on the calculation snapshot below.
          </span>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0 text-small text-ink">
            {line.sources.map((source) => (
              <li key={`${source.kind}:${source.id}`}>
                {lineSourceLabel[source.kind]}{' '}
                <span className="font-mono text-caption break-all">{source.id}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid gap-1">
        <span className="text-caption text-ink-muted">Calculation snapshot</span>
        <pre className="m-0 max-h-72 overflow-auto rounded-control border border-border bg-surface p-3 font-mono text-caption whitespace-pre-wrap text-ink">
          {JSON.stringify(line.sourceSnapshot, null, 2)}
        </pre>
      </div>
    </div>
  );
}
