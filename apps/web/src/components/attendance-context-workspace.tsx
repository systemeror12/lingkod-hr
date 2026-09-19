'use client';

import { Field, inputClass, FormError } from './ui/field';
import { useRecordNavigation } from './record-navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from './ui/button';

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

const TONE_RESOLVED = 'bg-[#e8f3ed] text-[#316647]';
const TONE_ATTENTION = 'bg-[#fff3d6] text-[#79531c]';
const TONE_NEUTRAL = 'bg-[#f0f2f5] text-muted';

function typeClass(type: AttendanceContextType): string {
  if (type === 'APPROVED_ABSENCE') return TONE_ATTENTION;
  if (type === 'OFFICIAL_TRAVEL') return TONE_NEUTRAL;
  return TONE_RESOLVED;
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

function eventValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function toInstant(value: string): string {
  const date = new Date(value);
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

  useEffect(() => {
    let active = true;
    setError('');
    void request('/attendance-contexts')
      .then((value) => {
        if (active) setRecords((value as AttendanceContextListResponse).contexts);
      })
      .catch((failure: unknown) => {
        if (active)
          setError(
            failure instanceof Error ? failure.message : 'The Attendance Context register failed.',
          );
      });
    return () => {
      active = false;
    };
  }, []);

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
    if (optionsRequested.current) return;
    optionsRequested.current = true;
    void request('/employees')
      .then((value) => {
        setEmployeeOptions((value as { employees: EmployeeOption[] }).employees);
      })
      .catch((failure: unknown) => {
        optionsRequested.current = false;
        setError(failure instanceof Error ? failure.message : 'Loading employees failed.');
      });
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
              startsAt: toInstant(startsAt),
              endsAt: toInstant(endsAt),
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
      await refresh();
      setSuccess('Attendance Context recorded. History keeps the original record.');
      setEmployeeId('');
      setWorkDate('');
      setStartsAt('');
      setEndsAt('');
      setReason('');
      setSourceType('');
      setSourceId('');
      setEvidenceDocumentVersionId('');
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
  const selected = recordId ? (records.find(({ id }) => id === recordId) ?? null) : null;

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="m-0 text-[22px] font-[680] text-midnight">Attendance Contexts</h1>
          <p className="m-0 max-w-[720px] text-sm leading-[1.6] text-muted">
            Official business, official travel, training, and approved absence coverage recorded
            against one Employee. Records are append-only factual inputs; calculation and
            corrections stay in their own workflows.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            aria-label="Record view"
            className="flex items-center gap-1 rounded-[3px] border border-line bg-paper p-1"
          >
            <button
              aria-pressed={view === 'tree'}
              className={`rounded-[2px] px-3 py-1.5 text-xs font-[650] ${view === 'tree' ? 'bg-canvas text-ink' : 'text-muted'}`}
              onClick={() => navigation.navigate({ view: 'tree', new: null })}
              type="button"
            >
              Tree
            </button>
            <button
              aria-pressed={view === 'form'}
              className={`rounded-[2px] px-3 py-1.5 text-xs font-[650] ${view === 'form' ? 'bg-canvas text-ink' : 'text-muted'}`}
              onClick={() =>
                navigation.navigate({ view: 'form', new: creating ? 'context' : null })
              }
              type="button"
            >
              Form
            </button>
            <button
              aria-pressed={view === 'kanban'}
              className={`rounded-[2px] px-3 py-1.5 text-xs font-[650] ${view === 'kanban' ? 'bg-canvas text-ink' : 'text-muted'}`}
              onClick={() => navigation.navigate({ view: 'kanban', new: null })}
              type="button"
            >
              Kanban
            </button>
          </div>
          {canCreate ? (
            <Button className="min-h-10" onClick={openCreate} type="button" variant="primary">
              Record attendance context
            </Button>
          ) : null}
        </div>
      </header>

      {error ? <FormError message={error} /> : null}

      {view === 'tree' ? (
        <section
          aria-labelledby="attendance-context-register-heading"
          className="overflow-hidden rounded-[5px] border border-line bg-paper"
        >
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div className="grid gap-1">
              <h2
                className="m-0 text-sm font-[670] text-midnight"
                id="attendance-context-register-heading"
              >
                Attendance Context register
              </h2>
              <span className="text-xs text-muted">
                {filtered.length === 1 ? '1 context' : filtered.length + ' contexts'} · Agency
                scoped
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-muted">
                Search
                <input
                  className="min-h-9 rounded-[3px] border border-line bg-paper px-2 text-xs text-ink"
                  onChange={(event) => setQuery(eventValue(event))}
                  placeholder="Employee or reason"
                  type="search"
                  value={query}
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted">
                Context
                <select
                  className="min-h-9 rounded-[3px] border border-line bg-paper px-2 text-xs text-ink"
                  onChange={(event) =>
                    setTypeFilter(eventValue(event) as 'ALL' | AttendanceContextType)
                  }
                  value={typeFilter}
                >
                  <option value="ALL">All types</option>
                  {CONTEXT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {CONTEXT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </header>
          {filtered.length === 0 ? (
            <div className="grid min-h-[220px] place-content-center gap-2 px-6 py-12 text-center">
              <strong className="text-[15px] font-[650] text-midnight">
                {records.length === 0 ? 'No Attendance Contexts yet.' : 'No contexts match.'}
              </strong>
              <p className="m-0 max-w-[560px] text-[13px] leading-[1.6] text-muted">
                {records.length === 0
                  ? 'Record approved official business, travel, training, or absence coverage against an Employee.'
                  : 'Clear the search or choose another context type.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead className="bg-canvas text-[11px] tracking-[0.07em] text-muted uppercase">
                  <tr>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Coverage
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Employee
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Context
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Reason and basis
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Recorded
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filtered.map((record) => (
                    <tr key={record.id}>
                      <td className="px-5 py-4 align-top text-xs text-ink">
                        <div className="grid gap-1">
                          <button
                            className="w-fit cursor-pointer text-left font-[650] text-cobalt underline-offset-2 hover:underline"
                            onClick={() => openRecord(record.id)}
                            type="button"
                          >
                            {coverageLabel(record)}
                          </button>
                          <span className="text-muted">
                            {record.coverageMode === 'WHOLE_WORK_DATE'
                              ? 'Whole work date'
                              : 'Exact time range'}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-ink">
                        <div className="grid gap-1">
                          <span className="font-[650]">{record.employee.legalName}</span>
                          <span className="text-muted">{record.employee.employeeNumber}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <span
                          className={
                            'inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.07em] uppercase ' +
                            typeClass(record.contextType)
                          }
                        >
                          {CONTEXT_TYPE_LABELS[record.contextType]}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-ink">
                        <div className="grid max-w-[320px] gap-1">
                          <span>{record.reason}</span>
                          <span className="text-muted">{basisLabel(record)}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-muted">
                        <div className="grid gap-1">
                          <span>{instantLabel(record.recordedAt)}</span>
                          <span>{record.recordedBy.legalName ?? 'Records custodian'}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {view === 'form' ? (
        <section
          aria-labelledby="attendance-context-form-heading"
          className="overflow-hidden rounded-[5px] border border-line bg-paper"
        >
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div className="grid gap-1">
              <h2
                className="m-0 text-sm font-[670] text-midnight"
                id="attendance-context-form-heading"
              >
                {creating ? 'Record Attendance Context' : 'Attendance Context record'}
              </h2>
              <span className="text-xs text-muted">
                {creating
                  ? 'One immutable fact with its reason, basis, recorder, and recorded time.'
                  : 'Append-only history; correct coverage by recording a new context.'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {!creating && selected && canCreate ? (
                <Button className="min-h-9" onClick={openCreate} type="button" variant="secondary">
                  Record another context
                </Button>
              ) : null}
              <Button
                className="min-h-9"
                onClick={() => navigation.navigate({ view: 'tree', record: null, new: null })}
                type="button"
                variant="secondary"
              >
                Back to register
              </Button>
            </div>
          </header>
          {success ? (
            <p
              className="m-0 border-b border-[#b9d8c3] bg-[#f2faf4] px-5 py-3 text-sm text-[#316647]"
              role="status"
            >
              {success}
            </p>
          ) : null}
          {!creating && recordId && !selected ? (
            <p className="m-0 px-5 py-6 text-sm text-muted">
              That Attendance Context is not in the current register. Return to the register and
              choose another record.
            </p>
          ) : creating || !selected ? (
            canCreate ? (
              <form className="grid gap-5 px-5 py-6" onSubmit={recordContext}>
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
                <fieldset className="grid gap-3 border-0 p-0">
                  <legend className="p-0 text-xs font-[650] text-ink">Coverage</legend>
                  <div className="flex flex-wrap gap-4 text-sm text-ink">
                    <label className="flex items-center gap-2">
                      <input
                        checked={coverageMode === 'WHOLE_WORK_DATE'}
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
                      <Field htmlFor="attendance-context-starts-at" label="Starts (local time)">
                        <input
                          className={inputClass}
                          id="attendance-context-starts-at"
                          onChange={(event) => setStartsAt(eventValue(event))}
                          required
                          type="datetime-local"
                          value={startsAt}
                        />
                      </Field>
                      <Field htmlFor="attendance-context-ends-at" label="Ends (local time)">
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
                  <Button className="min-h-10" disabled={busy} type="submit" variant="primary">
                    {busy ? 'Recording…' : 'Record Attendance Context'}
                  </Button>
                </div>
              </form>
            ) : (
              <p className="m-0 px-5 py-6 text-sm text-muted">
                Your active Agency Membership does not permit recording Attendance Contexts.
              </p>
            )
          ) : (
            <dl className="m-0 grid gap-4 px-5 py-6 text-sm min-[721px]:grid-cols-2">
              <div className="grid gap-1">
                <dt className="text-[11px] font-bold tracking-[0.07em] text-muted uppercase">
                  Employee
                </dt>
                <dd className="m-0 text-ink">
                  {selected.employee.legalName} · {selected.employee.employeeNumber}
                </dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-[11px] font-bold tracking-[0.07em] text-muted uppercase">
                  Context type
                </dt>
                <dd className="m-0 text-ink">{CONTEXT_TYPE_LABELS[selected.contextType]}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-[11px] font-bold tracking-[0.07em] text-muted uppercase">
                  Coverage
                </dt>
                <dd className="m-0 text-ink">{coverageLabel(selected)}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-[11px] font-bold tracking-[0.07em] text-muted uppercase">
                  Recorded
                </dt>
                <dd className="m-0 text-ink">
                  {instantLabel(selected.recordedAt)} ·{' '}
                  {selected.recordedBy.legalName ?? 'Records custodian'}
                </dd>
              </div>
              <div className="grid gap-1 min-[721px]:col-span-2">
                <dt className="text-[11px] font-bold tracking-[0.07em] text-muted uppercase">
                  Reason
                </dt>
                <dd className="m-0 text-ink">{selected.reason}</dd>
              </div>
              <div className="grid gap-1 min-[721px]:col-span-2">
                <dt className="text-[11px] font-bold tracking-[0.07em] text-muted uppercase">
                  Linked source or evidence
                </dt>
                <dd className="m-0 text-ink">{basisLabel(selected)}</dd>
              </div>
            </dl>
          )}
        </section>
      ) : null}

      {view === 'kanban' ? (
        <section aria-label="Attendance Context Kanban" className="grid gap-4">
          <div className="grid gap-4 min-[921px]:grid-cols-4">
            {CONTEXT_TYPES.map((type) => {
              const column = filtered.filter((record) => record.contextType === type);
              return (
                <section
                  className="grid content-start gap-3 rounded-[5px] border border-line bg-paper p-3"
                  key={type}
                >
                  <header className="flex items-center justify-between gap-2 px-1">
                    <h3 className="m-0 text-xs font-[670] tracking-[0.05em] text-midnight uppercase">
                      {CONTEXT_TYPE_LABELS[type]}
                    </h3>
                    <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-[650] text-muted">
                      {column.length}
                    </span>
                  </header>
                  {column.length === 0 ? (
                    <p className="m-0 px-1 py-4 text-xs text-muted">No records.</p>
                  ) : (
                    column.map((record) => (
                      <button
                        className="grid cursor-pointer gap-2 rounded-[4px] border border-line bg-canvas px-3 py-3 text-left hover:border-cobalt"
                        key={record.id}
                        onClick={() => openRecord(record.id)}
                        type="button"
                      >
                        <span className="text-xs font-[650] text-midnight">
                          {record.employee.legalName}
                        </span>
                        <span className="text-[11px] text-muted">{coverageLabel(record)}</span>
                        <span className="text-[11px] leading-[1.5] text-ink">{record.reason}</span>
                      </button>
                    ))
                  )}
                </section>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
