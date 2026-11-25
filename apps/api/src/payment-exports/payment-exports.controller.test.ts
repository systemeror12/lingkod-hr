import { HttpException } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { describe, expect, it, vi } from 'vitest';
import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators';
import { PaymentExportsController } from './payment-exports.controller';
import { PaymentExportsServiceError } from './payment-exports.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const periodId = '00000000-0000-4000-8000-000000000002';
const exportId = '00000000-0000-4000-8000-000000000003';
const instructionId = '00000000-0000-4000-8000-000000000006';
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
    for (const route of ['list', 'generate', 'retry', 'downloadCsv', 'downloadSummary'] as const) {
      expect(
        Reflect.getMetadata(REQUIRED_PERMISSIONS, PaymentExportsController.prototype[route]),
      ).toEqual(['payroll.payment_exports.generate']);
    }
  });

  it('needs payroll.disbursement.update to record a Disbursement Outcome', () => {
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS, PaymentExportsController.prototype.recordOutcome),
    ).toEqual(['payroll.disbursement.update']);
  });

  it('passes the instruction named in the route and the body to the outcome service', async () => {
    const outcomes = { record: vi.fn().mockResolvedValue({ id: 'outcome' }) };
    const controller = new PaymentExportsController({} as never, outcomes as never);
    const body = { outcome: 'SUBMITTED', sequence: 1 };
    await expect(
      controller.recordOutcome(agencyId, periodId, exportId, instructionId, body, context),
    ).resolves.toEqual({ outcome: { id: 'outcome' } });
    expect(outcomes.record).toHaveBeenCalledWith(
      context,
      { periodId, exportId, instructionId },
      body,
    );
    await expect(
      controller.recordOutcome(agencyId, periodId, exportId, 'not-a-uuid', body, context),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('passes the instruction named in the route and the body to the retry', async () => {
    const service = { retry: vi.fn().mockResolvedValue({ id: 'retry-export' }) };
    const controller = new PaymentExportsController(service as never, {} as never);
    const body = { reason: 'Destination corrected' };
    await expect(
      controller.retry(agencyId, periodId, exportId, instructionId, body, context),
    ).resolves.toEqual({ export: { id: 'retry-export' } });
    expect(service.retry).toHaveBeenCalledWith(
      context,
      { periodId, exportId, instructionId },
      body,
    );
    await expect(
      controller.retry(agencyId, periodId, exportId, 'not-a-uuid', body, context),
    ).rejects.toMatchObject({ status: 404 });
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
    const controller = new PaymentExportsController(service as never, {} as never);
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
    const controller = new PaymentExportsController(service as never, {} as never);
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
    const controller = new PaymentExportsController({} as never, {} as never);
    await expect(
      controller.generate('00000000-0000-4000-8000-000000000009', periodId, context),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      controller.downloadSummary(agencyId, periodId, 'not-a-uuid', context),
    ).rejects.toMatchObject({ status: 404 });
  });
});
