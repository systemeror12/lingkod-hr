'use client';

import { useEffect, useRef, useState } from 'react';
import { dateLabel, hoursLabel } from '../lib/overtime-format';
import { useRecordNavigation } from './record-navigation';
import { StateSurface } from './state-surface';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';
import { PageHeader } from './ui/page-header';
import { Panel } from './ui/panel';
import { SectionTabList, SectionTabPanel, SectionTabs } from './ui/section-tabs';
import { StatusTag, type StatusDisplay } from './ui/status-tag';
import { RowHeader, Table, TableFooter, Td, Th, Tr } from './ui/table';

export const CTO_REQUEST_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'FOR_APPROVAL',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;
export type CtoRequestStatus = (typeof CTO_REQUEST_STATUSES)[number];

export interface CtoRequestDate {
  id: string;
  workDate: string;
  unit: 'WHOLE' | 'HALF';
  /** ISO instants, set only for a half day. */
  startsAt: string | null;
  endsAt: string | null;
  chargedMinutes: number;
  attendanceCtoInputId: string | null;
  cancelledByCtoCancellationId: string | null;
}

export interface CtoRequest {
  id: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  status: CtoRequestStatus;
  approvedAt: string | null;
  createdAt: string;
  totalChargedMinutes: number;
  pendingAction: {
    role: 'REQUESTER' | 'SUPERVISOR' | 'APPROVING_OFFICIAL';
    assigneeName: string | null;
  } | null;
  dates: CtoRequestDate[];
}

interface CtoRequestDetail extends CtoRequest {
  decisions: Array<{
    id: string;
    stepNo: number;
    decision: string;
    comments: string | null;
    decidedByName: string | null;
    decidedAt: string;
  }>;
  history: Array<{
    id: string;
    action: string;
    reason: string | null;
    actorName: string | null;
    occurredAt: string;
  }>;
}

export interface CtoRequestListResponse {
  requests: CtoRequest[];
}

/** The API's balance read: what CTO can still draw from today, net of future-dated uses. */
interface CocAvailability {
  cocAccountId: string | null;
  available: { byValidUntil: Array<{ validUntil: string; minutes: string }>; totalMinutes: string };
}

interface EmployeeOption {
  id: string;
  employeeNumber: string;
  legalName: string;
}

type View = 'tree' | 'form' | 'kanban';
type FormTab = 'request' | 'decisions' | 'attendance' | 'history';

const STATUS_DISPLAY: Record<CtoRequestStatus, StatusDisplay> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SUBMITTED: { label: 'Submitted', tone: 'info' },
  FOR_APPROVAL: { label: 'For approval', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

const PENDING_ROLE: Record<NonNullable<CtoRequest['pendingAction']>['role'], string> = {
  REQUESTER: 'Requester',
  SUPERVISOR: 'Supervisor',
  APPROVING_OFFICIAL: 'Approving Official',
};

const STEP_ROLE: Record<number, string> = { 1: 'Supervisor', 2: 'Approving Official' };

const ACTION_LABEL: Record<string, string> = {
  CTO_REQUEST_CREATED: 'Draft saved',
  CTO_REQUEST_DISCARDED: 'Discarded',
  CTO_REQUEST_SUBMITTED: 'Submitted',
  CTO_REQUEST_WITHDRAWN: 'Withdrawn',
  CTO_REQUEST_RECOMMENDED: 'Recommended',
  CTO_REQUEST_RETURNED: 'Returned',
  CTO_REQUEST_APPROVED: 'Approved and posted',
  CTO_REQUEST_REJECTED: 'Rejected',
  CTO_REQUEST_CANCELLED: 'Cancelled',
};

/** Refusals that mean the request moved on since it was read: reload instead of retrying. */
const STALE_CODES = new Set([
  'CTO_REQUEST_STATUS_INVALID',
  'CTO_REQUEST_APPROVAL_REQUEST_MISSING',
  'CTO_REQUEST_NOT_FOUND',
]);

const MAX_WORK_DATES = 5;
const sectionTitleClass = 'm-0 text-panel-title text-ink';
const successClass =
  'm-0 rounded-control border border-success/40 bg-success/5 px-3 py-2.5 text-small text-success';

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
  }
}

