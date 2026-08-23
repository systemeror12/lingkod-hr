import { expect, it } from 'vitest';
import {
  qualificationStandardActivationSchema,
  qualificationStandardCreateSchema,
  qualificationStandardDraftUpdateSchema,
  qualificationStandardEvidenceSchema,
} from './qualification-standards.schemas';

const documentId = '00000000-0000-4000-8000-000000000001';

it('accepts the structured Draft Qualification Standard contract', () => {
  expect(
    qualificationStandardCreateSchema.parse({
      code: 'QS-001',
      name: 'Administrative Services',
      effectiveDate: '2026-08-15',
      trainingHoursRequired: 40,
      experienceMonthsRequired: 24,
      competencyRequirements: [{ code: 'WRITING', level: 2 }],
      licenseRequirements: [{ name: 'Professional license', required: false }],
    }),
  ).toMatchObject({
    code: 'QS-001',
    trainingHoursRequired: 40,
    competencyRequirements: [{ code: 'WRITING', level: 2 }],
  });
});

it('rejects negative requirements, malformed dates, and unknown fields', () => {
  expect(
    qualificationStandardCreateSchema.safeParse({
      code: 'QS-001',
      name: 'Administrative Services',
      effectiveDate: '15 August 2026',
      trainingHoursRequired: -1,
    }).success,
  ).toBe(false);
  expect(
    qualificationStandardDraftUpdateSchema.safeParse({
      effectiveDate: '2026-08-15',
      experienceMonthsRequired: -1,
      unexpected: true,
    }).success,
  ).toBe(false);
});

it('requires evidence and activation reasons at the API boundary', () => {
  expect(
    qualificationStandardEvidenceSchema.safeParse({
      kind: 'SOURCE',
      documentId,
      validationReason: 'Reviewed the official source.',
    }).success,
  ).toBe(true);
  expect(
    qualificationStandardActivationSchema.safeParse({ reason: 'Approved by HRMO.' }).success,
  ).toBe(true);
  expect(qualificationStandardActivationSchema.safeParse({ reason: ' ' }).success).toBe(false);
});
