import { HttpException } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { describe, expect, it, vi } from 'vitest';
import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators';
import { ContributionRemittancesController } from './contribution-remittances.controller';
import { ContributionRemittancesServiceError } from './contribution-remittances.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const periodId = '00000000-0000-4000-8000-000000000002';
const summaryId = '00000000-0000-4000-8000-000000000003';
const context: RequestContext = {
  requestId: 'contribution-remittance-api-test',
  userId: '00000000-0000-4000-8000-000000000004',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000005',
  primaryOrganizationUnitId: null,
  permissions: [],
};

describe('ContributionRemittancesController', () => {
  it('needs payroll.registers.generate on every route', () => {
    for (const route of ['generate', 'read'] as const) {
      expect(
        Reflect.getMetadata(
          REQUIRED_PERMISSIONS,
          ContributionRemittancesController.prototype[route],
        ),
      ).toEqual(['payroll.registers.generate']);
    }
  });

  it('reads one stored summary of the period', async () => {
    const view = { id: summaryId };
    const service = { read: vi.fn().mockResolvedValue(view) };
    const controller = new ContributionRemittancesController(service as never);
    await expect(controller.read(agencyId, periodId, summaryId, context)).resolves.toEqual({
      contributionRemittance: view,
    });
    expect(service.read).toHaveBeenCalledWith(context, periodId, summaryId);
  });

  it('translates a refusal into its error code', async () => {
    const service = {
      generate: vi
        .fn()
        .mockRejectedValue(
          new ContributionRemittancesServiceError(
            'not finalized',
            409,
            'CONTRIBUTION_REMITTANCE_PAYROLL_NOT_FINALIZED',
          ),
        ),
    };
    const controller = new ContributionRemittancesController(service as never);
    const refused = await controller.generate(agencyId, periodId, context).catch((e) => e);
    expect(refused).toBeInstanceOf(HttpException);
    expect((refused as HttpException).getStatus()).toBe(409);
    expect((refused as HttpException).getResponse()).toEqual({
      error: {
        code: 'CONTRIBUTION_REMITTANCE_PAYROLL_NOT_FINALIZED',
        message: 'not finalized',
        requestId: context.requestId,
      },
    });
  });

  it('treats another Agency or a malformed id as not found', async () => {
    const controller = new ContributionRemittancesController({} as never);
    await expect(
      controller.generate('00000000-0000-4000-8000-000000000009', periodId, context),
    ).rejects.toMatchObject({ status: 404 });
    await expect(controller.read(agencyId, periodId, 'not-a-uuid', context)).rejects.toMatchObject({
      status: 404,
    });
  });
});
