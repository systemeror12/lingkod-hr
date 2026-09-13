import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import { AssumedAppointmentActivation } from './assumed-appointment-activation';

const context: RequestContext = {
  requestId: 'assumed-appointment-activation-test',
  userId: '00000000-0000-4000-8000-000000000001',
  agencyId: '00000000-0000-4000-8000-000000000002',
  membershipId: '00000000-0000-4000-8000-000000000003',
  primaryOrganizationUnitId: null,
  permissions: [],
};

it('rejects activation before opening a transaction when permission is absent', async () => {
  const activation = new AssumedAppointmentActivation(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  await expect(
    activation.execute({
      context,
      appointmentId: '00000000-0000-4000-8000-000000000004',
      input: { employeeId: '00000000-0000-4000-8000-000000000005' },
    }),
  ).rejects.toMatchObject({
    code: 'APPOINTMENT_SERVICE_ACTIVATE_FORBIDDEN',
    statusCode: 403,
  });
});
