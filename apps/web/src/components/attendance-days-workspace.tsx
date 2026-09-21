'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { manilaToday } from '../lib/manila-date';
import { useRecordNavigation } from './record-navigation';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';

export type AttendanceDayStatus = 'PENDING' | 'CALCULATED' | 'EXCEPTION' | 'APPROVED';
export type AttendanceDayClassification = 'SCHEDULED' | 'UNSCHEDULED_SERVICE';
export type AttendanceExceptionStatus = 'OPEN' | 'RESOLVED' | 'WAIVED';

export interface AttendanceDayTotals {
  expectedMinutes: number;
  workedMinutes: number;
  coverageMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
  absenceMinutes: number;
  officialBusinessMinutes: number;
  officialTravelMinutes: number;
  trainingMinutes: number;
  approvedAbsenceMinutes: number;
  postedLeaveMinutes: number;
  outsideScheduleMinutes: number;
  statutoryNightWindowMinutes: number;
}

export interface AttendanceDayRuleSnapshot {
  fingerprint: string;
  timezone: string;
  assignmentId?: string | null;
  workScheduleVersionId?: string | null;
  workArrangementVersionId?: string | null;
  holidayCalendarVersionId?: string | null;
  dayRuleId?: string | null;
  holidayClassifications?: Record<string, string>;
  eventIds?: string[];
  coverageSources?: Array<{ sourceType: string; sourceId: string; coverageType: string }>;
  resolutionException?: { type: string; message: string; details: Record<string, unknown> };
  capturedAt: string;
}

export interface AttendanceDay {
  id: string;
  agencyId: string;
  attendancePeriodId: string;
  employee: { id: string; employeeNumber: string; legalName: string };
  workDate: string;
  dayClassification: AttendanceDayClassification;
  status: AttendanceDayStatus;
  calculationVersion: number;
  isCurrent: boolean;
  scheduleAssignmentId: string | null;
  workScheduleVersionId: string | null;
  workArrangementVersionId: string | null;
  holidayCalendarVersionId: string | null;
  ruleSnapshot: AttendanceDayRuleSnapshot;
  totals: AttendanceDayTotals;
  openExceptionCount: number;
  calculatedAt: string | null;
  createdAt: string;
}

export interface AttendanceDaySegment {
  id: string;
  sequenceNo: number;
  startsAt: string;
  endsAt: string;
  dutyRelation: string;
  coverageType: string;
  deficitType: string | null;
  holidayClassification: string | null;
  sourceReferences: Array<{ sourceType: string; id: string }>;
}

export interface AttendanceException {
  id: string;
  exceptionType: string;
  status: AttendanceExceptionStatus;
  message: string | null;
  details: Record<string, unknown> | null;
  resolvedAt: string | null;
  resolvedByMembershipId: string | null;
  createdAt: string;
}

export interface AttendanceDayDetail {
  day: AttendanceDay;
  segments: AttendanceDaySegment[];
  exceptions: AttendanceException[];
}

export interface AttendanceDayListResponse {
  days: AttendanceDay[];
}

export interface AttendancePeriod {
  id: string;
  code: string;
  dateFrom: string;
  dateTo: string;
  status: 'OPEN' | 'FINALIZED';
  createdAt: string;
}

export interface AttendancePeriodListResponse {
  periods: AttendancePeriod[];
}

export interface CalculateAttendanceDaysResponse {
  period: AttendancePeriod;
  days: Array<{
    employeeId: string;
    workDate: string;
    attendanceDayId: string | null;
    status: AttendanceDayStatus | null;
    outcome: 'CREATED' | 'RECALCULATED' | 'UNCHANGED';
    exceptionTypes: string[];
  }>;
  createdCount: number;
  recalculatedCount: number;
  unchangedCount: number;
}

interface EmployeeOption {
  id: string;
  employeeNumber: string;
  legalName: string;
}

type View = 'tree' | 'form' | 'kanban';

const STATUS_LABELS: Record<AttendanceDayStatus, string> = {
  PENDING: 'Pending',
  CALCULATED: 'Calculated',
  EXCEPTION: 'Exception',
  APPROVED: 'Approved',
};

