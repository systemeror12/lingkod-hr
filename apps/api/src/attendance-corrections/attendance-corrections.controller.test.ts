import { BadRequestException, HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { AttendanceCorrectionsController } from './attendance-corrections.controller';
import { AttendanceCorrectionServiceError } from './attendance-corrections.types';
import type { AttendanceCorrectionsService } from './attendance-corrections.service';

const context: RequestContext = {
  requestId: 'correction-controller-test',
  userId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  agencyId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
  membershipId: '3f2504e0-4f89-41d3-9a0c-0305e82c3303',
  primaryOrganizationUnitId: null,
  permissions: [],
};

function serviceMocks() {
  return {
    create: vi.fn(),
    preview: vi.fn(),
    submit: vi.fn(),
    returnForInformation: vi.fn(),
    reject: vi.fn(),
    approve: vi.fn(),
    authorizeLocked: vi.fn(),
    cancel: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(),
  };
}

function controllerWith(mocks: ReturnType<typeof serviceMocks>) {
  return new AttendanceCorrectionsController(mocks as unknown as AttendanceCorrectionsService);
}

const correctionSummary = {
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3401',
  agencyId: context.agencyId,
  employee: { id: context.userId, employeeNumber: 'EMP-1', legalName: 'Employee One' },
  initiatedByMembershipId: context.membershipId,
  recordedByMembershipId: context.membershipId,
  targetType: 'ATTENDANCE_EVENT' as const,
  requestedAction: 'VOID' as const,
  targetId: null,
  requestedRecord: null,
  status: 'DRAFT' as const,
  reason: 'Duplicate event.',
  approvalRouteVersionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3402',
  submittedAt: null,
  decidedByMembershipId: null,
  decidedAt: null,
  decisionReason: null,
  authorizedByMembershipId: null,
  authorizedAt: null,
  appliedByMembershipId: null,
  appliedAt: null,
  createdAt: new Date('2026-01-05T00:00:00.000Z').toISOString(),
};

const correctionDetail = {
  correction: correctionSummary,
  impactPreview: {
    computedAt: new Date('2026-01-05T00:00:00.000Z').toISOString(),
    targetType: 'ATTENDANCE_EVENT' as const,
    requestedAction: 'VOID' as const,
    targetWorkDate: '2026-01-05',
    proposedWorkDate: null,
    days: [],
    periods: [],
    lockedPeriodVersionIds: [],
    fingerprint: 'a'.repeat(64),
  },
  evidence: [],
  effect: null,
  lockedAdjustment: null,
  approval: null,
};

describe('AttendanceCorrectionsController', () => {
  it('rejects an invalid create body before calling the service', async () => {
    const mocks = serviceMocks();
    await expect(
      controllerWith(mocks).create(
        context.agencyId,
        { requestedAction: 'VOID' },
        undefined,
        context,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('treats a foreign agency path as not found', async () => {
    const mocks = serviceMocks();
    await expect(
      controllerWith(mocks).findById(
        '3f2504e0-4f89-41d3-9a0c-0305e82c9999',
        correctionSummary.id,
        context,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it('translates a service error into the API envelope', async () => {
    const mocks = serviceMocks();
    mocks.approve.mockRejectedValue(
      new AttendanceCorrectionServiceError(
        'Stale preview.',
        409,
        'ATTENDANCE_CORRECTION_STALE_PREVIEW',
        ['DAY:2026-01-05'],
      ),
    );
    await expect(
      controllerWith(mocks).approve(context.agencyId, correctionSummary.id, {}, undefined, context),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        error: {
          code: 'ATTENDANCE_CORRECTION_STALE_PREVIEW',
          reasons: ['DAY:2026-01-05'],
          requestId: context.requestId,
        },
      },
    });
  });

  it('requires a return reason', async () => {
    const mocks = serviceMocks();
    await expect(
      controllerWith(mocks).returnForInformation(
        context.agencyId,
        correctionSummary.id,
        {},
        undefined,
        context,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.returnForInformation).not.toHaveBeenCalled();
  });

  it('returns the detail envelope for a successful action', async () => {
    const mocks = serviceMocks();
    mocks.submit.mockResolvedValue(correctionDetail);
    const response = await controllerWith(mocks).submit(
      context.agencyId,
      correctionSummary.id,
      undefined,
      context,
    );
    expect(response.correction.id).toBe(correctionSummary.id);
    expect(response.impactPreview.fingerprint).toHaveLength(64);
    expect(mocks.submit).toHaveBeenCalledWith(context, correctionSummary.id, undefined);
  });

  it('lists corrections for the agency', async () => {
    const mocks = serviceMocks();
    mocks.list.mockResolvedValue([correctionSummary]);
    const response = await controllerWith(mocks).list(context.agencyId, {}, context);
    expect(response.corrections).toHaveLength(1);
    expect(mocks.list).toHaveBeenCalledWith(context, {});
  });

  it('rejects an invalid list filter', async () => {
    const mocks = serviceMocks();
    await expect(
      controllerWith(mocks).list(context.agencyId, { status: 'UNKNOWN' }, context),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an over-long idempotency key', async () => {
    const mocks = serviceMocks();
    await expect(
      controllerWith(mocks).create(
        context.agencyId,
        {
          targetType: 'ATTENDANCE_EVENT',
          requestedAction: 'VOID',
          targetId: correctionSummary.id,
          reason: 'Duplicate.',
          evidence: [{ sourceType: 'ATTENDANCE_EVENT', sourceId: correctionSummary.id }],
        },
        'x'.repeat(300),
        context,
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
