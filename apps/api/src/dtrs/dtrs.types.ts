import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type {
  AttendanceDayClassification,
  AttendanceDayState,
  AttendanceExceptionState,
  AttendancePeriodState,
} from '../attendance-days/attendance-days.types';

export const DTR_CLASSIFICATIONS = ['ORIGINAL', 'CORRECTED'] as const;
export type DtrClassification = (typeof DTR_CLASSIFICATIONS)[number];

export const DTR_OUTPUT_TYPES = ['PRINTABLE_SYSTEM_VIEW', 'EXACT_VERSIONED_FORM'] as const;
export type DtrOutputType = (typeof DTR_OUTPUT_TYPES)[number];

export const DTR_PRESENTATION_SLOTS = ['AM_IN', 'AM_OUT', 'PM_IN', 'PM_OUT'] as const;
export type DtrPresentationSlot = (typeof DTR_PRESENTATION_SLOTS)[number];

export const DTR_MANIFEST_FORMAT = 'LINGKODHR_DTR_SYSTEM_VIEW_V1';

export class DtrServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly reasons: string[] = [],
  ) {
    super(message);
    this.name = 'DtrServiceError';
  }
}

export interface DtrPresentationEntry {
  slot: DtrPresentationSlot | null;
  label: string;
  eventId: string;
  sourceType: 'ATTENDANCE_EVENT' | 'ATTENDANCE_CORRECTION_EFFECT';
  eventType: string;
  eventTime: string;
  localDate: string;
  localTime: string;
}

export interface DtrManifestSegment {
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

export interface DtrManifestDay {
  attendanceDayId: string;
  calculationVersion: number;
  workDate: string;
  dayClassification: AttendanceDayClassification;
  status: AttendanceDayState;
  totals: {
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
  };
  schedule: {
    dayRuleId: string | null;
    ruleType: string | null;
    timezone: string | null;
    dutyStartTime: string | null;
    dutyEndTime: string | null;
    endNextCalendarDay: boolean | null;
    eventPattern: string | null;
  };
  sources: {
    fingerprint: string;
    scheduleAssignmentId: string | null;
    workScheduleVersionId: string | null;
    workArrangementVersionId: string | null;
    holidayCalendarVersionId: string | null;
  };
  presentation: DtrPresentationEntry[];
  segments: DtrManifestSegment[];
  exceptions: Array<{
    id: string;
    exceptionType: string;
    status: AttendanceExceptionState;
    message: string | null;
  }>;
}

export interface DtrManifestPeriod {
  id: string;
  code: string;
  dateFrom: string;
  dateTo: string;
  status: AttendancePeriodState;
}

export interface DtrManifestEmployee {
  id: string;
  employeeNumber: string;
  legalName: string;
}

export interface DtrManifestVersion {
  id: string;
  versionNo: number;
  predecessorVersionId: string | null;
  lockedAt: string | null;
  lockedByMembershipId: string | null;
  reviewedAt: string | null;
  reviewedByMembershipId: string | null;
}

export interface DtrManifest {
  format: typeof DTR_MANIFEST_FORMAT;
  classification: DtrClassification;
  outputType: DtrOutputType;
  predecessorDtrDocumentId: string | null;
  period: DtrManifestPeriod;
  version: DtrManifestVersion;
  employee: DtrManifestEmployee;
  generatedAt: string;
  days: DtrManifestDay[];
  /**
   * The exact Printable System View rendering retained with the artifact, so
   * every print reproduces the finalized output even if the renderer changes.
   */
  renderedSystemViewHtml?: string;
}

export interface DtrPreview {
  unfinalized: true;
  period: DtrManifestPeriod;
  employee: DtrManifestEmployee;
  days: DtrManifestDay[];
}

export interface DtrPeriodVersionSummary {
  id: string;
  attendancePeriodId: string;
  versionNo: number;
  status: string;
  predecessorVersionId: string | null;
  lockedAt: string | null;
  dtrCount: number;
}

export interface DtrDocumentSummary {
  id: string;
  agencyId: string;
  attendancePeriodVersionId: string;
  period: DtrManifestPeriod;
  versionNo: number;
  versionStatus: string;
  employee: DtrManifestEmployee;
  classification: DtrClassification;
  outputType: DtrOutputType;
  predecessorDtrDocumentId: string | null;
  documentVersionId: string;
  generatedAt: string;
  isCurrent: boolean;
}

export interface DtrDocumentDetail {
  document: DtrDocumentSummary;
  manifest: DtrManifest;
}

export interface DtrGenerateResult {
  attendancePeriodVersionId: string;
  dtrDocumentIds: string[];
  existingDtrDocumentIds: string[];
}

export interface DtrListFilters {
  attendancePeriodId?: string | undefined;
  employeeId?: string | undefined;
  currentOnly?: boolean | undefined;
  limit?: number | undefined;
}

export interface DtrPreviewInput {
  attendancePeriodId: string;
  employeeId?: string | undefined;
}

export const dtrPeriodIdSchema = z.string().uuid();
export const dtrDocumentIdSchema = z.string().uuid();
export const dtrVersionIdSchema = z.string().uuid();
export const dtrPreviewEmployeeSchema = z.string().uuid().optional();
export const dtrListPeriodSchema = z.string().uuid().optional();
export const dtrListEmployeeSchema = z.string().uuid().optional();
export const dtrListCurrentSchema = z.enum(['true', 'false']).optional();
