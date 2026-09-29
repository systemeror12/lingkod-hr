'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { manilaToday } from '../lib/manila-date';
import { StateSurface } from './state-surface';
import { Button } from './ui/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Field, FormError, inputClass } from './ui/field';
import { PageHeader } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag, type StatusTone } from './ui/status-tag';
import { RowHeader, Table, Td, Th, Tr } from './ui/table';

export type AttendanceEventType = 'TIME_IN' | 'BREAK_OUT' | 'BREAK_IN' | 'TIME_OUT';
export type AttendanceEventSource = 'WEB_CLOCK' | 'MANUAL';
export type DtrPresentationSlot = 'AM_IN' | 'AM_OUT' | 'PM_IN' | 'PM_OUT';

export interface AttendanceEventPresentation {
  workDate: string;
  slot: DtrPresentationSlot | null;
  label: string;
}

export interface AttendanceEventEmployee {
  id: string;
  employeeNumber: string;
  legalName: string;
}

export interface AttendanceEvent {
  id: string;
  employeeId: string;
  employee: AttendanceEventEmployee;
  eventTime: string;
  eventType: AttendanceEventType;
  source: AttendanceEventSource;
  sourceReference: string | null;
  enteredByMembershipId: string | null;
  reason: string | null;
  createdAt: string;
  presentation: AttendanceEventPresentation | null;
}

export interface AttendanceEventListResponse {
  events: AttendanceEvent[];
}

export interface AttendanceDayRule {
  weekday: number;
  ruleType: string;
  dutyStartTime: string | null;
  earliestStartTime: string | null;
  latestStartTime: string | null;
  dutyEndTime: string | null;
  endNextCalendarDay: boolean;
  eventPattern: string;
  collectionBeforeMinutes: number;
  collectionAfterMinutes: number;
  breakCount: number;
}

export interface AttendanceAssociation {
  workDate: string;
  scheduleAssignmentId: string;
  workScheduleVersionId: string;
  workScheduleVersionNo: number;
  workScheduleCode: string;
  workScheduleName: string;
  scheduleType: string;
  timezone: string;
  workArrangementVersionId: string;
  workArrangementVersionNo: number;
  workArrangementCode: string;
  workArrangementName: string;
  arrangementType: string;
  holidayCalendarId: string;
  holidayCalendarVersionId: string;
  holidayEntries: Array<{ name: string; dayType: string; holidayDate: string }>;
  dayRule: AttendanceDayRule;
}

export interface AttendanceCaptureException {
  type: string;
  message: string;
  details: Record<string, unknown>;
}

export interface AttendanceCaptureResult {
  event: AttendanceEvent;
  match: {
    status: 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS';
    workDate: string | null;
    unscheduled: boolean;
    association: AttendanceAssociation | null;
    matches: Array<{ workDate: string }>;
  };
  exceptions: AttendanceCaptureException[];
  presentation: AttendanceEventPresentation | null;
}

export interface AttendanceWorkDateContext {
  workDate: string;
  association: AttendanceAssociation | null;
  exceptions: AttendanceCaptureException[];
  events: AttendanceEvent[];
}

export interface AttendanceWebClockVersion {
  id: string;
  versionNo: number;
  enabled: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'ACTIVE' | 'SUPERSEDED';
  reason: string;
  activatedByMembershipId: string;
  activatedAt: string;
  createdAt: string;
}

export interface AttendanceWebClockStatus {
  asOf: string;
  enabled: boolean;
  version: AttendanceWebClockVersion | null;
  history: AttendanceWebClockVersion[];
}

export interface AttendanceClockState {
  asOf: string;
  enabled: boolean;
  employee: AttendanceEventEmployee;
  nextEventType: AttendanceEventType | null;
  association: AttendanceAssociation | null;
  exceptions: AttendanceCaptureException[];
  events: AttendanceEvent[];
}

interface EmployeeOption {
  id: string;
  employeeNumber: string;
  legalName: string;
}

type DialogKind = 'enable' | 'disable' | null;

const EVENT_TYPES: readonly AttendanceEventType[] = [
  'TIME_IN',
  'BREAK_OUT',
  'BREAK_IN',
  'TIME_OUT',
];

const EVENT_TYPE_LABELS: Record<AttendanceEventType, string> = {
  TIME_IN: 'Time in',
  BREAK_OUT: 'Break out',
  BREAK_IN: 'Break in',
  TIME_OUT: 'Time out',
};

