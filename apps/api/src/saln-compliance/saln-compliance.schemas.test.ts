import { expect, it } from 'vitest';
import {
  salnComplianceCreateSchema,
  salnComplianceCorrectionSchema,
} from './saln-compliance.schemas';

const valid = {
  requirementReference: 'Agency memorandum 2026-04',
  filingYear: 2026,
  filingType: 'ANNUAL',
  status: 'ACKNOWLEDGED',
  submittedAt: '2026-04-30T09:00:00.000+08:00',
  repositoryReference: 'Records/2026/SALN/00042',
  acknowledgmentDocumentId: '00000000-0000-4000-8000-000000000001',
  acknowledgmentDocumentVersionId: '00000000-0000-4000-8000-000000000002',
};

it('accepts bounded SALN compliance metadata and an exact acknowledgment version', () => {
  expect(salnComplianceCreateSchema.parse(valid)).toEqual(valid);
  expect(
    salnComplianceCorrectionSchema.parse({ ...valid, reason: 'Correct the repository reference.' }),
  ).toMatchObject({ reason: 'Correct the repository reference.' });
});

it('rejects SALN contents, due dates, incomplete evidence, and inconsistent status metadata', () => {
  expect(
    salnComplianceCreateSchema.safeParse({ ...valid, declaration: { assets: [] } }).success,
  ).toBe(false);
  expect(salnComplianceCreateSchema.safeParse({ ...valid, dueDate: '2026-04-30' }).success).toBe(
    false,
  );
  expect(
    salnComplianceCreateSchema.safeParse({
      ...valid,
      acknowledgmentDocumentVersionId: undefined,
    }).success,
  ).toBe(false);
  expect(
    salnComplianceCreateSchema.safeParse({
      ...valid,
      status: 'NOT_SUBMITTED',
      submittedAt: valid.submittedAt,
    }).success,
  ).toBe(false);
});
