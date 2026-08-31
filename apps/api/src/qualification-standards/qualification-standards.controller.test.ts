import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { QualificationStandardsController } from './qualification-standards.controller';
import {
  QualificationStandardServiceError,
  type QualificationStandardSummary,
} from './qualification-standards.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const otherAgencyId = '00000000-0000-4000-8000-000000000002';
const standardId = '00000000-0000-4000-8000-000000000003';
const versionId = '00000000-0000-4000-8000-000000000004';
const context: RequestContext = {
  requestId: 'qualification-standard-api-test',
  userId: '00000000-0000-4000-8000-000000000005',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000006',
  primaryOrganizationUnitId: null,
  permissions: [{ code: 'qualification.standards.read', scopePolicy: 'AGENCY' }],
};

const standard: QualificationStandardSummary = {
  id: standardId,
  code: 'QS-001',
  name: 'Administrative Services',
  status: 'INACTIVE',
  currentVersion: null,
  draft: {
    id: versionId,
    qualificationStandardId: standardId,
    versionNo: 1,
    educationRequirement: 'Bachelor degree',
    trainingHoursRequired: 40,
    experienceMonthsRequired: 24,
    eligibilityRequirement: 'Career service',
    competencyRequirements: [{ code: 'WRITING' }],
    licenseRequirements: [],
    specialRequirements: null,
    effectiveFrom: '2026-08-15',
    effectiveTo: null,
    versionState: 'DRAFT',
    lifecycleStatus: 'INACTIVE',
    sourceEvidence: null,
    approvalEvidence: null,
    rowVersion: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function serviceMock() {
  return {
    list: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    createSuccessor: vi.fn(),
    updateDraft: vi.fn(),
    linkEvidence: vi.fn(),
    activate: vi.fn(),
    correct: vi.fn(),
  };
}

it('does not disclose the register outside the active Agency', async () => {
  const service = serviceMock();
  const controller = new QualificationStandardsController(service as never);

  await expect(controller.list(otherAgencyId, context)).rejects.toMatchObject({
    status: 404,
    response: {
      error: { code: 'QUALIFICATION_STANDARD_NOT_FOUND', requestId: context.requestId },
    },
  });
  expect(service.list).not.toHaveBeenCalled();
});

it('returns the active Agency list and preserves service error envelopes', async () => {
  const service = serviceMock();
  service.list.mockResolvedValue([standard]);
  const controller = new QualificationStandardsController(service as never);

  await expect(controller.list(agencyId, context)).resolves.toEqual({
    standards: [expect.objectContaining({ id: standardId, status: 'INACTIVE' })],
  });
  expect(service.list).toHaveBeenCalledWith(context);

  service.create.mockRejectedValue(
    new QualificationStandardServiceError(
      'A Qualification Standard with this Agency code already exists.',
      409,
      'QUALIFICATION_STANDARD_CODE_CONFLICT',
    ),
  );
  await expect(
    controller.create(
      agencyId,
      { code: 'QS-001', name: 'Administrative Services', effectiveDate: '2026-08-15' },
      context,
    ),
  ).rejects.toMatchObject({
    status: 409,
    response: {
      error: { code: 'QUALIFICATION_STANDARD_CODE_CONFLICT', requestId: context.requestId },
    },
  });
});

it('forwards evidence-backed version transitions with validated IDs', async () => {
  const service = serviceMock();
  service.linkEvidence.mockResolvedValue(standard.draft);
  service.activate.mockResolvedValue({
    ...standard,
    status: 'ACTIVE',
    currentVersion: standard.draft,
  });
  const controller = new QualificationStandardsController(service as never);
  const documentId = '00000000-0000-4000-8000-000000000007';

  await expect(
    controller.linkEvidence(
      agencyId,
      standardId,
      versionId,
      { kind: 'SOURCE', documentId, validationReason: 'Reviewed source.' },
      context,
    ),
  ).resolves.toMatchObject({ id: versionId });
  expect(service.linkEvidence).toHaveBeenCalledWith(context, standardId, versionId, {
    kind: 'SOURCE',
    documentId,
    validationReason: 'Reviewed source.',
  });

  await expect(
    controller.activate(
      agencyId,
      standardId,
      versionId,
      { reason: 'Approved after review.' },
      undefined,
      context,
    ),
  ).resolves.toMatchObject({ id: standardId, status: 'ACTIVE' });
  expect(service.activate).toHaveBeenCalledWith(
    context,
    standardId,
    versionId,
    'Approved after review.',
    undefined,
  );
});
