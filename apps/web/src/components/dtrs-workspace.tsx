'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { StateSurface } from './state-surface';
import { Button, buttonVariants } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';
import { PageHeader } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag, type StatusTone } from './ui/status-tag';
import { RowHeader, Table, Td, Th, Tr } from './ui/table';

export interface AttendancePeriodListResponse {
  periods: AttendancePeriodOption[];
}

export interface AttendancePeriodOption {
  id: string;
  code: string;
  dateFrom: string;
  dateTo: string;
  status: string;
}

export interface DtrDocumentListResponse {
  dtrs: DtrDocumentSummary[];
}

export interface DtrDocumentSummary {
  id: string;
  agencyId: string;
  attendancePeriodVersionId: string;
  period: AttendancePeriodOption;
  versionNo: number;
  versionStatus: string;
  employee: EmployeeOption;
  classification: string;
  outputType: string;
  predecessorDtrDocumentId: string | null;
  documentVersionId: string;
  generatedAt: string;
  isCurrent: boolean;
}

interface DtrPresentationEntry {
  slot: string | null;
  label: string;
  eventId: string;
  sourceType: string;
  eventType: string;
  eventTime: string;
  localDate: string;
  localTime: string;
}

interface DtrManifestDay {
  attendanceDayId: string;
  calculationVersion: number;
  workDate: string;
  dayClassification: string;
  status: string;
  totals: { expectedMinutes: number; workedMinutes: number; lateMinutes: number };
  presentation: DtrPresentationEntry[];
  exceptions: Array<{ id: string; exceptionType: string; status: string }>;
}

interface DtrManifest {
  classification: string;
  outputType: string;
  period: AttendancePeriodOption;
  version: {
    id: string;
    versionNo: number;
    lockedAt: string | null;
    predecessorVersionId: string | null;
  };
  employee: EmployeeOption;
  generatedAt: string;
  days: DtrManifestDay[];
}

interface DtrPreviewResponse {
  unfinalized: true;
  period: AttendancePeriodOption;
  employee: EmployeeOption;
  days: DtrManifestDay[];
}

interface DtrDocumentDetailResponse {
  document: DtrDocumentSummary;
  manifest: DtrManifest;
}

interface DtrPeriodVersion {
  id: string;
  attendancePeriodId: string;
  versionNo: number;
  status: string;
  predecessorVersionId: string | null;
  lockedAt: string | null;
  dtrCount: number;
}

interface AttendanceSubmissionSummary {
  id: string;
  period: AttendancePeriodOption;
  employee: EmployeeOption;
  versionNo: number;
  status: string;
  submittedAt: string | null;
  onBehalfReason: string | null;
  evidenceDocumentVersionId: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  dayCount: number;
}

interface EmployeeOption {
  id: string;
  employeeNumber: string;
  legalName: string;
}

interface DtrsWorkspaceProps {
  agencyId: string;
  canReadDays: boolean;
  canReadReports: boolean;
  canCreate: boolean;
  canCreateOnBehalf: boolean;
  canSubmit: boolean;
  canReturn: boolean;
  canApprove: boolean;
  canCancel: boolean;
  canGenerate: boolean;
  initialPeriods: AttendancePeriodListResponse;
  initialDtrs: DtrDocumentListResponse;
}

function errorMessage(value: unknown, fallback: string): string {
  if (value === null || typeof value !== 'object') return fallback;
  const error = (value as { error?: unknown }).error;
  if (error === null || typeof error !== 'object') return fallback;
  const message = (error as { message?: unknown }).message;
  const reasons = (error as { reasons?: unknown }).reasons;
  const base = typeof message === 'string' ? message : fallback;
  if (Array.isArray(reasons) && reasons.length > 0) {
    return `${base} (${reasons.filter((item) => typeof item === 'string').join('; ')})`;
  }
  return base;
}

