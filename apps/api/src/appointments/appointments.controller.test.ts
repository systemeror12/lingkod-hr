import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { AppointmentsController } from './appointments.controller';

const agencyId = '00000000-0000-4000-8000-000000000001';
const otherAgencyId = '00000000-0000-4000-8000-000000000002';
const appointmentId = '00000000-0000-4000-8000-000000000003';
const selectionDecisionId = '00000000-0000-4000-8000-000000000004';
const documentVersionId = '00000000-0000-4000-8000-000000000005';

const context: RequestContext = {
  requestId: 'appointments-controller-test',
  userId: '00000000-0000-4000-8000-000000000006',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000007',
  primaryOrganizationUnitId: null,
  permissions: [],
};

const evidence = [
  { linkRole: 'PDS', documentVersionId },
  { linkRole: 'WORK_EXPERIENCE_SHEET', documentVersionId },
  { linkRole: 'ELIGIBILITY_PROOF', documentVersionId },
  { linkRole: 'POSITION_DESCRIPTION_FORM', documentVersionId },
  { linkRole: 'SELECTION_CERTIFICATION', documentVersionId },
  { linkRole: 'PUBLICATION_CERTIFICATION', documentVersionId },
  { linkRole: 'AUTHORITY_OR_DELEGATION', documentVersionId },
];

const versionFields = {
  employmentStatus: 'PERMANENT',
  natureOfAppointment: 'ORIGINAL',
  salaryGrade: 18,
  salaryStep: 1,
  effectivityDate: '2026-10-01',
  appointingAuthorityMembershipId: documentVersionId,
  signatureMethod: 'WET_INK',
  appointmentDocumentVersionId: documentVersionId,
  evidence,
};

function serviceMock() {
  return {
    list: vi.fn(),
    listEligibleSelections: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    updateDraft: vi.fn(),
    submit: vi.fn(),
    returnForCorrection: vi.fn(),
    endorse: vi.fn(),
    issue: vi.fn(),
    cancel: vi.fn(),
    correct: vi.fn(),
    recordExternalSubmission: vi.fn(),
    recordExternalAction: vi.fn(),
    getSettings: vi.fn(),
    configureSettings: vi.fn(),
  };
}

it('does not disclose Appointments outside the active Agency', async () => {
  const service = serviceMock();
  const controller = new AppointmentsController(service as never);

  await expect(controller.list(otherAgencyId, {}, context)).rejects.toMatchObject({
    status: 404,
    response: { error: { code: 'APPOINTMENT_NOT_FOUND', requestId: context.requestId } },
  });
  expect(service.list).not.toHaveBeenCalled();

  await expect(controller.findById(otherAgencyId, appointmentId, context)).rejects.toMatchObject({
    status: 404,
    response: { error: { code: 'APPOINTMENT_NOT_FOUND' } },
  });
  expect(service.findById).not.toHaveBeenCalled();

  await expect(controller.getSettings(otherAgencyId, context)).rejects.toMatchObject({
    status: 404,
    response: { error: { code: 'APPOINTMENT_NOT_FOUND' } },
  });
  expect(service.getSettings).not.toHaveBeenCalled();
});

it('rejects Appointment commands outside the active Agency before the service call', async () => {
  const service = serviceMock();
  const controller = new AppointmentsController(service as never);

  await expect(
    controller.create(
      otherAgencyId,
      { selectionDecisionId, ...versionFields },
      context,
      'create-key',
    ),
  ).rejects.toMatchObject({
    status: 403,
    response: { error: { code: 'APPOINTMENT_WRITE_FORBIDDEN' } },
  });
  expect(service.create).not.toHaveBeenCalled();

  await expect(
    controller.issue(otherAgencyId, appointmentId, context, 'issue-key'),
  ).rejects.toMatchObject({
    status: 403,
    response: { error: { code: 'APPOINTMENT_WRITE_FORBIDDEN' } },
  });
  expect(service.issue).not.toHaveBeenCalled();

  await expect(
    controller.configureSettings(
      otherAgencyId,
      { regulatoryStatus: 'REGULATED', statusEvidenceDocumentVersionId: documentVersionId },
      context,
      'settings-key',
    ),
  ).rejects.toMatchObject({
    status: 403,
    response: { error: { code: 'APPOINTMENT_WRITE_FORBIDDEN' } },
  });
  expect(service.configureSettings).not.toHaveBeenCalled();

  const submissionInput = {
    appointmentVersionId: documentVersionId,
    eventType: 'SUBMITTED',
    occurredAt: '2026-10-02T01:00:00.000Z',
    receivingOffice: 'CSC Field Office',
    evidenceDocumentVersionId: documentVersionId,
  };
  await expect(
    controller.recordExternalSubmission(
      otherAgencyId,
      appointmentId,
      submissionInput,
      context,
      'sub-key',
    ),
  ).rejects.toMatchObject({
    status: 403,
    response: { error: { code: 'APPOINTMENT_WRITE_FORBIDDEN' } },
  });
  expect(service.recordExternalSubmission).not.toHaveBeenCalled();

  const actionInput = {
    appointmentVersionId: documentVersionId,
    action: 'APPROVED',
    externalReference: 'CSC-2026-0001',
    actionAt: '2026-10-05T01:00:00.000Z',
    evidenceDocumentVersionId: documentVersionId,
  };
  await expect(
    controller.recordExternalAction(otherAgencyId, appointmentId, actionInput, context, 'act-key'),
  ).rejects.toMatchObject({
    status: 403,
    response: { error: { code: 'APPOINTMENT_WRITE_FORBIDDEN' } },
  });
  expect(service.recordExternalAction).not.toHaveBeenCalled();
});

