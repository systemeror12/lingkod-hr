'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRecordNavigation } from './record-navigation';
import { StateSurface } from './state-surface';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';
import { PageHeader } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag, type StatusTone } from './ui/status-tag';
import { RowHeader, Table, Td, Th, Tr } from './ui/table';

export type AttendanceContextType =
  'OFFICIAL_BUSINESS' | 'OFFICIAL_TRAVEL' | 'TRAINING' | 'APPROVED_ABSENCE';

export type AttendanceContextCoverageMode = 'WHOLE_WORK_DATE' | 'TIMED';

export interface AttendanceContextItem {
  id: string;
  agencyId: string;
  employee: { id: string; employeeNumber: string; legalName: string };
  contextType: AttendanceContextType;
  coverageMode: AttendanceContextCoverageMode;
  workDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  reason: string;
  sourceType: string | null;
  sourceId: string | null;
  evidence: {
    documentVersionId: string;
    documentId: string;
    documentNo: string | null;
    documentType: string;
    versionNo: number;
  } | null;
  recordedBy: { membershipId: string; legalName: string | null };
  recordedAt: string;
}

export interface AttendanceContextListResponse {
  contexts: AttendanceContextItem[];
}

interface EmployeeOption {
  id: string;
  employeeNumber: string;
  legalName: string;
}

type View = 'tree' | 'form' | 'kanban';

const CONTEXT_TYPES: readonly AttendanceContextType[] = [
  'OFFICIAL_BUSINESS',
  'OFFICIAL_TRAVEL',
  'TRAINING',
  'APPROVED_ABSENCE',
];

const CONTEXT_TYPE_LABELS: Record<AttendanceContextType, string> = {
  OFFICIAL_BUSINESS: 'Official business',
  OFFICIAL_TRAVEL: 'Official travel',
  TRAINING: 'Training',
  APPROVED_ABSENCE: 'Approved absence',
};

const CONTEXT_TYPE_TONES: Record<AttendanceContextType, StatusTone> = {
  OFFICIAL_BUSINESS: 'success',
  OFFICIAL_TRAVEL: 'neutral',
  TRAINING: 'success',
  APPROVED_ABSENCE: 'warning',
};

const VIEWS: readonly [View, string][] = [
  ['tree', 'Tree'],
  ['form', 'Form'],
  ['kanban', 'Kanban'],
];

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const error = (value as { error?: { message?: unknown; reasons?: unknown } }).error;
  const message = typeof error?.message === 'string' ? error.message : fallback;
  if (Array.isArray(error?.reasons) && error.reasons.length > 0) {
    return `${message} (${error.reasons.join(', ')})`;
  }
  return message;
}

function dateLabel(value: string): string {
  const date = new Date(value.includes('T') ? value : value.slice(0, 10) + 'T00:00:00.000Z');
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

function coverageLabel(record: AttendanceContextItem): string {
  if (record.coverageMode === 'WHOLE_WORK_DATE') {
    return record.workDate ? dateLabel(record.workDate) : 'Whole work date';
  }
  if (!record.startsAt || !record.endsAt) return 'Exact time range';
  return `${instantLabel(record.startsAt)} – ${instantLabel(record.endsAt)}`;
}

function basisLabel(record: AttendanceContextItem): string {
  if (record.sourceType !== null) {
    return record.sourceId ? `${record.sourceType} · ${record.sourceId}` : record.sourceType;
  }
  if (record.evidence) {
    return `${record.evidence.documentNo ?? record.evidence.documentType} · v${record.evidence.versionNo}`;
  }
  return '—';
}

function Detail({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? 'grid gap-1 min-[721px]:col-span-2' : 'grid gap-1'}>
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="m-0 text-body text-ink">{children}</dd>
    </div>
  );
}

function eventValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

/** Reads a datetime-local entry as Asia/Manila, the zone every label displays. */
export function manilaInstant(value: string): string {
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value) ? value + '+08:00' : NaN,
  );
  if (Number.isNaN(date.getTime())) {
    throw new Error('Enter a valid exact start and end time.');
  }
  return date.toISOString();
}

