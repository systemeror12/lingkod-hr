'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRecordNavigation } from './record-navigation';
import { StateSurface } from './state-surface';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';
import { PageHeader } from './ui/page-header';
import { Panel } from './ui/panel';
import { SectionTabList, SectionTabPanel, SectionTabs } from './ui/section-tabs';
import { StatusTag, type StatusDisplay } from './ui/status-tag';
import { RowHeader, Table, TableFooter, Td, Th, Tr } from './ui/table';

export const OVERTIME_AUTHORITY_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'FOR_REVIEW',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;
export type OvertimeAuthorityStatus = (typeof OVERTIME_AUTHORITY_STATUSES)[number];
export type CompensationMethod = 'COC' | 'OVERTIME_PAY';
export type PositionLevel = 'DIVISION_CHIEF_OR_BELOW' | 'OIC_OF_HIGHER_POSITION';

export interface EligibilitySnapshot {
  capturedAt: string;
  service: Array<{
    serviceSegmentId: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    appointmentStatus: string;
    salaryGrade: number | null;
    positionItemNumber: string | null;
    positionTitle: string | null;
    personnelCategory: string | null;
  }>;
  workArrangements: Array<{
    workArrangementVersionId: string;
    arrangementType: string;
    versionNo: number;
  }>;
  attestation: { positionLevel: PositionLevel; reviewedAt: string };
}

export interface CoveredEmployee {
  id: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  authorizedHours: string;
  taskDescription: string | null;
  eligibilitySnapshot: EligibilitySnapshot | null;
}

export interface OvertimeAuthority {
  id: string;
  authorityNo: string;
  requestingUnitId: string;
  requestingUnitName: string;
  purpose: string;
  workDateFrom: string;
  workDateTo: string;
  compensationMethod: CompensationMethod;
  fundingReference: string | null;
  status: OvertimeAuthorityStatus;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  pendingAction: {
    role: 'PREPARER' | 'REVIEWER' | 'APPROVING_OFFICIAL';
    assigneeName: string | null;
  } | null;
  employees: CoveredEmployee[];
}

export interface OvertimeAuthorityDetail extends OvertimeAuthority {
  review: {
    reviewedByName: string | null;
    reviewedAt: string;
    attestations: Array<{ employeeId: string; positionLevel: PositionLevel }>;
  } | null;
  decision: {
    decision: string;
    comments: string | null;
    decidedByName: string | null;
    decidedAt: string;
  } | null;
  history: Array<{
    id: string;
    action: string;
    previousStatus: string | null;
    newStatus: string | null;
    reason: string | null;
    actorName: string | null;
    occurredAt: string;
  }>;
}

export interface OvertimeAuthorityListResponse {
  authorities: OvertimeAuthority[];
}

interface EmployeeOption {
  id: string;
  employeeNumber: string;
  legalName: string;
}

interface UnitOption {
  id: string;
  code: string;
  officialName: string;
}

type View = 'tree' | 'form' | 'kanban';

