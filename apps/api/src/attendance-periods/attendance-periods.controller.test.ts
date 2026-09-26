import { BadRequestException, HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { AttendancePeriodsController } from './attendance-periods.controller';
import type { AttendancePeriodsService } from './attendance-periods.service';
import { AttendancePeriodServiceError } from './attendance-periods.types';

const context: RequestContext = {
  requestId: 'attendance-period-controller-test',
  userId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  agencyId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
  membershipId: '3f2504e0-4f89-41d3-9a0c-0305e82c3303',
  primaryOrganizationUnitId: null,
  permissions: [],
};

function serviceMocks() {
  return {
    list: vi.fn(),
    findById: vi.fn(),
    submitForReview: vi.fn(),
    returnForReason: vi.fn(),
    approve: vi.fn(),
    reconcile: vi.fn(),
    lock: vi.fn(),
    findPublication: vi.fn(),
  };
}

function controllerWith(mocks: ReturnType<typeof serviceMocks>) {
  return new AttendancePeriodsController(mocks as unknown as AttendancePeriodsService);
}

const periodId = '3f2504e0-4f89-41d3-9a0c-0305e82c3304';
const versionId = '3f2504e0-4f89-41d3-9a0c-0305e82c3305';

describe('AttendancePeriodsController', () => {
  it('rejects an invalid Attendance Period identifier before calling the service', async () => {
    const mocks = serviceMocks();
    const controller = controllerWith(mocks);
    await expect(
      controller.submitForReview(context.agencyId, 'bad-id', undefined, context),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.submitForReview).not.toHaveBeenCalled();
  });

  it('rejects an invalid return reason before calling the service', async () => {
    const mocks = serviceMocks();
    const controller = controllerWith(mocks);
    await expect(
      controller.returnForReason(context.agencyId, versionId, undefined, { reason: '' }, context),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.returnForReason).not.toHaveBeenCalled();
  });

  it('answers a foreign Agency path with a not-found envelope', async () => {
    const mocks = serviceMocks();
    const controller = controllerWith(mocks);
    await expect(
      controller.findById('3f2504e0-4f89-41d3-9a0c-0305e82c3399', versionId, context),
    ).rejects.toMatchObject({
      response: { error: { code: 'ATTENDANCE_PERIOD_VERSION_NOT_FOUND' } },
      status: 404,
    });
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it('translates a reconciliation failure envelope with its reasons', async () => {
    const mocks = serviceMocks();
    mocks.lock.mockRejectedValue(
      new AttendancePeriodServiceError(
        'Attendance Period Reconciliation failed and the version stays APPROVED.',
        409,
        'ATTENDANCE_PERIOD_RECONCILIATION_FAILED',
        ['SOURCE_BINDING_CHANGED'],
      ),
    );
    const controller = controllerWith(mocks);
    try {
      await controller.lock(context.agencyId, versionId, context);
      throw new Error('The controller did not translate the service error.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(HttpException);
      const response = (error as HttpException).getResponse() as {
        error: { code: string; reasons: string[]; requestId: string };
      };
      expect(response.error.code).toBe('ATTENDANCE_PERIOD_RECONCILIATION_FAILED');
      expect(response.error.reasons).toEqual(['SOURCE_BINDING_CHANGED']);
      expect(response.error.requestId).toBe(context.requestId);
    }
  });

  it('accepts an empty approve body as an optional reason', async () => {
    const mocks = serviceMocks();
    mocks.approve.mockResolvedValue({
      version: {
        id: versionId,
        attendancePeriodId: periodId,
        period: {
          id: periodId,
          code: 'PERIOD-1',
          dateFrom: '2026-06-01',
          dateTo: '2026-06-15',
          status: 'OPEN',
        },
        versionNo: 1,
        status: 'APPROVED',
        predecessorVersionId: null,
        approvalRouteVersionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3306',
        submittedByMembershipId: context.membershipId,
        submittedAt: '2026-06-16T00:00:00.000Z',
        reviewedByMembershipId: context.membershipId,
        reviewedAt: '2026-06-16T01:00:00.000Z',
        reviewReason: 'Approved.',
        lockedByMembershipId: null,
        lockedAt: null,
        coveredEmployeeCount: 1,
        coveredWorkDateCount: 1,
        dtrCount: 0,
        publication: null,
      },
      reconciliation: null,
    });
    const controller = controllerWith(mocks);
    await controller.approve(context.agencyId, versionId, undefined, {}, context);
    expect(mocks.approve).toHaveBeenCalledWith(context, versionId, {}, undefined);
  });
});
