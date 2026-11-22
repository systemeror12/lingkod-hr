import { HttpException } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { describe, expect, it, vi } from 'vitest';
import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators';
import { PayrollVarianceReportsController } from './payroll-variance-reports.controller';
import { PayrollVarianceReportsServiceError } from './payroll-variance-reports.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const periodId = '00000000-0000-4000-8000-000000000002';
const context: RequestContext = {
  requestId: 'payroll-variance-report-api-test',
  userId: '00000000-0000-4000-8000-000000000004',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000005',
  primaryOrganizationUnitId: null,
  permissions: [],
};

describe('PayrollVarianceReportsController', () => {
  it('needs payroll.registers.generate', () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS,
        PayrollVarianceReportsController.prototype.generate,
      ),
    ).toEqual(['payroll.registers.generate']);
  });

  it('generates the report of the period', async () => {
    const view = { id: 'report' };
    const service = { generate: vi.fn().mockResolvedValue(view) };
    const controller = new PayrollVarianceReportsController(service as never);
    await expect(controller.generate(agencyId, periodId, context)).resolves.toEqual({
      varianceReport: view,
    });
    expect(service.generate).toHaveBeenCalledWith(context, periodId);
  });

  it('translates a refusal into its error code', async () => {
    const service = {
      generate: vi
        .fn()
        .mockRejectedValue(
          new PayrollVarianceReportsServiceError(
            'not finalized',
            409,
            'PAYROLL_VARIANCE_REPORT_PAYROLL_NOT_FINALIZED',
          ),
        ),
    };
    const controller = new PayrollVarianceReportsController(service as never);
    const refused = await controller.generate(agencyId, periodId, context).catch((e) => e);
    expect(refused).toBeInstanceOf(HttpException);
    expect((refused as HttpException).getStatus()).toBe(409);
    expect((refused as HttpException).getResponse()).toEqual({
      error: {
        code: 'PAYROLL_VARIANCE_REPORT_PAYROLL_NOT_FINALIZED',
        message: 'not finalized',
        requestId: context.requestId,
      },
    });
  });

  it('treats another Agency or a malformed id as not found', async () => {
    const controller = new PayrollVarianceReportsController({} as never);
    await expect(
      controller.generate('00000000-0000-4000-8000-000000000009', periodId, context),
    ).rejects.toMatchObject({ status: 404 });
    await expect(controller.generate(agencyId, 'not-a-uuid', context)).rejects.toMatchObject({
      status: 404,
    });
  });
});