const NEXT_ACTION_LABELS: Record<AttendanceEventType, string> = {
  TIME_IN: 'Clock in',
  BREAK_OUT: 'Break out',
  BREAK_IN: 'Break in',
  TIME_OUT: 'Clock out',
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MATCH_TONES: Record<AttendanceCaptureResult['match']['status'], StatusTone> = {
  MATCHED: 'success',
  AMBIGUOUS: 'warning',
  UNMATCHED: 'neutral',
};

const VERSION_STATUS: Record<AttendanceWebClockVersion['status'], [string, StatusTone]> = {
  ACTIVE: ['Active', 'success'],
  SUPERSEDED: ['Superseded', 'neutral'],
};

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const error = (value as { error?: { message?: unknown; reasons?: unknown } }).error;
  const message = typeof error?.message === 'string' ? error.message : fallback;
  if (Array.isArray(error?.reasons) && error.reasons.length > 0) {
    return `${message} (${error.reasons.join(', ')})`;
  }
  return message;
}

function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
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

function timeValue(value: string | null): string {
  if (!value) return '';
  return value.includes('T') ? value.slice(11, 16) : value.slice(0, 5);
}

function dayRuleLabel(association: AttendanceAssociation): string {
  const weekday = WEEKDAYS[association.dayRule.weekday % 7] ?? '';
  if (association.dayRule.ruleType === 'REST') return `${weekday} · Rest · No duty`;
  const start = timeValue(
    association.dayRule.dutyStartTime ?? association.dayRule.earliestStartTime,
  );
  const end = timeValue(association.dayRule.dutyEndTime);
  const mode = association.dayRule.ruleType === 'FIXED' ? 'Fixed' : 'Flexible';
  return `${weekday} · ${mode} · ${start}–${end}`;
}

function associationLabel(association: AttendanceAssociation): string {
  return `${association.workScheduleCode} v${association.workScheduleVersionNo} · ${association.workArrangementCode} v${association.workArrangementVersionNo}`;
}

function matchStatusLabel(status: AttendanceCaptureResult['match']['status']): string {
  if (status === 'MATCHED') return 'Matched';
  if (status === 'AMBIGUOUS') return 'Ambiguous';
  return 'Unmatched';
}

function eventTimeValue(dateValue: string, timeOfDay: string): string {
  return `${dateValue}T${timeOfDay}:00+08:00`;
}

