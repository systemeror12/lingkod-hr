import { HttpException } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { describe, expect, it, vi } from 'vitest';
import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators';
import { AccountingSupportExportsController } from './accounting-support-exports.controller';
import { AccountingSupportExportsServiceError } from './accounting-support-exports.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const periodId = '00000000-0000-4000-8000-000000000002';
const exportId = '00000000-0000-4000-8000-000000000003';
const context: RequestContext = {
  requestId: 'accounting-support-export-api-test',
  userId: '00000000-0000-4000-8000-000000000004',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000005',
  primaryOrganizationUnitId: null,
  permissions: [],
};

describe('AccountingSupportExportsController', () => {
  it('guards each route with its own permission', () => {
    const required = (route: keyof AccountingSupportExportsController) =>
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS,
        AccountingSupportExportsController.prototype[route],
      );
    expect(required('generate')).toEqual(['payroll.accounting_exports.generate']);
    expect(required('downloadExport')).toEqual(['payroll.accounting_exports.generate']);
    expect(required('downloadEmployeeDetail')).toEqual(['payroll.export_detail.read']);
    expect(required('recordOutcome')).toEqual(['payroll.export_outcomes.record']);
  });

  it('serves the companion as a JSON attachment', async () => {
    const service = {
      downloadEmployeeDetail: vi.fn().mockResolvedValue({
        fileName: `accounting-support-export-${exportId}-employee-detail-v1.json`,
        contentType: 'application/json; charset=utf-8',
        content: '{}',
        checksum: 'x',
      }),
    };
    const controller = new AccountingSupportExportsController(service as never);
    const file = await controller.downloadEmployeeDetail(agencyId, periodId, exportId, context);
    expect(file.getHeaders()).toMatchObject({
      type: 'application/json; charset=utf-8',
      disposition: `attachment; filename="accounting-support-export-${exportId}-employee-detail-v1.json"`,
    });
    expect(service.downloadEmployeeDetail).toHaveBeenCalledWith(context, periodId, exportId);
  });

  it('translates a reconciliation failure into its error code', async () => {
    const service = {
      generate: vi
        .fn()
        .mockRejectedValue(
          new AccountingSupportExportsServiceError(
            'does not reconcile',
            409,
            'PAYROLL_EXPORT_RECONCILIATION_FAILED',
          ),
        ),
    };
    const controller = new AccountingSupportExportsController(service as never);
    const refused = await controller.generate(agencyId, periodId, context).catch((e) => e);
    expect(refused).toBeInstanceOf(HttpException);
    expect((refused as HttpException).getStatus()).toBe(409);
    expect((refused as HttpException).getResponse()).toEqual({
      error: {
        code: 'PAYROLL_EXPORT_RECONCILIATION_FAILED',
        message: 'does not reconcile',
        requestId: context.requestId,
      },
    });
  });

  it('treats another Agency or a malformed id as not found', async () => {
    const controller = new AccountingSupportExportsController({} as never);
    await expect(
      controller.generate('00000000-0000-4000-8000-000000000009', periodId, context),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      controller.recordOutcome(agencyId, periodId, 'not-a-uuid', {}, context),
    ).rejects.toMatchObject({ status: 404 });
  });
});
