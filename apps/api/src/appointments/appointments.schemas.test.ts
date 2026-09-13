import { expect, it } from 'vitest';
import {
  appointmentActivationSchema,
  appointmentAssumptionCancellationSchema,
  appointmentAssumptionCorrectionSchema,
  appointmentAssumptionFailureSchema,
  appointmentAssumptionSchema,
  appointmentCancelSchema,
  appointmentCorrectionSchema,
  appointmentCreateSchema,
  appointmentExternalActionSchema,
  appointmentExternalSubmissionSchema,
  appointmentListSchema,
  appointmentOathCorrectionSchema,
  appointmentOathSchema,
  appointmentReasonSchema,
  appointmentReceiptSchema,
  appointmentSettingsSchema,
  appointmentUpdateSchema,
} from './appointments.schemas';

const id = (suffix: string) => `00000000-0000-4000-8000-0000000000${suffix}`;

const evidence = [
  { linkRole: 'PDS', documentVersionId: id('01') },
  { linkRole: 'WORK_EXPERIENCE_SHEET', documentVersionId: id('02') },
  { linkRole: 'ELIGIBILITY_PROOF', documentVersionId: id('03') },
  { linkRole: 'POSITION_DESCRIPTION_FORM', documentVersionId: id('04') },
  { linkRole: 'SELECTION_CERTIFICATION', documentVersionId: id('05') },
  { linkRole: 'PUBLICATION_CERTIFICATION', documentVersionId: id('06') },
  { linkRole: 'AUTHORITY_OR_DELEGATION', documentVersionId: id('07') },
];

const versionFields = {
  employmentStatus: 'PERMANENT',
  natureOfAppointment: 'ORIGINAL',
  salaryGrade: 18,
  salaryStep: 1,
  effectivityDate: '2026-10-01',
  appointingAuthorityMembershipId: id('08'),
  signatureMethod: 'WET_INK',
  appointmentDocumentVersionId: id('09'),
  evidence,
};

it('accepts a supported Appointment preparation command', () => {
  expect(
    appointmentCreateSchema.safeParse({ selectionDecisionId: id('10'), ...versionFields }).success,
  ).toBe(true);
  expect(
    appointmentUpdateSchema.safeParse({
      ...versionFields,
      signatureMethod: 'ELECTRONIC',
      signatureEvidenceDocumentVersionId: id('11'),
    }).success,
  ).toBe(true);
  expect(appointmentListSchema.safeParse({}).success).toBe(true);
  expect(appointmentListSchema.safeParse({ status: 'FOR_SIGNATURE' }).success).toBe(true);
  expect(
    appointmentReasonSchema.safeParse({ reason: 'Complete the missing evidence.' }).success,
  ).toBe(true);
});

it('rejects incomplete or unsupported preparation values', () => {
  expect(
    appointmentCreateSchema.safeParse({
      selectionDecisionId: id('10'),
      ...versionFields,
      evidence: [],
    }).success,
  ).toBe(false);
  expect(
    appointmentCreateSchema.safeParse({
      selectionDecisionId: id('10'),
      ...versionFields,
      evidence: [{ linkRole: 'OTHER', documentVersionId: id('01') }],
    }).success,
  ).toBe(false);
  expect(
    appointmentCreateSchema.safeParse({
      selectionDecisionId: id('10'),
      ...versionFields,
      salaryGrade: 34,
    }).success,
  ).toBe(false);
  expect(
    appointmentCreateSchema.safeParse({
      selectionDecisionId: id('10'),
      ...versionFields,
      salaryStep: 0,
    }).success,
  ).toBe(false);
  expect(
    appointmentCreateSchema.safeParse({
      selectionDecisionId: id('10'),
      ...versionFields,
      effectivityDate: '01 October 2026',
    }).success,
  ).toBe(false);
  expect(
    appointmentCreateSchema.safeParse({
      selectionDecisionId: id('10'),
      ...versionFields,
      extra: true,
    }).success,
  ).toBe(false);
  expect(appointmentListSchema.safeParse({ status: 'APPROVED' }).success).toBe(false);
  expect(appointmentReasonSchema.safeParse({ reason: '   ' }).success).toBe(false);
});

