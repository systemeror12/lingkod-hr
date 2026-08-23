import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { StaffingAuthoritiesController } from './staffing-authorities.controller';
import {
  StaffingAuthorityServiceError,
  type StaffingAuthoritySummary,
} from './staffing-authorities.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const otherAgencyId = '00000000-0000-4000-8000-000000000002';
const authorityId = '00000000-0000-4000-8000-000000000003';
const context: RequestContext = {
  requestId: 'staffing-authority-api-test',
  userId: '00000000-0000-4000-8000-000000000004',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000005',
  primaryOrganizationUnitId: null,
  permissions: [{ code: 'staffing.authorities.create', scopePolicy: 'AGENCY' }],
};

const authority: StaffingAuthoritySummary = {
  id: authorityId,
  authorityType: 'LAW',
  referenceNo: 'LAW-001',
  issuedDate: '2026-08-01',
  effectiveDate: '2026-08-15',
  sourceMetadata: { issuer: 'Congress' },
  status: 'DRAFT',
  evidence: null,
  revocationEvidence: null,
  supersededEffectiveDate: null,
  revokedEffectiveDate: null,
  revocationReason: null,
  rowVersion: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function serviceMock() {
  return {
    list: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    updateDraft: vi.fn(),
    validateEvidence: vi.fn(),
    activate: vi.fn(),
    supersede: vi.fn(),
    revoke: vi.fn(),
  };
}

it('does not disclose the Staffing Authority register outside the active Agency', async () => {
  const service = serviceMock();
  const controller = new StaffingAuthoritiesController(service as never);

  await expect(controller.list(otherAgencyId, context)).rejects.toMatchObject({
    status: 404,
    response: { error: { code: 'STAFFING_AUTHORITY_NOT_FOUND', requestId: context.requestId } },
  });
  expect(service.list).not.toHaveBeenCalled();
});

it('returns the active Agency list and keeps service errors in the public envelope', async () => {
  const service = serviceMock();
  service.list.mockResolvedValue([authority]);
  const controller = new StaffingAuthoritiesController(service as never);

  await expect(controller.list(agencyId, context)).resolves.toEqual({
    authorities: [expect.objectContaining({ id: authorityId, status: 'DRAFT' })],
  });
  expect(service.list).toHaveBeenCalledWith(context);

  service.create.mockRejectedValue(
    new StaffingAuthorityServiceError(
      'A Staffing Authority with this Agency reference already exists.',
      409,
      'STAFFING_AUTHORITY_REFERENCE_CONFLICT',
    ),
  );
  await expect(
    controller.create(
      agencyId,
      {
        authorityType: 'LAW',
        referenceNo: 'LAW-001',
        issuedDate: '2026-08-01',
        effectiveDate: '2026-08-15',
      },
      context,
    ),
  ).rejects.toMatchObject({
    status: 409,
    response: {
      error: { code: 'STAFFING_AUTHORITY_REFERENCE_CONFLICT', requestId: context.requestId },
    },
  });
});

it('requires valid IDs and forwards evidence-backed transitions', async () => {
  const service = serviceMock();
  service.validateEvidence.mockResolvedValue(authority);
  service.activate.mockResolvedValue({ ...authority, status: 'ACTIVE', evidence: {} });
  const controller = new StaffingAuthoritiesController(service as never);
  const documentId = '00000000-0000-4000-8000-000000000006';

  await expect(
    controller.validateEvidence(
      agencyId,
      authorityId,
      { documentId, validationReason: 'Reviewed official source.' },
      context,
    ),
  ).resolves.toMatchObject({ id: authorityId });
  expect(service.validateEvidence).toHaveBeenCalledWith(
    context,
    authorityId,
    {
      documentId,
      validationReason: 'Reviewed official source.',
    },
    undefined,
  );

  await expect(
    controller.activate(agencyId, authorityId, { reason: 'Approved after review.' }, context),
  ).resolves.toMatchObject({ id: authorityId, status: 'ACTIVE' });
  expect(service.activate).toHaveBeenCalledWith(
    context,
    authorityId,
    'Approved after review.',
    undefined,
  );

  await expect(
    controller.activate(agencyId, 'not-a-uuid', { reason: 'No disclosure.' }, context),
  ).rejects.toMatchObject({ status: 404 });
});
