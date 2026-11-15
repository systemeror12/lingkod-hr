import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators';
import { AttendanceDeficitChargesController } from './attendance-deficit-charges.controller';
import { AttendanceDeficitChargeServiceError } from './attendance-deficit-charges.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const publicationId = '00000000-0000-4000-8000-000000000004';
const context: RequestContext = {
  requestId: 'deficit-charges-api-test',
  userId: '00000000-0000-4000-8000-000000000002',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000003',
  primaryOrganizationUnitId: null,
  permissions: [{ code: 'leave.deficit_charges.read', scopePolicy: 'AGENCY' }],
};

it('guards the read and the rerun with their own permissions', () => {
  const prototype = AttendanceDeficitChargesController.prototype;
  expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, prototype.read)).toEqual([
    'leave.deficit_charges.read',
  ]);
  expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, prototype.run)).toEqual([
    'leave.deficit_charges.run',
  ]);
});

it('reads a publication of the acting Agency and refuses another Agency or a bad id', async () => {
  const report = { attendancePayrollPublicationId: publicationId, employees: [] };
  const service = { read: vi.fn().mockResolvedValue(report), run: vi.fn() };
  const controller = new AttendanceDeficitChargesController(service as never);

  await expect(controller.read(agencyId, publicationId, context)).resolves.toBe(report);
  expect(service.read).toHaveBeenCalledWith(context, publicationId);
  await expect(
    controller.read('00000000-0000-4000-8000-000000000009', publicationId, context),
  ).rejects.toMatchObject({ status: 404 });
  await expect(controller.run(agencyId, 'not-a-uuid', context)).rejects.toMatchObject({
    status: 404,
  });
  expect(service.run).not.toHaveBeenCalled();
});

it('maps a service refusal to its status and code', async () => {
  const service = {
    read: vi.fn(),
    run: vi
      .fn()
      .mockRejectedValue(
        new AttendanceDeficitChargeServiceError('Needs the run permission.', 403, 'FORBIDDEN'),
      ),
  };
  const controller = new AttendanceDeficitChargesController(service as never);
  await expect(controller.run(agencyId, publicationId, context)).rejects.toMatchObject({
    status: 403,
    response: { error: { code: 'FORBIDDEN' } },
  });
});
