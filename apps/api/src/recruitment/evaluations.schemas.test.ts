import { expect, it } from 'vitest';
import {
  assessmentResultCorrectionSchema,
  assessmentResultSchema,
  assessmentScheduleSchema,
  interviewFeedbackCorrectionSchema,
  interviewFeedbackSchema,
  interviewScheduleSchema,
  stageCancellationSchema,
  stageNoShowSchema,
} from './evaluations.schemas';

it('accepts configured assessment and interview commands', () => {
  expect(assessmentScheduleSchema.safeParse({ stageCode: 'WRITTEN_EXAM' }).success).toBe(true);
  expect(
    assessmentScheduleSchema.safeParse({
      stageCode: 'WRITTEN_EXAM',
      scheduledAt: '2026-09-20T01:00:00.000Z',
    }).success,
  ).toBe(true);
  expect(
    assessmentResultSchema.safeParse({
      criterionCode: 'JOB_KNOWLEDGE',
      score: 85,
      comments: 'Consistent with the job knowledge rating scale.',
    }).success,
  ).toBe(true);
  expect(
    interviewScheduleSchema.safeParse({
      stageCode: 'PANEL_INTERVIEW',
      scheduledAt: '2026-09-20T01:00:00.000Z',
    }).success,
  ).toBe(true);
  expect(
    interviewFeedbackSchema.safeParse({
      score: 80,
      recommendation: 'PROCEED',
      comments: 'The panel recommends the applicant.',
    }).success,
  ).toBe(true);
});

it('rejects unsupported or incomplete stage commands', () => {
  expect(
    assessmentScheduleSchema.safeParse({ stageCode: 'WRITTEN_EXAM', formula: 'x' }).success,
  ).toBe(false);
  expect(assessmentScheduleSchema.safeParse({ stageCode: '' }).success).toBe(false);
  expect(assessmentResultSchema.safeParse({ criterionCode: 'JOB_KNOWLEDGE' }).success).toBe(false);
  expect(
    assessmentResultSchema.safeParse({ criterionCode: 'JOB_KNOWLEDGE', score: Number.NaN }).success,
  ).toBe(false);
  expect(interviewScheduleSchema.safeParse({ stageCode: 'PANEL_INTERVIEW' }).success).toBe(false);
  expect(interviewFeedbackSchema.safeParse({ score: 80, recommendation: 'SELECTED' }).success).toBe(
    false,
  );
  expect(stageCancellationSchema.safeParse({}).success).toBe(false);
  expect(stageNoShowSchema.safeParse({}).success).toBe(true);
});

it('requires a correction reason on replacement versions', () => {
  expect(
    assessmentResultCorrectionSchema.safeParse({ criterionCode: 'JOB_KNOWLEDGE', score: 85 })
      .success,
  ).toBe(false);
  expect(
    assessmentResultCorrectionSchema.safeParse({
      criterionCode: 'JOB_KNOWLEDGE',
      score: 85,
      correctionReason: 'The answer sheet was scored against the wrong key.',
    }).success,
  ).toBe(true);
  expect(
    interviewFeedbackCorrectionSchema.safeParse({ score: 80, recommendation: 'HOLD' }).success,
  ).toBe(false);
  expect(
    interviewFeedbackCorrectionSchema.safeParse({
      score: 80,
      recommendation: 'HOLD',
      correctionReason: 'The panel reconvened and revised its recommendation.',
    }).success,
  ).toBe(true);
});
