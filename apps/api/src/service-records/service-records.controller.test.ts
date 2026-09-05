import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it, vi } from 'vitest';
import { ServiceRecordsController } from './service-records.controller';

const agencyId = '00000000-0000-4000-8000-000000000001';
const snapshotId = '00000000-0000-4000-8000-000000000002';
const context: RequestContext = {
  requestId: 'service-record-controller-test',
  userId: '00000000-0000-4000-8000-000000000003',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000004',
  primaryOrganizationUnitId: null,
  permissions: [],
};

function serviceMock() {
  return { list: vi.fn(), generate: vi.fn(), findById: vi.fn(), replace: vi.fn() };
}

it('treats a foreign Agency Service Record register as absent', async () => {
  const service = serviceMock();
  const controller = new ServiceRecordsController(service as never);
  await expect(
    controller.list('00000000-0000-4000-8000-000000000009', context),
  ).rejects.toMatchObject({
    status: 404,
    response: { error: { code: 'SERVICE_RECORD_NOT_FOUND' } },
  });
  expect(service.list).not.toHaveBeenCalled();
});

it('returns the same immutable representation through structured and printable routes', async () => {
  const service = serviceMock();
  const snapshot = { label: 'Printable System View', serviceSegments: [] };
  service.findById.mockResolvedValue({ id: snapshotId, snapshot });
  const controller = new ServiceRecordsController(service as never);

  await expect(controller.structured(agencyId, snapshotId, context)).resolves.toBe(snapshot);
  await expect(controller.printable(agencyId, snapshotId, context)).resolves.toBe(snapshot);
  expect(service.findById).toHaveBeenNthCalledWith(1, context, snapshotId, 'STRUCTURED');
  expect(service.findById).toHaveBeenNthCalledWith(2, context, snapshotId, 'PRINTABLE');
});

it('rejects malformed generation input before calling the service', async () => {
  const service = serviceMock();
  const controller = new ServiceRecordsController(service as never);
  await expect(
    controller.generate(agencyId, { employeeId: 'bad', asOfDate: '2026-02-30' }, context),
  ).rejects.toMatchObject({ status: 400 });
  expect(service.generate).not.toHaveBeenCalled();
});
