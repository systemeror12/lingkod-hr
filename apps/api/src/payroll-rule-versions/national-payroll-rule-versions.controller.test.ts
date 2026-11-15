import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators';
import { NationalPayrollRuleVersionsController } from './national-payroll-rule-versions.controller';
import {
  ReadNationalPayrollRuleVersionsService,
  RuleVersionReadError,
} from './read-national-payroll-rule-versions.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const ruleVersionId = '00000000-0000-4000-8000-000000000004';
const context: RequestContext = {
  requestId: 'rule-versions-api-test',
  userId: '00000000-0000-4000-8000-000000000002',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000003',
  primaryOrganizationUnitId: null,
  permissions: [{ code: 'payroll.compensation.read', scopePolicy: 'AGENCY' }],
};

it('needs payroll.compensation.read to list and to open', () => {
  const prototype = NationalPayrollRuleVersionsController.prototype;
  for (const handler of [prototype.list, prototype.get]) {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler)).toEqual([
      'payroll.compensation.read',
    ]);
  }
});

it('reads only in the acting Agency and maps service refusals to their status', async () => {
  const service = {
    list: vi.fn().mockResolvedValue({ versions: [] }),
    get: vi.fn().mockRejectedValue(new RuleVersionReadError('no', 404, 'RULE_VERSION_NOT_FOUND')),
  };
  const controller = new NationalPayrollRuleVersionsController(service as never);

  await expect(controller.list(agencyId, context)).resolves.toEqual({ versions: [] });
  await expect(controller.get(agencyId, ruleVersionId, context)).rejects.toMatchObject({
    status: 404,
    response: { error: { code: 'RULE_VERSION_NOT_FOUND' } },
  });
  expect(service.get).toHaveBeenCalledWith(context, ruleVersionId);

  const otherAgency = '00000000-0000-4000-8000-000000000009';
  await expect(controller.list(otherAgency, context)).rejects.toMatchObject({ status: 404 });
  await expect(controller.get(agencyId, 'not-an-id', context)).rejects.toMatchObject({
    status: 404,
    response: { error: { code: 'RULE_VERSION_NOT_FOUND' } },
  });
  expect(service.list).toHaveBeenCalledTimes(1);
  expect(service.get).toHaveBeenCalledTimes(1);
});

it('refuses a reader without payroll.compensation.read for the whole Agency', async () => {
  const service = new ReadNationalPayrollRuleVersionsService();
  for (const permissions of [
    [],
    [{ code: 'payroll.compensation.read', scopePolicy: 'OWN' as const }],
    [{ code: 'payroll.compensation.manage', scopePolicy: 'AGENCY' as const }],
  ]) {
    await expect(service.list({ ...context, permissions })).rejects.toMatchObject({
      statusCode: 403,
      code: 'RULE_VERSION_READ_FORBIDDEN',
    });
    await expect(service.get({ ...context, permissions }, ruleVersionId)).rejects.toMatchObject({
      statusCode: 403,
    });
  }
});
