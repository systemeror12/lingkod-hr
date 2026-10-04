'use client';

import { useEffect, useState } from 'react';
import { cn } from '../lib/class-names';
import { obligationStatus, remainingQuantity } from '../lib/mandatory-leave';
import { RecordReturn, useRecordNavigation } from './record-navigation';
import { StateSurface } from './state-surface';
import { Button, buttonVariants } from './ui/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { FormError, inputClass } from './ui/field';
import { PageHeader } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag } from './ui/status-tag';
import { RowHeader, Table, Td, Th, Tr } from './ui/table';

type MandatoryLeaveResult = 'SUBJECT' | 'NOT_SUBJECT' | 'INDETERMINATE';

export interface MandatoryLeaveAssessment {
  id: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  assessmentYear: number;
  assessmentDate: string;
  result: MandatoryLeaveResult;
  requiredQuantity: string | null;
  fulfilledQuantity: string | null;
  isLatest: boolean;
  assessedAt: string;
}

export interface MandatoryLeaveEmployeeLatest {
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  assessment: MandatoryLeaveAssessment | null;
}

export interface MandatoryLeaveLatestResponse {
  assessmentYear: number;
  employees: MandatoryLeaveEmployeeLatest[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface AuthorityCitation {
  citation: string;
  title: string;
}

interface MandatoryLeaveAssessmentDetail extends MandatoryLeaveAssessment {
  inputFacts: {
    policy: { versionNo: number; authorityCitations: AuthorityCitation[] } | null;
    thresholdBasis: {
      minimumAccountCredits: string;
      reached: boolean;
      reachedOn: string | null;
    } | null;
    vacationAccount: { id: string; status: string; openedAt: string } | null;
    balanceFacts: { openingBalance: string; balanceAsOf: string; ledgerEntryIds: string[] } | null;
    fulfillmentFacts: {
      allocations: {
        lineId: string;
        leavePostingId: string;
        leaveApplicationVersionId: string;
        dateFrom: string;
        dateTo: string;
        netQuantity: string;
      }[];
      unattributableLineIds: string[];
    } | null;
    indeterminateReasons: string[];
  };
  ruleResults: {
    rule: string;
    outcome: string;
    detail: string;
    authorityCitations: AuthorityCitation[];
  }[];
}

interface AgencyEvaluation {
  assessmentYear: number;
  assessmentDate: string;
  employeeCount: number;
  recordedCount: number;
  unchangedCount: number;
  results: Record<MandatoryLeaveResult, number>;
}

const sectionTitleClass = 'm-0 text-panel-title text-ink';

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const error = (value as { error?: { message?: unknown } }).error;
  return typeof error?.message === 'string' ? error.message : fallback;
}

function dateLabel(value: string): string {
  const date = new Date(value.slice(0, 10) + 'T00:00:00.000Z');
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

function instantLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  });
}

function quantityLabel(value: string | null): string {
  if (value === null) return '—';
  if (!value.includes('.')) return value;
  return value.replace(/0+$/, '').replace(/\.$/, '');
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="m-0 text-body font-[600] text-ink">{value}</dd>
    </div>
  );
}

const sourceIdClass = 'font-mono text-caption text-ink-muted [overflow-wrap:anywhere]';

