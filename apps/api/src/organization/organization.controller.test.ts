import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { OrganizationController } from './organization.controller';
import { OrganizationServiceError, type OrganizationUnitSummary } from './organization.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const otherAgencyId = '00000000-0000-4000-8000-000000000002';
const unitId = '00000000-0000-4000-8000-000000000003';
const context: RequestContext = {
  requestId: 'organization-api-test',
  userId: '00000000-0000-4000-8000-000000000004',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000005',
  primaryOrganizationUnitId: null,
  permissions: [{ code: 'organization.units.read', scopePolicy: 'AGENCY' }],
};

const unit: OrganizationUnitSummary = {
  id: unitId,
  code: 'RMD',
  officialName: 'Records Management Division',
  unitType: 'DIVISION',
  effectiveDate: '2026-08-15',
  status: 'DRAFT',
};

function serviceMock(): {
  list: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
} {
  return {
    list: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
  };
}

it('treats a list request outside the active Agency as not found', async () => {
  const service = serviceMock();
  const controller = new OrganizationController(service as never);

  await expect(controller.list(otherAgencyId, context)).rejects.toMatchObject({
    status: 404,
    response: {
      error: {
        code: 'ORGANIZATION_UNIT_NOT_FOUND',
        requestId: context.requestId,
      },
    },
  });
  expect(service.list).not.toHaveBeenCalled();
});

it('returns a generic missing-record response for an unavailable unit', async () => {
  const service = serviceMock();
  service.findById.mockResolvedValue(null);
  const controller = new OrganizationController(service as never);

  await expect(controller.findById(agencyId, unitId, context)).rejects.toMatchObject({
    status: 404,
    response: {
      error: {
        code: 'ORGANIZATION_UNIT_NOT_FOUND',
        requestId: context.requestId,
      },
    },
  });
});

it('returns the explicit list response from the active Agency', async () => {
  const service = serviceMock();
  service.list.mockResolvedValue({ units: [unit] });
  const controller = new OrganizationController(service as never);

  await expect(controller.list(agencyId, context)).resolves.toEqual({ units: [unit] });
  expect(service.list).toHaveBeenCalledWith(context);
});

it('keeps API validation and service authorization errors in the public envelope', async () => {
  const service = serviceMock();
  service.create.mockRejectedValue(
    new OrganizationServiceError(
      'The current Agency Membership lacks the required permission.',
      403,
      'ORGANIZATION_UNIT_CREATE_FORBIDDEN',
    ),
  );
  const controller = new OrganizationController(service as never);

  await expect(
    controller.create(
      agencyId,
      {
        officialName: 'Records Management Division',
        code: 'RMD',
        unitType: 'DIVISION',
        effectiveDate: '2026-08-15',
      },
      context,
    ),
  ).rejects.toMatchObject({
    status: 403,
    response: {
      error: {
        code: 'ORGANIZATION_UNIT_CREATE_FORBIDDEN',
        requestId: context.requestId,
      },
    },
  });
  await expect(
    controller.create(
      agencyId,
      {
        officialName: 'Records Management Division',
        code: 'RMD',
        unitType: 'TEAM',
        effectiveDate: 'not-a-date',
      },
      context,
    ),
  ).rejects.toMatchObject({
    status: 400,
    response: {
      error: {
        code: 'INVALID_INPUT',
        requestId: context.requestId,
      },
    },
  });
  expect(service.create).toHaveBeenCalledOnce();
});
