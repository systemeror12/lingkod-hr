import { z } from 'zod';
import { LEAVE_EVIDENCE_KINDS, LEAVE_QUALIFYING_EVENTS } from '../leave-policies/leave-catalogue';

export const leaveApplicationIdSchema = z.string().uuid();
export const leaveApplicationDateSchema = z.string().date();
export const leaveApplicationInstantSchema = z.string().datetime({ offset: true });
export const leaveApplicationIdempotencyKeySchema = z.string().trim().min(1).max(200);
export const leaveApplicationReasonSchema = z.string().trim().min(1).max(1000);

export const LEAVE_APPLICATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'FOR_CERTIFICATION',
  'FOR_RECOMMENDATION',
  'FOR_APPROVAL',
  'APPROVED',
  'REJECTED',
  'NEEDS_INFORMATION',
  'WITHDRAWN',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'POSTED',
] as const;

export const LEAVE_APPLICATION_DOCUMENT_PURPOSES = [
  ...LEAVE_EVIDENCE_KINDS,
  'RENDERED_FORM',
  'SIGNED_FORM',
  'WITHDRAWAL_EVIDENCE',
] as const;

export const LEAVE_APPLICATION_ATTESTATION_TYPES = [
  'AUTHENTICATED_SUBMISSION',
  'SIGNED_DOCUMENT',
] as const;

export const LEAVE_APPLICATION_SUBMISSION_METHODS = {
  AUTHENTICATED_SUBMISSION: 'SELF_SERVICE_AUTHENTICATED',
  SIGNED_DOCUMENT: 'ADMIN_RECORDED_SIGNED_FORM',
} as const;

export const leaveApplicationPeriodSchema = z
  .object({
    dateFrom: leaveApplicationDateSchema,
    dateTo: leaveApplicationDateSchema,
  })
  .strict()
  .refine(({ dateFrom, dateTo }) => dateTo >= dateFrom, {
    message: 'The period end date cannot precede its start date.',
    path: ['dateTo'],
  });

export const leaveApplicationPolicyDetailsSchema = z
  .object({
    qualifyingEvent: z.enum(LEAVE_QUALIFYING_EVENTS).optional(),
  })
  .strict();

export const leaveApplicationCreateSchema = z
  .object({
    employeeId: leaveApplicationIdSchema.optional(),
    leaveTypeId: leaveApplicationIdSchema,
  })
  .strict();

export const leaveApplicationDraftSchema = z
  .object({
    leaveTypeId: leaveApplicationIdSchema.optional(),
    reason: leaveApplicationReasonSchema.optional(),
    policyDetails: leaveApplicationPolicyDetailsSchema.optional(),
    commutationChoice: z.enum(['REQUESTED', 'NOT_REQUESTED']).optional(),
    periods: z.array(leaveApplicationPeriodSchema).min(1).max(20).optional(),
    documents: z
      .array(
        z
          .object({
            documentId: leaveApplicationIdSchema,
            purposeCode: z.enum(LEAVE_EVIDENCE_KINDS),
          })
          .strict(),
      )
      .max(40)
      .optional(),
  })
  .strict();

export const leaveApplicationSubmitSchema = z
  .object({
    formTemplateDocumentVersionId: leaveApplicationIdSchema,
    attestation: z.discriminatedUnion('type', [
      z.object({ type: z.literal('AUTHENTICATED_SUBMISSION') }).strict(),
      z
        .object({
          type: z.literal('SIGNED_DOCUMENT'),
          documentId: leaveApplicationIdSchema,
          receivedAt: leaveApplicationInstantSchema,
        })
        .strict(),
    ]),
  })
  .strict();

export const leaveApplicationWithdrawSchema = z
  .object({
    reason: leaveApplicationReasonSchema,
    evidenceDocumentId: leaveApplicationIdSchema.optional(),
  })
  .strict();

export const leaveApplicationDocumentSchema = z
  .object({
    documentId: leaveApplicationIdSchema,
    purposeCode: z.enum(LEAVE_APPLICATION_DOCUMENT_PURPOSES),
  })
  .strict();

export const LEAVE_APPLICATION_QUANTITY_PATTERN = /^\d{1,8}(\.\d{1,4})?$/;

export const leaveApplicationQuantitySchema = z
  .string()
  .regex(LEAVE_APPLICATION_QUANTITY_PATTERN, 'Enter a quantity with up to four decimal places.');

export const LEAVE_APPROVAL_ALLOCATION_KINDS = [
  'LEAVE_ACCOUNT',
  'LEAVE_WITHOUT_PAY',
  'NON_CREDIT',
] as const;

export type LeaveApprovalAllocationKind = (typeof LEAVE_APPROVAL_ALLOCATION_KINDS)[number];

export const LEAVE_RECOMMENDATION_OUTCOMES = ['RECOMMEND_APPROVAL', 'RECOMMEND_REJECTION'] as const;

export const leaveApplicationCertificationSchema = z
  .object({
    balanceAsOf: leaveApplicationDateSchema.optional(),
  })
  .strict();

export const leaveApplicationRecommendationSchema = z
  .object({
    outcome: z.enum(LEAVE_RECOMMENDATION_OUTCOMES),
    reason: leaveApplicationReasonSchema.optional(),
    comments: leaveApplicationReasonSchema.optional(),
  })
  .strict()
  .refine(({ outcome, reason }) => outcome !== 'RECOMMEND_REJECTION' || reason !== undefined, {
    message: 'A negative recommendation requires a reason.',
    path: ['reason'],
  });

export const leaveApplicationDecisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    comments: leaveApplicationReasonSchema.optional(),
    allocations: z
      .array(
        z
          .object({
            segmentId: leaveApplicationIdSchema,
            quantity: leaveApplicationQuantitySchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(80)
      .optional(),
  })
  .strict()
  .refine(({ decision, comments }) => decision !== 'REJECT' || comments !== undefined, {
    message: 'A rejection requires a reason.',
    path: ['comments'],
  });

export const leaveApplicationReturnSchema = z
  .object({
    reason: leaveApplicationReasonSchema,
    comments: leaveApplicationReasonSchema.optional(),
  })
  .strict();

export const leaveApplicationListSchema = z
  .object({
    employeeId: leaveApplicationIdSchema.optional(),
    leaveTypeId: leaveApplicationIdSchema.optional(),
    status: z.enum(LEAVE_APPLICATION_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export type LeaveApplicationDraftInput = z.infer<typeof leaveApplicationDraftSchema>;
export type LeaveApplicationSubmitInput = z.infer<typeof leaveApplicationSubmitSchema>;
export type LeaveApplicationWithdrawInput = z.infer<typeof leaveApplicationWithdrawSchema>;
export type LeaveApplicationDocumentInput = z.infer<typeof leaveApplicationDocumentSchema>;
export type LeaveApplicationCertificationInput = z.infer<
  typeof leaveApplicationCertificationSchema
>;
export type LeaveApplicationRecommendationInput = z.infer<
  typeof leaveApplicationRecommendationSchema
>;
export type LeaveApplicationDecisionInput = z.infer<typeof leaveApplicationDecisionSchema>;
export type LeaveApplicationReturnInput = z.infer<typeof leaveApplicationReturnSchema>;
