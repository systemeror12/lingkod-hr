import { expect, it } from 'vitest';
import {
  WEEKDAYS,
  addDays,
  formatDate,
  fromTimeValue,
  normalizeArrangementDefinition,
  normalizeDayRules,
  normalizeScheduleDefinition,
  toDatabaseDate,
  toTimeValue,
  type AttendanceConfigurationDayRuleInput,
} from './attendance-configuration.types';

const holidayCalendarId = '00000000-0000-4000-8000-000000000001';

function fixedRule(
  weekday: number,
  overrides: Partial<AttendanceConfigurationDayRuleInput> = {},
): AttendanceConfigurationDayRuleInput {
  return {
    weekday,
    ruleType: 'FIXED',
    dutyStartTime: '08:00',
    dutyEndTime: '17:00',
    requiredMinutes: 480,
    eventPattern: 'IN_OUT',
    collectionBeforeMinutes: 0,
    collectionAfterMinutes: 0,
    breaks: [{ breakStartTime: '12:00', breakEndTime: '13:00' }],
    ...overrides,
  };
}

function restRule(weekday: number): AttendanceConfigurationDayRuleInput {
  return {
    weekday,
    ruleType: 'REST',
    requiredMinutes: 0,
    eventPattern: 'IN_OUT',
    collectionBeforeMinutes: 0,
    collectionAfterMinutes: 0,
    breaks: [],
  };
}

function fullWeek(): AttendanceConfigurationDayRuleInput[] {
  return WEEKDAYS.map((weekday) => (weekday <= 5 ? fixedRule(weekday) : restRule(weekday)));
}

it('normalizes a complete week with fixed working days and rest days', () => {
  const normalized = normalizeDayRules(fullWeek());

  expect(normalized).toHaveLength(7);
  expect(normalized[0]).toMatchObject({
    weekday: 1,
    ruleType: 'FIXED',
    dutyStartTime: '08:00',
    dutyEndTime: '17:00',
    requiredMinutes: 480,
    breaks: [{ sequenceNo: 1, breakStartTime: '12:00', breakEndTime: '13:00' }],
  });
  expect(normalized[5]).toMatchObject({ weekday: 6, ruleType: 'REST', requiredMinutes: 0 });
  expect(normalized[6]).toMatchObject({ weekday: 7, ruleType: 'REST', breaks: [] });
});

it('requires exactly one Day Rule per ISO weekday without duplicates', () => {
  expect(() => normalizeDayRules(fullWeek().slice(0, 6))).toThrow(/seven Day Rules/);
  expect(() => normalizeDayRules([...fullWeek(), fixedRule(1)])).toThrow(/seven Day Rules/);
  expect(() => normalizeDayRules([...fullWeek().map((rule) => ({ ...rule, weekday: 1 }))])).toThrow(
    /one Day Rule per weekday/,
  );
});

it('positions unpaid breaks inside the duty window and orders them by start time', () => {
  const normalized = normalizeDayRules(
    fullWeek().map((rule) =>
      rule.weekday === 1
        ? fixedRule(1, {
            breaks: [
              { breakStartTime: '15:00', breakEndTime: '15:15' },
              { breakStartTime: '12:00', breakEndTime: '13:00' },
            ],
            requiredMinutes: 465,
          })
        : rule,
    ),
  );

  expect(
    normalized[0]?.breaks.map(({ sequenceNo, breakStartTime }) => [sequenceNo, breakStartTime]),
  ).toEqual([
    [1, '12:00'],
    [2, '15:00'],
  ]);
  expect(() =>
    normalizeDayRules(
      fullWeek().map((rule) =>
        rule.weekday === 1
          ? fixedRule(1, {
              breaks: [
                { breakStartTime: '12:00', breakEndTime: '13:30' },
                { breakStartTime: '13:00', breakEndTime: '14:00' },
              ],
              requiredMinutes: 420,
            })
          : rule,
      ),
    ),
  ).toThrow(/cannot overlap/);
  expect(() =>
    normalizeDayRules(
      fullWeek().map((rule) =>
        rule.weekday === 1
          ? fixedRule(1, { breaks: [{ breakStartTime: '07:00', breakEndTime: '08:00' }] })
          : rule,
      ),
    ),
  ).toThrow(/inside the paid duty window/);
});