const STATUS_DISPLAY: Record<OvertimeAuthorityStatus, StatusDisplay> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SUBMITTED: { label: 'Submitted', tone: 'info' },
  FOR_REVIEW: { label: 'For review', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

const PENDING_ROLE: Record<NonNullable<OvertimeAuthority['pendingAction']>['role'], string> = {
  PREPARER: 'Preparer',
  REVIEWER: 'Reviewer',
  APPROVING_OFFICIAL: 'Approving Official',
};

const METHOD_LABEL: Record<CompensationMethod, string> = {
  COC: 'COC',
  OVERTIME_PAY: 'Overtime pay',
};

const POSITION_LEVEL_LABEL: Record<PositionLevel, string> = {
  DIVISION_CHIEF_OR_BELOW: 'Division chief or below',
  OIC_OF_HIGHER_POSITION: 'Officer-in-Charge of a higher position',
};

const ACTION_LABEL: Record<string, string> = {
  OVERTIME_AUTHORITY_CREATED: 'Prepared',
  OVERTIME_AUTHORITY_UPDATED: 'Draft edited',
  OVERTIME_AUTHORITY_SUBMITTED: 'Submitted',
  OVERTIME_AUTHORITY_REVIEWED: 'Reviewed',
  OVERTIME_AUTHORITY_APPROVED: 'Approved',
  OVERTIME_AUTHORITY_REJECTED: 'Rejected',
  OVERTIME_AUTHORITY_CANCELLED: 'Cancelled',
};

/** Refusals that mean the authority moved on since it was read: reload instead of retrying. */
const STALE_CODES = new Set([
  'OVERTIME_AUTHORITY_NOT_DRAFT',
  'OVERTIME_AUTHORITY_STATUS_INVALID',
  'OVERTIME_AUTHORITY_APPROVAL_REQUEST_EXISTS',
  'OVERTIME_AUTHORITY_NOT_FOUND',
]);

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

/** The API's refusal, with each covered Employee's own refusal named. */
function refusalMessage(value: unknown, fallback: string, names: Map<string, string>): string {
  const error = (
    value as {
      error?: {
        message?: unknown;
        fields?: Record<string, string>;
        refusals?: Array<{ employeeId: string; message: string }>;
      };
    } | null
  )?.error;
  const message = typeof error?.message === 'string' ? error.message : fallback;
  const details = [
    ...Object.entries(error?.fields ?? {}).map(([field, text]) => `${field}: ${text}`),
    ...(error?.refusals ?? []).map(
      (refusal) => `${names.get(refusal.employeeId) ?? refusal.employeeId}: ${refusal.message}`,
    ),
  ];
  return details.length > 0 ? `${message} ${details.join(' ')}` : message;
}

function valueOf(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function checkedOf(event: { currentTarget: EventTarget }): boolean {
  return (event.currentTarget as unknown as { checked: boolean }).checked;
}

function hoursLabel(value: string | number): string {
  const text = typeof value === 'number' ? value.toFixed(4) : value;
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

function totalHours(employees: CoveredEmployee[]): string {
  return hoursLabel(employees.reduce((sum, row) => sum + Number(row.authorizedHours), 0));
}

function dateLabel(value: string): string {
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00.000Z`);
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

function datesLabel(authority: OvertimeAuthority): string {
  return authority.workDateFrom === authority.workDateTo
    ? dateLabel(authority.workDateFrom)
    : `${dateLabel(authority.workDateFrom)} – ${dateLabel(authority.workDateTo)}`;
}

function pendingLabel(authority: OvertimeAuthority): string | null {
  const pending = authority.pendingAction;
  if (!pending) return null;
  const role = PENDING_ROLE[pending.role];
  return pending.assigneeName ? `${role} · ${pending.assigneeName}` : role;
}

function StatusCell({ authority }: { authority: OvertimeAuthority }) {
  const display = STATUS_DISPLAY[authority.status];
  const pending = pendingLabel(authority);
  return (
    <>
      <StatusTag tone={display.tone}>{display.label}</StatusTag>
      {pending ? (
        <span className="block text-caption text-ink-muted">Awaiting {pending}</span>
      ) : null}
    </>
  );
}

export function OvertimeAuthorityWorkspace({
  agencyId,
  initial,
  canCreate,
  canSubmit,
  canCancel,
  canReview,
  canApprove,
  canReject,
  canListEmployees,
}: {
  agencyId: string;
  initial: OvertimeAuthorityListResponse;
  canCreate: boolean;
  canSubmit: boolean;
  canCancel: boolean;
  canReview: boolean;
  canApprove: boolean;
  canReject: boolean;
  /** Preparing needs the Employee and Organization Unit pickers. */
  canListEmployees: boolean;
}) {
  const [authorities, setAuthorities] = useState(initial.authorities);
  const [statusFilter, setStatusFilter] = useState<'ALL' | OvertimeAuthorityStatus>('ALL');
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<OvertimeAuthorityDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState('');
  const [success, setSuccess] = useState('');
  const [editing, setEditing] = useState(false);
  const [formTab, setFormTab] = useState<'authority' | 'history'>('authority');
  const navigation = useRecordNavigation();
  const requestedView = navigation.search.get('view');
  const preparing = navigation.search.get('new') === '1';
  const view: View =
    requestedView === 'form' || preparing ? 'form' : requestedView === 'kanban' ? 'kanban' : 'tree';
  const recordId = preparing ? null : navigation.search.get('record');

  useEffect(() => {
    if (recordId === null) {
      setDetail(null);
      setDetailError('');
      return;
    }
    let active = true;
    setDetail(null);
    setDetailLoading(true);
    setDetailError('');
    setStale('');
    setEditing(false);
    void request('/overtime-authorities/' + encodeURIComponent(recordId))
      .then((value) => {
        if (active) setDetail(value as OvertimeAuthorityDetail);
      })
      .catch((failure: unknown) => {
        if (active)
          setDetailError(
            failure instanceof Error ? failure.message : 'The Overtime Authority failed to load.',
          );
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
      const names = new Map(
        (detail?.employees ?? []).map((row) => [row.employeeId, row.employeeName]),
      );
      const code = (value as { error?: { code?: unknown } } | null)?.error?.code;
      throw new ApiError(
        refusalMessage(value, 'The Overtime Authority action failed.', names),
        response.status,
        typeof code === 'string' ? code : null,
      );
    }
    return value;
  }

  async function reload(id: string | null): Promise<void> {
    const list = (await request('/overtime-authorities')) as OvertimeAuthorityListResponse;
    setAuthorities(list.authorities);
    if (id) {
      setDetail(
        (await request(
          '/overtime-authorities/' + encodeURIComponent(id),
        )) as OvertimeAuthorityDetail,
      );
    }
  }

  function openRecord(id: string): void {
    setError('');
    setSuccess('');
    navigation.navigate({ view: 'form', record: id, new: null });
  }

  /** Run one command once: a second click while it is in flight does nothing. */
  async function run(path: string, init: RequestInit, message: string): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setStale('');
    setSuccess('');
    try {
      const saved = (await request(path, {
        ...init,
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      })) as { id: string };
      await reload(saved.id);
      setSuccess(message);
    } catch (failure: unknown) {
      if (failure instanceof ApiError && failure.code && STALE_CODES.has(failure.code)) {
        setStale(failure.message);
      } else {
        setError(
          failure instanceof Error ? failure.message : 'The Overtime Authority action failed.',
        );
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function act(path: string, body: unknown, message: string): Promise<void> {
    if (!detail) return;
    await run(
      '/overtime-authorities/' + detail.id + path,
      { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
      message,
    );
  }

  async function saveDraft(body: DraftBody): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setStale('');
    setSuccess('');
    try {
      const saved = (await request(
        detail && editing ? '/overtime-authorities/' + detail.id : '/overtime-authorities',
        {
          method: detail && editing ? 'PUT' : 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify(body),
        },
      )) as { id: string };
      setEditing(false);
      if (preparing) {
        setSuccess('The Overtime Authority was saved as a draft.');
        await reload(null);
        navigation.navigate({ view: 'form', record: saved.id, new: null });
      } else {
        await reload(saved.id);
        setSuccess('The draft was saved.');
      }
    } catch (failure: unknown) {
      if (failure instanceof ApiError && failure.code && STALE_CODES.has(failure.code)) {
        setEditing(false);
        setStale(failure.message);
      } else {
        setError(failure instanceof Error ? failure.message : 'The draft could not be saved.');
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function reloadStale(): Promise<void> {
    setStale('');
    setError('');
    try {
      await reload(recordId);
    } catch (failure: unknown) {
      setDetailError(failure instanceof Error ? failure.message : 'The reload failed.');
      setDetail(null);
    }
  }

  const needle = query.trim().toLowerCase();
  const visible = authorities.filter((authority) => {
    if (statusFilter !== 'ALL' && authority.status !== statusFilter) return false;
    if (needle === '') return true;
    return (
      authority.authorityNo.toLowerCase().includes(needle) ||
      authority.purpose.toLowerCase().includes(needle) ||
      authority.employees.some(
        (row) =>
          row.employeeName.toLowerCase().includes(needle) ||
          row.employeeNumber.toLowerCase().includes(needle),
      )
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
        title="Overtime Authorities"
        actions={
          canCreate && canListEmployees ? (
            <Button
              variant="primary"
              onClick={() => {
                setError('');
                setSuccess('');
                navigation.navigate({ view: 'form', new: '1', record: null });
              }}
            >
              New authority
            </Button>
          ) : null
        }
        tabs={
          <SectionTabList
            label="Overtime Authority views"
            tabs={[
              { value: 'tree', label: 'Tree' },
              { value: 'form', label: 'Form' },
              { value: 'kanban', label: 'Kanban' },
            ]}
          />
        }
      />
      <p className="m-0 max-w-[760px] text-small text-ink-muted">
        Authority to render overtime, from preparation through review and the Approving Official’s
        decision.
      </p>

      {success ? (
        <p className={successClass} role="status">
          {success}
        </p>
      ) : null}
      <FormError message={error} />

      <SectionTabPanel value="tree">
        <Panel
          title="Authority register"
          flush
          actions={
            <>
              <input
                aria-label="Search authority, purpose, or Employee"
                className={inputClass + ' max-w-xs'}
                placeholder="Search authority, purpose, or Employee"
                value={query}
                onChange={(event) => setQuery(valueOf(event))}
              />
              <select
                aria-label="Status"
                className={inputClass + ' max-w-xs'}
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(valueOf(event) as 'ALL' | OvertimeAuthorityStatus)
                }
              >
                <option value="ALL">All statuses</option>
                {OVERTIME_AUTHORITY_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_DISPLAY[status].label}
                  </option>
                ))}
              </select>
            </>
          }
        >
          {visible.length === 0 ? (
            <StateSurface compact label="Overtime Authorities">
              <p className="m-0">
                {authorities.length === 0
                  ? 'No Overtime Authorities yet.'
                  : 'No Overtime Authorities match.'}
              </p>
            </StateSurface>
          ) : (
            <>
              <Table className="min-w-[880px]">
                <thead>
                  <tr>
                    <Th>Authority</Th>
                    <Th>Work Dates</Th>
                    <Th>Employees</Th>
                    <Th>Method</Th>
                    <Th>Status</Th>
                    <Th>Authorized hours</Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((authority) => (
                    <Tr key={authority.id} selected={authority.id === recordId}>
                      <RowHeader>
                        <button
                          type="button"
                          className="cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-ink underline-offset-2 hover:underline"
                          onClick={() => openRecord(authority.id)}
                        >
                          {authority.authorityNo}
                        </button>
                        <p className="m-0 line-clamp-1 text-caption font-normal text-ink-muted">
                          {authority.purpose}
                        </p>
                      </RowHeader>
                      <Td>{datesLabel(authority)}</Td>
                      <Td>{authority.employees.map((row) => row.employeeName).join(', ')}</Td>
                      <Td>{METHOD_LABEL[authority.compensationMethod]}</Td>
                      <Td>
                        <StatusCell authority={authority} />
                      </Td>
                      <Td>{totalHours(authority.employees)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <TableFooter shown={visible.length} total={authorities.length} />
            </>
          )}
        </Panel>
      </SectionTabPanel>

      <SectionTabPanel value="kanban">
        <div
          role="group"
          aria-label="Overtime Authority status board"
          className="grid gap-4 md:grid-cols-3 xl:grid-cols-6"
        >
          {OVERTIME_AUTHORITY_STATUSES.map((status) => {
            const cards = visible.filter((authority) => authority.status === status);
            return (
              <Panel key={status} title={`${STATUS_DISPLAY[status].label} (${cards.length})`}>
                <div className="grid gap-2">
                  {cards.map((authority) => (
                    <button
                      key={authority.id}
                      type="button"
                      className="w-full cursor-pointer rounded-control border border-border bg-surface p-2 text-left text-small hover:bg-canvas"
                      onClick={() => openRecord(authority.id)}
                    >
                      <span className="font-[600] text-ink">{authority.authorityNo}</span>
                      <span className="block text-caption text-ink-muted">
                        {datesLabel(authority)} · {authority.employees.length} Employee
                        {authority.employees.length === 1 ? '' : 's'} ·{' '}
                        {totalHours(authority.employees)} h
                      </span>
                      {pendingLabel(authority) ? (
                        <span className="block text-caption text-ink-muted">
                          Awaiting {pendingLabel(authority)}
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
            title="Prepare Overtime Authority"
            initial={null}
            busy={busy}
            request={request}
            onSave={saveDraft}
            onDiscard={() => navigation.navigate({ view: 'tree', new: null })}
          />
        ) : (
          <Panel
            title="Overtime Authority record"
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
              <StateSurface busy compact label="Loading Overtime Authority">
                <p className="m-0" role="status">
                  Loading the Overtime Authority…
                </p>
              </StateSurface>
            ) : null}
            {!detailLoading && detailError ? (
              <StateSurface compact label="Overtime Authority unavailable">
                <p className="m-0" role="alert">
                  {detailError}
                </p>
              </StateSurface>
            ) : null}
            {!detailLoading && !detailError && !detail ? (
              <StateSurface compact>
                <p className="m-0">Select an Overtime Authority from the Tree or Kanban view.</p>
              </StateSurface>
            ) : null}
            {stale ? (
              <div
                role="alert"
                className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-control border border-warning/50 bg-warning/5 px-3 py-2.5 text-small text-ink"
              >
                <span>This Overtime Authority changed since you opened it. {stale}</span>
                <Button variant="secondary" onClick={() => void reloadStale()}>
                  Reload
                </Button>
              </div>
            ) : null}
            {detail && editing ? (
              <DraftForm
                title="Edit Overtime Authority"
                initial={detail}
                busy={busy}
                request={request}
                onSave={saveDraft}
                onDiscard={() => setEditing(false)}
              />
            ) : null}
            {detail && !editing ? (
              <SectionTabs
                value={formTab}
                onValueChange={(value) => setFormTab(value as 'authority' | 'history')}
                className="grid gap-4"
              >
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="m-0 text-panel-title text-ink">{detail.authorityNo}</h2>
                    <p className="m-0 text-small text-ink-muted">
                      {detail.requestingUnitName} · {datesLabel(detail)}
                    </p>
                  </div>
                  <div className="text-right">
                    <StatusCell authority={detail} />
                  </div>
                </header>
                <SectionTabList
                  label="Overtime Authority sections"
                  tabs={[
                    { value: 'authority', label: 'Authority' },
                    { value: 'history', label: 'History' },
                  ]}
                />
                <SectionTabPanel value="authority">
                  <AuthoritySection
                    detail={detail}
                    busy={busy || stale !== ''}
                    canEdit={canCreate && canListEmployees}
                    canSubmit={canSubmit}
                    canCancel={canCancel}
                    canReview={canReview}
                    canApprove={canApprove}
                    canReject={canReject}
                    onEdit={() => {
                      setError('');
                      setSuccess('');
                      setEditing(true);
                    }}
                    act={act}
                  />
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

function AuthoritySection({
  detail,
  busy,
  canEdit,
  canSubmit,
  canCancel,
  canReview,
  canApprove,
  canReject,
  onEdit,
  act,
}: {
  detail: OvertimeAuthorityDetail;
  busy: boolean;
  canEdit: boolean;
  canSubmit: boolean;
  canCancel: boolean;
  canReview: boolean;
  canApprove: boolean;
  canReject: boolean;
  onEdit: () => void;
  act: (path: string, body: unknown, message: string) => Promise<void>;
}) {
  const draft = detail.status === 'DRAFT';
  const attested = new Map(
    (detail.review?.attestations ?? []).map((row) => [row.employeeId, row.positionLevel]),
  );
  return (
    <div className="grid gap-5">
      <dl className="m-0 grid gap-3 text-small md:grid-cols-3">
        <div className="md:col-span-3">
          <dt className="text-caption text-ink-muted">Purpose</dt>
          <dd className="m-0 whitespace-pre-line text-ink">{detail.purpose}</dd>
        </div>
        <div>
          <dt className="text-caption text-ink-muted">Work Dates</dt>
          <dd className="m-0 text-ink">{datesLabel(detail)}</dd>
        </div>
        <div>
          <dt className="text-caption text-ink-muted">
            {detail.status === 'APPROVED' ? 'Approved method' : 'Proposed method'}
          </dt>
          <dd className="m-0 text-ink">{METHOD_LABEL[detail.compensationMethod]}</dd>
        </div>
        <div>
          <dt className="text-caption text-ink-muted">Funding reference</dt>
          <dd className="m-0 text-ink">{detail.fundingReference ?? '—'}</dd>
        </div>
      </dl>

      <section className="grid gap-2" aria-label="Covered Employees">
        <h3 className={sectionTitleClass}>Covered Employees</h3>
        <div className="overflow-x-auto rounded-panel border border-border">
          <Table className="min-w-[720px]">
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Authorized hours</Th>
                <Th>Task</Th>
                <Th>Eligibility snapshot at approval</Th>
              </tr>
            </thead>
            <tbody>
              {detail.employees.map((row) => (
                <Tr key={row.id}>
                  <RowHeader>
                    {row.employeeName}
                    <p className="m-0 text-caption font-normal text-ink-muted">
                      {row.employeeNumber}
                    </p>
                  </RowHeader>
                  <Td>{hoursLabel(row.authorizedHours)}</Td>
                  <Td>{row.taskDescription ?? '—'}</Td>
                  <Td>
                    {row.eligibilitySnapshot ? (
                      <SnapshotSummary snapshot={row.eligibilitySnapshot} />
                    ) : (
                      <span className="text-ink-muted">Taken when the authority is approved.</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
        <p className="m-0 text-caption text-ink-muted">
          Total authorized: {totalHours(detail.employees)} hours.
        </p>
      </section>

      <section className="grid gap-2" aria-label="Review">
        <h3 className={sectionTitleClass}>Review</h3>
        {detail.review ? (
          <div className="grid gap-1 text-small text-ink">
            <p className="m-0">
              Reviewed by {detail.review.reviewedByName ?? 'an unnamed Membership'} on{' '}
              {instantLabel(detail.review.reviewedAt)}.
            </p>
            <ul className="m-0 grid list-none gap-1 p-0">
              {detail.employees.map((row) => {
                const level = attested.get(row.employeeId);
                return (
                  <li key={row.id}>
                    {row.employeeName}: {level ? POSITION_LEVEL_LABEL[level] : 'not attested'}; no
                    other beyond-hours allowance attested.
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <p className="m-0 text-small text-ink-muted">Not reviewed yet.</p>
        )}
      </section>

      {detail.decision ? (
        <section className="grid gap-1" aria-label="Decision">
          <h3 className={sectionTitleClass}>Decision</h3>
          <p className="m-0 text-small text-ink">
            {detail.decision.decision === 'APPROVE' ? 'Approved' : 'Rejected'} by{' '}
            {detail.decision.decidedByName ?? 'an unnamed Membership'} on{' '}
            {instantLabel(detail.decision.decidedAt)}.
          </p>
          {detail.decision.comments ? (
            <p className="m-0 text-small whitespace-pre-line text-ink">
              {detail.decision.comments}
            </p>
          ) : null}
        </section>
      ) : null}

      {draft && (canEdit || canSubmit || canCancel) ? (
        <section className="flex flex-wrap gap-2" aria-label="Draft actions">
          {canSubmit ? (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void act('/submit', undefined, 'The authority was submitted for review.')
              }
            >
              Submit for review
            </Button>
          ) : null}
          {canEdit ? (
            <Button variant="secondary" disabled={busy} onClick={onEdit}>
              Edit draft
            </Button>
          ) : null}
          {canCancel ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void act('/cancel', undefined, 'The authority was cancelled.')}
            >
              Cancel authority
            </Button>
          ) : null}
        </section>
      ) : null}

      {detail.status === 'SUBMITTED' && canReview ? (
        <ReviewForm detail={detail} busy={busy} act={act} />
      ) : null}

      {detail.status === 'FOR_REVIEW' && (canApprove || canReject) ? (
        <DecisionForm
          detail={detail}
          busy={busy}
          canApprove={canApprove}
          canReject={canReject}
          act={act}
        />
      ) : null}

      {/* Only the Approving Official cancels an approved authority (hris-controls §5.16). */}
      {detail.status === 'APPROVED' && canCancel && canApprove ? (
        <section className="grid gap-2" aria-label="Cancel before service">
          <p className="m-0 text-small text-ink-muted">
            An approved authority can be cancelled only before any service is recorded.
          </p>
          <div>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void act('/cancel', undefined, 'The authority was cancelled.')}
            >
              Cancel authority
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SnapshotSummary({ snapshot }: { snapshot: EligibilitySnapshot }) {
  return (
    <div className="grid gap-0.5 text-caption text-ink">
      {snapshot.service.map((service) => (
        <span key={service.serviceSegmentId}>
          {service.positionTitle ?? 'No position title'}
          {service.positionItemNumber ? ` (${service.positionItemNumber})` : ''} ·{' '}
          {service.appointmentStatus.toLowerCase()}
          {service.salaryGrade !== null ? ` · SG ${service.salaryGrade}` : ''}
          {service.personnelCategory ? ` · ${service.personnelCategory.toLowerCase()}` : ''}
        </span>
      ))}
      {snapshot.workArrangements.map((arrangement) => (
        <span key={arrangement.workArrangementVersionId}>
          Work arrangement {arrangement.arrangementType.toLowerCase()} v{arrangement.versionNo}
        </span>
      ))}
      <span>Attested: {POSITION_LEVEL_LABEL[snapshot.attestation.positionLevel]}</span>
      <span className="text-ink-muted">Captured {instantLabel(snapshot.capturedAt)}</span>
    </div>
  );
}

function ReviewForm({
  detail,
  busy,
  act,
}: {
  detail: OvertimeAuthorityDetail;
  busy: boolean;
  act: (path: string, body: unknown, message: string) => Promise<void>;
}) {
  const [rows, setRows] = useState(() =>
    Object.fromEntries(
      detail.employees.map((row) => [
        row.employeeId,
        { positionLevel: '' as PositionLevel | '', noOtherAllowance: false },
      ]),
    ),
  );
  const complete = detail.employees.every((row) => {
    const value = rows[row.employeeId];
    return value?.positionLevel && value.noOtherAllowance;
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void act(
      '/review',
      {
        attestations: detail.employees.map((row) => ({
          employeeId: row.employeeId,
          positionLevel: rows[row.employeeId]?.positionLevel,
          noOtherBeyondHoursAllowance: true,
        })),
      },
      'The review was recorded and the authority sent to the Approving Official.',
    );
  }

  return (
    <form className="grid gap-3" aria-label="Review this authority" onSubmit={submit}>
      <h3 className={sectionTitleClass}>Review this authority</h3>
      <p className="m-0 text-small text-ink-muted">
        Attest, for each covered Employee, the eligibility facts the system does not hold.
      </p>
      {detail.employees.map((row) => (
        <fieldset
          key={row.id}
          className="m-0 grid gap-2 rounded-control border border-border p-3 md:grid-cols-2"
        >
          <legend className="px-1 text-small font-[600] text-ink">{row.employeeName}</legend>
          <Field label={`Position level, ${row.employeeName}`}>
            <select
              className={inputClass}
              value={rows[row.employeeId]?.positionLevel ?? ''}
              required
              onChange={(event) => {
                const positionLevel = valueOf(event) as PositionLevel | '';
                setRows((current) => ({
                  ...current,
                  [row.employeeId]: {
                    noOtherAllowance: current[row.employeeId]?.noOtherAllowance ?? false,
                    positionLevel,
                  },
                }));
              }}
            >
              <option value="">Choose</option>
              {Object.entries(POSITION_LEVEL_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 self-end text-small text-ink">
            <input
              type="checkbox"
              checked={rows[row.employeeId]?.noOtherAllowance ?? false}
              onChange={(event) => {
                const noOtherAllowance = checkedOf(event);
                setRows((current) => ({
                  ...current,
                  [row.employeeId]: {
                    positionLevel: current[row.employeeId]?.positionLevel ?? '',
                    noOtherAllowance,
                  },
                }));
              }}
            />
            No other beyond-hours allowance, {row.employeeName}
          </label>
        </fieldset>
      ))}
      <div>
        <Button type="submit" variant="primary" disabled={busy || !complete}>
          {busy ? 'Recording…' : 'Record review'}
        </Button>
      </div>
    </form>
  );
}

function DecisionForm({
  detail,
  busy,
  canApprove,
  canReject,
  act,
}: {
  detail: OvertimeAuthorityDetail;
  busy: boolean;
  canApprove: boolean;
  canReject: boolean;
  act: (path: string, body: unknown, message: string) => Promise<void>;
}) {
  const [method, setMethod] = useState<CompensationMethod>(detail.compensationMethod);
  const [comments, setComments] = useState('');
  const [reason, setReason] = useState('');
  return (
    <section className="grid gap-3" aria-label="Decide this authority">
      <h3 className={sectionTitleClass}>Decide this authority</h3>
      {canApprove ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Approved method">
            <select
              className={inputClass}
              value={method}
              onChange={(event) => setMethod(valueOf(event) as CompensationMethod)}
            >
              <option value="COC">{METHOD_LABEL.COC}</option>
              <option value="OVERTIME_PAY">{METHOD_LABEL.OVERTIME_PAY}</option>
            </select>
          </Field>
          <Field label="Approval comments (optional)">
            <textarea
              className={inputClass + ' py-2'}
              rows={2}
              value={comments}
              onChange={(event) => setComments(valueOf(event))}
            />
          </Field>
          <div>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void act(
                  '/approve',
                  {
                    compensationMethod: method,
                    ...(comments.trim() ? { comments: comments.trim() } : {}),
                  },
                  'The authority was approved.',
                )
              }
            >
              Approve authority
            </Button>
          </div>
        </div>
      ) : null}
      {canReject ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Rejection reason">
            <textarea
              className={inputClass + ' py-2'}
              rows={2}
              value={reason}
              onChange={(event) => setReason(valueOf(event))}
            />
          </Field>
          <div className="self-end">
            <Button
              variant="secondary"
              disabled={busy || reason.trim() === ''}
              onClick={() =>
                void act('/reject', { reason: reason.trim() }, 'The authority was rejected.')
              }
            >
              Reject authority
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function HistorySection({ detail }: { detail: OvertimeAuthorityDetail }) {
  return (
    <ol className="m-0 grid list-none gap-2 p-0 text-small" aria-label="Authority history">
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

interface DraftBody {
  authorityNo: string;
  requestingUnitId: string;
  purpose: string;
  workDateFrom: string;
  workDateTo: string;
  compensationMethod: CompensationMethod;
  fundingReference: string | null;
  employees: Array<{ employeeId: string; authorizedHours: string; taskDescription: string | null }>;
}

interface EmployeeRow {
  employeeId: string;
  authorizedHours: string;
  taskDescription: string;
}

function DraftForm({
  title,
  initial,
  busy,
  request,
  onSave,
  onDiscard,
}: {
  title: string;
  initial: OvertimeAuthorityDetail | null;
  busy: boolean;
  request: (path: string) => Promise<unknown>;
  onSave: (body: DraftBody) => Promise<void>;
  onDiscard: () => void;
}) {
  const [authorityNo, setAuthorityNo] = useState(initial?.authorityNo ?? '');
  const [requestingUnitId, setRequestingUnitId] = useState(initial?.requestingUnitId ?? '');
  const [purpose, setPurpose] = useState(initial?.purpose ?? '');
  const [workDateFrom, setWorkDateFrom] = useState(initial?.workDateFrom ?? '');
  const [workDateTo, setWorkDateTo] = useState(initial?.workDateTo ?? '');
  const [method, setMethod] = useState<CompensationMethod>(initial?.compensationMethod ?? 'COC');
  const [fundingReference, setFundingReference] = useState(initial?.fundingReference ?? '');
  const [rows, setRows] = useState<EmployeeRow[]>(
    initial?.employees.map((row) => ({
      employeeId: row.employeeId,
      authorizedHours: hoursLabel(row.authorizedHours),
      taskDescription: row.taskDescription ?? '',
    })) ?? [{ employeeId: '', authorizedHours: '', taskDescription: '' }],
  );
  const [units, setUnits] = useState<UnitOption[] | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[] | null>(null);
  const [optionsError, setOptionsError] = useState('');

  useEffect(() => {
    let active = true;
    void Promise.all([request('/organization-units'), request('/employees')])
      .then(([unitList, employeeList]) => {
        if (!active) return;
        setUnits((unitList as { units: UnitOption[] }).units);
        const listed = (employeeList as { employees: EmployeeOption[] }).employees;
        // Keep covered Employees selectable even when the first page does not list them.
        const covered = (initial?.employees ?? [])
          .filter((row) => !listed.some(({ id }) => id === row.employeeId))
          .map((row) => ({
            id: row.employeeId,
            employeeNumber: row.employeeNumber,
            legalName: row.employeeName,
          }));
        setEmployees([...covered, ...listed]);
      })
      .catch((failure: unknown) => {
        if (active)
          setOptionsError(failure instanceof Error ? failure.message : 'Loading options failed.');
      });
    return () => {
      active = false;
    };
  }, []);

  function updateRow(index: number, change: Partial<EmployeeRow>): void {
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...change } : row)));
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void onSave({
      authorityNo: authorityNo.trim(),
      requestingUnitId,
      purpose: purpose.trim(),
      workDateFrom,
      workDateTo,
      compensationMethod: method,
      fundingReference: fundingReference.trim() || null,
      employees: rows.map((row) => ({
        employeeId: row.employeeId,
        authorizedHours: row.authorizedHours.trim(),
        taskDescription: row.taskDescription.trim() || null,
      })),
    });
  }

  return (
    <Panel title={title}>
      <FormError message={optionsError} />
      {!optionsError && (units === null || employees === null) ? (
        <StateSurface busy compact label="Loading options">
          <p className="m-0" role="status">
            Loading Organization Units and Employees…
          </p>
        </StateSurface>
      ) : null}
      {units && employees ? (
        <form className="grid gap-3 md:grid-cols-2" onSubmit={submit}>
          <Field label="Authority number">
            <input
              className={inputClass}
              value={authorityNo}
              maxLength={80}
              required
              onChange={(event) => setAuthorityNo(valueOf(event))}
            />
          </Field>
          <Field label="Requesting unit">
            <select
              className={inputClass}
              value={requestingUnitId}
              required
              onChange={(event) => setRequestingUnitId(valueOf(event))}
            >
              <option value="">Choose a unit</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.officialName} ({unit.code})
                </option>
              ))}
            </select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Purpose">
              <textarea
                className={inputClass + ' py-2'}
                rows={3}
                value={purpose}
                maxLength={4000}
                required
                onChange={(event) => setPurpose(valueOf(event))}
              />
            </Field>
          </div>
          <Field label="First Work Date">
            <input
              className={inputClass}
              type="date"
              value={workDateFrom}
              required
              onChange={(event) => setWorkDateFrom(valueOf(event))}
            />
          </Field>
          <Field label="Last Work Date">
            <input
              className={inputClass}
              type="date"
              value={workDateTo}
              min={workDateFrom || undefined}
              required
              onChange={(event) => setWorkDateTo(valueOf(event))}
            />
          </Field>
          <Field label="Proposed method">
            <select
              className={inputClass}
              value={method}
              onChange={(event) => setMethod(valueOf(event) as CompensationMethod)}
            >
              <option value="COC">{METHOD_LABEL.COC}</option>
              <option value="OVERTIME_PAY">{METHOD_LABEL.OVERTIME_PAY}</option>
            </select>
          </Field>
          <Field
            label={method === 'OVERTIME_PAY' ? 'Funding reference' : 'Funding reference (optional)'}
          >
            <input
              className={inputClass}
              value={fundingReference}
              maxLength={200}
              required={method === 'OVERTIME_PAY'}
              onChange={(event) => setFundingReference(valueOf(event))}
            />
          </Field>

          <fieldset className="m-0 grid gap-3 rounded-control border border-border p-3 md:col-span-2">
            <legend className="px-1 text-small font-[600] text-ink">Covered Employees</legend>
            {rows.map((row, index) => (
              <div key={index} className="grid gap-3 md:grid-cols-[2fr_1fr_2fr_auto] md:items-end">
                <Field label={`Employee ${index + 1}`}>
                  <select
                    className={inputClass}
                    value={row.employeeId}
                    required
                    onChange={(event) => updateRow(index, { employeeId: valueOf(event) })}
                  >
                    <option value="">Choose an Employee</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.legalName} ({employee.employeeNumber})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={`Authorized hours ${index + 1}`}>
                  <input
                    className={inputClass}
                    inputMode="decimal"
                    value={row.authorizedHours}
                    required
                    onChange={(event) => updateRow(index, { authorizedHours: valueOf(event) })}
                  />
                </Field>
                <Field label={`Task ${index + 1} (optional)`}>
                  <input
                    className={inputClass}
                    value={row.taskDescription}
                    maxLength={2000}
                    onChange={(event) => updateRow(index, { taskDescription: valueOf(event) })}
                  />
                </Field>
                <Button
                  type="button"
                  variant="quiet"
                  disabled={rows.length === 1}
                  onClick={() => setRows((current) => current.filter((_, at) => at !== index))}
                >
                  Remove Employee {index + 1}
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setRows((current) => [
                    ...current,
                    { employeeId: '', authorizedHours: '', taskDescription: '' },
                  ])
                }
              >
                Add Employee
              </Button>
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-2 md:col-span-2">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save draft'}
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={onDiscard}>
              Discard changes
            </Button>
          </div>
        </form>
      ) : null}
    </Panel>
  );
}
