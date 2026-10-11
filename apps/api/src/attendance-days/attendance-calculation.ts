import { createHash } from 'node:crypto';
import type { WorkScheduleDayRuleSummary } from '../attendance-configuration/work-schedules.service';
import {
  ATTENDANCE_EXCEPTION_TYPES,
  type DayRuleType,
  type EventPattern,
} from '../attendance-configuration/attendance-configuration.types';
import {
  evaluateAttendanceSequence,
  ATTENDANCE_SEQUENCE_ISSUE_TYPES,
} from '../attendance/attendance-matching';
import {
  addDateValueDays,
  localDateValue,
  zonedTimeToInstant,
  type AttendanceEventType,
} from '../attendance/attendance.types';

/**
 * Blocking Attendance Exception causes an Attendance Day calculation can carry.
 * Resolution failures raised by Schedule Assignments keep their own vocabulary;
 * the calculation adds sequence, coverage, and holiday-effect causes.
 */
export const ATTENDANCE_DAY_EXCEPTION_TYPES = [
  ...ATTENDANCE_EXCEPTION_TYPES,
  ...ATTENDANCE_SEQUENCE_ISSUE_TYPES,
  'INCOMPLETE_WORK_SCHEDULE_VERSION',
  'UNSUPPORTED_HOLIDAY_EFFECT',
  'CONFLICTING_COVERAGE',
  'INCOMPLETE_COVERAGE_INPUT',
  'AMBIGUOUS_LEAVE_QUANTITY',
] as const;
export type AttendanceDayExceptionType = (typeof ATTENDANCE_DAY_EXCEPTION_TYPES)[number];

export interface AttendanceCalculationException {
  type: AttendanceDayExceptionType;
  message: string;
  details: Record<string, unknown>;
}

export const ATTENDANCE_COVERAGE_TYPES = [
  'WORKED',
  'OFFICIAL_BUSINESS',
  'OFFICIAL_TRAVEL',
  'TRAINING',
  'APPROVED_ABSENCE',
  'POSTED_LEAVE',
  'UNCOVERED',
] as const;
export type AttendanceCoverageType = (typeof ATTENDANCE_COVERAGE_TYPES)[number];

export type AttendanceDeficitType = 'TARDINESS' | 'UNDERTIME' | 'ABSENCE';

export interface AttendanceCalculationEvent {
  id: string;
  eventType: AttendanceEventType;
  eventTime: Date;
}

export interface AttendanceCalculationCoverage {
  sourceType: 'ATTENDANCE_CONTEXT' | 'POSTED_LEAVE';
  sourceId: string;
  coverageType: Exclude<AttendanceCoverageType, 'WORKED' | 'UNCOVERED'>;
  startsAt: Date;
  endsAt: Date;
}

/**
 * The effective governing records a calculation resolves for one Work Date.
 * They do not change the arithmetic, but a new effective version with identical
 * rules still makes a stored calculation version stale, so they belong in the
 * input fingerprint.
 */
export interface AttendanceDayGoverningVersions {
  assignmentId: string;
  workScheduleVersionId: string;
  workArrangementVersionId: string;
  holidayCalendarVersionId: string;
}

export interface AttendanceDayCalculationInput {
  timezone: string;
  workDate: string;
  dayRule: WorkScheduleDayRuleSummary;
  events: readonly AttendanceCalculationEvent[];
  coverage: readonly AttendanceCalculationCoverage[];
  /** Holiday classification by actual local calendar date. */
  holidayClassifications: ReadonlyMap<string, string>;
  /** Authority-backed effect per holiday classification of the Work Schedule Version. */
  holidayEffectRules: Record<string, unknown>;
  governingVersions?: AttendanceDayGoverningVersions | undefined;
  /**
   * Sources the calculation could not place, such as an ambiguous posted-leave
   * quantity. They contribute no coverage but still change the Day's inputs.
   */
  unplacedSources?: readonly { sourceType: string; sourceId: string }[] | undefined;
}

