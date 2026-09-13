import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import {
  personnelActionAuditWriter,
  personnelActionCanBeApproved,
  personnelActionCanBeEffectuated,
  PersonnelActionServiceError,
  PersonnelActionsService,
} from './personnel-actions.service';

it('keeps assignment overlays review-only until their effect owner exists', () => {
  expect(personnelActionCanBeApproved('REASSIGNMENT')).toBe(false);
  expect(personnelActionCanBeApproved('DETAIL')).toBe(false);
  expect(personnelActionCanBeApproved('DESIGNATION')).toBe(false);
  expect(personnelActionCanBeApproved('SECONDMENT')).toBe(false);
  expect(personnelActionCanBeApproved('STEP_INCREMENT')).toBe(true);
});

it('approves and effectuates appointment-backed position movements', () => {
  for (const actionType of [
    'PROMOTION',
    'TRANSFER',
    'DEMOTION',
    'RECLASSIFICATION',
    'COMPARABLE_REINSTATEMENT',
  ] as const) {
    expect(personnelActionCanBeApproved(actionType)).toBe(true);
    expect(personnelActionCanBeEffectuated(actionType)).toBe(true);
  }
});

const agencyId = '00000000-0000-4000-8000-000000000001';
const actionId = '00000000-0000-4000-8000-000000000009';
const documentsService = {} as ConstructorParameters<typeof PersonnelActionsService>[1];
const plantillaPositionsService = {} as ConstructorParameters<typeof PersonnelActionsService>[2];
const authService = {} as ConstructorParameters<typeof PersonnelActionsService>[3];
const separationsService = {} as ConstructorParameters<typeof PersonnelActionsService>[4];
const appointmentsService = {} as ConstructorParameters<typeof PersonnelActionsService>[5];

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
  return new PersonnelActionsService(
    personnelActionAuditWriter,
    documentsService,
    plantillaPositionsService,
    authService,
    separationsService,
    appointmentsService,
  );
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
    'effectuate',
    () => service().effectuate(context([]), actionId),
    'PERSONNEL_ACTION_EFFECTUATE_FORBIDDEN',
  ],
  [
    'review',
    () =>
      service().review(context([]), actionId, {
        decision: 'RETURN',
        reason: 'Missing evidence.',
      }),
    'PERSONNEL_ACTION_REVIEW_FORBIDDEN',
  ],
  [
    'effectuate',
    () => service().effectuate(context([]), actionId),
    'PERSONNEL_ACTION_EFFECTUATE_FORBIDDEN',
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
