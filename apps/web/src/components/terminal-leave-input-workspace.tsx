'use client';

import { Field, inputClass, FormError } from './ui/field';
import { useState, type FormEvent, type ReactNode } from 'react';
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
import { Button } from './ui/button';
import { PageHeader, type Breadcrumb } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag, type StatusTone } from './ui/status-tag';
import { RowHeader, Table, Td, Th, Tr } from './ui/table';
import { StateSurface } from './state-surface';

export interface TerminalLeaveInputCandidate {
  separationCaseId: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  separationType: string;
  separationEffectiveDate: string;
  effectuatedAt: string;
  hasReadySnapshot: boolean;
}

export interface TerminalLeaveInputCandidateListResponse {
  candidates: TerminalLeaveInputCandidate[];
}

export interface TerminalLeaveInputFactFinding {
  code: string;
  sourceType: string;
  sourceId: string | null;
  detail: string | null;
}

export interface TerminalLeaveInputAssessment {
  id: string;
  agencyId: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  separationSourceType: string;
  separationSourceId: string;
  separationSourceVersionKey: string;
  separationClassification: string;
  separationEffectiveDate: string;
  ledgerCutoff: string;
  result: 'READY' | 'INDETERMINATE';
  inputFacts: unknown;
  missingOrConflictingFacts: TerminalLeaveInputFactFinding[];
  assessedByMembershipId: string;
  assessedByName: string | null;
  assessedAt: string;
  snapshotId: string | null;
  snapshotKey: string | null;
  supersedesSnapshotId: string | null;
}

export interface TerminalLeaveInputAssessmentListResponse {
  assessments: TerminalLeaveInputAssessment[];
}

export interface TerminalLeaveInputSnapshotLine {
  leaveAccountId: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  policyVersionId: string;
  policyVersionNo: number;
  balanceEffectiveDate: string;
  ledgerCutoff: string;
  postedBalance: string;
}

export interface TerminalLeaveInputHandoffOutcome {
  id: string;
  attemptKey: string;
  result: 'ACCEPTED' | 'ALREADY_ACCEPTED' | 'REJECTED' | 'RETRYABLE_FAILURE';
  separationReference: unknown;
  reason: unknown;
  recordedAt: string;
}

export interface TerminalLeaveInputSnapshot {
  id: string;
  snapshotKey: string;
  supersedesSnapshotId: string | null;
  createdAt: string;
  serviceSourceSnapshot: unknown;
  authoritySnapshot: unknown;
  clearanceDocumentSnapshot: unknown;
  salarySourceReference: unknown;
  lines: TerminalLeaveInputSnapshotLine[];
  outcomes: TerminalLeaveInputHandoffOutcome[];
}

export interface TerminalLeaveInputAssessmentDetail {
  assessment: TerminalLeaveInputAssessment;
  snapshot: TerminalLeaveInputSnapshot | null;
}

const resultTone: Record<TerminalLeaveInputAssessment['result'], StatusTone> = {
  READY: 'success',
  INDETERMINATE: 'warning',
};

const sectionTitleClass = 'm-0 text-panel-title text-ink';

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const error = (value as { error?: { message?: unknown; reasons?: unknown } }).error;
  const message = typeof error?.message === 'string' ? error.message : fallback;
  if (Array.isArray(error?.reasons) && error.reasons.length > 0) {
    return `${message} (${error.reasons.join(', ')})`;
  }
  return message;
}

function sourceJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? 'null';
}

function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function sourceBlock(title: string, value: unknown) {
  return (
    <section className="grid gap-2" key={title}>
      <h3 className={sectionTitleClass}>{title}</h3>
      <pre className="m-0 max-h-[320px] overflow-auto rounded-control border border-border bg-canvas p-3 font-mono text-caption whitespace-pre-wrap text-ink">
        {sourceJson(value)}
      </pre>
    </section>
  );
}