export interface AttendanceCalculationSegment {
  startsAt: Date;
  endsAt: Date;
  dutyRelation: 'EXPECTED' | 'OUTSIDE_SCHEDULE';
  coverageType: AttendanceCoverageType;
  deficitType: AttendanceDeficitType | null;
  holidayClassification: string | null;
  sources: Array<{ sourceType: string; id: string }>;
}

export interface AttendanceCalculationTotals {
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

export interface AttendanceDayCalculationResult {
  segments: AttendanceCalculationSegment[];
  totals: AttendanceCalculationTotals;
  exceptions: AttendanceCalculationException[];
}

interface Interval {
  start: number;
  end: number;
}

/** One Day Rule reduced to exact instants for a Work Date. */
interface MinuteDayRule {
  ruleType: DayRuleType;
  anchorStartMinute: number | null;
  latestStartMinute: number | null;
  dutyEndMinute: number | null;
  eventPattern: EventPattern;
  breaks: Interval[];
}

const MINUTES_PER_DAY = 1440;
const NIGHT_WINDOW_START_MINUTE = 22 * 60;
const NIGHT_WINDOW_END_MINUTE = 6 * 60;
/** Defensive bound so malformed upstream data cannot spin over years of minutes. */
const MAX_CALCULATED_MINUTES = 3 * MINUTES_PER_DAY;
const MAX_SEGMENT_MINUTES = MINUTES_PER_DAY;

const COVERAGE_TOTAL_KEYS: Partial<
  Record<AttendanceCoverageType, keyof AttendanceCalculationTotals>
> = {
  OFFICIAL_BUSINESS: 'officialBusinessMinutes',
  OFFICIAL_TRAVEL: 'officialTravelMinutes',
  TRAINING: 'trainingMinutes',
  APPROVED_ABSENCE: 'approvedAbsenceMinutes',
  POSTED_LEAVE: 'postedLeaveMinutes',
};

/**
 * The minute convention of ADR 0005, recorded in the rule snapshot and the
 * input fingerprint so a Day calculated under another convention reads stale.
 */
export const ATTENDANCE_MINUTE_RULE = 'FULLY_COVERED_MINUTE';

/** The whole minute a boundary falls in; minutes are the ledger's unit of account. */
function minuteOf(value: Date): number {
  return Math.floor(value.getTime() / 60_000);
}

/**
 * The Fully Covered Minutes of a timed interval: its start moves up to the next
 * whole minute and its end moves down, so a partial minute stays uncovered.
 */
function fullyCoveredInterval(startsAt: Date, endsAt: Date): Interval {
  return { start: Math.ceil(startsAt.getTime() / 60_000), end: minuteOf(endsAt) };
}

function instantOf(minute: number): Date {
  return new Date(minute * 60_000);
}

function minutesOfTimeValue(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour! * 60 + minute!;
}

function clampInterval(interval: Interval, limit: Interval): Interval | null {
  const start = Math.max(interval.start, limit.start);
  const end = Math.min(interval.end, limit.end);
  return end > start ? { start, end } : null;
}

function subtractIntervals(base: Interval, removals: readonly Interval[]): Interval[] {
  const sorted = removals
    .map((removal) => clampInterval(removal, base))
    .filter((removal): removal is Interval => removal !== null)
    .sort((left, right) => left.start - right.start);
  const result: Interval[] = [];
  let cursor = base.start;
  for (const removal of sorted) {
    if (removal.start > cursor) result.push({ start: cursor, end: removal.start });
    cursor = Math.max(cursor, removal.end);
  }
  if (cursor < base.end) result.push({ start: cursor, end: base.end });
  return result;
}

function intersect(left: readonly Interval[], right: readonly Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const first of left) {
    for (const second of right) {
      const overlap = clampInterval(first, second);
      if (overlap) result.push(overlap);
    }
  }
  return mergeIntervals(result);
}

function totalMinutes(intervals: readonly Interval[]): number {
  return intervals.reduce((total, interval) => total + (interval.end - interval.start), 0);
}

function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort((left, right) => left.start - right.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
      continue;
    }
    merged.push({ ...interval });
  }
  return merged;
}

function dayBoundary(dateValue: string, timezone: string): number {
  return minuteOf(zonedTimeToInstant(dateValue, '00:00', timezone));
}

