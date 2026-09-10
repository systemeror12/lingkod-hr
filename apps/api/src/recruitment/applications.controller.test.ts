import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { ApplicationsController } from './applications.controller';

const agencyId = '00000000-0000-4000-8000-000000000001';
const otherAgencyId = '00000000-0000-4000-8000-000000000002';
const applicationId = '00000000-0000-4000-8000-000000000003';
const publicationId = '00000000-0000-4000-8000-000000000004';
const documentVersionId = '00000000-0000-4000-8000-000000000005';

const context: RequestContext = {
  requestId: 'applications-controller-test',
  userId: '00000000-0000-4000-8000-000000000006',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000007',
  primaryOrganizationUnitId: null,
  permissions: [],
};

function serviceMock() {
  return {
    listApplications: vi.fn(),
    findApplication: vi.fn(),
    createApplication: vi.fn(),
    linkDocument: vi.fn(),
    unlinkDocument: vi.fn(),
    screenApplication: vi.fn(),
    correctScreening: vi.fn(),
    reopenApplication: vi.fn(),
    withdrawApplication: vi.fn(),
    closeApplication: vi.fn(),
  };
}

const createInput = {
  vacancyPublicationId: publicationId,
  applicant: {
    firstName: 'Ana',
    lastName: 'Reyes',
    privacyNoticeVersion: 'Privacy Notice v1',
    consentedAt: '2026-09-10T01:00:00.000Z',
  },
  documents: [{ documentVersionId, purpose: 'EDUCATION' as const }],
};

it('does not disclose Application registers outside the active Agency', async () => {
  const service = serviceMock();
  const controller = new ApplicationsController(service as never);

  await expect(controller.listApplications(otherAgencyId, {}, context)).rejects.toMatchObject({
    status: 404,
    response: { error: { code: 'RECRUITMENT_NOT_FOUND', requestId: context.requestId } },
  });
  expect(service.listApplications).not.toHaveBeenCalled();
});

it('rejects Application commands outside the active Agency before calling the service', async () => {
  const service = serviceMock();
  const controller = new ApplicationsController(service as never);

  await expect(
    controller.createApplication(otherAgencyId, createInput, context, 'application-key'),
  ).rejects.toMatchObject({
    status: 403,
    response: { error: { code: 'RECRUITMENT_WRITE_FORBIDDEN' } },
  });
  expect(service.createApplication).not.toHaveBeenCalled();
});

it('validates and forwards evidence-backed screening commands', async () => {
  const service = serviceMock();
  service.createApplication.mockResolvedValue({ id: applicationId });
  service.screenApplication.mockResolvedValue({ id: applicationId });
  service.correctScreening.mockResolvedValue({ id: applicationId });
  const controller = new ApplicationsController(service as never);

  await expect(
    controller.createApplication(agencyId, createInput, context, 'application-key'),
  ).resolves.toEqual({ id: applicationId });
  expect(service.createApplication).toHaveBeenCalledWith(context, createInput, 'application-key');

  const screening = {
    result: 'QUALIFIED' as const,
    reason: 'Education and eligibility evidence satisfy the bound standard.',
    areaResults: [
      {
        area: 'EDUCATION' as const,
        result: 'MEETS' as const,
        evidenceDocumentVersionIds: [documentVersionId],
      },
    ],
  };
  await expect(
    controller.screenApplication(agencyId, applicationId, screening, context, 'screen-key'),
  ).resolves.toEqual({ id: applicationId });
  expect(service.screenApplication).toHaveBeenCalledWith(
    context,
    applicationId,
    screening,
    'screen-key',
  );

  const correction = {
    ...screening,
    correctionReason: 'Version 1 misread the service certificate.',
  };
  await expect(
    controller.correctScreening(
      agencyId,
      applicationId,
      documentVersionId,
      correction,
      context,
      'correct-key',
    ),
  ).resolves.toEqual({ id: applicationId });
  expect(service.correctScreening).toHaveBeenCalledWith(
    context,
    applicationId,
    documentVersionId,
    correction,
    'correct-key',
  );
});

it('rejects malformed screening input before the service is called', async () => {
  const service = serviceMock();
  const controller = new ApplicationsController(service as never);

  await expect(
    controller.screenApplication(
      agencyId,
      applicationId,
      { result: 'APPROVED', reason: 'Nope', areaResults: [] },
      context,
      'screen-key',
    ),
  ).rejects.toMatchObject({
    status: 400,
    response: { error: { code: 'INVALID_INPUT' } },
  });
  expect(service.screenApplication).not.toHaveBeenCalled();
});
