import { expect, it } from 'vitest';
import {
  appointmentCancelSchema,
  appointmentCorrectionSchema,
  appointmentCreateSchema,
  appointmentListSchema,
  appointmentReasonSchema,
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
