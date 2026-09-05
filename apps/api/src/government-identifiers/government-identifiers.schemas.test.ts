import { expect, it } from 'vitest';
import {
  governmentIdentifierCreateSchema,
  governmentIdentifierInvalidateSchema,
  governmentIdentifierReplaceSchema,
  governmentIdentifierRevealSchema,
} from './government-identifiers.schemas';

it('accepts exactly the identifier types in the approved Revised 2026 PDS contract', () => {
  for (const identifierType of ['UMID', 'PAGIBIG', 'PHILHEALTH', 'PHILSYS_PCN', 'TIN']) {
    expect(
      governmentIdentifierCreateSchema.parse({
        identifierType,
        value: ' 12345678901 ',
        effectiveFrom: '2026-09-01',
        verifiedAt: '2026-09-01T08:00:00.000Z',
        evidenceDocumentId: '00000000-0000-4000-8000-000000000001',
        evidenceDocumentVersionId: '00000000-0000-4000-8000-000000000002',
      }),
    ).toMatchObject({ identifierType, value: '12345678901' });
  }
  for (const identifierType of ['GSIS', 'OTHER']) {
    expect(
      governmentIdentifierCreateSchema.safeParse({ identifierType, value: '12345678901' }).success,
    ).toBe(false);
  }
});

it('rejects unsupported types, partial evidence, and extra fields', () => {
  expect(
    governmentIdentifierCreateSchema.safeParse({
      identifierType: 'SSS',
      value: '123',
      effectiveFrom: '2026-09-01',
    }).success,
  ).toBe(false);
  expect(
    governmentIdentifierCreateSchema.safeParse({
      identifierType: 'TIN',
      value: '123',
      effectiveFrom: '2026-09-01',
      evidenceDocumentId: '00000000-0000-4000-8000-000000000001',
    }).success,
  ).toBe(false);
  expect(
    governmentIdentifierCreateSchema.safeParse({
      identifierType: 'TIN',
      value: '123',
      effectiveFrom: '2026-09-01',
      status: 'ACTIVE',
    }).success,
  ).toBe(false);
  expect(
    governmentIdentifierCreateSchema.safeParse({
      identifierType: 'TIN',
      value: '123\u0000',
      effectiveFrom: '2026-09-01',
    }).success,
  ).toBe(false);
});

it('requires reasons for replacement and invalidation', () => {
  expect(
    governmentIdentifierReplaceSchema.safeParse({
      identifierType: 'PHILHEALTH',
      value: '123',
      effectiveFrom: '2026-09-01',
      reason: 'Corrected member number.',
    }).success,
  ).toBe(true);
  expect(
    governmentIdentifierReplaceSchema.safeParse({
      identifierType: 'PHILHEALTH',
      value: '123',
      effectiveFrom: '2026-09-01',
      reason: '',
    }).success,
  ).toBe(false);
  expect(
    governmentIdentifierInvalidateSchema.safeParse({
      reason: 'Invalid document.',
      effectiveTo: '2026-09-02',
    }).success,
  ).toBe(true);
  expect(
    governmentIdentifierRevealSchema.safeParse({ reason: 'Payroll validation.' }).success,
  ).toBe(true);
  expect(governmentIdentifierRevealSchema.safeParse({}).success).toBe(false);
  expect(
    governmentIdentifierRevealSchema.safeParse({ reason: 'Payroll\u0001 validation.' }).success,
  ).toBe(false);
});
