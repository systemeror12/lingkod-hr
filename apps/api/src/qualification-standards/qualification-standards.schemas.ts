import { z } from 'zod';

const requirements = {
  effectiveDate: z.string().date(),
  educationRequirement: z.string().trim().max(1000).nullable().optional(),
  trainingHoursRequired: z.number().finite().nonnegative().max(100000).nullable().optional(),
  experienceMonthsRequired: z.number().int().nonnegative().max(10000).nullable().optional(),
  eligibilityRequirement: z.string().trim().max(1000).nullable().optional(),
  competencyRequirements: z.array(z.unknown()).max(100).optional(),
  licenseRequirements: z.array(z.unknown()).max(100).optional(),
  specialRequirements: z.string().trim().max(2000).nullable().optional(),
};

export const qualificationStandardCreateSchema = z
  .object({
    code: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(200),
    ...requirements,
  })
  .strict();

export const qualificationStandardIdSchema = z.string().uuid();
export const qualificationStandardVersionIdSchema = z.string().uuid();
export const qualificationStandardAsOfSchema = z.string().date().optional();
export const qualificationStandardIdempotencyKeySchema = z.string().trim().min(1).max(200);

export const qualificationStandardDraftUpdateSchema = z
  .object({
    ...requirements,
    rowVersion: z.number().int().positive().optional(),
  })
  .strict();

export const qualificationStandardEvidenceSchema = z
  .object({
    kind: z.enum(['SOURCE', 'APPROVAL']),
    documentId: z.string().uuid(),
    validationReason: z.string().trim().min(1).max(500),
  })
  .strict();

export const qualificationStandardActivationSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();

export const qualificationStandardCorrectionSchema = z
  .object({
    educationRequirement: requirements.educationRequirement,
    trainingHoursRequired: requirements.trainingHoursRequired,
    experienceMonthsRequired: requirements.experienceMonthsRequired,
    eligibilityRequirement: requirements.eligibilityRequirement,
    competencyRequirements: requirements.competencyRequirements,
    licenseRequirements: requirements.licenseRequirements,
    specialRequirements: requirements.specialRequirements,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
