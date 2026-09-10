import { expect, it } from 'vitest';
import {
  applicationCreateSchema,
  applicationListSchema,
  applicationScreeningCorrectionSchema,
  applicationScreeningSchema,
  applicationWithdrawalSchema,
} from './applications.schemas';

const uuid = '00000000-0000-4000-8000-000000000001';
const uuid2 = '00000000-0000-4000-8000-000000000002';

const applicant = {
  firstName: 'Ana',
  lastName: 'Reyes',
  privacyNoticeVersion: 'Privacy Notice v1',
  consentedAt: '2026-09-10T01:00:00.000Z',
};

it('accepts either an existing Applicant or a new Applicant identity, never both', () => {
  expect(applicationCreateSchema.safeParse({ vacancyPublicationId: uuid, applicant }).success).toBe(
    true,
  );
  expect(
    applicationCreateSchema.safeParse({
      vacancyPublicationId: uuid,
      applicantId: uuid2,
      applicant,
    }).success,
  ).toBe(false);
  expect(applicationCreateSchema.safeParse({ vacancyPublicationId: uuid }).success).toBe(false);
  expect(
    applicationCreateSchema.safeParse({
      vacancyPublicationId: uuid,
      applicant: { ...applicant, extra: true },
    }).success,
  ).toBe(false);
});

it('requires a late handling reason and finalized authority evidence together', () => {
  expect(
    applicationCreateSchema.safeParse({
      vacancyPublicationId: uuid,
      applicant,
      lateAcceptanceReason: 'Applicant posted within the period but the record arrived late.',
    }).success,
  ).toBe(false);
  expect(
    applicationCreateSchema.safeParse({
      vacancyPublicationId: uuid,
      applicant,
      lateAcceptanceReason: 'Applicant posted within the period but the record arrived late.',
      lateAcceptanceAuthorityDocumentVersionId: uuid2,
    }).success,
  ).toBe(true);
});

it('requires an applicant identity with a privacy notice version and consent time', () => {
  expect(
    applicationCreateSchema.safeParse({
      vacancyPublicationId: uuid,
      applicant: { firstName: 'Ana', lastName: 'Reyes' },
    }).success,
  ).toBe(false);
  expect(
    applicationCreateSchema.safeParse({
      vacancyPublicationId: uuid,
      applicant: { ...applicant, consentedAt: '10 September 2026' },
    }).success,
  ).toBe(false);
});

it('accepts only supported Application list filters', () => {
  expect(applicationListSchema.parse({ status: 'QUALIFIED' })).toMatchObject({
    status: 'QUALIFIED',
    limit: 50,
    offset: 0,
  });
  expect(applicationListSchema.safeParse({ status: 'APPROVED' }).success).toBe(false);
  expect(applicationListSchema.safeParse({ unsupported: true }).success).toBe(false);
});

it('requires a screening reason and one unique record per area', () => {
  const areaResults = [{ area: 'EDUCATION', result: 'MEETS', evidenceDocumentVersionIds: [uuid] }];
  expect(
    applicationScreeningSchema.parse({
      result: 'QUALIFIED',
      reason: 'Education evidence satisfies the bound standard.',
      areaResults,
    }),
  ).toMatchObject({ result: 'QUALIFIED' });
  expect(
    applicationScreeningSchema.safeParse({
      result: 'QUALIFIED',
      reason: '',
      areaResults,
    }).success,
  ).toBe(false);
  expect(
    applicationScreeningSchema.safeParse({
      result: 'QUALIFIED',
      reason: 'Duplicate area.',
      areaResults: [...areaResults, ...areaResults],
    }).success,
  ).toBe(false);
  expect(
    applicationScreeningSchema.safeParse({
      result: 'QUALIFIED',
      reason: 'Unknown area.',
      areaResults: [{ area: 'AGE', result: 'MEETS' }],
    }).success,
  ).toBe(false);
});

it('requires a correction reason when replacing completed screening', () => {
  expect(
    applicationScreeningCorrectionSchema.safeParse({
      result: 'NOT_QUALIFIED',
      reason: 'Experience is insufficient under the bound standard.',
      areaResults: [
        { area: 'EXPERIENCE', result: 'DOES_NOT_MEET', evidenceDocumentVersionIds: [uuid] },
      ],
    }).success,
  ).toBe(false);
  expect(
    applicationScreeningCorrectionSchema.parse({
      result: 'NOT_QUALIFIED',
      reason: 'Experience is insufficient under the bound standard.',
      correctionReason: 'The service certificate was misread in version 1.',
      correctionAuthorityDocumentVersionId: uuid2,
      areaResults: [
        { area: 'EXPERIENCE', result: 'DOES_NOT_MEET', evidenceDocumentVersionIds: [uuid] },
      ],
    }),
  ).toMatchObject({ correctionReason: expect.any(String) });
});

it('requires withdrawal evidence and a reason', () => {
  expect(applicationWithdrawalSchema.safeParse({ reason: 'Applicant withdrew.' }).success).toBe(
    false,
  );
  expect(
    applicationWithdrawalSchema.parse({
      reason: 'Applicant withdrew.',
      evidenceDocumentVersionId: uuid2,
    }),
  ).toEqual({ reason: 'Applicant withdrew.', evidenceDocumentVersionId: uuid2 });
  expect(
    applicationWithdrawalSchema.safeParse({
      reason: 'Applicant withdrew.',
      evidenceDocumentVersionId: 'nope',
    }).success,
  ).toBe(false);
});