function addDays(value: string, days: number): string {
  const date = new Date(value + 'T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function laterDate(left: string, right: string): string {
  return left > right ? left : right;
}

function clipboardIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

function EmployeeSelect({
  id,
  label,
  value,
  onChange,
  employees,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  employees: EmployeeOption[];
  required?: boolean;
}) {
  return (
    <Field htmlFor={id} label={label}>
      <select
        className={inputClass}
        id={id}
        onChange={(event) => onChange(targetValue(event))}
        required={required}
        value={value}
      >
        <option value="">Select an Employee</option>
        {employees.map((employee) => (
          <option key={employee.id} value={employee.id}>
            {employee.employeeNumber} · {employee.legalName}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ExceptionList({ exceptions }: { exceptions: AttendanceCaptureException[] }) {
  return exceptions.length > 0 ? (
    <ul className="m-0 grid list-none gap-1 p-0 text-small text-warning">
      {exceptions.map((exception) => (
        <li key={exception.type + exception.message}>{exception.message}</li>
      ))}
    </ul>
  ) : (
    <p className="m-0 text-small text-success">No blocking Attendance Exceptions.</p>
  );
}

function CaptureSummary({ result }: { result: AttendanceCaptureResult }) {
  const { event, match, presentation, exceptions } = result;
  return (
    <div className="grid gap-2 border-t border-border bg-canvas px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-muted">
        <StatusTag tone={MATCH_TONES[match.status]}>{matchStatusLabel(match.status)}</StatusTag>
        <span className="font-[600] text-ink">
          {eventTypeLabelOf(event.eventType)} · {instantLabel(event.eventTime)}
        </span>
        <span className="font-mono text-caption">{event.employee.employeeNumber}</span>
        {match.workDate ? <span>Work date {dateLabel(match.workDate)}</span> : null}
        {match.unscheduled ? <span>Unscheduled service</span> : null}
        {presentation ? <span>{presentation.label}</span> : null}
      </div>
      {match.association ? (
        <p className="m-0 text-small text-ink-muted">
          {associationLabel(match.association)} · {dayRuleLabel(match.association)}
          {match.association.holidayEntries.map((entry) => ` · ${entry.name}`).join('')}
        </p>
      ) : match.matches.length > 0 ? (
        <p className="m-0 text-small text-ink-muted">
          Candidate Work Dates: {match.matches.map(({ workDate }) => workDate).join(', ')}
        </p>
      ) : null}
      <ExceptionList exceptions={exceptions} />
    </div>
  );
}

function eventTypeLabelOf(eventType: AttendanceEventType): string {
  return EVENT_TYPE_LABELS[eventType];
}

function EventRows({ label, events }: { label: string; events: AttendanceEvent[] }) {
  if (events.length === 0) {
    return (
      <StateSurface compact label={label}>
        <p className="m-0">No Attendance Events recorded.</p>
      </StateSurface>
    );
  }
  return (
    <Table aria-label={label} className="min-w-[640px]">
      <thead>
        <tr>
          <Th kind="date">Time</Th>
          <Th>Event</Th>
          <Th>DTR slot</Th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <Tr key={event.id}>
            <Td kind="date">{instantLabel(event.eventTime)}</Td>
            <Td>{eventTypeLabelOf(event.eventType)}</Td>
            <Td className="text-ink-muted">
              {event.presentation ? event.presentation.label : 'Not presented'}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

export function AttendanceWorkspace({
  agencyId,
  canClock,
  canConfigure,
  canCreateManual,
  canReadEvents,
  initialEvents,
  initialWebClock,
}: {
  agencyId: string;
  canClock: boolean;
  canConfigure: boolean;
  canCreateManual: boolean;
  canReadEvents: boolean;
  initialEvents: AttendanceEventListResponse | null;
  initialWebClock: AttendanceWebClockStatus | null;
}) {
  const [events, setEvents] = useState(initialEvents?.events ?? []);
  const [webClock, setWebClock] = useState(initialWebClock);
  const [webClockLoading, setWebClockLoading] = useState(canConfigure && !initialWebClock);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(manilaToday());
  const [webClockReason, setWebClockReason] = useState('');
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeError, setEmployeeError] = useState('');
  const [clock, setClock] = useState<AttendanceClockState | null>(null);
  const [clockError, setClockError] = useState('');
  const [clockLoading, setClockLoading] = useState(canClock);
  const [clockResult, setClockResult] = useState<AttendanceCaptureResult | null>(null);
  const [manualEmployeeId, setManualEmployeeId] = useState('');
  const [manualEventType, setManualEventType] = useState<AttendanceEventType>('TIME_IN');
  const [manualDate, setManualDate] = useState(manilaToday());
  const [manualTime, setManualTime] = useState('08:00');
  const [manualReason, setManualReason] = useState('');
  const [manualResult, setManualResult] = useState<AttendanceCaptureResult | null>(null);
  const [manualError, setManualError] = useState('');
  const [filterEmployeeId, setFilterEmployeeId] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [contextEmployeeId, setContextEmployeeId] = useState('');
  const [contextDate, setContextDate] = useState(manilaToday());
  const [context, setContext] = useState<AttendanceWorkDateContext | null>(null);
  const [contextError, setContextError] = useState('');
  const [contextBusy, setContextBusy] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');

  const headVersion = webClock?.history.find(({ status }) => status === 'ACTIVE') ?? null;
  const headEnabled = headVersion?.enabled ?? false;
  const earliestChange = headVersion
    ? laterDate(manilaToday(), addDays(headVersion.effectiveFrom, 1))
    : manilaToday();

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch('/api/v1/agencies/' + agencyId + path, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(errorMessage(value, 'The Attendance action failed.'));
    }
    return value;
  }

  useEffect(() => {
    if (!canConfigure) return;
    let active = true;
    setWebClockLoading(true);
    void request('/attendance/web-clock')
      .then((value) => {
        if (active) setWebClock(value as AttendanceWebClockStatus);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'The Web clock failed.');
      })
      .finally(() => {
        if (active) setWebClockLoading(false);
      });
    return () => {
      active = false;
    };
  }, [agencyId, canConfigure]);

  useEffect(() => {
    if (!canClock) return;
    let active = true;
    setClockLoading(true);
    void request('/attendance/clock')
      .then((value) => {
        if (active) setClock(value as AttendanceClockState);
      })
      .catch((reason: unknown) => {
        if (active) {
          setClockError(reason instanceof Error ? reason.message : 'The Web clock is unavailable.');
        }
      })
      .finally(() => {
        if (active) setClockLoading(false);
      });
    return () => {
      active = false;
    };
  }, [agencyId, canClock]);

  useEffect(() => {
    if (!canCreateManual && !canReadEvents) return;
    let active = true;
    void request('/employees')
      .then((value) => {
        if (!active) return;
        const list = (value as { employees: EmployeeOption[] }).employees;
        setEmployees(list);
        setManualEmployeeId((current) => current || (list[0]?.id ?? ''));
      })
      .catch((reason: unknown) => {
        if (active) {
          setEmployeeError(
            reason instanceof Error ? reason.message : 'Employee options are unavailable.',
          );
        }
      });
    return () => {
      active = false;
    };
  }, [agencyId, canCreateManual, canReadEvents]);

  async function refreshEvents(query = ''): Promise<void> {
    const list = (await request('/attendance/events' + query)) as AttendanceEventListResponse;
    setEvents(list.events);
  }

  async function refreshWebClock(): Promise<void> {
    const status = (await request('/attendance/web-clock')) as AttendanceWebClockStatus;
    setWebClock(status);
  }

  async function refreshClock(): Promise<void> {
    const state = (await request('/attendance/clock')) as AttendanceClockState;
    setClock(state);
    setClockError('');
  }

  function openWebClockDialog(kind: DialogKind): void {
    setError('');
    setSuccess('');
    setEffectiveFrom(earliestChange);
    setWebClockReason('');
    setDialog(kind);
  }

  async function submitWebClock(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (dialog === null) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await request('/attendance/web-clock/versions', {
        method: 'POST',
        headers: { 'Idempotency-Key': clipboardIdempotencyKey() },
        body: JSON.stringify({
          enabled: dialog === 'enable',
          effectiveFrom,
          reason: webClockReason.trim(),
        }),
      });
      await refreshWebClock();
      if (canClock) await refreshClock().catch(() => undefined);
      setSuccess(
        dialog === 'enable'
          ? 'The Agency Web clock was enabled for the effective date.'
          : 'The Agency Web clock was disabled for the effective date.',
      );
      setDialog(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The Web clock change failed.');
    } finally {
      setBusy(false);
    }
  }

  async function submitClock(): Promise<void> {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = (await request('/attendance/clock', {
        method: 'POST',
        headers: { 'Idempotency-Key': clipboardIdempotencyKey() },
        body: JSON.stringify({}),
      })) as AttendanceCaptureResult;
      setClockResult(result);
      setSuccess(
        `${eventTypeLabelOf(result.event.eventType)} recorded at ${instantLabel(result.event.eventTime)}.`,
      );
      await Promise.all([refreshClock(), ...(canReadEvents ? [refreshEvents()] : [])]);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The Web clock action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function submitManual(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setManualError('');
    setManualResult(null);
    try {
      const result = (await request('/attendance/events', {
        method: 'POST',
        headers: { 'Idempotency-Key': clipboardIdempotencyKey() },
        body: JSON.stringify({
          employeeId: manualEmployeeId,
          eventType: manualEventType,
          eventTime: eventTimeValue(manualDate, manualTime),
          reason: manualReason.trim(),
        }),
      })) as AttendanceCaptureResult;
      setManualResult(result);
      setManualReason('');
      setEvents((current) => [result.event, ...current.filter(({ id }) => id !== result.event.id)]);
    } catch (reason: unknown) {
      setManualError(reason instanceof Error ? reason.message : 'The manual entry failed.');
    } finally {
      setBusy(false);
    }
  }

  async function applyFilters(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const query = new URLSearchParams();
      if (filterEmployeeId) query.set('employeeId', filterEmployeeId);
      if (filterFrom) query.set('from', filterFrom);
      if (filterTo) query.set('to', filterTo);
      await refreshEvents(query.size > 0 ? `?${query.toString()}` : '');
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The filter could not be applied.');
    } finally {
      setBusy(false);
    }
  }

  async function inspectWorkDate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setContextBusy(true);
    setContextError('');
    setContext(null);
    try {
      const value = (await request(
        '/attendance/events/context?employeeId=' +
          encodeURIComponent(contextEmployeeId) +
          '&workDate=' +
          encodeURIComponent(contextDate),
      )) as AttendanceWorkDateContext;
      setContext(value);
    } catch (reason: unknown) {
      setContextError(reason instanceof Error ? reason.message : 'The Work Date is unavailable.');
    } finally {
      setContextBusy(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-5">
      <PageHeader breadcrumbs={[{ label: 'Time & attendance' }]} title="Attendance" />
      <p className="m-0 max-w-[760px] text-small text-ink-muted">
        Web clocking and authorized manual capture store immutable Attendance Events. Matching, DTR
        presentation slots, and blocking Attendance Exceptions are derived, never stored on the raw
        event.
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

      {canConfigure ? (
        <Panel
          title="Web clock enablement"
          flush
          actions={
            <>
              {webClock?.version ? (
                <span className="text-caption text-ink-muted">
                  Version {webClock.version.versionNo} effective{' '}
                  {dateLabel(webClock.version.effectiveFrom)}
                </span>
              ) : null}
              <StatusTag
                tone={webClock?.history.length && webClock.enabled ? 'success' : 'neutral'}
              >
                {webClock?.history.length
                  ? webClock.enabled
                    ? 'Enabled'
                    : 'Disabled'
                  : 'Disabled by default'}
              </StatusTag>
              <Button
                onClick={() => openWebClockDialog(headEnabled ? 'disable' : 'enable')}
                type="button"
                variant="secondary"
              >
                {headEnabled ? 'Disable Web clock' : 'Enable Web clock'}
              </Button>
            </>
          }
        >
          {webClockLoading ? (
            <StateSurface busy compact label="Web clock versions">
              <p className="m-0" role="status">
                Loading the Web clock…
              </p>
            </StateSurface>
          ) : webClock ? (
            webClock.history.length === 0 ? (
              <StateSurface compact label="Web clock versions">
                <p className="m-0">
                  No Web clock version exists, so every clock attempt fails closed.
                </p>
              </StateSurface>
            ) : (
              <Table aria-label="Web clock versions" className="min-w-[720px]">
                <thead>
                  <tr>
                    <Th>Version</Th>
                    <Th>Setting</Th>
                    <Th>Status</Th>
                    <Th>Effective</Th>
                    <Th>Reason</Th>
                  </tr>
                </thead>
                <tbody>
                  {webClock.history.map((version) => {
                    const [statusLabel, statusTone] = VERSION_STATUS[version.status];
                    return (
                      <Tr key={version.id}>
                        <RowHeader>v{version.versionNo}</RowHeader>
                        <Td>{version.enabled ? 'Enabled' : 'Disabled'}</Td>
                        <Td>
                          <StatusTag tone={statusTone}>{statusLabel}</StatusTag>
                        </Td>
                        <Td className="text-ink-muted">
                          {dateLabel(version.effectiveFrom)} to{' '}
                          {version.effectiveTo ? dateLabel(version.effectiveTo) : 'open-ended'}
                        </Td>
                        <Td className="text-ink-muted">{version.reason}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )
          ) : null}
        </Panel>
      ) : null}

      {canClock ? (
        <Panel
          title="My Web clock"
          flush
          actions={
            clock?.enabled && clock.nextEventType ? (
              <Button
                disabled={busy}
                onClick={() => void submitClock()}
                type="button"
                variant="primary"
              >
                {NEXT_ACTION_LABELS[clock.nextEventType]}
              </Button>
            ) : null
          }
        >
          <p className="m-0 px-4 pt-3 text-small text-ink-muted">
            {clock?.association
              ? associationLabel(clock.association) + ' · ' + dayRuleLabel(clock.association)
              : 'Server timestamped against the governing Work Date'}
          </p>
          {clockLoading ? (
            <StateSurface busy compact label="My Web clock status">
              <p className="m-0" role="status">
                Loading the Web clock…
              </p>
            </StateSurface>
          ) : clockError ? (
            <div className="p-4">
              <FormError message={clockError} />
            </div>
          ) : clock ? (
            <>
              <div className="grid gap-1 px-4 py-3 text-small text-ink-muted">
                {!clock.enabled ? (
                  <p className="m-0">Web clock is disabled by the Agency.</p>
                ) : clock.nextEventType === null ? (
                  <>
                    <p className="m-0">
                      {clock.association
                        ? 'The current Work Date already holds a complete Attendance Event sequence.'
                        : 'No Work Date is effective for the Web clock right now.'}
                    </p>
                    {clock.exceptions.map((exception) => (
                      <p className="m-0 text-warning" key={exception.type}>
                        {exception.message}
                      </p>
                    ))}
                  </>
                ) : (
                  <p className="m-0">
                    Next expected event: {eventTypeLabelOf(clock.nextEventType)}
                  </p>
                )}
              </div>
              <EventRows events={clock.events} label="My Attendance Events" />
            </>
          ) : null}
          {clockResult ? <CaptureSummary result={clockResult} /> : null}
        </Panel>
      ) : null}

      {canCreateManual ? (
        <Panel title="Record manual Attendance Event" flush>
          <form className="grid gap-4 p-4" onSubmit={(event) => void submitManual(event)}>
            <p className="m-0 text-small text-ink-muted">
              Every manual entry keeps its actor, timestamp, and required reason.
            </p>
            <FormError message={employeeError} />
            <div className="grid gap-4 min-[621px]:grid-cols-2">
              <EmployeeSelect
                employees={employees}
                id="manual-employee"
                label="Employee"
                onChange={setManualEmployeeId}
                required
                value={manualEmployeeId}
              />
              <Field htmlFor="manual-event-type" label="Event type">
                <select
                  className={inputClass}
                  id="manual-event-type"
                  onChange={(event) =>
                    setManualEventType(targetValue(event) as AttendanceEventType)
                  }
                  value={manualEventType}
                >
                  {EVENT_TYPES.map((eventType) => (
                    <option key={eventType} value={eventType}>
                      {eventTypeLabelOf(eventType)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid gap-4 min-[621px]:grid-cols-2">
              <Field htmlFor="manual-date" label="Event date">
                <input
                  className={inputClass}
                  id="manual-date"
                  onChange={(event) => setManualDate(targetValue(event))}
                  required
                  type="date"
                  value={manualDate}
                />
              </Field>
              <Field htmlFor="manual-time" label="Event time">
                <input
                  className={inputClass}
                  id="manual-time"
                  onChange={(event) => setManualTime(targetValue(event))}
                  required
                  type="time"
                  value={manualTime}
                />
              </Field>
            </div>
            <Field htmlFor="manual-reason" label="Reason">
              <input
                className={inputClass}
                id="manual-reason"
                maxLength={500}
                onChange={(event) => setManualReason(targetValue(event))}
                required
                value={manualReason}
              />
            </Field>
            <FormError message={manualError} />
            <div className="flex justify-end">
              <Button disabled={busy || employees.length === 0} type="submit" variant="primary">
                Record Event
              </Button>
            </div>
          </form>
          {manualResult ? <CaptureSummary result={manualResult} /> : null}
        </Panel>
      ) : null}

      {canReadEvents ? (
        <>
          <Panel
            title="Attendance Event register"
            flush
            actions={
              <span className="text-caption text-ink-muted">
                {events.length === 1
                  ? '1 Attendance Event · newest first'
                  : events.length + ' Attendance Events · newest first'}
              </span>
            }
          >
            <form
              className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3"
              onSubmit={(event) => void applyFilters(event)}
            >
              {employeeError ? (
                <p className="m-0 text-small text-ink-muted">{employeeError}</p>
              ) : (
                <EmployeeSelect
                  employees={employees}
                  id="filter-employee"
                  label="Employee"
                  onChange={setFilterEmployeeId}
                  value={filterEmployeeId}
                />
              )}
              <Field htmlFor="filter-from" label="From">
                <input
                  className={inputClass}
                  id="filter-from"
                  onChange={(event) => setFilterFrom(targetValue(event))}
                  type="date"
                  value={filterFrom}
                />
              </Field>
              <Field htmlFor="filter-to" label="To">
                <input
                  className={inputClass}
                  id="filter-to"
                  onChange={(event) => setFilterTo(targetValue(event))}
                  type="date"
                  value={filterTo}
                />
              </Field>
              <Button disabled={busy} type="submit" variant="secondary">
                Apply filters
              </Button>
            </form>
            {events.length === 0 ? (
              <StateSurface compact label="Attendance Events">
                <strong className="font-[650] text-ink">No Attendance Events yet.</strong>
                <p className="m-0">
                  Manual entries and Web clock captures land here as immutable raw events.
                </p>
              </StateSurface>
            ) : (
              <Table aria-label="Attendance Events" className="min-w-[860px]">
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th kind="date">Event time</Th>
                    <Th>Event</Th>
                    <Th>Source</Th>
                    <Th>Reason</Th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <Tr key={event.id}>
                      <RowHeader>
                        {event.employee.legalName}
                        <span className="block font-mono text-caption font-normal text-ink-muted">
                          {event.employee.employeeNumber}
                        </span>
                      </RowHeader>
                      <Td kind="date">{instantLabel(event.eventTime)}</Td>
                      <Td>{eventTypeLabelOf(event.eventType)}</Td>
                      <Td className="text-ink-muted">
                        {event.source === 'WEB_CLOCK' ? 'Web clock' : 'Manual'}
                      </Td>
                      <Td className="text-ink-muted">{event.reason ?? '—'}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          <Panel title="Work date context" flush>
            <div className="grid gap-4 p-4">
              <p className="m-0 max-w-[760px] text-small text-ink-muted">
                Inspect one Employee and Work Date for its governing Schedule Assignment, DTR
                presentation slots, and Attendance Exceptions.
              </p>
              {employeeError ? (
                <FormError message={employeeError} />
              ) : (
                <form
                  className="flex flex-wrap items-end gap-3"
                  onSubmit={(event) => void inspectWorkDate(event)}
                >
                  <EmployeeSelect
                    employees={employees}
                    id="context-employee"
                    label="Employee"
                    onChange={setContextEmployeeId}
                    required
                    value={contextEmployeeId}
                  />
                  <Field htmlFor="context-date" label="Work date">
                    <input
                      className={inputClass}
                      id="context-date"
                      onChange={(event) => setContextDate(targetValue(event))}
                      required
                      type="date"
                      value={contextDate}
                    />
                  </Field>
                  <Button disabled={contextBusy} type="submit" variant="secondary">
                    Inspect Work Date
                  </Button>
                </form>
              )}
              <FormError message={contextError} />
            </div>
            {context ? (
              <div className="grid gap-3 border-t border-border py-3">
                <p className="m-0 px-4 text-small text-ink-muted">
                  {context.association
                    ? associationLabel(context.association) +
                      ' · ' +
                      dayRuleLabel(context.association) +
                      context.association.holidayEntries.map((entry) => ' · ' + entry.name).join('')
                    : 'No Schedule Assignment is effective on the Work Date.'}
                </p>
                <EventRows events={context.events} label="Work Date Attendance Events" />
                <div className="px-4">
                  <ExceptionList exceptions={context.exceptions} />
                </div>
              </div>
            ) : null}
          </Panel>
        </>
      ) : null}
      <Dialog
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        open={dialog !== null}
        presentation="form"
      >
        <DialogContent aria-describedby="web-clock-dialog-description">
          <DialogHeader>
            <div className="grid gap-1">
              <DialogTitle>
                {dialog === 'enable' ? 'Enable Web Clock' : 'Disable Web Clock'}
              </DialogTitle>
              <DialogDescription id="web-clock-dialog-description">
                {dialog === 'enable'
                  ? 'Enable the Agency Web clock from an effective date. Each activation supersedes the prior version and is retained.'
                  : 'Disable the Agency Web clock from an effective date. The prior version closes the day before and is retained.'}
              </DialogDescription>
            </div>
          </DialogHeader>
          <form onSubmit={(event) => void submitWebClock(event)}>
            <DialogBody className="grid gap-5">
              <Field htmlFor="web-clock-effective" label="Effective from">
                <input
                  autoFocus
                  className={inputClass}
                  data-autofocus=""
                  id="web-clock-effective"
                  min={earliestChange}
                  onChange={(event) => setEffectiveFrom(targetValue(event))}
                  required
                  type="date"
                  value={effectiveFrom}
                />
              </Field>
              <Field htmlFor="web-clock-reason" label="Reason">
                <input
                  className={inputClass}
                  id="web-clock-reason"
                  maxLength={500}
                  onChange={(event) => setWebClockReason(targetValue(event))}
                  required
                  value={webClockReason}
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
                {dialog === 'enable' ? 'Enable Web Clock' : 'Disable Web Clock'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
