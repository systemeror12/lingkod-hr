import { expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import {
  plantillaPositionAuditWriter,
  PlantillaPositionServiceError,
  PlantillaPositionsService,
} from './plantilla-positions.service';

const documentsService = {} as ConstructorParameters<typeof PlantillaPositionsService>[1];
const agencyId = '00000000-0000-4000-8000-000000000001';

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'plantilla-position-service-test',
    userId: '00000000-0000-4000-8000-000000000002',
    agencyId,
    membershipId: '00000000-0000-4000-8000-000000000003',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

const createInput = {
  itemNumber: 'HRM-000143',
  title: 'Human Resource Management Officer III',
  salaryGrade: 18,
  organizationUnitId: '00000000-0000-4000-8000-000000000004',
  fundingSource: 'General Appropriations Act',
  employmentCategory: 'PLANTILLA' as const,
  qualificationStandardVersionId: '00000000-0000-4000-8000-000000000005',
  staffingAuthorityId: '00000000-0000-4000-8000-000000000006',
  effectiveDate: '2026-08-23',
};

it('rechecks the create permission before opening a Plantilla Position workflow', async () => {
  const service = new PlantillaPositionsService(plantillaPositionAuditWriter, documentsService);

  await expect(service.create(context([]), createInput)).rejects.toMatchObject({
    code: 'PLANTILLA_POSITION_CREATE_FORBIDDEN',
    statusCode: 403,
  });
});

it('rejects invalid effective dates at the service boundary', async () => {
  const service = new PlantillaPositionsService(plantillaPositionAuditWriter, documentsService);

  await expect(
    service.create(context([{ code: 'positions.items.create', scopePolicy: 'AGENCY' }]), {
      ...createInput,
      effectiveDate: '23 August 2026',
    }),
  ).rejects.toMatchObject({ code: 'PLANTILLA_POSITION_DATE_INVALID', statusCode: 400 });
});

it('requires the separate history permission for version inspection', async () => {
  const service = new PlantillaPositionsService(plantillaPositionAuditWriter, documentsService);

  await expect(
    service.findById(context([{ code: 'positions.items.read', scopePolicy: 'AGENCY' }]), agencyId),
  ).rejects.toMatchObject({
    code: 'PLANTILLA_POSITION_HISTORY_READ_FORBIDDEN',
    statusCode: 403,
  });
});

it('uses a typed error for catalog workflow failures', () => {
  expect(new PlantillaPositionServiceError('message', 409, 'CODE')).toBeInstanceOf(Error);
});
