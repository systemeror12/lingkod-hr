import {
  ATTENDANCE_EXCEPTION_TYPES,
  AttendanceExceptionError,
  type DayRuleType,
  type EventPattern,
  type WorkArrangementType,
  type WorkScheduleType,
} from '../attendance-configuration/attendance-configuration.types';
import type { WorkScheduleDayRuleSummary } from '../attendance-configuration/work-schedules.service';

export const ATTENDANCE_EVENT_TYPES = ['TIME_IN', 'BREAK_OUT', 'BREAK_IN', 'TIME_OUT'] as const;
export type AttendanceEventType = (typeof ATTENDANCE_EVENT_TYPES)[number];

export const ATTENDANCE_EVENT_SOURCES = ['WEB_CLOCK', 'MANUAL'] as const;
export type AttendanceEventSource = (typeof ATTENDANCE_EVENT_SOURCES)[number];

export const ATTENDANCE_WEB_CLOCK_VERSION_STATES = ['ACTIVE', 'SUPERSEDED'] as const;
export type AttendanceWebClockVersionState = (typeof ATTENDANCE_WEB_CLOCK_VERSION_STATES)[number];

export const DTR_PRESENTATION_SLOTS = ['AM_IN', 'AM_OUT', 'PM_IN', 'PM_OUT'] as const;
export type DtrPresentationSlot = (typeof DTR_PRESENTATION_SLOTS)[number];

/** Capture-level blocking Attendance Exceptions reported beside a stored raw event. */
export const ATTENDANCE_CAPTURE_EXCEPTION_TYPES = [
  ...ATTENDANCE_EXCEPTION_TYPES,
  'UNMATCHED_ATTENDANCE_EVENT',
  'AMBIGUOUS_ATTENDANCE_EVENT',
  'DUPLICATE_ATTENDANCE_EVENT',
  'MISSING_ATTENDANCE_EVENT',
  'OUT_OF_ORDER_ATTENDANCE_EVENT',
] as const;
export type AttendanceCaptureExceptionType = (typeof ATTENDANCE_CAPTURE_EXCEPTION_TYPES)[number];

export interface AttendanceEventSummary {
  id: string;
  employeeId: string;
  employee: {
    id: string;
    employeeNumber: string;
    legalName: string;
  };
  eventTime: string;
  eventType: AttendanceEventType;
  source: AttendanceEventSource;
  sourceReference: string | null;
  enteredByMembershipId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface AttendanceEventPresentation {
  workDate: string;
  slot: DtrPresentationSlot | null;
  label: string;
}

export interface AttendanceCaptureAssociation {
  workDate: string;
  scheduleAssignmentId: string;
  workScheduleVersionId: string;
  workScheduleVersionNo: number;
  workScheduleCode: string;
  workScheduleName: string;
  scheduleType: WorkScheduleType;
  timezone: string;
  workArrangementVersionId: string;
  workArrangementVersionNo: number;
  workArrangementCode: string;
  workArrangementName: string;
  arrangementType: WorkArrangementType;
  holidayCalendarId: string;
  holidayCalendarVersionId: string;
  holidayEntries: Array<{ name: string; dayType: string; holidayDate: string }>;
  dayRule: {
    weekday: number;
    ruleType: DayRuleType;
    dutyStartTime: string | null;
    earliestStartTime: string | null;
    latestStartTime: string | null;
    dutyEndTime: string | null;
    endNextCalendarDay: boolean;
    eventPattern: EventPattern;
    collectionBeforeMinutes: number;
    collectionAfterMinutes: number;
    breakCount: number;
  };
}

export interface AttendanceCaptureException {
  type: AttendanceCaptureExceptionType;
  message: string;
  details: Record<string, unknown>;
}

export interface AttendanceMatchSummary {
  status: 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS';
  workDate: string | null;
  unscheduled: boolean;
  association: AttendanceCaptureAssociation | null;
  matches: Array<{ workDate: string }>;
}

export interface AttendanceEventCaptureResult {
  event: AttendanceEventSummary;
  match: AttendanceMatchSummary;
  exceptions: AttendanceCaptureException[];
  presentation: AttendanceEventPresentation | null;
}

export interface AttendanceWorkDateContext {
  workDate: string;
  association: AttendanceCaptureAssociation | null;
  exceptions: AttendanceCaptureException[];
  events: Array<AttendanceEventSummary & { presentation: AttendanceEventPresentation | null }>;
}

export interface CreateManualAttendanceEventInput {
  employeeId: string;
  eventType: AttendanceEventType;
  eventTime: string;
  reason: string;
  sourceReference?: string | undefined;
}

export interface ClockAttendanceEventInput {
  eventType?: AttendanceEventType | undefined;
}

export interface SetWebClockEnablementInput {
  enabled: boolean;
  effectiveFrom: string;
  reason: string;
}

export interface AttendanceEventListFilter {
  employeeId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export interface AttendanceWebClockVersionSummary {
  id: string;
  versionNo: number;
  enabled: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: AttendanceWebClockVersionState;
  reason: string;
  activatedByMembershipId: string;
  activatedAt: string;
  createdAt: string;
}

export interface AttendanceWebClockStatusSummary {
  asOf: string;
  enabled: boolean;
  version: AttendanceWebClockVersionSummary | null;
  history: AttendanceWebClockVersionSummary[];
}

export interface AttendanceClockStateSummary {
  asOf: string;
  enabled: boolean;
  employee: {
    id: string;
    employeeNumber: string;
    legalName: string;
  };
  nextEventType: AttendanceEventType | null;
  association: AttendanceCaptureAssociation | null;
  exceptions: AttendanceCaptureException[];
  events: Array<AttendanceEventSummary & { presentation: AttendanceEventPresentation | null }>;
}

const MINUTES_PER_DAY = 1440;

function dateValueOfUtcParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addDateValueDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The calendar date of one instant in the given IANA time zone. */
export function localDateValue(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return dateValueOfUtcParts(value('year'), value('month'), value('day'));
}

function timezoneOffsetMs(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour') % 24,
    value('minute'),
    value('second'),
  );
  return asUtc - instant.getTime();
}

/**
 * Convert one wall-clock date and time in an IANA time zone to an instant.
 * The offset is resolved iteratively so day boundaries and DST transitions do
 * not silently shift an Event Collection Window.
 */
export function zonedTimeToInstant(dateValue: string, timeValue: string, timezone: string): Date {
  const [year, month, day] = dateValue.split('-').map(Number);
  const [hour, minute] = timeValue.split(':').map(Number);
  const wall = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  let instant = wall;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = wall - timezoneOffsetMs(new Date(instant), timezone);
    if (candidate === instant) break;
    instant = candidate;
  }
  return new Date(instant);
}

