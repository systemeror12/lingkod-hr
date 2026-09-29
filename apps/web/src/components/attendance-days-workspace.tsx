'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { manilaToday } from '../lib/manila-date';
import { useRecordNavigation } from './record-navigation';
import { StateSurface } from './state-surface';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';
import { PageHeader } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag, type StatusTone } from './ui/status-tag';
import { RowHeader, Table, Td, Th, Tr } from './ui/table';
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

type StatusDisplay = { label: string; tone: StatusTone };

const STATUS: Record<AttendanceDayStatus, StatusDisplay> = {
  PENDING: { label: 'Pending', tone: 'neutral' },
  CALCULATED: { label: 'Calculated', tone: 'success' },
  EXCEPTION: { label: 'Exception', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'info' },
};

const EXCEPTION_STATUS: Record<AttendanceExceptionStatus, StatusDisplay> = {
  OPEN: { label: 'Open', tone: 'warning' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
  WAIVED: { label: 'Waived', tone: 'neutral' },
};

const STATUSES = Object.keys(STATUS) as AttendanceDayStatus[];

function words(value: string): string {
  return value.replaceAll('_', ' ').toLowerCase();
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
          setError(
            failure instanceof Error ? failure.message : 'The Attendance Day register failed.',
          );
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
          setError(
            failure instanceof Error ? failure.message : 'The Attendance Day failed to load.',
          );
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

  const views: [View, string][] = [
    ['tree', 'Tree'],
    ['form', 'Form'],
    ['kanban', 'Kanban'],
  ];
  const dayCount = filtered.length === 1 ? '1 day' : filtered.length + ' days';
  const formTitle = calculating
    ? 'Calculate Attendance Days'
    : detail
      ? 'Attendance Day record'
      : 'Attendance Day';

  return (
    <div className="grid min-w-0 gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Time & attendance' }]}
        title="Attendance Days"
        actions={
          <>
            <div
              className="flex items-center gap-0.5 rounded-control border border-border bg-surface p-0.5"
              role="group"
              aria-label="Record view"
            >
              {views.map(([value, label]) => (
                <button
                  aria-pressed={view === value}
                  className="cursor-pointer rounded-control border-0 bg-transparent px-3 py-1.5 text-caption font-[650] text-ink-muted hover:text-ink aria-pressed:bg-canvas aria-pressed:text-ink"
                  key={value}
                  onClick={() =>
                    navigation.navigate(
                      value === 'form'
                        ? { view: value, new: calculating ? 'calculate' : null }
                        : { view: value, new: null },
                    )
                  }
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            {canCalculate ? (
              <Button onClick={openCalculate} type="button" variant="primary">
                Calculate attendance days
              </Button>
            ) : null}
          </>
        }
      />
      <p className="m-0 max-w-[760px] text-small text-ink-muted">
        Reproducible daily attendance with its rule snapshot, segments, and explainable exceptions.
        Every recalculation keeps the previous version for audit.
      </p>

      <FormError message={error} />
      {success ? (
        <p
          className="m-0 rounded-control border border-success/40 bg-success/5 px-3 py-2.5 text-small text-success"
          role="status"
        >
          {success}
        </p>
      ) : null}

      {!canRead ? (
        <StateSurface label="Attendance Day register">
          <strong className="font-[650] text-ink">The register is not available to you.</strong>
          <p className="m-0">
            Your permission allows calculating Attendance Days but not reading the register.
          </p>
        </StateSurface>
      ) : null}

      {canRead && view === 'tree' ? (
        <Panel
          title="Attendance Day register"
          flush
          actions={
            <span className="text-caption text-ink-muted">{dayCount} · Current versions only</span>
          }
        >
          <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
            <Field label="Search">
              <input
                className={inputClass}
                onChange={(event) => setQuery(eventValue(event))}
                placeholder="Employee"
                type="search"
                value={query}
              />
            </Field>
            <Field label="Period">
              <select
                className={inputClass}
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
            </Field>
            <Field label="Status">
              <select
                className={inputClass}
                onChange={(event) =>
                  setStatusFilter(eventValue(event) as 'ALL' | AttendanceDayStatus)
                }
                value={statusFilter}
              >
                <option value="ALL">All statuses</option>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS[status].label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="From">
              <input
                className={inputClass}
                onChange={(event) => setFromFilter(eventValue(event))}
                type="date"
                value={fromFilter}
              />
            </Field>
            <Field label="To">
              <input
                className={inputClass}
                onChange={(event) => setToFilter(eventValue(event))}
                type="date"
                value={toFilter}
              />
            </Field>
          </div>
          {filtered.length === 0 ? (
            <StateSurface compact label="Attendance Days">
              <strong className="font-[650] text-ink">
                {days.length === 0 ? 'No Attendance Days yet.' : 'No days match.'}
              </strong>
              <p className="m-0">
                {days.length === 0
                  ? 'Calculate a period to derive Attendance Days from recorded events, schedules, and coverage.'
                  : 'Clear the search or choose another period, status, or date range.'}
              </p>
            </StateSurface>
          ) : (
            <Table aria-label="Attendance Days" className="min-w-[1040px]">
              <thead>
                <tr>
                  <Th kind="date">Work date</Th>
                  <Th>Employee</Th>
                  <Th>Status</Th>
                  <Th kind="numeric">Expected</Th>
                  <Th kind="numeric">Worked</Th>
                  <Th kind="numeric">Late</Th>
                  <Th kind="numeric">Undertime</Th>
                  <Th kind="numeric">Absence</Th>
                  <Th kind="numeric">Version</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((day) => (
                  <Tr key={day.id} selected={day.id === recordId}>
                    <RowHeader className="whitespace-nowrap">
                      <button
                        className="cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-primary hover:underline"
                        onClick={() => openRecord(day.id)}
                        type="button"
                      >
                        {dateLabel(day.workDate)}
                      </button>
                    </RowHeader>
                    <Td>
                      {day.employee.legalName}
                      <span className="block font-mono text-caption text-ink-muted">
                        {day.employee.employeeNumber}
                      </span>
                    </Td>
                    <Td>
                      <div className="grid justify-items-start gap-1">
                        <StatusTag tone={STATUS[day.status].tone}>
                          {STATUS[day.status].label}
                        </StatusTag>
                        {day.dayClassification === 'UNSCHEDULED_SERVICE' ? (
                          <span className="text-caption text-ink-muted">Unscheduled service</span>
                        ) : null}
                        {day.openExceptionCount > 0 ? (
                          <span className="text-caption text-warning">
                            {day.openExceptionCount === 1
                              ? '1 open exception'
                              : day.openExceptionCount + ' open exceptions'}
                          </span>
                        ) : null}
                      </div>
                    </Td>
                    <Td kind="numeric" className="text-ink-muted">
                      {minutesLabel(day.totals.expectedMinutes)}
                    </Td>
                    <Td kind="numeric">{minutesLabel(day.totals.workedMinutes)}</Td>
                    <Td kind="numeric" className="text-ink-muted">
                      {minutesLabel(day.totals.lateMinutes)}
                    </Td>
                    <Td kind="numeric" className="text-ink-muted">
                      {minutesLabel(day.totals.undertimeMinutes)}
                    </Td>
                    <Td kind="numeric" className="text-ink-muted">
                      {minutesLabel(day.totals.absenceMinutes)}
                    </Td>
                    <Td kind="numeric" className="text-ink-muted">
                      v{day.calculationVersion}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      ) : null}

      {canRead && view === 'kanban' ? (
        <Panel title="Attendance Day status board" flush>
          <div className="flex gap-3 overflow-x-auto p-4">
            {STATUSES.map((status) => {
              const column = filtered.filter((day) => day.status === status);
              return (
                <section
                  aria-labelledby={`attendance-day-column-${status}`}
                  className="grid min-w-[230px] flex-1 content-start gap-2 rounded-panel border border-border bg-canvas p-3"
                  key={status}
                >
                  <h3
                    className="m-0 flex items-center justify-between gap-2 text-caption font-[650] text-ink"
                    id={`attendance-day-column-${status}`}
                  >
                    <StatusTag tone={STATUS[status].tone}>{STATUS[status].label}</StatusTag>
                    <span className="text-ink-muted">{column.length}</span>
                  </h3>
                  {column.length === 0 ? (
                    <p className="m-0 px-1 py-3 text-caption text-ink-muted">No days</p>
                  ) : (
                    column.map((day) => (
                      <button
                        aria-current={day.id === recordId ? 'true' : undefined}
                        className="grid cursor-pointer gap-1 rounded-control border border-border bg-surface px-3 py-2.5 text-left hover:border-primary aria-[current=true]:border-primary aria-[current=true]:shadow-[inset_3px_0_0_var(--color-primary)]"
                        key={day.id}
                        onClick={() => openRecord(day.id)}
                        type="button"
                      >
                        <span className="text-caption font-[650] text-primary">
                          {dateLabel(day.workDate)}
                        </span>
                        <strong className="text-small font-[650] text-ink">
                          {day.employee.legalName}
                        </strong>
                        <span className="text-caption text-ink-muted">
                          Worked {minutesLabel(day.totals.workedMinutes)} · Absence{' '}
                          {minutesLabel(day.totals.absenceMinutes)}
                        </span>
                      </button>
                    ))
                  )}
                </section>
              );
            })}
          </div>
        </Panel>
      ) : null}

      {view === 'form' ? (
        <Panel
          title={formTitle}
          flush
          actions={
            !calculating && detail && canCalculate ? (
              <Button onClick={openCalculate} type="button" variant="secondary">
                Calculate another period
              </Button>
            ) : null
          }
        >
          {calculating ? (
            <form className="grid gap-4 p-4" onSubmit={calculate}>
              <p className="m-0 text-small text-ink-muted">
                One period, one date range, and the employees to derive. Recalculation is idempotent
                and versioned.
              </p>
              <div className="grid gap-4 min-[621px]:grid-cols-3">
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-caption font-[650] text-ink">Employees</span>
                  <input
                    aria-label="Filter employees"
                    className={inputClass + ' !w-auto'}
                    onChange={(event) => setEmployeeQuery(eventValue(event))}
                    placeholder="Filter employees"
                    type="search"
                    value={employeeQuery}
                  />
                </div>
                <select
                  aria-label="Employees"
                  className={inputClass + ' min-h-[180px] py-1'}
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
                <span className="text-caption text-ink-muted">
                  {selectedEmployeeIds.length === 0
                    ? 'Select at least one employee.'
                    : selectedEmployeeIds.length === 1
                      ? '1 employee selected'
                      : selectedEmployeeIds.length + ' employees selected'}
                </span>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  onClick={() => navigation.navigate({ view: 'tree', new: null })}
                  type="button"
                  variant="secondary"
                >
                  Back to register
                </Button>
                <Button
                  disabled={busy || selectedEmployeeIds.length === 0}
                  type="submit"
                  variant="primary"
                >
                  {busy ? 'Calculating…' : 'Calculate'}
                </Button>
              </div>
              {calculation ? (
                <div className="grid gap-2 rounded-control border border-border bg-canvas px-4 py-3">
                  <span className="text-small font-[650] text-ink">
                    {calculation.period.code} · {dateLabel(calculation.period.dateFrom)} –{' '}
                    {dateLabel(calculation.period.dateTo)}
                  </span>
                  <div className="grid gap-1">
                    {calculation.days.map((day) => (
                      <button
                        className="grid cursor-pointer gap-0.5 rounded-control border-0 bg-transparent px-2 py-1 text-left text-small hover:bg-surface"
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
                          {day.status ? ' · ' + STATUS[day.status].label.toLowerCase() : ''}
                        </span>
                        {day.exceptionTypes.length > 0 ? (
                          <span className="text-warning">
                            {words(day.exceptionTypes.join(', '))}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </form>
          ) : detailLoading ? (
            <StateSurface busy compact label="Attendance Day record">
              <p className="m-0">Loading the Attendance Day…</p>
            </StateSurface>
          ) : detail === null ? (
            <StateSurface compact label="Attendance Day">
              <strong className="font-[650] text-ink">Select an Attendance Day</strong>
              <p className="m-0">
                Choose a day from the register to inspect its totals, segments, exceptions, and rule
                snapshot.
              </p>
            </StateSurface>
          ) : (
            <AttendanceDayRecord detail={detail} />
          )}
        </Panel>
      ) : null}
    </div>
  );
}

const SUBHEADING = 'm-0 text-caption font-[650] text-ink';

function AttendanceDayRecord({ detail }: { detail: AttendanceDayDetail }) {
  const { day } = detail;
  const totals = day.totals;
  return (
    <div className="grid gap-5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <span className="text-body font-[650] text-ink">{day.employee.legalName}</span>
          <span className="text-small text-ink-muted">
            {day.employee.employeeNumber} · {dateLabel(day.workDate)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusTag tone={STATUS[day.status].tone}>{STATUS[day.status].label}</StatusTag>
          <span className="text-small text-ink-muted">
            v{day.calculationVersion} · {day.isCurrent ? 'current' : 'superseded'} ·{' '}
            {day.dayClassification === 'UNSCHEDULED_SERVICE' ? 'unscheduled service' : 'scheduled'}
          </span>
        </div>
      </div>

      <dl className="m-0 grid gap-3 min-[621px]:grid-cols-3 min-[1025px]:grid-cols-4">
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
          <div className="rounded-control border border-border bg-canvas px-3 py-2" key={label}>
            <dt className="text-caption text-ink-muted">{label}</dt>
            <dd className="m-0 text-body font-[600] text-ink">{minutesLabel(minutes)}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-2">
        <h3 className={SUBHEADING}>Segments</h3>
        {detail.segments.length === 0 ? (
          <p className="m-0 text-small text-ink-muted">No segments were derived for this day.</p>
        ) : (
          <div className="rounded-control border border-border">
            <Table aria-label="Segments" className="min-w-[760px]">
              <thead>
                <tr>
                  <Th kind="numeric">#</Th>
                  <Th>Time</Th>
                  <Th>Duty relation</Th>
                  <Th>Coverage</Th>
                  <Th>Deficit</Th>
                  <Th>Holiday</Th>
                  <Th>Sources</Th>
                </tr>
              </thead>
              <tbody>
                {detail.segments.map((segment) => (
                  <Tr key={segment.id}>
                    <Td kind="numeric" className="text-ink-muted">
                      {segment.sequenceNo}
                    </Td>
                    <Td kind="date">
                      {clockLabel(segment.startsAt)} – {clockLabel(segment.endsAt)}
                    </Td>
                    <Td className="text-ink-muted">{words(segment.dutyRelation)}</Td>
                    <Td className="text-ink-muted">{words(segment.coverageType)}</Td>
                    <Td className="text-ink-muted">
                      {segment.deficitType ? words(segment.deficitType) : '—'}
                    </Td>
                    <Td className="text-ink-muted">
                      {segment.holidayClassification ? words(segment.holidayClassification) : '—'}
                    </Td>
                    <Td className="text-ink-muted">
                      {segment.sourceReferences.length === 0
                        ? '—'
                        : segment.sourceReferences
                            .map(({ sourceType }) => words(sourceType))
                            .join(', ')}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>

      <div className="grid gap-2">
        <h3 className={SUBHEADING}>Exceptions</h3>
        {detail.exceptions.length === 0 ? (
          <p className="m-0 text-small text-ink-muted">
            No exceptions were recorded for this version.
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {detail.exceptions.map((exception) => (
              <li
                className="grid gap-1 rounded-control border border-border bg-canvas px-3 py-2"
                key={exception.id}
              >
                <span className="flex flex-wrap items-center gap-2 text-small font-[650] text-ink">
                  {words(exception.exceptionType)}
                  <StatusTag tone={EXCEPTION_STATUS[exception.status].tone}>
                    {EXCEPTION_STATUS[exception.status].label}
                  </StatusTag>
                </span>
                {exception.message ? (
                  <span className="text-small text-ink-muted">{exception.message}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-2">
        <h3 className={SUBHEADING}>Rule snapshot</h3>
        <dl className="m-0 grid gap-3 text-small min-[621px]:grid-cols-2">
          <div className="grid gap-0.5">
            <dt className="text-ink-muted">Timezone</dt>
            <dd className="m-0 text-ink">{day.ruleSnapshot.timezone}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-ink-muted">Captured</dt>
            <dd className="m-0 text-ink">{instantLabel(day.ruleSnapshot.capturedAt)}</dd>
          </div>
          <div className="grid gap-0.5 min-[621px]:col-span-2">
            <dt className="text-ink-muted">Fingerprint</dt>
            <dd className="m-0 font-mono text-caption break-all text-ink">
              {day.ruleSnapshot.fingerprint}
            </dd>
          </div>
          {day.ruleSnapshot.workScheduleVersionId ? (
            <div className="grid gap-0.5">
              <dt className="text-ink-muted">Work schedule version</dt>
              <dd className="m-0 font-mono text-caption break-all text-ink">
                {day.ruleSnapshot.workScheduleVersionId}
              </dd>
            </div>
          ) : null}
          {day.ruleSnapshot.workArrangementVersionId ? (
            <div className="grid gap-0.5">
              <dt className="text-ink-muted">Work arrangement version</dt>
              <dd className="m-0 font-mono text-caption break-all text-ink">
                {day.ruleSnapshot.workArrangementVersionId}
              </dd>
            </div>
          ) : null}
          {day.ruleSnapshot.holidayCalendarVersionId ? (
            <div className="grid gap-0.5">
              <dt className="text-ink-muted">Holiday calendar version</dt>
              <dd className="m-0 font-mono text-caption break-all text-ink">
                {day.ruleSnapshot.holidayCalendarVersionId}
              </dd>
            </div>
          ) : null}
          {day.ruleSnapshot.resolutionException ? (
            <div className="grid gap-0.5 min-[621px]:col-span-2">
              <dt className="text-ink-muted">Resolution exception</dt>
              <dd className="m-0 text-ink">
                {words(day.ruleSnapshot.resolutionException.type)} ·{' '}
                {day.ruleSnapshot.resolutionException.message}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="grid gap-1 text-small text-ink-muted">
        <span>
          {day.calculatedAt ? 'Calculated ' + instantLabel(day.calculatedAt) : 'Not yet calculated'}
        </span>
        <span>Record created {instantLabel(day.createdAt)}</span>
      </div>
    </div>
  );
}
