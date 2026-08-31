import { z } from 'zod';
import {
  PLANTILLA_POSITION_EMPLOYMENT_CATEGORIES,
  PLANTILLA_POSITION_EVIDENCE_PURPOSES,
} from './plantilla-positions.service';

const positionFields = {
  title: z.string().trim().min(1).max(200),
  parentheticalTitle: z.string().trim().max(200).nullable().optional(),
  salaryGrade: z.number().int().min(1).max(33),
  organizationUnitId: z.string().uuid(),
  fundingSource: z.string().trim().min(1).max(200),
  employmentCategory: z.enum(PLANTILLA_POSITION_EMPLOYMENT_CATEGORIES),
  qualificationStandardVersionId: z.string().uuid(),
  staffingAuthorityId: z.string().uuid(),
  effectiveDate: z.string().date(),
};

export const plantillaPositionCreateSchema = z
  .object({
    itemNumber: z.string().trim().min(1).max(80),
    ...positionFields,
  })
  .strict();

export const plantillaPositionIdSchema = z.string().uuid();
export const plantillaPositionIdempotencyKeySchema = z.string().trim().min(1).max(200);
export const plantillaPositionVersionIdSchema = z.string().uuid();
export const plantillaPositionEvidenceIdSchema = z.string().uuid();
export const plantillaPositionAsOfSchema = z.string().date().optional();
export const plantillaPositionActivationSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();

export const plantillaPositionTransitionSchema = z
  .object({
    effectiveDate: z.string().date(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const plantillaPositionDraftUpdateSchema = z
  .object({
    ...positionFields,
    rowVersion: z.number().int().positive().optional(),
  })
  .strict();

export const plantillaPositionCorrectionSchema = z
  .object({
    title: positionFields.title,
    parentheticalTitle: positionFields.parentheticalTitle,
    salaryGrade: positionFields.salaryGrade,
    organizationUnitId: positionFields.organizationUnitId,
    fundingSource: positionFields.fundingSource,
    employmentCategory: positionFields.employmentCategory,
    qualificationStandardVersionId: positionFields.qualificationStandardVersionId,
    staffingAuthorityId: positionFields.staffingAuthorityId,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const plantillaPositionEvidenceLinkSchema = z
  .object({
    documentId: z.string().uuid(),
    purpose: z.enum(PLANTILLA_POSITION_EVIDENCE_PURPOSES),
    effectiveDate: z.string().date().nullable().optional(),
  })
  .strict();

export const plantillaPositionEvidenceRemovalSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();