it('requires evidenced certification for electronic and digital signatures', () => {
  expect(
    appointmentCreateSchema.safeParse({
      selectionDecisionId: id('10'),
      ...versionFields,
      signatureMethod: 'ELECTRONIC',
    }).success,
  ).toBe(false);
  expect(
    appointmentCreateSchema.safeParse({
      selectionDecisionId: id('10'),
      ...versionFields,
      signatureMethod: 'DIGITAL_CERTIFICATE',
      signatureEvidenceDocumentVersionId: id('11'),
    }).success,
  ).toBe(true);
  expect(
    appointmentUpdateSchema.safeParse({ ...versionFields, signatureMethod: 'ELECTRONIC' }).success,
  ).toBe(false);
});

it('requires reasons and authority evidence for correction and cancellation', () => {
  expect(
    appointmentCorrectionSchema.safeParse({
      ...versionFields,
      reason: 'Correct the salary step.',
      authorityDocumentVersionId: id('12'),
    }).success,
  ).toBe(true);
  expect(
    appointmentCorrectionSchema.safeParse({
      ...versionFields,
      reason: 'Correct the salary step.',
    }).success,
  ).toBe(false);
  expect(
    appointmentCorrectionSchema.safeParse({
      ...versionFields,
      reason: '',
      authorityDocumentVersionId: id('12'),
    }).success,
  ).toBe(false);
  expect(
    appointmentCancelSchema.safeParse({ reason: 'The authority withdrew the selection.' }).success,
  ).toBe(false);
  expect(appointmentCancelSchema.safeParse({}).success).toBe(false);
  expect(
    appointmentCancelSchema.safeParse({
      reason: 'The authority withdrew the selection.',
      authorityDocumentVersionId: id('12'),
    }).success,
  ).toBe(true);
});

it('accepts supported external submission and action commands', () => {
  expect(
    appointmentExternalSubmissionSchema.safeParse({
      appointmentVersionId: id('20'),
      eventType: 'SUBMITTED',
      occurredAt: '2026-10-02T01:00:00.000Z',
      receivingOffice: 'CSC Field Office',
      evidenceDocumentVersionId: id('21'),
    }).success,
  ).toBe(true);
  expect(
    appointmentExternalSubmissionSchema.safeParse({
      appointmentVersionId: id('20'),
      eventType: 'RETURNED',
      externalReference: 'CSC-2026-0001',
      occurredAt: '2026-10-03T01:00:00.000Z',
      receivingOffice: 'CSC Field Office',
      reason: 'Complete the missing attachment.',
      evidenceDocumentVersionId: id('21'),
    }).success,
  ).toBe(true);
  expect(
    appointmentExternalActionSchema.safeParse({
      appointmentVersionId: id('20'),
      action: 'APPROVED',
      externalReference: 'CSC-2026-0001',
      actionAt: '2026-10-05T01:00:00.000Z',
      evidenceDocumentVersionId: id('21'),
    }).success,
  ).toBe(true);
});

it('rejects unsupported or incomplete external tracking values', () => {
  expect(
    appointmentExternalSubmissionSchema.safeParse({
      appointmentVersionId: id('20'),
      eventType: 'APPROVED',
      occurredAt: '2026-10-02T01:00:00.000Z',
      receivingOffice: 'CSC Field Office',
      evidenceDocumentVersionId: id('21'),
    }).success,
  ).toBe(false);
  expect(
    appointmentExternalSubmissionSchema.safeParse({
      appointmentVersionId: id('20'),
      eventType: 'SUBMITTED',
      occurredAt: '02 October 2026',
      receivingOffice: 'CSC Field Office',
      evidenceDocumentVersionId: id('21'),
    }).success,
  ).toBe(false);
  expect(
    appointmentExternalSubmissionSchema.safeParse({
      appointmentVersionId: id('20'),
      eventType: 'SUBMITTED',
      occurredAt: '2026-10-02T01:00:00.000Z',
      receivingOffice: '   ',
      evidenceDocumentVersionId: id('21'),
    }).success,
  ).toBe(false);
  expect(
    appointmentExternalSubmissionSchema.safeParse({
      appointmentVersionId: id('20'),
      eventType: 'SUBMITTED',
      occurredAt: '2026-10-02T01:00:00.000Z',
      receivingOffice: 'CSC Field Office',
      evidenceDocumentVersionId: id('21'),
      extra: true,
    }).success,
  ).toBe(false);
  expect(
    appointmentExternalActionSchema.safeParse({
      appointmentVersionId: id('20'),
      action: 'APPROVED',
      actionAt: '2026-10-05T01:00:00.000Z',
      evidenceDocumentVersionId: id('21'),
    }).success,
  ).toBe(false);
  expect(
    appointmentExternalActionSchema.safeParse({
      appointmentVersionId: id('20'),
      action: 'SUBMITTED',
      externalReference: 'CSC-2026-0001',
      actionAt: '2026-10-05T01:00:00.000Z',
      evidenceDocumentVersionId: id('21'),
    }).success,
  ).toBe(false);
});

