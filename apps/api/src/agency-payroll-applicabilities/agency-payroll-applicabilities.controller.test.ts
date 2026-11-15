import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators';
import { AgencyPayrollApplicabilitiesController } from './agency-payroll-applicabilities.controller';
import { ApplicabilityServiceError } from './agency-payroll-applicabilities.records';
import { ListAgencyPayrollApplicabilitiesService } from './list-agency-payroll-applicabilities.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const applicabilityId = '00000000-0000-4000-8000-000000000004';
const context: RequestContext = {
  requestId: 'applicability-api-test',
  userId: '00000000-0000-4000-8000-000000000002',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000003',
  primaryOrganizationUnitId: null,
  permissions: [{ code: 'payroll.compensation.manage', scopePolicy: 'AGENCY' }],
};

it('needs payroll.compensation.manage to record and to end', () => {
  const prototype = AgencyPayrollApplicabilitiesController.prototype;
  for (const handler of [prototype.record, prototype.end]) {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler)).toEqual([
      'payroll.compensation.manage',
    ]);
  }
});

it('acts only in the acting Agency and maps service refusals to their status', async () => {
  const recordService = {
    execute: vi
      .fn()
      .mockRejectedValue(
        new ApplicabilityServiceError('no', 422, 'APPLICABILITY_COMPONENT_UNCONDITIONAL'),
      ),
  };
  const endService = { execute: vi.fn().mockResolvedValue({ id: applicabilityId }) };
  const listService = {
    execute: vi.fn().mockResolvedValue({ applicabilities: [], payComponents: [] }),
  };
  const controller = new AgencyPayrollApplicabilitiesController(
    recordService as never,
    endService as never,
    listService as never,
  );
  const end = { effectiveTo: '2030-06-30', reason: 'Funding withdrawn' };

  await expect(controller.record(agencyId, {} as never, context)).rejects.toMatchObject({
    status: 422,
    response: { error: { code: 'APPLICABILITY_COMPONENT_UNCONDITIONAL' } },
  });
  await expect(controller.end(agencyId, applicabilityId, end, context)).resolves.toEqual({
    id: applicabilityId,
  });
  expect(endService.execute).toHaveBeenCalledWith(context, applicabilityId, end);

  const otherAgency = '00000000-0000-4000-8000-000000000009';
  await expect(controller.record(otherAgency, {} as never, context)).rejects.toMatchObject({
    status: 404,
  });
  await expect(controller.end(agencyId, 'not-an-id', end, context)).rejects.toMatchObject({
    status: 404,
  });
  await expect(controller.list(agencyId, context)).resolves.toEqual({
    applicabilities: [],
    payComponents: [],
  });
  await expect(controller.list(otherAgency, context)).rejects.toMatchObject({ status: 404 });
  expect(listService.execute).toHaveBeenCalledWith(context);
  expect(listService.execute).toHaveBeenCalledTimes(1);
  expect(recordService.execute).toHaveBeenCalledTimes(1);
  expect(endService.execute).toHaveBeenCalledTimes(1);
});

it('lists for a holder of read or manage across the whole Agency, and no one else', async () => {
  const service = new ListAgencyPayrollApplicabilitiesService();
  for (const permissions of [
    [],
    [{ code: 'payroll.compensation.read', scopePolicy: 'OWN' as const }],
    [{ code: 'payroll.compensation.manage', scopePolicy: 'OWN' as const }],
    [{ code: 'payroll.inputs.read', scopePolicy: 'AGENCY' as const }],
  ]) {
    await expect(service.execute({ ...context, permissions })).rejects.toMatchObject({
      statusCode: 403,
      code: 'APPLICABILITY_READ_FORBIDDEN',
    });
  }
  // The guard requires no single permission; the service decides.
  expect(
    Reflect.getMetadata(
      REQUIRED_PERMISSIONS,
      AgencyPayrollApplicabilitiesController.prototype.list,
    ),
  ).toBeUndefined();
});
