import { expect, it } from 'vitest';
import {
  requestToFillCreateSchema,
  requestToFillRebaselineSchema,
  vacancyPublicationCancelSchema,
  vacancyPublicationCloseSchema,
  vacancyPublicationCreateSchema,
  vacancyPublicationCorrectionSchema,
  vacancyPublicationRepublishSchema,
} from './recruitment.schemas';

const uuid = '00000000-0000-4000-8000-000000000001';

it('requires finalized authority evidence for an MSP rebaseline', () => {
  expect(requestToFillRebaselineSchema.safeParse({ reason: 'Policy changed.' }).success).toBe(
    false,
  );
  expect(
    requestToFillRebaselineSchema.safeParse({
      reason: 'Policy changed.',
      authorityDocumentVersionId: uuid,
      unsupported: true,
    }).success,
  ).toBe(false);
  expect(
    requestToFillRebaselineSchema.parse({
      reason: 'Policy changed.',
      authorityDocumentVersionId: uuid,
    }),
  ).toEqual({ reason: 'Policy changed.', authorityDocumentVersionId: uuid });
});

it('keeps Request to Fill creation scoped to a position, office, and justification', () => {
  expect(
    requestToFillCreateSchema.safeParse({
      positionId: uuid,
      requestingUnitId: uuid,
      justification: 'Fill the authorized vacancy.',
      extra: 'not accepted',
    }).success,
  ).toBe(false);
  expect(
    requestToFillCreateSchema.parse({
      positionId: uuid,
      requestingUnitId: uuid,
      justification: '  Fill the authorized vacancy.  ',
    }),
  ).toEqual({
    positionId: uuid,
    requestingUnitId: uuid,
    justification: 'Fill the authorized vacancy.',
  });
});

it('accepts only calendar dates and supported publication channel shapes', () => {
  const result = vacancyPublicationCreateSchema.safeParse({
    requestToFillId: uuid,
    formDocumentVersionId: uuid,
    openingDate: '2026-09-08',
    closingDate: '2026-09-18',
    channels: [
      { type: 'CSC_FIELD_OFFICE', location: 'CSC Field Office' },
      { type: 'CSC_JOB_PORTAL', location: 'CSC Job Portal' },
      { type: 'AGENCY_POSTING_PLACE', location: 'Agency Main Office' },
    ],
    positionDetails: {},
    applicationRequirements: [],
    contactDetails: { name: 'HRMO', email: 'hrmo@example.test' },
    evidence: [],
  });
  expect(result.success).toBe(true);
  expect(
    vacancyPublicationCreateSchema.safeParse({
      requestToFillId: uuid,
      formDocumentVersionId: uuid,
      openingDate: '09/08/2026',
      closingDate: '2026-09-18',
      channels: [{ type: 'UNKNOWN', location: 'Nowhere' }],
      contactDetails: {},
    }).success,
  ).toBe(false);
});

it('requires evidence versions and permits returned-draft channel corrections', () => {
  const evidence = {
    channelType: 'CSC_FIELD_OFFICE' as const,
    location: 'CSC Field Office',
    publishedAt: '2026-09-08T00:00:00.000Z',
  };
  expect(
    vacancyPublicationCreateSchema.safeParse({
      requestToFillId: uuid,
      formDocumentVersionId: uuid,
      openingDate: '2026-09-08',
      closingDate: '2026-09-18',
      channels: [],
      positionDetails: {},
      applicationRequirements: [],
      contactDetails: {},
      evidence: [evidence],
    }).success,
  ).toBe(false);
  expect(
    vacancyPublicationCorrectionSchema.parse({
      formDocumentVersionId: uuid,
      openingDate: '2026-09-08',
      closingDate: '2026-09-18',
      channels: [{ type: 'CSC_FIELD_OFFICE', location: 'CSC Field Office' }],
      positionDetails: {},
      applicationRequirements: [],
      contactDetails: {},
      evidence: [{ ...evidence, evidenceDocumentVersionId: uuid }],
    }),
  ).toMatchObject({ channels: expect.any(Array), evidence: expect.any(Array) });
});

it('requires authority evidence for cancellation and republication', () => {
  expect(vacancyPublicationCancelSchema.safeParse({ reason: 'Material correction.' }).success).toBe(
    false,
  );
  expect(
    vacancyPublicationCloseSchema.parse({ reason: 'The declared closing date was reached.' }),
  ).toEqual({ reason: 'The declared closing date was reached.' });
  expect(
    vacancyPublicationRepublishSchema.safeParse({
      requestToFillId: uuid,
      formDocumentVersionId: uuid,
      openingDate: '2026-09-08',
      closingDate: '2026-09-18',
      channels: [],
      positionDetails: {},
      applicationRequirements: [],
      contactDetails: {},
      evidence: [],
      reason: 'Approved material correction.',
    }).success,
  ).toBe(false);
});
