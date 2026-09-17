import { Prisma } from '@prisma/client';

export const WORK_SCHEDULE_TYPES = ['REGULAR', 'FLEXIBLE', 'SHIFT', 'COMPRESSED'] as const;
export type WorkScheduleType = (typeof WORK_SCHEDULE_TYPES)[number];

export const WORK_SCHEDULE_VERSION_STATES = ['DRAFT', 'ACTIVE', 'SUPERSEDED'] as const;
export type WorkScheduleVersionState = (typeof WORK_SCHEDULE_VERSION_STATES)[number];

export const DAY_RULE_TYPES = ['REST', 'FIXED', 'FLEXIBLE'] as const;
export type DayRuleType = (typeof DAY_RULE_TYPES)[number];

export const EVENT_PATTERNS = ['IN_OUT', 'WITH_BREAK_EVENTS'] as const;
export type EventPattern = (typeof EVENT_PATTERNS)[number];

export const WORK_ARRANGEMENT_TYPES = [
  'ONSITE',
  'WORK_FROM_HOME',
  'HYBRID',
  'FIELD',
  'OTHER',
] as const;
export type WorkArrangementType = (typeof WORK_ARRANGEMENT_TYPES)[number];

export const WORK_ARRANGEMENT_VERSION_STATES = ['DRAFT', 'ACTIVE', 'SUPERSEDED'] as const;
export type WorkArrangementVersionState = (typeof WORK_ARRANGEMENT_VERSION_STATES)[number];

export const HOLIDAY_CALENDAR_SCOPE_TYPES = ['AGENCY', 'OFFICE', 'WORKSITE'] as const;
export type HolidayCalendarScopeType = (typeof HOLIDAY_CALENDAR_SCOPE_TYPES)[number];

