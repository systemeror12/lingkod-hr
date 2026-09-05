import { z } from 'zod';

const baselineFields = {
  employeeId: z.string().uuid(),
  authorityDocumentId: z.string().uuid(),
  authorityEvidenceVersionId: z.string().uuid(),
  firstGovernmentServiceDate: z.string().date(),
  agencyServiceStartDate: z.string().date(),
  organizationUnitId: z.string().uuid(),
  appointmentStatus: z.string().trim().min(1).max(120),
  salaryGrade: z.number().int().min(1).max(33).nullable().optional(),
  salaryStep: z.number().int().positive().nullable().optional(),
  positionId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().min(1).max(500),
};

export const personnelBaselineCreateSchema = z.object(baselineFields).strict();

export const personnelBaselineUpdateSchema = z
  .object({ ...baselineFields, rowVersion: z.number().int().positive().optional() })
  .strict();

export const personnelBaselineReviewSchema = z
  .object({
    decision: z.enum(['APPROVE', 'RETURN', 'REJECT']),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const personnelBaselineVoidSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();

export const personnelBaselineIdSchema = z.string().uuid();
export const personnelBaselineIdempotencyKeySchema = z.string().trim().min(1).max(200);