/**
 * Materialize a Day Rule into exact instants for one Work Date. Wall-clock
 * times resolve through the schedule time zone, and the next-calendar-day flags
 * move the duty end and any overnight break the same way the configuration
 * normalization did, so a break is subtracted from the window it belongs to.
 */
function materializeDayRule(
  dayRule: WorkScheduleDayRuleSummary,
  workDate: string,
  timezone: string,
): MinuteDayRule {
  const wallMinutesOf = (value: string | null): number | null =>
    value === null ? null : minutesOfTimeValue(value);
  const instantOfWall = (value: string, dayOffset: number): number =>
    minuteOf(zonedTimeToInstant(addDateValueDays(workDate, dayOffset), value, timezone));
  const crossesMidnight = dayRule.endNextCalendarDay;
  const dutyStartWall = wallMinutesOf(dayRule.dutyStartTime);
  const dutyEndOffset = crossesMidnight ? 1 : 0;
  const anchorStartMinute =
    dayRule.ruleType === 'FIXED'
      ? dayRule.dutyStartTime === null
        ? null
        : instantOfWall(dayRule.dutyStartTime, 0)
      : dayRule.ruleType === 'FLEXIBLE'
        ? dayRule.earliestStartTime === null
          ? null
          : instantOfWall(dayRule.earliestStartTime, 0)
        : null;
  const dutyEndMinute =
    dayRule.dutyEndTime === null ? null : instantOfWall(dayRule.dutyEndTime, dutyEndOffset);
  const breaks: Interval[] = dayRule.breaks
    .map((item) => {
      const startWall = minutesOfTimeValue(item.breakStartTime);
      const dayOffset =
        crossesMidnight && dutyStartWall !== null && startWall < dutyStartWall ? 1 : 0;
      const endOffset = dayOffset + (item.endNextCalendarDay ? 1 : 0);
      return {
        start: instantOfWall(item.breakStartTime, dayOffset),
        end: instantOfWall(item.breakEndTime, endOffset),
      };
    })
    .sort((left, right) => left.start - right.start);
  return {
    ruleType: dayRule.ruleType,
    anchorStartMinute,
    latestStartMinute:
      dayRule.latestStartTime === null ? null : instantOfWall(dayRule.latestStartTime, 0),
    dutyEndMinute,
    eventPattern: dayRule.eventPattern,
    breaks,
  };
}

/**
 * Cover one whole Work Date for posted leave or an Attendance Context that
 * carries no clock time. A fixed Day Rule covers its duty window; a flexible
 * Day Rule covers its earliest permitted start through the duty end so the
 * interval still qualifies as coverage without anchoring the flexible start by
 * itself. Scheduled unpaid breaks are not expected duty, so they stay outside
 * the covered intervals.
 */
export function wholeWorkDateCoverageIntervals(
  dayRule: WorkScheduleDayRuleSummary,
  workDate: string,
  timezone: string,
): Array<{ startsAt: Date; endsAt: Date }> {
  const rule = materializeDayRule(dayRule, workDate, timezone);
  if (rule.ruleType === 'REST') return [];
  if (rule.anchorStartMinute === null || rule.dutyEndMinute === null) return [];
  return expectedIntervals(rule, rule.anchorStartMinute).map((interval) => ({
    startsAt: instantOf(interval.start),
    endsAt: instantOf(interval.end),
  }));
}

/**
 * Derive worked intervals from the semantic event sequence. An `IN_OUT` Day
 * Rule excludes its scheduled unpaid breaks from the elapsed duty span, while a
 * `WITH_BREAK_EVENTS` Day Rule excludes the recorded break pairs. A day without
 * a closing `TIME_OUT` yields no worked minutes and is reported by the sequence
 * check instead.
 */
