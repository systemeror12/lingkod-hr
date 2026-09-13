import { expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import {
  AppointmentReadModel,
  AppointmentServiceError,
  AppointmentsService,
  deriveAppointmentExternalStanding,
} from './appointments.service';
import type { AppointmentLinkRole } from './appointments.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const appointmentId = '00000000-0000-4000-8000-000000000002';
const selectionDecisionId = '00000000-0000-4000-8000-000000000003';
const documentVersionId = '00000000-0000-4000-8000-000000000004';

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'appointments-service-test',
    userId: '00000000-0000-4000-8000-000000000005',
    agencyId,
    membershipId: '00000000-0000-4000-8000-000000000006',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

const documents = {} as ConstructorParameters<typeof AppointmentsService>[0];
const plantilla = {} as ConstructorParameters<typeof AppointmentsService>[1];
const qualificationStandards = {} as ConstructorParameters<typeof AppointmentsService>[2];
const selection = {} as ConstructorParameters<typeof AppointmentsService>[3];
const readModel = new AppointmentReadModel(
  {} as ConstructorParameters<typeof AppointmentReadModel>[0],
  plantilla,
);

const evidence: Array<{ linkRole: AppointmentLinkRole; documentVersionId: string }> = [
  { linkRole: 'PDS', documentVersionId },
  { linkRole: 'WORK_EXPERIENCE_SHEET', documentVersionId },
  { linkRole: 'ELIGIBILITY_PROOF', documentVersionId },
  { linkRole: 'POSITION_DESCRIPTION_FORM', documentVersionId },
  { linkRole: 'SELECTION_CERTIFICATION', documentVersionId },
  { linkRole: 'PUBLICATION_CERTIFICATION', documentVersionId },
  { linkRole: 'AUTHORITY_OR_DELEGATION', documentVersionId },
];

const versionFields = {
  employmentStatus: 'PERMANENT' as const,
  natureOfAppointment: 'ORIGINAL' as const,
  salaryGrade: 18,
  salaryStep: 1,
  effectivityDate: '2026-10-01',
  appointingAuthorityMembershipId: documentVersionId,
  signatureMethod: 'WET_INK' as const,
  appointmentDocumentVersionId: documentVersionId,
  evidence,
};

function service(): AppointmentsService {
  return new AppointmentsService(
    documents,
    plantilla,
    qualificationStandards,
    selection,
    readModel,
  );
}

it('rechecks the read permission before listing or reading Appointments', async () => {
  const instance = service();

  await expect(instance.list(context([]), { limit: 50, offset: 0 })).rejects.toMatchObject({
    code: 'APPOINTMENT_READ_FORBIDDEN',
    statusCode: 403,
  });
  await expect(instance.listEligibleSelections(context([]))).rejects.toMatchObject({
    code: 'APPOINTMENT_READ_FORBIDDEN',
  });
  await expect(instance.findById(context([]), appointmentId)).rejects.toMatchObject({
    code: 'APPOINTMENT_READ_FORBIDDEN',
  });
  await expect(instance.getSettings(context([]))).rejects.toMatchObject({
    code: 'APPOINTMENT_READ_FORBIDDEN',
  });
});

it.each([
  ['create', 'appointments.records.create', 'APPOINTMENT_CREATE_FORBIDDEN'],
  ['updateDraft', 'appointments.records.create', 'APPOINTMENT_CREATE_FORBIDDEN'],
  ['correct', 'appointments.records.create', 'APPOINTMENT_CREATE_FORBIDDEN'],
  ['submit', 'appointments.records.submit', 'APPOINTMENT_SUBMIT_FORBIDDEN'],
  ['returnForCorrection', 'appointments.records.return', 'APPOINTMENT_RETURN_FORBIDDEN'],
  ['endorse', 'appointments.records.endorse', 'APPOINTMENT_ENDORSE_FORBIDDEN'],
  ['issue', 'appointments.records.issue', 'APPOINTMENT_ISSUE_FORBIDDEN'],
  ['cancel', 'appointments.records.cancel', 'APPOINTMENT_CANCEL_FORBIDDEN'],
] as const)(
  'rechecks the %s permission before opening an Appointment workflow',
  async (method, _permission, code) => {
    const instance = service();
    const reason = { reason: 'A recorded reason.' };

    const call =
      method === 'create'
        ? instance.create(context([]), { selectionDecisionId, ...versionFields })
        : method === 'updateDraft'
          ? instance.updateDraft(context([]), appointmentId, versionFields)
          : method === 'correct'
            ? instance.correct(context([]), appointmentId, {
                ...versionFields,
                reason: 'Correct the record.',
                authorityDocumentVersionId: documentVersionId,
              })
            : method === 'returnForCorrection'
              ? instance.returnForCorrection(context([]), appointmentId, reason)
              : method === 'cancel'
                ? instance.cancel(context([]), appointmentId, {
                    reason: 'A recorded reason.',
                    authorityDocumentVersionId: documentVersionId,
                  })
                : instance[method](context([]), appointmentId);

    await expect(call).rejects.toMatchObject({ code, statusCode: 403 });
  },
);

it('rechecks the external tracking permissions before recording', async () => {
  const instance = service();
  const submission = {
    appointmentVersionId: documentVersionId,
    eventType: 'SUBMITTED' as const,
    occurredAt: '2026-10-02T01:00:00.000Z',
    receivingOffice: 'CSC Field Office',
    evidenceDocumentVersionId: documentVersionId,
  };
  const action = {
    appointmentVersionId: documentVersionId,
    action: 'APPROVED' as const,
    externalReference: 'CSC-2026-0001',
    actionAt: '2026-10-05T01:00:00.000Z',
    evidenceDocumentVersionId: documentVersionId,
  };

  await expect(
    instance.recordExternalSubmission(context([]), appointmentId, submission),
  ).rejects.toMatchObject({ code: 'APPOINTMENT_EXTERNAL_EVENT_FORBIDDEN', statusCode: 403 });
  await expect(
    instance.recordExternalAction(context([]), appointmentId, action),
  ).rejects.toMatchObject({ code: 'APPOINTMENT_EXTERNAL_ACTION_FORBIDDEN', statusCode: 403 });
});

it('derives the external standing from the latest recorded event', () => {
  expect(deriveAppointmentExternalStanding([], [])).toBe('NOT_SUBMITTED');
  expect(
    deriveAppointmentExternalStanding(
      [
        { eventType: 'SUBMITTED', occurredAt: '2026-10-02T01:00:00.000Z' },
        { eventType: 'RETURNED', occurredAt: '2026-10-03T01:00:00.000Z' },
      ],
      [],
    ),
  ).toBe('RETURNED');
  expect(
    deriveAppointmentExternalStanding(
      [
        { eventType: 'SUBMITTED', occurredAt: '2026-10-02T01:00:00.000Z' },
        { eventType: 'RETURNED', occurredAt: '2026-10-03T01:00:00.000Z' },
        { eventType: 'RESUBMITTED', occurredAt: '2026-10-04T01:00:00.000Z' },
      ],
      [{ action: 'APPROVED', actionAt: '2026-10-05T01:00:00.000Z' }],
    ),
  ).toBe('APPROVED');
  expect(
    deriveAppointmentExternalStanding(
      [{ eventType: 'RESUBMITTED', occurredAt: '2026-10-04T01:00:00.000Z' }],
      [
        { action: 'APPROVED', actionAt: '2026-10-05T01:00:00.000Z' },
        { action: 'INVALIDATED', actionAt: '2026-10-06T01:00:00.000Z' },
      ],
    ),
  ).toBe('INVALIDATED');
  expect(
    deriveAppointmentExternalStanding(
      [{ eventType: 'SUBMITTED', occurredAt: '2026-10-02T01:00:00.000Z' }],
      [{ action: 'UNKNOWN', actionAt: '2026-10-07T01:00:00.000Z' }],
    ),
  ).toBe('SUBMITTED');
  expect(
    deriveAppointmentExternalStanding(
      [{ eventType: 'RESUBMITTED', occurredAt: '2026-10-07T01:00:00.000Z' }],
      [
        { action: 'APPROVED', actionAt: '2026-10-05T01:00:00.000Z' },
        { action: 'INVALIDATED', actionAt: '2026-10-06T01:00:00.000Z' },
      ],
    ),
  ).toBe('RESUBMITTED');
  expect(
    deriveAppointmentExternalStanding(
      [{ eventType: 'SUBMITTED', occurredAt: '2026-10-05T01:00:00.000Z' }],
      [{ action: 'VALIDATED', actionAt: '2026-10-05T01:00:00.000Z' }],
    ),
  ).toBe('VALIDATED');
});

it('requires the settings permission before configuring the Agency', async () => {
  const instance = service();

  await expect(
    instance.configureSettings(context([]), {
      regulatoryStatus: 'REGULATED',
      statusEvidenceDocumentVersionId: documentVersionId,
    }),
  ).rejects.toMatchObject({
    code: 'APPOINTMENT_SETTINGS_FORBIDDEN',
    statusCode: 403,
  });
});

it('rechecks the Oath and Assumption permissions before recording', async () => {
  const instance = service();
  const receipt = {
    acknowledgedAt: '2026-10-02T01:00:00.000Z',
    evidenceDocumentVersionId: documentVersionId,
  };
  const oath = {
    oathDate: '2026-10-03',
    administeredByMembershipId: documentVersionId,
    authority: 'City Mayor',
    documentVersionId,
  };
  const assumption = {
    oathVersionId: documentVersionId,
    actualAssumptionDate: '2026-10-04',
    certifiedByMembershipId: documentVersionId,
    certifyingAuthority: 'City Mayor',
    certifiedAt: '2026-10-04T01:00:00.000Z',
    documentVersionId,
  };
  const outcome = {
    outcomeDate: '2026-10-05',
    reason: 'The appointee did not report for duty.',
    authorizedByMembershipId: documentVersionId,
    authorityDocumentVersionId: documentVersionId,
    evidenceDocumentVersionId: documentVersionId,
  };

  await expect(instance.recordReceipt(context([]), appointmentId, receipt)).rejects.toMatchObject({
    code: 'APPOINTMENT_RECEIPT_FORBIDDEN',
    statusCode: 403,
  });
  await expect(instance.recordOath(context([]), appointmentId, oath)).rejects.toMatchObject({
    code: 'APPOINTMENT_OATH_FORBIDDEN',
    statusCode: 403,
  });
  await expect(
    instance.correctOath(context([]), appointmentId, {
      ...oath,
      reason: 'Correct the oath date.',
      authorityDocumentVersionId: documentVersionId,
    }),
  ).rejects.toMatchObject({ code: 'APPOINTMENT_OATH_FORBIDDEN', statusCode: 403 });
  await expect(
    instance.recordAssumption(context([]), appointmentId, assumption),
  ).rejects.toMatchObject({ code: 'APPOINTMENT_ASSUMPTION_FORBIDDEN', statusCode: 403 });
  await expect(
    instance.correctAssumption(context([]), appointmentId, {
      ...assumption,
      reason: 'Correct the assumption date.',
      authorityDocumentVersionId: documentVersionId,
    }),
  ).rejects.toMatchObject({ code: 'APPOINTMENT_ASSUMPTION_FORBIDDEN', statusCode: 403 });
  await expect(
    instance.recordAssumptionFailure(context([]), appointmentId, {
      noticeDate: '2026-10-03',
      deadlineDate: '2026-10-05',
      ...outcome,
    }),
  ).rejects.toMatchObject({ code: 'APPOINTMENT_ASSUMPTION_OUTCOME_FORBIDDEN', statusCode: 403 });
  await expect(
    instance.recordAssumptionCancellation(context([]), appointmentId, outcome),
  ).rejects.toMatchObject({ code: 'APPOINTMENT_ASSUMPTION_OUTCOME_FORBIDDEN', statusCode: 403 });
});

it('uses a typed error for Appointment workflow failures', () => {
  expect(new AppointmentServiceError('message', 409, 'CODE')).toBeInstanceOf(Error);
});
