import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  ATTENDANCE_CONTEXT_COVERAGE_MODES,
  ATTENDANCE_CONTEXT_TYPES,
} from '../attendance-contexts/attendance-contexts.types';
import { ATTENDANCE_EVENT_TYPES } from '../attendance/attendance.types';

export const ATTENDANCE_CORRECTION_TARGET_TYPES = [
  'ATTENDANCE_EVENT',
  'ATTENDANCE_CONTEXT',
] as const;
export type AttendanceCorrectionTargetType = (typeof ATTENDANCE_CORRECTION_TARGET_TYPES)[number];

export const ATTENDANCE_CORRECTION_ACTIONS = ['ADD', 'REPLACE', 'VOID'] as const;
export type AttendanceCorrectionAction = (typeof ATTENDANCE_CORRECTION_ACTIONS)[number];

export const ATTENDANCE_CORRECTION_STATES = [
  'DRAFT',
  'SUBMITTED',
  'NEEDS_INFORMATION',
  'APPROVED',
  'FOR_AUTHORIZATION',
  'REJECTED',
  'CANCELLED',
  'APPLIED',
] as const;
export type AttendanceCorrectionState = (typeof ATTENDANCE_CORRECTION_STATES)[number];

export const ATTENDANCE_CORRECTION_ROUTE_CODE = 'ATTENDANCE_CORRECTION';
export const ATTENDANCE_CORRECTION_LOCKED_ROUTE_CODE = 'ATTENDANCE_CORRECTION_LOCKED';
export const ATTENDANCE_CORRECTION_APPROVAL_SUBJECT_TYPE = 'ATTENDANCE_CORRECTION';
export const ATTENDANCE_CORRECTION_APPROVAL_EFFECT_KIND = 'ATTENDANCE_CORRECTION';

export class AttendanceCorrectionServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly reasons: string[] = [],
  ) {
    super(message);
    this.name = 'AttendanceCorrectionServiceError';
  }
}

export interface RequestedAttendanceEventFact {
  eventType: (typeof ATTENDANCE_EVENT_TYPES)[number];
  eventTime: string;
  sourceReference: string | null;
  reason: string | null;
}

export interface RequestedAttendanceContextFact {
  contextType: (typeof ATTENDANCE_CONTEXT_TYPES)[number];
  coverageMode: (typeof ATTENDANCE_CONTEXT_COVERAGE_MODES)[number];
  workDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  reason: string;
  sourceType: string | null;
  sourceId: string | null;
  evidenceDocumentVersionId: string | null;
}

export type RequestedAttendanceFact = RequestedAttendanceEventFact | RequestedAttendanceContextFact;

export interface AttendanceCorrectionEvidenceSummary {
  id: string;
  documentVersionId: string | null;
  documentId: string | null;
  documentNo: string | null;
  documentType: string | null;
  sourceType: string | null;
  sourceId: string | null;
  createdAt: string;
}

export interface AttendanceCorrectionEffectSummary {
  id: string;
  effectAction: AttendanceCorrectionAction;
  targetType: AttendanceCorrectionTargetType;
  originalTargetId: string | null;
  replacementRecord: Prisma.JsonValue;
  appliedByMembershipId: string;
  appliedAt: string;
}

export interface AttendanceCorrectionLockedAdjustmentSummary {
  id: string;
  authorizedByMembershipId: string;
  authorizedAt: string;
  periods: Array<{
    predecessorPeriodVersionId: string;
    successorPeriodVersionId: string;
  }>;
}

export interface AttendanceCorrectionApprovalSummary {
  approvalRequestId: string;
  routeVersionId: string;
  status: string;
  currentStepNo: number | null;
}

export interface AttendanceCorrectionSummary {
  id: string;
  agencyId: string;
  employee: { id: string; employeeNumber: string; legalName: string };
  initiatedByMembershipId: string;
  recordedByMembershipId: string;
  targetType: AttendanceCorrectionTargetType;
  requestedAction: AttendanceCorrectionAction;
  targetId: string | null;
  requestedRecord: Prisma.JsonValue;
  status: AttendanceCorrectionState;
  reason: string;
  approvalRouteVersionId: string;
  submittedAt: string | null;
  decidedByMembershipId: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  authorizedByMembershipId: string | null;
  authorizedAt: string | null;
  appliedByMembershipId: string | null;
  appliedAt: string | null;
  createdAt: string;
}

export interface AttendanceCorrectionDetail {
  correction: AttendanceCorrectionSummary;
  impactPreview: AttendanceCorrectionImpactPreview;
  evidence: AttendanceCorrectionEvidenceSummary[];
  effect: AttendanceCorrectionEffectSummary | null;
  lockedAdjustment: AttendanceCorrectionLockedAdjustmentSummary | null;
  approval: AttendanceCorrectionApprovalSummary | null;
}

export interface AttendanceCorrectionImpactPreviewDay {
  employeeId: string;
  workDate: string;
  attendanceDayId: string | null;
  calculationVersion: number | null;
  status: string | null;
  attendancePeriodId: string;
  periodCode: string;
  periodStatus: string;
  lockedPeriodVersionId: string | null;
}

export interface AttendanceCorrectionImpactPreviewPeriod {
  id: string;
  code: string;
  dateFrom: string;
  dateTo: string;
  status: string;
}

