import { z } from 'zod';
import { recruitmentIdSchema } from './recruitment.schemas';
import { INTERVIEW_RECOMMENDATIONS } from './selection-plan';

export const assessmentScheduleSchema = z
  .object({
    stageCode: z.string().trim().min(1).max(60),
    scheduledAt: z.string().datetime().optional(),
  })
  .strict();

export const assessmentResultSchema = z
  .object({
    criterionCode: z.string().trim().min(1).max(60),
    score: z.number().finite(),
    rating: z.string().trim().min(1).max(60).optional(),
    comments: z.string().trim().min(1).max(2000).optional(),
    evidenceDocumentVersionId: recruitmentIdSchema.optional(),
  })
  .strict();

export const assessmentResultCorrectionSchema = assessmentResultSchema.extend({
  correctionReason: z.string().trim().min(1).max(1000),
});

export const interviewScheduleSchema = z
  .object({
    stageCode: z.string().trim().min(1).max(60),
    scheduledAt: z.string().datetime(),
    locationOrLink: z.string().trim().min(1).max(500).optional(),
    panelName: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const interviewFeedbackSchema = z
  .object({
    score: z.number().finite(),
    recommendation: z.enum(INTERVIEW_RECOMMENDATIONS),
    comments: z.string().trim().min(1).max(4000).optional(),
    evidenceDocumentVersionId: recruitmentIdSchema.optional(),
  })
  .strict();

export const interviewFeedbackCorrectionSchema = interviewFeedbackSchema.extend({
  correctionReason: z.string().trim().min(1).max(1000),
});

export const stageCancellationSchema = z
  .object({ reason: z.string().trim().min(1).max(1000) })
  .strict();

export const stageNoShowSchema = z
  .object({ reason: z.string().trim().min(1).max(1000).optional() })
  .strict();
