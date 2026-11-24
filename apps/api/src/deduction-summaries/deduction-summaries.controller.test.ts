import { HttpException } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { describe, expect, it, vi } from 'vitest';
import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators';
import { DeductionSummariesController } from './deduction-summaries.controller';
import { DeductionSummariesServiceError } from './deduction-summaries.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const periodId = '00000000-0000-4000-8000-000000000002';
const summaryId = '00000000-0000-4000-8000-000000000003';
const context: RequestContext = {
  requestId: 'deduction-summaries-api-test',
  userId: '00000000-0000-4000-8000-000000000004',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000005',
  primaryOrganizationUnitId: null,
  permissions: [],
};

describe('DeductionSummariesController', () => {
  it('needs payroll.registers.generate on every route', () => {
    for (const route of ['generate', 'readForPeriod', 'read'] as const) {
      expect(
        Reflect.getMetadata(REQUIRED_PERMISSIONS, DeductionSummariesController.prototype[route]),
      ).toEqual(['payroll.registers.generate']);
    }
  });

  it('reads the period’s summaries, or null before they are generated', async () => {
    const service = { readForPeriod: vi.fn().mockResolvedValue(null) };
    const controller = new DeductionSummariesController(service as never);
    await expect(controller.readForPeriod(agencyId, periodId, context)).resolves.toEqual({
      deductionSummaries: null,
    });
    expect(service.readForPeriod).toHaveBeenCalledWith(context, periodId);
  });

  it('reads the stored summaries of the period', async () => {
    const view = { id: summaryId };
    const service = { read: vi.fn().mockResolvedValue(view) };
    const controller = new DeductionSummariesController(service as never);
    await expect(controller.read(agencyId, periodId, summaryId, context)).resolves.toEqual({
      deductionSummaries: view,
    });
    expect(service.read).toHaveBeenCalledWith(context, periodId, summaryId);
  });

  it('translates a refusal into its error code', async () => {
    const service = {
      generate: vi
        .fn()
        .mockRejectedValue(
          new DeductionSummariesServiceError(
            'not finalized',
            409,
            'DEDUCTION_SUMMARIES_PAYROLL_NOT_FINALIZED',
          ),
        ),
    };
    const controller = new DeductionSummariesController(service as never);
    const refused = await controller.generate(agencyId, periodId, context).catch((e) => e);
    expect(refused).toBeInstanceOf(HttpException);
    expect((refused as HttpException).getStatus()).toBe(409);
    expect((refused as HttpException).getResponse()).toEqual({
      error: {
        code: 'DEDUCTION_SUMMARIES_PAYROLL_NOT_FINALIZED',
        message: 'not finalized',
        requestId: context.requestId,
      },
    });
  });

  it('treats another Agency or a malformed id as not found', async () => {
    const controller = new DeductionSummariesController({} as never);
    await expect(
      controller.generate('00000000-0000-4000-8000-000000000009', periodId, context),
    ).rejects.toMatchObject({ status: 404 });
    await expect(controller.read(agencyId, periodId, 'not-a-uuid', context)).rejects.toMatchObject({
      status: 404,
    });
  });
});