it('rejects incomplete, ambiguous, or over-credited rules', () => {
  expect(() =>
    normalizeDayRules(
      fullWeek().map((rule) =>
        rule.weekday === 1 ? fixedRule(1, { requiredMinutes: 481 }) : rule,
      ),
    ),
  ).toThrow(/required minutes must equal the duty window minus unpaid breaks/);
  expect(() =>
    normalizeDayRules(
      fullWeek().map((rule) => (rule.weekday === 1 ? fixedRule(1, { dutyEndTime: null }) : rule)),
    ),
  ).toThrow(/requires a duty start time and a duty end time/);
  expect(() =>
    normalizeDayRules(
      fullWeek().map((rule) =>
        rule.weekday === 1 ? fixedRule(1, { latestStartTime: '09:00' }) : rule,
      ),
    ),
  ).toThrow(/cannot declare flexible start bounds/);
  expect(() =>
    normalizeDayRules(
      fullWeek().map((rule) =>
        rule.weekday === 6 ? fixedRule(6, { ruleType: 'REST', breaks: [] }) : rule,
      ),
    ),
  ).toThrow(/rest Day Rule cannot declare duty/);
  expect(() =>
    normalizeDayRules(
      fullWeek()
        .map((rule) => (rule.weekday === 6 ? restRule(6) : rule))
        .map((rule) => (rule.weekday === 7 ? { ...restRule(7), requiredMinutes: 60 } : rule)),
    ),
  ).toThrow(/must require zero minutes/);
});

it('derives flexible required minutes, honours core hours, and rejects fixed starts', () => {
  const flexible = (overrides: Partial<AttendanceConfigurationDayRuleInput>) =>
    fixedRule(2, {
      ruleType: 'FLEXIBLE',
      dutyStartTime: null,
      earliestStartTime: '07:00',
      latestStartTime: '09:00',
      dutyEndTime: '18:00',
      requiredMinutes: 480,
      breaks: [{ breakStartTime: '12:00', breakEndTime: '13:00' }],
      ...overrides,
    });

  const normalized = normalizeDayRules(
    fullWeek().map((rule) => (rule.weekday === 2 ? flexible({}) : rule)),
  );
  expect(normalized[1]).toMatchObject({
    ruleType: 'FLEXIBLE',
    dutyStartTime: null,
    earliestStartTime: '07:00',
    latestStartTime: '09:00',
    requiredMinutes: 480,
  });

  expect(() =>
    normalizeDayRules(
      fullWeek().map((rule) => (rule.weekday === 2 ? flexible({ dutyStartTime: '08:00' }) : rule)),
    ),
  ).toThrow(/cannot declare a fixed duty start time/);
  expect(() =>
    normalizeDayRules(
      fullWeek().map((rule) => (rule.weekday === 2 ? flexible({ requiredMinutes: 481 }) : rule)),
    ),
  ).toThrow(/latest permitted start to the duty end/);
  expect(() =>
    normalizeDayRules(
      fullWeek().map((rule) =>
        rule.weekday === 2
          ? flexible({
              breaks: [{ breakStartTime: '08:00', breakEndTime: '13:00' }],
              requiredMinutes: 420,
            })
          : rule,
      ),
    ),
  ).toThrow(/inside the paid duty window/);
  expect(() =>
    normalizeDayRules(
      fullWeek().map((rule) =>
        rule.weekday === 2 ? flexible({ coreStartTime: '06:00', coreEndTime: '14:00' }) : rule,
      ),
    ),
  ).toThrow(/inside the guaranteed duty window/);
  expect(() =>
    normalizeDayRules(
      fullWeek().map((rule) => (rule.weekday === 2 ? flexible({ coreStartTime: '10:00' }) : rule)),
    ),
  ).toThrow(/both a core start time and a core end time/);
});