it('accepts evidenced Agency Appointment settings only', () => {
  expect(
    appointmentSettingsSchema.safeParse({
      regulatoryStatus: 'REGULATED',
      statusEvidenceDocumentVersionId: id('13'),
    }).success,
  ).toBe(true);
  expect(
    appointmentSettingsSchema.safeParse({
      regulatoryStatus: 'ACCREDITED_OR_DEREGULATED',
      statusEvidenceDocumentVersionId: id('13'),
    }).success,
  ).toBe(true);
  expect(
    appointmentSettingsSchema.safeParse({
      regulatoryStatus: 'UNKNOWN',
      statusEvidenceDocumentVersionId: id('13'),
    }).success,
  ).toBe(false);
  expect(appointmentSettingsSchema.safeParse({ regulatoryStatus: 'REGULATED' }).success).toBe(
    false,
  );
});

it('accepts an evidenced acknowledgment receipt and rejects invented facts', () => {
  expect(
    appointmentReceiptSchema.safeParse({
      acknowledgedAt: '2026-10-04T01:00:00.000Z',
      evidenceDocumentVersionId: id('30'),
    }).success,
  ).toBe(true);
  expect(
    appointmentReceiptSchema.safeParse({
      acknowledgedAt: '04 October 2026',
      evidenceDocumentVersionId: id('30'),
    }).success,
  ).toBe(false);
  expect(
    appointmentReceiptSchema.safeParse({
      acknowledgedAt: '2026-10-04T01:00:00.000Z',
    }).success,
  ).toBe(false);
  expect(
    appointmentReceiptSchema.safeParse({
      acknowledgedAt: '2026-10-04T01:00:00.000Z',
      evidenceDocumentVersionId: id('30'),
      assumedAt: '2026-10-05T01:00:00.000Z',
    }).success,
  ).toBe(false);
});

it('accepts an exact oath or reasoned oath replacement only', () => {
  const oath = {
    oathDate: '2026-10-05',
    administeredByMembershipId: id('31'),
    authority: 'Municipal Circuit Trial Court Judge',
    place: 'Municipal Hall',
    documentVersionId: id('32'),
  };
  expect(appointmentOathSchema.safeParse(oath).success).toBe(true);
  expect(
    appointmentOathSchema.safeParse({
      ...oath,
      permittedVirtualMethod: 'Video conference under the 2025 ORAOHRA',
      place: undefined,
    }).success,
  ).toBe(true);
  expect(appointmentOathSchema.safeParse({ ...oath, oathDate: '05 October 2026' }).success).toBe(
    false,
  );
  expect(appointmentOathSchema.safeParse({ ...oath, authority: '   ' }).success).toBe(false);
  expect(appointmentOathSchema.safeParse({ ...oath, documentVersionId: undefined }).success).toBe(
    false,
  );
  expect(appointmentOathSchema.safeParse({ ...oath, reason: 'Typo.' }).success).toBe(false);
  expect(
    appointmentOathCorrectionSchema.safeParse({
      ...oath,
      reason: 'Correct the recorded oath date.',
      authorityDocumentVersionId: id('33'),
    }).success,
  ).toBe(true);
  expect(appointmentOathCorrectionSchema.safeParse({ ...oath, reason: '' }).success).toBe(false);
  expect(appointmentOathCorrectionSchema.safeParse(oath).success).toBe(false);
});

