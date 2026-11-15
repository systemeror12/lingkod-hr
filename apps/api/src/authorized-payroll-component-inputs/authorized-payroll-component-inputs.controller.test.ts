import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators';
import { AuthorizedPayrollComponentInputsController } from './authorized-payroll-component-inputs.controller';
import { AuthorizedInputServiceError } from './authorized-payroll-component-inputs.records';

const agencyId = '00000000-0000-4000-8000-000000000001';
const inputId = '00000000-0000-4000-8000-000000000004';
const context: RequestContext = {
  requestId: 'authorized-inputs-api-test',
  userId: '00000000-0000-4000-8000-000000000002',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000003',
  primaryOrganizationUnitId: null,
  permissions: [{ code: 'payroll.inputs.adjust', scopePolicy: 'AGENCY' }],
};

it('needs payroll.inputs.adjust to record and to approve', () => {
  const prototype = AuthorizedPayrollComponentInputsController.prototype;
  expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, prototype.record)).toEqual([
    'payroll.inputs.adjust',
  ]);
  expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, prototype.approve)).toEqual([
    'payroll.inputs.adjust',
  ]);
});

it('needs payroll.inputs.read to list', () => {
  expect(
    Reflect.getMetadata(
      REQUIRED_PERMISSIONS,
      AuthorizedPayrollComponentInputsController.prototype.list,
    ),
  ).toEqual(['payroll.inputs.read']);
});

it('acts only in the acting Agency and maps service refusals to their status', async () => {
  const recordService = {
    execute: vi
      .fn()
      .mockRejectedValue(
        new AuthorizedInputServiceError('no', 422, 'AUTHORIZED_INPUT_COMPONENT_NOT_ACCEPTED'),
      ),
  };
  const approveService = { execute: vi.fn().mockResolvedValue({ id: inputId }) };
  const listService = { execute: vi.fn().mockResolvedValue({ inputs: [], payComponents: [] }) };
  const controller = new AuthorizedPayrollComponentInputsController(
    recordService as never,
    approveService as never,
    listService as never,
  );

  await expect(controller.record(agencyId, {} as never, context)).rejects.toMatchObject({
    status: 422,
    response: { error: { code: 'AUTHORIZED_INPUT_COMPONENT_NOT_ACCEPTED' } },
  });
  await expect(controller.approve(agencyId, inputId, context)).resolves.toEqual({ id: inputId });
  expect(approveService.execute).toHaveBeenCalledWith(context, inputId);

  const otherAgency = '00000000-0000-4000-8000-000000000009';
  await expect(controller.record(otherAgency, {} as never, context)).rejects.toMatchObject({
    status: 404,
  });
  await expect(controller.approve(agencyId, 'not-an-id', context)).rejects.toMatchObject({
    status: 404,
  });
  await expect(controller.list(agencyId, context)).resolves.toEqual({
    inputs: [],
    payComponents: [],
  });
  await expect(controller.list(otherAgency, context)).rejects.toMatchObject({ status: 404 });
  expect(listService.execute).toHaveBeenCalledTimes(1);
  expect(recordService.execute).toHaveBeenCalledTimes(1);
  expect(approveService.execute).toHaveBeenCalledTimes(1);
});
