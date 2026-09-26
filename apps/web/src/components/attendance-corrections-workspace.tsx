'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRecordNavigation } from './record-navigation';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';

export type AttendanceCorrectionAction = 'ADD' | 'REPLACE' | 'VOID';
export type AttendanceCorrectionTargetType = 'ATTENDANCE_EVENT' | 'ATTENDANCE_CONTEXT';
export type AttendanceCorrectionStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'NEEDS_INFORMATION'
  | 'APPROVED'
  | 'FOR_AUTHORIZATION'
  | 'REJECTED'
  | 'CANCELLED'
  | 'APPLIED';

export interface AttendanceCorrection {
  id: string;
  agencyId: string;
  employee: { id: string; employeeNumber: string; legalName: string };
  initiatedByMembershipId: string;
  recordedByMembershipId: string;
  targetType: AttendanceCorrectionTargetType;
  requestedAction: AttendanceCorrectionAction;
  targetId: string | null;
  requestedRecord: Record<string, unknown> | null;
  status: AttendanceCorrectionStatus;
  reason: string;
  approvalRouteVersionId: string;
  submittedAt: string | null;
  decidedByMembershipId: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  authorizedByMembershipId: string | null;
  authorizedAt: string | null;
  appliedByMembershipId: string | null;
  appliedAt: string | null;
  createdAt: string;
}

export interface AttendanceCorrectionImpactPreview {
  computedAt: string;
  targetType: AttendanceCorrectionTargetType;
  requestedAction: AttendanceCorrectionAction;
  targetWorkDate: string | null;
  proposedWorkDate: string | null;
  days: Array<{
    employeeId: string;
    workDate: string;
    attendanceDayId: string | null;
    calculationVersion: number | null;
    status: string | null;
    attendancePeriodId: string;
    periodCode: string;
    periodStatus: string;
    lockedPeriodVersionId: string | null;
  }>;
  periods: Array<{ id: string; code: string; dateFrom: string; dateTo: string; status: string }>;
  lockedPeriodVersionIds: string[];
  fingerprint: string;
}

export interface AttendanceCorrectionDetail {
  correction: AttendanceCorrection;
  impactPreview: AttendanceCorrectionImpactPreview;
  evidence: Array<{
    id: string;
    documentVersionId: string | null;
    documentNo: string | null;
    sourceType: string | null;
    sourceId: string | null;
    createdAt: string;
  }>;
  effect: {
    id: string;
    effectAction: AttendanceCorrectionAction;
    targetType: AttendanceCorrectionTargetType;
    originalTargetId: string | null;
    appliedAt: string;
  } | null;
  lockedAdjustment: {
    id: string;
    authorizedByMembershipId: string;
    authorizedAt: string;
    periods: Array<{ predecessorPeriodVersionId: string; successorPeriodVersionId: string }>;
  } | null;
  approval: {
    approvalRequestId: string;
    routeVersionId: string;
    status: string;
    currentStepNo: number | null;
  } | null;
}

export interface AttendanceCorrectionListResponse {
  corrections: AttendanceCorrection[];
}

interface EmployeeOption {
  id: string;
  employeeNumber: string;
  legalName: string;
}

type View = 'tree' | 'form' | 'kanban';

function errorMessage(value: unknown, fallback: string): string {
  const error = (value as { error?: { message?: unknown } }).error;
  return typeof error?.message === 'string' ? error.message : fallback;
}

function statusClass(status: AttendanceCorrectionStatus): string {
  if (status === 'APPLIED') return 'bg-emerald-50 text-emerald-800';
  if (status === 'REJECTED') return 'bg-rose-50 text-rose-800';
  if (status === 'FOR_AUTHORIZATION') return 'bg-amber-50 text-amber-900';
  if (status === 'SUBMITTED') return 'bg-sky-50 text-sky-800';
  if (status === 'NEEDS_INFORMATION') return 'bg-amber-50 text-amber-900';
  if (status === 'CANCELLED') return 'bg-slate-100 text-slate-700';
  return 'bg-slate-100 text-slate-800';
}

