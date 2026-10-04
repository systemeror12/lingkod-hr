import { z } from 'zod';
import type {
  AttendanceDayState,
  AttendancePeriodState,
} from '../attendance-days/attendance-days.types';

export const ATTENDANCE_SUBMISSION_STATES = [
  'DRAFT',
  'SUBMITTED',
  'RETURNED',
  'APPROVED',
  'CANCELLED',
  'STALE',
] as const;
export type AttendanceSubmissionState = (typeof ATTENDANCE_SUBMISSION_STATES)[number];

export class AttendanceSubmissionServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly reasons: string[] = [],
  ) {
    super(message);
    this.name = 'AttendanceSubmissionServiceError';
  }
}

export interface AttendanceSubmissionPeriodSummary {
  id: string;
  code: string;
  dateFrom: string;
  dateTo: string;
  status: AttendancePeriodState;
}

export interface AttendanceSubmissionDaySummary {
  attendanceDayId: string;
  workDate: string;
  status: AttendanceDayState;
  calculationVersion: number;
  isCurrent: boolean;
  openExceptionCount: number;
}

export interface AttendanceSubmissionSummary {
  id: string;
  agencyId: string;
  period: AttendanceSubmissionPeriodSummary;
  employee: { id: string; employeeNumber: string; legalName: string };
  versionNo: number;
  status: AttendanceSubmissionState;
  submittedByMembershipId: string;
  submittedAt: string | null;
  onBehalfReason: string | null;
  evidenceDocumentVersionId: string | null;
  reviewedByMembershipId: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  dayCount: number;
  createdAt: string;
}

export interface AttendanceSubmissionDetail {
  submission: AttendanceSubmissionSummary;
  days: AttendanceSubmissionDaySummary[];
}

export interface AttendanceSubmissionListFilters {
  attendancePeriodId?: string | undefined;
  employeeId?: string | undefined;
  status?: AttendanceSubmissionState | undefined;
  limit?: number | undefined;
}

export interface CreateAttendanceSubmissionInput {
  attendancePeriodId: string;
  employeeId?: string | undefined;
  onBehalfReason?: string | undefined;
  evidenceDocumentVersionId?: string | undefined;
}

export const createAttendanceSubmissionSchema = z
  .object({
    attendancePeriodId: z.string().uuid(),
    employeeId: z.string().uuid().optional(),
    onBehalfReason: z.string().trim().min(1).max(2000).optional(),
    evidenceDocumentVersionId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.onBehalfReason === undefined) !== (value.evidenceDocumentVersionId === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An on-behalf reason and its immutable evidence are both required.',
        path: ['onBehalfReason'],
      });
    }
  });

export const attendanceSubmissionReturnSchema = z
  .object({ reason: z.string().trim().min(1).max(2000) })
  .strict();

export const attendanceSubmissionApproveSchema = z
  .object({ reason: z.string().trim().min(1).max(2000).optional() })
  .strict();

export const attendanceSubmissionCancelSchema = z
  .object({ reason: z.string().trim().min(1).max(2000).optional() })
  .strict();

export const attendanceSubmissionIdSchema = z.string().uuid();
export const attendanceSubmissionIdempotencyKeySchema = z.string().trim().min(1).max(200);
export const attendanceSubmissionListStatusSchema = z.enum(ATTENDANCE_SUBMISSION_STATES).optional();
export const attendanceSubmissionListPeriodSchema = z.string().uuid().optional();
export const attendanceSubmissionListEmployeeSchema = z.string().uuid().optional();
