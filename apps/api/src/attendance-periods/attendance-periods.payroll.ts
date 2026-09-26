import type { AttendancePayrollFactType } from './attendance-periods.types';
import { ATTENDANCE_PAYROLL_FACT_TYPES } from './attendance-periods.types';

/**
 * One Attendance Day segment reduced to the facts the segment proves. Only
 * expected-duty segments participate: outside-schedule and statutory night
 * window minutes remain Phase 8 candidate-hours handoffs and never enter an
 * Attendance Payroll Publication.
 */
export interface PayrollFactSourceSegment {
  dutyRelation: string;
  coverageType: string;
  deficitType: string | null;
  holidayClassification: string | null;
  startsAt: Date;
  endsAt: Date;
}

export interface PayrollFactSourceDay {
  attendanceDayId: string;
  employeeId: string;
  workDate: string;
  segments: readonly PayrollFactSourceSegment[];
}

export interface AttendancePayrollFactLine {
  employeeId: string;
  workDate: string;
  attendanceDayId: string;
  factType: AttendancePayrollFactType;
  holidayClassification: string | null;
  minutes: number;
  stableSourceKey: string;
}

export interface AttendancePayrollAdjustmentLine extends AttendancePayrollFactLine {
  priorMinutes: number;
  differenceDirection: 'INCREASE' | 'DECREASE';
  differenceMinutes: number;
}

const COVERAGE_FACT_TYPES: Readonly<Record<string, AttendancePayrollFactType>> = {
  WORKED: 'WORKED',
  OFFICIAL_BUSINESS: 'OFFICIAL_BUSINESS',
  OFFICIAL_TRAVEL: 'OFFICIAL_TRAVEL',
  TRAINING: 'TRAINING',
  APPROVED_ABSENCE: 'APPROVED_ABSENCE',
  POSTED_LEAVE: 'POSTED_LEAVE',
};

const DEFICIT_FACT_TYPES: Readonly<Record<string, AttendancePayrollFactType>> = {
  TARDINESS: 'TARDINESS',
  UNDERTIME: 'UNDERTIME',
  ABSENCE: 'ABSENCE',
};

/**
 * The line identity is stable across a correction successor: Employee, Work
 * Date, attendance classification, and holiday classification define the
 * economic fact, while the source Attendance Day version is carried as a
 * column. A retry therefore cannot duplicate a line, and an adjustment
 * publication can match a successor fact against its predecessor value.
 */
export function attendancePayrollFactKey(input: {
  employeeId: string;
  workDate: string;
  factType: AttendancePayrollFactType;
  holidayClassification: string | null;
}): string {
  return [
    input.employeeId,
    input.workDate,
    input.factType,
    input.holidayClassification ?? 'NONE',
  ].join('|');
}

function segmentFactTypes(segment: PayrollFactSourceSegment): AttendancePayrollFactType[] {
  if (segment.dutyRelation !== 'EXPECTED') return [];
  const factTypes: AttendancePayrollFactType[] = ['EXPECTED'];
  if (segment.coverageType === 'UNCOVERED') {
    const deficit = segment.deficitType ? DEFICIT_FACT_TYPES[segment.deficitType] : undefined;
    if (deficit) factTypes.push(deficit);
    return factTypes;
  }
  const coverage = COVERAGE_FACT_TYPES[segment.coverageType];
  if (coverage) factTypes.push(coverage);
  return factTypes;
}

function segmentMinutes(segment: PayrollFactSourceSegment): number {
  return Math.round((segment.endsAt.getTime() - segment.startsAt.getTime()) / 60_000);
}

/**
 * Derive the exact nonnegative minute lines of one Attendance Period Version.
 * Expected duty contributes one EXPECTED line per holiday classification and
 * one coverage or deficit line per classification, so the expected minutes
 * reconcile exactly as covered-plus-uncovered.
 */
export function deriveAttendancePayrollFactLines(
  days: readonly PayrollFactSourceDay[],
): AttendancePayrollFactLine[] {
  const lines = new Map<string, AttendancePayrollFactLine>();
  for (const day of days) {
    for (const segment of day.segments) {
      const minutes = segmentMinutes(segment);
      if (minutes <= 0) continue;
      for (const factType of segmentFactTypes(segment)) {
        const stableSourceKey = attendancePayrollFactKey({
          employeeId: day.employeeId,
          workDate: day.workDate,
          factType,
          holidayClassification: segment.holidayClassification,
        });
        const existing = lines.get(stableSourceKey);
        if (existing) {
          existing.minutes += minutes;
          continue;
        }
        lines.set(stableSourceKey, {
          employeeId: day.employeeId,
          workDate: day.workDate,
          attendanceDayId: day.attendanceDayId,
          factType,
          holidayClassification: segment.holidayClassification,
          minutes,
          stableSourceKey,
        });
      }
    }
  }
  return [...lines.values()].sort((left, right) =>
    left.stableSourceKey.localeCompare(right.stableSourceKey),
  );
}

export function emptyAttendancePayrollFactMinutes(): Record<AttendancePayrollFactType, number> {
  return Object.fromEntries(
    ATTENDANCE_PAYROLL_FACT_TYPES.map((factType) => [factType, 0]),
  ) as Record<AttendancePayrollFactType, number>;
}

export function summarizeAttendancePayrollFactMinutes(
  lines: readonly AttendancePayrollFactLine[],
): Record<AttendancePayrollFactType, number> {
  const totals = emptyAttendancePayrollFactMinutes();
  for (const line of lines) totals[line.factType] += line.minutes;
  return totals;
}

/**
 * An adjustment publication contains only changed facts. A line that appears
 * preserves its prior and corrected value with a nonnegative direction; a line
 * that disappears publishes a zero corrected value against the retained
 * predecessor Attendance Day version so no economic effect is retracted.
 */
export function buildAttendancePayrollAdjustmentLines(
  priorLines: readonly AttendancePayrollFactLine[],
  successorLines: readonly AttendancePayrollFactLine[],
): AttendancePayrollAdjustmentLine[] {
  const priorByKey = new Map(priorLines.map((line) => [line.stableSourceKey, line]));
  const successorByKey = new Map(successorLines.map((line) => [line.stableSourceKey, line]));
  const changed: AttendancePayrollAdjustmentLine[] = [];
  for (const line of successorByKey.values()) {
    const prior = priorByKey.get(line.stableSourceKey)?.minutes ?? 0;
    if (prior === line.minutes) continue;
    const difference = line.minutes - prior;
    changed.push({
      ...line,
      priorMinutes: prior,
      differenceDirection: difference > 0 ? 'INCREASE' : 'DECREASE',
      differenceMinutes: Math.abs(difference),
    });
  }
  for (const line of priorByKey.values()) {
    if (successorByKey.has(line.stableSourceKey)) continue;
    changed.push({
      ...line,
      minutes: 0,
      priorMinutes: line.minutes,
      differenceDirection: 'DECREASE',
      differenceMinutes: line.minutes,
    });
  }
  return changed.sort((left, right) => left.stableSourceKey.localeCompare(right.stableSourceKey));
}
