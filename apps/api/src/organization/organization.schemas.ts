import { z } from 'zod';
import { ORGANIZATION_UNIT_TYPES } from './organization.service';

export const organizationUnitCreateSchema = z
  .object({
    officialName: z.string().trim().min(1).max(200),
    code: z.string().trim().min(1).max(50),
    unitType: z.enum(ORGANIZATION_UNIT_TYPES),
    effectiveDate: z.string().date(),
    costCenterCode: z.string().trim().max(100).nullable().optional(),
    responsibilityCenterCode: z.string().trim().max(100).nullable().optional(),
  })
  .strict();

export const organizationUnitIdSchema = z.string().uuid();

export const organizationHierarchyQuerySchema = z
  .object({
    asOf: z.string().date(),
    parentForUnitId: z.string().uuid().optional(),
  })
  .strict();

export const organizationHistoryQuerySchema = z
  .object({ asOf: z.string().date().optional() })
  .strict();

export const organizationUnitActivationSchema = z
  .object({
    parentUnitId: z.string().uuid().nullable(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const organizationUnitDraftUpdateSchema = z
  .object({
    officialName: z.string().trim().min(1).max(200),
    parentUnitId: z.string().uuid().nullable(),
    costCenterCode: z.string().trim().max(100).nullable(),
    responsibilityCenterCode: z.string().trim().max(100).nullable(),
    effectiveDate: z.string().date(),
  })
  .strict();

export const organizationUnitSuccessorActivationSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
    authorityReference: z.string().trim().max(200).nullable().optional(),
    migrationPlan: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export const organizationUnitTransitionSchema = z
  .object({
    effectiveDate: z.string().date(),
    reason: z.string().trim().min(1).max(500),
    authorityReference: z.string().trim().max(200).nullable().optional(),
    migrationPlan: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export const organizationUnitCorrectionSchema = z
  .object({
    officialName: z.string().trim().min(1).max(200),
    parentUnitId: z.string().uuid().nullable(),
    costCenterCode: z.string().trim().max(100).nullable(),
    responsibilityCenterCode: z.string().trim().max(100).nullable(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const organizationIdempotencyKeySchema = z.string().trim().min(1).max(200);
