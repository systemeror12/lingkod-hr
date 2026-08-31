import { z } from 'zod';
import { STAFFING_AUTHORITY_TYPES } from './staffing-authorities.service';

const sourceMetadataSchema = z
  .record(z.string().trim().min(1).max(80), z.string().trim().min(1).max(500))
  .refine((value) => Object.keys(value).length <= 20, 'Use no more than 20 source metadata fields.')
  .optional();

export const staffingAuthorityDraftSchema = z
  .object({
    authorityType: z.enum(STAFFING_AUTHORITY_TYPES),
    referenceNo: z.string().trim().min(1).max(200),
    issuedDate: z.string().date(),
    effectiveDate: z.string().date(),
    sourceMetadata: sourceMetadataSchema,
  })
  .strict();

export const staffingAuthorityDraftUpdateSchema = staffingAuthorityDraftSchema
  .extend({ rowVersion: z.number().int().positive() })
  .strict();

export const staffingAuthorityIdSchema = z.string().uuid();
export const staffingAuthorityIdempotencyKeySchema = z.string().trim().min(1).max(200);

export const staffingAuthorityEvidenceSchema = z
  .object({
    documentId: z.string().uuid(),
    validationReason: z.string().trim().min(1).max(500),
  })
  .strict();

export const staffingAuthorityActivationSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();

export const staffingAuthoritySupersessionSchema = z
  .object({
    successorId: z.string().uuid(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const staffingAuthorityRevocationSchema = z
  .object({
    effectiveDate: z.string().date(),
    reason: z.string().trim().min(1).max(500),
    documentId: z.string().uuid(),
  })
  .strict();
