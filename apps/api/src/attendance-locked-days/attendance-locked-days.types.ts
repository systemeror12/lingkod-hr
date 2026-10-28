/** A Work Date's Day Rule: scheduled duty, or a Day Rule `REST` day. */
export type LockedAttendanceDayType = 'WORKDAY' | 'REST_DAY';

/**
 * The locked attendance facts for one Employee and Work Date, read from the
 * Attendance Day version in the latest locked Attendance Period Version that
 * covers it. A Locked Attendance Adjustment's successor replaces its
 * predecessor here. These are facts only: no rate, ratio, or money.
 */
export interface LockedAttendanceDay {
  status: 'LOCKED';
  workDate: string;
  attendancePeriodVersionId: string;
  attendanceDayId: string;
  calculationVersion: number;
  /** Outside-schedule `WORKED` minutes: the Actual Overtime Hours. */
  outsideScheduleWorkedMinutes: number;
  dayType: LockedAttendanceDayType;
  /** The Holiday Calendar classification of the Work Date itself, if any. */
  holidayClassification: string | null;
  /**
   * Official travel the day version counted. `sourceIds` name its Attendance
   * Context or applied correction coverage sources.
   */
  officialTravel: {
    minutes: number;
    sourceIds: string[];
  };
  workArrangementVersion: {
    id: string;
    arrangementType: string;
  };
}

/** No locked Attendance Day version exists for this Employee and Work Date. */
export interface UnlockedAttendanceDay {
  status: 'NOT_LOCKED';
  workDate: string;
}

export type LockedAttendanceDayResult = LockedAttendanceDay | UnlockedAttendanceDay;

export class AttendanceLockedDayError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'AttendanceLockedDayError';
  }
}

/** Parse a `YYYY-MM-DD` Work Date, refusing anything that is not a calendar date. */
export function toWorkDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new AttendanceLockedDayError(
      `Work Date ${value} is not a valid calendar date.`,
      400,
      'ATTENDANCE_LOCKED_DAY_INVALID_DATE',
    );
  }
  return date;
}
