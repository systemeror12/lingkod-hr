import { HttpException } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { describe, expect, it, vi } from 'vitest';
import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators';
import { PayrollPeriodsServiceError } from '../payroll-periods/payroll-periods.service';
import { PayslipReadService } from './payslip-read.service';
import { PayslipReleaseService } from './payslip-release.service';
import { PayslipWithholdService } from './payslip-withhold.service';
import { PayslipsController } from './payslips.controller';

const agencyId = '00000000-0000-4000-8000-000000000001';
const payslipId = '00000000-0000-4000-8000-000000000002';
const context = (permissions: RequestContext['permissions'] = []): RequestContext => ({
  requestId: 'payslip-api-test',
  userId: '00000000-0000-4000-8000-000000000004',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000005',
  primaryOrganizationUnitId: null,
  permissions,
});

const required = (route: keyof PayslipsController) =>
  Reflect.getMetadata(REQUIRED_PERMISSIONS, PayslipsController.prototype[route]);

describe('PayslipsController', () => {
  it('gates each command and the read by its own §6.10 permission', () => {
    expect(required('releasePeriod')).toEqual(['payroll.payslips.release']);
    expect(required('releaseWithheld')).toEqual(['payroll.payslips.release']);
    expect(required('withhold')).toEqual(['payroll.payslips.withhold']);
    expect(required('listOwn')).toEqual(['payroll.payslips.read']);
    expect(required('readOwn')).toEqual(['payroll.payslips.read']);
    expect(required('listPeriod')).toEqual(['payroll.payslips.read']);
  });

  it('answers another Agency, or a malformed id, as not found', async () => {
    const service = { withhold: vi.fn(), readOwn: vi.fn() };
    const controller = new PayslipsController(service as never, service as never, service as never);
    const otherAgency = await controller
      .withhold('00000000-0000-4000-8000-000000000009', payslipId, {}, context())
      .catch((error: unknown) => error);
    expect((otherAgency as HttpException).getStatus()).toBe(404);
    const malformed = await controller
      .readOwn(agencyId, 'not-a-uuid', context())
      .catch((error: unknown) => error);
    expect((malformed as HttpException).getResponse()).toMatchObject({
      error: { code: 'PAYSLIP_NOT_FOUND' },
    });
    expect(service.withhold).not.toHaveBeenCalled();
    expect(service.readOwn).not.toHaveBeenCalled();
  });

  it('translates a refused payroll function into its error code', async () => {
    const release = {
      releasePeriod: vi
        .fn()
        .mockRejectedValue(
          new PayrollPeriodsServiceError('conflict', 409, 'PAYROLL_FUNCTION_CONFLICT'),
        ),
    };
    const controller = new PayslipsController(release as never, {} as never, {} as never);
    const refused = await controller
      .releasePeriod(agencyId, payslipId, context())
      .catch((error: unknown) => error);
    expect((refused as HttpException).getStatus()).toBe(409);
    expect((refused as HttpException).getResponse()).toMatchObject({
      error: { code: 'PAYROLL_FUNCTION_CONFLICT', requestId: 'payslip-api-test' },
    });
  });
});

describe('payslip commands before any database work', () => {
  it('refuse release and withhold without the permission held Agency-wide', async () => {
    const own = context([
      { code: 'payroll.payslips.release', scopePolicy: 'OWN' },
      { code: 'payroll.payslips.withhold', scopePolicy: 'OWN' },
    ]);
    await expect(new PayslipReleaseService().releasePeriod(own, payslipId)).rejects.toMatchObject({
      statusCode: 403,
      code: 'PAYSLIP_FORBIDDEN',
    });
    await expect(
      new PayslipWithholdService().withhold(own, payslipId, { reason: 'x' }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'PAYSLIP_FORBIDDEN' });
  });

  it('refuse the period read to a caller holding only the own read', async () => {
    const own = context([{ code: 'payroll.payslips.read', scopePolicy: 'OWN' }]);
    await expect(
      new PayslipReadService({} as never).listPeriod(own, payslipId),
    ).rejects.toMatchObject({ statusCode: 403, code: 'PAYSLIP_FORBIDDEN' });
  });

  it('refuse withholding and a single release without a reason', async () => {
    const approver = context([
      { code: 'payroll.payslips.release', scopePolicy: 'AGENCY' },
      { code: 'payroll.payslips.withhold', scopePolicy: 'AGENCY' },
    ]);
    for (const body of [{}, { reason: '  ' }, { reason: 'ok', extra: true }]) {
      await expect(
        new PayslipWithholdService().withhold(approver, payslipId, body),
      ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' });
      await expect(
        new PayslipReleaseService().releaseWithheld(approver, payslipId, body),
      ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' });
    }
  });
});
