import { expect, it } from 'vitest';
import { documentCreateSchema, documentVersionCreateSchema } from './documents.schemas';

it('accepts the minimum External Evidence metadata contract', () => {
  expect(
    documentCreateSchema.parse({
      documentNo: 'SA-2026-001',
      documentType: 'STAFFING_AUTHORITY',
      classification: 'CONFIDENTIAL',
    }),
  ).toEqual({
    documentNo: 'SA-2026-001',
    documentType: 'STAFFING_AUTHORITY',
    classification: 'CONFIDENTIAL',
  });
  expect(documentVersionCreateSchema.parse({})).toEqual({});
});

it('rejects unsupported classification and unknown metadata', () => {
  expect(
    documentCreateSchema.safeParse({
      documentType: 'STAFFING_AUTHORITY',
      classification: 'SECRET',
    }).success,
  ).toBe(false);
  expect(
    documentCreateSchema.safeParse({
      documentType: 'STAFFING_AUTHORITY',
      classification: 'CONFIDENTIAL',
      storageKey: 'agencies/forged/key',
    }).success,
  ).toBe(false);
});
