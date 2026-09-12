import { z } from 'zod';
import { recruitmentDateSchema, recruitmentIdSchema } from './recruitment.schemas';

export const SELECTION_BOARD_SESSION_STATUSES = [
  'DRAFT',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;

export const BOARD_ROLES = ['CHAIR', 'MEMBER', 'SECRETARIAT', 'OBSERVER'] as const;

export const BOARD_ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'RECUSED'] as const;

export const BOARD_RECOMMENDATION_VALUES = ['RECOMMENDED', 'NOT_RECOMMENDED'] as const;

export const SELECTION_DECISION_VALUES = ['SELECTED', 'NOT_SELECTED', 'RETURNED'] as const;

export const sessionCreateSchema = z
  .object({
    vacancyPublicationId: recruitmentIdSchema,
    sessionDate: recruitmentDateSchema,
  })
  .strict();

export const sessionListSchema = z
  .object({
    vacancyPublicationId: recruitmentIdSchema.optional(),
    status: z.enum(SELECTION_BOARD_SESSION_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const boardParticipationSchema = z
  .object({
    rosterSnapshotMemberId: recruitmentIdSchema,
    attendanceStatus: z.enum(BOARD_ATTENDANCE_STATUSES),
    signedAt: z.string().datetime().optional(),
  })
  .strict();

export const conflictDeclarationSchema = z
  .object({
    participationId: recruitmentIdSchema,
    applicationId: recruitmentIdSchema,
    hasConflict: z.boolean(),
    details: z.string().trim().max(2000).optional(),
  })
  .strict();

export const boardRecommendationSchema = z
  .object({
    applicationId: recruitmentIdSchema,
    recommendation: z.enum(BOARD_RECOMMENDATION_VALUES),
    rankNo: z.number().int().min(1).max(1000).optional(),
    compositeScore: z.number().finite().optional(),
    reason: z.string().trim().max(2000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.recommendation === 'NOT_RECOMMENDED' && !value.reason) {
      context.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'A not-recommended outcome requires the board reason.',
      });
    }
  });

export const candidateEvaluationReportSchema = z
  .object({
    reportDocumentVersionId: recruitmentIdSchema,
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

export const sessionCompletionSchema = z
  .object({
    minutesDocumentVersionId: recruitmentIdSchema.optional(),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

export const selectionDecisionSchema = z
  .object({
    decision: z.enum(SELECTION_DECISION_VALUES),
    reason: z.string().trim().min(1).max(2000),
    authorityDocumentVersionId: recruitmentIdSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === 'SELECTED' && value.authorityDocumentVersionId === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['authorityDocumentVersionId'],
        message: 'A selection requires the appointing authority evidence.',
      });
    }
  });

export const selectionDecisionListSchema = z
  .object({
    applicationId: recruitmentIdSchema.optional(),
    sessionId: recruitmentIdSchema.optional(),
    decision: z.enum(SELECTION_DECISION_VALUES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const sessionCommandSchema = z.object({}).strict();

export type SelectionBoardSessionStatus = (typeof SELECTION_BOARD_SESSION_STATUSES)[number];
export type BoardRole = (typeof BOARD_ROLES)[number];
export type BoardAttendanceStatus = (typeof BOARD_ATTENDANCE_STATUSES)[number];
export type BoardRecommendationValue = (typeof BOARD_RECOMMENDATION_VALUES)[number];
export type SelectionDecisionValue = (typeof SELECTION_DECISION_VALUES)[number];
