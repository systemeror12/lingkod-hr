import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import type { DocumentSummary } from './documents.service';
import { DocumentsController } from './documents.controller';

const agencyId = '00000000-0000-4000-8000-000000000001';
const documentId = '00000000-0000-4000-8000-000000000002';

const context: RequestContext = {
  requestId: 'documents-controller-test',
  userId: '00000000-0000-4000-8000-000000000003',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000004',
  primaryOrganizationUnitId: null,
  permissions: [{ code: 'documents.evidence.create', scopePolicy: 'AGENCY' }],
};

const document: DocumentSummary = {
  id: documentId,
  documentNo: 'SA-001',
  documentType: 'STAFFING_AUTHORITY',
  classification: 'CONFIDENTIAL',
  status: 'DRAFT',
  createdAt: '2026-08-17T00:00:00.000Z',
  currentVersion: null,
};

const file = { buffer: Buffer.from('%PDF-1.7 evidence'), mimetype: 'application/pdf' };

it('passes the multipart upload and idempotency key through the public controller boundary', async () => {
  const service = { create: vi.fn().mockResolvedValue(document) };
  const controller = new DocumentsController(service as never);

  await expect(
    controller.create(
      agencyId,
      { documentNo: 'SA-001', documentType: 'STAFFING_AUTHORITY', classification: 'CONFIDENTIAL' },
      file,
      'upload-1',
      context,
    ),
  ).resolves.toMatchObject({ id: documentId, currentVersion: null });
  expect(service.create).toHaveBeenCalledWith(context, {
    documentNo: 'SA-001',
    documentType: 'STAFFING_AUTHORITY',
    classification: 'CONFIDENTIAL',
    idempotencyKey: 'upload-1',
    file,
  });
});

it('rejects an upload without an idempotency key before reaching the service', async () => {
  const service = { create: vi.fn() };
  const controller = new DocumentsController(service as never);

  await expect(
    controller.create(
      agencyId,
      { documentType: 'STAFFING_AUTHORITY', classification: 'CONFIDENTIAL' },
      file,
      undefined,
      context,
    ),
  ).rejects.toMatchObject({ status: 400 });
  expect(service.create).not.toHaveBeenCalled();
});

it('treats a foreign Agency document as absent at the API boundary', async () => {
  const service = { findById: vi.fn() };
  const controller = new DocumentsController(service as never);

  await expect(
    controller.findById('00000000-0000-4000-8000-000000000099', documentId, context),
  ).rejects.toMatchObject({
    status: 404,
  });
  expect(service.findById).not.toHaveBeenCalled();
});
