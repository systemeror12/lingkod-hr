import { HttpException } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { describe, expect, it, vi } from 'vitest';
import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators';
import { LegacyRegisterComparisonsController } from './legacy-register-comparisons.controller';
import { LegacyRegisterComparisonsServiceError } from './legacy-register-comparisons.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const periodId = '00000000-0000-4000-8000-000000000002';
const context: RequestContext = {
  requestId: 'legacy-register-api-test',
  userId: '00000000-0000-4000-8000-000000000004',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000005',
  primaryOrganizationUnitId: null,
  permissions: [],
};
const file = { buffer: Buffer.from('employee_number,component_code,amount\n') };

describe('LegacyRegisterComparisonsController', () => {
  it('needs payroll.legacy_registers.compare on every route', () => {
    for (const route of ['compare', 'list', 'listForAgency', 'get'] as const) {
      expect(
        Reflect.getMetadata(
          REQUIRED_PERMISSIONS,
          LegacyRegisterComparisonsController.prototype[route],
        ),
      ).toEqual(['payroll.legacy_registers.compare']);
    }
  });

  it('answers a rejected file with every reason', async () => {
    const issues = [{ line: 2, code: 'EMPLOYEE_UNKNOWN', message: 'No Employee.' }];
    const controller = new LegacyRegisterComparisonsController({
      compare: vi
        .fn()
        .mockRejectedValue(
          new LegacyRegisterComparisonsServiceError(
            'rejected',
            400,
            'LEGACY_REGISTER_INVALID',
            issues,
          ),
        ),
    } as never);
    const refused: unknown = await controller
      .compare(agencyId, periodId, file, context)
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(HttpException);
    expect((refused as HttpException).getStatus()).toBe(400);
    expect((refused as HttpException).getResponse()).toEqual({
      error: {
        code: 'LEGACY_REGISTER_INVALID',
        message: 'rejected',
        requestId: context.requestId,
        issues,
      },
    });
  });

  it('needs a file, and treats another Agency or a malformed id as not found', async () => {
    const controller = new LegacyRegisterComparisonsController({} as never);
    await expect(controller.compare(agencyId, periodId, undefined, context)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      controller.compare('00000000-0000-4000-8000-000000000009', periodId, file, context),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      controller.listForAgency('00000000-0000-4000-8000-000000000009', context),
    ).rejects.toMatchObject({ status: 404 });
    await expect(controller.list(agencyId, 'not-a-uuid', context)).rejects.toMatchObject({
      status: 404,
    });
    await expect(controller.get(agencyId, periodId, 'not-a-uuid', context)).rejects.toMatchObject({
      status: 404,
    });
  });
});