it('rejects malformed Appointment input before the service is called', async () => {
  const service = serviceMock();
  const controller = new AppointmentsController(service as never);

  await expect(
    controller.create(agencyId, { selectionDecisionId }, context, 'create-key'),
  ).rejects.toMatchObject({
    status: 400,
    response: { error: { code: 'INVALID_INPUT' } },
  });
  expect(service.create).not.toHaveBeenCalled();

  await expect(controller.findById(agencyId, 'not-a-uuid', context)).rejects.toMatchObject({
    status: 404,
    response: { error: { code: 'APPOINTMENT_NOT_FOUND' } },
  });
  expect(service.findById).not.toHaveBeenCalled();

  await expect(
    controller.cancel(agencyId, appointmentId, {}, context, 'cancel-key'),
  ).rejects.toMatchObject({
    status: 400,
    response: { error: { code: 'INVALID_INPUT' } },
  });
  expect(service.cancel).not.toHaveBeenCalled();

  await expect(
    controller.submit(agencyId, appointmentId, context, 'a'.repeat(201)),
  ).rejects.toMatchObject({
    status: 400,
    response: { error: { code: 'INVALID_IDEMPOTENCY_KEY' } },
  });
  expect(service.submit).not.toHaveBeenCalled();

  await expect(
    controller.recordExternalSubmission(
      agencyId,
      appointmentId,
      {
        appointmentVersionId: documentVersionId,
        eventType: 'SUBMITTED',
        occurredAt: '2026-10-02T01:00:00.000Z',
        receivingOffice: '',
        evidenceDocumentVersionId: documentVersionId,
      },
      context,
      'sub-key',
    ),
  ).rejects.toMatchObject({
    status: 400,
    response: { error: { code: 'INVALID_INPUT' } },
  });
  expect(service.recordExternalSubmission).not.toHaveBeenCalled();

  await expect(
    controller.recordExternalAction(
      agencyId,
      appointmentId,
      {
        appointmentVersionId: documentVersionId,
        action: 'APPROVED',
        externalReference: '',
        actionAt: '2026-10-05T01:00:00.000Z',
        evidenceDocumentVersionId: documentVersionId,
      },
      context,
      'act-key',
    ),
  ).rejects.toMatchObject({
    status: 400,
    response: { error: { code: 'INVALID_INPUT' } },
  });
  expect(service.recordExternalAction).not.toHaveBeenCalled();
});

