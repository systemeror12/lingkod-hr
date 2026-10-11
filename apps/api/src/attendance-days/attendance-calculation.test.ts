import { expect, it, vi } from 'vitest';
import type { WorkScheduleDayRuleSummary } from '../attendance-configuration/work-schedules.service';
import {
  calculateAttendanceDay,
  fingerprintAttendanceDayInput,
  wholeWorkDateCoverageIntervals,
  type AttendanceCalculationEvent,
  type AttendanceCalculationCoverage,
  type AttendanceDayCalculationInput,
} from './attendance-calculation';

/** Every canonical payload the fingerprint hashes, captured through a pass-through hash. */
const hashedPayloads = vi.hoisted(() => [] as string[]);
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    createHash: (algorithm: string) => {
      const hash = actual.createHash(algorithm);
      return {
        update: (data: string) => {
          hashedPayloads.push(data);
          hash.update(data);
          return { digest: (encoding: 'hex') => hash.digest(encoding) };
        },
      };
    },
  };
});

const WORK_DATE = '2026-01-02';
const TIMEZONE = 'Asia/Manila';

function dayRule(overrides: Partial<WorkScheduleDayRuleSummary> = {}): WorkScheduleDayRuleSummary {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    weekday: 5,
    ruleType: 'FIXED',
    dutyStartTime: '08:00',
    earliestStartTime: null,
    latestStartTime: null,
    dutyEndTime: '17:00',
    endNextCalendarDay: false,
    requiredMinutes: 480,
    coreStartTime: null,
    coreEndTime: null,
    eventPattern: 'IN_OUT',
    collectionBeforeMinutes: 0,
    collectionAfterMinutes: 0,
    breaks: [],
    ...overrides,
  };
}

/** Manila wall-clock `HH:MM[:SS]` on a day offset from the Work Date as an instant. */
function manila(timeValue: string, dayOffset = 0): Date {
  const base = Date.UTC(2026, 0, 2 + dayOffset, 0, 0);
  const [hour, minute, second = 0] = timeValue.split(':').map(Number);
  return new Date(base + (hour! * 60 + minute! - 8 * 60) * 60_000 + second * 1000);
}

/** Segment boundaries as Manila wall-clock `HH:MM` pairs. */
function wallSegments(result: { segments: { startsAt: Date; endsAt: Date }[] }): string[][] {
  const wall = (value: Date) =>
    new Date(value.getTime() + 8 * 3_600_000).toISOString().slice(11, 16);
  return result.segments.map((segment) => [wall(segment.startsAt), wall(segment.endsAt)]);
}

function at(
  timeValue: string,
  eventType: AttendanceCalculationEvent['eventType'],
  id = `${eventType}-${timeValue}`,
  dayOffset = 0,
): AttendanceCalculationEvent {
  return { id, eventType, eventTime: manila(timeValue, dayOffset) };
}

function input(
  overrides: Partial<AttendanceDayCalculationInput> = {},
): AttendanceDayCalculationInput {
  return {
    timezone: TIMEZONE,
    workDate: WORK_DATE,
    dayRule: dayRule(),
    events: [],
    coverage: [],
    holidayClassifications: new Map(),
    ...overrides,
  };
}

function coverage(
  overrides: Partial<AttendanceCalculationCoverage> = {},
): AttendanceCalculationCoverage {
  return {
    sourceType: 'ATTENDANCE_CONTEXT',
    sourceId: 'c1',
    coverageType: 'OFFICIAL_BUSINESS',
    startsAt: manila('08:00'),
    endsAt: manila('12:00'),
    ...overrides,
  };
}

const lunchBreak = {
  id: 'b1',
  sequenceNo: 1,
  breakStartTime: '12:00',
  breakEndTime: '13:00',
  endNextCalendarDay: false,
};

