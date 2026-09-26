'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button, buttonVariants } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';

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
    <section className="grid gap-5 text-sm text-ink">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="m-0 text-[10px] font-bold tracking-[.12em] text-muted uppercase">
            Attendance
          </p>
          <h1 className="m-0 text-xl font-[680] text-midnight">Daily Time Records</h1>
        </div>
        {periods.length > 0 ? (
          <label className="grid gap-1 text-xs font-medium text-muted">
            Attendance Period
            <select
              aria-label="Attendance Period"
              className={inputClass}
              onChange={(event) => setSelectedPeriodId(eventValue(event))}
              value={selectedPeriodId}
            >
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.code} · {period.dateFrom} to {period.dateTo} · {period.status}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>

      {error ? <FormError message={error} /> : null}
      {success ? (
        <p
          className="m-0 rounded-[3px] border border-line bg-[#e8f3ed] px-4 py-3 text-xs text-[#316647]"
          role="status"
        >
          {success}
        </p>
      ) : null}

      {props.canReadDays ? (
        <section
          aria-labelledby="dtr-preview-heading"
          className="overflow-hidden rounded-[5px] border border-line bg-paper"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="m-0 text-sm font-[650] text-midnight" id="dtr-preview-heading">
                Unfinalized Daily Time Record Preview
              </h2>
              <p className="m-0 mt-1 text-xs text-muted">
                Derived from the current Attendance Day versions. This is not a Finalized Daily Time
                Record.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {preview ? (
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
                      size="default"
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
              ) : null}
            </div>
          </div>
          <div className="px-5 py-4">
            <p
              className="m-0 mb-3 inline-block rounded-[3px] border border-[#b45309] bg-[#fef3c7] px-2 py-1 text-[10px] font-bold tracking-[.08em] text-[#7c2d12] uppercase"
              role="note"
            >
              Unfinalized preview
            </p>
            {previewError ? (
              <p className="m-0 text-xs text-muted">{previewError}</p>
            ) : preview ? (
              <table className="w-full border-collapse text-xs">
                <caption className="sr-only">
                  {preview.employee.legalName} · {preview.period.code}
                </caption>
                <thead>
                  <tr>
                    <th className="border border-line px-3 py-2 text-left" scope="col">
                      Work date
                    </th>
                    <th className="border border-line px-3 py-2 text-left" scope="col">
                      DTR presentation
                    </th>
                    <th className="border border-line px-3 py-2 text-right" scope="col">
                      Expected
                    </th>
                    <th className="border border-line px-3 py-2 text-right" scope="col">
                      Worked
                    </th>
                    <th className="border border-line px-3 py-2 text-right" scope="col">
                      Tardiness
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.days.map((day) => (
                    <tr key={day.attendanceDayId}>
                      <td className="border border-line px-3 py-2 align-top">
                        <strong>{day.workDate}</strong>
                        <span className="block text-muted">
                          {day.dayClassification.replaceAll('_', ' ')} · v{day.calculationVersion} ·{' '}
                          {day.status}
                        </span>
                      </td>
                      <td className="border border-line px-3 py-2 align-top">
                        {day.presentation.length === 0 ? (
                          <span className="text-muted">No recorded event presentation.</span>
                        ) : (
                          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
                            {day.presentation.map((entry) => (
                              <li key={entry.eventId}>{presentationText(entry)}</li>
                            ))}
                          </ul>
                        )}
                        {day.exceptions.some((exception) => exception.status === 'OPEN') ? (
                          <span className="mt-1 block font-semibold text-[#b91c1c]">
                            {day.exceptions
                              .filter((exception) => exception.status === 'OPEN')
                              .map((exception) => exception.exceptionType)
                              .join(', ')}
                          </span>
                        ) : null}
                      </td>
                      <td className="border border-line px-3 py-2 text-right align-top">
                        {timeLabel(day.totals.expectedMinutes)}
                      </td>
                      <td className="border border-line px-3 py-2 text-right align-top">
                        {timeLabel(day.totals.workedMinutes)}
                      </td>
                      <td className="border border-line px-3 py-2 text-right align-top">
                        {timeLabel(day.totals.lateMinutes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="m-0 text-xs text-muted">Loading the preview…</p>
            )}
          </div>
          {ownSubmission ? (
            <div
              aria-label="My attendance submission"
              className="border-t border-line bg-[#f8fafc] px-5 py-4"
              role="region"
            >
              <h3 className="m-0 text-xs font-[650] text-midnight">My attendance submission</h3>
              <p className="m-0 mt-1 text-xs text-muted">
                Version {ownSubmission.versionNo} · {ownSubmission.status} ·{' '}
                {ownSubmission.dayCount} bound Attendance Day version
                {ownSubmission.dayCount === 1 ? '' : 's'}
                {ownSubmission.reviewReason ? ` · ${ownSubmission.reviewReason}` : ''}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {props.canSubmit && ['DRAFT', 'RETURNED'].includes(ownSubmission.status) ? (
                  <Button
                    size="default"
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
                    size="default"
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
            </div>
          ) : null}
        </section>
      ) : null}

      {props.canReturn || props.canApprove || props.canCreateOnBehalf ? (
        <section
          aria-labelledby="dtr-review-heading"
          className="overflow-hidden rounded-[5px] border border-line bg-paper"
        >
          <div className="border-b border-line px-5 py-4">
            <h2 className="m-0 text-sm font-[650] text-midnight" id="dtr-review-heading">
              HR review
            </h2>
          </div>
          {props.canCreateOnBehalf ? (
            <form
              className="grid gap-3 border-b border-line px-5 py-4 md:grid-cols-3"
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
                <Button size="default" disabled={busy} type="submit" variant="secondary">
                  {busy ? 'Saving…' : 'Create on-behalf draft'}
                </Button>
              </div>
            </form>
          ) : null}
          <div className="px-5 py-4">
            {reviewQueue.length === 0 ? (
              <p className="m-0 text-xs text-muted">
                No submitted Employee Attendance Submission awaits review in this Attendance Period.
              </p>
            ) : (
              <ul className="m-0 grid list-none gap-3 p-0">
                {reviewQueue.map((submission) => (
                  <li
                    className="grid gap-2 rounded-[3px] border border-line px-3 py-3"
                    key={submission.id}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <strong className="text-xs text-ink">
                          {submission.employee.legalName}
                        </strong>
                        <span className="block text-xs text-muted">
                          {submission.employee.employeeNumber} · Version {submission.versionNo} ·{' '}
                          {submission.dayCount} day{submission.dayCount === 1 ? '' : 's'}
                          {submission.onBehalfReason
                            ? ` · on behalf: ${submission.onBehalfReason}`
                            : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {props.canReturn ? (
                          <Button
                            size="default"
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
                            size="default"
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
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {props.canReturn || props.canApprove ? (
              <label className="mt-3 grid gap-1 text-xs font-medium text-muted">
                Decision comments
                <input
                  className={inputClass}
                  maxLength={2000}
                  onChange={(event) => setComments(eventValue(event))}
                  value={comments}
                />
              </label>
            ) : null}
          </div>
        </section>
      ) : null}

      {props.canReadReports ? (
        <section
          aria-labelledby="dtr-register-heading"
          className="overflow-hidden rounded-[5px] border border-line bg-paper"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="m-0 text-sm font-[650] text-midnight" id="dtr-register-heading">
                Finalized Daily Time Records
              </h2>
              <p className="m-0 mt-1 text-xs text-muted">
                One retained Printable System View per covered Employee and locked Attendance Period
                Version. Earlier artifacts stay in history.
              </p>
            </div>
            {canGenerateForPeriod && latestLocked ? (
              <Button
                size="default"
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
            ) : null}
          </div>
          <div className="px-5 py-4">
            {periodDtrs.length === 0 ? (
              <p className="m-0 text-xs text-muted">
                No Finalized Daily Time Record exists for this Attendance Period yet.
              </p>
            ) : (
              <ul className="m-0 grid list-none gap-2 p-0">
                {periodDtrs.map((dtr) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[3px] border border-line px-3 py-3"
                    key={dtr.id}
                  >
                    <button
                      className="cursor-pointer text-left text-xs font-[650] text-cobalt underline-offset-2 hover:underline"
                      onClick={() => setSelectedDtrId(dtr.id)}
                      type="button"
                    >
                      {dtr.employee.legalName} ({dtr.employee.employeeNumber})
                      <span className="block font-normal text-muted">
                        Version {dtr.versionNo} · {dtr.classification} · {dtr.outputType} ·{' '}
                        {dtr.isCurrent ? 'Current' : 'History'}
                      </span>
                    </button>
                    <a
                      className={buttonVariants({ variant: 'secondary' })}
                      href={printHref('/dtrs/' + dtr.id + '/print')}
                      rel="noopener"
                      target="_blank"
                    >
                      Print
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {selectedDtr ? (
              <div
                aria-label="Finalized Daily Time Record detail"
                className="mt-4 rounded-[3px] border border-line bg-[#f8fafc] px-4 py-4"
                role="region"
              >
                <h3 className="m-0 text-sm font-[650] text-midnight">
                  {selectedDtr.document.employee.legalName} · {selectedDtr.document.period.code} ·
                  Version {selectedDtr.document.versionNo}
                </h3>
                <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs md:grid-cols-2">
                  <div className="flex gap-2">
                    <dt className="min-w-40 font-semibold text-muted">Classification</dt>
                    <dd className="m-0">{selectedDtr.document.classification}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="min-w-40 font-semibold text-muted">Output</dt>
                    <dd className="m-0">{selectedDtr.document.outputType}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="min-w-40 font-semibold text-muted">Locked at</dt>
                    <dd className="m-0">{selectedDtr.manifest.version.lockedAt ?? '—'}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="min-w-40 font-semibold text-muted">Generated at</dt>
                    <dd className="m-0">{selectedDtr.document.generatedAt}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="min-w-40 font-semibold text-muted">Current artifact</dt>
                    <dd className="m-0">{selectedDtr.document.isCurrent ? 'Yes' : 'No'}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="min-w-40 font-semibold text-muted">Corrects</dt>
                    <dd className="m-0">
                      {selectedDtr.document.predecessorDtrDocumentId ?? 'No predecessor'}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-muted">
                  Source lineage: {selectedDtr.manifest.days.length} Attendance Day version
                  {selectedDtr.manifest.days.length === 1 ? '' : 's'} with exact presentation and
                  segment references.
                </p>
                <div className="mt-3">
                  <a
                    className={buttonVariants({ variant: 'primary' })}
                    href={printHref('/dtrs/' + selectedDtr.document.id + '/print')}
                    rel="noopener"
                    target="_blank"
                  >
                    Print Daily Time Record
                  </a>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {selectedPeriod ? (
        <p className="m-0 text-xs text-muted">
          Selected Attendance Period {selectedPeriod.code} · latest version{' '}
          {latestVersion ? `${latestVersion.versionNo} (${latestVersion.status})` : 'none'}.
        </p>
      ) : null}
    </section>
  );
}