export function TerminalLeaveInputWorkspace({
  agencyId,
  canPreserve,
  initialCandidates,
  initialAssessments,
}: {
  agencyId: string;
  canPreserve: boolean;
  initialCandidates: TerminalLeaveInputCandidateListResponse;
  initialAssessments: TerminalLeaveInputAssessmentListResponse;
}) {
  const [candidates, setCandidates] = useState(initialCandidates.candidates);
  const [assessments, setAssessments] = useState(initialAssessments.assessments);
  const [dialog, setDialog] = useState<'preserve' | 'detail' | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<TerminalLeaveInputCandidate | null>(
    null,
  );
  const [detail, setDetail] = useState<TerminalLeaveInputAssessmentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [clearanceDocumentId, setClearanceDocumentId] = useState('');
  const [supportingDocumentIds, setSupportingDocumentIds] = useState('');
  const [salarySourceDocumentId, setSalarySourceDocumentId] = useState('');
  const [supersedesSnapshotId, setSupersedesSnapshotId] = useState('');
  const [reason, setReason] = useState('');

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch('/api/v1/agencies/' + agencyId + '/terminal-leave-inputs' + path, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(errorMessage(value, 'The Terminal Leave Input action failed.'));
    }
    return value;
  }

  async function refresh(): Promise<void> {
    const [candidateList, assessmentList] = await Promise.all([
      request('/candidates') as Promise<TerminalLeaveInputCandidateListResponse>,
      request('/assessments') as Promise<TerminalLeaveInputAssessmentListResponse>,
    ]);
    setCandidates(candidateList.candidates);
    setAssessments(assessmentList.assessments);
    if (detail) {
      const next = (await request(
        '/assessments/' + encodeURIComponent(detail.assessment.id),
      )) as TerminalLeaveInputAssessmentDetail;
      setDetail(next);
    }
  }

  function openPreserve(candidate: TerminalLeaveInputCandidate): void {
    const supersededIds = new Set(
      assessments.map(({ supersedesSnapshotId: value }) => value).filter(Boolean),
    );
    const live = assessments.find(
      (assessment) =>
        assessment.snapshotId !== null &&
        !supersededIds.has(assessment.snapshotId) &&
        assessment.separationSourceId === candidate.separationCaseId,
    );
    setSelectedCandidate(candidate);
    setClearanceDocumentId('');
    setSupportingDocumentIds('');
    setSalarySourceDocumentId('');
    setSupersedesSnapshotId(live?.snapshotId ?? '');
    setReason('');
    setError('');
    setSuccess('');
    setDialog('preserve');
  }

  async function loadDetail(assessmentId: string): Promise<void> {
    setDialog('detail');
    setDetail(null);
    setDetailLoading(true);
    setError('');
    try {
      const value = (await request(
        '/assessments/' + encodeURIComponent(assessmentId),
      )) as TerminalLeaveInputAssessmentDetail;
      setDetail(value);
    } catch (reasonValue: unknown) {
      setError(reasonValue instanceof Error ? reasonValue.message : 'This record is unavailable.');
    } finally {
      setDetailLoading(false);
    }
  }

  async function preserveInputs(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedCandidate) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const supporting = supportingDocumentIds
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean);
      const preserved = (await request('/assessments', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          separationCaseId: selectedCandidate.separationCaseId,
          ...(clearanceDocumentId.trim()
            ? { clearanceDocumentId: clearanceDocumentId.trim() }
            : {}),
          ...(supporting.length > 0 ? { supportingDocumentIds: supporting } : {}),
          ...(salarySourceDocumentId.trim()
            ? { salarySourceDocumentId: salarySourceDocumentId.trim() }
            : {}),
          ...(supersedesSnapshotId.trim()
            ? { supersedesSnapshotId: supersedesSnapshotId.trim() }
            : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      })) as TerminalLeaveInputAssessment;
      await refresh();
      setDialog(null);
      setSuccess(
        preserved.result === 'READY'
          ? 'Terminal Leave Inputs were preserved and a snapshot was frozen.'
          : 'Terminal Leave Inputs were assessed as INDETERMINATE; no snapshot was frozen.',
      );
    } catch (reasonValue: unknown) {
      setError(
        reasonValue instanceof Error
          ? reasonValue.message
          : 'The Terminal Leave Inputs could not be preserved.',
      );
    } finally {
      setBusy(false);
    }
  }

  const breadcrumbs: Breadcrumb[] = [{ label: 'Leave' }, { label: 'Terminal Leave Inputs' }];
  if (dialog === 'preserve' && selectedCandidate) {
    breadcrumbs.push({ label: 'Preserve ' + selectedCandidate.employeeName });
  } else if (dialog === 'detail') {
    breadcrumbs.push({ label: 'Assessment' });
  }

  // The Dialog root renders no markup. The registers are hidden, not unmounted, while a record is
  // open, so the row trigger can take focus back when it closes.
  return (
    <Dialog
      presentation="form"
      open={dialog !== null}
      onOpenChange={(open) => !open && setDialog(null)}
    >
      <div className="grid gap-5">
        <PageHeader breadcrumbs={breadcrumbs} title="Terminal Leave Inputs" />

        <div hidden={dialog !== null} className="grid min-w-0 gap-5">
          <p className="m-0 max-w-[760px] text-small text-ink-muted">
            Preserve the exact Separation, service, Leave Account, and authority sources a later
            terminal leave computation will rely on. Preservation freezes inputs; it does not
            calculate, authorize, or pay any benefit.
          </p>

          {success ? (
            <p role="status" className="m-0 text-small text-success">
              {success}
            </p>
          ) : null}

          {error && dialog === null ? <FormError message={error} /> : null}

          <Panel
            title="Effective separations"
            flush
            actions={
              <span className="text-caption text-ink-muted">
                {candidates.length === 1
                  ? '1 qualifying Separation Case'
                  : candidates.length + ' qualifying Separation Cases'}
              </span>
            }
          >
            {candidates.length === 0 ? (
              <StateSurface compact label="Effective separations">
                <strong className="text-body font-[650] text-ink">
                  No qualifying separations.
                </strong>
                <p className="m-0 max-w-[560px]">
                  Terminal Leave Inputs can be preserved once a qualifying Separation Case takes
                  effect.
                </p>
              </StateSurface>
            ) : (
              <Table className="min-w-[820px]">
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Separation</Th>
                    <Th kind="date">Effective</Th>
                    <Th>Snapshot</Th>
                    <Th>Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((candidate) => (
                    <Tr key={candidate.separationCaseId}>
                      <RowHeader>
                        {candidate.employeeName}
                        <span className="block text-caption font-normal text-ink-muted">
                          {candidate.employeeNumber}
                        </span>
                      </RowHeader>
                      <Td>{candidate.separationType.replaceAll('_', ' ')}</Td>
                      <Td kind="date">{candidate.separationEffectiveDate}</Td>
                      <Td>
                        <StatusTag tone={candidate.hasReadySnapshot ? 'success' : 'warning'}>
                          {candidate.hasReadySnapshot ? 'READY' : 'NOT PRESERVED'}
                        </StatusTag>
                      </Td>
                      <Td>
                        {canPreserve ? (
                          <DialogTrigger asChild>
                            <Button
                              onClick={() => openPreserve(candidate)}
                              size="default"
                              type="button"
                              variant={candidate.hasReadySnapshot ? 'secondary' : 'primary'}
                            >
                              {candidate.hasReadySnapshot ? 'Reassess' : 'Preserve inputs'}
                            </Button>
                          </DialogTrigger>
                        ) : (
                          <span className="text-ink-muted">Read only</span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          <Panel
            title="Assessment register"
            flush
            actions={
              <span className="text-caption text-ink-muted">
                {assessments.length === 1
                  ? '1 Terminal Leave Input Assessment'
                  : assessments.length + ' Terminal Leave Input Assessments'}
              </span>
            }
          >
            {assessments.length === 0 ? (
              <StateSurface compact label="Assessment register">
                <strong className="text-body font-[650] text-ink">No assessments yet.</strong>
                <p className="m-0 max-w-[560px]">
                  Preserve inputs for an effective qualifying separation to freeze an auditable
                  snapshot.
                </p>
              </StateSurface>
            ) : (
              <Table className="min-w-[860px]">
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Classification</Th>
                    <Th kind="date">Effective</Th>
                    <Th>Result</Th>
                    <Th kind="date">Assessed</Th>
                    <Th>Snapshot</Th>
                  </tr>
                </thead>
                <tbody>
                  {assessments.map((assessment) => (
                    <Tr key={assessment.id}>
                      <Td>
                        <button
                          className="w-fit cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-primary hover:underline"
                          onClick={() => void loadDetail(assessment.id)}
                          type="button"
                        >
                          {assessment.employeeName}
                        </button>
                        <span className="block text-caption text-ink-muted">
                          {assessment.employeeNumber}
                        </span>
                      </Td>
                      <Td>{assessment.separationClassification.replaceAll('_', ' ')}</Td>
                      <Td kind="date">{assessment.separationEffectiveDate}</Td>
                      <Td>
                        <StatusTag tone={resultTone[assessment.result]}>
                          {assessment.result}
                        </StatusTag>
                      </Td>
                      <Td kind="date">{assessment.assessedAt.slice(0, 10)}</Td>
                      <Td className="text-ink-muted">{assessment.snapshotKey ?? '—'}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        <DialogContent aria-describedby="terminal-leave-input-dialog-description">
          {dialog === 'preserve' && selectedCandidate ? (
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={(event) => void preserveInputs(event)}
            >
              <DialogHeader>
                <div className="grid min-w-0 gap-1.5">
                  <DialogTitle>Preserve Terminal Leave Inputs</DialogTitle>
                  <DialogDescription id="terminal-leave-input-dialog-description">
                    {selectedCandidate.employeeName} ·{' '}
                    {selectedCandidate.separationType.replaceAll('_', ' ')} effective{' '}
                    {selectedCandidate.separationEffectiveDate}
                  </DialogDescription>
                </div>
              </DialogHeader>
              <DialogBody className="grid gap-5">
                <p className="m-0 text-small text-ink-muted">
                  An INDETERMINATE assessment records every missing or conflicting fact and freezes
                  no snapshot. Corrections must supersede the live snapshot with a reason.
                </p>
                <Field
                  htmlFor="terminal-clearance-document"
                  label="Clearance Document ID (optional)"
                >
                  <input
                    className={inputClass}
                    id="terminal-clearance-document"
                    onChange={(event) => setClearanceDocumentId(targetValue(event))}
                    value={clearanceDocumentId}
                  />
                </Field>
                <Field
                  htmlFor="terminal-supporting-documents"
                  label="Supporting Document IDs (optional, one per line)"
                >
                  <textarea
                    className={`${inputClass} py-2`}
                    id="terminal-supporting-documents"
                    onChange={(event) => setSupportingDocumentIds(targetValue(event))}
                    rows={3}
                    value={supportingDocumentIds}
                  />
                </Field>
                <Field
                  htmlFor="terminal-salary-document"
                  label="Salary source Document ID (optional)"
                >
                  <input
                    className={inputClass}
                    id="terminal-salary-document"
                    onChange={(event) => setSalarySourceDocumentId(targetValue(event))}
                    value={salarySourceDocumentId}
                  />
                </Field>
                <Field
                  htmlFor="terminal-supersedes-snapshot"
                  label="Supersede Snapshot ID (required to correct a live snapshot)"
                >
                  <input
                    className={inputClass}
                    id="terminal-supersedes-snapshot"
                    onChange={(event) => setSupersedesSnapshotId(targetValue(event))}
                    value={supersedesSnapshotId}
                  />
                </Field>
                <Field
                  htmlFor="terminal-preserve-reason"
                  label="Reason (required when superseding)"
                >
                  <textarea
                    className={`${inputClass} py-2`}
                    id="terminal-preserve-reason"
                    maxLength={500}
                    onChange={(event) => setReason(targetValue(event))}
                    rows={3}
                    value={reason}
                  />
                </Field>
                <FormError message={error} />
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} size="default" type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} size="default" type="submit" variant="primary">
                  {busy ? 'Preserving…' : 'Preserve inputs'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}

          {dialog === 'detail' ? (
            <>
              <DialogHeader>
                <div className="grid min-w-0 gap-1.5">
                  <DialogTitle>Terminal Leave Input Assessment</DialogTitle>
                  <DialogDescription id="terminal-leave-input-dialog-description">
                    {detail
                      ? detail.assessment.employeeName +
                        ' · ' +
                        detail.assessment.separationClassification.replaceAll('_', ' ')
                      : 'Loading the exact preserved sources.'}
                  </DialogDescription>
                </div>
              </DialogHeader>
              <DialogBody className="grid gap-6">
                <FormError message={error} />
                {detailLoading ? (
                  <StateSurface compact busy label="Assessment detail">
                    <p className="m-0">Loading…</p>
                  </StateSurface>
                ) : detail ? (
                  <>
                    <dl className="m-0 grid gap-x-10 gap-y-4 min-[621px]:grid-cols-2 min-[900px]:grid-cols-3">
                      {(
                        [
                          [
                            'Result',
                            <StatusTag key="result" tone={resultTone[detail.assessment.result]}>
                              {detail.assessment.result}
                            </StatusTag>,
                          ],
                          [
                            'Source version key',
                            <span key="version" className="font-mono text-small">
                              {detail.assessment.separationSourceVersionKey}
                            </span>,
                          ],
                          ['Ledger knowledge cutoff', detail.assessment.ledgerCutoff],
                          [
                            'Assessed by',
                            detail.assessment.assessedByName ??
                              detail.assessment.assessedByMembershipId,
                          ],
                          ['Assessed at', detail.assessment.assessedAt],
                          [
                            'Snapshot key',
                            <span key="snapshot" className="font-mono text-small">
                              {detail.assessment.snapshotKey ?? '—'}
                            </span>,
                          ],
                        ] satisfies [string, ReactNode][]
                      ).map(([label, value]) => (
                        <div key={label}>
                          <dt className="text-caption text-ink-muted">{label}</dt>
                          <dd className="m-0 text-body font-[600] text-ink">{value}</dd>
                        </div>
                      ))}
                    </dl>

                    {detail.assessment.missingOrConflictingFacts.length > 0 ? (
                      <section className="grid gap-2" aria-labelledby="terminal-findings-title">
                        <h3 className={sectionTitleClass} id="terminal-findings-title">
                          Missing or conflicting facts
                        </h3>
                        <ul className="m-0 grid gap-2 p-0">
                          {detail.assessment.missingOrConflictingFacts.map((finding) => (
                            <li
                              className="list-none rounded-control border border-border bg-canvas px-3 py-2.5 text-small text-ink"
                              key={
                                finding.code +
                                ':' +
                                finding.sourceType +
                                ':' +
                                (finding.sourceId ?? 'none')
                              }
                            >
                              <strong className="font-[600]">{finding.code}</strong> ·{' '}
                              {finding.sourceType}
                              {finding.sourceId ? ' · ' + finding.sourceId : ''}
                              {finding.detail ? ' — ' + finding.detail : ''}
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}

                    {detail.snapshot ? (
                      <>
                        <section className="grid gap-2" aria-labelledby="terminal-lines-title">
                          <h3 className={sectionTitleClass} id="terminal-lines-title">
                            Frozen Leave Account lines
                          </h3>
                          <div className="rounded-control border border-border">
                            <Table aria-labelledby="terminal-lines-title" className="min-w-[720px]">
                              <thead>
                                <tr>
                                  <Th>Leave type</Th>
                                  <Th>Policy version</Th>
                                  <Th kind="date">Balance date</Th>
                                  <Th kind="date">Ledger cutoff</Th>
                                  <Th kind="numeric">Posted balance</Th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.snapshot.lines.map((line) => (
                                  <Tr key={line.leaveAccountId}>
                                    <Td>
                                      {line.leaveTypeName}{' '}
                                      <span className="text-ink-muted">({line.leaveTypeCode})</span>
                                    </Td>
                                    <Td>v{line.policyVersionNo}</Td>
                                    <Td kind="date">{line.balanceEffectiveDate}</Td>
                                    <Td kind="date">{line.ledgerCutoff}</Td>
                                    <Td kind="numeric" className="font-[600]">
                                      {line.postedBalance}
                                    </Td>
                                  </Tr>
                                ))}
                              </tbody>
                            </Table>
                          </div>
                        </section>

                        {sourceBlock(
                          'Service source snapshot',
                          detail.snapshot.serviceSourceSnapshot,
                        )}
                        {sourceBlock('Authority snapshot', detail.snapshot.authoritySnapshot)}
                        {sourceBlock(
                          'Clearance document snapshot',
                          detail.snapshot.clearanceDocumentSnapshot,
                        )}
                        {sourceBlock(
                          'Salary source reference',
                          detail.snapshot.salarySourceReference,
                        )}

                        <section className="grid gap-2" aria-labelledby="terminal-outcomes-title">
                          <h3 className={sectionTitleClass} id="terminal-outcomes-title">
                            Handoff outcomes
                          </h3>
                          {detail.snapshot.outcomes.length === 0 ? (
                            <p className="m-0 text-small text-ink-muted">
                              No handoff outcome has been recorded yet.
                            </p>
                          ) : (
                            <ul className="m-0 grid gap-2 p-0">
                              {detail.snapshot.outcomes.map((outcome) => (
                                <li
                                  className="list-none rounded-control border border-border bg-canvas px-3 py-2.5 text-small text-ink"
                                  key={outcome.id}
                                >
                                  <strong className="font-[600]">{outcome.result}</strong> ·{' '}
                                  {outcome.attemptKey} · {outcome.recordedAt}
                                  {outcome.reason ? ' — ' + sourceJson(outcome.reason) : ''}
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
                      </>
                    ) : (
                      <p className="m-0 rounded-control border border-border bg-canvas px-3 py-2.5 text-small text-ink-muted">
                        No snapshot was frozen for this assessment. Resolve the listed facts and
                        reassess.
                      </p>
                    )}
                  </>
                ) : (
                  <StateSurface compact label="Assessment detail">
                    <p className="m-0">This record is unavailable.</p>
                  </StateSurface>
                )}
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button size="default" type="button" variant="secondary">
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
