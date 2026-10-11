import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AttendanceDayExceptionType } from './attendance-calculation';

export const ATTENDANCE_DAY_STATES = ['PENDING', 'CALCULATED', 'EXCEPTION', 'APPROVED'] as const;
export type AttendanceDayState = (typeof ATTENDANCE_DAY_STATES)[number];

export const ATTENDANCE_DAY_CLASSIFICATIONS = ['SCHEDULED', 'UNSCHEDULED_SERVICE'] as const;
export type AttendanceDayClassification = (typeof ATTENDANCE_DAY_CLASSIFICATIONS)[number];

export const ATTENDANCE_PERIOD_STATES = ['OPEN', 'FINALIZED'] as const;
export type AttendancePeriodState = (typeof ATTENDANCE_PERIOD_STATES)[number];

export const ATTENDANCE_EXCEPTION_STATES = ['OPEN', 'RESOLVED', 'WAIVED'] as const;
export type AttendanceExceptionState = (typeof ATTENDANCE_EXCEPTION_STATES)[number];

export class AttendanceDayServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly reasons: string[] = [],
  ) {
    super(message);
    this.name = 'AttendanceDayServiceError';
  }
}

export interface CalculateAttendanceDaysInput {
  periodCode: string;
  dateFrom: string;
  dateTo: string;
  employeeIds: string[];
}

export interface AttendanceDayListFilters {
  attendancePeriodId?: string | undefined;
  employeeId?: string | undefined;
  status?: AttendanceDayState | undefined;
  workDateFrom?: string | undefined;
  workDateTo?: string | undefined;
  limit?: number | undefined;
}

export interface AttendancePeriodSummary {
  id: string;
  code: string;
  dateFrom: string;
  dateTo: string;
  status: AttendancePeriodState;
  createdAt: string;
}

export interface AttendanceDayEmployeeSummary {
  id: string;
  employeeNumber: string;
  legalName: string;
}

export interface AttendanceDayTotalsSummary {
  expectedMinutes: number;
  workedMinutes: number;
  coverageMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
  absenceMinutes: number;
  officialBusinessMinutes: number;
  officialTravelMinutes: number;
  trainingMinutes: number;
  approvedAbsenceMinutes: number;
  postedLeaveMinutes: number;
  outsideScheduleMinutes: number;
  statutoryNightWindowMinutes: number;
}

export interface AttendanceDayRuleSnapshot {
  fingerprint: string;
  /** Absent on Days calculated before ADR 0005 and on unresolved Days. */
  minuteRule?: 'FULLY_COVERED_MINUTE' | undefined;
  timezone: string;
  assignmentId?: string | null | undefined;
  workScheduleVersionId?: string | null | undefined;
  workArrangementVersionId?: string | null | undefined;
  holidayCalendarVersionId?: string | null | undefined;
  dayRuleId?: string | null | undefined;
  holidayClassifications?: Record<string, string> | undefined;
  eventIds?: string[] | undefined;
  coverageSources?:
    Array<{ sourceType: string; sourceId: string; coverageType: string }> | undefined;
  resolutionException?:
    | {
        type: AttendanceDayExceptionType;
        message: string;
        details: Record<string, unknown>;
      }
    | undefined;
  capturedAt: string;
}

export interface AttendanceDaySummary {
  id: string;
  agencyId: string;
  attendancePeriodId: string;
  employee: AttendanceDayEmployeeSummary;
  workDate: string;
  dayClassification: AttendanceDayClassification;
  status: AttendanceDayState;
  calculationVersion: number;
  isCurrent: boolean;
  scheduleAssignmentId: string | null;
  workScheduleVersionId: string | null;
  workArrangementVersionId: string | null;
  holidayCalendarVersionId: string | null;
  ruleSnapshot: AttendanceDayRuleSnapshot;
  totals: AttendanceDayTotalsSummary;
  openExceptionCount: number;
  calculatedAt: string | null;
  createdAt: string;
}

export interface AttendanceDaySegmentSummary {
  id: string;
  sequenceNo: number;
  startsAt: string;
  endsAt: string;
  dutyRelation: string;
  coverageType: string;
  deficitType: string | null;
  holidayClassification: string | null;
  sourceReferences: Prisma.JsonValue;
}

export interface AttendanceExceptionSummary {
  id: string;
  exceptionType: string;
  status: AttendanceExceptionState;
  message: string | null;
  details: Prisma.JsonValue;
  resolvedAt: string | null;
  resolvedByMembershipId: string | null;
  createdAt: string;
}

export interface AttendanceDayDetail {
  day: AttendanceDaySummary;
  segments: AttendanceDaySegmentSummary[];
  exceptions: AttendanceExceptionSummary[];
}

export type AttendanceDayCalculationOutcome = 'CREATED' | 'RECALCULATED' | 'UNCHANGED';

export interface AttendanceDayCalculationResultSummary {
  employeeId: string;
  workDate: string;
  attendanceDayId: string | null;
  status: AttendanceDayState | null;
  outcome: AttendanceDayCalculationOutcome;
  exceptionTypes: AttendanceDayExceptionType[];
  staleSubmissionIds?: string[];
}

export interface CalculateAttendanceDaysResult {
  period: AttendancePeriodSummary;
  days: AttendanceDayCalculationResultSummary[];
  createdCount: number;
  recalculatedCount: number;
  unchangedCount: number;
}

export type AttendanceDayReadScope = { kind: 'AGENCY' } | { kind: 'SCOPED'; employeeIds: string[] };

export const calculateAttendanceDaysSchema = z
  .object({
    periodCode: z.string().trim().min(1).max(50),
    dateFrom: z.string().date(),
    dateTo: z.string().date(),
    employeeIds: z.array(z.string().uuid()).min(1).max(200),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.dateTo < value.dateFrom) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The calculation end date cannot precede its start date.',
        path: ['dateTo'],
      });
    }
  });

export const attendanceDayEmployeeIdSchema = z.string().uuid().optional();
export const attendanceDayPeriodIdSchema = z.string().uuid().optional();
export const attendanceDayStatusSchema = z.enum(ATTENDANCE_DAY_STATES).optional();
export const attendanceDayDateSchema = z.string().date().optional();
export const attendanceDayIdSchema = z.string().uuid();
