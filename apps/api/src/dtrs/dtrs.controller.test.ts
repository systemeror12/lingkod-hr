import { BadRequestException, HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { DtrsController } from './dtrs.controller';
import type { DtrsService } from './dtrs.service';
import { DtrServiceError } from './dtrs.types';

const context: RequestContext = {
  requestId: 'dtr-controller-test',
  userId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  agencyId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
  membershipId: '3f2504e0-4f89-41d3-9a0c-0305e82c3303',
  primaryOrganizationUnitId: null,
  permissions: [],
};

function serviceMocks() {
  return {
    preview: vi.fn(),
    renderPreview: vi.fn(),
    listPeriodVersions: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(),
    render: vi.fn(),
    generate: vi.fn(),
  };
}

function controllerWith(mocks: ReturnType<typeof serviceMocks>) {
  return new DtrsController(mocks as unknown as DtrsService);
}

const periodId = '3f2504e0-4f89-41d3-9a0c-0305e82c3304';

describe('DtrsController', () => {
  it('rejects an invalid preview period before calling the service', async () => {
    const mocks = serviceMocks();
    const controller = controllerWith(mocks);
    await expect(
      controller.preview(context.agencyId, 'bad-id', undefined, context),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('rejects an invalid Finalized DTR identifier before calling the service', async () => {
    const mocks = serviceMocks();
    const controller = controllerWith(mocks);
    await expect(controller.findById(context.agencyId, 'bad-id', context)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mocks.findById).not.toHaveBeenCalled();
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
    ).rejects.toMatchObject({ response: { error: { code: 'DTR_NOT_FOUND' } }, status: 404 });
  });

  it('translates a service error envelope', async () => {
    const mocks = serviceMocks();
    mocks.generate.mockRejectedValue(
      new DtrServiceError(
        'Only a locked Attendance Period Version creates Finalized Daily Time Records.',
        409,
        'DTR_VERSION_NOT_LOCKED',
        ['STATUS:FOR_REVIEW'],
      ),
    );
    const controller = controllerWith(mocks);
    try {
      await controller.generate(context.agencyId, periodId, context);
      throw new Error('The controller did not translate the service error.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(HttpException);
      const response = (error as HttpException).getResponse() as {
        error: { code: string; reasons: string[]; requestId: string };
      };
      expect(response.error.code).toBe('DTR_VERSION_NOT_LOCKED');
      expect(response.error.reasons).toEqual(['STATUS:FOR_REVIEW']);
      expect(response.error.requestId).toBe(context.requestId);
    }
  });
});
