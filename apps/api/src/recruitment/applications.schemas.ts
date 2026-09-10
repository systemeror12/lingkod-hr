import { z } from 'zod';
import { recruitmentIdSchema } from './recruitment.schemas';

export const APPLICATION_STATUSES = [
  'RECEIVED',
  'INCOMPLETE',
  'QUALIFIED',
  'NOT_QUALIFIED',
  'WITHDRAWN',
  'CLOSED',
] as const;

export const APPLICATION_SCREENING_RESULTS = ['INCOMPLETE', 'QUALIFIED', 'NOT_QUALIFIED'] as const;

export const SCREENING_AREAS = [
  'EDUCATION',
  'TRAINING',
  'EXPERIENCE',
  'ELIGIBILITY',
  'LICENSES',
  'COMPETENCIES',
  'SPECIAL_REQUIREMENTS',
] as const;

export const SCREENING_AREA_RESULTS = [
  'MEETS',
  'DOES_NOT_MEET',
  'UNVERIFIED',
  'NOT_APPLICABLE',
] as const;

export const APPLICATION_DOCUMENT_PURPOSES = [
  'PRIVACY_CONSENT',
  'EDUCATION',
  'TRAINING',
  'EXPERIENCE',
  'ELIGIBILITY',
  'LICENSE',
  'COMPETENCY',
  'SPECIAL_REQUIREMENT',
  'OTHER',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export type ScreeningArea = (typeof SCREENING_AREAS)[number];
export type ScreeningAreaResult = (typeof SCREENING_AREA_RESULTS)[number];

const optionalPersonPart = z.string().trim().max(120).optional();

export const applicantIdentitySchema = z
  .object({
    firstName: z.string().trim().min(1).max(120),
    middleName: optionalPersonPart,
    lastName: z.string().trim().min(1).max(120),
    suffix: optionalPersonPart,
    email: z.string().trim().email().max(320).optional(),
    mobileNumber: z.string().trim().min(1).max(40).optional(),
    privacyNoticeVersion: z.string().trim().min(1).max(120),
    consentedAt: z.string().datetime(),
  })
  .strict();

export const applicationDocumentLinkSchema = z
  .object({
    documentVersionId: recruitmentIdSchema,
    purpose: z.enum(APPLICATION_DOCUMENT_PURPOSES),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const applicationCreateSchema = z
  .object({
    vacancyPublicationId: recruitmentIdSchema,
    applicantId: recruitmentIdSchema.optional(),
    applicant: applicantIdentitySchema.optional(),
    lateAcceptanceReason: z.string().trim().min(1).max(1000).optional(),
    lateAcceptanceAuthorityDocumentVersionId: recruitmentIdSchema.optional(),
    documents: z.array(applicationDocumentLinkSchema).max(50).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.applicantId === undefined) === (value.applicant === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['applicant'],
        message: 'Provide either an existing Applicant or the Applicant identity.',
      });
    }
    if (
      (value.lateAcceptanceReason === undefined) !==
      (value.lateAcceptanceAuthorityDocumentVersionId === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['lateAcceptanceReason'],
        message: 'Authorized late handling requires a reason and authority evidence together.',
      });
    }
  });

export const applicationListSchema = z
  .object({
    vacancyPublicationId: recruitmentIdSchema.optional(),
    applicantId: recruitmentIdSchema.optional(),
    status: z.enum(APPLICATION_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const screeningAreaResultSchema = z
  .object({
    area: z.enum(SCREENING_AREAS),
    result: z.enum(SCREENING_AREA_RESULTS),
    evidenceDocumentVersionIds: z.array(recruitmentIdSchema).max(20).default([]),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

function assertUniqueScreeningAreas(
  value: { areaResults: ReadonlyArray<{ area: string }> },
  context: z.RefinementCtx,
): void {
  const areas = value.areaResults.map(({ area }) => area);
  if (new Set(areas).size !== areas.length) {
    context.addIssue({
      code: 'custom',
      path: ['areaResults'],
      message: 'Each screening area may be recorded only once.',
    });
  }
}

export const applicationScreeningSchema = z
  .object({
    result: z.enum(APPLICATION_SCREENING_RESULTS),
    reason: z.string().trim().min(1).max(2000),
    areaResults: z.array(screeningAreaResultSchema).min(1).max(SCREENING_AREAS.length),
  })
  .strict()
  .superRefine(assertUniqueScreeningAreas);

export const applicationScreeningCorrectionSchema = z
  .object({
    result: z.enum(APPLICATION_SCREENING_RESULTS),
    reason: z.string().trim().min(1).max(2000),
    correctionReason: z.string().trim().min(1).max(1000),
    areaResults: z.array(screeningAreaResultSchema).min(1).max(SCREENING_AREAS.length),
    correctionAuthorityDocumentVersionId: recruitmentIdSchema.optional(),
  })
  .strict()
  .superRefine(assertUniqueScreeningAreas);

export const applicationWithdrawalSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000),
    evidenceDocumentVersionId: recruitmentIdSchema,
  })
  .strict();
