import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators';
import { PayrollInputsController } from './payroll-inputs.controller';

const agencyId = '00000000-0000-4000-8000-000000000001';
const context: RequestContext = {
  requestId: 'payroll-inputs-api-test',
  userId: '00000000-0000-4000-8000-000000000002',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000003',
  primaryOrganizationUnitId: null,
  permissions: [{ code: 'payroll.inputs.read', scopePolicy: 'AGENCY' }],
};

it('needs payroll.inputs.read to list Payroll Inputs', () => {
  expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, PayrollInputsController.prototype.list)).toEqual(
    ['payroll.inputs.read'],
  );
});

it('lists by source module and status and refuses other filters or Agencies', async () => {
  const service = { list: vi.fn().mockResolvedValue([]) };
  const controller = new PayrollInputsController(service as never);

  await expect(
    controller.list(agencyId, { sourceModule: 'LEAVE', status: 'PENDING' }, context),
  ).resolves.toEqual({ inputs: [] });
  expect(service.list).toHaveBeenCalledWith(context, { sourceModule: 'LEAVE', status: 'PENDING' });

  await expect(controller.list(agencyId, { status: 'SUPERSEDED' }, context)).rejects.toMatchObject({
    status: 400,
  });
  await expect(controller.list(agencyId, { employeeId: agencyId }, context)).rejects.toMatchObject({
    status: 400,
  });
  await expect(
    controller.list('00000000-0000-4000-8000-000000000009', {}, context),
  ).rejects.toMatchObject({ status: 404 });
  expect(service.list).toHaveBeenCalledTimes(1);
});