export interface AttendanceCorrectionImpactPreview {
  computedAt: string;
  targetType: AttendanceCorrectionTargetType;
  requestedAction: AttendanceCorrectionAction;
  targetWorkDates: string[];
  proposedWorkDates: string[];
  days: AttendanceCorrectionImpactPreviewDay[];
  periods: AttendanceCorrectionImpactPreviewPeriod[];
  lockedPeriodVersionIds: string[];
  fingerprint: string;
}

export interface AttendanceCorrectionListFilters {
  employeeId?: string | undefined;
  status?: AttendanceCorrectionState | undefined;
  limit?: number | undefined;
}

export const attendanceCorrectionEvidenceSchema = z.union([
  z.object({ documentVersionId: z.string().uuid() }).strict(),
  z
    .object({
      sourceType: z.string().trim().min(1).max(100),
      sourceId: z.string().uuid(),
    })
    .strict(),
]);

const requestedEventFactSchema = z
  .object({
    eventType: z.enum(ATTENDANCE_EVENT_TYPES),
    eventTime: z.string().datetime({ offset: true }),
    sourceReference: z.string().trim().min(1).max(200).optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const attendanceCorrectionEventFactSchema = requestedEventFactSchema;

const contextFactDefinition = {
  contextType: z.enum(ATTENDANCE_CONTEXT_TYPES),
  reason: z.string().trim().min(1).max(1000),
  sourceType: z.string().trim().min(1).max(100).optional(),
  sourceId: z.string().uuid().optional(),
  evidenceDocumentVersionId: z.string().uuid().optional(),
};

const requestedContextFactSchema = z
  .discriminatedUnion('coverageMode', [
    z
      .object({
        ...contextFactDefinition,
        coverageMode: z.literal('WHOLE_WORK_DATE'),
        workDate: z.string().date(),
      })
      .strict(),
    z
      .object({
        ...contextFactDefinition,
        coverageMode: z.literal('TIMED'),
        startsAt: z.string().datetime({ offset: true }),
        endsAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    const hasSourceType = value.sourceType !== undefined;
    const hasSourceId = value.sourceId !== undefined;
    if (hasSourceType !== hasSourceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A linked authoritative source record requires both its type and its identifier.',
        path: ['sourceId'],
      });
    }
    if (!hasSourceType && value.evidenceDocumentVersionId === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'A requested Attendance Context requires a linked authoritative source record or a supporting Document Version.',
        path: ['evidenceDocumentVersionId'],
      });
    }
  });

export const attendanceCorrectionContextFactSchema = requestedContextFactSchema;

const correctionFactDefinition = {
  employeeId: z.string().uuid().optional(),
  requestedAction: z.enum(ATTENDANCE_CORRECTION_ACTIONS),
  targetId: z.string().uuid().optional(),
  reason: z.string().trim().min(1).max(1000),
  onBehalfReason: z.string().trim().min(1).max(1000).optional(),
  evidence: z.array(attendanceCorrectionEvidenceSchema).min(1).max(20),
};

function checkRequestedActionShape(
  value: {
    requestedAction: AttendanceCorrectionAction;
    targetId?: string | undefined;
    requestedRecord?: unknown;
  },
  context: z.RefinementCtx,
): void {
  const hasTarget = value.targetId !== undefined;
  const hasRecord = value.requestedRecord !== undefined;
  if (value.requestedAction === 'ADD' && (hasTarget || !hasRecord)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'An ADD correction proposes a new fact and must not name an existing target.',
      path: ['requestedRecord'],
    });
  }
  if (value.requestedAction === 'REPLACE' && (!hasTarget || !hasRecord)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A REPLACE correction requires the exact target and its replacement fact.',
      path: ['requestedRecord'],
    });
  }
  if (value.requestedAction === 'VOID' && (!hasTarget || hasRecord)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A VOID correction names an exact target and proposes no replacement fact.',
      path: ['requestedRecord'],
    });
  }
}

export const attendanceCorrectionCreateSchema = z
  .discriminatedUnion('targetType', [
    z
      .object({
        ...correctionFactDefinition,
        targetType: z.literal('ATTENDANCE_EVENT'),
        requestedRecord: requestedEventFactSchema.optional(),
      })
      .strict(),
    z
      .object({
        ...correctionFactDefinition,
        targetType: z.literal('ATTENDANCE_CONTEXT'),
        requestedRecord: requestedContextFactSchema.optional(),
      })
      .strict(),
  ])
  .superRefine(checkRequestedActionShape);

export type AttendanceCorrectionCreateInput = z.infer<typeof attendanceCorrectionCreateSchema>;

export const attendanceCorrectionDecisionSchema = z
  .object({ comments: z.string().trim().min(1).max(1000).optional() })
  .strict();

export const attendanceCorrectionReasonSchema = z
  .object({ reason: z.string().trim().min(1).max(1000) })
  .strict();

export const attendanceCorrectionIdSchema = z.string().uuid();
export const attendanceCorrectionEmployeeIdSchema = z.string().uuid().optional();
export const attendanceCorrectionStatusSchema = z.enum(ATTENDANCE_CORRECTION_STATES).optional();
export const attendanceCorrectionIdempotencyKeySchema = z.string().trim().min(1).max(200);

export const attendanceCorrectionListSchema = z
  .object({
    employeeId: z.string().uuid().optional(),
    status: z.enum(ATTENDANCE_CORRECTION_STATES).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();