it('counts a complete fixed day without grace and without deficits', () => {
  const result = calculateAttendanceDay(
    input({ events: [at('08:00', 'TIME_IN'), at('17:00', 'TIME_OUT')] }),
  );

  expect(result.exceptions).toEqual([]);
  expect(result.totals).toMatchObject({
    expectedMinutes: 540,
    workedMinutes: 540,
    coverageMinutes: 540,
    lateMinutes: 0,
    undertimeMinutes: 0,
    absenceMinutes: 0,
    outsideScheduleMinutes: 0,
  });
  expect(result.segments).toHaveLength(1);
  expect(result.segments[0]).toMatchObject({
    dutyRelation: 'EXPECTED',
    coverageType: 'WORKED',
    deficitType: null,
    holidayClassification: null,
  });
  expect(result.segments[0]!.sources).toEqual([
    { sourceType: 'ATTENDANCE_EVENT', id: 'TIME_IN-08:00' },
    { sourceType: 'ATTENDANCE_EVENT', id: 'TIME_OUT-17:00' },
  ]);
});

it('subtracts a scheduled unpaid break from expected duty', () => {
  const result = calculateAttendanceDay(
    input({
      dayRule: dayRule({ breaks: [lunchBreak] }),
      events: [at('08:00', 'TIME_IN'), at('17:00', 'TIME_OUT')],
    }),
  );

  expect(result.totals.expectedMinutes).toBe(480);
  expect(result.totals.workedMinutes).toBe(480);
  expect(result.totals.coverageMinutes).toBe(480);
  expect(result.totals).toMatchObject({ lateMinutes: 0, undertimeMinutes: 0, absenceMinutes: 0 });
});

it('classifies leading uncovered expected minutes as tardiness', () => {
  const result = calculateAttendanceDay(
    input({ events: [at('08:30', 'TIME_IN'), at('17:00', 'TIME_OUT')] }),
  );

  expect(result.totals.lateMinutes).toBe(30);
  expect(result.totals.undertimeMinutes).toBe(0);
  expect(result.totals.absenceMinutes).toBe(0);
  expect(result.totals.workedMinutes).toBe(510);
  expect(result.totals.coverageMinutes).toBe(510);
  const uncovered = result.segments.filter((segment) => segment.coverageType === 'UNCOVERED');
  expect(uncovered).toHaveLength(1);
  expect(uncovered[0]).toMatchObject({ deficitType: 'TARDINESS' });
  expect(uncovered[0]!.startsAt).toEqual(manila('08:00'));
  expect(uncovered[0]!.endsAt).toEqual(manila('08:30'));
});

it('classifies trailing uncovered expected minutes as undertime', () => {
  const result = calculateAttendanceDay(
    input({ events: [at('08:00', 'TIME_IN'), at('16:00', 'TIME_OUT')] }),
  );

  expect(result.totals.undertimeMinutes).toBe(60);
  expect(result.totals.lateMinutes).toBe(0);
  expect(result.totals.absenceMinutes).toBe(0);
  expect(result.segments.filter((segment) => segment.coverageType === 'UNCOVERED')).toHaveLength(1);
  expect(result.segments.find((segment) => segment.coverageType === 'UNCOVERED')).toMatchObject({
    deficitType: 'UNDERTIME',
  });
});

it('classifies wholly uncovered expected duty as absence', () => {
  const result = calculateAttendanceDay(input());

  expect(result.totals).toMatchObject({
    expectedMinutes: 540,
    workedMinutes: 0,
    coverageMinutes: 0,
    lateMinutes: 0,
    undertimeMinutes: 0,
    absenceMinutes: 540,
  });
  expect(result.exceptions).toEqual([]);
  expect(result.segments).toHaveLength(1);
  expect(result.segments[0]).toMatchObject({ coverageType: 'UNCOVERED', deficitType: 'ABSENCE' });
});

it('classifies internal uncovered expected minutes as absence', () => {
  const result = calculateAttendanceDay(
    input({
      dayRule: dayRule({ breaks: [lunchBreak] }),
      events: [at('08:00', 'TIME_IN'), at('10:00', 'TIME_OUT')],
      coverage: [
        coverage({
          sourceId: 'leave-1',
          sourceType: 'POSTED_LEAVE',
          coverageType: 'POSTED_LEAVE',
          startsAt: manila('14:00'),
          endsAt: manila('17:00'),
        }),
      ],
    }),
  );

  expect(result.totals.absenceMinutes).toBe(180);
  expect(result.totals.lateMinutes).toBe(0);
  expect(result.totals.undertimeMinutes).toBe(0);
  expect(result.totals.workedMinutes).toBe(120);
  expect(result.totals.postedLeaveMinutes).toBe(180);
  expect(result.totals.coverageMinutes).toBe(300);
  const internal = result.segments.filter((segment) => segment.coverageType === 'UNCOVERED');
  expect(internal).toHaveLength(2);
  expect(internal.every((segment) => segment.deficitType === 'ABSENCE')).toBe(true);
});