it('validates and forwards Appointment commands', async () => {
  const service = serviceMock();
  service.list.mockResolvedValue({ items: [], hasMore: false, nextOffset: null });
  service.listEligibleSelections.mockResolvedValue({ selections: [] });
  service.create.mockResolvedValue({ id: appointmentId });
  service.submit.mockResolvedValue({ id: appointmentId });
  service.returnForCorrection.mockResolvedValue({ id: appointmentId });
  service.endorse.mockResolvedValue({ id: appointmentId });
  service.issue.mockResolvedValue({ id: appointmentId });
  service.cancel.mockResolvedValue({ id: appointmentId });
  service.correct.mockResolvedValue({ id: appointmentId });
  service.recordExternalSubmission.mockResolvedValue({ id: appointmentId });
  service.recordExternalAction.mockResolvedValue({ id: appointmentId });
  service.configureSettings.mockResolvedValue({ id: appointmentId });
  const controller = new AppointmentsController(service as never);

  await expect(controller.list(agencyId, { status: 'DRAFT' }, context)).resolves.toEqual({
    appointments: [],
    hasMore: false,
    nextOffset: null,
  });
  expect(service.list).toHaveBeenCalledWith(context, {
    status: 'DRAFT',
    limit: 50,
    offset: 0,
  });

  await expect(controller.listEligibleSelections(agencyId, context)).resolves.toEqual({
    selections: [],
  });
  expect(service.listEligibleSelections).toHaveBeenCalledWith(context);

  const createInput = { selectionDecisionId, ...versionFields };
  await expect(controller.create(agencyId, createInput, context, 'create-key')).resolves.toEqual({
    id: appointmentId,
  });
  expect(service.create).toHaveBeenCalledWith(context, createInput, 'create-key');

  await expect(controller.submit(agencyId, appointmentId, context, 'submit-key')).resolves.toEqual({
    id: appointmentId,
  });
  expect(service.submit).toHaveBeenCalledWith(context, appointmentId, 'submit-key');

  await expect(
    controller.returnForCorrection(
      agencyId,
      appointmentId,
      { reason: 'Complete the missing evidence.' },
      context,
      'return-key',
    ),
  ).resolves.toEqual({ id: appointmentId });
  expect(service.returnForCorrection).toHaveBeenCalledWith(
    context,
    appointmentId,
    { reason: 'Complete the missing evidence.' },
    'return-key',
  );

  await expect(
    controller.endorse(agencyId, appointmentId, context, 'endorse-key'),
  ).resolves.toEqual({ id: appointmentId });
  expect(service.endorse).toHaveBeenCalledWith(context, appointmentId, 'endorse-key');

  await expect(controller.issue(agencyId, appointmentId, context, 'issue-key')).resolves.toEqual({
    id: appointmentId,
  });
  expect(service.issue).toHaveBeenCalledWith(context, appointmentId, 'issue-key');

  await expect(
    controller.cancel(
      agencyId,
      appointmentId,
      {
        reason: 'The authority withdrew the selection.',
        authorityDocumentVersionId: documentVersionId,
      },
      context,
      'cancel-key',
    ),
  ).resolves.toEqual({ id: appointmentId });
  expect(service.cancel).toHaveBeenCalledWith(
    context,
    appointmentId,
    {
      reason: 'The authority withdrew the selection.',
      authorityDocumentVersionId: documentVersionId,
    },
    'cancel-key',
  );

  const correctionInput = {
    ...versionFields,
    reason: 'Correct the salary step.',
    authorityDocumentVersionId: documentVersionId,
  };
  await expect(
    controller.correct(agencyId, appointmentId, correctionInput, context, 'correct-key'),
  ).resolves.toEqual({ id: appointmentId });
  expect(service.correct).toHaveBeenCalledWith(
    context,
    appointmentId,
    correctionInput,
    'correct-key',
  );

  await expect(
    controller.configureSettings(
      agencyId,
      { regulatoryStatus: 'REGULATED', statusEvidenceDocumentVersionId: documentVersionId },
      context,
      'settings-key',
    ),
  ).resolves.toEqual({ id: appointmentId });
  expect(service.configureSettings).toHaveBeenCalledWith(
    context,
    { regulatoryStatus: 'REGULATED', statusEvidenceDocumentVersionId: documentVersionId },
    'settings-key',
  );

  const submissionInput = {
    appointmentVersionId: documentVersionId,
    eventType: 'SUBMITTED',
    occurredAt: '2026-10-02T01:00:00.000Z',
    receivingOffice: 'CSC Field Office',
    evidenceDocumentVersionId: documentVersionId,
  };
  await expect(
    controller.recordExternalSubmission(
      agencyId,
      appointmentId,
      submissionInput,
      context,
      'sub-key',
    ),
  ).resolves.toEqual({ id: appointmentId });
  expect(service.recordExternalSubmission).toHaveBeenCalledWith(
    context,
    appointmentId,
    submissionInput,
    'sub-key',
  );

  const actionInput = {
    appointmentVersionId: documentVersionId,
    action: 'APPROVED',
    externalReference: 'CSC-2026-0001',
    actionAt: '2026-10-05T01:00:00.000Z',
    evidenceDocumentVersionId: documentVersionId,
  };
  await expect(
    controller.recordExternalAction(agencyId, appointmentId, actionInput, context, 'act-key'),
  ).resolves.toEqual({ id: appointmentId });
  expect(service.recordExternalAction).toHaveBeenCalledWith(
    context,
    appointmentId,
    actionInput,
    'act-key',
  );
});
