import { expect, it } from 'vitest';
import {
  organizationIdempotencyKeySchema,
  organizationHierarchyQuerySchema,
  organizationHistoryQuerySchema,
  organizationUnitActivationSchema,
  organizationUnitCreateSchema,
  organizationUnitCorrectionSchema,
  organizationUnitDraftUpdateSchema,
  organizationUnitSuccessorActivationSchema,
  organizationUnitTransitionSchema,
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

it('accepts effective-dated changes, lifecycle transitions, and correction evidence', () => {
  const parentUnitId = '00000000-0000-4000-8000-000000000001';
  expect(organizationHistoryQuerySchema.parse({ asOf: '2026-08-21' })).toEqual({
    asOf: '2026-08-21',
  });
  expect(
    organizationUnitDraftUpdateSchema.parse({
      officialName: 'Records and Information Division',
      parentUnitId,
      costCenterCode: 'CC-100',
      responsibilityCenterCode: 'RC-200',
      effectiveDate: '2026-08-21',
    }),
  ).toMatchObject({ effectiveDate: '2026-08-21' });
  expect(
    organizationUnitSuccessorActivationSchema.parse({
      reason: 'Approved prospective reorganization',
    }),
  ).toEqual({ reason: 'Approved prospective reorganization' });
  expect(
    organizationUnitTransitionSchema.parse({
      effectiveDate: '2026-08-21',
      reason: 'Office temporarily closed',
      migrationPlan: 'Reassign active memberships through HRMO review.',
    }),
  ).toMatchObject({ migrationPlan: expect.any(String) });
  expect(
    organizationUnitCorrectionSchema.parse({
      officialName: 'Corrected Records Division',
      parentUnitId: null,
      costCenterCode: null,
      responsibilityCenterCode: null,
      reason: 'Corrected an official spelling error',
    }),
  ).toMatchObject({ reason: 'Corrected an official spelling error' });
});

it('rejects lifecycle input without dates or reasons at the schema boundary', () => {
  expect(
    organizationUnitTransitionSchema.safeParse({ effectiveDate: '2026-08-21', reason: ' ' })
      .success,
  ).toBe(false);
  expect(
    organizationUnitDraftUpdateSchema.safeParse({
      officialName: 'Records Division',
      parentUnitId: null,
      costCenterCode: null,
      responsibilityCenterCode: null,
      effectiveDate: '21 August 2026',
    }).success,
  ).toBe(false);
  expect(
    organizationUnitCorrectionSchema.safeParse({
      officialName: 'Corrected Records Division',
      parentUnitId: null,
      costCenterCode: null,
      responsibilityCenterCode: null,
      reason: '',
    }).success,
  ).toBe(false);
});