it('counts posted leave and worked time as one union without double counting', () => {
  const result = calculateAttendanceDay(
    input({
      events: [at('13:00', 'TIME_IN'), at('17:00', 'TIME_OUT')],
      coverage: [
        coverage({
          sourceId: 'leave-1',
          sourceType: 'POSTED_LEAVE',
          coverageType: 'POSTED_LEAVE',
          startsAt: manila('08:00'),
          endsAt: manila('13:00'),
        }),
      ],
    }),
  );

  expect(result.exceptions).toEqual([]);
  expect(result.totals.postedLeaveMinutes).toBe(300);
  expect(result.totals.workedMinutes).toBe(240);
  expect(result.totals.coverageMinutes).toBe(540);
  expect(result.totals).toMatchObject({ lateMinutes: 0, undertimeMinutes: 0, absenceMinutes: 0 });
});

it('raises a blocking exception when coverage types overlap', () => {
  const result = calculateAttendanceDay(
    input({
      events: [at('08:00', 'TIME_IN'), at('12:00', 'TIME_OUT')],
      coverage: [
        coverage({
          sourceId: 'context-1',
          coverageType: 'OFFICIAL_BUSINESS',
          startsAt: manila('08:00'),
          endsAt: manila('09:00'),
        }),
      ],
    }),
  );

  const conflict = result.exceptions.find((exception) => exception.type === 'CONFLICTING_COVERAGE');
  expect(conflict).toBeDefined();
  expect(conflict!.details).toMatchObject({
    conflictingTypes: ['OFFICIAL_BUSINESS', 'WORKED'],
    minuteCount: 60,
  });
  expect(result.totals.workedMinutes).toBe(240);
  expect(result.totals.officialBusinessMinutes).toBe(0);
});

it.each(['REGULAR_HOLIDAY', 'SPECIAL_NON_WORKING', 'LOCAL_HOLIDAY', 'WORK_SUSPENSION'])(
  'expects no duty and no absence on a %s weekday without events',
  (classification) => {
    const result = calculateAttendanceDay(
      input({ holidayClassifications: new Map([[WORK_DATE, classification]]) }),
    );

    expect(result.exceptions).toEqual([]);
    expect(result.totals).toMatchObject({ expectedMinutes: 0, absenceMinutes: 0 });
    expect(result.segments).toEqual([]);
  },
);

it('records service on a Non-Working Holiday outside the schedule without deficits', () => {
  const result = calculateAttendanceDay(
    input({
      events: [at('09:00', 'TIME_IN'), at('15:00', 'TIME_OUT')],
      holidayClassifications: new Map([[WORK_DATE, 'REGULAR_HOLIDAY']]),
    }),
  );

  expect(result.exceptions).toEqual([]);
  expect(result.totals).toMatchObject({
    expectedMinutes: 0,
    workedMinutes: 360,
    coverageMinutes: 0,
    outsideScheduleMinutes: 360,
    lateMinutes: 0,
    undertimeMinutes: 0,
    absenceMinutes: 0,
  });
  expect(result.segments).toHaveLength(1);
  expect(result.segments[0]).toMatchObject({
    dutyRelation: 'OUTSIDE_SCHEDULE',
    coverageType: 'WORKED',
    deficitType: null,
    holidayClassification: 'REGULAR_HOLIDAY',
  });
});

