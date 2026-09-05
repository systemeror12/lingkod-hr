import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it, vi } from 'vitest';
import { PersonnelActionsController } from './personnel-actions.controller';

const agencyId = '00000000-0000-4000-8000-000000000001';
const otherAgencyId = '00000000-0000-4000-8000-000000000002';
const actionId = '00000000-0000-4000-8000-000000000003';
const context: RequestContext = {
  requestId: 'personnel-action-api-test',
  userId: '00000000-0000-4000-8000-000000000004',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000005',
  primaryOrganizationUnitId: null,
  permissions: [],
};

const input = {
  employeeId: '00000000-0000-4000-8000-000000000006',
  actionType: 'STEP_INCREMENT',
  proposedEffectivity: '2026-10-01',
  targetFacts: { newSalaryStep: 3 },
  reason: 'Apply the signed Notice of Step Increment on its stated date.',
  evidence: [],
};

function serviceMock() {
  return {
    list: vi.fn(),
    findById: vi.fn(),
    history: vi.fn(),
    authority: vi.fn(),
    create: vi.fn(),
    updateDraft: vi.fn(),
    submit: vi.fn(),
    review: vi.fn(),
    decide: vi.fn(),
    cancel: vi.fn(),
    replace: vi.fn(),
    requestEffectuation: vi.fn(),
  };
}

it('treats a foreign Agency Personnel Action register as absent', async () => {
  const service = serviceMock();
  const controller = new PersonnelActionsController(service as never);

  await expect(controller.list(otherAgencyId, context)).rejects.toMatchObject({
    status: 404,
    response: { error: { code: 'PERSONNEL_ACTION_NOT_FOUND', requestId: context.requestId } },
  });
  expect(service.list).not.toHaveBeenCalled();
});

it('rejects unsupported actions before calling the service', async () => {
  const service = serviceMock();
  const controller = new PersonnelActionsController(service as never);

  await expect(
    controller.create(agencyId, { ...input, actionType: 'OTHER' }, context),
  ).rejects.toMatchObject({ status: 400 });
  expect(service.create).not.toHaveBeenCalled();
});

it('forwards separate review and authority decisions', async () => {
  const service = serviceMock();
  service.review.mockResolvedValue({ id: actionId, status: 'RETURNED' });
  service.decide.mockResolvedValue({ id: actionId, status: 'APPROVED' });
  const controller = new PersonnelActionsController(service as never);

  await expect(
    controller.review(
      agencyId,
      actionId,
      { decision: 'RETURN', reason: 'Service evidence is incomplete.' },
      context,
    ),
  ).resolves.toMatchObject({ status: 'RETURNED' });
  await expect(
    controller.decide(
      agencyId,
      actionId,
      { decision: 'APPROVE', reason: 'The exact action version is approved.' },
      context,
    ),
  ).resolves.toMatchObject({ status: 'APPROVED' });
});
