import { z } from 'zod';
import { MANDATORY_LEAVE_RESULTS } from './mandatory-leave-evaluator';

export const mandatoryLeaveAssessmentIdSchema = z.string().uuid();
export const mandatoryLeaveAssessmentYearSchema = z.coerce.number().int().min(1900).max(9999);
export const mandatoryLeaveAssessmentResultSchema = z.enum(MANDATORY_LEAVE_RESULTS);

export const mandatoryLeaveAssessmentEvaluateSchema = z
  .object({ year: z.number().int().min(1900).max(9999) })
  .strict();
