import { z } from 'zod';

export const recruitmentIdSchema = z.string().uuid();
export const recruitmentDateSchema = z.string().date();
export const recruitmentIdempotencyKeySchema = z.string().trim().min(1).max(200);

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const requestToFillCreateSchema = z
  .object({
    positionId: recruitmentIdSchema,
    requestingUnitId: recruitmentIdSchema,
    justification: z.string().trim().min(1).max(2000),
  })
  .strict();

export const requestToFillListSchema = z
  .object({
    status: z
      .enum(['DRAFT', 'SUBMITTED', 'FOR_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED', 'CLOSED'])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const recruitmentReasonSchema = z
  .object({ reason: z.string().trim().min(1).max(1000) })
  .strict();

export const requestToFillRebaselineSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000),
    authorityDocumentVersionId: recruitmentIdSchema,
  })
  .strict();

export const recruitmentDecisionSchema = z
  .object({ comments: z.string().trim().min(1).max(1000).optional() })
  .strict();

const channelSchema = z
  .object({
    type: z.enum(['CSC_FIELD_OFFICE', 'CSC_JOB_PORTAL', 'AGENCY_POSTING_PLACE', 'SUPPLEMENTAL']),
    location: z.string().trim().min(1).max(300),
    reference: z.string().trim().max(1000).optional(),
  })
  .strict();

const publicationEvidenceSchema = z
  .object({
    channelType: z.enum([
      'CSC_FIELD_OFFICE',
      'CSC_JOB_PORTAL',
      'AGENCY_POSTING_PLACE',
      'SUPPLEMENTAL',
    ]),
    location: z.string().trim().min(1).max(300),
    reference: z.string().trim().max(1000).optional(),
    publishedAt: z.string().datetime(),
    evidenceDocumentVersionId: recruitmentIdSchema.optional(),
  })
  .strict();

export const vacancyPublicationCreateSchema = z
  .object({
    requestToFillId: recruitmentIdSchema,
    formDocumentVersionId: recruitmentIdSchema,
    openingDate: recruitmentDateSchema,
    closingDate: recruitmentDateSchema,
    channels: z.array(channelSchema).max(20),
    positionDetails: jsonObjectSchema.default({}),
    applicationRequirements: z.array(z.unknown()).max(100).default([]),
    contactDetails: jsonObjectSchema,
    hrmoCertification: jsonObjectSchema.optional(),
    evidence: z.array(publicationEvidenceSchema).max(50).default([]),
  })
  .strict();

export const vacancyPublicationCorrectionSchema = z
  .object({
    formDocumentVersionId: recruitmentIdSchema,
    openingDate: recruitmentDateSchema,
    closingDate: recruitmentDateSchema,
    positionDetails: jsonObjectSchema,
    applicationRequirements: z.array(z.unknown()).max(100),
    contactDetails: jsonObjectSchema,
    hrmoCertification: jsonObjectSchema.optional(),
  })
  .strict();

export const vacancyPublicationRepublishSchema = vacancyPublicationCreateSchema
  .extend({
    reason: z.string().trim().min(1).max(1000),
    authorityDocumentVersionId: recruitmentIdSchema,
  })
  .strict();

export const vacancyPublicationListSchema = z
  .object({
    status: z
      .enum(['DRAFT', 'FOR_APPROVAL', 'PUBLISHED', 'CLOSED', 'CANCELLED', 'REPUBLISHED'])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const vacancyPublicationEvidenceSchema = z
  .object({
    channelType: publicationEvidenceSchema.shape.channelType,
    location: publicationEvidenceSchema.shape.location,
    reference: publicationEvidenceSchema.shape.reference,
    publishedAt: publicationEvidenceSchema.shape.publishedAt,
    evidenceDocumentVersionId: publicationEvidenceSchema.shape.evidenceDocumentVersionId,
  })
  .strict();

export const vacancyPublicationCloseSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000),
    authorityDocumentVersionId: recruitmentIdSchema.optional(),
  })
  .strict();

export const vacancyPublicationCancelSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000),
    authorityDocumentVersionId: recruitmentIdSchema,
  })
  .strict();
