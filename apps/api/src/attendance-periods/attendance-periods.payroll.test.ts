import { describe, expect, it } from 'vitest';
import {
  attendancePayrollFactKey,
  buildAttendancePayrollAdjustmentLines,
  deriveAttendancePayrollFactLines,
  summarizeAttendancePayrollFactMinutes,
  type PayrollFactSourceDay,
  type PayrollFactSourceSegment,
} from './attendance-periods.payroll';

const WORK_DATE = '2026-06-15';

function segment(
  input: Partial<PayrollFactSourceSegment> & { minutes: number },
): PayrollFactSourceSegment {
  const startsAt = new Date(`${WORK_DATE}T01:00:00.000Z`);
  return {
    dutyRelation: input.dutyRelation ?? 'EXPECTED',
    coverageType: input.coverageType ?? 'WORKED',
    deficitType: input.deficitType ?? null,
    holidayClassification: input.holidayClassification ?? null,
    startsAt,
    endsAt: new Date(startsAt.getTime() + input.minutes * 60_000),
  };
}

function day(
  attendanceDayId: string,
  segments: readonly PayrollFactSourceSegment[],
  nightDutyMinutes = 0,
): PayrollFactSourceDay {
  return {
    attendanceDayId,
    employeeId: 'employee-1',
    workDate: WORK_DATE,
    nightDutyMinutes,
    segments,
  };
}

describe('deriveAttendancePayrollFactLines', () => {
  it('publishes exact expected, coverage, and deficit minutes by holiday classification', () => {
    const lines = deriveAttendancePayrollFactLines([
      day('day-1', [
        segment({ minutes: 240, coverageType: 'WORKED' }),
        segment({ minutes: 60, coverageType: 'UNCOVERED', deficitType: 'UNDERTIME' }),
        segment({
          minutes: 120,
          coverageType: 'OFFICIAL_BUSINESS',
          holidayClassification: 'SPECIAL_NON_WORKING',
        }),
        segment({ minutes: 30, coverageType: 'UNCOVERED', deficitType: 'ABSENCE' }),
      ]),
    ]);

    const byKey = new Map(lines.map((line) => [line.stableSourceKey, line]));
    expect(
      byKey.get(
        attendancePayrollFactKey({
          employeeId: 'employee-1',
          workDate: WORK_DATE,
          factType: 'EXPECTED',
          holidayClassification: null,
        }),
      )?.minutes,
    ).toBe(330);
    expect(
      byKey.get(
        attendancePayrollFactKey({
          employeeId: 'employee-1',
          workDate: WORK_DATE,
          factType: 'EXPECTED',
          holidayClassification: 'SPECIAL_NON_WORKING',
        }),
      )?.minutes,
    ).toBe(120);
    expect(lines.find((line) => line.factType === 'WORKED')?.minutes).toBe(240);
    expect(lines.find((line) => line.factType === 'OFFICIAL_BUSINESS')?.minutes).toBe(120);
    expect(lines.find((line) => line.factType === 'OFFICIAL_BUSINESS')?.holidayClassification).toBe(
      'SPECIAL_NON_WORKING',
    );
    expect(lines.find((line) => line.factType === 'UNDERTIME')?.minutes).toBe(60);
    expect(lines.find((line) => line.factType === 'ABSENCE')?.minutes).toBe(30);

    const totals = summarizeAttendancePayrollFactMinutes(lines);
    expect(totals.EXPECTED).toBe(450);
    expect(
      totals.WORKED +
        totals.OFFICIAL_BUSINESS +
        totals.OFFICIAL_TRAVEL +
        totals.TRAINING +
        totals.APPROVED_ABSENCE +
        totals.POSTED_LEAVE +
        totals.TARDINESS +
        totals.UNDERTIME +
        totals.ABSENCE,
    ).toBe(totals.EXPECTED);
  });

  it('leaves outside-schedule minutes, night ones included, out of the publication', () => {
    const lines = deriveAttendancePayrollFactLines([
      day('day-1', [
        segment({ minutes: 480, coverageType: 'WORKED' }),
        segment({ minutes: 90, coverageType: 'WORKED', dutyRelation: 'OUTSIDE_SCHEDULE' }),
      ]),
    ]);
    expect(lines.filter((line) => line.factType === 'WORKED')[0]?.minutes).toBe(480);
    expect(summarizeAttendancePayrollFactMinutes(lines).EXPECTED).toBe(480);
    expect(lines.some((line) => line.factType === 'NIGHT_DUTY')).toBe(false);
  });

  it('publishes one night-duty fact per Day with night duty under a stable key', () => {
    const lines = deriveAttendancePayrollFactLines([
      day('day-1', [segment({ minutes: 480, coverageType: 'WORKED' })], 360),
      {
        ...day('day-2', [segment({ minutes: 480, coverageType: 'WORKED' })]),
        workDate: '2026-06-16',
      },
    ]);

    const night = lines.filter((line) => line.factType === 'NIGHT_DUTY');
    expect(night).toEqual([
      {
        employeeId: 'employee-1',
        workDate: WORK_DATE,
        attendanceDayId: 'day-1',
        factType: 'NIGHT_DUTY',
        holidayClassification: null,
        minutes: 360,
        stableSourceKey: `employee-1|${WORK_DATE}|NIGHT_DUTY|NONE`,
      },
    ]);
    const totals = summarizeAttendancePayrollFactMinutes(lines);
    expect(totals.NIGHT_DUTY).toBe(360);
    expect(totals.EXPECTED).toBe(960);
  });

  it('keeps posted leave as retained attendance provenance', () => {
    const lines = deriveAttendancePayrollFactLines([
      day('day-1', [
        segment({ minutes: 300, coverageType: 'WORKED' }),
        segment({ minutes: 180, coverageType: 'POSTED_LEAVE' }),
      ]),
    ]);
    expect(lines.find((line) => line.factType === 'POSTED_LEAVE')?.minutes).toBe(180);
    expect(summarizeAttendancePayrollFactMinutes(lines).EXPECTED).toBe(480);
  });

  it('publishes CTO as its own classification', () => {
    const lines = deriveAttendancePayrollFactLines([
      day('day-1', [
        segment({ minutes: 240, coverageType: 'WORKED' }),
        segment({ minutes: 240, coverageType: 'CTO' }),
      ]),
    ]);
    expect(lines.find((line) => line.factType === 'CTO')?.minutes).toBe(240);
    expect(summarizeAttendancePayrollFactMinutes(lines).EXPECTED).toBe(480);
  });
});

