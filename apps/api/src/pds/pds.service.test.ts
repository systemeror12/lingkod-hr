import { expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { pdsAuditWriter, PdsService, PdsServiceError } from './pds.service';

const context: RequestContext = {
  requestId: 'pds-service-test',
  userId: '00000000-0000-4000-8000-000000000001',
  agencyId: '00000000-0000-4000-8000-000000000002',
  membershipId: '00000000-0000-4000-8000-000000000003',
  primaryOrganizationUnitId: null,
  permissions: [],
};

it('rechecks PDS permissions before opening a database transaction', async () => {
  const service = new PdsService(pdsAuditWriter, undefined as never);

  await expect(service.list(context, '00000000-0000-4000-8000-000000000004')).rejects.toMatchObject(
    {
      code: 'PDS_READ_FORBIDDEN',
      statusCode: 403,
    },
  );
  await expect(service.create(context, {})).rejects.toMatchObject({
    code: 'PDS_UPDATE_FORBIDDEN',
    statusCode: 403,
  });
});

it('uses a typed error for PDS workflow failures', () => {
  expect(new PdsServiceError('message', 409, 'CODE')).toBeInstanceOf(Error);
});
