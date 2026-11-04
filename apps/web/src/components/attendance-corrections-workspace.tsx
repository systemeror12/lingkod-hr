'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useRecordNavigation } from './record-navigation';
import { RestrictedEvidence } from './restricted-evidence';
import { StateSurface } from './state-surface';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';
import { PageHeader } from './ui/page-header';
import { Panel } from './ui/panel';
import { SectionTabList, SectionTabPanel, SectionTabs } from './ui/section-tabs';
import { StatusTag, type StatusTone } from './ui/status-tag';
import { RowHeader, Table, Td, Th, TableFooter, Tr } from './ui/table';

export type AttendanceCorrectionAction = 'ADD' | 'REPLACE' | 'VOID';
export type AttendanceCorrectionTargetType =
  'ATTENDANCE_EVENT' | 'ATTENDANCE_CONTEXT' | 'POSTED_LEAVE_INPUT' | 'CTO_INPUT';
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
  excludedDeciderMembershipIds: string[];
  blockingReason: string | null;
  blockedByMembershipId: string | null;
  blockedAt: string | null;
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
  evidence: Array<
    | {
        access: 'FULL';
        id: string;
        documentVersionId: string | null;
        documentNo: string | null;
        sourceType: string | null;
        sourceId: string | null;
        createdAt: string;
      }
    | { access: 'RESTRICTED'; id: string; createdAt: string }
  >;
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

const STATUS_TONE: Record<AttendanceCorrectionStatus, StatusTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  NEEDS_INFORMATION: 'warning',
  APPROVED: 'info',
  FOR_AUTHORIZATION: 'warning',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  APPLIED: 'success',
};

const FILTER_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'NEEDS_INFORMATION',
  'FOR_AUTHORIZATION',
  'APPLIED',
  'REJECTED',
  'CANCELLED',
] as const;

const BOARD_STATUSES = ['DRAFT', 'SUBMITTED', 'FOR_AUTHORIZATION', 'APPLIED'] as const;

const sectionTitleClass = 'm-0 text-panel-title text-ink';

function statusLabel(status: AttendanceCorrectionStatus): string {
  return status.replaceAll('_', ' ');
}

