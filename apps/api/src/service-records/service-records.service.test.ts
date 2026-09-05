import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import {
  serviceRecordAuditWriter,
  ServiceRecordServiceError,
  ServiceRecordsService,
} from './service-records.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const employeeId = '00000000-0000-4000-8000-000000000002';
const snapshotId = '00000000-0000-4000-8000-000000000003';

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'service-record-service-test',
    userId: '00000000-0000-4000-8000-000000000004',
    agencyId,
    membershipId: '00000000-0000-4000-8000-000000000005',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

function service(): ServiceRecordsService {
  return new ServiceRecordsService(serviceRecordAuditWriter, {
    resolveExternalEvidenceInTransaction: async () => ({
      ok: false,
      reason: 'DOCUMENT_NOT_FOUND',
    }),
  } as never);
}

it.each([
  ['list', () => service().list(context([])), 'SERVICE_RECORD_READ_FORBIDDEN'],
  [
    'generate',
    () => service().generate(context([]), { employeeId, asOfDate: '2026-09-05' }),
    'SERVICE_RECORD_GENERATE_FORBIDDEN',
  ],
  [
    'replace',
    () =>
      service().replace(context([]), snapshotId, {
        reason: 'Correct the issued snapshot from verified retained evidence.',
        evidenceDocumentId: '00000000-0000-4000-8000-000000000006',
        evidenceDocumentVersionId: '00000000-0000-4000-8000-000000000007',
      }),
    'SERVICE_RECORD_REPLACE_FORBIDDEN',
  ],
] as const)('rechecks the %s permission before touching the database', async (_, work, code) => {
  await expect(work()).rejects.toMatchObject({ code, statusCode: 403 });
});

it('rejects an impossible as-of date before opening a transaction', async () => {
  await expect(
    service().generate(
      context([{ code: 'personnel.service_records.generate', scopePolicy: 'AGENCY' }]),
      { employeeId, asOfDate: '2026-02-30' },
    ),
  ).rejects.toMatchObject({ code: 'SERVICE_RECORD_DATE_INVALID', statusCode: 400 });
});

it('uses a typed error for Service Record failures', () => {
  expect(new ServiceRecordServiceError('message', 409, 'CODE')).toBeInstanceOf(Error);
});