it('accepts an evidenced assumption linked to the exact oath version only', () => {
  const assumption = {
    oathVersionId: id('34'),
    actualAssumptionDate: '2026-10-07',
    certifiedByMembershipId: id('35'),
    certifyingAuthority: 'Municipal Human Resource Management Officer',
    certifiedAt: '2026-10-07T02:00:00.000Z',
    documentVersionId: id('36'),
  };
  expect(appointmentAssumptionSchema.safeParse(assumption).success).toBe(true);
  expect(
    appointmentAssumptionSchema.safeParse({ ...assumption, actualAssumptionDate: '07/10/2026' })
      .success,
  ).toBe(false);
  expect(
    appointmentAssumptionSchema.safeParse({ ...assumption, certifiedAt: '2026-10-07' }).success,
  ).toBe(false);
  expect(
    appointmentAssumptionSchema.safeParse({ ...assumption, oathVersionId: undefined }).success,
  ).toBe(false);
  expect(
    appointmentAssumptionCorrectionSchema.safeParse({
      ...assumption,
      reason: 'Correct the actual assumption date.',
      authorityDocumentVersionId: id('37'),
    }).success,
  ).toBe(true);
  expect(appointmentAssumptionCorrectionSchema.safeParse(assumption).success).toBe(false);
});

it('requires notice and deadline for failure and evidence for cancellation', () => {
  const outcome = {
    outcomeDate: '2026-10-20',
    reason: 'The appointee did not assume duty.',
    authorizedByMembershipId: id('38'),
    authorityDocumentVersionId: id('39'),
    evidenceDocumentVersionId: id('40'),
  };
  expect(
    appointmentAssumptionFailureSchema.safeParse({
      ...outcome,
      noticeDate: '2026-10-08',
      deadlineDate: '2026-10-15',
    }).success,
  ).toBe(true);
  expect(
    appointmentAssumptionFailureSchema.safeParse({
      ...outcome,
      noticeDate: '2026-10-15',
      deadlineDate: '2026-10-08',
    }).success,
  ).toBe(false);
  expect(appointmentAssumptionFailureSchema.safeParse(outcome).success).toBe(false);
  expect(appointmentAssumptionCancellationSchema.safeParse(outcome).success).toBe(true);
  expect(
    appointmentAssumptionCancellationSchema.safeParse({
      ...outcome,
      noticeDate: '2026-10-08',
    }).success,
  ).toBe(false);
  expect(
    appointmentAssumptionCancellationSchema.safeParse({
      ...outcome,
      evidenceDocumentVersionId: undefined,
    }).success,
  ).toBe(false);
});

it('accepts exactly one Employee source for service activation', () => {
  const employee = {
    employeeNumber: 'E2E-1001',
    birthDate: '1990-04-15',
    sex: 'FEMALE',
    civilStatus: 'SINGLE',
    contactEmail: 'appointee@example.test',
  };
  expect(appointmentActivationSchema.safeParse({ employeeId: id('41') }).success).toBe(true);
  expect(appointmentActivationSchema.safeParse({ employee }).success).toBe(true);
  expect(appointmentActivationSchema.safeParse({}).success).toBe(false);
  expect(appointmentActivationSchema.safeParse({ employeeId: id('41'), employee }).success).toBe(
    false,
  );
  expect(
    appointmentActivationSchema.safeParse({ employee: { ...employee, legalName: 'Invented' } })
      .success,
  ).toBe(false);
  expect(
    appointmentActivationSchema.safeParse({ employee: { ...employee, birthDate: '15/04/1990' } })
      .success,
  ).toBe(false);
  expect(
    appointmentActivationSchema.safeParse({ employee: { ...employee, contactEmail: 'nope' } })
      .success,
  ).toBe(false);
  expect(appointmentActivationSchema.safeParse({ employee, extra: true }).success).toBe(false);
});
