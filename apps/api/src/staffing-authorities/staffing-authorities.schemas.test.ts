import { expect, it } from 'vitest';
import {
  staffingAuthorityActivationSchema,
  staffingAuthorityDraftSchema,
  staffingAuthorityEvidenceSchema,
  staffingAuthorityRevocationSchema,
  staffingAuthoritySupersessionSchema,
} from './staffing-authorities.schemas';

const id = '00000000-0000-4000-8000-000000000001';

it('accepts a supported Draft Staffing Authority contract', () => {
  expect(
    staffingAuthorityDraftSchema.parse({
      authorityType: 'DBM_APPROVAL',
      referenceNo: 'DBM-ABC-2026-001',
      issuedDate: '2026-08-01',
      effectiveDate: '2026-08-15',
      sourceMetadata: { issuer: 'DBM', locator: 'https://example.test/authority/1' },
    }),
  ).toMatchObject({ authorityType: 'DBM_APPROVAL', referenceNo: 'DBM-ABC-2026-001' });
});

it('rejects unsupported, incomplete, non-date, and unknown Draft fields', () => {
  expect(
    staffingAuthorityDraftSchema.safeParse({
      authorityType: 'MEMO',
      referenceNo: ' ',
      issuedDate: '01 August 2026',
      effectiveDate: '2026-08-15',
    }).success,
  ).toBe(false);
  expect(
    staffingAuthorityDraftSchema.safeParse({
      authorityType: 'LAW',
      referenceNo: 'LAW-1',
      issuedDate: '2026-08-01',
      effectiveDate: '2026-08-15',
      unexpected: true,
    }).success,
  ).toBe(false);
});

it('requires reasoned evidence and lifecycle transition input', () => {
  expect(
    staffingAuthorityEvidenceSchema.safeParse({
      documentId: id,
      validationReason: 'Reviewed source.',
    }).success,
  ).toBe(true);
  expect(staffingAuthorityActivationSchema.safeParse({ reason: 'Approved by HRMO.' }).success).toBe(
    true,
  );
  expect(
    staffingAuthoritySupersessionSchema.safeParse({ successorId: id, reason: 'New issuance.' })
      .success,
  ).toBe(true);
  expect(
    staffingAuthorityRevocationSchema.safeParse({
      effectiveDate: '2026-09-01',
      reason: 'Official withdrawal.',
      documentId: id,
    }).success,
  ).toBe(true);
  expect(staffingAuthorityActivationSchema.safeParse({ reason: ' ' }).success).toBe(false);
});
