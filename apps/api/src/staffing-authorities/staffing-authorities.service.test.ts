import { expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import {
  staffingAuthorityAuditWriter,
  StaffingAuthorityService,
  StaffingAuthorityServiceError,
} from './staffing-authorities.service';

const documentsService = {} as ConstructorParameters<typeof StaffingAuthorityService>[1];

const agencyId = '00000000-0000-4000-8000-000000000001';

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'staffing-authority-service-test',
    userId: '00000000-0000-4000-8000-000000000002',
    agencyId,
    membershipId: '00000000-0000-4000-8000-000000000003',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

it('rechecks the required permission before touching the database', async () => {
  const service = new StaffingAuthorityService(staffingAuthorityAuditWriter, documentsService);

  await expect(
    service.create(context([]), {
      authorityType: 'LAW',
      referenceNo: 'LAW-001',
      issuedDate: '2026-08-01',
      effectiveDate: '2026-08-15',
    }),
  ).rejects.toMatchObject({
    code: 'STAFFING_AUTHORITY_CREATE_FORBIDDEN',
    statusCode: 403,
  });
});

it('validates dates and evidence permissions at the service boundary', async () => {
  const service = new StaffingAuthorityService(staffingAuthorityAuditWriter, documentsService);
  const createContext = context([{ code: 'staffing.authorities.create', scopePolicy: 'AGENCY' }]);

  await expect(
    service.create(createContext, {
      authorityType: 'LAW',
      referenceNo: 'LAW-002',
      issuedDate: '15 August 2026',
      effectiveDate: '2026-08-15',
    }),
  ).rejects.toMatchObject({ code: 'STAFFING_AUTHORITY_DATE_INVALID', statusCode: 400 });

  await expect(
    service.validateEvidence(
      context([{ code: 'staffing.authorities.evidence.validate', scopePolicy: 'AGENCY' }]),
      '00000000-0000-4000-8000-000000000004',
      {
        documentId: '00000000-0000-4000-8000-000000000005',
        validationReason: 'Reviewed source.',
      },
    ),
  ).rejects.toMatchObject({ code: 'STAFFING_AUTHORITY_EVIDENCE_FORBIDDEN', statusCode: 403 });
});

it('uses a safe error type for authority workflow failures', () => {
  expect(new StaffingAuthorityServiceError('message', 409, 'CODE')).toBeInstanceOf(Error);
});
