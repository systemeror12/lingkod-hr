'use client';

import { Field, inputClass, FormError } from './ui/field';
import { useState, type FormEvent } from 'react';
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

const TONE_RESOLVED = 'bg-[#e8f3ed] text-[#316647]';
const TONE_ATTENTION = 'bg-[#fff3d6] text-[#79531c]';

function resultClass(result: TerminalLeaveInputAssessment['result']): string {
  return result === 'READY' ? TONE_RESOLVED : TONE_ATTENTION;
}

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
    <div className="grid gap-2" key={title}>
      <h4 className="m-0 text-xs font-[670] tracking-[0.06em] text-muted uppercase">{title}</h4>
      <pre className="m-0 max-h-[320px] overflow-auto rounded-[3px] border border-line bg-canvas px-4 py-3 text-xs leading-[1.6] text-ink">
        {sourceJson(value)}
      </pre>
    </div>
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

  return (
    <Dialog
      presentation="form"
      open={dialog !== null}
      onOpenChange={(open) => !open && setDialog(null)}
    >
      <div hidden={dialog !== null} className="min-w-0 space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div className="grid max-w-[760px] gap-2">
            <p className="m-0 text-[11px] font-bold tracking-[0.09em] text-cobalt uppercase">
              Leave administration
            </p>
            <h1 className="m-0 text-[clamp(28px,3vw,38px)] leading-[1.08] font-[680] tracking-[-0.035em] text-midnight">
              Terminal Leave Inputs
            </h1>
            <p className="m-0 text-sm leading-[1.65] text-muted">
              Preserve the exact Separation, service, Leave Account, and authority sources a later
              terminal leave computation will rely on. Preservation freezes inputs; it does not
              calculate, authorize, or pay any benefit.
            </p>
          </div>
        </header>

        {success ? (
          <p
            className="m-0 rounded-[3px] border border-[#b9d8c3] bg-[#f2faf4] px-4 py-3 text-sm text-[#316647]"
            role="status"
          >
            {success}
          </p>
        ) : null}

        {error && dialog === null ? <FormError message={error} /> : null}

        <section
          aria-labelledby="terminal-candidates-heading"
          className="overflow-hidden rounded-[5px] border border-line bg-paper"
        >
          <header className="flex min-h-[60px] flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
            <div className="grid gap-1">
              <h2 className="m-0 text-sm font-[670] text-midnight" id="terminal-candidates-heading">
                Effective separations
              </h2>
              <span className="text-xs text-muted">
                {candidates.length === 1
                  ? '1 qualifying Separation Case'
                  : candidates.length + ' qualifying Separation Cases'}
              </span>
            </div>
          </header>
          {candidates.length === 0 ? (
            <div className="grid min-h-[160px] place-content-center gap-2 px-6 py-12">
              <strong className="text-[15px] font-[650] text-midnight">
                No qualifying separations.
              </strong>
              <p className="m-0 max-w-[560px] text-[13px] leading-[1.6] text-muted">
                Terminal Leave Inputs can be preserved once a qualifying Separation Case takes
                effect.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                <thead className="bg-canvas text-[11px] tracking-[0.07em] text-muted uppercase">
                  <tr>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Employee
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Separation
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Effective
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Snapshot
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {candidates.map((candidate) => (
                    <tr key={candidate.separationCaseId}>
                      <td className="px-5 py-4 align-top">
                        <div className="grid gap-1">
                          <strong className="font-[670] text-midnight">
                            {candidate.employeeName}
                          </strong>
                          <span className="text-xs text-muted">{candidate.employeeNumber}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-ink">
                        {candidate.separationType.replaceAll('_', ' ')}
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-ink">
                        {candidate.separationEffectiveDate}
                      </td>
                      <td className="px-5 py-4 align-top">
                        <span
                          className={
                            'inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.07em] uppercase ' +
                            (candidate.hasReadySnapshot ? TONE_RESOLVED : TONE_ATTENTION)
                          }
                        >
                          {candidate.hasReadySnapshot ? 'READY' : 'NOT PRESERVED'}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-top">
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
                          <span className="text-xs text-muted">Read only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section
          aria-labelledby="terminal-assessments-heading"
          className="overflow-hidden rounded-[5px] border border-line bg-paper"
        >
          <header className="flex min-h-[60px] flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
            <div className="grid gap-1">
              <h2
                className="m-0 text-sm font-[670] text-midnight"
                id="terminal-assessments-heading"
              >
                Assessment register
              </h2>
              <span className="text-xs text-muted">
                {assessments.length === 1
                  ? '1 Terminal Leave Input Assessment'
                  : assessments.length + ' Terminal Leave Input Assessments'}
              </span>
            </div>
          </header>
          {assessments.length === 0 ? (
            <div className="grid min-h-[160px] place-content-center gap-2 px-6 py-12">
              <strong className="text-[15px] font-[650] text-midnight">No assessments yet.</strong>
              <p className="m-0 max-w-[560px] text-[13px] leading-[1.6] text-muted">
                Preserve inputs for an effective qualifying separation to freeze an auditable
                snapshot.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                <thead className="bg-canvas text-[11px] tracking-[0.07em] text-muted uppercase">
                  <tr>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Employee
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Classification
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Effective
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Result
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Assessed
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Snapshot
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {assessments.map((assessment) => (
                    <tr key={assessment.id}>
                      <td className="px-5 py-4 align-top">
                        <div className="grid gap-1">
                          <button
                            className="w-fit cursor-pointer text-left font-[670] text-cobalt underline-offset-2 hover:underline"
                            onClick={() => void loadDetail(assessment.id)}
                            type="button"
                          >
                            {assessment.employeeName}
                          </button>
                          <span className="text-xs text-muted">{assessment.employeeNumber}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-ink">
                        {assessment.separationClassification.replaceAll('_', ' ')}
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-ink">
                        {assessment.separationEffectiveDate}
                      </td>
                      <td className="px-5 py-4 align-top">
                        <span
                          className={
                            'inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.07em] uppercase ' +
                            resultClass(assessment.result)
                          }
                        >
                          {assessment.result}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-ink">
                        {assessment.assessedAt.slice(0, 10)}
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-muted">
                        {assessment.snapshotKey ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <DialogContent aria-describedby="terminal-leave-input-dialog-description">
        {dialog === 'preserve' && selectedCandidate ? (
          <form className="grid gap-4" onSubmit={(event) => void preserveInputs(event)}>
            <DialogHeader>
              <DialogTitle>Preserve Terminal Leave Inputs</DialogTitle>
              <DialogDescription id="terminal-leave-input-dialog-description">
                {selectedCandidate.employeeName} ·{' '}
                {selectedCandidate.separationType.replaceAll('_', ' ')} effective{' '}
                {selectedCandidate.separationEffectiveDate}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-4">
              {error ? <FormError message={error} /> : null}
              <p className="m-0 text-xs leading-[1.6] text-muted">
                An INDETERMINATE assessment records every missing or conflicting fact and freezes no
                snapshot. Corrections must supersede the live snapshot with a reason.
              </p>
              <Field htmlFor="terminal-clearance-document" label="Clearance Document ID (optional)">
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
                  className={inputClass}
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
              <Field htmlFor="terminal-preserve-reason" label="Reason (required when superseding)">
                <textarea
                  className={inputClass}
                  id="terminal-preserve-reason"
                  maxLength={500}
                  onChange={(event) => setReason(targetValue(event))}
                  rows={3}
                  value={reason}
                />
              </Field>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={busy} type="submit" variant="primary">
                {busy ? 'Preserving…' : 'Preserve inputs'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {dialog === 'detail' ? (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Terminal Leave Input Assessment</DialogTitle>
              <DialogDescription id="terminal-leave-input-dialog-description">
                {detail
                  ? detail.assessment.employeeName +
                    ' · ' +
                    detail.assessment.separationClassification.replaceAll('_', ' ')
                  : 'Loading the exact preserved sources.'}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-5">
              {error ? <FormError message={error} /> : null}
              {detailLoading ? (
                <p className="m-0 text-sm text-muted">Loading…</p>
              ) : detail ? (
                <>
                  <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
                    <div className="grid gap-1">
                      <dt className="text-xs text-muted">Result</dt>
                      <dd className="m-0">
                        <span
                          className={
                            'inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.07em] uppercase ' +
                            resultClass(detail.assessment.result)
                          }
                        >
                          {detail.assessment.result}
                        </span>
                      </dd>
                    </div>
                    <div className="grid gap-1">
                      <dt className="text-xs text-muted">Source version key</dt>
                      <dd className="m-0 font-mono text-xs text-ink">
                        {detail.assessment.separationSourceVersionKey}
                      </dd>
                    </div>
                    <div className="grid gap-1">
                      <dt className="text-xs text-muted">Ledger knowledge cutoff</dt>
                      <dd className="m-0 text-xs text-ink">{detail.assessment.ledgerCutoff}</dd>
                    </div>
                    <div className="grid gap-1">
                      <dt className="text-xs text-muted">Assessed by</dt>
                      <dd className="m-0 text-xs text-ink">
                        {detail.assessment.assessedByName ??
                          detail.assessment.assessedByMembershipId}
                      </dd>
                    </div>
                    <div className="grid gap-1">
                      <dt className="text-xs text-muted">Assessed at</dt>
                      <dd className="m-0 text-xs text-ink">{detail.assessment.assessedAt}</dd>
                    </div>
                    <div className="grid gap-1">
                      <dt className="text-xs text-muted">Snapshot key</dt>
                      <dd className="m-0 font-mono text-xs text-ink">
                        {detail.assessment.snapshotKey ?? '—'}
                      </dd>
                    </div>
                  </dl>

                  {detail.assessment.missingOrConflictingFacts.length > 0 ? (
                    <div className="grid gap-2">
                      <h4 className="m-0 text-xs font-[670] tracking-[0.06em] text-muted uppercase">
                        Missing or conflicting facts
                      </h4>
                      <ul className="m-0 grid gap-2 p-0">
                        {detail.assessment.missingOrConflictingFacts.map((finding) => (
                          <li
                            className="list-none rounded-[3px] border border-line bg-canvas px-4 py-3 text-xs text-ink"
                            key={
                              finding.code +
                              ':' +
                              finding.sourceType +
                              ':' +
                              (finding.sourceId ?? 'none')
                            }
                          >
                            <strong className="font-[670]">{finding.code}</strong> ·{' '}
                            {finding.sourceType}
                            {finding.sourceId ? ' · ' + finding.sourceId : ''}
                            {finding.detail ? ' — ' + finding.detail : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {detail.snapshot ? (
                    <>
                      <div className="grid gap-2">
                        <h4 className="m-0 text-xs font-[670] tracking-[0.06em] text-muted uppercase">
                          Frozen Leave Account lines
                        </h4>
                        <div className="overflow-x-auto rounded-[3px] border border-line">
                          <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                            <thead className="bg-canvas tracking-[0.07em] text-muted uppercase">
                              <tr>
                                <th className="px-4 py-2 font-bold" scope="col">
                                  Leave type
                                </th>
                                <th className="px-4 py-2 font-bold" scope="col">
                                  Policy version
                                </th>
                                <th className="px-4 py-2 font-bold" scope="col">
                                  Balance date
                                </th>
                                <th className="px-4 py-2 font-bold" scope="col">
                                  Ledger cutoff
                                </th>
                                <th className="px-4 py-2 font-bold" scope="col">
                                  Posted balance
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                              {detail.snapshot.lines.map((line) => (
                                <tr key={line.leaveAccountId}>
                                  <td className="px-4 py-3 text-ink">
                                    {line.leaveTypeName}{' '}
                                    <span className="text-muted">({line.leaveTypeCode})</span>
                                  </td>
                                  <td className="px-4 py-3 text-ink">v{line.policyVersionNo}</td>
                                  <td className="px-4 py-3 text-ink">
                                    {line.balanceEffectiveDate}
                                  </td>
                                  <td className="px-4 py-3 text-ink">{line.ledgerCutoff}</td>
                                  <td className="px-4 py-3 font-[650] text-ink">
                                    {line.postedBalance}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

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

                      <div className="grid gap-2">
                        <h4 className="m-0 text-xs font-[670] tracking-[0.06em] text-muted uppercase">
                          Handoff outcomes
                        </h4>
                        {detail.snapshot.outcomes.length === 0 ? (
                          <p className="m-0 text-xs text-muted">
                            No handoff outcome has been recorded yet.
                          </p>
                        ) : (
                          <ul className="m-0 grid gap-2 p-0">
                            {detail.snapshot.outcomes.map((outcome) => (
                              <li
                                className="list-none rounded-[3px] border border-line bg-canvas px-4 py-3 text-xs text-ink"
                                key={outcome.id}
                              >
                                <strong className="font-[670]">{outcome.result}</strong> ·{' '}
                                {outcome.attemptKey} · {outcome.recordedAt}
                                {outcome.reason ? ' — ' + sourceJson(outcome.reason) : ''}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="m-0 rounded-[3px] border border-line bg-canvas px-4 py-3 text-xs text-muted">
                      No snapshot was frozen for this assessment. Resolve the listed facts and
                      reassess.
                    </p>
                  )}
                </>
              ) : (
                <p className="m-0 text-sm text-muted">This record is unavailable.</p>
              )}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Close
                </Button>
              </DialogClose>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
