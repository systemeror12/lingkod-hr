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
  await expect(
    service.submit(context, '00000000-0000-4000-8000-000000000004'),
  ).rejects.toMatchObject({ code: 'PDS_UPDATE_FORBIDDEN', statusCode: 403 });
  await expect(
    service.returnForCorrection(context, '00000000-0000-4000-8000-000000000004', {
      reason: 'Fix it.',
    }),
  ).rejects.toMatchObject({ code: 'PDS_UPDATE_FORBIDDEN', statusCode: 403 });
  await expect(
    service.correct(context, '00000000-0000-4000-8000-000000000004', { reason: 'Fix it.' }),
  ).rejects.toMatchObject({ code: 'PDS_UPDATE_FORBIDDEN', statusCode: 403 });
  await expect(
    service.certify(context, '00000000-0000-4000-8000-000000000004', {
      employeeCertificationAccepted: true,
    }),
  ).rejects.toMatchObject({ code: 'PDS_CERTIFY_FORBIDDEN', statusCode: 403 });
  await expect(
    service.verify(context, '00000000-0000-4000-8000-000000000004'),
  ).rejects.toMatchObject({ code: 'PDS_VERIFY_FORBIDDEN', statusCode: 403 });
  await expect(
    service.render(context, '00000000-0000-4000-8000-000000000004'),
  ).rejects.toMatchObject({ code: 'PDS_RENDER_FORBIDDEN', statusCode: 403 });
});

it('uses a typed error for PDS workflow failures', () => {
  expect(new PdsServiceError('message', 409, 'CODE', { field: 'message' })).toMatchObject({
    fields: { field: 'message' },
  });
});
