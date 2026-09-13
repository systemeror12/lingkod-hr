import { z } from 'zod';
import { EMPLOYEE_CIVIL_STATUSES, EMPLOYEE_SEXES } from '../employees/employees.schemas';

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

export const APPOINTMENT_EXTERNAL_SUBMISSION_EVENT_TYPES = [
  'SUBMITTED',
  'RECEIVED',
  'RETURNED',
  'RESUBMITTED',
] as const;

export const APPOINTMENT_EXTERNAL_ACTIONS = [
  'APPROVED',
  'DISAPPROVED',
  'VALIDATED',
  'INVALIDATED',
] as const;

export const APPOINTMENT_ASSUMPTION_STATUSES = [
  'PENDING',
  'ASSUMED',
  'DID_NOT_ASSUME',
  'CANCELLED',
] as const;

export const APPOINTMENT_ASSUMPTION_OUTCOMES = ['DID_NOT_ASSUME', 'CANCELLED'] as const;

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

export const appointmentExternalSubmissionSchema = z
  .object({
    appointmentVersionId: appointmentIdSchema,
    eventType: z.enum(APPOINTMENT_EXTERNAL_SUBMISSION_EVENT_TYPES),
    externalReference: z.string().trim().min(1).max(200).optional(),
    occurredAt: z.string().datetime(),
    receivingOffice: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(1000).optional(),
    evidenceDocumentVersionId: appointmentIdSchema,
  })
  .strict();

export const appointmentExternalActionSchema = z
  .object({
    appointmentVersionId: appointmentIdSchema,
    action: z.enum(APPOINTMENT_EXTERNAL_ACTIONS),
    externalReference: z.string().trim().min(1).max(200),
    actionAt: z.string().datetime(),
    reason: z.string().trim().min(1).max(1000).optional(),
    evidenceDocumentVersionId: appointmentIdSchema,
  })
  .strict();

export const appointmentReceiptSchema = z
  .object({
    acknowledgedAt: z.string().datetime(),
    evidenceDocumentVersionId: appointmentIdSchema,
  })
  .strict();

const oathFields = {
  oathDate: z.string().date(),
  administeredByMembershipId: appointmentIdSchema,
  authority: z.string().trim().min(1).max(200),
  place: z.string().trim().min(1).max(200).optional(),
  permittedVirtualMethod: z.string().trim().min(1).max(200).optional(),
  documentVersionId: appointmentIdSchema,
};

export const appointmentOathSchema = z.object({ ...oathFields }).strict();

export const appointmentOathCorrectionSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000),
    authorityDocumentVersionId: appointmentIdSchema,
    ...oathFields,
  })
  .strict();

const assumptionFields = {
  oathVersionId: appointmentIdSchema,
  actualAssumptionDate: z.string().date(),
  certifiedByMembershipId: appointmentIdSchema,
  certifyingAuthority: z.string().trim().min(1).max(200),
  certifiedAt: z.string().datetime(),
  documentVersionId: appointmentIdSchema,
};

export const appointmentAssumptionSchema = z.object({ ...assumptionFields }).strict();

export const appointmentAssumptionCorrectionSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000),
    authorityDocumentVersionId: appointmentIdSchema,
    ...assumptionFields,
  })
  .strict();

const assumptionOutcomeFields = {
  outcomeDate: z.string().date(),
  reason: z.string().trim().min(1).max(1000),
  authorizedByMembershipId: appointmentIdSchema,
  authorityDocumentVersionId: appointmentIdSchema,
  evidenceDocumentVersionId: appointmentIdSchema,
};

export const appointmentAssumptionFailureSchema = z
  .object({
    noticeDate: z.string().date(),
    deadlineDate: z.string().date(),
    ...assumptionOutcomeFields,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.deadlineDate < value.noticeDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['deadlineDate'],
        message: 'The deadline cannot precede the notice date.',
      });
    }
  });

export const appointmentAssumptionCancellationSchema = z
  .object({ ...assumptionOutcomeFields })
  .strict();

const activationEmployeeFields = {
  employeeNumber: z.string().trim().min(1).max(80),
  birthDate: z.string().date(),
  sex: z.enum(EMPLOYEE_SEXES),
  civilStatus: z.enum(EMPLOYEE_CIVIL_STATUSES),
  contactEmail: z.string().trim().email().max(320),
};

export const appointmentActivationSchema = z
  .object({
    employeeId: appointmentIdSchema.optional(),
    employee: z
      .object({ ...activationEmployeeFields })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const provided = (value.employeeId ? 1 : 0) + (value.employee ? 1 : 0);
    if (provided === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['employeeId'],
        message: 'Link an Employee or create one from the appointee identity.',
      });
    }
    if (provided > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['employee'],
        message: 'Activate service for either an existing Employee or a new one.',
      });
    }
  });
