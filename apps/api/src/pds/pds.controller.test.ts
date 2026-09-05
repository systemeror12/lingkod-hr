import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { PdsController } from './pds.controller';
import {
  PdsOutputArtifactListDto,
  PdsVersionDetailDto,
  PdsVersionListResponseDto,
} from './pds.dto';
import { PdsServiceError, type PdsOutputArtifactList, type PdsVersionDetail } from './pds.service';

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
  employeeCertifiedAt: null,
  employeeCertifiedByMembershipId: null,
  hrVerifiedAt: null,
  hrVerifiedByMembershipId: null,
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
  otherInformation: null,
  declarations: null,
  references: [],
  certification: null,
  pageSignatures: [],
  transitions: [],
};

const outputList: PdsOutputArtifactList = {
  pdsVersionId: versionId,
  fieldScope: 'FULL',
  outputs: [
    {
      id: '00000000-0000-4000-8000-000000000020',
      outputKey: `${versionId}:PDS:CS_FORM_212_REVISED_2026`,
      outputType: 'PDS',
      formVersion: 'CS_FORM_212_REVISED_2026',
      templateVersion: null,
      sourceArtifactId: `pds:${versionId}`,
      sourceArtifactHash: 'abc123',
      generatedAt: '2026-08-31T00:00:00.000Z',
      dataAsOfDate: '2026-08-31',
      status: 'RELEASED',
      renderingMetadata: { pages: ['C1', 'C2', 'C3', 'C4'] },
      signatureMetadata: { pageKeys: ['C1', 'C2', 'C3', 'C4'] },
      renderedContent: { header: 'CS Form No. 212, Revised 2026, Personal Data Sheet' },
    },
  ],
};

function serviceMock() {
  return {
    list: vi.fn(),
    listOwn: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    submit: vi.fn(),
    returnForCorrection: vi.fn(),
    certify: vi.fn(),
    verify: vi.fn(),
    correct: vi.fn(),
    render: vi.fn(),
    listOutputs: vi.fn(),
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

it('forwards PDS lifecycle actions through the controller boundary', async () => {
  const service = serviceMock();
  service.submit.mockResolvedValue({ ...detail, status: 'SUBMITTED' });
  service.returnForCorrection.mockResolvedValue({ ...detail, status: 'RETURNED' });
  service.certify.mockResolvedValue({ ...detail, status: 'SUBMITTED' });
  service.verify.mockResolvedValue({ ...detail, status: 'CERTIFIED' });
  service.correct.mockResolvedValue({ ...detail, versionNo: 2, correctionReason: 'Fix ID.' });
  service.render.mockResolvedValue(outputList);
  service.listOutputs.mockResolvedValue(outputList);
  const controller = new PdsController(service as never);

  await expect(controller.submit(agencyId, versionId, {}, context)).resolves.toBeInstanceOf(
    PdsVersionDetailDto,
  );
  await expect(
    controller.returnForCorrection(agencyId, versionId, { reason: 'Missing Item 42.' }, context),
  ).resolves.toBeInstanceOf(PdsVersionDetailDto);
  await expect(
    controller.certifyOwn(agencyId, versionId, { employeeCertificationAccepted: true }, context),
  ).resolves.toBeInstanceOf(PdsVersionDetailDto);
  await expect(controller.verify(agencyId, versionId, {}, context)).resolves.toBeInstanceOf(
    PdsVersionDetailDto,
  );
  await expect(
    controller.correct(agencyId, versionId, { reason: 'Correct government ID.' }, context),
  ).resolves.toBeInstanceOf(PdsVersionDetailDto);
  await expect(controller.render(agencyId, versionId, {}, context)).resolves.toBeInstanceOf(
    PdsOutputArtifactListDto,
  );
  await expect(controller.listOutputs(agencyId, versionId, context)).resolves.toBeInstanceOf(
    PdsOutputArtifactListDto,
  );

  expect(service.submit).toHaveBeenCalledWith(context, versionId);
  expect(service.returnForCorrection).toHaveBeenCalledWith(context, versionId, {
    reason: 'Missing Item 42.',
  });
  expect(service.certify).toHaveBeenCalledWith(context, versionId, {
    employeeCertificationAccepted: true,
  });
  expect(service.verify).toHaveBeenCalledWith(context, versionId);
  expect(service.correct).toHaveBeenCalledWith(context, versionId, {
    reason: 'Correct government ID.',
  });
  expect(service.render).toHaveBeenCalledWith(context, versionId);
  expect(service.listOutputs).toHaveBeenCalledWith(context, versionId);
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
  service.submit.mockRejectedValue(
    new PdsServiceError('Complete Item 31.', 400, 'PDS_COMPLETENESS_FAILED', {
      'otherInformation.skillsAndHobbies': 'Complete Item 31.',
    }),
  );
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
  await expect(controller.submit(agencyId, versionId, {}, context)).rejects.toMatchObject({
    status: 400,
    response: {
      error: {
        code: 'PDS_COMPLETENESS_FAILED',
        fields: { 'otherInformation.skillsAndHobbies': 'Complete Item 31.' },
      },
    },
  });
});