function workedIntervals(
  rule: MinuteDayRule,
  events: readonly AttendanceCalculationEvent[],
): Interval[] {
  const ordered = [...events].sort(
    (left, right) => left.eventTime.getTime() - right.eventTime.getTime(),
  );
  const timeIn = ordered.find((event) => event.eventType === 'TIME_IN');
  const timeOut = [...ordered].reverse().find((event) => event.eventType === 'TIME_OUT');
  if (!timeIn || !timeOut) return [];
  const span = fullyCoveredInterval(timeIn.eventTime, timeOut.eventTime);
  if (span.end <= span.start) return [];
  if (rule.eventPattern === 'IN_OUT') return subtractIntervals(span, rule.breaks);
  const breakOuts = ordered.filter((event) => event.eventType === 'BREAK_OUT');
  const breakIns = ordered.filter((event) => event.eventType === 'BREAK_IN');
  const breaks: Interval[] = [];
  for (let index = 0; index < breakOuts.length; index += 1) {
    const breakOut = breakOuts[index]!;
    const breakIn = breakIns[index];
    if (!breakIn) continue;
    // A recorded break removes every minute it touches, so worked time stays
    // within the raw events on either side of it.
    breaks.push({
      start: minuteOf(breakOut.eventTime),
      end: Math.ceil(breakIn.eventTime.getTime() / 60_000),
    });
  }
  return subtractIntervals(span, breaks);
}

function expectedIntervals(rule: MinuteDayRule, anchorMinute: number): Interval[] {
  if (rule.dutyEndMinute === null || rule.dutyEndMinute <= anchorMinute) return [];
  return subtractIntervals(
    { start: anchorMinute, end: rule.dutyEndMinute },
    rule.breaks.map((item) => ({ start: item.start, end: item.end })),
  );
}

function flexibleAnchorMinute(rule: MinuteDayRule, qualifying: readonly Interval[]): number | null {
  const earliest = rule.anchorStartMinute;
  const latest = rule.latestStartMinute;
  if (earliest === null || latest === null) return null;
  if (qualifying.length === 0) return latest;
  const firstStart = Math.min(...qualifying.map((interval) => interval.start));
  if (firstStart < earliest) return earliest;
  if (firstStart > latest) return latest;
  return firstStart;
}

interface PendingSegment {
  start: number;
  end: number;
  expected: boolean;
  holiday: string | null;
  coverage: {
    coverageType: AttendanceCoverageType;
    sources: Array<{ sourceType: string; id: string }>;
  } | null;
  deficit: AttendanceDeficitType | null;
}

/**
 * A fully uncovered expected day is absence. Otherwise leading uncovered
 * minutes are tardiness, trailing uncovered minutes are undertime, and internal
 * uncovered minutes are absence.
 */
function classifyDeficits(segments: PendingSegment[]): void {
  const uncovered = segments.filter((segment) => segment.expected && segment.coverage === null);
  if (uncovered.length === 0) return;
  const covered = segments.filter((segment) => segment.expected && segment.coverage !== null);
  for (const segment of uncovered) {
    if (covered.length === 0) {
      segment.deficit = 'ABSENCE';
      continue;
    }
    const firstCoveredStart = Math.min(...covered.map((item) => item.start));
    const lastCoveredEnd = Math.max(...covered.map((item) => item.end));
    segment.deficit =
      segment.end <= firstCoveredStart
        ? 'TARDINESS'
        : segment.start >= lastCoveredEnd
          ? 'UNDERTIME'
          : 'ABSENCE';
  }
}

function nightWindowIntervals(workDate: string, timezone: string): Interval[] {
  const today = dayBoundary(workDate, timezone);
  const tomorrow = dayBoundary(addDateValueDays(workDate, 1), timezone);
  const dayAfter = dayBoundary(addDateValueDays(workDate, 2), timezone);
  const intervals: Interval[] = [
    { start: today + NIGHT_WINDOW_START_MINUTE, end: tomorrow + NIGHT_WINDOW_END_MINUTE },
  ];
  if (dayAfter - tomorrow === MINUTES_PER_DAY) {
    intervals.push({
      start: tomorrow + NIGHT_WINDOW_START_MINUTE,
      end: dayAfter + NIGHT_WINDOW_END_MINUTE,
    });
  }
  return intervals;
}