describe('buildAttendancePayrollAdjustmentLines', () => {
  function linesFor(minutes: { worked: number; absence: number }) {
    return deriveAttendancePayrollFactLines([
      day('day-2', [
        segment({ minutes: minutes.worked, coverageType: 'WORKED' }),
        segment({ minutes: minutes.absence, coverageType: 'UNCOVERED', deficitType: 'ABSENCE' }),
      ]),
    ]);
  }

  it('publishes only changed facts with prior, corrected, and nonnegative difference', () => {
    const prior = linesFor({ worked: 480, absence: 0 });
    const successor = linesFor({ worked: 420, absence: 60 });
    const changed = buildAttendancePayrollAdjustmentLines(prior, successor);
    const worked = changed.find((line) => line.factType === 'WORKED');
    const absence = changed.find((line) => line.factType === 'ABSENCE');
    expect(changed.find((line) => line.factType === 'EXPECTED')).toBeUndefined();
    expect(worked).toMatchObject({
      priorMinutes: 480,
      minutes: 420,
      differenceDirection: 'DECREASE',
      differenceMinutes: 60,
    });
    expect(absence).toMatchObject({
      priorMinutes: 0,
      minutes: 60,
      differenceDirection: 'INCREASE',
      differenceMinutes: 60,
    });
  });

  it('publishes a disappeared fact as a zero corrected value against its predecessor day', () => {
    const prior = linesFor({ worked: 480, absence: 0 });
    const successor = deriveAttendancePayrollFactLines([
      day('day-2', [segment({ minutes: 0, coverageType: 'WORKED' })]),
    ]);
    const changed = buildAttendancePayrollAdjustmentLines(prior, successor);
    const removal = changed.find((line) => line.factType === 'WORKED');
    expect(removal).toMatchObject({
      minutes: 0,
      attendanceDayId: 'day-2',
      priorMinutes: 480,
      differenceDirection: 'DECREASE',
      differenceMinutes: 480,
    });
  });

  it('publishes a changed night-duty quantity as a delta', () => {
    const worked = [segment({ minutes: 480, coverageType: 'WORKED' })];
    const prior = deriveAttendancePayrollFactLines([day('day-3', worked, 120)]);
    const successor = deriveAttendancePayrollFactLines([day('day-3', worked, 360)]);

    expect(buildAttendancePayrollAdjustmentLines(prior, successor)).toEqual([
      expect.objectContaining({
        factType: 'NIGHT_DUTY',
        priorMinutes: 120,
        minutes: 360,
        differenceDirection: 'INCREASE',
        differenceMinutes: 240,
      }),
    ]);
    const removed = buildAttendancePayrollAdjustmentLines(
      prior,
      deriveAttendancePayrollFactLines([day('day-3', worked)]),
    );
    expect(removed).toEqual([
      expect.objectContaining({
        factType: 'NIGHT_DUTY',
        priorMinutes: 120,
        minutes: 0,
        differenceDirection: 'DECREASE',
        differenceMinutes: 120,
      }),
    ]);
  });

  it('emits nothing when the successor matches the predecessor exactly', () => {
    const prior = linesFor({ worked: 480, absence: 0 });
    expect(
      buildAttendancePayrollAdjustmentLines(prior, linesFor({ worked: 480, absence: 0 })),
    ).toEqual([]);
  });
});
