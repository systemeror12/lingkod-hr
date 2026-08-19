import { expect, it } from 'vitest';
import {
  organizationIdempotencyKeySchema,
  organizationHierarchyQuerySchema,
  organizationUnitActivationSchema,
  organizationUnitCreateSchema,
} from './organization.schemas';

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

it('accepts the hierarchy and activation contracts', () => {
  expect(organizationHierarchyQuerySchema.parse({ asOf: '2026-08-20' })).toEqual({
    asOf: '2026-08-20',
  });
  expect(
    organizationHierarchyQuerySchema.parse({
      asOf: '2026-08-20',
      parentForUnitId: '00000000-0000-4000-8000-000000000001',
    }),
  ).toEqual({
    asOf: '2026-08-20',
    parentForUnitId: '00000000-0000-4000-8000-000000000001',
  });
  expect(
    organizationUnitActivationSchema.parse({
      parentUnitId: '00000000-0000-4000-8000-000000000001',
      reason: 'Approved reporting placement',
    }),
  ).toEqual({
    parentUnitId: '00000000-0000-4000-8000-000000000001',
    reason: 'Approved reporting placement',
  });
  expect(
    organizationUnitActivationSchema.parse({
      parentUnitId: null,
      reason: 'Approved as an Agency root',
    }),
  ).toEqual({ parentUnitId: null, reason: 'Approved as an Agency root' });
  expect(organizationIdempotencyKeySchema.parse(' activate-unit-1 ')).toBe('activate-unit-1');
});

it('rejects invalid hierarchy dates and incomplete activation input', () => {
  expect(organizationHierarchyQuerySchema.safeParse({ asOf: '20 August 2026' }).success).toBe(
    false,
  );
  expect(
    organizationUnitActivationSchema.safeParse({
      parentUnitId: 'foreign-key-shaped-but-not-a-uuid',
      reason: ' ',
    }).success,
  ).toBe(false);
  expect(organizationIdempotencyKeySchema.safeParse(' ').success).toBe(false);
});