it('removes expected duty only for the overnight minutes on the holiday date', () => {
  const overnight = dayRule({
    dutyStartTime: '22:00',
    dutyEndTime: '06:00',
    endNextCalendarDay: true,
    requiredMinutes: 480,
  });
  const intoHoliday = new Map([['2026-01-03', 'SPECIAL_NON_WORKING']]);

  const absent = calculateAttendanceDay(
    input({ dayRule: overnight, holidayClassifications: intoHoliday }),
  );
  expect(absent.exceptions).toEqual([]);
  expect(absent.totals).toMatchObject({ expectedMinutes: 120, absenceMinutes: 120 });

  const worked = calculateAttendanceDay(
    input({
      dayRule: overnight,
      events: [at('22:00', 'TIME_IN'), at('06:00', 'TIME_OUT', 'TIME_OUT-next', 1)],
      holidayClassifications: intoHoliday,
    }),
  );
  expect(worked.exceptions).toEqual([]);
  expect(worked.totals).toMatchObject({
    expectedMinutes: 120,
    workedMinutes: 480,
    coverageMinutes: 120,
    outsideScheduleMinutes: 360,
    absenceMinutes: 0,
    undertimeMinutes: 0,
    statutoryNightWindowMinutes: 480,
  });
  expect(
    worked.segments.map((segment) => [segment.dutyRelation, segment.holidayClassification]),
  ).toEqual([
    ['EXPECTED', null],
    ['OUTSIDE_SCHEDULE', 'SPECIAL_NON_WORKING'],
  ]);

  const fromHoliday = calculateAttendanceDay(
    input({
      dayRule: overnight,
      holidayClassifications: new Map([[WORK_DATE, 'REGULAR_HOLIDAY']]),
    }),
  );
  expect(fromHoliday.totals).toMatchObject({ expectedMinutes: 360, absenceMinutes: 360 });
});

it('keeps ordinary duty on a SPECIAL_WORKING day', () => {
  for (const events of [[], [at('08:30', 'TIME_IN'), at('16:00', 'TIME_OUT')]]) {
    const ordinary = calculateAttendanceDay(input({ events }));
    const specialWorking = calculateAttendanceDay(
      input({ events, holidayClassifications: new Map([[WORK_DATE, 'SPECIAL_WORKING']]) }),
    );

    expect(specialWorking.exceptions).toEqual([]);
    expect(specialWorking.totals).toEqual(ordinary.totals);
    expect(specialWorking.segments).toEqual(
      ordinary.segments.map((segment) => ({
        ...segment,
        holidayClassification: 'SPECIAL_WORKING',
      })),
    );
  }
});

it('anchors a flexible day on the first qualifying minute and clamps to the permitted window', () => {
  const flexible = dayRule({
    ruleType: 'FLEXIBLE',
    dutyStartTime: null,
    earliestStartTime: '07:00',
    latestStartTime: '09:00',
    dutyEndTime: '17:00',
    breaks: [lunchBreak],
  });

  const early = calculateAttendanceDay(
    input({ dayRule: flexible, events: [at('06:30', 'TIME_IN'), at('17:00', 'TIME_OUT')] }),
  );
  expect(early.totals.expectedMinutes).toBe(540);
  expect(early.totals.workedMinutes).toBe(570);
  expect(early.totals.outsideScheduleMinutes).toBe(30);
  expect(early.totals).toMatchObject({ lateMinutes: 0, undertimeMinutes: 0, absenceMinutes: 0 });

  const late = calculateAttendanceDay(
    input({ dayRule: flexible, events: [at('09:45', 'TIME_IN'), at('17:00', 'TIME_OUT')] }),
  );
  expect(late.totals.expectedMinutes).toBe(420);
  expect(late.totals.lateMinutes).toBe(45);
  expect(late.totals.coverageMinutes).toBe(375);
});

it('anchors a flexible day on its latest permitted start when nothing qualifies', () => {
  const result = calculateAttendanceDay(
    input({
      dayRule: dayRule({
        ruleType: 'FLEXIBLE',
        dutyStartTime: null,
        earliestStartTime: '07:00',
        latestStartTime: '09:00',
        dutyEndTime: '17:00',
        breaks: [lunchBreak],
      }),
      coverage: [
        coverage({
          sourceId: 'leave-1',
          sourceType: 'POSTED_LEAVE',
          coverageType: 'POSTED_LEAVE',
          startsAt: manila('07:30'),
          endsAt: manila('12:00'),
        }),
      ],
    }),
  );

  expect(result.totals.expectedMinutes).toBe(420);
  expect(result.totals.postedLeaveMinutes).toBe(270);
  expect(result.totals.coverageMinutes).toBe(180);
  expect(result.totals.undertimeMinutes).toBe(240);
  expect(result.totals.absenceMinutes).toBe(0);
});

