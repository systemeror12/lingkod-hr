import { expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import {
  qualificationStandardAuditWriter,
  QualificationStandardServiceError,
  QualificationStandardsService,
} from './qualification-standards.service';

const documentsService = {} as ConstructorParameters<typeof QualificationStandardsService>[1];
const agencyId = '00000000-0000-4000-8000-000000000001';

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'qualification-standard-service-test',
    userId: '00000000-0000-4000-8000-000000000002',
    agencyId,
    membershipId: '00000000-0000-4000-8000-000000000003',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

it('rechecks permissions before opening a Qualification Standard workflow', async () => {
  const service = new QualificationStandardsService(
    qualificationStandardAuditWriter,
    documentsService,
  );

  await expect(
    service.create(context([]), {
      code: 'QS-001',
      name: 'Administrative Services',
      effectiveDate: '2026-08-15',
    }),
  ).rejects.toMatchObject({
    code: 'QUALIFICATION_STANDARD_CREATE_FORBIDDEN',
    statusCode: 403,
  });
});

it('rejects invalid dates and nonnegative requirement violations at the service boundary', async () => {
  const service = new QualificationStandardsService(
    qualificationStandardAuditWriter,
    documentsService,
  );
  const createContext = context([
    { code: 'qualification.standards.create', scopePolicy: 'AGENCY' },
  ]);

  await expect(
    service.create(createContext, {
      code: 'QS-002',
      name: 'Administrative Services',
      effectiveDate: '15 August 2026',
    }),
  ).rejects.toMatchObject({
    code: 'QUALIFICATION_STANDARD_DATE_INVALID',
    statusCode: 400,
  });

  await expect(
    service.create(createContext, {
      code: 'QS-003',
      name: 'Administrative Services',
      effectiveDate: '2026-08-15',
      trainingHoursRequired: -1,
    }),
  ).rejects.toMatchObject({
    code: 'QUALIFICATION_STANDARD_REQUIREMENT_INVALID',
    statusCode: 400,
  });
});

it('exposes workflow failures as typed service errors', () => {
  expect(new QualificationStandardServiceError('message', 409, 'CODE')).toBeInstanceOf(Error);
});
