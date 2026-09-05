import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { EmployeeDocumentsController } from './employee-documents.controller';
import type { EmployeeDocumentSummary } from './employee-documents.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const employeeId = '00000000-0000-4000-8000-000000000002';
const linkId = '00000000-0000-4000-8000-000000000003';
const context: RequestContext = {
  requestId: 'employee-documents-controller-test',
  userId: '00000000-0000-4000-8000-000000000004',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000005',
  primaryOrganizationUnitId: null,
  permissions: [{ code: 'personnel.documents.classify', scopePolicy: 'AGENCY' }],
};

const summary: EmployeeDocumentSummary = {
  id: linkId,
  employeeId,
  documentId: '00000000-0000-4000-8000-000000000006',
  documentVersionId: '00000000-0000-4000-8000-000000000007',
  documentNo: 'PDS-001',
  documentType: 'PDS',
  classification: 'CONFIDENTIAL',
  status: 'ISSUED',
  personnelClassification: 'PDS',
  purpose: 'PDS_SUPPORT',
  releaseState: 'RELEASED',
  versionNo: 2,
  mimeType: 'application/pdf',
  sizeBytes: 12,
  issuedAt: '2026-08-30T00:00:00.000Z',
  createdAt: '2026-08-30T00:00:00.000Z',
};

it('forwards exact-version HR links through the protected controller boundary', async () => {
  const service = { link: vi.fn().mockResolvedValue(summary) };
  const controller = new EmployeeDocumentsController(service as never);
  const input = {
    documentId: summary.documentId,
    documentVersionId: summary.documentVersionId,
    personnelClassification: 'PDS' as const,
    purpose: 'PDS_SUPPORT' as const,
    releaseState: 'RELEASED' as const,
  };

  await expect(controller.link(agencyId, employeeId, input, context)).resolves.toMatchObject({
    id: linkId,
    documentVersionId: summary.documentVersionId,
  });
  expect(service.link).toHaveBeenCalledWith(context, employeeId, input);
});

it('rejects a foreign Agency before calling the service', async () => {
  const service = { list: vi.fn() };
  const controller = new EmployeeDocumentsController(service as never);

  await expect(
    controller.list('00000000-0000-4000-8000-000000000099', employeeId, context),
  ).rejects.toMatchObject({ status: 404 });
  expect(service.list).not.toHaveBeenCalled();
});

it('forwards an own-record multipart upload and idempotency key', async () => {
  const service = { upload: vi.fn().mockResolvedValue(summary) };
  const controller = new EmployeeDocumentsController(service as never);
  const file = { buffer: Buffer.from('%PDF-1.7 evidence'), mimetype: 'application/pdf' };
  const body = {
    classification: 'CONFIDENTIAL',
    personnelClassification: 'PDS',
    purpose: 'OWN_RECORD_UPLOAD',
  };

  await expect(
    controller.upload(agencyId, employeeId, body, file, 'upload-1', context),
  ).resolves.toMatchObject({
    id: linkId,
  });
  expect(service.upload).toHaveBeenCalledWith(context, employeeId, {
    ...body,
    idempotencyKey: 'upload-1',
    file,
  });
});
