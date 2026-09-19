'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { manilaToday } from '../lib/manila-date';
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

const TONE_RESOLVED = 'bg-[#e8f3ed] text-[#316647]';
const TONE_ATTENTION = 'bg-[#fff3d6] text-[#79531c]';
const TONE_NEUTRAL = 'bg-[#f0f2f5] text-muted';

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

function matchClass(status: AttendanceCaptureResult['match']['status']): string {
  if (status === 'MATCHED') return TONE_RESOLVED;
  if (status === 'AMBIGUOUS') return TONE_ATTENTION;
  return TONE_NEUTRAL;
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

function CaptureSummary({ result }: { result: AttendanceCaptureResult }) {
  const { event, match, presentation, exceptions } = result;
  return (
    <div className="grid gap-3 border-t border-line bg-canvas px-5 py-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span
          className={
            'inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.07em] uppercase ' +
            matchClass(match.status)
          }
        >
          {matchStatusLabel(match.status)}
        </span>
        <span className="font-[650] text-ink">
          {eventTypeLabelOf(event.eventType)} · {instantLabel(event.eventTime)}
        </span>
        <span>{event.employee.employeeNumber}</span>
        {match.workDate ? <span>Work date {dateLabel(match.workDate)}</span> : null}
        {match.unscheduled ? <span>Unscheduled service</span> : null}
        {presentation ? <span>{presentation.label}</span> : null}
      </div>
      {match.association ? (
        <p className="m-0 text-xs text-muted">
          {associationLabel(match.association)} · {dayRuleLabel(match.association)}
          {match.association.holidayEntries.map((entry) => ` · ${entry.name}`).join('')}
        </p>
      ) : match.matches.length > 0 ? (
        <p className="m-0 text-xs text-muted">
          Candidate Work Dates: {match.matches.map(({ workDate }) => workDate).join(', ')}
        </p>
      ) : null}
      {exceptions.length > 0 ? (
        <ul className="m-0 grid list-none gap-1 p-0 text-xs text-[#79531c]">
          {exceptions.map((exception) => (
            <li key={exception.type + exception.message}>{exception.message}</li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-xs text-[#316647]">No blocking Attendance Exceptions.</p>
      )}
    </div>
  );
}

function eventTypeLabelOf(eventType: AttendanceEventType): string {
  return EVENT_TYPE_LABELS[eventType];
}

function EventRows({ events }: { events: AttendanceEvent[] }) {
  if (events.length === 0) {
    return <p className="m-0 px-5 py-4 text-xs text-muted">No Attendance Events recorded.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead className="bg-canvas text-[11px] tracking-[0.07em] text-muted uppercase">
          <tr>
            <th className="px-5 py-2 font-bold" scope="col">
              Time
            </th>
            <th className="px-5 py-2 font-bold" scope="col">
              Event
            </th>
            <th className="px-5 py-2 font-bold" scope="col">
              DTR slot
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {events.map((event) => (
            <tr key={event.id}>
              <td className="px-5 py-3 align-top text-xs text-ink">
                {instantLabel(event.eventTime)}
              </td>
              <td className="px-5 py-3 align-top text-xs text-muted">
                {eventTypeLabelOf(event.eventType)}
              </td>
              <td className="px-5 py-3 align-top text-xs text-muted">
                {event.presentation ? event.presentation.label : 'Not presented'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
    <div className="min-w-0 space-y-5">
      <header className="grid max-w-[820px] gap-2">
        <p className="m-0 text-[11px] font-bold tracking-[0.09em] text-cobalt uppercase">
          Time and attendance
        </p>
        <h1 className="m-0 text-[clamp(28px,3vw,38px)] leading-[1.08] font-[680] tracking-[-0.035em] text-midnight">
          Attendance
        </h1>
        <p className="m-0 text-sm leading-[1.65] text-muted">
          Web clocking and authorized manual capture store immutable Attendance Events. Matching,
          DTR presentation slots, and blocking Attendance Exceptions are derived, never stored on
          the raw event.
        </p>
      </header>

      {success ? (
        <p
          className="m-0 rounded-[3px] border border-[#b9d8c3] bg-[#f2faf4] px-4 py-3 text-sm text-[#316647]"
          role="status"
        >
          {success}
        </p>
      ) : null}
      {error ? <FormError message={error} /> : null}

      {canConfigure ? (
        <section
          aria-labelledby="web-clock-heading"
          className="overflow-hidden rounded-[5px] border border-line bg-paper"
        >
          <header className="flex min-h-[60px] flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
            <div className="grid gap-1">
              <h2 className="m-0 text-sm font-[670] text-midnight" id="web-clock-heading">
                Web clock enablement
              </h2>
              <span className="text-xs text-muted">
                {webClock?.history.length
                  ? webClock.enabled
                    ? 'Enabled'
                    : 'Disabled'
                  : 'Disabled by default'}
                {webClock?.version
                  ? ` · version ${webClock.version.versionNo} effective ${dateLabel(webClock.version.effectiveFrom)}`
                  : ''}
              </span>
            </div>
            <Button
              onClick={() => openWebClockDialog(headEnabled ? 'disable' : 'enable')}
              size="default"
              type="button"
              variant="secondary"
            >
              {headEnabled ? 'Disable Web clock' : 'Enable Web clock'}
            </Button>
          </header>
          {webClockLoading ? (
            <p className="m-0 px-5 py-4 text-xs text-muted">Loading the Web clock…</p>
          ) : webClock ? (
            <div className="grid gap-3 px-5 py-4">
              {webClock.history.length === 0 ? (
                <p className="m-0 text-xs text-muted">
                  No Web clock version exists, so every clock attempt fails closed.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                    <thead className="bg-canvas text-[11px] tracking-[0.07em] text-muted uppercase">
                      <tr>
                        <th className="px-3 py-2 font-bold" scope="col">
                          Version
                        </th>
                        <th className="px-3 py-2 font-bold" scope="col">
                          Setting
                        </th>
                        <th className="px-3 py-2 font-bold" scope="col">
                          Status
                        </th>
                        <th className="px-3 py-2 font-bold" scope="col">
                          Effective
                        </th>
                        <th className="px-3 py-2 font-bold" scope="col">
                          Reason
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {webClock.history.map((version) => (
                        <tr key={version.id}>
                          <td className="px-3 py-3 align-top text-xs font-[650] text-ink">
                            v{version.versionNo}
                          </td>
                          <td className="px-3 py-3 align-top text-xs text-ink">
                            {version.enabled ? 'Enabled' : 'Disabled'}
                          </td>
                          <td className="px-3 py-3 align-top text-xs text-muted">
                            {version.status}
                          </td>
                          <td className="px-3 py-3 align-top text-xs text-muted">
                            {dateLabel(version.effectiveFrom)} to{' '}
                            {version.effectiveTo ? dateLabel(version.effectiveTo) : 'open-ended'}
                          </td>
                          <td className="px-3 py-3 align-top text-xs text-muted">
                            {version.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {canClock ? (
        <section
          aria-labelledby="clock-heading"
          className="overflow-hidden rounded-[5px] border border-line bg-paper"
        >
          <header className="flex min-h-[60px] flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
            <div className="grid gap-1">
              <h2 className="m-0 text-sm font-[670] text-midnight" id="clock-heading">
                My Web clock
              </h2>
              <span className="text-xs text-muted">
                {clock?.association
                  ? associationLabel(clock.association) + ' · ' + dayRuleLabel(clock.association)
                  : 'Server timestamped against the governing Work Date'}
              </span>
            </div>
            {clock?.enabled && clock.nextEventType ? (
              <Button
                disabled={busy}
                onClick={() => void submitClock()}
                size="default"
                type="button"
                variant="primary"
              >
                {NEXT_ACTION_LABELS[clock.nextEventType]}
              </Button>
            ) : null}
          </header>
          {clockLoading ? (
            <p className="m-0 px-5 py-4 text-xs text-muted">Loading the Web clock…</p>
          ) : clockError ? (
            <div className="px-5 py-4">
              <FormError message={clockError} />
            </div>
          ) : clock ? (
            <div className="grid gap-3">
              {!clock.enabled ? (
                <p className="m-0 px-5 py-4 text-xs text-muted">
                  Web clock is disabled by the Agency.
                </p>
              ) : clock.nextEventType === null ? (
                <div className="grid gap-2 px-5 py-4">
                  <p className="m-0 text-xs text-muted">
                    {clock.association
                      ? 'The current Work Date already holds a complete Attendance Event sequence.'
                      : 'No Work Date is effective for the Web clock right now.'}
                  </p>
                  {clock.exceptions.map((exception) => (
                    <p className="m-0 text-xs text-[#79531c]" key={exception.type}>
                      {exception.message}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="m-0 px-5 pt-4 text-xs text-muted">
                  Next expected event: {eventTypeLabelOf(clock.nextEventType)}
                </p>
              )}
              <div className="border-t border-line">
                <EventRows events={clock.events} />
              </div>
            </div>
          ) : null}
          {clockResult ? <CaptureSummary result={clockResult} /> : null}
        </section>
      ) : null}

      {canCreateManual ? (
        <section
          aria-labelledby="manual-heading"
          className="overflow-hidden rounded-[5px] border border-line bg-paper"
        >
          <header className="flex min-h-[60px] items-center border-b border-line px-5 py-3">
            <div className="grid gap-1">
              <h2 className="m-0 text-sm font-[670] text-midnight" id="manual-heading">
                Record manual Attendance Event
              </h2>
              <span className="text-xs text-muted">
                Every manual entry keeps its actor, timestamp, and required reason.
              </span>
            </div>
          </header>
          <form className="grid gap-4 px-5 py-4" onSubmit={(event) => void submitManual(event)}>
            {employeeError ? <FormError message={employeeError} /> : null}
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
            {manualError ? <FormError message={manualError} /> : null}
            <div className="flex justify-end">
              <Button
                disabled={busy || employees.length === 0}
                size="default"
                type="submit"
                variant="primary"
              >
                Record Event
              </Button>
            </div>
          </form>
          {manualResult ? <CaptureSummary result={manualResult} /> : null}
        </section>
      ) : null}

      {canReadEvents ? (
        <>
          <section
            aria-labelledby="events-heading"
            className="overflow-hidden rounded-[5px] border border-line bg-paper"
          >
            <header className="grid gap-3 border-b border-line px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="grid gap-1">
                  <h2 className="m-0 text-sm font-[670] text-midnight" id="events-heading">
                    Attendance Event register
                  </h2>
                  <span className="text-xs text-muted">
                    {events.length === 1
                      ? '1 Attendance Event · newest first'
                      : events.length + ' Attendance Events · newest first'}
                  </span>
                </div>
              </div>
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => void applyFilters(event)}
              >
                {employeeError ? (
                  <p className="m-0 text-xs text-muted">{employeeError}</p>
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
                <Button disabled={busy} size="default" type="submit" variant="secondary">
                  Apply filters
                </Button>
              </form>
            </header>
            {events.length === 0 ? (
              <div className="grid min-h-[160px] place-content-center gap-2 px-6 py-10">
                <strong className="text-[15px] font-[650] text-midnight">
                  No Attendance Events yet.
                </strong>
                <p className="m-0 max-w-[560px] text-[13px] leading-[1.6] text-muted">
                  Manual entries and Web clock captures land here as immutable raw events.
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
                        Event time
                      </th>
                      <th className="px-5 py-3 font-bold" scope="col">
                        Event
                      </th>
                      <th className="px-5 py-3 font-bold" scope="col">
                        Source
                      </th>
                      <th className="px-5 py-3 font-bold" scope="col">
                        Reason
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {events.map((event) => (
                      <tr key={event.id}>
                        <td className="px-5 py-4 align-top">
                          <div className="grid gap-1">
                            <strong className="font-[650] text-midnight">
                              {event.employee.legalName}
                            </strong>
                            <span className="text-xs text-muted">
                              {event.employee.employeeNumber}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-top text-xs text-ink">
                          {instantLabel(event.eventTime)}
                        </td>
                        <td className="px-5 py-4 align-top text-xs text-ink">
                          {eventTypeLabelOf(event.eventType)}
                        </td>
                        <td className="px-5 py-4 align-top text-xs text-muted">
                          {event.source === 'WEB_CLOCK' ? 'Web clock' : 'Manual'}
                        </td>
                        <td className="px-5 py-4 align-top text-xs text-muted">
                          {event.reason ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section
            aria-labelledby="work-date-heading"
            className="overflow-hidden rounded-[5px] border border-line bg-paper"
          >
            <header className="grid gap-1 border-b border-line px-5 py-3">
              <h2 className="m-0 text-sm font-[670] text-midnight" id="work-date-heading">
                Work date context
              </h2>
              <span className="text-xs text-muted">
                Inspect one Employee and Work Date for its governing Schedule Assignment, DTR
                presentation slots, and Attendance Exceptions.
              </span>
            </header>
            {employeeError ? (
              <div className="px-5 py-4">
                <FormError message={employeeError} />
              </div>
            ) : (
              <form
                className="flex flex-wrap items-end gap-3 px-5 py-4"
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
                <Button disabled={contextBusy} size="default" type="submit" variant="secondary">
                  Inspect Work Date
                </Button>
              </form>
            )}
            {contextError ? (
              <div className="px-5 pb-4">
                <FormError message={contextError} />
              </div>
            ) : null}
            {context ? (
              <div className="grid gap-3 border-t border-line px-5 py-4">
                <p className="m-0 text-xs text-muted">
                  {context.association
                    ? associationLabel(context.association) +
                      ' · ' +
                      dayRuleLabel(context.association) +
                      context.association.holidayEntries.map((entry) => ' · ' + entry.name).join('')
                    : 'No Schedule Assignment is effective on the Work Date.'}
                </p>
                <EventRows events={context.events} />
                {context.exceptions.length > 0 ? (
                  <ul className="m-0 grid list-none gap-1 p-0 text-xs text-[#79531c]">
                    {context.exceptions.map((exception) => (
                      <li key={exception.type + exception.message}>{exception.message}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 text-xs text-[#316647]">No blocking Attendance Exceptions.</p>
                )}
              </div>
            ) : null}
          </section>
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
                <Button disabled={busy} size="default" type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={busy} size="default" type="submit" variant="primary">
                {dialog === 'enable' ? 'Enable Web Clock' : 'Disable Web Clock'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