it('accepts overnight duty and closes the Event Collection Window at midnight', () => {
  const overnight = normalizeDayRules(
    fullWeek().map((rule) =>
      rule.weekday === 3
        ? fixedRule(3, {
            dutyStartTime: '22:00',
            dutyEndTime: '06:00',
            endNextCalendarDay: true,
            requiredMinutes: 420,
            breaks: [{ breakStartTime: '02:00', breakEndTime: '03:00' }],
            collectionAfterMinutes: 30,
          })
        : rule,
    ),
  );
  expect(overnight[2]).toMatchObject({
    dutyStartTime: '22:00',
    dutyEndTime: '06:00',
    endNextCalendarDay: true,
    requiredMinutes: 420,
    breaks: [{ sequenceNo: 1, breakStartTime: '02:00', breakEndTime: '03:00' }],
    collectionAfterMinutes: 30,
  });

  expect(() =>
    normalizeDayRules(
      fullWeek().map((rule) =>
        rule.weekday === 3
          ? fixedRule(3, { dutyStartTime: '22:00', dutyEndTime: '06:00', requiredMinutes: 480 })
          : rule,
      ),
    ),
  ).toThrow(/must end after it starts/);
  expect(() =>
    normalizeDayRules(
      fullWeek().map((rule) =>
        rule.weekday === 3 ? fixedRule(3, { collectionAfterMinutes: 500 }) : rule,
      ),
    ),
  ).toThrow(/must end before midnight/);
  expect(() =>
    normalizeDayRules(
      fullWeek().map((rule) =>
        rule.weekday === 3
          ? fixedRule(3, {
              dutyStartTime: '00:30',
              requiredMinutes: 930,
              collectionBeforeMinutes: 60,
            })
          : rule,
      ),
    ),
  ).toThrow(/cannot start before midnight/);
});

it('normalizes schedule and arrangement definitions at the public boundary', () => {
  const schedule = normalizeScheduleDefinition({
    scheduleType: 'REGULAR',
    effectiveDate: '2026-09-01',
    dayRules: fullWeek(),
  });
  expect(schedule.timezone).toBe('Asia/Manila');
  expect(schedule.dayRules).toHaveLength(7);
  expect(() =>
    normalizeScheduleDefinition({
      scheduleType: 'REGULAR',
      timezone: 'Not/AZone',
      effectiveDate: '2026-09-01',
      dayRules: fullWeek(),
    }),
  ).toThrow(/IANA time zone/);

  const arrangement = normalizeArrangementDefinition({
    arrangementType: 'HYBRID',
    permittedScheduleTypes: ['REGULAR', 'SHIFT', 'REGULAR'],
    holidayCalendarId,
    effectiveDate: '2026-09-01',
  });
  expect(arrangement.permittedScheduleTypes).toEqual(['REGULAR', 'SHIFT']);
  expect(() =>
    normalizeArrangementDefinition({
      arrangementType: 'HYBRID',
      permittedScheduleTypes: [],
      holidayCalendarId,
      effectiveDate: '2026-09-01',
    }),
  ).toThrow(/at least one Work Schedule type/);
  expect(() =>
    normalizeArrangementDefinition({
      arrangementType: 'HYBRID',
      permittedScheduleTypes: ['REGULAR'],
      holidayCalendarId: ' ',
      effectiveDate: '2026-09-01',
    }),
  ).toThrow(/must select one Holiday Calendar/);
});

it('keeps date and time conversions stable', () => {
  expect(formatDate(toDatabaseDate('2026-09-01'))).toBe('2026-09-01');
  expect(formatDate(addDays(toDatabaseDate('2026-09-01'), -1))).toBe('2026-08-31');
  expect(toTimeValue(8 * 60 + 30).toISOString()).toBe('1970-01-01T08:30:00.000Z');
  expect(fromTimeValue(toTimeValue(23 * 60 + 59))).toBe('23:59');
  expect(() => toDatabaseDate('2026-02-30')).toThrow(/effective date is invalid/);
});
