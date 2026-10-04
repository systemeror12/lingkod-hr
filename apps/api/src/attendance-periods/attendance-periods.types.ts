import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { AttendancePeriodState } from '../attendance-days/attendance-days.types';

export const ATTENDANCE_PERIOD_VERSION_STATES = [
  'FOR_REVIEW',
  'APPROVED',
  'RETURNED',
  'LOCKED',
] as const;
export type AttendancePeriodVersionState = (typeof ATTENDANCE_PERIOD_VERSION_STATES)[number];

export const ATTENDANCE_PAYROLL_FACT_TYPES = [
  'EXPECTED',
  'WORKED',
  'OFFICIAL_BUSINESS',
  'OFFICIAL_TRAVEL',
  'TRAINING',
  'APPROVED_ABSENCE',
  'POSTED_LEAVE',
  'TARDINESS',
  'UNDERTIME',
  'ABSENCE',
] as const;
export type AttendancePayrollFactType = (typeof ATTENDANCE_PAYROLL_FACT_TYPES)[number];

export const ATTENDANCE_PAYROLL_PUBLICATION_TYPES = ['ORIGINAL', 'ADJUSTMENT'] as const;
export type AttendancePayrollPublicationType =
  (typeof ATTENDANCE_PAYROLL_PUBLICATION_TYPES)[number];

export const ATTENDANCE_PERIOD_LOCK_ROUTE_CODE = 'DTR-PERIOD-LOCK';
export const ATTENDANCE_PERIOD_RECONCILIATION_SOURCE = 'ATTENDANCE_PERIOD_LOCK';

export class AttendancePeriodServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly reasons: string[] = [],
  ) {
    super(message);
    this.name = 'AttendancePeriodServiceError';
  }
}

export interface AttendancePeriodReconciliationFailure {
  code: string;
  message: string;
  details?: Prisma.JsonValue;
}

export interface AttendancePeriodReconciliation {
  source: typeof ATTENDANCE_PERIOD_RECONCILIATION_SOURCE;
  checkedAt: string;
  ok: boolean;
  failures: AttendancePeriodReconciliationFailure[];
  population: {
    employeeCount: number;
    workDateCount: number;
    membershipCount: number;
  };
  applicability: {
    applicableEmployeeCount: number;
    missingEmployeeIds: string[];
  };
  submissions: {
    approvedCount: number;
    approvedDayCount: number;
    missingEmployeeIds: string[];
  };
  days: {
    currentDayCount: number;
    approvedDayCount: number;
    unresolvedExceptionCount: number;
    exceptionIds: string[];
  };
  corrections: {
    unresolvedCount: number;
    correctionIds: string[];
  };
  sources: {
    changedBindingCount: number;
    changedBindings: string[];
  };
  authority: {
    approvalRouteVersionId: string;
    activeRouteVersionId: string | null;
    unchanged: boolean;
  };
  dtrs: {
    expectedCount: number;
    existingCount: number;
    missingEmployeeIds: string[];
  };
  payroll: {
    factCount: number;
    factMinutes: number;
    factTypeMinutes: Record<AttendancePayrollFactType, number>;
    expectedMinutes: number;
    excludedOutsideScheduleMinutes: number;
    excludedStatutoryNightWindowMinutes: number;
  };
}

export interface AttendancePeriodVersionSummary {
  id: string;
  attendancePeriodId: string;
  period: {
    id: string;
    code: string;
    dateFrom: string;
    dateTo: string;
    status: AttendancePeriodState;
  };
  versionNo: number;
  status: AttendancePeriodVersionState;
  predecessorVersionId: string | null;
  approvalRouteVersionId: string;
  submittedByMembershipId: string;
  submittedAt: string;
  reviewedByMembershipId: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  lockedByMembershipId: string | null;
  lockedAt: string | null;
  coveredEmployeeCount: number;
  coveredWorkDateCount: number;
  dtrCount: number;
  /** Bound Attendance Days since recalculated; such a version can never lock. */
  supersededDayCount: number;
  publication: AttendancePayrollPublicationSummary | null;
}

export interface AttendancePeriodVersionDetail {
  version: AttendancePeriodVersionSummary;
  reconciliation: AttendancePeriodReconciliation | null;
}

export interface AttendancePayrollPublicationSummary {
  id: string;
  attendancePeriodVersionId: string;
  predecessorPublicationId: string | null;
  publicationType: AttendancePayrollPublicationType;
  idempotencyKey: string;
  publishedAt: string;
  factCount: number;
  factMinutes: number;
}

export interface AttendancePayrollFactSummary {
  id: string;
  employeeId: string;
  workDate: string;
  attendanceDayId: string;
  factType: AttendancePayrollFactType;
  holidayClassification: string | null;
  stableSourceKey: string;
  correctedMinutes: number;
  priorMinutes: number | null;
  differenceDirection: 'INCREASE' | 'DECREASE' | null;
  differenceMinutes: number | null;
}

export interface AttendancePayrollPublicationDetail {
  publication: AttendancePayrollPublicationSummary;
  facts: AttendancePayrollFactSummary[];
}

export interface AttendancePeriodLockResult {
  version: AttendancePeriodVersionSummary;
  dtrDocumentIds: string[];
  existingDtrDocumentIds: string[];
  publication: AttendancePayrollPublicationSummary;
  replay: boolean;
}

export interface AttendancePeriodListFilters {
  attendancePeriodId?: string | undefined;
  status?: AttendancePeriodVersionState | undefined;
  limit?: number | undefined;
}

export const attendancePeriodIdSchema = z.string().uuid();
export const attendancePeriodVersionIdSchema = z.string().uuid();
export const attendancePeriodIdempotencyKeySchema = z.string().trim().min(1).max(200);
export const attendancePeriodDecisionSchema = z
  .object({ reason: z.string().trim().min(1).max(1000).optional() })
  .strict();
export const attendancePeriodReturnSchema = z
  .object({ reason: z.string().trim().min(1).max(1000) })
  .strict();