function splitByCalendarDate(
  interval: Interval,
  timezone: string,
): Array<Interval & { dateValue: string }> {
  const pieces: Array<Interval & { dateValue: string }> = [];
  let cursor = interval.start;
  let dateValue = localDateValue(instantOf(cursor), timezone);
  let guard = 0;
  while (cursor < interval.end && guard < 4) {
    const nextBoundary = dayBoundary(addDateValueDays(dateValue, 1), timezone);
    const end = Math.min(interval.end, nextBoundary);
    pieces.push({ start: cursor, end, dateValue });
    cursor = end;
    dateValue = addDateValueDays(dateValue, 1);
    guard += 1;
  }
  return pieces;
}

function sourceKey(source: { sourceType: string; id: string }): string {
  return `${source.sourceType}:${source.id}`;
}

function sequenceException(issue: {
  type: (typeof ATTENDANCE_SEQUENCE_ISSUE_TYPES)[number];
  eventType: AttendanceEventType;
  expectedCount: number;
  actualCount: number;
  eventTime: string | null;
}): AttendanceCalculationException {
  const message =
    issue.type === 'DUPLICATE_ATTENDANCE_EVENT'
      ? 'The Work Date holds more Attendance Events of one type than the Day Rule expects.'
      : issue.type === 'MISSING_ATTENDANCE_EVENT'
        ? 'The closed Work Date is missing an Attendance Event the Day Rule expects.'
        : 'The Attendance Events of the Work Date are out of sequence for the Day Rule.';
  return {
    type: issue.type,
    message,
    details: {
      eventType: issue.eventType,
      expectedCount: issue.expectedCount,
      actualCount: issue.actualCount,
      eventTime: issue.eventTime,
    },
  };
}

function unsupportedHolidayExceptions(
  segments: readonly { holidayClassification: string | null }[],
  holidayEffectRules: Record<string, unknown>,
): AttendanceCalculationException[] {
  const classifications = [
    ...new Set(segments.map((segment) => segment.holidayClassification)),
  ].filter((value): value is string => value !== null);
  return classifications
    .filter(
      (classification) => !Object.prototype.hasOwnProperty.call(holidayEffectRules, classification),
    )
    .map((classification) => ({
      type: 'UNSUPPORTED_HOLIDAY_EFFECT' as const,
      message: `The Work Schedule Version defines no authority-backed effect for holiday classification ${classification}.`,
      details: { holidayClassification: classification },
    }));
}

/**
 * Calculate one Attendance Day from its resolved inputs. The function is pure
 * and deterministic: every minute is derived from the exact Work Date, Day
 * Rule, events, Attendance Context, and Leave-owned coverage it receives, and it
 * never invents a timestamp or assumes a grace period. Timed inputs count only
 * their Fully Covered Minutes (ADR 0005).
 *
 * Totals semantics: `expectedMinutes` is the union of expected duty intervals;
 * `coverageMinutes` counts covered minutes inside expected duty; each coverage
 * type totals the minutes of that type anywhere in the day, while
 * `workedMinutes` and `outsideScheduleMinutes` also include worked time outside
 * expected duty. Deficits only classify uncovered expected duty.
 */
