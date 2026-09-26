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
): PayrollFactSourceDay {
  return { attendanceDayId, employeeId: 'employee-1', workDate: WORK_DATE, segments };
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

  it('leaves outside-schedule and statutory night window minutes out of the publication', () => {
    const lines = deriveAttendancePayrollFactLines([
      day('day-1', [
        segment({ minutes: 480, coverageType: 'WORKED' }),
        segment({ minutes: 90, coverageType: 'WORKED', dutyRelation: 'OUTSIDE_SCHEDULE' }),
      ]),
    ]);
    expect(lines.filter((line) => line.factType === 'WORKED')[0]?.minutes).toBe(480);
    expect(summarizeAttendancePayrollFactMinutes(lines).EXPECTED).toBe(480);
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

  it('emits nothing when the successor matches the predecessor exactly', () => {
    const prior = linesFor({ worked: 480, absence: 0 });
    expect(
      buildAttendancePayrollAdjustmentLines(prior, linesFor({ worked: 480, absence: 0 })),
    ).toEqual([]);
  });
});
