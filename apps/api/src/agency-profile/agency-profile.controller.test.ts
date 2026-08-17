import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { AgencyProfileController } from './agency-profile.controller';
import {
  AgencyProfileServiceError,
  type AgencyProfileVersionSummary,
} from './agency-profile.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const otherAgencyId = '00000000-0000-4000-8000-000000000002';
const versionId = '00000000-0000-4000-8000-000000000003';
const context: RequestContext = {
  requestId: 'agency-profile-api-test',
  userId: '00000000-0000-4000-8000-000000000004',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000005',
  primaryOrganizationUnitId: null,
  permissions: [
    { code: 'organization.agency.read', scopePolicy: 'AGENCY' },
    { code: 'organization.agency.update', scopePolicy: 'AGENCY' },
  ],
};

const version: AgencyProfileVersionSummary = {
  id: versionId,
  versionNo: 1,
  versionState: 'ACTIVE',
  domainStatus: 'ACTIVE',
  officialName: 'Department of Public Service Innovation',
  acronym: 'DPSI',
  agencyType: 'NGA',
  parentOrganization: 'Office of the President',
  reportingIdentifiers: 'UACS 240010000',
  appointingAuthorityTitle: 'Secretary',
  defaultTimezone: 'Asia/Manila',
  defaultCurrency: 'PHP',
  effectiveFrom: '2024-01-01',
  effectiveTo: null,
};

function serviceMock(): {
  list: ReturnType<typeof vi.fn>;
  createDraft: ReturnType<typeof vi.fn>;
  updateDraft: ReturnType<typeof vi.fn>;
  activate: ReturnType<typeof vi.fn>;
  correct: ReturnType<typeof vi.fn>;
} {
  return {
    list: vi.fn(),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    activate: vi.fn(),
    correct: vi.fn(),
  };
}

it('treats a read request outside the active Agency as not found', async () => {
  const service = serviceMock();
  const controller = new AgencyProfileController(service as never);

  await expect(controller.list(otherAgencyId, {}, context)).rejects.toMatchObject({
    status: 404,
    response: { error: { code: 'AGENCY_PROFILE_NOT_FOUND', requestId: context.requestId } },
  });
  expect(service.list).not.toHaveBeenCalled();
});

it('returns the current, Draft, and dated versions from the service', async () => {
  const service = serviceMock();
  service.list.mockResolvedValue({ current: version, draft: null, versions: [version] });
  const controller = new AgencyProfileController(service as never);

  await expect(controller.list(agencyId, { asOf: '2026-08-17' }, context)).resolves.toEqual({
    current: version,
    draft: null,
    versions: [version],
  });
  expect(service.list).toHaveBeenCalledWith(context, '2026-08-17');
});

it('rejects invalid Draft input before calling the service', async () => {
  const service = serviceMock();
  const controller = new AgencyProfileController(service as never);

  await expect(
    controller.updateDraft(
      agencyId,
      versionId,
      { officialName: '', agencyType: 'UNKNOWN', effectiveFrom: 'not-a-date' },
      context,
    ),
  ).rejects.toMatchObject({ status: 400, response: { error: { code: 'INVALID_INPUT' } } });
  expect(service.updateDraft).not.toHaveBeenCalled();
});

it('keeps service authorization errors in the public response envelope', async () => {
  const service = serviceMock();
  service.createDraft.mockRejectedValue(
    new AgencyProfileServiceError(
      'The current Agency Membership lacks the required permission.',
      403,
      'AGENCY_PROFILE_UPDATE_FORBIDDEN',
    ),
  );
  const controller = new AgencyProfileController(service as never);

  await expect(controller.createDraft(agencyId, context)).rejects.toMatchObject({
    status: 403,
    response: {
      error: { code: 'AGENCY_PROFILE_UPDATE_FORBIDDEN', requestId: context.requestId },
    },
  });
});
