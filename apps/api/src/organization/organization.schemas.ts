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
