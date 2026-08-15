import { expect, it } from 'vitest';
import { organizationUnitCreateSchema } from './organization.schemas';

it('accepts the minimum Draft Organization Unit contract', () => {
  expect(
    organizationUnitCreateSchema.parse({
      officialName: 'Records Management Division',
      code: 'RMD',
      unitType: 'DIVISION',
      effectiveDate: '2026-08-15',
    }),
  ).toEqual({
    officialName: 'Records Management Division',
    code: 'RMD',
    unitType: 'DIVISION',
    effectiveDate: '2026-08-15',
  });
});

it('rejects incomplete, unsupported, and non-date input', () => {
  expect(
    organizationUnitCreateSchema.safeParse({
      officialName: ' ',
      code: '',
      unitType: 'TEAM',
      effectiveDate: '15 August 2026',
    }).success,
  ).toBe(false);
  expect(
    organizationUnitCreateSchema.safeParse({
      officialName: 'Records Management Division',
      code: 'RMD',
      unitType: 'DIVISION',
      effectiveDate: '2026-08-15',
      parentUnitId: '00000000-0000-4000-8000-000000000001',
    }).success,
  ).toBe(false);
});
