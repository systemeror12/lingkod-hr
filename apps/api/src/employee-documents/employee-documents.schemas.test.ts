import { expect, it } from 'vitest';
import {
  employeeDocumentLinkSchema,
  employeeDocumentUploadSchema,
} from './employee-documents.schemas';

it('accepts a controlled exact-version personnel document link', () => {
  expect(
    employeeDocumentLinkSchema.parse({
      documentId: '00000000-0000-4000-8000-000000000001',
      documentVersionId: '00000000-0000-4000-8000-000000000002',
      personnelClassification: 'PDS',
      purpose: 'PDS_SUPPORT',
      releaseState: 'RELEASED',
    }),
  ).toMatchObject({ personnelClassification: 'PDS', purpose: 'PDS_SUPPORT' });
});

it('rejects unsupported personnel classifications and extra fields', () => {
  expect(
    employeeDocumentLinkSchema.safeParse({
      documentId: '00000000-0000-4000-8000-000000000001',
      documentVersionId: '00000000-0000-4000-8000-000000000002',
      personnelClassification: 'UNCONTROLLED',
      purpose: 'PDS_SUPPORT',
      extra: 'not accepted',
    }).success,
  ).toBe(false);
});

it('requires the shared Document classification for an employee upload', () => {
  expect(
    employeeDocumentUploadSchema.safeParse({
      classification: 'CONFIDENTIAL',
      personnelClassification: 'MEDICAL',
      purpose: 'OWN_RECORD_UPLOAD',
    }).success,
  ).toBe(true);
  expect(
    employeeDocumentUploadSchema.safeParse({
      classification: 'CONFIDENTIAL',
      personnelClassification: 'MEDICAL',
      purpose: 'OWN_RECORD_UPLOAD',
      documentType: 'MEDICAL_CERTIFICATE',
    }).success,
  ).toBe(false);
});
