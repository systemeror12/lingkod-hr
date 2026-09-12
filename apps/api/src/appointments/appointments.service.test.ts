import { expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { AppointmentServiceError, AppointmentsService } from './appointments.service';
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
  return new AppointmentsService(documents, plantilla, qualificationStandards, selection);
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

it('uses a typed error for Appointment workflow failures', () => {
  expect(new AppointmentServiceError('message', 409, 'CODE')).toBeInstanceOf(Error);
});
