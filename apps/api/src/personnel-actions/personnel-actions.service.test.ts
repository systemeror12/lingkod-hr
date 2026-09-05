import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import {
  personnelActionAuditWriter,
  PersonnelActionServiceError,
  PersonnelActionsService,
} from './personnel-actions.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const actionId = '00000000-0000-4000-8000-000000000009';
const documentsService = {} as ConstructorParameters<typeof PersonnelActionsService>[1];

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'personnel-action-service-test',
    userId: '00000000-0000-4000-8000-000000000002',
    agencyId,
    membershipId: '00000000-0000-4000-8000-000000000003',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

function service(): PersonnelActionsService {
  return new PersonnelActionsService(personnelActionAuditWriter, documentsService);
}

const input = {
  employeeId: '00000000-0000-4000-8000-000000000004',
  actionType: 'STEP_INCREMENT' as const,
  proposedEffectivity: '2026-10-01',
  targetFacts: { newSalaryStep: 3 },
  reason: 'Apply the signed Notice of Step Increment on its stated date.',
  evidence: [],
};

it.each([
  ['list', () => service().list(context([])), 'PERSONNEL_ACTION_READ_FORBIDDEN'],
  ['create', () => service().create(context([]), input), 'PERSONNEL_ACTION_CREATE_FORBIDDEN'],
  ['submit', () => service().submit(context([]), actionId), 'PERSONNEL_ACTION_SUBMIT_FORBIDDEN'],
  [
    'review',
    () =>
      service().review(context([]), actionId, {
        decision: 'RETURN',
        reason: 'Missing evidence.',
      }),
    'PERSONNEL_ACTION_REVIEW_FORBIDDEN',
  ],
] as const)('rechecks the %s permission before touching the database', async (_, work, code) => {
  await expect(work()).rejects.toMatchObject({ code, statusCode: 403 });
});

it('uses a typed error for Personnel Action workflow failures', () => {
  expect(new PersonnelActionServiceError('message', 409, 'CODE')).toBeInstanceOf(Error);
});

it.each([
  () =>
    service().review(
      context([{ code: 'personnel.actions.return', scopePolicy: 'AGENCY' }]),
      actionId,
      {
        decision: 'RETURN',
        reason: '   ',
      },
    ),
  () =>
    service().decide(
      context([{ code: 'personnel.actions.approve', scopePolicy: 'AGENCY' }]),
      actionId,
      {
        decision: 'APPROVE',
        reason: '',
      },
    ),
  () =>
    service().cancel(
      context([{ code: 'personnel.actions.cancel', scopePolicy: 'AGENCY' }]),
      actionId,
      '\n',
    ),
])('rejects a blank transition reason before touching the database', async (work) => {
  await expect(work()).rejects.toMatchObject({
    code: 'PERSONNEL_ACTION_REASON_REQUIRED',
    statusCode: 400,
  });
});
