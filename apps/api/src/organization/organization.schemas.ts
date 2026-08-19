import { z } from 'zod';
import { ORGANIZATION_UNIT_TYPES } from './organization.service';

export const organizationUnitCreateSchema = z
  .object({
    officialName: z.string().trim().min(1).max(200),
    code: z.string().trim().min(1).max(50),
    unitType: z.enum(ORGANIZATION_UNIT_TYPES),
    effectiveDate: z.string().date(),
  })
  .strict();

export const organizationUnitIdSchema = z.string().uuid();

export const organizationHierarchyQuerySchema = z
  .object({
    asOf: z.string().date(),
    parentForUnitId: z.string().uuid().optional(),
  })
  .strict();

export const organizationUnitActivationSchema = z
  .object({
    parentUnitId: z.string().uuid().nullable(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const organizationIdempotencyKeySchema = z.string().trim().min(1).max(200);
