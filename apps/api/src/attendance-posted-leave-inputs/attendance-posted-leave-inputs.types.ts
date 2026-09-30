export const POSTED_LEAVE_UNIT_CODES = [
  'WORKING_DAY',
  'CALENDAR_DAY',
  'SCHEDULED_MINUTE',
  'SOURCE_DEFINED',
] as const;
export type PostedLeaveUnitCode = (typeof POSTED_LEAVE_UNIT_CODES)[number];

export const POSTED_LEAVE_ALLOCATION_KINDS = [
  'LEAVE_ACCOUNT',
  'LEAVE_WITHOUT_PAY',
  'NON_CREDIT',
] as const;
export type PostedLeaveAllocationKind = (typeof POSTED_LEAVE_ALLOCATION_KINDS)[number];

/** One posted allocation line as Leave hands it to Attendance. */
export interface CreatePostedLeaveInput {
  /** Stable key Leave derives from the posting, so a retry returns the same input. */
  sourceKey: string;
  employeeId: string;
  /** The Leave record the input traces back to. */
  sourceType: string;
  sourceId: string;
  dateFrom: string;
  dateTo: string;
  unitCode: PostedLeaveUnitCode;
  quantity: number;
  allocationKind: PostedLeaveAllocationKind;
  /** The current input this one supersedes, when it corrects earlier posted leave. */
  predecessorInputId?: string | undefined;
}

/** Current posted leave covering one Work Date. A non-null ambiguity blocks the calculation. */
export interface PostedLeaveDayCoverage {
  inputId: string;
  sourceType: string;
  sourceId: string;
  allocationKind: PostedLeaveAllocationKind;
  quantity: number;
  ambiguousReason: string | null;
}

export class AttendancePostedLeaveInputError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'AttendancePostedLeaveInputError';
  }
}

export function invalid(message: string): AttendancePostedLeaveInputError {
  return new AttendancePostedLeaveInputError(message, 400, 'POSTED_LEAVE_INPUT_INVALID');
}

export function toDatabaseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || date.toISOString().slice(0, 10) !== value) {
    throw invalid('Enter a valid calendar date.');
  }
  return date;
}

export function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Why a posted-leave input cannot be placed as whole Work Date coverage, or
 * null when it can. Attendance places only whole days; a fraction, minutes, or
 * a source-defined quantity would need an interval it must not assume.
 */
export function postedLeaveAmbiguity(input: {
  dateFrom: string;
  dateTo: string;
  unitCode: PostedLeaveUnitCode;
  quantity: number;
}): string | null {
  if (input.unitCode !== 'WORKING_DAY' && input.unitCode !== 'CALENDAR_DAY') {
    return `The posted leave unit ${input.unitCode} carries no clock placement for the Work Date.`;
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    return 'The posted leave covers a fraction of the Work Date without a clock placement.';
  }
  const rangeDays =
    (toDatabaseDate(input.dateTo).getTime() - toDatabaseDate(input.dateFrom).getTime()) / DAY_MS +
    1;
  if (input.unitCode === 'CALENDAR_DAY' && input.quantity !== rangeDays) {
    return 'The posted leave quantity does not match the calendar days in its date range.';
  }
  if (input.quantity > rangeDays) {
    return 'The posted leave quantity exceeds the days in its date range.';
  }
  return null;
}