it('reports missing, duplicate, and out-of-order events without inventing time', () => {
  const missing = calculateAttendanceDay(
    input({
      events: [at('08:00', 'TIME_IN'), at('17:00', 'TIME_OUT')],
      dayRule: dayRule({ breaks: [lunchBreak], eventPattern: 'WITH_BREAK_EVENTS' }),
    }),
  );
  expect(missing.exceptions.map((exception) => exception.type).sort()).toEqual([
    'MISSING_ATTENDANCE_EVENT',
    'MISSING_ATTENDANCE_EVENT',
  ]);

  const duplicate = calculateAttendanceDay(
    input({
      events: [
        at('08:00', 'TIME_IN', 'in-1'),
        at('08:01', 'TIME_IN', 'in-2'),
        at('17:00', 'TIME_OUT'),
      ],
    }),
  );
  expect(duplicate.exceptions.map((exception) => exception.type)).toContain(
    'DUPLICATE_ATTENDANCE_EVENT',
  );

  const outOfOrder = calculateAttendanceDay(
    input({
      dayRule: dayRule({ breaks: [lunchBreak], eventPattern: 'WITH_BREAK_EVENTS' }),
      events: [
        at('08:00', 'TIME_IN', 'in-1'),
        at('11:00', 'BREAK_IN', 'break-in-1'),
        at('12:00', 'BREAK_OUT', 'break-out-1'),
        at('17:00', 'TIME_OUT', 'out-1'),
      ],
    }),
  );
  expect(outOfOrder.exceptions.map((exception) => exception.type)).toContain(
    'OUT_OF_ORDER_ATTENDANCE_EVENT',
  );
});

it('treats complete rest day service as unscheduled with no deficits', () => {
  const result = calculateAttendanceDay(
    input({
      dayRule: dayRule({
        ruleType: 'REST',
        dutyStartTime: null,
        dutyEndTime: null,
        requiredMinutes: 0,
      }),
      events: [at('10:00', 'TIME_IN'), at('12:00', 'TIME_OUT')],
    }),
  );

  expect(result.exceptions).toEqual([]);
  expect(result.totals).toMatchObject({
    expectedMinutes: 0,
    workedMinutes: 120,
    coverageMinutes: 0,
    outsideScheduleMinutes: 120,
    lateMinutes: 0,
    undertimeMinutes: 0,
    absenceMinutes: 0,
  });
  expect(result.segments).toHaveLength(1);
  expect(result.segments[0]).toMatchObject({
    dutyRelation: 'OUTSIDE_SCHEDULE',
    coverageType: 'WORKED',
  });
});

it('counts Attendance Context coverage on a rest day without inventing deficits', () => {
  const result = calculateAttendanceDay(
    input({
      dayRule: dayRule({
        ruleType: 'REST',
        dutyStartTime: null,
        dutyEndTime: null,
        requiredMinutes: 0,
      }),
      coverage: [coverage({ startsAt: manila('09:00'), endsAt: manila('11:00') })],
    }),
  );

  expect(result.exceptions).toEqual([]);
  expect(result.totals).toMatchObject({
    expectedMinutes: 0,
    workedMinutes: 0,
    coverageMinutes: 0,
    officialBusinessMinutes: 120,
    absenceMinutes: 0,
    lateMinutes: 0,
    undertimeMinutes: 0,
  });
  expect(result.segments).toHaveLength(1);
  expect(result.segments[0]).toMatchObject({
    dutyRelation: 'OUTSIDE_SCHEDULE',
    coverageType: 'OFFICIAL_BUSINESS',
    deficitType: null,
  });
});

it('counts rest day worked and context coverage once and flags the conflict', () => {
  const result = calculateAttendanceDay(
    input({
      dayRule: dayRule({
        ruleType: 'REST',
        dutyStartTime: null,
        dutyEndTime: null,
        requiredMinutes: 0,
      }),
      events: [at('10:00', 'TIME_IN'), at('12:00', 'TIME_OUT')],
      coverage: [coverage({ startsAt: manila('11:00'), endsAt: manila('13:00') })],
    }),
  );

  expect(result.exceptions.map((exception) => exception.type)).toContain('CONFLICTING_COVERAGE');
  expect(result.totals).toMatchObject({
    workedMinutes: 120,
    officialBusinessMinutes: 60,
    outsideScheduleMinutes: 120,
    coverageMinutes: 0,
  });
});