export function calculateAttendanceDay(
  input: AttendanceDayCalculationInput,
): AttendanceDayCalculationResult {
  const { timezone, workDate } = input;
  const rule = materializeDayRule(input.dayRule, workDate, timezone);
  const exceptions: AttendanceCalculationException[] = [];
  const totals: AttendanceCalculationTotals = {
    expectedMinutes: 0,
    workedMinutes: 0,
    coverageMinutes: 0,
    lateMinutes: 0,
    undertimeMinutes: 0,
    absenceMinutes: 0,
    officialBusinessMinutes: 0,
    officialTravelMinutes: 0,
    trainingMinutes: 0,
    approvedAbsenceMinutes: 0,
    postedLeaveMinutes: 0,
    outsideScheduleMinutes: 0,
    statutoryNightWindowMinutes: 0,
  };

  for (const issue of evaluateAttendanceSequence(
    input.events.map((event) => ({ eventType: event.eventType, eventTime: event.eventTime })),
    input.dayRule,
  )) {
    exceptions.push(sequenceException(issue));
  }

  const worked = workedIntervals(rule, input.events);
  const workedCoverage = worked.map((interval) => ({
    ...interval,
    coverageType: 'WORKED' as const,
    sources: input.events.map((event) => ({ sourceType: 'ATTENDANCE_EVENT', id: event.id })),
  }));
  const nightMinutes = totalMinutes(intersect(nightWindowIntervals(workDate, timezone), worked));

  const contextCoverage: Array<
    Interval & {
      coverageType: AttendanceCoverageType;
      sources: Array<{ sourceType: string; id: string }>;
    }
  > = [];
  for (const item of input.coverage) {
    const interval = fullyCoveredInterval(item.startsAt, item.endsAt);
    if (interval.end <= interval.start) {
      exceptions.push({
        type: 'INCOMPLETE_COVERAGE_INPUT',
        message: 'A coverage input does not define a positive interval.',
        details: { workDate, coverageType: item.coverageType, sourceId: item.sourceId },
      });
      continue;
    }
    contextCoverage.push({
      ...interval,
      coverageType: item.coverageType,
      sources: [{ sourceType: item.sourceType, id: item.sourceId }],
    });
  }

  const qualifying = [...workedCoverage, ...contextCoverage];
  if (rule.ruleType === 'REST' && qualifying.length === 0) {
    return { segments: [], totals, exceptions };
  }

  let anchor: number | null = null;
  let expected: Interval[] = [];
  if (rule.ruleType !== 'REST') {
    if (rule.anchorStartMinute === null || rule.dutyEndMinute === null) {
      exceptions.push({
        type: 'INCOMPLETE_WORK_SCHEDULE_VERSION',
        message: 'The Day Rule does not define a complete duty interval.',
        details: { workDate, ruleType: rule.ruleType },
      });
      return { segments: [], totals, exceptions };
    }
    if (rule.ruleType === 'FLEXIBLE' && rule.latestStartMinute === null) {
      exceptions.push({
        type: 'INCOMPLETE_WORK_SCHEDULE_VERSION',
        message: 'The flexible Day Rule does not define a latest permitted start.',
        details: { workDate, ruleType: rule.ruleType },
      });
      return { segments: [], totals, exceptions };
    }
    anchor =
      rule.ruleType === 'FLEXIBLE'
        ? flexibleAnchorMinute(
            rule,
            qualifying.filter((interval) => interval.coverageType !== 'POSTED_LEAVE'),
          )
        : rule.anchorStartMinute;
    if (anchor === null) {
      exceptions.push({
        type: 'INCOMPLETE_WORK_SCHEDULE_VERSION',
        message: 'The Day Rule does not define a permitted duty start.',
        details: { workDate, ruleType: rule.ruleType },
      });
      return { segments: [], totals, exceptions };
    }
    expected = expectedIntervals(rule, anchor);
  }
  totals.expectedMinutes = totalMinutes(expected);

  const coverageByMinute = new Map<
    number,
    {
      coverageType: AttendanceCoverageType;
      sources: Array<{ sourceType: string; id: string }>;
    }
  >();
  const conflictingTypes = new Set<string>();
  let conflictMinutes = 0;
  for (const interval of qualifying) {
    for (let minute = interval.start; minute < interval.end; minute += 1) {
      const existing = coverageByMinute.get(minute);
      if (!existing) {
        coverageByMinute.set(minute, {
          coverageType: interval.coverageType,
          sources: [...interval.sources],
        });
        continue;
      }
      if (existing.coverageType !== interval.coverageType) {
        conflictingTypes.add(existing.coverageType);
        conflictingTypes.add(interval.coverageType);
        conflictMinutes += 1;
      }
      const known = new Set(existing.sources.map(sourceKey));
      for (const source of interval.sources) {
        if (!known.has(sourceKey(source))) {
          existing.sources.push(source);
          known.add(sourceKey(source));
        }
      }
    }
  }
  if (conflictingTypes.size > 0) {
    exceptions.push({
      type: 'CONFLICTING_COVERAGE',
      message:
        'Worked time, Attendance Context, and posted leave classify overlapping minutes differently.',
      details: {
        workDate,
        conflictingTypes: [...conflictingTypes].sort(),
        minuteCount: conflictMinutes,
      },
    });
  }

  const spanStart = Math.min(
    ...(anchor === null ? [] : [anchor]),
    ...qualifying.map((interval) => interval.start),
    ...(expected.length > 0 ? [expected[0]!.start] : []),
  );
  const spanEnd = Math.max(
    ...(rule.dutyEndMinute === null ? [] : [rule.dutyEndMinute]),
    ...qualifying.map((interval) => interval.end),
    ...(expected.length > 0 ? [expected[expected.length - 1]!.end] : []),
  );
  const boundedStart = Math.max(spanStart, dayBoundary(workDate, timezone) - MINUTES_PER_DAY);
  const boundedEnd = Math.min(spanEnd, boundedStart + MAX_CALCULATED_MINUTES);

  const boundaries = new Set<number>();
  const addBoundary = (minute: number): void => {
    if (minute >= boundedStart && minute <= boundedEnd) boundaries.add(minute);
  };
  addBoundary(boundedStart);
  addBoundary(boundedEnd);
  for (const interval of expected) {
    addBoundary(interval.start);
    addBoundary(interval.end);
  }
  for (const interval of qualifying) {
    addBoundary(Math.max(interval.start, boundedStart));
    addBoundary(Math.min(interval.end, boundedEnd));
  }
  const sortedBoundaries = [...boundaries].sort((left, right) => left - right);

  const inExpected = (minute: number): boolean =>
    expected.some((interval) => minute >= interval.start && minute < interval.end);

  const segments: PendingSegment[] = [];
  for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
    const start = sortedBoundaries[index]!;
    const end = sortedBoundaries[index + 1]!;
    if (end <= start) continue;
    const minuteCoverage = coverageByMinute.get(start);
    const expected = inExpected(start);
    if (!expected && !minuteCoverage) continue;
    segments.push({
      start,
      end,
      expected,
      holiday: input.holidayClassifications.get(localDateValue(instantOf(start), timezone)) ?? null,
      coverage: minuteCoverage
        ? {
            coverageType: minuteCoverage.coverageType,
            sources: minuteCoverage.sources,
          }
        : null,
      deficit: null,
    });
  }

  classifyDeficits(segments);

  for (const segment of segments) {
    const minutes = segment.end - segment.start;
    if (!segment.coverage) {
      if (segment.deficit === 'TARDINESS') totals.lateMinutes += minutes;
      else if (segment.deficit === 'UNDERTIME') totals.undertimeMinutes += minutes;
      else if (segment.deficit === 'ABSENCE') totals.absenceMinutes += minutes;
      continue;
    }
    const key = COVERAGE_TOTAL_KEYS[segment.coverage.coverageType];
    if (key) totals[key] = totals[key] + minutes;
    if (segment.coverage.coverageType === 'WORKED') totals.workedMinutes += minutes;
    if (segment.expected) {
      totals.coverageMinutes += minutes;
    } else if (segment.coverage.coverageType === 'WORKED') {
      totals.outsideScheduleMinutes += minutes;
    }
  }

  totals.statutoryNightWindowMinutes = nightMinutes;

  const outputSegments: AttendanceCalculationSegment[] = [];
  for (const segment of segments) {
    const relation = segment.expected ? 'EXPECTED' : 'OUTSIDE_SCHEDULE';
    const pieces = splitByCalendarDate({ start: segment.start, end: segment.end }, timezone);
    if (segment.coverage) {
      for (const piece of pieces) {
        outputSegments.push({
          startsAt: instantOf(piece.start),
          endsAt: instantOf(piece.end),
          dutyRelation: relation,
          coverageType: segment.coverage.coverageType,
          deficitType: null,
          holidayClassification: input.holidayClassifications.get(piece.dateValue) ?? null,
          sources: segment.coverage.sources,
        });
      }
      continue;
    }
    if (relation === 'OUTSIDE_SCHEDULE') continue;
    for (const piece of pieces) {
      outputSegments.push({
        startsAt: instantOf(piece.start),
        endsAt: instantOf(piece.end),
        dutyRelation: 'EXPECTED',
        coverageType: 'UNCOVERED',
        deficitType: segment.deficit ?? 'ABSENCE',
        holidayClassification: input.holidayClassifications.get(piece.dateValue) ?? null,
        sources: [],
      });
    }
  }

  const merged = coalesceSegments(outputSegments);
  exceptions.push(...unsupportedHolidayExceptions(merged, input.holidayEffectRules));
  return { segments: merged, totals, exceptions };
}

