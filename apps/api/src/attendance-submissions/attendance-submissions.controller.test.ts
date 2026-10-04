import { BadRequestException, HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { AttendanceSubmissionsController } from './attendance-submissions.controller';
import type { AttendanceSubmissionsService } from './attendance-submissions.service';
import { AttendanceSubmissionServiceError } from './attendance-submissions.types';

const context: RequestContext = {
  requestId: 'submission-controller-test',
  userId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  agencyId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
  membershipId: '3f2504e0-4f89-41d3-9a0c-0305e82c3303',
  primaryOrganizationUnitId: null,
  permissions: [],
};

function serviceMocks() {
  return {
    create: vi.fn(),
    submit: vi.fn(),
    returnForReason: vi.fn(),
    approve: vi.fn(),
    cancel: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(),
  };
}

function controllerWith(mocks: ReturnType<typeof serviceMocks>) {
  return new AttendanceSubmissionsController(mocks as unknown as AttendanceSubmissionsService);
}

const periodId = '3f2504e0-4f89-41d3-9a0c-0305e82c3304';
const submissionId = '3f2504e0-4f89-41d3-9a0c-0305e82c3305';

describe('AttendanceSubmissionsController', () => {
  it('rejects an invalid create body before calling the service', async () => {
    const mocks = serviceMocks();
    const controller = controllerWith(mocks);
    await expect(
      controller.create(context.agencyId, { attendancePeriodId: 'not-a-uuid' }, undefined, context),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid return body before calling the service', async () => {
    const mocks = serviceMocks();
    const controller = controllerWith(mocks);
    await expect(
      controller.returnForReason(context.agencyId, submissionId, { reason: '' }, context),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.returnForReason).not.toHaveBeenCalled();
  });

  it('answers a foreign Agency path with a not-found envelope', async () => {
    const mocks = serviceMocks();
    const controller = controllerWith(mocks);
    await expect(
      controller.list(
        '3f2504e0-4f89-41d3-9a0c-0305e82c3399',
        undefined,
        undefined,
        undefined,
        undefined,
        context,
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'ATTENDANCE_SUBMISSION_NOT_FOUND' } },
      status: 404,
    });
  });

  it('translates a service error envelope', async () => {
    const mocks = serviceMocks();
    mocks.create.mockRejectedValue(
      new AttendanceSubmissionServiceError(
        'A current Employee Attendance Submission already exists.',
        409,
        'ATTENDANCE_SUBMISSION_EXISTS',
        ['STATUS:SUBMITTED'],
      ),
    );
    const controller = controllerWith(mocks);
    try {
      await controller.create(
        context.agencyId,
        { attendancePeriodId: periodId },
        undefined,
        context,
      );
      throw new Error('The controller did not translate the service error.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(HttpException);
      const response = (error as HttpException).getResponse() as {
        error: { code: string; reasons: string[]; requestId: string };
      };
      expect(response.error.code).toBe('ATTENDANCE_SUBMISSION_EXISTS');
      expect(response.error.reasons).toEqual(['STATUS:SUBMITTED']);
      expect(response.error.requestId).toBe(context.requestId);
    }
  });
});