it('keeps worked time before the duty window as outside schedule', () => {
  const result = calculateAttendanceDay(
    input({ events: [at('06:00', 'TIME_IN'), at('07:00', 'TIME_OUT')] }),
  );

  expect(result.totals.workedMinutes).toBe(60);
  expect(result.totals.outsideScheduleMinutes).toBe(60);
  expect(result.totals.absenceMinutes).toBe(540);
  expect(result.totals.undertimeMinutes).toBe(0);
  const outside = result.segments.filter((segment) => segment.dutyRelation === 'OUTSIDE_SCHEDULE');
  expect(outside).toHaveLength(1);
  expect(outside[0]).toMatchObject({ coverageType: 'WORKED', deficitType: null });
});

it('fails closed when the Day Rule has no complete duty interval', () => {
  const result = calculateAttendanceDay(
    input({ dayRule: dayRule({ dutyStartTime: null, earliestStartTime: null }) }),
  );

  expect(result.totals.expectedMinutes).toBe(0);
  expect(result.exceptions.map((exception) => exception.type)).toEqual([
    'INCOMPLETE_WORK_SCHEDULE_VERSION',
  ]);
});

it('counts only Fully Covered Minutes of a sub-minute time-in and time-out', () => {
  const result = calculateAttendanceDay(
    input({
      dayRule: dayRule({ breaks: [lunchBreak] }),
      events: [at('08:00:59', 'TIME_IN'), at('17:00:01', 'TIME_OUT')],
    }),
  );

  expect(result.exceptions).toEqual([]);
  expect(result.totals).toMatchObject({
    expectedMinutes: 480,
    workedMinutes: 479,
    coverageMinutes: 479,
    lateMinutes: 1,
    undertimeMinutes: 0,
    absenceMinutes: 0,
  });
  expect(wallSegments(result)).toEqual([
    ['08:00', '08:01'],
    ['08:01', '12:00'],
    ['13:00', '17:00'],
  ]);
  expect(result.segments.map((segment) => segment.deficitType)).toEqual(['TARDINESS', null, null]);
});

it('counts a time-in one second past the duty start as one tardiness minute', () => {
  const result = calculateAttendanceDay(
    input({ events: [at('08:00:01', 'TIME_IN'), at('17:00', 'TIME_OUT')] }),
  );

  expect(result.totals).toMatchObject({ workedMinutes: 539, lateMinutes: 1 });
});

it('keeps worked time inside sub-minute recorded break boundaries', () => {
  const rule = dayRule({ breaks: [lunchBreak], eventPattern: 'WITH_BREAK_EVENTS' });
  const inside = calculateAttendanceDay(
    input({
      dayRule: rule,
      events: [
        at('08:00', 'TIME_IN'),
        at('12:00:30', 'BREAK_OUT'),
        at('12:59:30', 'BREAK_IN'),
        at('17:00', 'TIME_OUT'),
      ],
    }),
  );
  expect(inside.totals).toMatchObject({ workedMinutes: 480, absenceMinutes: 0 });

  const outside = calculateAttendanceDay(
    input({
      dayRule: rule,
      events: [
        at('08:00', 'TIME_IN'),
        at('11:59:30', 'BREAK_OUT'),
        at('13:00:30', 'BREAK_IN'),
        at('17:00', 'TIME_OUT'),
      ],
    }),
  );
  expect(outside.totals).toMatchObject({ workedMinutes: 478, absenceMinutes: 2 });
  expect(wallSegments(outside)).toEqual([
    ['08:00', '11:59'],
    ['11:59', '12:00'],
    ['13:00', '13:01'],
    ['13:01', '17:00'],
  ]);
});

it('counts only Fully Covered Minutes of a sub-minute Attendance Context', () => {
  const result = calculateAttendanceDay(
    input({
      dayRule: dayRule({ breaks: [lunchBreak] }),
      events: [at('13:00', 'TIME_IN'), at('17:00', 'TIME_OUT')],
      coverage: [coverage({ startsAt: manila('08:00:30'), endsAt: manila('11:59:30') })],
    }),
  );

  expect(result.totals).toMatchObject({
    officialBusinessMinutes: 238,
    workedMinutes: 240,
    lateMinutes: 1,
    absenceMinutes: 1,
  });
  expect(wallSegments(result).slice(0, 3)).toEqual([
    ['08:00', '08:01'],
    ['08:01', '11:59'],
    ['11:59', '12:00'],
  ]);
});

