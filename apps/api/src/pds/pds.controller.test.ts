import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { PdsController } from './pds.controller';
import { PdsVersionDetailDto, PdsVersionListResponseDto } from './pds.dto';
import { PdsServiceError, type PdsVersionDetail } from './pds.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const otherAgencyId = '00000000-0000-4000-8000-000000000002';
const employeeId = '00000000-0000-4000-8000-000000000003';
const versionId = '00000000-0000-4000-8000-000000000004';
const context: RequestContext = {
  requestId: 'pds-controller-test',
  userId: '00000000-0000-4000-8000-000000000005',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000006',
  primaryOrganizationUnitId: null,
  permissions: [
    { code: 'personnel.pds.read', scopePolicy: 'AGENCY' },
    { code: 'personnel.pds.update', scopePolicy: 'AGENCY' },
  ],
};

const detail: PdsVersionDetail = {
  id: versionId,
  employeeId,
  versionNo: 1,
  formVersion: 'CS_FORM_212_REVISED_2026',
  asOfDate: '2026-08-31',
  status: 'DRAFT',
  supersedesVersionId: null,
  correctionReason: null,
  createdByMembershipId: context.membershipId,
  createdAt: '2026-08-31T00:00:00.000Z',
  updatedByMembershipId: context.membershipId,
  updatedAt: '2026-08-31T00:00:00.000Z',
  rowVersion: 1,
  fieldScope: 'FULL',
  personal: null,
  family: { spouse: null, children: [], father: null, mother: null },
  education: [],
  eligibility: [],
  workExperience: [],
  voluntaryWork: [],
  learningAndDevelopment: [],
  wes: [],
};

function serviceMock() {
  return {
    list: vi.fn(),
    listOwn: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  };
}

it('keeps requests outside the active Agency out of the service', async () => {
  const service = serviceMock();
  const controller = new PdsController(service as never);

  await expect(controller.list(otherAgencyId, employeeId, context)).rejects.toMatchObject({
    status: 404,
    response: { error: { code: 'PDS_NOT_FOUND', requestId: context.requestId } },
  });
  expect(service.list).not.toHaveBeenCalled();
});

it('validates identifiers before forwarding the PDS request', async () => {
  const service = serviceMock();
  const controller = new PdsController(service as never);

  await expect(controller.list(agencyId, 'not-a-uuid', context)).rejects.toMatchObject({
    status: 404,
  });
  await expect(controller.findById(agencyId, 'not-a-uuid', context)).rejects.toMatchObject({
    status: 404,
  });
  expect(service.list).not.toHaveBeenCalled();
  expect(service.findById).not.toHaveBeenCalled();
});

it('forwards create, own-list, and update through the public response contract', async () => {
  const service = serviceMock();
  service.create.mockResolvedValue(detail);
  service.listOwn.mockResolvedValue({
    employeeId,
    citizenshipCountries: [],
    current: null,
    draft: null,
    versions: [],
  });
  service.update.mockResolvedValue(detail);
  const controller = new PdsController(service as never);

  await expect(
    controller.createForEmployee(agencyId, employeeId, {}, context),
  ).resolves.toBeInstanceOf(PdsVersionDetailDto);
  await expect(controller.listOwn(agencyId, context)).resolves.toBeInstanceOf(
    PdsVersionListResponseDto,
  );
  await expect(
    controller.update(agencyId, versionId, { rowVersion: 1, personal: {} }, context),
  ).resolves.toBeInstanceOf(PdsVersionDetailDto);
  expect(service.create).toHaveBeenCalledWith(context, { employeeId });
  expect(service.listOwn).toHaveBeenCalledWith(context);
  expect(service.update).toHaveBeenCalledWith(context, versionId, {
    rowVersion: 1,
    personal: {},
  });
});

it('forwards qualification rows without reshaping exact evidence references', async () => {
  const service = serviceMock();
  service.create.mockResolvedValue(detail);
  const controller = new PdsController(service as never);
  const education = {
    level: 'COLLEGE',
    schoolName: 'University',
    degreeCourse: 'Course',
    periodOfAttendance: '2010-2014',
    highestLevelUnits: null,
    yearGraduated: 2014,
    honors: 'N/A',
    documentId: '00000000-0000-4000-8000-000000000010',
    documentVersionId: '00000000-0000-4000-8000-000000000011',
  };
  const eligibility = {
    eligibilityName: 'Career Service Professional',
    rating: 'Passed',
    examDate: '2020-01-15',
    examPlace: 'Manila',
  };
  await controller.createForEmployee(
    agencyId,
    employeeId,
    { education: [education], eligibility: [eligibility] },
    context,
  );
  expect(service.create).toHaveBeenCalledWith(context, {
    employeeId,
    education: [education],
    eligibility: [eligibility],
  });
});

it('returns validation and service errors in the API envelope', async () => {
  const service = serviceMock();
  service.create.mockRejectedValue(new PdsServiceError('forbidden', 403, 'PDS_UPDATE_FORBIDDEN'));
  const controller = new PdsController(service as never);

  await expect(
    controller.createForEmployee(agencyId, employeeId, { unknown: true }, context),
  ).rejects.toMatchObject({
    status: 400,
    response: { error: { code: 'INVALID_INPUT', requestId: context.requestId } },
  });
  await expect(
    controller.createForEmployee(agencyId, employeeId, {}, context),
  ).rejects.toMatchObject({
    status: 403,
    response: { error: { code: 'PDS_UPDATE_FORBIDDEN', requestId: context.requestId } },
  });
});