function refusalMessage(value: unknown, fallback: string): string {
  const error = (value as { error?: { message?: unknown; fields?: Record<string, string> } } | null)
    ?.error;
  const message = typeof error?.message === 'string' ? error.message : fallback;
  const fields = Object.entries(error?.fields ?? {}).map(([field, text]) => `${field}: ${text}`);
  return fields.length > 0 ? `${message} ${fields.join(' ')}` : message;
}

function valueOf(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function timeLabel(value: string): string {
  return new Date(value).toLocaleTimeString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
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

function minutesLabel(value: string | number): string {
  const text = hoursLabel(value);
  return `${text} minute${text === '1' ? '' : 's'}`;
}

/** A Work Date's unit, and for a half day the interval it states. */
function unitLabel(date: CtoRequestDate): string {
  if (date.unit === 'WHOLE' || !date.startsAt || !date.endsAt) return 'Whole day';
  return `Half day, ${timeLabel(date.startsAt)} – ${timeLabel(date.endsAt)}`;
}

function datesLabel(request: CtoRequest): string {
  const first = request.dates[0];
  const last = request.dates.at(-1);
  if (!first || !last) return '—';
  return first.workDate === last.workDate
    ? dateLabel(first.workDate)
    : `${dateLabel(first.workDate)} – ${dateLabel(last.workDate)}`;
}

function pendingLabel(request: CtoRequest): string | null {
  const pending = request.pendingAction;
  if (!pending) return null;
  const role = PENDING_ROLE[pending.role];
  return pending.assigneeName ? `${role} · ${pending.assigneeName}` : role;
}

function decisionLabel(decision: CtoRequestDetail['decisions'][number]): string {
  if (decision.decision === 'RETURN') return 'Returned';
  if (decision.decision === 'REJECT') return 'Rejected';
  return decision.stepNo === 1 ? 'Recommended' : 'Approved';
}

function StatusCell({ request }: { request: CtoRequest }) {
  const pending = pendingLabel(request);
  return (
    <>
      <StatusTag tone={STATUS_DISPLAY[request.status].tone}>
        {STATUS_DISPLAY[request.status].label}
      </StatusTag>
      {pending ? (
        <span className="block text-caption text-ink-muted">Awaiting {pending}</span>
      ) : null}
    </>
  );
}

/** A command's result, kept with the record it belongs to; null for a new request. */
interface Notice {
  recordId: string | null;
  kind: 'success' | 'error' | 'stale';
  message: string;
}

export function CtoRequestWorkspace({
  agencyId,
  initial,
  canCreate,
  canRecordForOthers,
  canSubmit,
  canWithdraw,
  canRecommend,
  canReturn,
  canApprove,
  canReject,
}: {
  agencyId: string;
  initial: CtoRequestListResponse;
  canCreate: boolean;
  /** An Agency-wide `overtime.cto.create` with the Employee picker; otherwise the request is the caller's own. */
  canRecordForOthers: boolean;
  canSubmit: boolean;
  canWithdraw: boolean;
  canRecommend: boolean;
  canReturn: boolean;
  canApprove: boolean;
  canReject: boolean;
}) {
  const [requests, setRequests] = useState(initial.requests);
  const [statusFilter, setStatusFilter] = useState<'ALL' | CtoRequestStatus>('ALL');
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState<{
    id: string;
    detail: CtoRequestDetail | null;
    error: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [formTab, setFormTab] = useState<FormTab>('request');
  const navigation = useRecordNavigation();
  const requestedView = navigation.search.get('view');
  const preparing = canCreate && navigation.search.get('new') === '1';
  const view: View =
    requestedView === 'form' || preparing ? 'form' : requestedView === 'kanban' ? 'kanban' : 'tree';
  const recordId = preparing ? null : navigation.search.get('record');

  // What the Form shows follows from the URL's record and the last load, so no load can outlive it.
  const current = loaded?.id === recordId ? loaded : null;
  const detail = current?.detail ?? null;
  const detailError = current?.error ?? '';
  const detailLoading = recordId !== null && current === null;
  const shown = notice?.recordId === null || notice?.recordId === recordId ? notice : null;
  const error = shown?.kind === 'error' ? shown.message : '';
  const stale = shown?.kind === 'stale' ? shown.message : '';
  const success = shown?.kind === 'success' ? shown.message : '';

  useEffect(() => {
    setLoaded(null);
    setNotice((held) => (held?.recordId === recordId ? held : null));
    if (recordId === null) return;
    let active = true;
    void request('/cto-requests/' + encodeURIComponent(recordId))
      .then((value) => {
        if (active) setLoaded({ id: recordId, detail: value as CtoRequestDetail, error: '' });
      })
      .catch((failure: unknown) => {
        if (active)
          setLoaded({
            id: recordId,
            detail: null,
            error: failure instanceof Error ? failure.message : 'The CTO Request failed to load.',
          });
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
      const code = (value as { error?: { code?: unknown } } | null)?.error?.code;
      throw new ApiError(
        refusalMessage(value, 'The CTO Request action failed.'),
        response.status,
        typeof code === 'string' ? code : null,
      );
    }
    return value;
  }

  async function reload(id: string | null): Promise<void> {
    const list = (await request('/cto-requests')) as CtoRequestListResponse;
    setRequests(list.requests);
    if (id) {
      const refreshed = (await request(
        '/cto-requests/' + encodeURIComponent(id),
      )) as CtoRequestDetail;
      // The user may have moved to another record while this was in flight.
      setLoaded((held) => (held?.id === id ? { id, detail: refreshed, error: '' } : held));
    }
  }

  function openRecord(id: string): void {
    navigation.navigate({ view: 'form', record: id, new: null });
  }

  /** Run one command once: a second click while it is in flight does nothing. */
  async function act(path: string, body: unknown, message: string): Promise<void> {
    if (!detail || busyRef.current) return;
    const id = detail.id;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await request('/cto-requests/' + id + path, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      await reload(id);
      setNotice({ recordId: id, kind: 'success', message });
    } catch (failure: unknown) {
      const stale = failure instanceof ApiError && failure.code && STALE_CODES.has(failure.code);
      setNotice({
        recordId: id,
        kind: stale ? 'stale' : 'error',
        message: failure instanceof Error ? failure.message : 'The CTO Request action failed.',
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function saveDraft(body: { employeeId: string; dates: unknown[] }): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const saved = (await request('/cto-requests', {
        method: 'POST',
        body: JSON.stringify(body),
      })) as { id: string };
      await reload(null);
      setNotice({
        recordId: saved.id,
        kind: 'success',
        message: 'The CTO Request was saved as a draft. Submit it to send it to the Supervisor.',
      });
      openRecord(saved.id);
    } catch (failure: unknown) {
      setNotice({
        recordId: null,
        kind: 'error',
        message:
          'The CTO Request was not saved. ' +
          (failure instanceof Error ? failure.message : 'The save failed.'),
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function reloadStale(): Promise<void> {
    setNotice(null);
    try {
      await reload(recordId);
    } catch (failure: unknown) {
      const message = failure instanceof Error ? failure.message : 'The reload failed.';
      setLoaded((held) =>
        held?.id === recordId && recordId ? { id: recordId, detail: null, error: message } : held,
      );
    }
  }

  const needle = query.trim().toLowerCase();
  const visible = requests.filter((row) => {
    if (statusFilter !== 'ALL' && row.status !== statusFilter) return false;
    if (needle === '') return true;
    return (
      row.employeeName.toLowerCase().includes(needle) ||
      row.employeeNumber.toLowerCase().includes(needle)
    );
  });
  const position = recordId ? visible.findIndex((row) => row.id === recordId) : -1;
  const previous = position > 0 ? visible[position - 1] : undefined;
  const next = position >= 0 ? visible[position + 1] : undefined;

  return (
    <SectionTabs
      className="grid min-w-0 gap-5"
      value={view}
      onValueChange={(nextView) => navigation.navigate({ view: nextView, new: null })}
    >
      <PageHeader
        breadcrumbs={[{ label: 'Overtime' }]}
        title="CTO Requests"
        actions={
          canCreate ? (
            <Button
              variant="primary"
              onClick={() => {
                setNotice(null);
                navigation.navigate({ view: 'form', new: '1', record: null });
              }}
            >
              New CTO request
            </Button>
          ) : null
        }
        tabs={
          <SectionTabList
            label="CTO Request views"
            tabs={[
              { value: 'tree', label: 'Tree' },
              { value: 'form', label: 'Form' },
              { value: 'kanban', label: 'Kanban' },
            ]}
          />
        }
      />
      <p className="m-0 max-w-[760px] text-small text-ink-muted">
        Compensatory Time-Off drawn from COC, recommended by the Supervisor and approved by the
        Approving Official. Approval posts the usage and the Attendance CTO inputs at once.
      </p>

      {success ? (
        <p className={successClass} role="status">
          {success}
        </p>
      ) : null}
      <FormError message={error} />

      <SectionTabPanel value="tree">
        <Panel
          title="CTO Request register"
          flush
          actions={
            <>
              <input
                aria-label="Search Employee"
                className={inputClass + ' max-w-xs'}
                placeholder="Search Employee"
                value={query}
                onChange={(event) => setQuery(valueOf(event))}
              />
              <select
                aria-label="Status"
                className={inputClass + ' max-w-xs'}
                value={statusFilter}
                onChange={(event) => setStatusFilter(valueOf(event) as 'ALL' | CtoRequestStatus)}
              >
                <option value="ALL">All statuses</option>
                {CTO_REQUEST_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_DISPLAY[status].label}
                  </option>
                ))}
              </select>
            </>
          }
        >
          {visible.length === 0 ? (
            <StateSurface compact label="CTO Requests">
              <p className="m-0">
                {requests.length === 0 ? 'No CTO Requests yet.' : 'No CTO Requests match.'}
              </p>
            </StateSurface>
          ) : (
            <>
              <Table className="min-w-[760px]">
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Work Dates</Th>
                    <Th>Status</Th>
                    <Th kind="numeric">Charged minutes</Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <Tr key={row.id} selected={row.id === recordId}>
                      <RowHeader>
                        <button
                          type="button"
                          className="cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-ink underline-offset-2 hover:underline"
                          onClick={() => openRecord(row.id)}
                        >
                          {row.employeeName}
                        </button>
                        <p className="m-0 text-caption font-normal text-ink-muted">
                          {row.employeeNumber}
                        </p>
                      </RowHeader>
                      <Td>
                        {datesLabel(row)}
                        <span className="block text-caption text-ink-muted">
                          {row.dates.length} Work Date{row.dates.length === 1 ? '' : 's'}
                        </span>
                      </Td>
                      <Td>
                        <StatusCell request={row} />
                      </Td>
                      <Td kind="numeric">{row.totalChargedMinutes}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <TableFooter shown={visible.length} total={requests.length} />
            </>
          )}
        </Panel>
      </SectionTabPanel>

      <SectionTabPanel value="kanban">
        <div
          role="group"
          aria-label="CTO Request status board"
          className="grid gap-4 md:grid-cols-3 xl:grid-cols-6"
        >
          {CTO_REQUEST_STATUSES.map((status) => {
            const cards = visible.filter((row) => row.status === status);
            return (
              <Panel key={status} title={`${STATUS_DISPLAY[status].label} (${cards.length})`}>
                <div className="grid gap-2">
                  {cards.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className="w-full cursor-pointer rounded-control border border-border bg-surface p-2 text-left text-small hover:bg-canvas"
                      onClick={() => openRecord(row.id)}
                    >
                      <span className="font-[600] text-ink">{row.employeeName}</span>
                      <span className="block text-caption text-ink-muted">
                        {datesLabel(row)} · {minutesLabel(row.totalChargedMinutes)}
                      </span>
                      {pendingLabel(row) ? (
                        <span className="block text-caption text-ink-muted">
                          Awaiting {pendingLabel(row)}
                        </span>
                      ) : null}
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
        {preparing ? (
          <DraftForm
            busy={busy}
            canRecordForOthers={canRecordForOthers}
            request={request}
            onSave={saveDraft}
            onDiscard={() => navigation.navigate({ view: 'tree', new: null })}
          />
        ) : (
          <Panel
            title="CTO Request record"
            actions={
              recordId ? (
                <>
                  <Button
                    variant="secondary"
                    disabled={!previous}
                    onClick={() => previous && openRecord(previous.id)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!next}
                    onClick={() => next && openRecord(next.id)}
                  >
                    Next
                  </Button>
                </>
              ) : null
            }
          >
            {detailLoading ? (
              <StateSurface busy compact label="Loading CTO Request">
                <p className="m-0" role="status">
                  Loading the CTO Request…
                </p>
              </StateSurface>
            ) : null}
            {!detailLoading && detailError ? (
              <StateSurface compact label="CTO Request unavailable">
                <p className="m-0" role="alert">
                  {detailError}
                </p>
              </StateSurface>
            ) : null}
            {!detailLoading && !detailError && !detail ? (
              <StateSurface compact>
                <p className="m-0">Select a CTO Request from the Tree or Kanban view.</p>
              </StateSurface>
            ) : null}
            {stale ? (
              <div
                role="alert"
                className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-control border border-warning/50 bg-warning/5 px-3 py-2.5 text-small text-ink"
              >
                <span>This CTO Request changed since you opened it. {stale}</span>
                <Button variant="secondary" onClick={() => void reloadStale()}>
                  Reload
                </Button>
              </div>
            ) : null}
            {detail ? (
              <SectionTabs
                value={formTab}
                onValueChange={(value) => setFormTab(value as FormTab)}
                className="grid gap-4"
              >
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="m-0 text-panel-title text-ink">CTO of {detail.employeeName}</h2>
                    <p className="m-0 text-small text-ink-muted">
                      {detail.employeeNumber} · {datesLabel(detail)} ·{' '}
                      {minutesLabel(detail.totalChargedMinutes)}
                    </p>
                  </div>
                  <div className="text-right">
                    <StatusCell request={detail} />
                  </div>
                </header>
                <SectionTabList
                  label="CTO Request sections"
                  tabs={[
                    { value: 'request', label: 'Request' },
                    { value: 'decisions', label: 'Decisions' },
                    { value: 'attendance', label: 'Attendance' },
                    { value: 'history', label: 'History' },
                  ]}
                />
                <SectionTabPanel value="request">
                  <RequestSection
                    key={detail.id + detail.status}
                    detail={detail}
                    busy={busy || stale !== ''}
                    request={request}
                    can={{
                      create: canCreate,
                      submit: canSubmit,
                      withdraw: canWithdraw,
                      recommend: canRecommend,
                      return: canReturn,
                      approve: canApprove,
                      reject: canReject,
                    }}
                    act={act}
                  />
                </SectionTabPanel>
                <SectionTabPanel value="decisions">
                  <DecisionsSection detail={detail} />
                </SectionTabPanel>
                <SectionTabPanel value="attendance">
                  <AttendanceSection detail={detail} />
                </SectionTabPanel>
                <SectionTabPanel value="history">
                  <HistorySection detail={detail} />
                </SectionTabPanel>
              </SectionTabs>
            ) : null}
          </Panel>
        )}
      </SectionTabPanel>
    </SectionTabs>
  );
}

/** Load the API's available COC for one Employee, or the caller's own when `employeeId` is null. */
function useAvailability(
  request: (path: string) => Promise<unknown>,
  employeeId: string | null,
  own: boolean,
  refresh: string,
) {
  const [state, setState] = useState<{
    key: string;
    value: (CocAvailability & { employeeId?: string }) | null;
    error: string;
  } | null>(null);
  const key = `${own ? 'own' : (employeeId ?? '')}:${refresh}`;
  useEffect(() => {
    if (!own && !employeeId) return;
    let active = true;
    const path = own
      ? '/coc-balance'
      : '/employees/' + encodeURIComponent(employeeId!) + '/coc-balance';
    void request(path)
      .then((value) => {
        if (active) setState({ key, value: value as CocAvailability, error: '' });
      })
      .catch((failure: unknown) => {
        if (active)
          setState({
            key,
            value: null,
            error: failure instanceof Error ? failure.message : 'Available COC failed to load.',
          });
      });
    return () => {
      active = false;
    };
  }, [key]);
  return state?.key === key ? state : null;
}

function AvailableCoc({
  state,
  label,
}: {
  state: ReturnType<typeof useAvailability>;
  label: string;
}) {
  return (
    <section className="grid gap-2" aria-label={label}>
      <h3 className={sectionTitleClass}>Available COC</h3>
      {state === null ? (
        <p className="m-0 text-small text-ink-muted" role="status">
          Loading available COC…
        </p>
      ) : state.error ? (
        <p className="m-0 text-small text-danger" role="alert">
          {state.error}
        </p>
      ) : state.value ? (
        <>
          <dl className="m-0 grid gap-1 text-small">
            <dt className="text-caption text-ink-muted">Available from today</dt>
            <dd className="m-0 font-[600] text-ink">
              {minutesLabel(state.value.available.totalMinutes)}
            </dd>
          </dl>
          {state.value.cocAccountId === null ? (
            <p className="m-0 text-small text-ink-muted">No COC Account yet.</p>
          ) : (
            <ul className="m-0 grid list-none gap-1 p-0 text-small">
              {state.value.available.byValidUntil.map((group) => (
                <li key={group.validUntil}>
                  {minutesLabel(group.minutes)} valid until {dateLabel(group.validUntil)}
                </li>
              ))}
            </ul>
          )}
          <p className="m-0 text-caption text-ink-muted">
            Net of approved CTO on later dates. COC must be valid on each Work Date.
          </p>
        </>
      ) : null}
    </section>
  );
}

interface DateRow {
  workDate: string;
  unit: 'WHOLE' | 'HALF';
  startsAt: string;
  endsAt: string;
}

function DraftForm({
  busy,
  canRecordForOthers,
  request,
  onSave,
  onDiscard,
}: {
  busy: boolean;
  canRecordForOthers: boolean;
  request: (path: string) => Promise<unknown>;
  onSave: (body: { employeeId: string; dates: unknown[] }) => Promise<void>;
  onDiscard: () => void;
}) {
  const [employees, setEmployees] = useState<EmployeeOption[] | null>(null);
  const [optionsError, setOptionsError] = useState('');
  const [pickedId, setPickedId] = useState('');
  const [rows, setRows] = useState<DateRow[]>([
    { workDate: '', unit: 'WHOLE', startsAt: '08:00', endsAt: '12:00' },
  ]);
  const availability = useAvailability(
    request,
    canRecordForOthers ? pickedId || null : null,
    !canRecordForOthers,
    'new',
  );
  const employeeId = canRecordForOthers ? pickedId : (availability?.value?.employeeId ?? '');

  useEffect(() => {
    if (!canRecordForOthers) return;
    void request('/employees')
      .then((value) => setEmployees((value as { employees: EmployeeOption[] }).employees))
      .catch((failure: unknown) =>
        setOptionsError(failure instanceof Error ? failure.message : 'Employees failed to load.'),
      );
  }, [canRecordForOthers]);

  function update(index: number, patch: Partial<DateRow>): void {
    setRows((held) => held.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  }

  const complete = employeeId !== '' && rows.every((row) => row.workDate !== '');
  return (
    <Panel title="Request CTO">
      <form
        className="grid gap-4"
        aria-label="Request CTO"
        onSubmit={(event) => {
          event.preventDefault();
          if (!complete) return;
          void onSave({
            employeeId,
            dates: rows.map((row) =>
              row.unit === 'WHOLE'
                ? { workDate: row.workDate, unit: 'WHOLE' }
                : {
                    workDate: row.workDate,
                    unit: 'HALF',
                    startsAt: `${row.workDate}T${row.startsAt}:00+08:00`,
                    endsAt: `${row.workDate}T${row.endsAt}:00+08:00`,
                  },
            ),
          });
        }}
      >
        <FormError message={optionsError} />
        {canRecordForOthers ? (
          <Field label="Employee">
            <select
              className={inputClass + ' max-w-md'}
              value={pickedId}
              disabled={employees === null}
              onChange={(event) => setPickedId(valueOf(event))}
            >
              <option value="">{employees === null ? 'Loading Employees…' : 'Choose'}</option>
              {(employees ?? []).map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.legalName} ({employee.employeeNumber})
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {canRecordForOthers && !pickedId ? null : (
          <AvailableCoc state={availability} label="Available COC for this request" />
        )}
        <fieldset className="m-0 grid gap-3 border-0 p-0">
          <legend className={sectionTitleClass}>Work Dates</legend>
          <p className="m-0 text-caption text-ink-muted">
            Up to {MAX_WORK_DATES} consecutive Work Dates. A half day states the half of expected
            duty it takes; the Employee’s Work Schedule sets what each date charges.
          </p>
          {rows.map((row, index) => (
            <div
              key={index}
              role="group"
              aria-label={`Work Date ${index + 1}`}
              className="grid gap-3 md:grid-cols-[repeat(4,minmax(0,1fr))_auto]"
            >
              <Field label="Work Date">
                <input
                  type="date"
                  className={inputClass}
                  value={row.workDate}
                  required
                  onChange={(event) => update(index, { workDate: valueOf(event) })}
                />
              </Field>
              <Field label="Unit">
                <select
                  className={inputClass}
                  value={row.unit}
                  onChange={(event) => update(index, { unit: valueOf(event) as DateRow['unit'] })}
                >
                  <option value="WHOLE">Whole day</option>
                  <option value="HALF">Half day</option>
                </select>
              </Field>
              {row.unit === 'HALF' ? (
                <>
                  <Field label="Starts">
                    <input
                      type="time"
                      className={inputClass}
                      value={row.startsAt}
                      required
                      onChange={(event) => update(index, { startsAt: valueOf(event) })}
                    />
                  </Field>
                  <Field label="Ends">
                    <input
                      type="time"
                      className={inputClass}
                      value={row.endsAt}
                      required
                      onChange={(event) => update(index, { endsAt: valueOf(event) })}
                    />
                  </Field>
                </>
              ) : (
                <div className="md:col-span-2" />
              )}
              <div className="self-end">
                <Button
                  variant="secondary"
                  disabled={rows.length === 1}
                  aria-label={`Remove Work Date ${index + 1}`}
                  onClick={() => setRows((held) => held.filter((_, at) => at !== index))}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <div>
            <Button
              variant="secondary"
              disabled={rows.length >= MAX_WORK_DATES}
              onClick={() =>
                setRows((held) => [
                  ...held,
                  { workDate: '', unit: 'WHOLE', startsAt: '08:00', endsAt: '12:00' },
                ])
              }
            >
              Add Work Date
            </Button>
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={busy || !complete}>
            Save draft
          </Button>
          <Button variant="secondary" onClick={onDiscard}>
            Cancel
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function RequestSection({
  detail,
  busy,
  request,
  can,
  act,
}: {
  detail: CtoRequestDetail;
  busy: boolean;
  request: (path: string) => Promise<unknown>;
  can: Record<
    'create' | 'submit' | 'withdraw' | 'recommend' | 'return' | 'approve' | 'reject',
    boolean
  >;
  act: (path: string, body: unknown, message: string) => Promise<void>;
}) {
  const [comment, setComment] = useState('');
  const availability = useAvailability(
    request,
    detail.employeeId,
    false,
    detail.status + (detail.approvedAt ?? ''),
  );
  const trimmed = comment.trim();
  const optional = trimmed ? { comment: trimmed } : {};
  const open = detail.status === 'SUBMITTED' || detail.status === 'FOR_APPROVAL';
  const deciding =
    (detail.status === 'SUBMITTED' && (can.recommend || can.return)) ||
    (detail.status === 'FOR_APPROVAL' && (can.approve || can.reject || can.return));
  return (
    <div className="grid gap-5">
      <Table>
        <caption className="sr-only">Work Dates</caption>
        <thead>
          <tr>
            <Th>Work Date</Th>
            <Th>Unit</Th>
            <Th kind="numeric">Charged minutes</Th>
          </tr>
        </thead>
        <tbody>
          {detail.dates.map((date) => (
            <Tr key={date.id}>
              <RowHeader>{dateLabel(date.workDate)}</RowHeader>
              <Td>{unitLabel(date)}</Td>
              <Td kind="numeric">{date.chargedMinutes}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>

      <AvailableCoc state={availability} label={`Available COC of ${detail.employeeName}`} />

      {detail.status === 'APPROVED' ? (
        <p className="m-0 text-small text-ink">
          Approved{detail.approvedAt ? ` ${instantLabel(detail.approvedAt)}` : ''}. The COC usage
          and the Attendance CTO inputs were posted with the approval.
        </p>
      ) : null}

      {detail.status === 'DRAFT' && (can.submit || can.create) ? (
        <div className="flex flex-wrap gap-2">
          {can.submit ? (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void act(
                  '/submit',
                  undefined,
                  'The CTO Request was submitted for the Supervisor’s recommendation.',
                )
              }
            >
              Submit request
            </Button>
          ) : null}
          {can.create ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void act('/discard', undefined, 'The draft was discarded.')}
            >
              Discard draft
            </Button>
          ) : null}
        </div>
      ) : null}

      {open && can.withdraw ? (
        <div>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void act('/withdraw', undefined, 'The CTO Request was withdrawn.')}
          >
            Withdraw request
          </Button>
        </div>
      ) : null}

      {deciding ? (
        <section className="grid gap-3" aria-label="Decide this request">
          <h3 className={sectionTitleClass}>Decide this request</h3>
          <Field label="Comment or reason">
            <textarea
              className={inputClass + ' max-w-xl py-2'}
              rows={2}
              value={comment}
              onChange={(event) => setComment(valueOf(event))}
            />
          </Field>
          <p className="m-0 text-caption text-ink-muted">
            Optional to recommend or approve; required to return or reject.
          </p>
          <div className="flex flex-wrap gap-2">
            {detail.status === 'SUBMITTED' && can.recommend ? (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  void act(
                    '/recommend',
                    optional,
                    'The CTO Request was recommended to the Approving Official.',
                  )
                }
              >
                Recommend
              </Button>
            ) : null}
            {detail.status === 'FOR_APPROVAL' && can.approve ? (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  void act(
                    '/approve',
                    optional,
                    'The CTO Request was approved. Its COC usage and Attendance CTO inputs are posted.',
                  )
                }
              >
                Approve
              </Button>
            ) : null}
            {detail.status === 'FOR_APPROVAL' && can.reject ? (
              <Button
                variant="secondary"
                disabled={busy || trimmed === ''}
                onClick={() =>
                  void act('/reject', { reason: trimmed }, 'The CTO Request was rejected.')
                }
              >
                Reject
              </Button>
            ) : null}
            {can.return ? (
              <Button
                variant="secondary"
                disabled={busy || trimmed === ''}
                onClick={() =>
                  void act(
                    '/return',
                    { comment: trimmed },
                    'The CTO Request was returned to the requester as a draft.',
                  )
                }
              >
                Return
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function DecisionsSection({ detail }: { detail: CtoRequestDetail }) {
  if (detail.decisions.length === 0) {
    return <p className="m-0 text-small text-ink-muted">No decisions yet.</p>;
  }
  return (
    <ol className="m-0 grid list-none gap-2 p-0 text-small" aria-label="Decisions">
      {detail.decisions.map((decision) => (
        <li key={decision.id} className="rounded-control border border-border px-3 py-2">
          <span className="font-[600] text-ink">{decisionLabel(decision)}</span>
          <span className="text-ink-muted">
            {' '}
            · {STEP_ROLE[decision.stepNo] ?? `Step ${decision.stepNo}`} ·{' '}
            {decision.decidedByName ?? 'Unknown'} · {instantLabel(decision.decidedAt)}
          </span>
          {decision.comments ? (
            <p className="m-0 whitespace-pre-line text-ink">{decision.comments}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function AttendanceSection({ detail }: { detail: CtoRequestDetail }) {
  return (
    <div className="grid gap-3">
      <Table>
        <caption className="sr-only">Attendance effect</caption>
        <thead>
          <tr>
            <Th>Work Date</Th>
            <Th>Unit</Th>
            <Th>Attendance</Th>
          </tr>
        </thead>
        <tbody>
          {detail.dates.map((date) => (
            <Tr key={date.id}>
              <RowHeader>{dateLabel(date.workDate)}</RowHeader>
              <Td>{unitLabel(date)}</Td>
              <Td>
                {date.cancelledByCtoCancellationId
                  ? 'Cancelled'
                  : date.attendanceCtoInputId
                    ? 'CTO input recorded in Attendance'
                    : 'Recorded in Attendance when approved'}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <p className="m-0 text-small text-ink-muted">
        Attendance counts CTO as covered, paid time.{' '}
        <a className="text-primary underline-offset-2 hover:underline" href="/attendance-dtrs">
          Open Daily Time Records
        </a>
      </p>
    </div>
  );
}

function HistorySection({ detail }: { detail: CtoRequestDetail }) {
  return (
    <ol className="m-0 grid list-none gap-2 p-0 text-small" aria-label="Request history">
      {detail.history.map((entry) => (
        <li key={entry.id} className="rounded-control border border-border px-3 py-2">
          <span className="font-[600] text-ink">{ACTION_LABEL[entry.action] ?? entry.action}</span>
          <span className="text-ink-muted">
            {' '}
            · {entry.actorName ?? 'System'} · {instantLabel(entry.occurredAt)}
          </span>
          {entry.reason ? (
            <p className="m-0 whitespace-pre-line text-ink">Reason: {entry.reason}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