function valueOf(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

/** Wall-clock corrections are agency-time facts, matching the attendance capture form. */
function manilaFactInstant(value: string): string {
  return `${value}:00+08:00`;
}

const TARGET_LABEL: Record<AttendanceCorrectionTargetType, string> = {
  ATTENDANCE_EVENT: 'attendance event',
  ATTENDANCE_CONTEXT: 'attendance context',
  POSTED_LEAVE_INPUT: 'posted leave',
  CTO_INPUT: 'CTO',
};

/** Names one evidence link, or only marks it when the reader may not identify it. */
export function evidenceLabel(item: AttendanceCorrectionDetail['evidence'][number]): ReactNode {
  if (item.access === 'RESTRICTED') return <RestrictedEvidence />;
  return item.documentVersionId
    ? `Document${item.documentNo ? ` ${item.documentNo}` : ''} version ${item.documentVersionId}`
    : `${item.sourceType} ${item.sourceId}`;
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

  return (
    <SectionTabs
      className="grid min-w-0 gap-5"
      value={view}
      onValueChange={(next) => navigation.navigate({ view: next })}
    >
      <PageHeader
        breadcrumbs={[{ label: 'Time & attendance' }]}
        title="Attendance Corrections"
        actions={
          canCreate ? (
            <Button variant="primary" onClick={openCreate}>
              New correction
            </Button>
          ) : null
        }
        tabs={
          <SectionTabList
            label="Correction views"
            tabs={[
              { value: 'tree', label: 'Tree' },
              { value: 'form', label: 'Form' },
              { value: 'kanban', label: 'Kanban' },
            ]}
          />
        }
      />
      <p className="m-0 max-w-[760px] text-small text-ink-muted">
        Evidence-backed add, replace, or void requests that never rewrite source or finalized
        history.
      </p>

      {success ? (
        <p
          className="m-0 rounded-control border border-success/40 bg-success/5 px-3 py-2.5 text-small text-success"
          role="status"
        >
          {success}
        </p>
      ) : null}
      <FormError message={error} />

      {creating ? (
        <Panel title="New Attendance Correction">
          <form className="grid gap-3 md:grid-cols-2" onSubmit={createCorrection}>
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
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save draft'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}

      <SectionTabPanel value="tree">
        <Panel
          title="Correction register"
          flush
          actions={
            <>
              <input
                aria-label="Search employee or reason"
                className={inputClass + ' max-w-xs'}
                placeholder="Search employee or reason"
                value={query}
                onChange={(event) => setQuery(valueOf(event))}
              />
              <select
                aria-label="Status"
                className={inputClass + ' max-w-xs'}
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(valueOf(event) as 'ALL' | AttendanceCorrectionStatus)
                }
              >
                <option value="ALL">All statuses</option>
                {FILTER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </select>
            </>
          }
        >
          {visible.length === 0 ? (
            <StateSurface compact label="Attendance Corrections">
              <p className="m-0">No Attendance Corrections match.</p>
            </StateSurface>
          ) : (
            <>
              <Table className="min-w-[720px]">
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Target</Th>
                    <Th>Action</Th>
                    <Th>Reason</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((correction) => (
                    <Tr key={correction.id} selected={correction.id === recordId}>
                      <RowHeader>
                        <button
                          type="button"
                          className="cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-ink underline-offset-2 hover:underline"
                          onClick={() => openRecord(correction.id)}
                        >
                          {correction.employee.legalName}
                        </button>
                        <p className="m-0 text-caption font-normal text-ink-muted">
                          {correction.employee.employeeNumber}
                        </p>
                      </RowHeader>
                      <Td className="first-letter:uppercase">
                        {TARGET_LABEL[correction.targetType]}
                      </Td>
                      <Td>{actionLabel(correction.requestedAction)}</Td>
                      <Td>{correction.reason}</Td>
                      <Td>
                        <StatusTag tone={STATUS_TONE[correction.status]}>
                          {statusLabel(correction.status)}
                        </StatusTag>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <TableFooter shown={visible.length} total={corrections.length} />
            </>
          )}
        </Panel>
      </SectionTabPanel>

      <SectionTabPanel value="kanban">
        <div
          role="group"
          aria-label="Attendance Correction status board"
          className="grid gap-4 md:grid-cols-4"
        >
          {BOARD_STATUSES.map((status) => {
            const cards = visible.filter((correction) => correction.status === status);
            return (
              <Panel key={status} title={`${statusLabel(status)} (${cards.length})`}>
                <div className="grid gap-2">
                  {cards.map((correction) => (
                    <button
                      key={correction.id}
                      type="button"
                      className="w-full cursor-pointer rounded-control border border-border bg-surface p-2 text-left text-small hover:bg-canvas"
                      onClick={() => openRecord(correction.id)}
                    >
                      <span className="font-[600] text-ink">{correction.employee.legalName}</span>
                      <span className="block text-caption text-ink-muted">
                        {actionLabel(correction.requestedAction)} · {correction.reason}
                      </span>
                    </button>
                  ))}
                  {cards.length === 0 ? (
                    <p className="m-0 text-caption text-ink-muted">Empty.</p>
                  ) : null}
                </div>
              </Panel>
            );
          })}
        </div>
      </SectionTabPanel>

      <SectionTabPanel value="form">
        <Panel title="Attendance Correction record">
          {detailLoading ? (
            <StateSurface busy compact>
              <p className="m-0" role="status">
                Loading…
              </p>
            </StateSurface>
          ) : null}
          {!detailLoading && !detail ? (
            <StateSurface compact>
              <p className="m-0">Select an Attendance Correction from the Tree view.</p>
            </StateSurface>
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
        </Panel>
      </SectionTabPanel>
    </SectionTabs>
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
  // A Leave or CTO handoff carries an approved source fact: its authorizer may only record a blocker.
  const showBlock =
    showAuthorize &&
    (correction.targetType === 'POSTED_LEAVE_INPUT' || correction.targetType === 'CTO_INPUT');
  const showCancel = canCancel && ['DRAFT', 'SUBMITTED'].includes(correction.status);
  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-panel-title text-ink">
            {actionLabel(correction.requestedAction)} {TARGET_LABEL[correction.targetType]}
          </h2>
          <p className="m-0 text-small text-ink-muted">
            {correction.employee.legalName} ({correction.employee.employeeNumber})
          </p>
        </div>
        <StatusTag tone={STATUS_TONE[correction.status]}>
          {statusLabel(correction.status)}
        </StatusTag>
      </header>

      <dl className="m-0 grid gap-3 text-small md:grid-cols-3">
        <div>
          <dt className="text-caption text-ink-muted">Reason</dt>
          <dd className="m-0 text-ink">{correction.reason}</dd>
        </div>
        <div>
          <dt className="text-caption text-ink-muted">Exact target</dt>
          <dd className="m-0 break-all text-ink">{correction.targetId ?? 'Proposed new fact'}</dd>
        </div>
        <div>
          <dt className="text-caption text-ink-muted">Approval Route Version</dt>
          <dd className="m-0 break-all text-ink">{correction.approvalRouteVersionId}</dd>
        </div>
      </dl>

      {correction.targetType === 'POSTED_LEAVE_INPUT' &&
      correction.status === 'FOR_AUTHORIZATION' ? (
        <p className="m-0 text-small text-ink-muted">
          Handed off by an applied Leave Cancellation. Attendance cannot change the Leave fact;
          authorize the adjustment or record why it cannot be authorized.
          {correction.blockingReason ? ` Blocked: ${correction.blockingReason}` : ''}
        </p>
      ) : null}

      {correction.targetType === 'CTO_INPUT' && correction.status === 'FOR_AUTHORIZATION' ? (
        <p className="m-0 text-small text-ink-muted">
          Handed off by an approved CTO cancellation. Attendance cannot change the CTO fact;
          authorize the adjustment or record why it cannot be authorized.
          {correction.blockingReason ? ` Blocked: ${correction.blockingReason}` : ''}
        </p>
      ) : null}

      <section className="grid gap-2">
        <h3 className={sectionTitleClass}>Impact Preview</h3>
        <p className="m-0 text-caption text-ink-muted">
          Fingerprint {impactPreview.fingerprint.slice(0, 12)} · {impactPreview.days.length}{' '}
          affected Work Date(s)
          {impactPreview.lockedPeriodVersionIds.length > 0 ? ' · locked period impact' : ''}
        </p>
        {impactPreview.days.length === 0 ? (
          <p className="m-0 text-small text-ink-muted">No calculable Work Date is affected.</p>
        ) : (
          <div className="rounded-panel border border-border">
            <Table>
              <thead>
                <tr>
                  <Th>Work Date</Th>
                  <Th>Attendance Period</Th>
                  <Th>Attendance Day</Th>
                </tr>
              </thead>
              <tbody>
                {impactPreview.days.map((day) => (
                  <Tr key={day.workDate}>
                    <RowHeader>{day.workDate}</RowHeader>
                    <Td>
                      {day.periodCode} ({day.periodStatus})
                    </Td>
                    <Td>
                      {day.attendanceDayId
                        ? `current version ${day.calculationVersion} (${day.status})`
                        : 'no current Attendance Day'}
                      {day.lockedPeriodVersionId ? ' · locked predecessor present' : ''}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </section>

      <section className="grid gap-2">
        <h3 className={sectionTitleClass}>Evidence</h3>
        {detail.evidence.length === 0 ? (
          <p className="m-0 text-small text-ink-muted">No evidence recorded yet.</p>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0 text-small">
            {detail.evidence.map((item) => (
              <li key={item.id} className="break-all text-ink">
                {evidenceLabel(item)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail.effect ? (
        <section className="grid gap-2">
          <h3 className={sectionTitleClass}>Applied Effect</h3>
          <p className="m-0 text-small text-ink">
            {actionLabel(detail.effect.effectAction)} effect {detail.effect.id} applied{' '}
            {new Date(detail.effect.appliedAt).toLocaleString()}.
          </p>
        </section>
      ) : null}

      {detail.lockedAdjustment ? (
        <section className="grid gap-2">
          <h3 className={sectionTitleClass}>Locked Attendance Adjustment</h3>
          <ul className="m-0 grid list-none gap-1 p-0 text-small">
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
            className={inputClass + ' py-2'}
            rows={2}
            value={comments}
            onChange={(event) => setComments(valueOf(event))}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          {showSubmit ? (
            <Button
              variant="primary"
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
              variant="primary"
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
              variant="primary"
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
          {showBlock ? (
            <Button
              variant="secondary"
              disabled={busy || comments.trim() === ''}
              onClick={() =>
                void runAction(
                  '/block-authorization',
                  { reason: comments },
                  'Blocking reason recorded. The adjustment stays pending.',
                )
              }
            >
              Record blocking reason
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
        <p className="m-0 text-caption text-ink-muted">
          Approval Request {detail.approval.approvalRequestId} · {detail.approval.status} · step{' '}
          {detail.approval.currentStepNo ?? '—'}
        </p>
      ) : null}
    </div>
  );
}
