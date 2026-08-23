import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { PlantillaPositionsController } from './plantilla-positions.controller';
import {
  PlantillaPositionServiceError,
  type PlantillaPositionSummary,
} from './plantilla-positions.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const otherAgencyId = '00000000-0000-4000-8000-000000000002';
const positionId = '00000000-0000-4000-8000-000000000003';
const context: RequestContext = {
  requestId: 'plantilla-position-api-test',
  userId: '00000000-0000-4000-8000-000000000004',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000005',
  primaryOrganizationUnitId: null,
  permissions: [
    { code: 'positions.items.read', scopePolicy: 'AGENCY' },
    { code: 'positions.history.read', scopePolicy: 'AGENCY' },
    { code: 'positions.items.create', scopePolicy: 'AGENCY' },
    { code: 'positions.items.update', scopePolicy: 'AGENCY' },
  ],
};

const position: PlantillaPositionSummary = {
  id: positionId,
  itemNumber: 'HRM-000143',
  status: 'PROPOSED',
  currentVersion: null,
  draft: null,
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
};

function serviceMock() {
  return {
    list: vi.fn(),
    findById: vi.fn(),
    listEvidence: vi.fn(),
    linkEvidence: vi.fn(),
    removeEvidence: vi.fn(),
    accessEvidence: vi.fn(),
    create: vi.fn(),
    createSuccessor: vi.fn(),
    updateDraft: vi.fn(),
    activate: vi.fn(),
    correct: vi.fn(),
    authorize: vi.fn(),
    declareVacant: vi.fn(),
    freeze: vi.fn(),
    unfreeze: vi.fn(),
    cancel: vi.fn(),
    abolish: vi.fn(),
  };
}

it('does not disclose the catalog outside the active Agency', async () => {
  const service = serviceMock();
  const controller = new PlantillaPositionsController(service as never);

  await expect(controller.list(otherAgencyId, undefined, context)).rejects.toMatchObject({
    status: 404,
    response: {
      error: { code: 'PLANTILLA_POSITION_NOT_FOUND', requestId: context.requestId },
    },
  });
  expect(service.list).not.toHaveBeenCalled();
});

it('returns the Agency catalog and preserves typed service failures', async () => {
  const service = serviceMock();
  service.list.mockResolvedValue([position]);
  const controller = new PlantillaPositionsController(service as never);

  await expect(controller.list(agencyId, '2026-08-23', context)).resolves.toEqual({
    positions: [expect.objectContaining({ id: positionId, itemNumber: 'HRM-000143' })],
  });
  expect(service.list).toHaveBeenCalledWith(context, '2026-08-23');

  service.create.mockRejectedValue(
    new PlantillaPositionServiceError(
      'That Item Number is already reserved in this Agency.',
      409,
      'PLANTILLA_POSITION_ITEM_NUMBER_CONFLICT',
    ),
  );
  await expect(
    controller.create(
      agencyId,
      {
        itemNumber: 'HRM-000143',
        title: 'Human Resource Management Officer III',
        salaryGrade: 18,
        organizationUnitId: '00000000-0000-4000-8000-000000000006',
        fundingSource: 'General Appropriations Act',
        employmentCategory: 'PLANTILLA',
        qualificationStandardVersionId: '00000000-0000-4000-8000-000000000007',
        staffingAuthorityId: '00000000-0000-4000-8000-000000000008',
        effectiveDate: '2026-08-23',
      },
      context,
    ),
  ).rejects.toMatchObject({
    status: 409,
    response: {
      error: { code: 'PLANTILLA_POSITION_ITEM_NUMBER_CONFLICT', requestId: context.requestId },
    },
  });
});

it('rejects malformed IDs and forwards successor requests', async () => {
  const service = serviceMock();
  service.createSuccessor.mockResolvedValue({
    current: { id: '00000000-0000-4000-8000-000000000009' },
    draft: { id: '00000000-0000-4000-8000-000000000010' },
  });
  const controller = new PlantillaPositionsController(service as never);

  await expect(controller.createSuccessor(agencyId, 'not-a-uuid', context)).rejects.toMatchObject({
    status: 404,
  });
  expect(service.createSuccessor).not.toHaveBeenCalled();
});

it('validates and forwards a controlled lifecycle transition', async () => {
  const service = serviceMock();
  service.authorize.mockResolvedValue(position);
  const controller = new PlantillaPositionsController(service as never);
  const body = {
    effectiveDate: '2026-08-24',
    reason: 'The complete position is approved for authorization.',
  };

  await expect(
    controller.authorize(agencyId, positionId, body, context, 'authorize-key'),
  ).resolves.toMatchObject({ id: positionId });
  expect(service.authorize).toHaveBeenCalledWith(context, positionId, body, 'authorize-key');
  await expect(
    controller.authorize(agencyId, positionId, { ...body, reason: ' ' }, context),
  ).rejects.toMatchObject({ status: 400 });
  expect(service.authorize).toHaveBeenCalledTimes(1);
});

it('validates and forwards the controlled evidence-link workflow', async () => {
  const service = serviceMock();
  service.listEvidence.mockResolvedValue([]);
  service.linkEvidence.mockResolvedValue({
    id: '00000000-0000-4000-8000-000000000006',
    positionId,
    documentId: '00000000-0000-4000-8000-000000000007',
    documentNo: 'EVIDENCE-001',
    documentType: 'POSITION_DESCRIPTION',
    classification: 'CONFIDENTIAL',
    status: 'APPROVED',
    purpose: 'POSITION_DESCRIPTION',
    versionNo: 1,
    mimeType: 'application/pdf',
    sizeBytes: 12,
    effectiveFrom: '2026-08-23',
    createdAt: '2026-08-23T00:00:00.000Z',
  });
  service.removeEvidence.mockResolvedValue({ removed: true });
  const controller = new PlantillaPositionsController(service as never);

  await expect(controller.listEvidence(agencyId, positionId, context)).resolves.toEqual({
    evidence: [],
  });
  await expect(
    controller.linkEvidence(
      agencyId,
      positionId,
      {
        documentId: '00000000-0000-4000-8000-000000000007',
        purpose: 'POSITION_DESCRIPTION',
        effectiveDate: '2026-08-23',
      },
      context,
    ),
  ).resolves.toMatchObject({ purpose: 'POSITION_DESCRIPTION' });
  expect(service.linkEvidence).toHaveBeenCalledWith(context, positionId, {
    documentId: '00000000-0000-4000-8000-000000000007',
    purpose: 'POSITION_DESCRIPTION',
    effectiveDate: '2026-08-23',
  });
  await expect(
    controller.removeEvidence(
      agencyId,
      positionId,
      '00000000-0000-4000-8000-000000000006',
      { reason: 'Attached in error.' },
      context,
    ),
  ).resolves.toEqual({ removed: true });
  expect(service.removeEvidence).toHaveBeenCalledWith(
    context,
    positionId,
    '00000000-0000-4000-8000-000000000006',
    'Attached in error.',
  );
  await expect(
    controller.linkEvidence(
      agencyId,
      positionId,
      { documentId: 'not-a-uuid', purpose: 'MIME_TYPE' },
      context,
    ),
  ).rejects.toMatchObject({ status: 400 });
  expect(service.linkEvidence).toHaveBeenCalledTimes(1);
});
