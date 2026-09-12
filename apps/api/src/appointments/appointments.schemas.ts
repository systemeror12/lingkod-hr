import { z } from 'zod';

export const APPOINTMENT_WORKFLOW_STATUSES = [
  'DRAFT',
  'FOR_REVIEW',
  'FOR_SIGNATURE',
  'ISSUED',
  'CANCELLED',
] as const;

export const APPOINTMENT_EMPLOYMENT_STATUSES = [
  'PERMANENT',
  'TEMPORARY',
  'COTERMINOUS',
  'FIXED_TERM',
  'CONTRACTUAL',
  'SUBSTITUTE',
  'PROVISIONAL',
] as const;

export const APPOINTMENT_NATURES = [
  'ORIGINAL',
  'PROMOTION',
  'TRANSFER',
  'REEMPLOYMENT',
  'REAPPOINTMENT',
  'REINSTATEMENT',
  'RECLASSIFICATION',
  'DEMOTION',
] as const;

export const APPOINTMENT_SIGNATURE_METHODS = [
  'WET_INK',
  'ELECTRONIC',
  'DIGITAL_CERTIFICATE',
] as const;

export const APPOINTMENT_LINK_ROLES = [
  'PDS',
  'WORK_EXPERIENCE_SHEET',
  'ELIGIBILITY_PROOF',
  'POSITION_DESCRIPTION_FORM',
  'SELECTION_CERTIFICATION',
  'PUBLICATION_CERTIFICATION',
  'AUTHORITY_OR_DELEGATION',
  'CONDITION_SPECIFIC_ATTACHMENT',
] as const;

export const APPOINTMENT_REGULATORY_STATUSES = ['REGULATED', 'ACCREDITED_OR_DEREGULATED'] as const;

export const appointmentIdSchema = z.string().uuid();
export const appointmentIdempotencyKeySchema = z.string().trim().min(1).max(200);

export const appointmentListSchema = z
  .object({
    status: z.enum(APPOINTMENT_WORKFLOW_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const appointmentReasonSchema = z
  .object({ reason: z.string().trim().min(1).max(1000) })
  .strict();

const appointmentEvidenceSchema = z
  .object({
    linkRole: z.enum(APPOINTMENT_LINK_ROLES),
    documentVersionId: appointmentIdSchema,
  })
  .strict();

const appointmentVersionFields = {
  employmentStatus: z.enum(APPOINTMENT_EMPLOYMENT_STATUSES),
  natureOfAppointment: z.enum(APPOINTMENT_NATURES),
  salaryGrade: z.number().int().min(1).max(33),
  salaryStep: z.number().int().min(1).max(8),
  effectivityDate: z.string().date(),
  appointingAuthorityMembershipId: appointmentIdSchema,
  signatureMethod: z.enum(APPOINTMENT_SIGNATURE_METHODS),
  signatureEvidenceDocumentVersionId: appointmentIdSchema.optional(),
  appointmentDocumentVersionId: appointmentIdSchema,
  evidence: z.array(appointmentEvidenceSchema).min(1).max(50),
};

function requireSignatureEvidence(
  value: {
    signatureMethod: (typeof APPOINTMENT_SIGNATURE_METHODS)[number];
    signatureEvidenceDocumentVersionId?: string | undefined;
  },
  context: z.RefinementCtx,
): void {
  if (value.signatureMethod !== 'WET_INK' && !value.signatureEvidenceDocumentVersionId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['signatureEvidenceDocumentVersionId'],
      message: 'Electronic and digital signatures require their evidenced certification.',
    });
  }
}

export const appointmentCreateSchema = z
  .object({
    selectionDecisionId: appointmentIdSchema,
    ...appointmentVersionFields,
  })
  .strict()
  .superRefine(requireSignatureEvidence);

export const appointmentUpdateSchema = z
  .object({ ...appointmentVersionFields })
  .strict()
  .superRefine(requireSignatureEvidence);

export const appointmentCorrectionSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000),
    authorityDocumentVersionId: appointmentIdSchema,
    ...appointmentVersionFields,
  })
  .strict()
  .superRefine(requireSignatureEvidence);

export const appointmentCancelSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000),
    authorityDocumentVersionId: appointmentIdSchema,
  })
  .strict();

export const appointmentSettingsSchema = z
  .object({
    regulatoryStatus: z.enum(APPOINTMENT_REGULATORY_STATUSES),
    statusEvidenceDocumentVersionId: appointmentIdSchema,
  })
  .strict();
