import { z } from 'zod';
import { MANDATORY_LEAVE_RESULTS } from './mandatory-leave-evaluator';

export const mandatoryLeaveAssessmentIdSchema = z.string().uuid();
export const mandatoryLeaveAssessmentYearSchema = z.coerce.number().int().min(1900).max(9999);
export const mandatoryLeaveAssessmentResultSchema = z.enum(MANDATORY_LEAVE_RESULTS);

export const mandatoryLeaveAssessmentEvaluateSchema = z
  .object({ year: z.number().int().min(1900).max(9999) })
  .strict();

export const mandatoryLeaveAssessmentLimitSchema = z.coerce.number().int().min(1).max(50);
export const mandatoryLeaveAssessmentCursorParamSchema = z.string().trim().min(1).max(512);

export const mandatoryLeaveAssessmentCursorSchema = z
  .object({
    assessmentYear: z.number().int(),
    legalName: z.string(),
    assessedAt: z.string().datetime(),
    id: z.string().uuid(),
  })
  .strict();

export const mandatoryLeaveEmployeeCursorSchema = z
  .object({ legalName: z.string(), id: z.string().uuid() })
  .strict();
