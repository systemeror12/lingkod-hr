import type { HolidayDayType } from './attendance-configuration.types';

/**
 * Holiday classifications on which no duty is expected for the minutes of that
 * actual calendar date (ADR 0006). One fixed national rule shared by Attendance
 * and Leave; `SPECIAL_WORKING` keeps ordinary duty.
 */
const NON_WORKING_HOLIDAY_DAY_TYPES: ReadonlySet<string> = new Set<HolidayDayType>([
  'REGULAR_HOLIDAY',
  'SPECIAL_NON_WORKING',
  'LOCAL_HOLIDAY',
  'WORK_SUSPENSION',
]);

/** Whether a Holiday Calendar classification removes expected duty on its date. */
export function isNonWorkingHoliday(dayType: string | null | undefined): boolean {
  return dayType != null && NON_WORKING_HOLIDAY_DAY_TYPES.has(dayType);
}
