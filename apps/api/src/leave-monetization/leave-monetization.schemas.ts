import { z } from 'zod';
import {
  MONETIZATION_ADJUSTMENT_SCOPES,
  MONETIZATION_ATTESTATION_TYPES,
  MONETIZATION_FUNDING_RESULTS,
  MONETIZATION_KINDS,
} from './monetization-catalogue';

export const monetizationIdSchema = z.string().uuid();
export const monetizationIdempotencyKeySchema = z.string().trim().min(1).max(120);
export const monetizationDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a calendar date in YYYY-MM-DD form.');
export const monetizationReasonSchema = z.string().trim().min(1).max(2000);
export const monetizationQuantitySchema = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,4})?$/, 'Enter a quantity with at most four decimal places.')
  .refine((value) => Number(value) > 0, 'Enter a positive quantity.');

const authoritySnapshotSchema = z
  .object({
    citations: z.array(z.string().trim().min(1).max(500)).min(1),
    valuationDate: monetizationDateSchema.optional(),
    fiscalPeriod: z.string().trim().min(1).max(120).optional(),
    salarySourceReference: z.string().trim().min(1).max(300).optional(),
    specialPercentageBasis: z.enum(['PER_ACCOUNT', 'COMBINED']).optional(),
    fractionalCreditRounding: z.enum(['DOWN', 'NEAREST']).optional(),
  })
  .strict();

const allocationSubmissionSchema = z
  .object({
    leaveAccountId: monetizationIdSchema,
    requestedQuantity: monetizationQuantitySchema,
  })
  .strict();

export const monetizationCreateSchema = z
  .object({ employeeId: monetizationIdSchema.optional() })
  .strict();

export const monetizationSubmitSchema = z
  .object({
    kind: z.enum(MONETIZATION_KINDS),
    reason: z.string().trim().max(2000).optional(),
    formTemplateDocumentVersionId: monetizationIdSchema,
    attestationType: z.enum(MONETIZATION_ATTESTATION_TYPES),
    attestationDocumentVersionId: monetizationIdSchema.optional(),
    authoritySnapshot: authoritySnapshotSchema,
    allocations: z.array(allocationSubmissionSchema).min(1).max(20),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.attestationType === 'SIGNED_DOCUMENT' && !value.attestationDocumentVersionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attestationDocumentVersionId'],
        message: 'A signed attestation requires the exact signed Document Version.',
      });
    }
    if (
      value.attestationType === 'AUTHENTICATED_SUBMISSION' &&
      value.attestationDocumentVersionId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attestationDocumentVersionId'],
        message: 'An authenticated submission does not carry a signed Document Version.',
      });
    }
    if (value.kind === 'SPECIAL' && !value.reason?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'Special monetization requires a valid and justifiable reason.',
      });
    }
  });

export const monetizationAssessmentSchema = z
  .object({ balanceEffectiveDate: monetizationDateSchema.optional() })
  .strict();

export const monetizationCertificationSchema = z
  .object({
    allocations: z
      .array(
        z
          .object({
            allocationId: monetizationIdSchema,
            certifiedQuantity: monetizationQuantitySchema.optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const monetizationReturnSchema = z.object({ reason: monetizationReasonSchema }).strict();

export const monetizationFundingSchema = z.object({
  result: z.enum(MONETIZATION_FUNDING_RESULTS),
  fiscalAuthorityDocumentVersionId: monetizationIdSchema,
  fundingSourceSnapshot: z.record(z.string(), z.unknown()),
  evidenceSnapshot: z.record(z.string(), z.unknown()),
});

export const monetizationDecisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    comments: z.string().trim().max(2000).optional(),
    approvedAllocations: z
      .array(
        z
          .object({
            allocationId: monetizationIdSchema,
            approvedQuantity: monetizationQuantitySchema,
          })
          .strict(),
      )
      .max(20)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === 'REJECT' && !value.comments?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['comments'],
        message: 'A rejection reason is required.',
      });
    }
    if (value.decision === 'REJECT' && value.approvedAllocations?.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['approvedAllocations'],
        message: 'A rejection does not carry approved allocations.',
      });
    }
  });

export const monetizationAdjustmentCreateSchema = z
  .object({
    scope: z.enum(MONETIZATION_ADJUSTMENT_SCOPES),
    reason: monetizationReasonSchema,
    lines: z
      .array(
        z
          .object({
            originalLedgerEntryId: monetizationIdSchema,
            retainedQuantity: z
              .string()
              .regex(/^\d{1,8}(\.\d{1,4})?$/, 'Enter a quantity with at most four decimal places.'),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

export type MonetizationCreateInput = z.infer<typeof monetizationCreateSchema>;
export type MonetizationSubmitInput = z.infer<typeof monetizationSubmitSchema>;
export type MonetizationAssessmentInput = z.infer<typeof monetizationAssessmentSchema>;
export type MonetizationCertificationInput = z.infer<typeof monetizationCertificationSchema>;
export type MonetizationReturnInput = z.infer<typeof monetizationReturnSchema>;
export type MonetizationFundingInput = z.infer<typeof monetizationFundingSchema>;
export type MonetizationDecisionInput = z.infer<typeof monetizationDecisionSchema>;
export type MonetizationAdjustmentCreateInput = z.infer<typeof monetizationAdjustmentCreateSchema>;