it('anchors a flexible day on the first fully covered minute of a sub-minute time-in', () => {
  const result = calculateAttendanceDay(
    input({
      dayRule: dayRule({
        ruleType: 'FLEXIBLE',
        dutyStartTime: null,
        earliestStartTime: '07:00',
        latestStartTime: '09:00',
        dutyEndTime: '17:00',
        breaks: [lunchBreak],
      }),
      events: [at('08:30:20', 'TIME_IN'), at('17:00', 'TIME_OUT')],
    }),
  );

  expect(result.totals).toMatchObject({ expectedMinutes: 449, workedMinutes: 449, lateMinutes: 0 });
  expect(wallSegments(result)[0]).toEqual(['08:31', '12:00']);
});

it('fingerprints the Fully Covered Minute convention', () => {
  hashedPayloads.length = 0;
  fingerprintAttendanceDayInput(input());

  expect(JSON.parse(hashedPayloads[0]!)).toMatchObject({ minuteRule: 'FULLY_COVERED_MINUTE' });
});

it('fingerprints every calculation input deterministically', () => {
  const base = input({ events: [at('08:00', 'TIME_IN'), at('17:00', 'TIME_OUT')] });
  const same = input({ events: [at('08:00', 'TIME_IN'), at('17:00', 'TIME_OUT')] });
  const moved = input({ events: [at('08:30', 'TIME_IN'), at('17:00', 'TIME_OUT')] });

  expect(fingerprintAttendanceDayInput(base)).toMatch(/^[0-9a-f]{64}$/);
  expect(fingerprintAttendanceDayInput(base)).toBe(fingerprintAttendanceDayInput(same));
  expect(fingerprintAttendanceDayInput(base)).not.toBe(fingerprintAttendanceDayInput(moved));
});

it('fingerprints a new effective governing version even when its rules are identical', () => {
  const base = input({
    governingVersions: {
      assignmentId: 'assignment-1',
      workScheduleVersionId: 'schedule-v1',
      workArrangementVersionId: 'arrangement-v1',
      holidayCalendarVersionId: 'calendar-v1',
    },
  });
  const successor = input({
    governingVersions: {
      assignmentId: 'assignment-1',
      workScheduleVersionId: 'schedule-v2',
      workArrangementVersionId: 'arrangement-v1',
      holidayCalendarVersionId: 'calendar-v1',
    },
  });

  expect(fingerprintAttendanceDayInput(base)).not.toBe(fingerprintAttendanceDayInput(successor));
});

it('covers a whole Work Date from the duty window and the earliest flexible start', () => {
  const fixed = wholeWorkDateCoverageIntervals(dayRule(), WORK_DATE, TIMEZONE);
  expect(fixed).toEqual([{ startsAt: manila('08:00'), endsAt: manila('17:00') }]);

  const flexible = wholeWorkDateCoverageIntervals(
    dayRule({
      ruleType: 'FLEXIBLE',
      dutyStartTime: null,
      earliestStartTime: '07:00',
      latestStartTime: '09:00',
      endNextCalendarDay: false,
    }),
    WORK_DATE,
    TIMEZONE,
  );
  expect(flexible).toEqual([{ startsAt: manila('07:00'), endsAt: manila('17:00') }]);

  const withBreak = wholeWorkDateCoverageIntervals(
    dayRule({ breaks: [lunchBreak] }),
    WORK_DATE,
    TIMEZONE,
  );
  expect(withBreak).toEqual([
    { startsAt: manila('08:00'), endsAt: manila('12:00') },
    { startsAt: manila('13:00'), endsAt: manila('17:00') },
  ]);
});

it('covers no interval on a rest day or an incomplete Day Rule', () => {
  expect(
    wholeWorkDateCoverageIntervals(
      dayRule({ ruleType: 'REST', dutyStartTime: null, dutyEndTime: null }),
      WORK_DATE,
      TIMEZONE,
    ),
  ).toEqual([]);
  expect(
    wholeWorkDateCoverageIntervals(dayRule({ dutyEndTime: null }), WORK_DATE, TIMEZONE),
  ).toEqual([]);
});