function valueOf(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

/** Wall-clock corrections are agency-time facts, matching the attendance capture form. */
function manilaFactInstant(value: string): string {
  return `${value}:00+08:00`;
}

function actionLabel(action: AttendanceCorrectionAction): string {
  if (action === 'ADD') return 'Add';
  if (action === 'REPLACE') return 'Replace';
  return 'Void';
}

export function AttendanceCorrectionsWorkspace({
  agencyId,
  canCreate,
  canSubmit,
  canApprove,
  canReturn,
  canReject,
  canAuthorizeLocked,
  canCancel,
  initialCorrections,
}: {
  agencyId: string;
  canCreate: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReturn: boolean;
  canReject: boolean;
  canAuthorizeLocked: boolean;
  canCancel: boolean;
  initialCorrections: AttendanceCorrectionListResponse;
}) {
  const [corrections, setCorrections] = useState(initialCorrections.corrections);
  const [statusFilter, setStatusFilter] = useState<'ALL' | AttendanceCorrectionStatus>('ALL');
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<AttendanceCorrectionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [comments, setComments] = useState('');
  const [creating, setCreating] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [form, setForm] = useState({
    employeeId: '',
    targetType: 'ATTENDANCE_EVENT' as AttendanceCorrectionTargetType,
    requestedAction: 'REPLACE' as AttendanceCorrectionAction,
    targetId: '',
    reason: '',
    documentVersionId: '',
    sourceType: '',
    sourceId: '',
    eventType: 'TIME_OUT',
    eventTime: '',
    contextType: 'OFFICIAL_BUSINESS',
    coverageMode: 'WHOLE_WORK_DATE' as 'WHOLE_WORK_DATE' | 'TIMED',
    workDate: '',
    startsAt: '',
    endsAt: '',
    onBehalfReason: '',
  });
  const navigation = useRecordNavigation();
  const requestedView = navigation.search.get('view');
  const view: View =
    requestedView === 'form' ? 'form' : requestedView === 'kanban' ? 'kanban' : 'tree';
  const recordId = navigation.search.get('record');

  useEffect(() => {
    let active = true;
    void request('/attendance-corrections')
      .then((value) => {
        if (active) setCorrections((value as AttendanceCorrectionListResponse).corrections);
      })
      .catch((failure: unknown) => {
        if (active)
          setError(failure instanceof Error ? failure.message : 'The correction register failed.');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (recordId === null) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    setError('');
    void request('/attendance-corrections/' + recordId)
      .then((value) => {
        if (active) setDetail(value as AttendanceCorrectionDetail);
      })
      .catch((failure: unknown) => {
        if (active)
          setError(failure instanceof Error ? failure.message : 'The correction failed to load.');
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
      throw new Error(errorMessage(value, 'The Attendance Correction action failed.'));
    }
    return value;
  }

  async function refresh(selectId?: string): Promise<void> {
    const list = (await request('/attendance-corrections')) as AttendanceCorrectionListResponse;
    setCorrections(list.corrections);
    if (selectId) {
      const refreshed = (await request(
        '/attendance-corrections/' + selectId,
      )) as AttendanceCorrectionDetail;
      setDetail(refreshed);
    }
  }

  async function loadEmployees(): Promise<void> {
    if (employees.length > 0) return;
    const value = (await request('/employees')) as { employees: EmployeeOption[] };
    setEmployees(value.employees);
  }

  function openCreate(): void {
    setError('');
    setSuccess('');
    setCreating(true);
    void loadEmployees().catch((failure: unknown) =>
      setError(failure instanceof Error ? failure.message : 'Loading employees failed.'),
    );
  }

  function openRecord(id: string): void {
    setError('');
    setSuccess('');
    setComments('');
    navigation.navigate({ view: 'form', record: id, new: null });
  }

  async function runAction(
    path: string,
    body: Record<string, unknown> | undefined,
    successMessage: string,
  ): Promise<void> {
    if (!detail) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const value = (await request('/attendance-corrections/' + detail.correction.id + path, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })) as AttendanceCorrectionDetail;
      setDetail(value);
      setComments('');
      setSuccess(successMessage);
      await refresh();
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : 'The correction action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function createCorrection(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    const requestedRecord =
      form.requestedAction === 'VOID'
        ? undefined
        : form.targetType === 'ATTENDANCE_EVENT'
          ? {
              eventType: form.eventType,
              eventTime: manilaFactInstant(form.eventTime),
            }
          : form.coverageMode === 'WHOLE_WORK_DATE'
            ? {
                contextType: form.contextType,
                coverageMode: 'WHOLE_WORK_DATE',
                workDate: form.workDate,
                reason: form.reason,
                ...(form.documentVersionId
                  ? { evidenceDocumentVersionId: form.documentVersionId }
                  : {}),
              }
            : {
                contextType: form.contextType,
                coverageMode: 'TIMED',
                startsAt: manilaFactInstant(form.startsAt),
                endsAt: manilaFactInstant(form.endsAt),
                reason: form.reason,
                ...(form.documentVersionId
                  ? { evidenceDocumentVersionId: form.documentVersionId }
                  : {}),
              };
    const evidence = form.documentVersionId
      ? [{ documentVersionId: form.documentVersionId }]
      : form.sourceType && form.sourceId
        ? [{ sourceType: form.sourceType, sourceId: form.sourceId }]
        : [];
    try {
      const created = (await request('/attendance-corrections', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          ...(form.employeeId ? { employeeId: form.employeeId } : {}),
          targetType: form.targetType,
          requestedAction: form.requestedAction,
          ...(form.targetId ? { targetId: form.targetId } : {}),
          ...(requestedRecord ? { requestedRecord } : {}),
          reason: form.reason,
          ...(form.onBehalfReason ? { onBehalfReason: form.onBehalfReason } : {}),
          evidence,
        }),
      })) as AttendanceCorrectionDetail;
      setCreating(false);
      setSuccess('Correction saved as a draft.');
      await refresh();
      openRecord(created.correction.id);
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : 'The correction could not be created.');
    } finally {
      setBusy(false);
    }
  }

  const visible = corrections.filter((correction) => {
    if (statusFilter !== 'ALL' && correction.status !== statusFilter) return false;
    if (query.trim() === '') return true;
    const needle = query.trim().toLowerCase();
    return (
      correction.employee.legalName.toLowerCase().includes(needle) ||
      correction.employee.employeeNumber.toLowerCase().includes(needle) ||
      correction.reason.toLowerCase().includes(needle)
    );
  });

  function correctionRow(correction: AttendanceCorrection) {
    return (
      <tr key={correction.id} className="border-t border-line/70">
        <td className="px-3 py-2">
          <button
            type="button"
            className="text-left font-medium text-ink underline-offset-2 hover:underline"
            onClick={() => openRecord(correction.id)}
          >
            {correction.employee.legalName}
          </button>
          <p className="text-xs text-muted">{correction.employee.employeeNumber}</p>
        </td>
        <td className="px-3 py-2 text-xs">
          {correction.targetType === 'ATTENDANCE_EVENT' ? 'Event' : 'Context'}
        </td>
        <td className="px-3 py-2 text-xs">{actionLabel(correction.requestedAction)}</td>
        <td className="px-3 py-2 text-xs">{correction.reason}</td>
        <td className="px-3 py-2">
          <span className={'rounded-full px-2 py-0.5 text-xs ' + statusClass(correction.status)}>
            {correction.status.replaceAll('_', ' ')}
          </span>
        </td>
      </tr>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Attendance Corrections</h1>
          <p className="text-sm text-muted">
            Evidence-backed add, replace, or void requests that never rewrite source or finalized
            history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <nav aria-label="Correction views" className="flex items-center gap-1">
            {(['tree', 'form', 'kanban'] as const).map((candidate) => (
              <Button
                key={candidate}
                variant={view === candidate ? 'primary' : 'secondary'}
                size="default"
                onClick={() => navigation.navigate({ view: candidate })}
              >
                {candidate === 'tree' ? 'Tree' : candidate === 'form' ? 'Form' : 'Kanban'}
              </Button>
            ))}
          </nav>
          {canCreate ? (
            <Button size="default" onClick={openCreate}>
              New correction
            </Button>
          ) : null}
        </div>
      </header>

      {error ? <FormError message={error} /> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

      {creating ? (
        <section className="rounded-[5px] border border-line bg-paper p-5">
          <h2 className="text-sm font-semibold text-ink">New Attendance Correction</h2>
          <form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={createCorrection}>
            <Field label="Employee (leave blank for your own record)">
              <select
                className={inputClass}
                value={form.employeeId}
                onChange={(event) => setForm({ ...form, employeeId: valueOf(event) })}
              >
                <option value="">My own record</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.legalName} ({employee.employeeNumber})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Target type">
              <select
                className={inputClass}
                value={form.targetType}
                onChange={(event) =>
                  setForm({ ...form, targetType: valueOf(event) as AttendanceCorrectionTargetType })
                }
              >
                <option value="ATTENDANCE_EVENT">Attendance Event</option>
                <option value="ATTENDANCE_CONTEXT">Attendance Context</option>
              </select>
            </Field>
            <Field label="Requested action">
              <select
                className={inputClass}
                value={form.requestedAction}
                onChange={(event) =>
                  setForm({
                    ...form,
                    requestedAction: valueOf(event) as AttendanceCorrectionAction,
                  })
                }
              >
                <option value="ADD">Add</option>
                <option value="REPLACE">Replace</option>
                <option value="VOID">Void</option>
              </select>
            </Field>
            {form.requestedAction !== 'ADD' ? (
              <Field label="Exact target identifier">
                <input
                  className={inputClass}
                  value={form.targetId}
                  onChange={(event) => setForm({ ...form, targetId: valueOf(event) })}
                  placeholder="Attendance Event or Context UUID"
                />
              </Field>
            ) : null}
            {form.requestedAction !== 'VOID' && form.targetType === 'ATTENDANCE_EVENT' ? (
              <>
                <Field label="Proposed event type">
                  <select
                    className={inputClass}
                    value={form.eventType}
                    onChange={(event) => setForm({ ...form, eventType: valueOf(event) })}
                  >
                    {['TIME_IN', 'BREAK_OUT', 'BREAK_IN', 'TIME_OUT'].map((type) => (
                      <option key={type} value={type}>
                        {type.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Proposed event instant">
                  <input
                    className={inputClass}
                    type="datetime-local"
                    value={form.eventTime}
                    onChange={(event) => setForm({ ...form, eventTime: valueOf(event) })}
                    required
                  />
                </Field>
              </>
            ) : null}
            {form.requestedAction !== 'VOID' && form.targetType === 'ATTENDANCE_CONTEXT' ? (
              <>
                <Field label="Context type">
                  <select
                    className={inputClass}
                    value={form.contextType}
                    onChange={(event) => setForm({ ...form, contextType: valueOf(event) })}
                  >
                    {['OFFICIAL_BUSINESS', 'OFFICIAL_TRAVEL', 'TRAINING', 'APPROVED_ABSENCE'].map(
                      (type) => (
                        <option key={type} value={type}>
                          {type.replaceAll('_', ' ')}
                        </option>
                      ),
                    )}
                  </select>
                </Field>
                <Field label="Coverage mode">
                  <select
                    className={inputClass}
                    value={form.coverageMode}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        coverageMode: valueOf(event) as 'WHOLE_WORK_DATE' | 'TIMED',
                      })
                    }
                  >
                    <option value="WHOLE_WORK_DATE">Whole work date</option>
                    <option value="TIMED">Timed</option>
                  </select>
                </Field>
                {form.coverageMode === 'WHOLE_WORK_DATE' ? (
                  <Field label="Work date">
                    <input
                      className={inputClass}
                      type="date"
                      value={form.workDate}
                      onChange={(event) => setForm({ ...form, workDate: valueOf(event) })}
                      required
                    />
                  </Field>
                ) : (
                  <>
                    <Field label="Starts at">
                      <input
                        className={inputClass}
                        type="datetime-local"
                        value={form.startsAt}
                        onChange={(event) => setForm({ ...form, startsAt: valueOf(event) })}
                        required
                      />
                    </Field>
                    <Field label="Ends at">
                      <input
                        className={inputClass}
                        type="datetime-local"
                        value={form.endsAt}
                        onChange={(event) => setForm({ ...form, endsAt: valueOf(event) })}
                        required
                      />
                    </Field>
                  </>
                )}
              </>
            ) : null}
            <Field label="Reason">
              <input
                className={inputClass}
                value={form.reason}
                onChange={(event) => setForm({ ...form, reason: valueOf(event) })}
                required
              />
            </Field>
            {form.employeeId ? (
              <Field label="On-behalf reason">
                <input
                  className={inputClass}
                  value={form.onBehalfReason}
                  onChange={(event) => setForm({ ...form, onBehalfReason: valueOf(event) })}
                  required
                />
              </Field>
            ) : null}
            <Field label="Evidence Document Version">
              <input
                className={inputClass}
                value={form.documentVersionId}
                onChange={(event) => setForm({ ...form, documentVersionId: valueOf(event) })}
                placeholder="Finalized Document Version UUID"
              />
            </Field>
            {!form.documentVersionId ? (
              <>
                <Field label="Evidence source type">
                  <input
                    className={inputClass}
                    value={form.sourceType}
                    onChange={(event) => setForm({ ...form, sourceType: valueOf(event) })}
                    placeholder="Authoritative source type"
                  />
                </Field>
                <Field label="Evidence source identifier">
                  <input
                    className={inputClass}
                    value={form.sourceId}
                    onChange={(event) => setForm({ ...form, sourceId: valueOf(event) })}
                    placeholder="Authoritative source UUID"
                  />
                </Field>
              </>
            ) : null}
            <div className="flex items-end gap-2 md:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save draft'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      {view === 'tree' ? (
        <section className="rounded-[5px] border border-line bg-paper">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <input
              className={inputClass + ' max-w-xs'}
              placeholder="Search employee or reason"
              value={query}
              onChange={(event) => setQuery(valueOf(event))}
            />
            <select
              className={inputClass + ' max-w-xs'}
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(valueOf(event) as 'ALL' | AttendanceCorrectionStatus)
              }
            >
              <option value="ALL">All statuses</option>
              {(
                [
                  'DRAFT',
                  'SUBMITTED',
                  'NEEDS_INFORMATION',
                  'FOR_AUTHORIZATION',
                  'APPLIED',
                  'REJECTED',
                  'CANCELLED',
                ] as const
              ).map((status) => (
                <option key={status} value={status}>
                  {status.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          {visible.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">No Attendance Corrections match.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-muted">
                    <th className="px-3 py-2">Employee</th>
                    <th className="px-3 py-2">Target</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Reason</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>{visible.map(correctionRow)}</tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {view === 'kanban' ? (
        <section
          aria-label="Attendance Correction status board"
          className="grid gap-3 md:grid-cols-4"
        >
          {(['DRAFT', 'SUBMITTED', 'FOR_AUTHORIZATION', 'APPLIED'] as const).map((status) => {
            const cards = visible.filter((correction) => correction.status === status);
            return (
              <div key={status} className="rounded-[5px] border border-line bg-paper p-3">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {status.replaceAll('_', ' ')} ({cards.length})
                </h2>
                <div className="mt-2 space-y-2">
                  {cards.map((correction) => (
                    <button
                      key={correction.id}
                      type="button"
                      className="w-full rounded-[4px] border border-line p-2 text-left text-sm"
                      onClick={() => openRecord(correction.id)}
                    >
                      <span className="font-medium text-ink">{correction.employee.legalName}</span>
                      <span className="block text-xs text-muted">
                        {actionLabel(correction.requestedAction)} · {correction.reason}
                      </span>
                    </button>
                  ))}
                  {cards.length === 0 ? <p className="text-xs text-muted">Empty.</p> : null}
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

      {view === 'form' ? (
        <section
          aria-label="Attendance Correction record"
          className="rounded-[5px] border border-line bg-paper p-5"
        >
          {detailLoading ? <p className="text-sm text-muted">Loading…</p> : null}
          {!detailLoading && !detail ? (
            <p className="text-sm text-muted">
              Select an Attendance Correction from the Tree view.
            </p>
          ) : null}
          {detail ? (
            <CorrectionDetail
              detail={detail}
              busy={busy}
              comments={comments}
              setComments={setComments}
              canSubmit={canSubmit}
              canApprove={canApprove}
              canReturn={canReturn}
              canReject={canReject}
              canAuthorizeLocked={canAuthorizeLocked}
              canCancel={canCancel}
              runAction={runAction}
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function CorrectionDetail({
  detail,
  busy,
  comments,
  setComments,
  canSubmit,
  canApprove,
  canReturn,
  canReject,
  canAuthorizeLocked,
  canCancel,
  runAction,
}: {
  detail: AttendanceCorrectionDetail;
  busy: boolean;
  comments: string;
  setComments: (value: string) => void;
  canSubmit: boolean;
  canApprove: boolean;
  canReturn: boolean;
  canReject: boolean;
  canAuthorizeLocked: boolean;
  canCancel: boolean;
  runAction: (
    path: string,
    body: Record<string, unknown> | undefined,
    message: string,
  ) => Promise<void>;
}) {
  const { correction, impactPreview } = detail;
  const showSubmit = canSubmit && ['DRAFT', 'NEEDS_INFORMATION'].includes(correction.status);
  const showDecide = canApprove && correction.status === 'SUBMITTED';
  const showReturn = canReturn && correction.status === 'SUBMITTED';
  const showReject = canReject && correction.status === 'SUBMITTED';
  const showAuthorize = canAuthorizeLocked && correction.status === 'FOR_AUTHORIZATION';
  const showCancel = canCancel && ['DRAFT', 'SUBMITTED'].includes(correction.status);
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">
            {actionLabel(correction.requestedAction)}{' '}
            {correction.targetType === 'ATTENDANCE_EVENT'
              ? 'attendance event'
              : 'attendance context'}
          </h2>
          <p className="text-sm text-muted">
            {correction.employee.legalName} ({correction.employee.employeeNumber})
          </p>
        </div>
        <span
          className={'rounded-full px-3 py-1 text-xs font-medium ' + statusClass(correction.status)}
        >
          {correction.status.replaceAll('_', ' ')}
        </span>
      </header>

      <dl className="grid gap-3 text-sm md:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Reason</dt>
          <dd className="text-ink">{correction.reason}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Exact target</dt>
          <dd className="break-all text-ink">{correction.targetId ?? 'Proposed new fact'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Approval Route Version</dt>
          <dd className="break-all text-ink">{correction.approvalRouteVersionId}</dd>
        </div>
      </dl>

      <section>
        <h3 className="text-sm font-semibold text-ink">Impact Preview</h3>
        <p className="text-xs text-muted">
          Fingerprint {impactPreview.fingerprint.slice(0, 12)} · {impactPreview.days.length}{' '}
          affected Work Date(s)
          {impactPreview.lockedPeriodVersionIds.length > 0 ? ' · locked period impact' : ''}
        </p>
        {impactPreview.days.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No calculable Work Date is affected.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {impactPreview.days.map((day) => (
              <li key={day.workDate} className="rounded-[4px] border border-line px-3 py-2">
                <span className="font-medium text-ink">{day.workDate}</span> · {day.periodCode} (
                {day.periodStatus}) ·{' '}
                {day.attendanceDayId
                  ? `current version ${day.calculationVersion} (${day.status})`
                  : 'no current Attendance Day'}
                {day.lockedPeriodVersionId ? ' · locked predecessor present' : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink">Evidence</h3>
        {detail.evidence.length === 0 ? (
          <p className="text-sm text-muted">No evidence recorded yet.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {detail.evidence.map((item) => (
              <li key={item.id} className="break-all text-ink">
                {item.documentVersionId
                  ? `Document${item.documentNo ? ` ${item.documentNo}` : ''} version ${item.documentVersionId}`
                  : `${item.sourceType} ${item.sourceId}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail.effect ? (
        <section>
          <h3 className="text-sm font-semibold text-ink">Applied Effect</h3>
          <p className="text-sm text-ink">
            {actionLabel(detail.effect.effectAction)} effect {detail.effect.id} applied{' '}
            {new Date(detail.effect.appliedAt).toLocaleString()}.
          </p>
        </section>
      ) : null}

      {detail.lockedAdjustment ? (
        <section>
          <h3 className="text-sm font-semibold text-ink">Locked Attendance Adjustment</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {detail.lockedAdjustment.periods.map((period) => (
              <li key={period.predecessorPeriodVersionId} className="break-all text-ink">
                {period.predecessorPeriodVersionId} → {period.successorPeriodVersionId}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-wrap items-end gap-3">
        <Field label="Decision comments">
          <textarea
            className={inputClass}
            rows={2}
            value={comments}
            onChange={(event) => setComments(valueOf(event))}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          {showSubmit ? (
            <Button
              disabled={busy}
              onClick={() =>
                void runAction('/submit', undefined, 'Correction submitted for HR review.')
              }
            >
              Submit
            </Button>
          ) : null}
          {showDecide ? (
            <Button
              disabled={busy}
              onClick={() =>
                void runAction(
                  '/approve',
                  comments ? { comments } : {},
                  'Factual correction approved.',
                )
              }
            >
              Approve
            </Button>
          ) : null}
          {showReturn ? (
            <Button
              variant="secondary"
              disabled={busy || comments.trim() === ''}
              onClick={() => void runAction('/return', { comments }, 'More information requested.')}
            >
              Request information
            </Button>
          ) : null}
          {showReject ? (
            <Button
              variant="secondary"
              disabled={busy || comments.trim() === ''}
              onClick={() => void runAction('/reject', { comments }, 'Correction rejected.')}
            >
              Reject
            </Button>
          ) : null}
          {showAuthorize ? (
            <Button
              disabled={busy}
              onClick={() =>
                void runAction(
                  '/authorize-locked',
                  comments ? { comments } : {},
                  'Locked Attendance Adjustment authorized and applied.',
                )
              }
            >
              Authorize locked adjustment
            </Button>
          ) : null}
          {showCancel ? (
            <Button
              variant="secondary"
              disabled={busy || comments.trim() === ''}
              onClick={() =>
                void runAction('/cancel', { reason: comments }, 'Correction cancelled.')
              }
            >
              Cancel correction
            </Button>
          ) : null}
        </div>
      </section>

      {detail.approval ? (
        <p className="text-xs text-muted">
          Approval Request {detail.approval.approvalRequestId} · {detail.approval.status} · step{' '}
          {detail.approval.currentStepNo ?? '—'}
        </p>
      ) : null}
    </div>
  );
}