export function AttendanceContextWorkspace({
  agencyId,
  initial,
  canCreate,
}: {
  agencyId: string;
  initial: AttendanceContextListResponse;
  canCreate: boolean;
}) {
  const [records, setRecords] = useState(initial.contexts);
  const navigation = useRecordNavigation();
  const requestedView = navigation.search.get('view');
  const view: View =
    requestedView === 'form' ? 'form' : requestedView === 'kanban' ? 'kanban' : 'tree';
  const recordId = navigation.search.get('record');
  const creating = navigation.search.get('new') === 'context';
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | AttendanceContextType>('ALL');
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [contextType, setContextType] = useState<AttendanceContextType>('OFFICIAL_BUSINESS');
  const [coverageMode, setCoverageMode] =
    useState<AttendanceContextCoverageMode>('WHOLE_WORK_DATE');
  const [workDate, setWorkDate] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [evidenceDocumentVersionId, setEvidenceDocumentVersionId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const optionsRequested = useRef(false);

  const showsRecordForm = canCreate && view === 'form' && (creating || !recordId);

  useEffect(() => {
    if (!showsRecordForm || optionsRequested.current) return;
    optionsRequested.current = true;
    void request('/employees')
      .then((value) => {
        setEmployeeOptions((value as { employees: EmployeeOption[] }).employees);
      })
      .catch((failure: unknown) => {
        optionsRequested.current = false;
        setError(failure instanceof Error ? failure.message : 'Loading employees failed.');
      });
  }, [showsRecordForm]);

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch('/api/v1/agencies/' + agencyId + path, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(errorMessage(value, 'The Attendance Context action failed.'));
    }
    return value;
  }

  async function refresh(): Promise<void> {
    const list = (await request('/attendance-contexts')) as AttendanceContextListResponse;
    setRecords(list.contexts);
  }

  function openCreate(): void {
    setError('');
    setSuccess('');
    navigation.navigate({ view: 'form', record: null, new: 'context' });
  }

  function openRecord(id: string): void {
    setError('');
    setSuccess('');
    navigation.navigate({ view: 'form', record: id, new: null });
  }

  async function recordContext(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const body =
        coverageMode === 'WHOLE_WORK_DATE'
          ? {
              employeeId,
              contextType,
              coverageMode,
              workDate,
              reason: reason.trim(),
              ...(sourceType.trim() ? { sourceType: sourceType.trim() } : {}),
              ...(sourceId.trim() ? { sourceId: sourceId.trim() } : {}),
              ...(evidenceDocumentVersionId.trim()
                ? { evidenceDocumentVersionId: evidenceDocumentVersionId.trim() }
                : {}),
            }
          : {
              employeeId,
              contextType,
              coverageMode,
              startsAt: manilaInstant(startsAt),
              endsAt: manilaInstant(endsAt),
              reason: reason.trim(),
              ...(sourceType.trim() ? { sourceType: sourceType.trim() } : {}),
              ...(sourceId.trim() ? { sourceId: sourceId.trim() } : {}),
              ...(evidenceDocumentVersionId.trim()
                ? { evidenceDocumentVersionId: evidenceDocumentVersionId.trim() }
                : {}),
            };
      const created = (await request('/attendance-contexts', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      })) as AttendanceContextItem;
      setEmployeeId('');
      setWorkDate('');
      setStartsAt('');
      setEndsAt('');
      setReason('');
      setSourceType('');
      setSourceId('');
      setEvidenceDocumentVersionId('');
      try {
        await refresh();
      } catch {
        // The record exists; a resubmit would append a duplicate.
        setError(
          'Attendance Context recorded, but the register could not refresh. Reload the page to see it; do not record it again.',
        );
        return;
      }
      setSuccess('Attendance Context recorded. History keeps the original record.');
      navigation.navigate({ view: 'form', record: created.id, new: null });
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : 'Recording the context failed.');
    } finally {
      setBusy(false);
    }
  }

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = records.filter((record) => {
    if (typeFilter !== 'ALL' && record.contextType !== typeFilter) return false;
    if (!normalizedQuery) return true;
    return (
      record.employee.legalName.toLowerCase().includes(normalizedQuery) ||
      record.employee.employeeNumber.toLowerCase().includes(normalizedQuery) ||
      record.reason.toLowerCase().includes(normalizedQuery)
    );
  });
  const filterBar = (
    <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
      <Field htmlFor="attendance-context-search" label="Search">
        <input
          className={inputClass}
          id="attendance-context-search"
          onChange={(event) => setQuery(eventValue(event))}
          placeholder="Employee or reason"
          type="search"
          value={query}
        />
      </Field>
      <Field htmlFor="attendance-context-filter" label="Context">
        <select
          className={inputClass}
          id="attendance-context-filter"
          onChange={(event) => setTypeFilter(eventValue(event) as 'ALL' | AttendanceContextType)}
          value={typeFilter}
        >
          <option value="ALL">All types</option>
          {CONTEXT_TYPES.map((type) => (
            <option key={type} value={type}>
              {CONTEXT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
  const selected = recordId ? (records.find(({ id }) => id === recordId) ?? null) : null;

  return (
    <div className="grid min-w-0 gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Time & attendance' }]}
        title="Attendance Contexts"
        actions={
          <>
            <div
              aria-label="Record view"
              className="flex items-center gap-0.5 rounded-control border border-border bg-surface p-0.5"
              role="group"
            >
              {VIEWS.map(([value, label]) => (
                <button
                  aria-pressed={view === value}
                  className="cursor-pointer rounded-control border-0 bg-transparent px-3 py-1.5 text-caption font-[650] text-ink-muted hover:text-ink aria-pressed:bg-canvas aria-pressed:text-ink"
                  key={value}
                  onClick={() =>
                    // Form keeps an open draft; Tree and Kanban leave it.
                    navigation.navigate(
                      value === 'form'
                        ? { view: value, new: creating ? 'context' : null }
                        : { view: value, new: null },
                    )
                  }
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            {canCreate ? (
              <Button onClick={openCreate} type="button" variant="primary">
                Record attendance context
              </Button>
            ) : null}
          </>
        }
      />
      <p className="m-0 max-w-[760px] text-small text-ink-muted">
        Official business, official travel, training, and approved absence coverage recorded against
        one Employee. Records are append-only factual inputs; calculation and corrections stay in
        their own workflows.
      </p>

      <FormError message={error} />

      {view === 'tree' ? (
        <Panel
          title="Attendance Context register"
          flush
          actions={
            <span className="text-caption text-ink-muted">
              {filtered.length === 1 ? '1 context' : filtered.length + ' contexts'} · Agency scoped
            </span>
          }
        >
          {filterBar}
          {filtered.length === 0 ? (
            <StateSurface compact label="Attendance Contexts">
              <strong className="font-[650] text-ink">
                {records.length === 0 ? 'No Attendance Contexts yet.' : 'No contexts match.'}
              </strong>
              <p className="m-0">
                {records.length === 0
                  ? 'Record approved official business, travel, training, or absence coverage against an Employee.'
                  : 'Clear the search or choose another context type.'}
              </p>
            </StateSurface>
          ) : (
            <Table aria-label="Attendance Contexts" className="min-w-[900px]">
              <thead>
                <tr>
                  <Th>Coverage</Th>
                  <Th>Employee</Th>
                  <Th>Context</Th>
                  <Th>Reason and basis</Th>
                  <Th>Recorded</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((record) => (
                  <Tr key={record.id} selected={record.id === recordId}>
                    <RowHeader>
                      <button
                        className="w-fit cursor-pointer border-0 bg-transparent p-0 text-left font-[650] text-primary underline-offset-2 hover:underline"
                        onClick={() => openRecord(record.id)}
                        type="button"
                      >
                        {coverageLabel(record)}
                      </button>
                      <span className="block font-normal text-ink-muted">
                        {record.coverageMode === 'WHOLE_WORK_DATE'
                          ? 'Whole work date'
                          : 'Exact time range'}
                      </span>
                    </RowHeader>
                    <Td>
                      {record.employee.legalName}
                      <span className="block font-mono text-caption text-ink-muted">
                        {record.employee.employeeNumber}
                      </span>
                    </Td>
                    <Td>
                      <StatusTag tone={CONTEXT_TYPE_TONES[record.contextType]}>
                        {CONTEXT_TYPE_LABELS[record.contextType]}
                      </StatusTag>
                    </Td>
                    <Td className="max-w-[320px]">
                      {record.reason}
                      <span className="block text-ink-muted">{basisLabel(record)}</span>
                    </Td>
                    <Td className="text-ink-muted">
                      {instantLabel(record.recordedAt)}
                      <span className="block">
                        {record.recordedBy.legalName ?? 'Records custodian'}
                      </span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      ) : null}

      {view === 'form' ? (
        <Panel
          title={creating ? 'Record Attendance Context' : 'Attendance Context record'}
          flush
          actions={
            <>
              {!creating && selected && canCreate ? (
                <Button onClick={openCreate} type="button" variant="secondary">
                  Record another context
                </Button>
              ) : null}
              <Button
                onClick={() => navigation.navigate({ view: 'tree', record: null, new: null })}
                type="button"
                variant="secondary"
              >
                Back to register
              </Button>
            </>
          }
        >
          <p className="m-0 px-4 pt-3 text-small text-ink-muted">
            {creating
              ? 'One immutable fact with its reason, basis, recorder, and recorded time.'
              : 'Append-only history; correct coverage by recording a new context.'}
          </p>
          {success ? (
            <p
              className="mx-4 mt-3 mb-0 rounded-control border border-success/40 bg-success/5 px-3 py-2.5 text-small text-success"
              role="status"
            >
              {success}
            </p>
          ) : null}
          {!creating && recordId && !selected ? (
            <StateSurface compact label="Attendance Context record">
              <p className="m-0">
                That Attendance Context is not in the current register. Return to the register and
                choose another record.
              </p>
            </StateSurface>
          ) : creating || !selected ? (
            canCreate ? (
              <form className="grid gap-5 p-4" onSubmit={recordContext}>
                <div className="grid gap-4 min-[721px]:grid-cols-2">
                  <Field htmlFor="attendance-context-employee" label="Employee">
                    <select
                      className={inputClass}
                      id="attendance-context-employee"
                      onChange={(event) => setEmployeeId(eventValue(event))}
                      required
                      value={employeeId}
                    >
                      <option value="">Select an Employee</option>
                      {employeeOptions.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.employeeNumber} · {employee.legalName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field htmlFor="attendance-context-type" label="Context type">
                    <select
                      className={inputClass}
                      id="attendance-context-type"
                      onChange={(event) =>
                        setContextType(eventValue(event) as AttendanceContextType)
                      }
                      value={contextType}
                    >
                      {CONTEXT_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {CONTEXT_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <fieldset className="m-0 grid gap-3 border-0 p-0">
                  <legend className="p-0 text-caption font-[650] text-ink">Coverage</legend>
                  <div className="flex flex-wrap gap-4 text-body text-ink">
                    <label className="flex items-center gap-2">
                      <input
                        checked={coverageMode === 'WHOLE_WORK_DATE'}
                        className="accent-primary"
                        name="attendance-context-coverage"
                        onChange={() => setCoverageMode('WHOLE_WORK_DATE')}
                        type="radio"
                        value="WHOLE_WORK_DATE"
                      />
                      Whole work date
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        checked={coverageMode === 'TIMED'}
                        className="accent-primary"
                        name="attendance-context-coverage"
                        onChange={() => setCoverageMode('TIMED')}
                        type="radio"
                        value="TIMED"
                      />
                      Exact time range
                    </label>
                  </div>
                  {coverageMode === 'WHOLE_WORK_DATE' ? (
                    <Field htmlFor="attendance-context-work-date" label="Work date">
                      <input
                        className={inputClass}
                        id="attendance-context-work-date"
                        onChange={(event) => setWorkDate(eventValue(event))}
                        required
                        type="date"
                        value={workDate}
                      />
                    </Field>
                  ) : (
                    <div className="grid gap-4 min-[721px]:grid-cols-2">
                      <Field htmlFor="attendance-context-starts-at" label="Starts (Manila time)">
                        <input
                          className={inputClass}
                          id="attendance-context-starts-at"
                          onChange={(event) => setStartsAt(eventValue(event))}
                          required
                          type="datetime-local"
                          value={startsAt}
                        />
                      </Field>
                      <Field htmlFor="attendance-context-ends-at" label="Ends (Manila time)">
                        <input
                          className={inputClass}
                          id="attendance-context-ends-at"
                          onChange={(event) => setEndsAt(eventValue(event))}
                          required
                          type="datetime-local"
                          value={endsAt}
                        />
                      </Field>
                    </div>
                  )}
                </fieldset>
                <Field htmlFor="attendance-context-reason" label="Reason">
                  <textarea
                    className={inputClass + ' min-h-[92px] py-2'}
                    id="attendance-context-reason"
                    onChange={(event) => setReason(eventValue(event))}
                    required
                    value={reason}
                  />
                </Field>
                <div className="grid gap-4 min-[721px]:grid-cols-2">
                  <Field
                    htmlFor="attendance-context-source-type"
                    label="Source type (link one authoritative record)"
                  >
                    <input
                      className={inputClass}
                      id="attendance-context-source-type"
                      onChange={(event) => setSourceType(eventValue(event))}
                      placeholder="TravelOrder"
                      value={sourceType}
                    />
                  </Field>
                  <Field htmlFor="attendance-context-source-id" label="Source identifier">
                    <input
                      className={inputClass}
                      id="attendance-context-source-id"
                      onChange={(event) => setSourceId(eventValue(event))}
                      placeholder="00000000-0000-0000-0000-000000000000"
                      value={sourceId}
                    />
                  </Field>
                </div>
                <Field
                  htmlFor="attendance-context-evidence"
                  label="Evidence Document Version ID (or link a source above)"
                >
                  <input
                    className={inputClass}
                    id="attendance-context-evidence"
                    onChange={(event) => setEvidenceDocumentVersionId(eventValue(event))}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    value={evidenceDocumentVersionId}
                  />
                </Field>
                <div className="flex justify-end">
                  <Button disabled={busy} type="submit" variant="primary">
                    {busy ? 'Recording…' : 'Record Attendance Context'}
                  </Button>
                </div>
              </form>
            ) : creating ? (
              <StateSurface compact label="Attendance Context access">
                <p className="m-0">
                  Your active Agency Membership does not permit recording Attendance Contexts.
                </p>
              </StateSurface>
            ) : (
              <StateSurface compact label="Attendance Context record">
                <p className="m-0">Choose a record from the register to read it.</p>
              </StateSurface>
            )
          ) : (
            <dl className="m-0 grid gap-4 p-4 min-[721px]:grid-cols-2">
              <Detail label="Employee">
                {selected.employee.legalName} · {selected.employee.employeeNumber}
              </Detail>
              <Detail label="Context type">
                <StatusTag tone={CONTEXT_TYPE_TONES[selected.contextType]}>
                  {CONTEXT_TYPE_LABELS[selected.contextType]}
                </StatusTag>
              </Detail>
              <Detail label="Coverage">{coverageLabel(selected)}</Detail>
              <Detail label="Recorded">
                {instantLabel(selected.recordedAt)} ·{' '}
                {selected.recordedBy.legalName ?? 'Records custodian'}
              </Detail>
              <Detail label="Reason" wide>
                {selected.reason}
              </Detail>
              <Detail label="Linked source or evidence" wide>
                {basisLabel(selected)}
              </Detail>
            </dl>
          )}
        </Panel>
      ) : null}

      {view === 'kanban' ? (
        <Panel title="Attendance Context board" flush>
          {filterBar}
          <div className="grid gap-3 p-4 min-[921px]:grid-cols-4">
            {CONTEXT_TYPES.map((type) => {
              const column = filtered.filter((record) => record.contextType === type);
              return (
                <section
                  aria-labelledby={`attendance-context-kanban-${type}`}
                  className="grid content-start gap-2 rounded-panel border border-border bg-canvas p-3"
                  key={type}
                >
                  <h3
                    className="m-0 flex items-center justify-between gap-2 text-caption font-[650] text-ink"
                    id={`attendance-context-kanban-${type}`}
                  >
                    {CONTEXT_TYPE_LABELS[type]}
                    <span className="text-ink-muted">{column.length}</span>
                  </h3>
                  {column.length === 0 ? (
                    <p className="m-0 px-1 py-3 text-caption text-ink-muted">No records.</p>
                  ) : (
                    column.map((record) => (
                      <button
                        aria-current={record.id === recordId ? 'true' : undefined}
                        className="grid cursor-pointer gap-1 rounded-control border border-border bg-surface px-3 py-2.5 text-left hover:border-primary aria-[current=true]:border-primary aria-[current=true]:shadow-[inset_3px_0_0_var(--color-primary)]"
                        key={record.id}
                        onClick={() => openRecord(record.id)}
                        type="button"
                      >
                        <strong className="text-small font-[650] text-ink">
                          {record.employee.legalName}
                        </strong>
                        <span className="text-caption text-ink-muted">{coverageLabel(record)}</span>
                        <span className="text-caption text-ink">{record.reason}</span>
                      </button>
                    ))
                  )}
                </section>
              );
            })}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
