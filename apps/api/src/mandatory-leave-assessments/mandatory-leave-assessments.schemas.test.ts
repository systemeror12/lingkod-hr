import { describe, expect, it } from 'vitest';
import { mandatoryLeaveAssessmentCursorParamSchema } from './mandatory-leave-assessments.schemas';

describe('mandatoryLeaveAssessmentCursorParamSchema', () => {
  it('accepts a cursor for the longest permitted multi-byte legal name', () => {
    const cursor = Buffer.from(
      JSON.stringify({
        assessmentYear: 2026,
        legalName: '𝓐'.repeat(300),
        assessedAt: '2026-10-04T00:00:00.000Z',
        id: '00000000-0000-4000-8000-000000000000',
      }),
    ).toString('base64url');
    expect(mandatoryLeaveAssessmentCursorParamSchema.safeParse(cursor).success).toBe(true);
  });
});
