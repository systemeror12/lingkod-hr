import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { PersonnelBaselineDto } from './personnel-baselines.dto';
import { PersonnelBaselinesController } from './personnel-baselines.controller';
import {
  PersonnelBaselineServiceError,
  type PersonnelBaselineSummary,
} from './personnel-baselines.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const otherAgencyId = '00000000-0000-4000-8000-000000000002';
const baselineId = '00000000-0000-4000-8000-000000000003';
const employeeId = '00000000-0000-4000-8000-000000000004';
const documentId = '00000000-0000-4000-8000-000000000005';
const versionId = '00000000-0000-4000-8000-000000000006';
const unitId = '00000000-0000-4000-8000-000000000007';

const context: RequestContext = {
  requestId: 'personnel-baseline-api-test',
  userId: '00000000-0000-4000-8000-000000000008',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000009',
  primaryOrganizationUnitId: null,
  permissions: [
    { code: 'personnel.baselines.read', scopePolicy: 'AGENCY' },
    { code: 'personnel.baselines.prepare', scopePolicy: 'AGENCY' },
    { code: 'personnel.baselines.review', scopePolicy: 'AGENCY' },
    { code: 'personnel.baselines.effectuate', scopePolicy: 'AGENCY' },
    { code: 'personnel.baselines.audit.read', scopePolicy: 'AGENCY' },
    { code: 'personnel.baselines.correct', scopePolicy: 'AGENCY' },
  ],
};

const input = {
  employeeId,
  authorityDocumentId: documentId,
  authorityEvidenceVersionId: versionId,
  firstGovernmentServiceDate: '2020-01-01',
  agencyServiceStartDate: '2026-01-01',
  organizationUnitId: unitId,
  appointmentStatus: 'PERMANENT',
  salaryGrade: null,
  salaryStep: null,
  positionId: null,
  reason: 'Adopt the verified existing personnel record.',
};

const baseline: PersonnelBaselineSummary = {
  id: baselineId,
  employee: {
    id: employeeId,
    employeeNumber: 'NEDA-2026-0042',
    legalName: 'Mara Villanueva Santos',
    serviceStatus: 'PREBOARDING',
  },
  authorityEvidence: {
    documentId,
    documentNo: 'AUTH-2026-0042',
    documentType: 'PERSONNEL_BASELINE_AUTHORITY',
    classification: 'CONFIDENTIAL',
    status: 'APPROVED',
    versionId,
    versionNo: 1,
  },
  firstGovernmentServiceDate: '2020-01-01',
  agencyServiceStartDate: '2026-01-01',
  organizationUnit: { id: unitId, code: 'HRM', name: 'Human Resource Management' },
  appointmentStatus: 'PERMANENT',
  salaryGrade: null,
  salaryStep: null,
  position: null,
  status: 'DRAFT',
  reason: input.reason,
  reviewedAt: null,
  effectuatedAt: null,
  serviceSegment: null,
  positionIncumbency: null,
  supersedesBaselineId: null,
  createdAt: '2026-08-31T00:00:00.000Z',
  updatedAt: '2026-08-31T00:00:00.000Z',
};

function serviceMock() {
  return {
    list: vi.fn(),
    findById: vi.fn(),
    history: vi.fn(),
    create: vi.fn(),
    updateDraft: vi.fn(),
    submit: vi.fn(),
    review: vi.fn(),
    effectuate: vi.fn(),
    correct: vi.fn(),
    void: vi.fn(),
  };
}

it('does not disclose baselines outside the active Agency', async () => {
  const service = serviceMock();
  const controller = new PersonnelBaselinesController(service as never);

  await expect(controller.list(otherAgencyId, context)).rejects.toMatchObject({
    status: 404,
    response: {
      error: { code: 'PERSONNEL_BASELINE_NOT_FOUND', requestId: context.requestId },
    },
  });
  expect(service.list).not.toHaveBeenCalled();
});

it('validates, forwards, and translates the baseline workflow', async () => {
  const service = serviceMock();
  service.create.mockResolvedValue(baseline);
  service.review.mockResolvedValue({ ...baseline, status: 'APPROVED' });
  service.effectuate.mockResolvedValue({ ...baseline, status: 'EFFECTIVE' });
  service.history.mockResolvedValue({ baseline, entries: [] });
  const controller = new PersonnelBaselinesController(service as never);

  await expect(controller.create(agencyId, input, context)).resolves.toBeInstanceOf(
    PersonnelBaselineDto,
  );
  expect(service.create).toHaveBeenCalledWith(context, input);
  await expect(
    controller.create(agencyId, { ...input, authorityDocumentId: 'not-a-uuid' }, context),
  ).rejects.toMatchObject({ status: 400 });
  expect(service.create).toHaveBeenCalledTimes(1);

  await expect(
    controller.review(
      agencyId,
      baselineId,
      { decision: 'APPROVE', reason: 'Evidence and service history were reviewed.' },
      context,
    ),
  ).resolves.toMatchObject({ status: 'APPROVED' });
  expect(service.review).toHaveBeenCalledWith(context, baselineId, {
    decision: 'APPROVE',
    reason: 'Evidence and service history were reviewed.',
  });

  await expect(
    controller.effectuate(agencyId, baselineId, 'baseline-key', context),
  ).resolves.toMatchObject({ status: 'EFFECTIVE' });
  expect(service.effectuate).toHaveBeenCalledWith(context, baselineId, 'baseline-key');
  await expect(controller.history(agencyId, baselineId, context)).resolves.toMatchObject({
    baseline: { id: baselineId },
    entries: [],
  });

  service.effectuate.mockRejectedValue(
    new PersonnelBaselineServiceError(
      'The baseline is not ready for effectuation.',
      409,
      'PERSONNEL_BASELINE_EFFECTUATION_NOT_ALLOWED',
    ),
  );
  await expect(
    controller.effectuate(agencyId, baselineId, undefined, context),
  ).rejects.toMatchObject({
    status: 409,
    response: {
      error: {
        code: 'PERSONNEL_BASELINE_EFFECTUATION_NOT_ALLOWED',
        requestId: context.requestId,
      },
    },
  });
});
