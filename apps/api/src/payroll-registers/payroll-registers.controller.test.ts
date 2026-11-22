import { HttpException } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { describe, expect, it, vi } from 'vitest';
import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators';
import { DocumentsServiceError } from '../documents/documents.service';
import { PayrollRegistersController } from './payroll-registers.controller';
import { PayrollRegistersServiceError } from './payroll-registers.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const periodId = '00000000-0000-4000-8000-000000000002';
const context: RequestContext = {
  requestId: 'payroll-register-api-test',
  userId: '00000000-0000-4000-8000-000000000004',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000005',
  primaryOrganizationUnitId: null,
  permissions: [],
};

describe('PayrollRegistersController', () => {
  it('needs payroll.registers.generate', () => {
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS, PayrollRegistersController.prototype.generate),
    ).toEqual(['payroll.registers.generate']);
  });

  it('translates a refusal, or unavailable storage, into its error code', async () => {
    for (const error of [
      new PayrollRegistersServiceError('mismatch', 409, 'PAYROLL_REGISTER_RECONCILIATION_FAILED'),
      new DocumentsServiceError('down', 503, 'DOCUMENT_STORAGE_FAILED'),
    ]) {
      const controller = new PayrollRegistersController({
        generate: vi.fn().mockRejectedValue(error),
      } as never);
      const refused: unknown = await controller
        .generate(agencyId, periodId, context)
        .catch((e) => e);
      expect(refused).toBeInstanceOf(HttpException);
      expect((refused as HttpException).getStatus()).toBe(error.statusCode);
      expect((refused as HttpException).getResponse()).toEqual({
        error: { code: error.code, message: error.message, requestId: context.requestId },
      });
    }
  });

  it('treats another Agency or a malformed id as not found', async () => {
    const controller = new PayrollRegistersController({} as never);
    await expect(
      controller.generate('00000000-0000-4000-8000-000000000009', periodId, context),
    ).rejects.toMatchObject({ status: 404 });
    await expect(controller.generate(agencyId, 'not-a-uuid', context)).rejects.toMatchObject({
      status: 404,
    });
  });
});