/** The account, ledger entries, and postings the assessment read, as recorded in its input facts. */
function Sources({ facts }: { facts: MandatoryLeaveAssessmentDetail['inputFacts'] }) {
  const { vacationAccount, balanceFacts, fulfillmentFacts } = facts;
  if (!vacationAccount && !balanceFacts && !fulfillmentFacts) return null;
  return (
    <section className="grid gap-3" aria-labelledby="mandatory-leave-sources-heading">
      <h3 className={sectionTitleClass} id="mandatory-leave-sources-heading">
        Sources
      </h3>
      <dl className="m-0 grid gap-3">
        {vacationAccount ? (
          <div>
            <dt className="text-caption text-ink-muted">Vacation Leave Account</dt>
            <dd className={cn('m-0', sourceIdClass)}>
              {vacationAccount.id} · {vacationAccount.status} · opened{' '}
              {dateLabel(vacationAccount.openedAt)}
            </dd>
          </div>
        ) : null}
        {balanceFacts ? (
          <div>
            <dt className="text-caption text-ink-muted">
              Ledger entries through {dateLabel(balanceFacts.balanceAsOf)} (opening balance{' '}
              {quantityLabel(balanceFacts.openingBalance)})
            </dt>
            <dd className="m-0">
              {balanceFacts.ledgerEntryIds.length === 0 ? (
                <span className="text-caption text-ink-muted">None</span>
              ) : (
                <ul className="m-0 grid gap-0.5 p-0 [list-style:none]">
                  {balanceFacts.ledgerEntryIds.map((id) => (
                    <li className={sourceIdClass} key={id}>
                      {id}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        ) : null}
        {fulfillmentFacts ? (
          <div>
            <dt className="text-caption text-ink-muted">Posted leave counted</dt>
            <dd className="m-0">
              {fulfillmentFacts.allocations.length === 0 ? (
                <span className="text-caption text-ink-muted">None</span>
              ) : (
                <ul className="m-0 grid gap-1 p-0 [list-style:none]">
                  {fulfillmentFacts.allocations.map((line) => (
                    <li className="grid gap-0.5" key={line.lineId}>
                      <span className="text-small text-ink">
                        {dateLabel(line.dateFrom)} – {dateLabel(line.dateTo)}:{' '}
                        {quantityLabel(line.netQuantity)} working days
                      </span>
                      <span className={sourceIdClass}>
                        Posting {line.leavePostingId} · Application version{' '}
                        {line.leaveApplicationVersionId}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {fulfillmentFacts.unattributableLineIds.length > 0 ? (
                <p className={cn('m-0 mt-1', sourceIdClass)}>
                  Not counted: {fulfillmentFacts.unattributableLineIds.join(', ')}
                </p>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function Citations({ citations }: { citations: AuthorityCitation[] }) {
  if (citations.length === 0) return null;
  return (
    <ul className="m-0 grid gap-0.5 p-0 text-caption text-ink-muted [list-style:none]">
      {citations.map(({ citation, title }) => (
        <li key={citation}>
          {citation} — {title}
        </li>
      ))}
    </ul>
  );
}

/** Opens the existing Leave Application prepare form for this Employee. */
function fileLeaveHref(employeeId: string, canRecordForOthers: boolean): string {
  const params = new URLSearchParams({ prepare: '1', leaveType: 'MANDATORY_LEAVE' });
  if (canRecordForOthers) params.set('employeeId', employeeId);
  return '/leave-applications?' + params.toString();
}

export function MandatoryLeaveWorkspace({
  agencyId,
  initial,
  canEvaluate,
  canFile,
  canRecordForOthers,
}: {
  agencyId: string;
  initial: MandatoryLeaveLatestResponse;
  canEvaluate: boolean;
  canFile: boolean;
  canRecordForOthers: boolean;
}) {
  const navigation = useRecordNavigation();
  const recordId = navigation.search.get('record');
  const year = initial.assessmentYear;
  const [rows, setRows] = useState(initial.employees);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detail, setDetail] = useState<MandatoryLeaveAssessmentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [evaluation, setEvaluation] = useState<AgencyEvaluation | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [yearInput, setYearInput] = useState(String(year));

  useEffect(() => {
    let active = true;
    setDetail(null);
    setDetailError('');
    if (!recordId) return;
    setDetailLoading(true);
    void request('/mandatory-leave-assessments/' + encodeURIComponent(recordId))
      .then((value) => {
        if (active) setDetail(value as MandatoryLeaveAssessmentDetail);
      })
      .catch((reason: unknown) => {
        if (active)
          setDetailError(reason instanceof Error ? reason.message : 'This record is unavailable.');
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [recordId]);

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch('/api/v1/agencies/' + agencyId + path, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(errorMessage(value, 'The Mandatory Leave Assessment action failed.'));
    }
    return value;
  }

  function latestPath(cursor: string | null): string {
    return (
      '/mandatory-leave-assessments/latest?year=' +
      year +
      (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')
    );
  }

  async function loadMore(): Promise<void> {
    if (!nextCursor) return;
    setLoadingMore(true);
    setError('');
    try {
      const page = (await request(latestPath(nextCursor))) as MandatoryLeaveLatestResponse;
      setRows((current) => [...current, ...page.employees]);
      setNextCursor(page.nextCursor);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'More Employees could not be loaded.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function evaluate(): Promise<void> {
    setBusy(true);
    setError('');
    setEvaluation(null);
    try {
      const result = (await request('/mandatory-leave-assessments/evaluations', {
        method: 'POST',
        body: JSON.stringify({ year }),
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      })) as AgencyEvaluation;
      const page = (await request(latestPath(null))) as MandatoryLeaveLatestResponse;
      setRows(page.employees);
      setNextCursor(page.nextCursor);
      setEvaluation(result);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The evaluation could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  const status = detail ? obligationStatus(detail) : null;
  const remaining = detail ? remainingQuantity(detail) : null;

  return (
    <Dialog
      presentation="form"
      open={recordId !== null}
      onOpenChange={(open) => !open && navigation.navigate({ record: null })}
    >
      <div className="grid min-w-0 gap-5">
        <PageHeader
          breadcrumbs={[{ label: 'Leave' }]}
          title="Mandatory Leave"
          actions={
            canEvaluate ? (
              <Button
                disabled={busy || loadingMore}
                hidden={recordId !== null}
                onClick={() => void evaluate()}
                type="button"
                variant="primary"
              >
                {busy ? 'Evaluating…' : 'Evaluate ' + year}
              </Button>
            ) : null
          }
        />

        <div hidden={recordId !== null} className="grid min-w-0 gap-5">
          <p className="m-0 max-w-[760px] text-small text-ink-muted">
            Each row shows the latest recorded Mandatory Leave Assessment for the year. An
            assessment explains the obligation as of its date; it is not a leave approval, a
            certification, or a forfeiture. Leave filed after an assessment counts only when the
            year is evaluated again.
          </p>

          {evaluation ? (
            <p
              className="m-0 rounded-control border border-success/40 bg-success/5 px-3 py-2.5 text-small text-success"
              role="status"
            >
              Evaluated {evaluation.employeeCount}{' '}
              {evaluation.employeeCount === 1 ? 'Employee' : 'Employees'} as of{' '}
              {dateLabel(evaluation.assessmentDate)}: {evaluation.recordedCount} recorded,{' '}
              {evaluation.unchangedCount} unchanged. {evaluation.results.SUBJECT} SUBJECT,{' '}
              {evaluation.results.NOT_SUBJECT} NOT_SUBJECT, {evaluation.results.INDETERMINATE}{' '}
              INDETERMINATE.
            </p>
          ) : null}
          <FormError message={error} />

          <Panel
            title={'Assessments for ' + year}
            flush
            actions={
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  navigation.navigate({ year: yearInput, record: null });
                }}
              >
                <label
                  className="flex items-center gap-2 text-caption font-[650] text-ink"
                  htmlFor="mandatory-leave-year"
                >
                  Year
                </label>
                <input
                  className={cn(inputClass, 'w-24')}
                  id="mandatory-leave-year"
                  inputMode="numeric"
                  onChange={(event) =>
                    setYearInput((event.currentTarget as unknown as { value: string }).value)
                  }
                  pattern="[0-9]{4}"
                  required
                  value={yearInput}
                />
                <Button type="submit" variant="secondary">
                  Show
                </Button>
              </form>
            }
          >
            {rows.length === 0 ? (
              <StateSurface compact label="Mandatory Leave Assessments">
                <strong className="font-[650] text-ink">
                  No Employees are visible in this scope.
                </strong>
              </StateSurface>
            ) : (
              <>
                <Table
                  aria-label={'Mandatory Leave Assessments for ' + year}
                  className="min-w-[860px]"
                >
                  <thead>
                    <tr>
                      <Th>Employee</Th>
                      <Th>Result</Th>
                      <Th kind="numeric">Required</Th>
                      <Th kind="numeric">Fulfilled</Th>
                      <Th kind="numeric">Remaining</Th>
                      <Th>As of</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ employeeId, employeeNumber, employeeName, assessment }) => {
                      const rowStatus = obligationStatus(assessment);
                      return (
                        <Tr key={employeeId}>
                          <RowHeader>
                            {assessment ? (
                              <button
                                className="cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-primary underline-offset-2 hover:underline"
                                type="button"
                                onClick={() => navigation.navigate({ record: assessment.id })}
                              >
                                {employeeName}
                              </button>
                            ) : (
                              <span className="font-[600]">{employeeName}</span>
                            )}
                            <span className="block font-mono text-caption font-normal text-ink-muted">
                              {employeeNumber}
                            </span>
                          </RowHeader>
                          <Td>
                            <StatusTag tone={rowStatus.tone}>{rowStatus.label}</StatusTag>
                          </Td>
                          <Td kind="numeric">
                            {quantityLabel(assessment?.requiredQuantity ?? null)}
                          </Td>
                          <Td kind="numeric">
                            {quantityLabel(assessment?.fulfilledQuantity ?? null)}
                          </Td>
                          <Td kind="numeric" className="font-[600]">
                            {assessment ? (remainingQuantity(assessment) ?? '—') : '—'}
                          </Td>
                          <Td>{assessment ? dateLabel(assessment.assessmentDate) : '—'}</Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
                {nextCursor ? (
                  <div className="px-4 py-3">
                    <Button
                      disabled={loadingMore || busy}
                      onClick={() => void loadMore()}
                      type="button"
                      variant="secondary"
                    >
                      {loadingMore ? 'Loading…' : 'Load more'}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </Panel>
        </div>
      </div>

      {recordId !== null ? (
        <div className="mb-4">
          <RecordReturn href={navigation.href({ record: null })}>← Mandatory Leave</RecordReturn>
        </div>
      ) : null}

      <DialogContent aria-describedby="mandatory-leave-dialog-description">
        <DialogHeader>
          <div className="grid min-w-0 gap-1.5">
            <DialogTitle>{detail?.employeeName ?? 'Mandatory Leave Assessment'}</DialogTitle>
            <DialogDescription id="mandatory-leave-dialog-description">
              The recorded assessment and its reasons. It is not a leave approval, a certification,
              or a forfeiture.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Close
            </Button>
          </DialogClose>
        </DialogHeader>

        <DialogBody className="grid gap-6">
          {detailLoading ? (
            <StateSurface compact busy label="Mandatory Leave Assessment">
              <p className="m-0" role="status">
                Loading the Mandatory Leave Assessment…
              </p>
            </StateSurface>
          ) : !detail ? (
            detailError ? (
              <StateSurface compact label="Mandatory Leave Assessment">
                <FormError message={detailError} />
              </StateSurface>
            ) : null
          ) : (
            <>
              {!detail.isLatest ? (
                <p
                  className="m-0 rounded-control border border-warning/40 bg-warning/5 px-3 py-2.5 text-small text-ink"
                  role="note"
                >
                  A later assessment supersedes this one.
                </p>
              ) : null}
              <section className="grid gap-3" aria-labelledby="mandatory-leave-result-heading">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className={sectionTitleClass} id="mandatory-leave-result-heading">
                      {detail.assessmentYear} assessment
                    </h3>
                    {status ? <StatusTag tone={status.tone}>{status.label}</StatusTag> : null}
                  </div>
                  {canFile && detail.isLatest && remaining !== null && remaining !== '0' ? (
                    <a
                      className={buttonVariants({ variant: 'primary', size: 'default' })}
                      href={fileLeaveHref(detail.employeeId, canRecordForOthers)}
                    >
                      File leave
                    </a>
                  ) : null}
                </div>
                <dl className="m-0 grid gap-4 min-[621px]:grid-cols-3">
                  <Fact label="Result" value={detail.result} />
                  <Fact
                    label="Required working days"
                    value={quantityLabel(detail.requiredQuantity)}
                  />
                  <Fact label="Fulfilled" value={quantityLabel(detail.fulfilledQuantity)} />
                  <Fact label="Remaining" value={remaining ?? '—'} />
                  <Fact label="As of" value={dateLabel(detail.assessmentDate)} />
                  <Fact label="Recorded" value={instantLabel(detail.assessedAt)} />
                  {detail.inputFacts.policy ? (
                    <Fact label="Policy version" value={'v' + detail.inputFacts.policy.versionNo} />
                  ) : null}
                  {detail.inputFacts.thresholdBasis?.reachedOn ? (
                    <Fact
                      label={
                        'Reached ' +
                        quantityLabel(detail.inputFacts.thresholdBasis.minimumAccountCredits) +
                        ' credits on'
                      }
                      value={dateLabel(detail.inputFacts.thresholdBasis.reachedOn)}
                    />
                  ) : null}
                </dl>
                {canFile && remaining !== null && remaining !== '0' ? (
                  <p className="m-0 text-small text-ink-muted">
                    File ordinary leave to fulfill the obligation. Mandatory Leave and Vacation
                    Leave both charge the Vacation Leave Account, and posted days of either count
                    once the year is evaluated again.
                  </p>
                ) : null}
                {detail.inputFacts.policy ? (
                  <Citations citations={detail.inputFacts.policy.authorityCitations} />
                ) : null}
              </section>

              {detail.inputFacts.indeterminateReasons.length > 0 ? (
                <section className="grid gap-2" aria-labelledby="mandatory-leave-reasons-heading">
                  <h3 className={sectionTitleClass} id="mandatory-leave-reasons-heading">
                    Why the result is indeterminate
                  </h3>
                  <ul className="m-0 grid gap-1 pl-5 font-mono text-small text-ink">
                    {detail.inputFacts.indeterminateReasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <Sources facts={detail.inputFacts} />

              <section className="grid gap-3" aria-labelledby="mandatory-leave-rules-heading">
                <h3 className={sectionTitleClass} id="mandatory-leave-rules-heading">
                  Rule results
                </h3>
                <ul className="m-0 grid gap-3 p-0 [list-style:none]">
                  {detail.ruleResults.map(
                    ({ rule, outcome, detail: explanation, authorityCitations }, index) => (
                      <li className="grid gap-1" key={rule + index}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-small font-[600] text-ink">{rule}</span>
                          <StatusTag
                            tone={
                              outcome === 'PASS'
                                ? 'success'
                                : outcome === 'FAIL'
                                  ? 'warning'
                                  : outcome === 'INDETERMINATE'
                                    ? 'danger'
                                    : 'neutral'
                            }
                          >
                            {outcome}
                          </StatusTag>
                        </div>
                        <p className="m-0 text-small text-ink">{explanation}</p>
                        <Citations citations={authorityCitations} />
                      </li>
                    ),
                  )}
                </ul>
              </section>
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