function minutesOfTime(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour! * 60 + minute!;
}

function timeValueOfMinutes(minutes: number): string {
  const normalized = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

export interface AttendanceEventCollectionWindow {
  workDate: string;
  start: Date;
  end: Date;
}

/**
 * The Event Collection Window of one Day Rule. A REST Day Rule has no window;
 * events associate with it by their local date instead. Collection offsets only
 * widen the window, they never act as grace or rounding rules.
 */
export function eventCollectionWindow(
  dayRule: WorkScheduleDayRuleSummary,
  workDate: string,
  timezone: string,
): AttendanceEventCollectionWindow | null {
  if (dayRule.ruleType === 'REST') return null;
  const anchor = dayRule.ruleType === 'FIXED' ? dayRule.dutyStartTime : dayRule.earliestStartTime;
  if (!anchor || !dayRule.dutyEndTime) return null;
  const rawStartMinute = minutesOfTime(anchor) - dayRule.collectionBeforeMinutes;
  const startDayOffset = Math.floor(rawStartMinute / MINUTES_PER_DAY);
  const rawEndMinute =
    minutesOfTime(dayRule.dutyEndTime) +
    (dayRule.endNextCalendarDay ? MINUTES_PER_DAY : 0) +
    dayRule.collectionAfterMinutes;
  const endDayOffset = Math.floor(rawEndMinute / MINUTES_PER_DAY);
  const start = zonedTimeToInstant(
    addDateValueDays(workDate, startDayOffset),
    timeValueOfMinutes(rawStartMinute),
    timezone,
  );
  const end = zonedTimeToInstant(
    addDateValueDays(workDate, endDayOffset),
    timeValueOfMinutes(rawEndMinute),
    timezone,
  );
  return { workDate, start, end };
}

export class AttendanceServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'AttendanceServiceError';
  }
}

export function captureException(
  type: AttendanceCaptureExceptionType,
  message: string,
  details: Record<string, unknown> = {},
): AttendanceCaptureException {
  return { type, message, details };
}

export function attendanceExceptionDetails(error: unknown): AttendanceCaptureException | null {
  if (!(error instanceof AttendanceExceptionError)) return null;
  return {
    type: error.exceptionType,
    message: error.message,
    details: error.details,
  };
}