/**
 * Adjacent segments that share every classification are coalesced so one
 * uninterrupted interval stays one row. Distinct coverage types, deficit types,
 * duty relations, holiday classifications, or source sets keep their own
 * boundaries.
 */
function coalesceSegments(
  segments: readonly AttendanceCalculationSegment[],
): AttendanceCalculationSegment[] {
  const ordered = [...segments].sort(
    (left, right) => left.startsAt.getTime() - right.startsAt.getTime(),
  );
  const result: AttendanceCalculationSegment[] = [];
  for (const segment of ordered) {
    const previous = result[result.length - 1];
    const sameSources =
      previous !== undefined &&
      previous.sources.length === segment.sources.length &&
      previous.sources.every(
        (source, index) =>
          source.sourceType === segment.sources[index]?.sourceType &&
          source.id === segment.sources[index]?.id,
      );
    if (
      previous &&
      previous.endsAt.getTime() === segment.startsAt.getTime() &&
      previous.dutyRelation === segment.dutyRelation &&
      previous.coverageType === segment.coverageType &&
      previous.deficitType === segment.deficitType &&
      previous.holidayClassification === segment.holidayClassification &&
      sameSources &&
      segment.endsAt.getTime() - previous.startsAt.getTime() <= MAX_SEGMENT_MINUTES * 60_000
    ) {
      previous.endsAt = segment.endsAt;
      continue;
    }
    result.push({ ...segment, sources: [...segment.sources] });
  }
  return result;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

/**
 * A stable digest of every input that determines one Attendance Day
 * calculation. A recalculation whose fingerprint already has a current version
 * is a no-op, and any changed input produces a new calculation version.
 */
export function fingerprintAttendanceDayInput(input: AttendanceDayCalculationInput): string {
  const canonical = canonicalize({
    minuteRule: ATTENDANCE_MINUTE_RULE,
    timezone: input.timezone,
    workDate: input.workDate,
    dayRule: {
      id: input.dayRule.id,
      weekday: input.dayRule.weekday,
      ruleType: input.dayRule.ruleType,
      dutyStartTime: input.dayRule.dutyStartTime,
      earliestStartTime: input.dayRule.earliestStartTime,
      latestStartTime: input.dayRule.latestStartTime,
      dutyEndTime: input.dayRule.dutyEndTime,
      endNextCalendarDay: input.dayRule.endNextCalendarDay,
      requiredMinutes: input.dayRule.requiredMinutes,
      eventPattern: input.dayRule.eventPattern,
      breaks: input.dayRule.breaks,
    },
    events: [...input.events]
      .map((event) => ({
        id: event.id,
        eventType: event.eventType,
        eventTime: event.eventTime,
      }))
      .sort((left, right) =>
        left.eventTime.getTime() === right.eventTime.getTime()
          ? left.id.localeCompare(right.id)
          : left.eventTime.getTime() - right.eventTime.getTime(),
      ),
    coverage: [...input.coverage]
      .map((item) => ({
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        coverageType: item.coverageType,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
      }))
      .sort((left, right) =>
        left.startsAt.getTime() === right.startsAt.getTime()
          ? left.sourceId.localeCompare(right.sourceId)
          : left.startsAt.getTime() - right.startsAt.getTime(),
      ),
    holidays: [...input.holidayClassifications.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
    holidayEffectRules: input.holidayEffectRules,
    governingVersions: input.governingVersions,
    // Omitted when empty so fingerprints of Days without such sources stay stable.
    ...(input.unplacedSources?.length
      ? {
          unplacedSources: [...input.unplacedSources]
            .map(({ sourceType, sourceId }) => ({ sourceType, sourceId }))
            .sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
        }
      : {}),
  });
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
