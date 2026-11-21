import { HttpException } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { describe, expect, it, vi } from 'vitest';
import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators';
import { PaymentExportsController } from './payment-exports.controller';
import { PaymentExportsServiceError } from './payment-exports.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const periodId = '00000000-0000-4000-8000-000000000002';
const exportId = '00000000-0000-4000-8000-000000000003';
const context: RequestContext = {
  requestId: 'payment-export-api-test',
  userId: '00000000-0000-4000-8000-000000000004',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000005',
  primaryOrganizationUnitId: null,
  permissions: [],
};

describe('PaymentExportsController', () => {
  it('needs payroll.payment_exports.generate on every route', () => {
    for (const route of ['generate', 'downloadCsv', 'downloadSummary'] as const) {
      expect(
        Reflect.getMetadata(REQUIRED_PERMISSIONS, PaymentExportsController.prototype[route]),
      ).toEqual(['payroll.payment_exports.generate']);
    }
  });

  it('serves the CSV as an attachment', async () => {
    const service = {
      downloadCsv: vi.fn().mockResolvedValue({
        fileName: `payment-export-${exportId}-v1.csv`,
        contentType: 'text/csv; charset=utf-8',
        content: '"a"\r\n',
        checksum: 'x',
      }),
    };
    const controller = new PaymentExportsController(service as never);
    const file = await controller.downloadCsv(agencyId, periodId, exportId, context);
    expect(file.getHeaders()).toMatchObject({
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="payment-export-${exportId}-v1.csv"`,
    });
    expect(service.downloadCsv).toHaveBeenCalledWith(context, periodId, exportId);
  });

  it('translates a blocked export into its error code', async () => {
    const service = {
      generate: vi
        .fn()
        .mockRejectedValue(
          new PaymentExportsServiceError('blocked', 409, 'PAYMENT_EXPORT_DESTINATION_BLOCKED'),
        ),
    };
    const controller = new PaymentExportsController(service as never);
    const refused = await controller.generate(agencyId, periodId, context).catch((e) => e);
    expect(refused).toBeInstanceOf(HttpException);
    expect((refused as HttpException).getStatus()).toBe(409);
    expect((refused as HttpException).getResponse()).toEqual({
      error: {
        code: 'PAYMENT_EXPORT_DESTINATION_BLOCKED',
        message: 'blocked',
        requestId: context.requestId,
      },
    });
  });

  it('treats another Agency or a malformed id as not found', async () => {
    const controller = new PaymentExportsController({} as never);
    await expect(
      controller.generate('00000000-0000-4000-8000-000000000009', periodId, context),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      controller.downloadSummary(agencyId, periodId, 'not-a-uuid', context),
    ).rejects.toMatchObject({ status: 404 });
  });
});
