import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { EmployeesController } from './employees.controller';
import { EmployeeDetailDto } from './employees.dto';
import { EmployeeServiceError, type EmployeeSummary } from './employees.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const otherAgencyId = '00000000-0000-4000-8000-000000000002';
const employeeId = '00000000-0000-4000-8000-000000000003';
const linkMembershipId = '00000000-0000-4000-8000-000000000004';
const context: RequestContext = {
  requestId: 'employee-api-test',
  userId: '00000000-0000-4000-8000-000000000005',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000006',
  primaryOrganizationUnitId: null,
  permissions: [
    { code: 'personnel.employees.read', scopePolicy: 'AGENCY' },
    { code: 'personnel.employees.create', scopePolicy: 'AGENCY' },
    { code: 'personnel.employees.update', scopePolicy: 'AGENCY' },
  ],
};

const employee: EmployeeSummary = {
  id: employeeId,
  employeeNumber: 'NEDA-2026-0042',
  legalName: 'Mara Villanueva Santos',
  birthDate: '1994-05-12',
  sex: 'FEMALE',
  civilStatus: 'SINGLE',
  contactEmail: 'mara.santos@neda.gov.ph',
  serviceStatus: 'PREBOARDING',
  firstGovernmentServiceDate: null,
  agencyServiceStartDate: null,
  currentServiceSegment: null,
  membershipId: null,
  createdAt: '2026-08-31T00:00:00.000Z',
  updatedAt: '2026-08-31T00:00:00.000Z',
};

const createBody = {
  employeeNumber: 'NEDA-2026-0042',
  legalName: 'Mara Villanueva Santos',
  birthDate: '1994-05-12',
  sex: 'FEMALE',
  civilStatus: 'SINGLE',
  contactEmail: 'mara.santos@neda.gov.ph',
};

function serviceMock() {
  return {
    list: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    linkMembership: vi.fn(),
    unlinkMembership: vi.fn(),
  };
}

it('does not disclose the directory outside the active Agency', async () => {
  const service = serviceMock();
  const controller = new EmployeesController(service as never);

  await expect(controller.list(otherAgencyId, context)).rejects.toMatchObject({
    status: 404,
    response: {
      error: { code: 'EMPLOYEE_NOT_FOUND', requestId: context.requestId },
    },
  });
  expect(service.list).not.toHaveBeenCalled();
});

it('returns the Agency directory and preserves typed service failures', async () => {
  const service = serviceMock();
  service.list.mockResolvedValue([employee]);
  const controller = new EmployeesController(service as never);

  await expect(controller.list(agencyId, context)).resolves.toEqual({
    employees: [expect.objectContaining({ id: employeeId, employeeNumber: 'NEDA-2026-0042' })],
  });
  expect(service.list).toHaveBeenCalledWith(context);

  service.create.mockRejectedValue(
    new EmployeeServiceError(
      'That Employee Number is already used in this Agency.',
      409,
      'EMPLOYEE_NUMBER_CONFLICT',
    ),
  );
  await expect(controller.create(agencyId, createBody, context)).rejects.toMatchObject({
    status: 409,
    response: {
      error: { code: 'EMPLOYEE_NUMBER_CONFLICT', requestId: context.requestId },
    },
  });
});

it('rejects malformed Employee ids and invalid link bodies', async () => {
  const service = serviceMock();
  const controller = new EmployeesController(service as never);

  await expect(controller.findById(agencyId, 'not-a-uuid', context)).rejects.toMatchObject({
    status: 404,
  });
  expect(service.findById).not.toHaveBeenCalled();

  await expect(
    controller.linkMembership(agencyId, employeeId, { email: 'mara@neda.gov.ph' }, context),
  ).rejects.toMatchObject({ status: 400 });
  expect(service.linkMembership).not.toHaveBeenCalled();
});

it('validates and forwards the controlled Membership link workflow', async () => {
  const service = serviceMock();
  const detail = { ...employee, rowVersion: 1, linkableMemberships: [] };
  service.linkMembership.mockResolvedValue(detail);
  service.unlinkMembership.mockResolvedValue(detail);
  const controller = new EmployeesController(service as never);

  await expect(
    controller.linkMembership(agencyId, employeeId, { membershipId: linkMembershipId }, context),
  ).resolves.toBeInstanceOf(EmployeeDetailDto);
  expect(service.linkMembership).toHaveBeenCalledWith(context, employeeId, linkMembershipId);

  await expect(controller.unlinkMembership(agencyId, employeeId, context)).resolves.toBeInstanceOf(
    EmployeeDetailDto,
  );
  expect(service.unlinkMembership).toHaveBeenCalledWith(context, employeeId);
});
