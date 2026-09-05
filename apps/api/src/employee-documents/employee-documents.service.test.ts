import { expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import {
  employeeDocumentAuditWriter,
  EmployeeDocumentsService,
  EmployeeDocumentsServiceError,
} from './employee-documents.service';

const context: RequestContext = {
  requestId: 'employee-documents-service-test',
  userId: '00000000-0000-4000-8000-000000000001',
  agencyId: '00000000-0000-4000-8000-000000000002',
  membershipId: '00000000-0000-4000-8000-000000000003',
  primaryOrganizationUnitId: null,
  permissions: [],
};

function service(): EmployeeDocumentsService {
  return new EmployeeDocumentsService(employeeDocumentAuditWriter, {} as never);
}

it('rechecks personnel-document read permission at the service boundary', async () => {
  await expect(
    service().list(context, '00000000-0000-4000-8000-000000000004'),
  ).rejects.toMatchObject({ code: 'EMPLOYEE_DOCUMENT_READ_FORBIDDEN', statusCode: 403 });
});

it('rechecks upload and link permissions before touching document storage', async () => {
  const instance = service();
  const employeeId = '00000000-0000-4000-8000-000000000004';
  const linkInput = {
    documentId: '00000000-0000-4000-8000-000000000005',
    documentVersionId: '00000000-0000-4000-8000-000000000006',
    personnelClassification: 'PDS' as const,
    purpose: 'PDS_SUPPORT' as const,
  };

  await expect(
    instance.upload(context, employeeId, {
      ...linkInput,
      classification: 'CONFIDENTIAL',
      idempotencyKey: 'employee-upload',
      file: { buffer: Buffer.from('%PDF-1.7 evidence'), mimetype: 'application/pdf' },
    }),
  ).rejects.toMatchObject({ code: 'EMPLOYEE_DOCUMENT_UPLOAD_FORBIDDEN', statusCode: 403 });
  await expect(instance.link(context, employeeId, linkInput)).rejects.toMatchObject({
    code: 'EMPLOYEE_DOCUMENT_LINK_FORBIDDEN',
    statusCode: 403,
  });
});

it('uses a typed error for personnel-document workflow failures', () => {
  expect(new EmployeeDocumentsServiceError('message', 409, 'CODE')).toBeInstanceOf(Error);
});
