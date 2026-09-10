import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { EvaluationsController } from './evaluations.controller';

const agencyId = '00000000-0000-4000-8000-000000000001';
const otherAgencyId = '00000000-0000-4000-8000-000000000002';
const applicationId = '00000000-0000-4000-8000-000000000003';
const assessmentId = '00000000-0000-4000-8000-000000000004';
const interviewId = '00000000-0000-4000-8000-000000000005';

const context: RequestContext = {
  requestId: 'evaluations-controller-test',
  userId: '00000000-0000-4000-8000-000000000006',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000007',
  primaryOrganizationUnitId: null,
  permissions: [],
};

function serviceMock() {
  return {
    scheduleAssessment: vi.fn(),
    completeAssessment: vi.fn(),
    cancelAssessment: vi.fn(),
    recordAssessmentNoShow: vi.fn(),
    recordAssessmentResult: vi.fn(),
    correctAssessmentResult: vi.fn(),
    scheduleInterview: vi.fn(),
    completeInterview: vi.fn(),
    cancelInterview: vi.fn(),
    recordInterviewNoShow: vi.fn(),
    recordInterviewFeedback: vi.fn(),
    correctInterviewFeedback: vi.fn(),
  };
}

it('rejects commands outside the active Agency before calling the service', async () => {
  const service = serviceMock();
  const controller = new EvaluationsController(service as never);

  await expect(
    controller.scheduleAssessment(
      otherAgencyId,
      applicationId,
      { stageCode: 'WRITTEN_EXAM' },
      context,
      'key',
    ),
  ).rejects.toMatchObject({
    status: 403,
    response: { error: { code: 'RECRUITMENT_WRITE_FORBIDDEN' } },
  });
  expect(service.scheduleAssessment).not.toHaveBeenCalled();
});

it('validates and forwards configured evaluation commands', async () => {
  const service = serviceMock();
  service.scheduleAssessment.mockResolvedValue({ id: applicationId });
  service.recordAssessmentResult.mockResolvedValue({ id: applicationId });
  service.completeInterview.mockResolvedValue({ id: applicationId });
  const controller = new EvaluationsController(service as never);

  const schedule = { stageCode: 'WRITTEN_EXAM', scheduledAt: '2026-09-20T01:00:00.000Z' };
  await expect(
    controller.scheduleAssessment(agencyId, applicationId, schedule, context, 'assessment-key'),
  ).resolves.toEqual({ id: applicationId });
  expect(service.scheduleAssessment).toHaveBeenCalledWith(
    context,
    applicationId,
    schedule,
    'assessment-key',
  );

  const result = { criterionCode: 'JOB_KNOWLEDGE', score: 85 };
  await expect(
    controller.recordAssessmentResult(
      agencyId,
      applicationId,
      assessmentId,
      result,
      context,
      'result-key',
    ),
  ).resolves.toEqual({ id: applicationId });
  expect(service.recordAssessmentResult).toHaveBeenCalledWith(
    context,
    applicationId,
    assessmentId,
    result,
    'result-key',
  );

  await expect(
    controller.completeInterview(agencyId, applicationId, interviewId, context, 'complete-key'),
  ).resolves.toEqual({ id: applicationId });
  expect(service.completeInterview).toHaveBeenCalledWith(
    context,
    applicationId,
    interviewId,
    'complete-key',
  );
});

it('rejects malformed stage input before the service is called', async () => {
  const service = serviceMock();
  const controller = new EvaluationsController(service as never);

  await expect(
    controller.recordAssessmentResult(
      agencyId,
      applicationId,
      assessmentId,
      { criterionCode: 'JOB_KNOWLEDGE', score: 'high' },
      context,
      'result-key',
    ),
  ).rejects.toMatchObject({
    status: 400,
    response: { error: { code: 'INVALID_INPUT' } },
  });
  expect(service.recordAssessmentResult).not.toHaveBeenCalled();

  await expect(
    controller.cancelInterview(agencyId, applicationId, interviewId, {}, context, 'cancel-key'),
  ).rejects.toMatchObject({
    status: 400,
    response: { error: { code: 'INVALID_INPUT' } },
  });
  expect(service.cancelInterview).not.toHaveBeenCalled();
});
