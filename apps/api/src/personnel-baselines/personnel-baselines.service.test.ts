import { expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import {
  personnelBaselineAuditWriter,
  PersonnelBaselineServiceError,
  PersonnelBaselinesService,
} from './personnel-baselines.service';

const documentsService = {} as ConstructorParameters<typeof PersonnelBaselinesService>[1];
const plantillaPositionsService = {} as ConstructorParameters<typeof PersonnelBaselinesService>[2];
const agencyId = '00000000-0000-4000-8000-000000000001';
const baselineId = '00000000-0000-4000-8000-000000000009';

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'personnel-baseline-service-test',
    userId: '00000000-0000-4000-8000-000000000002',
    agencyId,
    membershipId: '00000000-0000-4000-8000-000000000003',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

function service(): PersonnelBaselinesService {
  return new PersonnelBaselinesService(
    personnelBaselineAuditWriter,
    documentsService,
    plantillaPositionsService,
  );
}

const input = {
  employeeId: '00000000-0000-4000-8000-000000000004',
  authorityDocumentId: '00000000-0000-4000-8000-000000000005',
  authorityEvidenceVersionId: '00000000-0000-4000-8000-000000000006',
  firstGovernmentServiceDate: '2020-01-01',
  agencyServiceStartDate: '2026-01-01',
  organizationUnitId: '00000000-0000-4000-8000-000000000007',
  appointmentStatus: 'PERMANENT',
  salaryGrade: null,
  salaryStep: null,
  positionId: null,
  reason: 'Adopt the verified existing personnel record.',
};

it.each([
  ['list', () => service().list(context([])), 'PERSONNEL_BASELINE_READ_FORBIDDEN'],
  ['create', () => service().create(context([]), input), 'PERSONNEL_BASELINE_PREPARE_FORBIDDEN'],
  [
    'review',
    () => service().review(context([]), baselineId, { decision: 'APPROVE', reason: 'Reviewed.' }),
    'PERSONNEL_BASELINE_REVIEW_FORBIDDEN',
  ],
  [
    'effectuate',
    () => service().effectuate(context([]), baselineId),
    'PERSONNEL_BASELINE_EFFECTUATE_FORBIDDEN',
  ],
  [
    'correct',
    () => service().correct(context([]), baselineId, input),
    'PERSONNEL_BASELINE_CORRECT_FORBIDDEN',
  ],
] as const)('rechecks the %s permission before touching the database', async (_, work, code) => {
  await expect(work()).rejects.toMatchObject({ code, statusCode: 403 });
});

it('validates service dates before opening a transaction', async () => {
  await expect(
    service().create(context([{ code: 'personnel.baselines.prepare', scopePolicy: 'AGENCY' }]), {
      ...input,
      firstGovernmentServiceDate: '2026-02-30',
    }),
  ).rejects.toMatchObject({ code: 'PERSONNEL_BASELINE_DATE_INVALID', statusCode: 400 });
});

it('uses a typed error for Personnel Baseline workflow failures', () => {
  expect(new PersonnelBaselineServiceError('message', 409, 'CODE')).toBeInstanceOf(Error);
});
