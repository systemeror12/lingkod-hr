import { z } from 'zod';

export const SALN_FILING_STATUSES = ['NOT_SUBMITTED', 'SUBMITTED', 'ACKNOWLEDGED'] as const;

const optionalUuid = z.string().uuid().nullable().optional();
const safeText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        ![...value].some((character) => {
          const code = character.charCodeAt(0);
          return (code >= 0 && code <= 31) || (code >= 127 && code <= 159);
        }),
      'Unsupported characters are not allowed.',
    );

const fields = {
  requirementReference: safeText(500),
  filingYear: z.number().int().min(1900).max(2200),
  filingType: safeText(80),
  status: z.enum(SALN_FILING_STATUSES),
  submittedAt: z.string().datetime({ offset: true }).nullable().optional(),
  repositoryReference: safeText(500).nullable().optional(),
  acknowledgmentDocumentId: optionalUuid,
  acknowledgmentDocumentVersionId: optionalUuid,
};

const metadataSchema = z
  .object(fields)
  .strict()
  .superRefine((value, context) => {
    if (
      Boolean(value.acknowledgmentDocumentId) !== Boolean(value.acknowledgmentDocumentVersionId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['acknowledgmentDocumentVersionId'],
        message: 'Acknowledgment must reference an exact Document Version.',
      });
    }
    if (value.status === 'NOT_SUBMITTED' && value.submittedAt) {
      context.addIssue({
        code: 'custom',
        path: ['submittedAt'],
        message: 'A non-submitted filing cannot have a submission timestamp.',
      });
    }
    if (value.status !== 'NOT_SUBMITTED' && !value.submittedAt) {
      context.addIssue({
        code: 'custom',
        path: ['submittedAt'],
        message: 'A submission timestamp is required for a submitted filing.',
      });
    }
  });

export const salnComplianceCreateSchema = metadataSchema;
export const salnComplianceUpdateSchema = metadataSchema;
export const salnComplianceCorrectionSchema = metadataSchema.safeExtend({
  reason: safeText(1000),
});
export const salnComplianceIdSchema = z.string().uuid();
