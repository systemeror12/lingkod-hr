import { Prisma } from '@prisma/client';
import { isNonWorkingHoliday } from '../attendance-configuration/holiday-effect-rules';

export interface LeaveWithoutPayWorkDate {
  workDate: string;
  quantity: string;
}

/**
 * The day quantity on each Work Date of a leave-without-pay allocation line,
 * which Payroll values at the monthly salary in effect on those dates
 * (payroll-schema.md §4, #328). Working dates come from the line's frozen
 * Leave Calculation Segment: its Work Schedule day rules less the non-working
 * holidays in its holiday facts.
 *
 * A line places only when it covers every date it counts, one day each. A line
 * that is only part of its range, such as the unpaid excess of a charged
 * segment, returns a reason instead: no source says which of its dates are the
 * unpaid ones.
 */
export function leaveWithoutPayWorkDates(line: {
  dateFrom: string;
  dateTo: string;
  unitCode: string;
  quantity: string;
  dayRules: readonly { weekday: number; ruleType: string }[] | null;
  holidayFacts: unknown;
}): { workDates: LeaveWithoutPayWorkDate[] } | { reason: string } {
  if (line.unitCode !== 'WORKING_DAY' && line.unitCode !== 'CALENDAR_DAY') {
    return { reason: `A ${line.unitCode} quantity has no day quantity per Work Date.` };
  }
  const dates: string[] = [];
  for (let date = line.dateFrom; date <= line.dateTo; date = nextDate(date)) dates.push(date);
  let workDates = dates;
  if (line.unitCode === 'WORKING_DAY') {
    const holidays = nonWorkingHolidayDates(line.holidayFacts);
    if (!holidays) return { reason: 'Its frozen holiday facts cannot be read.' };
    const rules = line.dayRules;
    const ruleTypes = dates.map(
      (date) => rules?.find(({ weekday }) => weekday === isoWeekday(date))?.ruleType,
    );
    if (ruleTypes.some((ruleType) => ruleType === undefined)) {
      return { reason: 'Its frozen Work Schedule does not cover every date in its range.' };
    }
    workDates = dates.filter((date, index) => ruleTypes[index] !== 'REST' && !holidays.has(date));
  }
  if (!new Prisma.Decimal(line.quantity).equals(workDates.length)) {
    return {
      reason: `It is ${line.quantity} of the ${workDates.length} Work Dates in its range, and no rule says which of them are without pay.`,
    };
  }
  return { workDates: workDates.map((workDate) => ({ workDate, quantity: '1.0000' })) };
}

function nonWorkingHolidayDates(holidayFacts: unknown): Set<string> | null {
  if (holidayFacts === null || typeof holidayFacts !== 'object') return null;
  const entries = (holidayFacts as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return null;
  const dates = new Set<string>();
  for (const entry of entries as unknown[]) {
    if (entry === null || typeof entry !== 'object') return null;
    const { holidayDate, dayType } = entry as Record<string, unknown>;
    if (typeof holidayDate !== 'string' || typeof dayType !== 'string') return null;
    if (isNonWorkingHoliday(dayType)) dates.add(holidayDate);
  }
  return dates;
}

function nextDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function isoWeekday(value: string): number {
  return new Date(`${value}T00:00:00.000Z`).getUTCDay() || 7;
}