const SUBMISSION_TONE: Record<string, StatusTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  RETURNED: 'warning',
  APPROVED: 'success',
  CANCELLED: 'neutral',
};

const sectionTitleClass = 'm-0 text-panel-title text-ink';

function submissionTone(status: string): StatusTone {
  return SUBMISSION_TONE[status] ?? 'neutral';
}

function eventValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function timeLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, '0')}`;
}

function presentationText(entry: DtrPresentationEntry): string {
  return entry.slot === null
    ? `${entry.label} ${entry.localDate} ${entry.localTime}`
    : `${entry.label} ${entry.localTime}`;
}

export function DtrsWorkspace(props: DtrsWorkspaceProps) {
  const periods = props.initialPeriods.periods;
  const [dtrs, setDtrs] = useState<DtrDocumentSummary[]>(props.initialDtrs.dtrs);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>(
    props.initialPeriods.periods[0]?.id ?? '',
  );
  const [preview, setPreview] = useState<DtrPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [submissions, setSubmissions] = useState<AttendanceSubmissionSummary[]>([]);
  const [versions, setVersions] = useState<DtrPeriodVersion[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selectedDtr, setSelectedDtr] = useState<DtrDocumentDetailResponse | null>(null);
  const [selectedDtrId, setSelectedDtrId] = useState<string | null>(null);
  const [comments, setComments] = useState('');
  const [onBehalf, setOnBehalf] = useState({
    employeeId: '',
    reason: '',
    evidenceDocumentVersionId: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch('/api/v1/agencies/' + props.agencyId + path, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(errorMessage(value, 'The Daily Time Record action failed.'));
    }
    return value;
  }

  useEffect(() => {
    if (!props.canReadReports) return;
    let cancelled = false;
    void (async () => {
      try {
        const value = (await request('/dtrs')) as DtrDocumentListResponse;
        if (!cancelled) setDtrs(value.dtrs);
      } catch {
        // The server-rendered list stays available when the refresh fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.agencyId, props.canReadReports]);

  useEffect(() => {
    if (!props.canReadDays || !selectedPeriodId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [previewValue, submissionValue, versionValue] = await Promise.all([
          request(
            '/attendance-periods/' + selectedPeriodId + '/dtr-preview',
          ) as Promise<DtrPreviewResponse>,
          request('/attendance-submissions?attendancePeriodId=' + selectedPeriodId) as Promise<{
            submissions: AttendanceSubmissionSummary[];
          }>,
          request('/attendance-period-versions?attendancePeriodId=' + selectedPeriodId) as Promise<{
            versions: DtrPeriodVersion[];
          }>,
        ]);
        if (cancelled) return;
        setPreview(previewValue);
        setPreviewError('');
        setSubmissions(submissionValue.submissions);
        setVersions(versionValue.versions);
      } catch (failure: unknown) {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(
          failure instanceof Error ? failure.message : 'The DTR preview could not be loaded.',
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.agencyId, props.canReadDays, selectedPeriodId]);

  useEffect(() => {
    if (!selectedDtrId || !props.canReadReports) {
      setSelectedDtr(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const value = (await request('/dtrs/' + selectedDtrId)) as DtrDocumentDetailResponse;
        if (!cancelled) setSelectedDtr(value);
      } catch (failure: unknown) {
        if (!cancelled) {
          setSelectedDtr(null);
          setError(failure instanceof Error ? failure.message : 'The DTR could not be loaded.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.agencyId, props.canReadReports, selectedDtrId]);

  async function refresh(): Promise<void> {
    if (!selectedPeriodId) return;
    const [previewValue, submissionValue, versionValue, dtrValue] = await Promise.all([
      props.canReadDays
        ? (request(
            '/attendance-periods/' + selectedPeriodId + '/dtr-preview',
          ) as Promise<DtrPreviewResponse>)
        : Promise.resolve(null),
      props.canReadDays
        ? (request('/attendance-submissions?attendancePeriodId=' + selectedPeriodId) as Promise<{
            submissions: AttendanceSubmissionSummary[];
          }>)
        : Promise.resolve(null),
      props.canReadDays
        ? (request(
            '/attendance-period-versions?attendancePeriodId=' + selectedPeriodId,
          ) as Promise<{ versions: DtrPeriodVersion[] }>)
        : Promise.resolve(null),
      props.canReadReports
        ? (request('/dtrs') as Promise<DtrDocumentListResponse>)
        : Promise.resolve(null),
    ]);
    if (previewValue) setPreview(previewValue);
    if (submissionValue) setSubmissions(submissionValue.submissions);
    if (versionValue) setVersions(versionValue.versions);
    if (dtrValue) setDtrs(dtrValue.dtrs);
    if (selectedDtrId && props.canReadReports) {
      setSelectedDtr((await request('/dtrs/' + selectedDtrId)) as DtrDocumentDetailResponse);
    }
  }

  async function run(path: string, body: Record<string, unknown> | undefined, message: string) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await request(path, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      setComments('');
      setSuccess(message);
      await refresh();
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : 'The action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function loadEmployees(): Promise<void> {
    if (employees.length > 0) return;
    try {
      const value = (await request('/employees')) as { employees: EmployeeOption[] };
      setEmployees(value.employees);
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : 'Employees could not be loaded.');
    }
  }

  async function createOnBehalf(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!selectedPeriodId) return;
    await run(
      '/attendance-submissions',
      {
        attendancePeriodId: selectedPeriodId,
        employeeId: onBehalf.employeeId,
        onBehalfReason: onBehalf.reason,
        evidenceDocumentVersionId: onBehalf.evidenceDocumentVersionId,
      },
      'On-behalf submission saved as a draft.',
    );
    setOnBehalf({ employeeId: '', reason: '', evidenceDocumentVersionId: '' });
  }

  function printHref(path: string): string {
    return '/api/v1/agencies/' + props.agencyId + path;
  }

  const selectedPeriod = periods.find((period) => period.id === selectedPeriodId) ?? null;
  const ownSubmission = submissions.find(
    (submission) =>
      preview !== null &&
      submission.employee.id === preview.employee.id &&
      submission.status !== 'CANCELLED',
  );
  const reviewQueue = submissions.filter((submission) => submission.status === 'SUBMITTED');
  const latestVersion = versions[0] ?? null;
  const latestLocked = versions.find((version) => version.status === 'LOCKED') ?? null;
  const canGenerateForPeriod =
    props.canGenerate && latestLocked !== null && latestLocked.dtrCount === 0;
  const periodDtrs = dtrs.filter((dtr) => dtr.period.id === selectedPeriodId);

  return (
    <div className="grid min-w-0 gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Time & attendance' }]}
        title="Daily Time Records"
        actions={
          periods.length > 0 ? (
            <Field label="Attendance Period">
              <select
                className={inputClass + ' min-w-64'}
                onChange={(event) => setSelectedPeriodId(eventValue(event))}
                value={selectedPeriodId}
              >
                {periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.code} · {period.dateFrom} to {period.dateTo} · {period.status}
                  </option>
                ))}
              </select>
            </Field>
          ) : null
        }
      />

      {success ? (
        <p
          className="m-0 rounded-control border border-success/40 bg-success/5 px-3 py-2.5 text-small text-success"
          role="status"
        >
          {success}
        </p>
      ) : null}
      <FormError message={error} />

      {props.canReadDays ? (
        <Panel
          title="Unfinalized Daily Time Record Preview"
          flush
          actions={
            preview ? (
              <>
                <a
                  className={buttonVariants({ variant: 'secondary' })}
                  href={printHref(
                    '/attendance-periods/' +
                      selectedPeriodId +
                      '/dtr-preview/print?employeeId=' +
                      preview.employee.id,
                  )}
                  rel="noopener"
                  target="_blank"
                >
                  Print preview
                </a>
                {props.canCreate && !ownSubmission ? (
                  <Button
                    disabled={busy || !selectedPeriodId}
                    onClick={() =>
                      void run(
                        '/attendance-submissions',
                        { attendancePeriodId: selectedPeriodId },
                        'Submission draft created.',
                      )
                    }
                    type="button"
                    variant="primary"
                  >
                    Create draft submission
                  </Button>
                ) : null}
              </>
            ) : null
          }
        >
          <div className="grid justify-items-start gap-2 px-4 py-3">
            <p className="m-0" role="note">
              <StatusTag tone="warning">Unfinalized preview</StatusTag>
            </p>
            <p className="m-0 text-small text-ink-muted">
              Derived from the current Attendance Day versions. This is not a Finalized Daily Time
              Record.
            </p>
          </div>
          {previewError ? (
            <StateSurface compact>
              <p className="m-0">{previewError}</p>
            </StateSurface>
          ) : preview ? (
            <Table>
              <caption className="sr-only">
                {preview.employee.legalName} · {preview.period.code}
              </caption>
              <thead>
                <tr>
                  <Th>Work date</Th>
                  <Th>DTR presentation</Th>
                  <Th kind="numeric">Expected</Th>
                  <Th kind="numeric">Worked</Th>
                  <Th kind="numeric">Tardiness</Th>
                </tr>
              </thead>
              <tbody>
                {preview.days.map((day) => {
                  const openExceptions = day.exceptions.filter(
                    (exception) => exception.status === 'OPEN',
                  );
                  return (
                    <Tr key={day.attendanceDayId}>
                      <RowHeader>
                        {day.workDate}
                        <span className="block text-caption font-normal text-ink-muted">
                          {day.dayClassification.replaceAll('_', ' ')} · v{day.calculationVersion} ·{' '}
                          {day.status}
                        </span>
                      </RowHeader>
                      <Td>
                        {day.presentation.length === 0 ? (
                          <span className="text-ink-muted">No recorded event presentation.</span>
                        ) : (
                          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
                            {day.presentation.map((entry) => (
                              <li key={entry.eventId}>{presentationText(entry)}</li>
                            ))}
                          </ul>
                        )}
                        {openExceptions.length > 0 ? (
                          <span className="mt-1 block font-[600] text-danger">
                            {openExceptions.map((exception) => exception.exceptionType).join(', ')}
                          </span>
                        ) : null}
                      </Td>
                      <Td kind="numeric">{timeLabel(day.totals.expectedMinutes)}</Td>
                      <Td kind="numeric">{timeLabel(day.totals.workedMinutes)}</Td>
                      <Td kind="numeric">{timeLabel(day.totals.lateMinutes)}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          ) : (
            <StateSurface busy compact>
              <p className="m-0">Loading the preview…</p>
            </StateSurface>
          )}
          {ownSubmission ? (
            <section
              aria-label="My attendance submission"
              className="grid gap-2 border-t border-border px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className={sectionTitleClass}>My attendance submission</h3>
                <StatusTag tone={submissionTone(ownSubmission.status)}>
                  {ownSubmission.status}
                </StatusTag>
              </div>
              <p className="m-0 text-small text-ink-muted">
                Version {ownSubmission.versionNo} · {ownSubmission.dayCount} bound Attendance Day
                version
                {ownSubmission.dayCount === 1 ? '' : 's'}
                {ownSubmission.reviewReason ? ` · ${ownSubmission.reviewReason}` : ''}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {props.canSubmit && ['DRAFT', 'RETURNED'].includes(ownSubmission.status) ? (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        '/attendance-submissions/' + ownSubmission.id + '/submit',
                        undefined,
                        'Exact Attendance Day versions submitted for HR review.',
                      )
                    }
                    type="button"
                    variant="primary"
                  >
                    Submit for review
                  </Button>
                ) : null}
                {props.canCancel && ['DRAFT', 'SUBMITTED'].includes(ownSubmission.status) ? (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        '/attendance-submissions/' + ownSubmission.id + '/cancel',
                        {
                          reason:
                            comments.trim() || 'Cancelled from the Daily Time Record workspace.',
                        },
                        'Submission cancelled.',
                      )
                    }
                    type="button"
                    variant="secondary"
                  >
                    Cancel submission
                  </Button>
                ) : null}
              </div>
            </section>
          ) : null}
        </Panel>
      ) : null}

      {props.canReturn || props.canApprove || props.canCreateOnBehalf ? (
        <Panel title="HR review" flush>
          {props.canCreateOnBehalf ? (
            <form
              className="grid gap-3 border-b border-border px-4 py-3 md:grid-cols-3"
              onSubmit={createOnBehalf}
            >
              <Field label="Employee">
                <select
                  className={inputClass}
                  onFocus={() => void loadEmployees()}
                  onChange={(event) =>
                    setOnBehalf((current) => ({ ...current, employeeId: eventValue(event) }))
                  }
                  required
                  value={onBehalf.employeeId}
                >
                  <option value="">Select an Employee</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.legalName} ({employee.employeeNumber})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="On-behalf reason">
                <input
                  className={inputClass}
                  maxLength={2000}
                  onChange={(event) =>
                    setOnBehalf((current) => ({ ...current, reason: eventValue(event) }))
                  }
                  required
                  value={onBehalf.reason}
                />
              </Field>
              <Field label="Evidence Document Version ID">
                <input
                  className={inputClass}
                  onChange={(event) =>
                    setOnBehalf((current) => ({
                      ...current,
                      evidenceDocumentVersionId: eventValue(event),
                    }))
                  }
                  required
                  value={onBehalf.evidenceDocumentVersionId}
                />
              </Field>
              <div className="md:col-span-3">
                <Button disabled={busy} type="submit" variant="secondary">
                  {busy ? 'Saving…' : 'Create on-behalf draft'}
                </Button>
              </div>
            </form>
          ) : null}
          {reviewQueue.length === 0 ? (
            <StateSurface compact>
              <p className="m-0">
                No submitted Employee Attendance Submission awaits review in this Attendance Period.
              </p>
            </StateSurface>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Submission</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {reviewQueue.map((submission) => (
                  <Tr key={submission.id}>
                    <RowHeader>
                      {submission.employee.legalName}
                      <span className="block text-caption font-normal text-ink-muted">
                        {submission.employee.employeeNumber}
                      </span>
                    </RowHeader>
                    <Td>
                      Version {submission.versionNo} · {submission.dayCount} day
                      {submission.dayCount === 1 ? '' : 's'}
                      {submission.onBehalfReason
                        ? ` · on behalf: ${submission.onBehalfReason}`
                        : ''}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-2">
                        {props.canReturn ? (
                          <Button
                            disabled={busy || comments.trim() === ''}
                            onClick={() =>
                              void run(
                                '/attendance-submissions/' + submission.id + '/return',
                                { reason: comments },
                                'Submission returned with a reason.',
                              )
                            }
                            type="button"
                            variant="secondary"
                          >
                            Return
                          </Button>
                        ) : null}
                        {props.canApprove ? (
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void run(
                                '/attendance-submissions/' + submission.id + '/approve',
                                { reason: comments.trim() || undefined },
                                'Exact Attendance Day versions approved.',
                              )
                            }
                            type="button"
                            variant="primary"
                          >
                            Approve
                          </Button>
                        ) : null}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          {props.canReturn || props.canApprove ? (
            <div className="px-4 py-3">
              <Field label="Decision comments">
                <input
                  className={inputClass}
                  maxLength={2000}
                  onChange={(event) => setComments(eventValue(event))}
                  value={comments}
                />
              </Field>
            </div>
          ) : null}
        </Panel>
      ) : null}

      {props.canReadReports ? (
        <Panel
          title="Finalized Daily Time Records"
          flush
          actions={
            canGenerateForPeriod && latestLocked ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void run(
                    '/attendance-period-versions/' + latestLocked.id + '/dtrs',
                    undefined,
                    'Finalized Daily Time Records materialized for the locked version.',
                  )
                }
                type="button"
                variant="primary"
              >
                Generate Finalized DTRs
              </Button>
            ) : null
          }
        >
          <p className="m-0 px-4 py-3 text-small text-ink-muted">
            One retained Printable System View per covered Employee and locked Attendance Period
            Version. Earlier artifacts stay in history.
          </p>
          {periodDtrs.length === 0 ? (
            <StateSurface compact>
              <p className="m-0">
                No Finalized Daily Time Record exists for this Attendance Period yet.
              </p>
            </StateSurface>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {periodDtrs.map((dtr) => (
                  <Tr key={dtr.id} selected={dtr.id === selectedDtrId}>
                    <RowHeader>
                      <button
                        className="cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-ink underline-offset-2 hover:underline"
                        onClick={() => setSelectedDtrId(dtr.id)}
                        type="button"
                      >
                        {dtr.employee.legalName} ({dtr.employee.employeeNumber})
                        <span className="block text-caption font-normal text-ink-muted">
                          Version {dtr.versionNo} · {dtr.classification} · {dtr.outputType} ·{' '}
                          {dtr.isCurrent ? 'Current' : 'History'}
                        </span>
                      </button>
                    </RowHeader>
                    <Td>
                      <a
                        className={buttonVariants({ variant: 'secondary' })}
                        href={printHref('/dtrs/' + dtr.id + '/print')}
                        rel="noopener"
                        target="_blank"
                      >
                        Print
                      </a>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          {selectedDtr ? (
            <section
              aria-label="Finalized Daily Time Record detail"
              className="grid gap-3 border-t border-border bg-canvas p-4"
            >
              <h3 className={sectionTitleClass}>
                {selectedDtr.document.employee.legalName} · {selectedDtr.document.period.code} ·
                Version {selectedDtr.document.versionNo}
              </h3>
              <dl className="m-0 grid gap-x-6 gap-y-2 text-small md:grid-cols-2">
                {(
                  [
                    ['Classification', selectedDtr.document.classification],
                    ['Output', selectedDtr.document.outputType],
                    ['Locked at', selectedDtr.manifest.version.lockedAt ?? '—'],
                    ['Generated at', selectedDtr.document.generatedAt],
                    ['Current artifact', selectedDtr.document.isCurrent ? 'Yes' : 'No'],
                    ['Corrects', selectedDtr.document.predecessorDtrDocumentId ?? 'No predecessor'],
                  ] as const
                ).map(([term, value]) => (
                  <div className="flex gap-2" key={term}>
                    <dt className="min-w-40 text-caption font-[650] text-ink-muted">{term}</dt>
                    <dd className="m-0 break-all text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="m-0 text-caption text-ink-muted">
                Source lineage: {selectedDtr.manifest.days.length} Attendance Day version
                {selectedDtr.manifest.days.length === 1 ? '' : 's'} with exact presentation and
                segment references.
              </p>
              <div>
                <a
                  className={buttonVariants({ variant: 'primary' })}
                  href={printHref('/dtrs/' + selectedDtr.document.id + '/print')}
                  rel="noopener"
                  target="_blank"
                >
                  Print Daily Time Record
                </a>
              </div>
            </section>
          ) : null}
        </Panel>
      ) : null}

      {selectedPeriod ? (
        <p className="m-0 text-caption text-ink-muted">
          Selected Attendance Period {selectedPeriod.code} · latest version{' '}
          {latestVersion ? `${latestVersion.versionNo} (${latestVersion.status})` : 'none'}.
        </p>
      ) : null}
    </div>
  );
}
