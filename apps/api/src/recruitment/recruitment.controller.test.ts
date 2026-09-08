import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { RecruitmentController } from './recruitment.controller';

const agencyId = '00000000-0000-4000-8000-000000000001';
const otherAgencyId = '00000000-0000-4000-8000-000000000002';
const requestId = '00000000-0000-4000-8000-000000000003';
const publicationId = '00000000-0000-4000-8000-000000000004';
const documentVersionId = '00000000-0000-4000-8000-000000000005';

const context: RequestContext = {
  requestId: 'recruitment-controller-test',
  userId: '00000000-0000-4000-8000-000000000006',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000007',
  primaryOrganizationUnitId: null,
  permissions: [],
};

function serviceMock() {
  return {
    listRequests: vi.fn(),
    createRequest: vi.fn(),
    rebaselineRequest: vi.fn(),
    republishPublication: vi.fn(),
  };
}

const publicationInput = {
  requestToFillId: requestId,
  formDocumentVersionId: documentVersionId,
  openingDate: '2026-09-08',
  closingDate: '2026-09-18',
  channels: [{ type: 'CSC_FIELD_OFFICE', location: 'CSC Field Office' }],
  positionDetails: {},
  applicationRequirements: [],
  contactDetails: { name: 'HRMO', email: 'hrmo@example.test' },
  evidence: [],
  reason: 'The publication period was corrected under the approved authority.',
  authorityDocumentVersionId: documentVersionId,
};

it('does not disclose Recruitment registers outside the active Agency', async () => {
  const service = serviceMock();
  const controller = new RecruitmentController(service as never);

  await expect(controller.listRequests(otherAgencyId, {}, context)).rejects.toMatchObject({
    status: 404,
    response: { error: { code: 'RECRUITMENT_NOT_FOUND', requestId: context.requestId } },
  });
  expect(service.listRequests).not.toHaveBeenCalled();
});

it('rejects writes outside the active Agency before calling the service', async () => {
  const service = serviceMock();
  const controller = new RecruitmentController(service as never);

  await expect(
    controller.createRequest(
      otherAgencyId,
      { positionId: requestId, requestingUnitId: requestId, justification: 'Fill the vacancy.' },
      context,
      'request-key',
    ),
  ).rejects.toMatchObject({
    status: 403,
    response: { error: { code: 'RECRUITMENT_WRITE_FORBIDDEN' } },
  });
  expect(service.createRequest).not.toHaveBeenCalled();
});

it('validates and forwards rebaseline and republication commands', async () => {
  const service = serviceMock();
  service.rebaselineRequest.mockResolvedValue({ id: requestId });
  service.republishPublication.mockResolvedValue({ id: publicationId });
  const controller = new RecruitmentController(service as never);

  await expect(
    controller.rebaselineRequest(
      agencyId,
      requestId,
      { reason: 'The governing policy changed.', authorityDocumentVersionId: documentVersionId },
      context,
      'rebaseline-key',
    ),
  ).resolves.toEqual({ id: requestId });
  expect(service.rebaselineRequest).toHaveBeenCalledWith(
    context,
    requestId,
    { reason: 'The governing policy changed.', authorityDocumentVersionId: documentVersionId },
    'rebaseline-key',
  );

  await expect(
    controller.republishPublication(
      agencyId,
      publicationId,
      publicationInput,
      context,
      'republish-key',
    ),
  ).resolves.toEqual({ id: publicationId });
  expect(service.republishPublication).toHaveBeenCalledWith(
    context,
    publicationId,
    publicationInput,
    'republish-key',
  );
});