/** ISO-8601 weekday: 1 = Monday through 7 = Sunday. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

const MINUTES_PER_DAY = 1440;

export interface AttendanceConfigurationBreakInput {
  breakStartTime: string;
  breakEndTime: string;
  endNextCalendarDay?: boolean | undefined;
}

export interface AttendanceConfigurationDayRuleInput {
  weekday: number;
  ruleType: DayRuleType;
  dutyStartTime?: string | null | undefined;
  earliestStartTime?: string | null | undefined;
  latestStartTime?: string | null | undefined;
  dutyEndTime?: string | null | undefined;
  endNextCalendarDay?: boolean | undefined;
  requiredMinutes: number;
  coreStartTime?: string | null | undefined;
  coreEndTime?: string | null | undefined;
  eventPattern: EventPattern;
  collectionBeforeMinutes: number;
  collectionAfterMinutes: number;
  breaks?: AttendanceConfigurationBreakInput[] | undefined;
}

export interface WorkScheduleDefinitionInput {
  scheduleType: WorkScheduleType;
  timezone?: string | undefined;
  effectiveDate: string;
  dayRules: AttendanceConfigurationDayRuleInput[];
}

export interface CreateWorkScheduleInput extends WorkScheduleDefinitionInput {
  code: string;
  name: string;
}

export interface UpdateWorkScheduleDraftInput extends WorkScheduleDefinitionInput {
  rowVersion?: number | undefined;
}

export interface WorkArrangementDefinitionInput {
  arrangementType: WorkArrangementType;
  permittedScheduleTypes: WorkScheduleType[];
  holidayCalendarId: string;
  effectiveDate: string;
}

export interface CreateWorkArrangementInput extends WorkArrangementDefinitionInput {
  code: string;
  name: string;
}

export interface UpdateWorkArrangementDraftInput extends WorkArrangementDefinitionInput {
  rowVersion?: number | undefined;
}

export interface ActivateAttendanceConfigurationInput {
  authorityDocumentVersionId: string;
  approvingAuthority: string;
  reason: string;
}

export interface NormalizedBreakInterval {
  sequenceNo: number;
  breakStartTime: string;
  breakEndTime: string;
  endNextCalendarDay: boolean;
}

export interface NormalizedDayRule {
  weekday: number;
  ruleType: DayRuleType;
  dutyStartTime: string | null;
  earliestStartTime: string | null;
  latestStartTime: string | null;
  dutyEndTime: string | null;
  endNextCalendarDay: boolean;
  requiredMinutes: number;
  coreStartTime: string | null;
  coreEndTime: string | null;
  eventPattern: EventPattern;
  collectionBeforeMinutes: number;
  collectionAfterMinutes: number;
  breaks: NormalizedBreakInterval[];
}

export interface WorkScheduleVersionDefinition {
  scheduleType: WorkScheduleType;
  timezone: string;
  effectiveDate: string;
  dayRules: NormalizedDayRule[];
}

export interface WorkArrangementVersionDefinition {
  arrangementType: WorkArrangementType;
  permittedScheduleTypes: WorkScheduleType[];
  holidayCalendarId: string;
  effectiveDate: string;
}

export function toDatabaseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw dateInvalid();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw dateInvalid();
  }
  return date;
}

export function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function manilaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function parseTime(value: string, message: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value.trim());
  if (!match) throw invalid(message);
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function toTimeValue(minutes: number): Date {
  return new Date(Date.UTC(1970, 0, 1, Math.floor(minutes / 60), minutes % 60));
}

export function fromTimeValue(value: Date): string {
  return formatTime(value.getUTCHours() * 60 + value.getUTCMinutes());
}

function assertTimezone(value: string): string {
  const timezone = value.trim();
  if (!timezone) throw invalid('A time zone is required for every Work Schedule Version.');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw invalid('The Work Schedule Version time zone is not a recognized IANA time zone.');
  }
  return timezone;
}

function assertRequiredMinutes(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MINUTES_PER_DAY) {
    throw invalid('Required minutes must be a whole number between 0 and 1440.');
  }
  return value;
}

function assertCollectionOffset(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > MINUTES_PER_DAY) {
    throw invalid(`${label} must be a whole number between 0 and 1440.`);
  }
  return value;
}

export function invalid(message: string): AttendanceConfigurationServiceError {
  return new AttendanceConfigurationServiceError(
    message,
    400,
    'ATTENDANCE_CONFIGURATION_INVALID_INPUT',
  );
}

function dateInvalid(): AttendanceConfigurationServiceError {
  return new AttendanceConfigurationServiceError(
    'The effective date is invalid.',
    400,
    'ATTENDANCE_CONFIGURATION_DATE_INVALID',
  );
}

export class AttendanceConfigurationServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'AttendanceConfigurationServiceError';
  }
}

function normalizeBreaks(
  input: AttendanceConfigurationBreakInput[],
  windowStartMinute: number,
  windowEndMinute: number,
  crossesMidnight: boolean,
  label: string,
): { breaks: NormalizedBreakInterval[]; totalMinutes: number } {
  const intervals = input.map((item) => {
    const endFlag = item.endNextCalendarDay ?? false;
    const start = parseTime(item.breakStartTime, `${label} break start time is invalid.`);
    const end = parseTime(item.breakEndTime, `${label} break end time is invalid.`);
    const dayOffset = crossesMidnight && start < windowStartMinute ? MINUTES_PER_DAY : 0;
    const startAbsolute = start + dayOffset;
    const endAbsolute = end + dayOffset + (endFlag ? MINUTES_PER_DAY : 0);
    if (endAbsolute <= startAbsolute) {
      throw invalid(`${label} break intervals must end after they start.`);
    }
    if (startAbsolute < windowStartMinute || endAbsolute > windowEndMinute) {
      throw invalid(
        `${label} break intervals must fall inside the paid duty window for the day rule.`,
      );
    }
    return {
      sequenceNo: 0,
      breakStartTime: formatTime(start),
      breakEndTime: formatTime(end),
      endNextCalendarDay: endFlag,
      startAbsolute,
      endAbsolute,
    };
  });
  intervals.sort((a, b) => a.startAbsolute - b.startAbsolute);
  intervals.forEach((interval, index) => {
    interval.sequenceNo = index + 1;
    const previous = intervals[index - 1];
    if (previous && previous.endAbsolute > interval.startAbsolute) {
      throw invalid(`${label} break intervals cannot overlap.`);
    }
  });
  return {
    breaks: intervals.map((interval) => ({
      sequenceNo: interval.sequenceNo,
      breakStartTime: interval.breakStartTime,
      breakEndTime: interval.breakEndTime,
      endNextCalendarDay: interval.endNextCalendarDay,
    })),
    totalMinutes: intervals.reduce(
      (total, interval) => total + (interval.endAbsolute - interval.startAbsolute),
      0,
    ),
  };
}

function assertCollectionWindow(
  offsetBefore: number,
  offsetAfter: number,
  anchorStartMinute: number,
  dutyEndMinute: number,
  endNextCalendarDay: boolean,
): void {
  if (anchorStartMinute - offsetBefore < 0) {
    throw invalid('The Event Collection Window cannot start before midnight of the Work Date.');
  }
  if (!endNextCalendarDay && dutyEndMinute + offsetAfter >= MINUTES_PER_DAY) {
    throw invalid(
      'The Event Collection Window must end before midnight unless the Day Rule itself ends on the next calendar day.',
    );
  }
}

function normalizeDayRule(input: AttendanceConfigurationDayRuleInput): NormalizedDayRule {
  const weekdayLabel = `Weekday ${input.weekday}`;
  if (!Number.isInteger(input.weekday) || input.weekday < 1 || input.weekday > 7) {
    throw invalid('Each Day Rule must name one weekday between 1 (Monday) and 7 (Sunday).');
  }
  const requiredMinutes = assertRequiredMinutes(input.requiredMinutes);
  const endNextCalendarDay = input.endNextCalendarDay ?? false;
  const collectionBeforeMinutes = assertCollectionOffset(
    input.collectionBeforeMinutes,
    `${weekdayLabel} Event Collection Window opening offset`,
  );
  const collectionAfterMinutes = assertCollectionOffset(
    input.collectionAfterMinutes,
    `${weekdayLabel} Event Collection Window closing offset`,
  );
  const dutyStartTime = input.dutyStartTime?.trim() || null;
  const earliestStartTime = input.earliestStartTime?.trim() || null;
  const latestStartTime = input.latestStartTime?.trim() || null;
  const dutyEndTime = input.dutyEndTime?.trim() || null;
  const coreStartTime = input.coreStartTime?.trim() || null;
  const coreEndTime = input.coreEndTime?.trim() || null;
  const rawBreaks = input.breaks ?? [];

  if (input.ruleType === 'REST') {
    if (dutyStartTime || earliestStartTime || latestStartTime || dutyEndTime) {
      throw invalid('A rest Day Rule cannot declare duty or flexible start times.');
    }
    if (coreStartTime || coreEndTime) {
      throw invalid('A rest Day Rule cannot declare core hours.');
    }
    if (requiredMinutes !== 0) {
      throw invalid('A rest Day Rule must require zero minutes.');
    }
    if (input.eventPattern !== 'IN_OUT') {
      throw invalid('A rest Day Rule cannot require break events.');
    }
    if (collectionBeforeMinutes !== 0 || collectionAfterMinutes !== 0) {
      throw invalid('A rest Day Rule cannot declare an Event Collection Window.');
    }
    if (rawBreaks.length > 0) {
      throw invalid('A rest Day Rule cannot declare unpaid break intervals.');
    }
    return {
      weekday: input.weekday,
      ruleType: 'REST',
      dutyStartTime: null,
      earliestStartTime: null,
      latestStartTime: null,
      dutyEndTime: null,
      endNextCalendarDay: false,
      requiredMinutes: 0,
      coreStartTime: null,
      coreEndTime: null,
      eventPattern: 'IN_OUT',
      collectionBeforeMinutes: 0,
      collectionAfterMinutes: 0,
      breaks: [],
    };
  }

  if (input.ruleType === 'FIXED') {
    if (!dutyStartTime || !dutyEndTime) {
      throw invalid('A fixed Day Rule requires a duty start time and a duty end time.');
    }
    if (earliestStartTime || latestStartTime) {
      throw invalid('A fixed Day Rule cannot declare flexible start bounds.');
    }
    if (coreStartTime || coreEndTime) {
      throw invalid('A fixed Day Rule carries no separate core hours.');
    }
    const dutyStartMinute = parseTime(dutyStartTime, 'Duty start time is invalid.');
    const dutyEndMinute = parseTime(dutyEndTime, 'Duty end time is invalid.');
    const dutyEndAbsolute = dutyEndMinute + (endNextCalendarDay ? MINUTES_PER_DAY : 0);
    if (!endNextCalendarDay && dutyEndMinute <= dutyStartMinute) {
      throw invalid(
        'A fixed Day Rule must end after it starts unless it ends on the next calendar day.',
      );
    }
    if (endNextCalendarDay && dutyEndMinute > dutyStartMinute) {
      throw invalid(
        'A Day Rule that ends on the next calendar day must end at or before its start time.',
      );
    }
    const breaks = normalizeBreaks(
      rawBreaks,
      dutyStartMinute,
      dutyEndAbsolute,
      endNextCalendarDay,
      weekdayLabel,
    );
    const expectedMinutes = dutyEndAbsolute - dutyStartMinute - breaks.totalMinutes;
    if (expectedMinutes <= 0) {
      throw invalid(
        'A fixed Day Rule must leave at least one required minute after unpaid breaks.',
      );
    }
    if (expectedMinutes !== requiredMinutes) {
      throw invalid(
        `${weekdayLabel} required minutes must equal the duty window minus unpaid breaks (${expectedMinutes} minutes).`,
      );
    }
    assertCollectionWindow(
      collectionBeforeMinutes,
      collectionAfterMinutes,
      dutyStartMinute,
      dutyEndMinute,
      endNextCalendarDay,
    );
    return {
      weekday: input.weekday,
      ruleType: 'FIXED',
      dutyStartTime: formatTime(dutyStartMinute),
      earliestStartTime: null,
      latestStartTime: null,
      dutyEndTime: formatTime(dutyEndMinute),
      endNextCalendarDay,
      requiredMinutes,
      coreStartTime: null,
      coreEndTime: null,
      eventPattern: input.eventPattern,
      collectionBeforeMinutes,
      collectionAfterMinutes,
      breaks: breaks.breaks,
    };
  }

  if (dutyStartTime) {
    throw invalid('A flexible Day Rule cannot declare a fixed duty start time.');
  }
  if (!earliestStartTime || !latestStartTime || !dutyEndTime) {
    throw invalid(
      'A flexible Day Rule requires an earliest start, a latest start, and a duty end time.',
    );
  }
  const earliestStartMinute = parseTime(earliestStartTime, 'Earliest start time is invalid.');
  const latestStartMinute = parseTime(latestStartTime, 'Latest start time is invalid.');
  const dutyEndMinute = parseTime(dutyEndTime, 'Duty end time is invalid.');
  if (earliestStartMinute >= latestStartMinute) {
    throw invalid('A flexible Day Rule must open its permitted start window before it closes.');
  }
  const dutyEndAbsolute = dutyEndMinute + (endNextCalendarDay ? MINUTES_PER_DAY : 0);
  if (dutyEndAbsolute <= latestStartMinute) {
    throw invalid('A flexible Day Rule must end after its latest permitted start.');
  }
  const breaks = normalizeBreaks(
    rawBreaks,
    latestStartMinute,
    dutyEndAbsolute,
    endNextCalendarDay,
    weekdayLabel,
  );
  const expectedMinutes = dutyEndAbsolute - latestStartMinute - breaks.totalMinutes;
  if (expectedMinutes !== requiredMinutes) {
    throw invalid(
      `${weekdayLabel} required minutes must equal the window from the latest permitted start to the duty end after unpaid breaks (${expectedMinutes} minutes).`,
    );
  }
  let normalizedCoreStart: string | null = null;
  let normalizedCoreEnd: string | null = null;
  if (coreStartTime || coreEndTime) {
    if (!coreStartTime || !coreEndTime) {
      throw invalid('Core hours require both a core start time and a core end time.');
    }
    const coreStartMinute = parseTime(coreStartTime, 'Core start time is invalid.');
    const coreEndMinute = parseTime(coreEndTime, 'Core end time is invalid.');
    const coreEndAbsolute = coreEndMinute + (endNextCalendarDay ? MINUTES_PER_DAY : 0);
    if (coreEndAbsolute <= coreStartMinute) {
      throw invalid('Core hours must end after they start.');
    }
    if (coreStartMinute < latestStartMinute || coreEndAbsolute > dutyEndAbsolute) {
      throw invalid('Core hours must fall inside the guaranteed duty window.');
    }
    normalizedCoreStart = formatTime(coreStartMinute);
    normalizedCoreEnd = formatTime(coreEndMinute);
  }
  assertCollectionWindow(
    collectionBeforeMinutes,
    collectionAfterMinutes,
    earliestStartMinute,
    dutyEndMinute,
    endNextCalendarDay,
  );
  return {
    weekday: input.weekday,
    ruleType: 'FLEXIBLE',
    dutyStartTime: null,
    earliestStartTime: formatTime(earliestStartMinute),
    latestStartTime: formatTime(latestStartMinute),
    dutyEndTime: formatTime(dutyEndMinute),
    endNextCalendarDay,
    requiredMinutes,
    coreStartTime: normalizedCoreStart,
    coreEndTime: normalizedCoreEnd,
    eventPattern: input.eventPattern,
    collectionBeforeMinutes,
    collectionAfterMinutes,
    breaks: breaks.breaks,
  };
}

export function normalizeDayRules(
  input: readonly AttendanceConfigurationDayRuleInput[],
): NormalizedDayRule[] {
  if (input.length !== WEEKDAYS.length) {
    throw invalid('A Work Schedule Version requires exactly seven Day Rules.');
  }
  const byWeekday = new Map<number, AttendanceConfigurationDayRuleInput>();
  for (const rule of input) {
    if (byWeekday.has(rule.weekday)) {
      throw invalid('A Work Schedule Version requires exactly one Day Rule per weekday.');
    }
    byWeekday.set(rule.weekday, rule);
  }
  return WEEKDAYS.map((weekday) => {
    const rule = byWeekday.get(weekday);
    if (!rule) throw invalid('A Work Schedule Version requires exactly seven Day Rules.');
    return normalizeDayRule(rule);
  });
}

export function normalizeScheduleDefinition(
  input: WorkScheduleDefinitionInput,
): WorkScheduleVersionDefinition {
  return {
    scheduleType: input.scheduleType,
    timezone: assertTimezone(input.timezone ?? 'Asia/Manila'),
    effectiveDate: formatDate(toDatabaseDate(input.effectiveDate)),
    dayRules: normalizeDayRules(input.dayRules),
  };
}

export function normalizeArrangementDefinition(
  input: WorkArrangementDefinitionInput,
): WorkArrangementVersionDefinition {
  if (!input.holidayCalendarId.trim()) {
    throw invalid('A Work Arrangement Version must select one Holiday Calendar.');
  }
  const permitted: WorkScheduleType[] = [];
  for (const scheduleType of input.permittedScheduleTypes) {
    if (!WORK_SCHEDULE_TYPES.includes(scheduleType)) {
      throw invalid('A Work Arrangement Version permits only supported Work Schedule types.');
    }
    if (!permitted.includes(scheduleType)) permitted.push(scheduleType);
  }
  if (permitted.length === 0) {
    throw invalid('A Work Arrangement Version must permit at least one Work Schedule type.');
  }
  return {
    arrangementType: input.arrangementType,
    permittedScheduleTypes: permitted,
    holidayCalendarId: input.holidayCalendarId.trim(),
    effectiveDate: formatDate(toDatabaseDate(input.effectiveDate)),
  };
}

export function timeValueOf(value: string): Date {
  return toTimeValue(parseTime(value, 'Time is invalid.'));
}

export function timeColumn(value: string | null): Date | null {
  if (value === null) return null;
  return timeValueOf(value);
}

export function inputJsonList(value: Prisma.JsonValue): Prisma.InputJsonArray {
  return Array.isArray(value) ? (value as Prisma.InputJsonArray) : [];
}
