export const OVERTIME_SERVICE_STATUSES = [
  'RENDERED',
  'FOR_CERTIFICATION',
  'CERTIFIED',
  'NOT_CERTIFIED',
] as const;
export type OvertimeServiceStatus = (typeof OVERTIME_SERVICE_STATUSES)[number];

/** Claimed service for one covered Employee and Work Date under one approved authority. */
export interface OvertimeServiceRecordInput {
  overtimeAuthorityId: string;
  employeeId: string;
  workDate: string;
  claimedHours: string;
  accomplishment: string;
}

/**
 * Claimed, authorized, and actual hours stay separate. `authorizedHours` is
 * the Employee's total across the authority. The actual fields are filled on
 * submission from locked Attendance.
 */
export interface OvertimeServiceRecordSummary {
  id: string;
  agencyId: string;
  overtimeAuthorityId: string;
  overtimeAuthorityEmployeeId: string;
  authorityNo: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  workDate: string;
  claimedHours: string;
  authorizedHours: string;
  accomplishment: string;
  actualMinutes: number | null;
  sourceAttendanceDayId: string | null;
  /** The Work Date's holiday classification if it has one, else `WORKDAY` or `REST_DAY`. */
  dayClassification: string | null;
  status: OvertimeServiceStatus;
  recordedByMembershipId: string;
  createdAt: string;
}

export class OvertimeServiceRecordError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'OvertimeServiceRecordError';
  }
}
