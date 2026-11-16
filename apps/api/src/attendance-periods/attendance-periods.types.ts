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
  'CTO',
  'TARDINESS',
  'UNDERTIME',
  'ABSENCE',
  'NIGHT_DUTY',
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
    /** Worked minutes outside expected duty, night ones included; never published. */
    excludedOutsideScheduleMinutes: number;
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

/**
 * One TARDINESS or UNDERTIME fact as Leave reads it to charge vacation leave
 * (ADR 0012), with the duty its Work Date expected and the schedule it ran on.
 */
export interface AttendanceDeficitFact {
  id: string;
  employeeId: string;
  workDate: string;
  factType: 'TARDINESS' | 'UNDERTIME';
  holidayClassification: string | null;
  stableSourceKey: string;
  correctedMinutes: number;
  priorMinutes: number | null;
  /** The source Attendance Day's expected duty minutes. */
  expectedMinutes: number;
  /** `REGULAR`, `FLEXIBLE`, `SHIFT`, or `COMPRESSED`; null on an unscheduled Day. */
  scheduleType: string | null;
  /** `FIXED`, `FLEXIBLE`, or `REST`; null when the Day names no Day Rule. */
  dayRuleType: string | null;
  /** Earlier publications' facts with the same stable key, oldest first. */
  earlierFactIds: string[];
  /** Whether a later publication carries a fact with the same stable key. */
  supersededByLaterFact: boolean;
}

export interface AttendanceDeficitFactsRead {
  publicationId: string;
  publicationType: AttendancePayrollPublicationType;
  facts: AttendanceDeficitFact[];
}

/** One ABSENCE fact as Payroll reads it by cutoff (ADR 0014). */
export interface AttendanceAbsenceFact {
  id: string;
  publicationId: string;
  publicationType: AttendancePayrollPublicationType;
  employeeId: string;
  workDate: string;
  correctedMinutes: number;
  /** The effective earlier value on an adjustment publication; null on an original. */
  priorMinutes: number | null;
  /** The source Attendance Day's expected duty minutes. */
  expectedMinutes: number;
}

/**
 * One NIGHT_DUTY fact as Payroll reads it by cutoff (ADR 0014): worked
 * expected-duty minutes of its Work Date in the 18:00-06:00 window of RA No.
 * 11701, overtime excluded (#328 decision 8).
 */
export type AttendanceNightDutyFact = Omit<AttendanceAbsenceFact, 'expectedMinutes'>;

/**
 * What Payroll reads from Attendance at a cutoff: every publication published
 * at or before it, and their ABSENCE and NIGHT_DUTY facts.
 */
export interface AttendancePayrollFactsByCutoff {
  publicationIds: string[];
  absenceFacts: AttendanceAbsenceFact[];
  nightDutyFacts: AttendanceNightDutyFact[];
}

/** One Employee's current minutes on one Work Date, by fact type. */
export interface AttendanceWorkDate {
  employeeId: string;
  workDate: string;
  minutes: Partial<Record<AttendancePayrollFactType, number>>;
}

/**
 * What Payroll reads of a date range at a cutoff: the dates that published
 * Attendance Periods cover, and each Employee's current minutes on them,
 * where a later publication's value for a fact replaces an earlier one.
 */
export interface AttendanceWorkDatesByCutoff {
  coveredDates: { from: string; to: string }[];
  workDates: AttendanceWorkDate[];
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