const STATUS_TONES: Record<AttendanceDayStatus, string> = {
  PENDING: 'bg-[#f0f2f5] text-muted',
  CALCULATED: 'bg-[#e8f3ed] text-[#316647]',
  EXCEPTION: 'bg-[#fff3d6] text-[#79531c]',
  APPROVED: 'bg-[#e7eefb] text-[#2d4f8f]',
};

const STATUSES: readonly AttendanceDayStatus[] = [
  'PENDING',
  'CALCULATED',
  'EXCEPTION',
  'APPROVED',
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

function clockLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  });
}

function minutesLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

function eventValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function statusClass(status: AttendanceDayStatus): string {
  return (
    'inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.07em] uppercase ' +
    STATUS_TONES[status]
  );
}

export function AttendanceDaysWorkspace({
  agencyId,
  canCalculate,
  canRead,
  initialDays,
  initialPeriods,
}: {
  agencyId: string;
  canCalculate: boolean;
  canRead: boolean;
  initialDays: AttendanceDayListResponse;
  initialPeriods: AttendancePeriodListResponse;
}) {
  const [days, setDays] = useState(initialDays.days);
  const [periods, setPeriods] = useState(initialPeriods.periods);
  const [periodFilter, setPeriodFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | AttendanceDayStatus>('ALL');
  const [query, setQuery] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');
  const [detail, setDetail] = useState<AttendanceDayDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [periodCode, setPeriodCode] = useState('');
  const [dateFrom, setDateFrom] = useState(manilaToday());
  const [dateTo, setDateTo] = useState(manilaToday());
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [calculation, setCalculation] = useState<CalculateAttendanceDaysResponse | null>(null);
  const optionsRequested = useRef(false);
  const navigation = useRecordNavigation();
  const requestedView = navigation.search.get('view');
  const view: View =
    requestedView === 'form' ? 'form' : requestedView === 'kanban' ? 'kanban' : 'tree';
  const recordId = navigation.search.get('record');
  const calculating = navigation.search.get('new') === 'calculate';

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    void request('/attendance-days')
      .then((value) => {
        if (active) setDays((value as AttendanceDayListResponse).days);
      })
      .catch((failure: unknown) => {
        if (active)
          setError(failure instanceof Error ? failure.message : 'The Attendance Day register failed.');
      });
    return () => {
      active = false;
    };
  }, [canRead]);

  useEffect(() => {
    if (!canRead || recordId === null || calculating) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    setError('');
    void request('/attendance-days/' + recordId)
      .then((value) => {
        if (active) setDetail(value as AttendanceDayDetail);
      })
      .catch((failure: unknown) => {
        if (active)
          setError(failure instanceof Error ? failure.message : 'The Attendance Day failed to load.');
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canRead, recordId, calculating]);

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch('/api/v1/agencies/' + agencyId + path, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(errorMessage(value, 'The Attendance Day action failed.'));
    }
    return value;
  }

  async function refresh(): Promise<void> {
    const [list, periodList] = await Promise.all([
      request('/attendance-days') as Promise<AttendanceDayListResponse>,
      request('/attendance-periods') as Promise<AttendancePeriodListResponse>,
    ]);
    setDays(list.days);
    setPeriods(periodList.periods);
  }

  function openRecord(id: string): void {
    setError('');
    setSuccess('');
    navigation.navigate({ view: 'form', record: id, new: null });
  }

  function openCalculate(): void {
    setError('');
    setSuccess('');
    setCalculation(null);
    navigation.navigate({ view: 'form', record: null, new: 'calculate' });
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

  async function calculate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    setCalculation(null);
    try {
      const result = (await request('/attendance-days/calculate', {
        method: 'POST',
        body: JSON.stringify({
          periodCode: periodCode.trim(),
          dateFrom,
          dateTo,
          employeeIds: selectedEmployeeIds,
        }),
      })) as CalculateAttendanceDaysResponse;
      await refresh();
      setCalculation(result);
      setSuccess(
        `Calculated ${result.days.length === 1 ? '1 day' : result.days.length + ' days'}: ` +
          `${result.createdCount} created, ${result.recalculatedCount} recalculated, ` +
          `${result.unchangedCount} unchanged.`,
      );
      const first = result.days.find(({ attendanceDayId }) => attendanceDayId !== null);
      if (first?.attendanceDayId) {
        navigation.navigate({ view: 'form', record: first.attendanceDayId, new: null });
      }
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : 'The calculation failed.');
    } finally {
      setBusy(false);
    }
  }

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = days.filter((day) => {
    if (periodFilter !== '' && day.attendancePeriodId !== periodFilter) return false;
    if (statusFilter !== 'ALL' && day.status !== statusFilter) return false;
    if (fromFilter !== '' && day.workDate < fromFilter) return false;
    if (toFilter !== '' && day.workDate > toFilter) return false;
    if (!normalizedQuery) return true;
    return (
      day.employee.legalName.toLowerCase().includes(normalizedQuery) ||
      day.employee.employeeNumber.toLowerCase().includes(normalizedQuery)
    );
  });

  const normalizedEmployeeQuery = employeeQuery.trim().toLowerCase();
  const visibleEmployees = employeeOptions.filter((employee) => {
    if (!normalizedEmployeeQuery) return true;
    return (
      employee.legalName.toLowerCase().includes(normalizedEmployeeQuery) ||
      employee.employeeNumber.toLowerCase().includes(normalizedEmployeeQuery)
    );
  });

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="m-0 text-[22px] font-[680] text-midnight">Attendance Days</h1>
          <p className="m-0 max-w-[720px] text-sm leading-[1.6] text-muted">
            Reproducible daily attendance with its rule snapshot, segments, and explainable
            exceptions. Every recalculation keeps the previous version for audit.
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
                navigation.navigate({ view: 'form', new: calculating ? 'calculate' : null })
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
          {canCalculate ? (
            <Button
              className="min-h-10 whitespace-nowrap"
              onClick={openCalculate}
              size="default"
              type="button"
              variant="primary"
            >
              Calculate attendance days
            </Button>
          ) : null}
        </div>
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

      {!canRead ? (
        <section className="overflow-hidden rounded-[5px] border border-line bg-paper px-5 py-8 text-sm text-muted">
          Your permission allows calculating Attendance Days but not reading the register.
        </section>
      ) : null}

      {canRead && view === 'tree' ? (
        <section
          aria-labelledby="attendance-day-register-heading"
          className="overflow-hidden rounded-[5px] border border-line bg-paper"
        >
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div className="grid gap-1">
              <h2
                className="m-0 text-sm font-[670] text-midnight"
                id="attendance-day-register-heading"
              >
                Attendance Day register
              </h2>
              <span className="text-xs text-muted">
                {filtered.length === 1 ? '1 day' : filtered.length + ' days'} · Current versions
                only
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-muted">
                Search
                <input
                  className="min-h-9 rounded-[3px] border border-line bg-paper px-2 text-xs text-ink"
                  onChange={(event) => setQuery(eventValue(event))}
                  placeholder="Employee"
                  type="search"
                  value={query}
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted">
                Period
                <select
                  className="min-h-9 rounded-[3px] border border-line bg-paper px-2 text-xs text-ink"
                  onChange={(event) => setPeriodFilter(eventValue(event))}
                  value={periodFilter}
                >
                  <option value="">All periods</option>
                  {periods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.code} · {dateLabel(period.dateFrom)} – {dateLabel(period.dateTo)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-muted">
                Status
                <select
                  className="min-h-9 rounded-[3px] border border-line bg-paper px-2 text-xs text-ink"
                  onChange={(event) =>
                    setStatusFilter(eventValue(event) as 'ALL' | AttendanceDayStatus)
                  }
                  value={statusFilter}
                >
                  <option value="ALL">All statuses</option>
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-muted">
                From
                <input
                  className="min-h-9 rounded-[3px] border border-line bg-paper px-2 text-xs text-ink"
                  onChange={(event) => setFromFilter(eventValue(event))}
                  type="date"
                  value={fromFilter}
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted">
                To
                <input
                  className="min-h-9 rounded-[3px] border border-line bg-paper px-2 text-xs text-ink"
                  onChange={(event) => setToFilter(eventValue(event))}
                  type="date"
                  value={toFilter}
                />
              </label>
            </div>
          </header>
          {filtered.length === 0 ? (
            <div className="grid min-h-[220px] place-content-center gap-2 px-6 py-12 text-center">
              <strong className="text-[15px] font-[650] text-midnight">
                {days.length === 0 ? 'No Attendance Days yet.' : 'No days match.'}
              </strong>
              <p className="m-0 max-w-[560px] text-[13px] leading-[1.6] text-muted">
                {days.length === 0
                  ? 'Calculate a period to derive Attendance Days from recorded events, schedules, and coverage.'
                  : 'Clear the search or choose another period, status, or date range.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
                <thead className="bg-canvas text-[11px] tracking-[0.07em] text-muted uppercase">
                  <tr>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Work date
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Employee
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Status
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Expected
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Worked
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Late
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Undertime
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Absence
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Version
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filtered.map((day) => (
                    <tr key={day.id}>
                      <td className="px-5 py-4 align-top text-xs text-ink">
                        <button
                          className="w-fit cursor-pointer text-left font-[650] text-cobalt underline-offset-2 hover:underline"
                          onClick={() => openRecord(day.id)}
                          type="button"
                        >
                          {dateLabel(day.workDate)}
                        </button>
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-ink">
                        <div className="grid gap-1">
                          <span className="font-[650]">{day.employee.legalName}</span>
                          <span className="text-muted">{day.employee.employeeNumber}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <div className="grid gap-1">
                          <span className={statusClass(day.status)}>{STATUS_LABELS[day.status]}</span>
                          {day.dayClassification === 'UNSCHEDULED_SERVICE' ? (
                            <span className="text-[10px] tracking-[0.07em] text-muted uppercase">
                              Unscheduled service
                            </span>
                          ) : null}
                          {day.openExceptionCount > 0 ? (
                            <span className="text-[11px] text-[#79531c]">
                              {day.openExceptionCount === 1
                                ? '1 open exception'
                                : day.openExceptionCount + ' open exceptions'}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-muted">
                        {minutesLabel(day.totals.expectedMinutes)}
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-ink">
                        {minutesLabel(day.totals.workedMinutes)}
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-muted">
                        {minutesLabel(day.totals.lateMinutes)}
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-muted">
                        {minutesLabel(day.totals.undertimeMinutes)}
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-muted">
                        {minutesLabel(day.totals.absenceMinutes)}
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-muted">
                        v{day.calculationVersion}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {canRead && view === 'kanban' ? (
        <section aria-label="Attendance Day status board" className="grid gap-3 md:grid-cols-4">
          {STATUSES.map((status) => {
            const column = filtered.filter((day) => day.status === status);
            return (
              <div
                className="overflow-hidden rounded-[5px] border border-line bg-paper"
                key={status}
              >
                <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
                  <span className={statusClass(status)}>{STATUS_LABELS[status]}</span>
                  <span className="text-xs text-muted">{column.length}</span>
                </header>
                <div className="grid gap-2 p-3">
                  {column.length === 0 ? (
                    <p className="m-0 px-1 py-4 text-center text-xs text-muted">No days</p>
                  ) : (
                    column.map((day) => (
                      <button
                        className="grid cursor-pointer gap-1 rounded-[4px] border border-line bg-canvas px-3 py-2 text-left hover:border-cobalt"
                        key={day.id}
                        onClick={() => openRecord(day.id)}
                        type="button"
                      >
                        <span className="text-xs font-[650] text-ink">
                          {dateLabel(day.workDate)}
                        </span>
                        <span className="text-xs text-muted">{day.employee.legalName}</span>
                        <span className="text-[11px] text-muted">
                          Worked {minutesLabel(day.totals.workedMinutes)} · Absence{' '}
                          {minutesLabel(day.totals.absenceMinutes)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

      {view === 'form' ? (
        <section
          aria-labelledby="attendance-day-form-heading"
          className="overflow-hidden rounded-[5px] border border-line bg-paper"
        >
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div className="grid gap-1">
              <h2 className="m-0 text-sm font-[670] text-midnight" id="attendance-day-form-heading">
                {calculating
                  ? 'Calculate Attendance Days'
                  : detail
                    ? 'Attendance Day record'
                    : 'Attendance Day'}
              </h2>
              <span className="text-xs text-muted">
                {calculating
                  ? 'One period, one date range, and the employees to derive. Recalculation is idempotent and versioned.'
                  : 'Read-only facts. Corrections belong to the flagged-day workflow.'}
              </span>
            </div>
            {!calculating && detail && canCalculate ? (
              <Button
                className="min-h-9 whitespace-nowrap"
                onClick={openCalculate}
                size="default"
                type="button"
                variant="secondary"
              >
                Calculate another period
              </Button>
            ) : null}
          </header>

          {calculating ? (
            <form className="grid gap-4 px-5 py-5" onSubmit={calculate}>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Period code">
                  <input
                    className={inputClass}
                    maxLength={50}
                    onChange={(event) => setPeriodCode(eventValue(event))}
                    placeholder="2026-01-1"
                    required
                    value={periodCode}
                  />
                </Field>
                <Field label="From">
                  <input
                    className={inputClass}
                    onChange={(event) => setDateFrom(eventValue(event))}
                    required
                    type="date"
                    value={dateFrom}
                  />
                </Field>
                <Field label="To">
                  <input
                    className={inputClass}
                    onChange={(event) => setDateTo(eventValue(event))}
                    required
                    type="date"
                    value={dateTo}
                  />
                </Field>
              </div>
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-[650] text-ink">Employees</span>
                  <input
                    aria-label="Filter employees"
                    className="min-h-9 rounded-[3px] border border-line bg-paper px-2 text-xs text-ink"
                    onChange={(event) => setEmployeeQuery(eventValue(event))}
                    placeholder="Filter employees"
                    type="search"
                    value={employeeQuery}
                  />
                </div>
                <select
                  aria-label="Employees"
                  className="min-h-[180px] rounded-[3px] border border-line bg-paper px-2 py-1 text-xs text-ink"
                  multiple
                  onChange={(event) => {
                    const target = event.currentTarget as unknown as {
                      selectedOptions: ArrayLike<{ value: string }>;
                    };
                    setSelectedEmployeeIds(
                      Array.from(target.selectedOptions, (option) => option.value),
                    );
                  }}
                  value={selectedEmployeeIds}
                >
                  {visibleEmployees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.legalName} · {employee.employeeNumber}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted">
                  {selectedEmployeeIds.length === 0
                    ? 'Select at least one employee.'
                    : selectedEmployeeIds.length === 1
                      ? '1 employee selected'
                      : selectedEmployeeIds.length + ' employees selected'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  className="min-h-10"
                  disabled={busy || selectedEmployeeIds.length === 0}
                  size="default"
                  type="submit"
                  variant="primary"
                >
                  {busy ? 'Calculating…' : 'Calculate'}
                </Button>
                <Button
                  className="min-h-10"
                  onClick={() => navigation.navigate({ view: 'tree', new: null })}
                  size="default"
                  type="button"
                  variant="secondary"
                >
                  Back to register
                </Button>
              </div>
              {calculation ? (
                <div className="grid gap-2 rounded-[4px] border border-line bg-canvas px-4 py-3">
                  <span className="text-xs font-[650] text-ink">
                    {calculation.period.code} · {dateLabel(calculation.period.dateFrom)} –{' '}
                    {dateLabel(calculation.period.dateTo)}
                  </span>
                  <div className="grid gap-1">
                    {calculation.days.map((day) => (
                      <button
                        className="grid cursor-pointer gap-0.5 rounded-[3px] px-2 py-1 text-left text-xs hover:bg-paper"
                        key={day.employeeId + day.workDate}
                        onClick={() =>
                          day.attendanceDayId
                            ? openRecord(day.attendanceDayId)
                            : setError('That day has no stored record to open.')
                        }
                        type="button"
                      >
                        <span className="font-[650] text-ink">
                          {dateLabel(day.workDate)} · {day.outcome.toLowerCase()}
                          {day.status ? ' · ' + STATUS_LABELS[day.status].toLowerCase() : ''}
                        </span>
                        {day.exceptionTypes.length > 0 ? (
                          <span className="text-[#79531c]">
                            {day.exceptionTypes.join(', ').replaceAll('_', ' ').toLowerCase()}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </form>
          ) : detailLoading ? (
            <p className="m-0 px-5 py-8 text-sm text-muted">Loading the Attendance Day…</p>
          ) : detail === null ? (
            <div className="grid min-h-[180px] place-content-center gap-2 px-6 py-10 text-center">
              <strong className="text-[15px] font-[650] text-midnight">
                Select an Attendance Day
              </strong>
              <p className="m-0 max-w-[520px] text-[13px] leading-[1.6] text-muted">
                Choose a day from the register to inspect its totals, segments, exceptions, and
                rule snapshot.
              </p>
            </div>
          ) : (
            <AttendanceDayRecord detail={detail} />
          )}
        </section>
      ) : null}
    </div>
  );
}

function AttendanceDayRecord({ detail }: { detail: AttendanceDayDetail }) {
  const { day } = detail;
  const totals = day.totals;
  return (
    <div className="grid gap-5 px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <span className="text-[15px] font-[650] text-midnight">{day.employee.legalName}</span>
          <span className="text-xs text-muted">
            {day.employee.employeeNumber} · {dateLabel(day.workDate)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={statusClass(day.status)}>{STATUS_LABELS[day.status]}</span>
          <span className="text-xs text-muted">
            v{day.calculationVersion} · {day.isCurrent ? 'current' : 'superseded'} ·{' '}
            {day.dayClassification === 'UNSCHEDULED_SERVICE'
              ? 'unscheduled service'
              : 'scheduled'}
          </span>
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {(
          [
            ['Expected', totals.expectedMinutes],
            ['Worked', totals.workedMinutes],
            ['Coverage', totals.coverageMinutes],
            ['Late', totals.lateMinutes],
            ['Undertime', totals.undertimeMinutes],
            ['Absence', totals.absenceMinutes],
            ['Official business', totals.officialBusinessMinutes],
            ['Official travel', totals.officialTravelMinutes],
            ['Training', totals.trainingMinutes],
            ['Approved absence', totals.approvedAbsenceMinutes],
            ['Posted leave', totals.postedLeaveMinutes],
            ['Outside schedule', totals.outsideScheduleMinutes],
            ['Night window', totals.statutoryNightWindowMinutes],
          ] as const
        ).map(([label, minutes]) => (
          <div className="rounded-[4px] border border-line bg-canvas px-3 py-2" key={label}>
            <dt className="text-[10px] tracking-[0.07em] text-muted uppercase">{label}</dt>
            <dd className="m-0 text-sm font-[650] text-ink">{minutesLabel(minutes)}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-2">
        <h3 className="m-0 text-xs font-[670] tracking-[0.07em] text-midnight uppercase">
          Segments
        </h3>
        {detail.segments.length === 0 ? (
          <p className="m-0 text-xs text-muted">No segments were derived for this day.</p>
        ) : (
          <div className="overflow-x-auto rounded-[4px] border border-line">
            <table className="w-full min-w-[760px] border-collapse text-left text-xs">
              <thead className="bg-canvas text-[10px] tracking-[0.07em] text-muted uppercase">
                <tr>
                  <th className="px-3 py-2 font-bold" scope="col">
                    #
                  </th>
                  <th className="px-3 py-2 font-bold" scope="col">
                    Time
                  </th>
                  <th className="px-3 py-2 font-bold" scope="col">
                    Duty relation
                  </th>
                  <th className="px-3 py-2 font-bold" scope="col">
                    Coverage
                  </th>
                  <th className="px-3 py-2 font-bold" scope="col">
                    Deficit
                  </th>
                  <th className="px-3 py-2 font-bold" scope="col">
                    Holiday
                  </th>
                  <th className="px-3 py-2 font-bold" scope="col">
                    Sources
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {detail.segments.map((segment) => (
                  <tr key={segment.id}>
                    <td className="px-3 py-2 align-top text-muted">{segment.sequenceNo}</td>
                    <td className="px-3 py-2 align-top text-ink">
                      {clockLabel(segment.startsAt)} – {clockLabel(segment.endsAt)}
                    </td>
                    <td className="px-3 py-2 align-top text-muted">
                      {segment.dutyRelation.replaceAll('_', ' ').toLowerCase()}
                    </td>
                    <td className="px-3 py-2 align-top text-muted">
                      {segment.coverageType.replaceAll('_', ' ').toLowerCase()}
                    </td>
                    <td className="px-3 py-2 align-top text-muted">
                      {segment.deficitType
                        ? segment.deficitType.replaceAll('_', ' ').toLowerCase()
                        : '—'}
                    </td>
                    <td className="px-3 py-2 align-top text-muted">
                      {segment.holidayClassification
                        ? segment.holidayClassification.replaceAll('_', ' ').toLowerCase()
                        : '—'}
                    </td>
                    <td className="px-3 py-2 align-top text-muted">
                      {segment.sourceReferences.length === 0
                        ? '—'
                        : segment.sourceReferences
                            .map(({ sourceType }) => sourceType.replaceAll('_', ' ').toLowerCase())
                            .join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-2">
        <h3 className="m-0 text-xs font-[670] tracking-[0.07em] text-midnight uppercase">
          Exceptions
        </h3>
        {detail.exceptions.length === 0 ? (
          <p className="m-0 text-xs text-muted">No exceptions were recorded for this version.</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {detail.exceptions.map((exception) => (
              <li
                className="grid gap-1 rounded-[4px] border border-line bg-canvas px-3 py-2"
                key={exception.id}
              >
                <span className="text-xs font-[650] text-ink">
                  {exception.exceptionType.replaceAll('_', ' ').toLowerCase()} ·{' '}
                  {exception.status.toLowerCase()}
                </span>
                {exception.message ? (
                  <span className="text-xs text-muted">{exception.message}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-2">
        <h3 className="m-0 text-xs font-[670] tracking-[0.07em] text-midnight uppercase">
          Rule snapshot
        </h3>
        <dl className="grid gap-2 text-xs sm:grid-cols-2">
          <div className="grid gap-0.5">
            <dt className="text-muted">Timezone</dt>
            <dd className="m-0 text-ink">{day.ruleSnapshot.timezone}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-muted">Captured</dt>
            <dd className="m-0 text-ink">{instantLabel(day.ruleSnapshot.capturedAt)}</dd>
          </div>
          <div className="grid gap-0.5 sm:col-span-2">
            <dt className="text-muted">Fingerprint</dt>
            <dd className="m-0 break-all text-ink">{day.ruleSnapshot.fingerprint}</dd>
          </div>
          {day.ruleSnapshot.workScheduleVersionId ? (
            <div className="grid gap-0.5">
              <dt className="text-muted">Work schedule version</dt>
              <dd className="m-0 break-all text-ink">{day.ruleSnapshot.workScheduleVersionId}</dd>
            </div>
          ) : null}
          {day.ruleSnapshot.workArrangementVersionId ? (
            <div className="grid gap-0.5">
              <dt className="text-muted">Work arrangement version</dt>
              <dd className="m-0 break-all text-ink">{day.ruleSnapshot.workArrangementVersionId}</dd>
            </div>
          ) : null}
          {day.ruleSnapshot.holidayCalendarVersionId ? (
            <div className="grid gap-0.5">
              <dt className="text-muted">Holiday calendar version</dt>
              <dd className="m-0 break-all text-ink">{day.ruleSnapshot.holidayCalendarVersionId}</dd>
            </div>
          ) : null}
          {day.ruleSnapshot.resolutionException ? (
            <div className="grid gap-0.5 sm:col-span-2">
              <dt className="text-muted">Resolution exception</dt>
              <dd className="m-0 text-ink">
                {day.ruleSnapshot.resolutionException.type.replaceAll('_', ' ').toLowerCase()} ·{' '}
                {day.ruleSnapshot.resolutionException.message}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="grid gap-1 text-xs text-muted">
        <span>
          {day.calculatedAt
            ? 'Calculated ' + instantLabel(day.calculatedAt)
            : 'Not yet calculated'}
        </span>
        <span>Record created {instantLabel(day.createdAt)}</span>
      </div>
    </div>
  );
}
