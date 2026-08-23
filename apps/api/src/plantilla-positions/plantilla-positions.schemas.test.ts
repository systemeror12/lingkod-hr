import { expect, it } from 'vitest';
import {
  plantillaPositionCorrectionSchema,
  plantillaPositionCreateSchema,
  plantillaPositionDraftUpdateSchema,
  plantillaPositionEvidenceLinkSchema,
  plantillaPositionEvidenceRemovalSchema,
  plantillaPositionIdempotencyKeySchema,
  plantillaPositionTransitionSchema,
} from './plantilla-positions.schemas';

const organizationUnitId = '00000000-0000-4000-8000-000000000001';
const qualificationStandardVersionId = '00000000-0000-4000-8000-000000000002';
const staffingAuthorityId = '00000000-0000-4000-8000-000000000003';

const positionInput = {
  itemNumber: 'HRM-000143',
  title: 'Human Resource Management Officer III',
  parentheticalTitle: 'Records and Staffing',
  salaryGrade: 18,
  organizationUnitId,
  fundingSource: 'General Appropriations Act',
  employmentCategory: 'PLANTILLA',
  qualificationStandardVersionId,
  staffingAuthorityId,
  effectiveDate: '2026-09-01',
};
const versionInput = Object.fromEntries(
  Object.entries(positionInput).filter(([key]) => key !== 'itemNumber'),
);

it('accepts the complete proposed Plantilla Position contract', () => {
  expect(plantillaPositionCreateSchema.parse(positionInput)).toMatchObject(positionInput);
});

it('rejects malformed dates, invalid grades, unsupported categories, and unknown fields', () => {
  expect(
    plantillaPositionCreateSchema.safeParse({
      ...positionInput,
      effectiveDate: '01 September 2026',
      salaryGrade: 0,
      employmentCategory: 'CAREER',
      unexpected: true,
    }).success,
  ).toBe(false);
});

it('keeps draft updates and factual corrections reasoned at the API boundary', () => {
  expect(
    plantillaPositionDraftUpdateSchema.safeParse({
      ...versionInput,
      rowVersion: 2,
    }).success,
  ).toBe(true);
  expect(
    plantillaPositionCorrectionSchema.safeParse({
      ...Object.fromEntries(
        Object.entries(versionInput).filter(([key]) => key !== 'effectiveDate'),
      ),
      reason: 'Corrected the official title before authorization.',
    }).success,
  ).toBe(true);
  expect(
    plantillaPositionCorrectionSchema.safeParse({
      ...Object.fromEntries(
        Object.entries(versionInput).filter(([key]) => key !== 'effectiveDate'),
      ),
      reason: ' ',
    }).success,
  ).toBe(false);
});

it('keeps evidence purpose separate from Document file metadata', () => {
  expect(
    plantillaPositionEvidenceLinkSchema.parse({
      documentId: '00000000-0000-4000-8000-000000000004',
      purpose: 'RECLASSIFICATION',
      effectiveDate: '2026-09-01',
    }),
  ).toMatchObject({ purpose: 'RECLASSIFICATION' });
  expect(
    plantillaPositionEvidenceLinkSchema.safeParse({
      documentId: '00000000-0000-4000-8000-000000000004',
      purpose: 'application/pdf',
    }).success,
  ).toBe(false);
  expect(plantillaPositionEvidenceRemovalSchema.safeParse({ reason: ' ' }).success).toBe(false);
});

it('requires a dated reason for lifecycle transitions', () => {
  expect(
    plantillaPositionTransitionSchema.parse({
      effectiveDate: '2026-09-01',
      reason: 'The approved lifecycle decision is effective.',
    }),
  ).toEqual({
    effectiveDate: '2026-09-01',
    reason: 'The approved lifecycle decision is effective.',
  });
  expect(
    plantillaPositionTransitionSchema.safeParse({
      effectiveDate: '2026-09-01',
      reason: ' ',
    }).success,
  ).toBe(false);
});

it('bounds optional lifecycle idempotency keys', () => {
  expect(plantillaPositionIdempotencyKeySchema.parse(' transition-1 ')).toBe('transition-1');
  expect(plantillaPositionIdempotencyKeySchema.safeParse(' ').success).toBe(false);
});
