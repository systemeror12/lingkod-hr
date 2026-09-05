import { expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { employeeAuditWriter, EmployeeServiceError, EmployeesService } from './employees.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const employeeId = '00000000-0000-4000-8000-000000000009';
const membershipId = '00000000-0000-4000-8000-00000000000a';

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'employee-service-test',
    userId: '00000000-0000-4000-8000-000000000002',
    agencyId,
    membershipId: '00000000-0000-4000-8000-000000000003',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

const createInput = {
  employeeNumber: 'NEDA-2026-0042',
  legalName: 'Mara Villanueva Santos',
  birthDate: '1994-05-12',
  sex: 'FEMALE',
  civilStatus: 'SINGLE',
  contactEmail: 'mara.santos@neda.gov.ph',
};

it('rechecks the create permission before opening an Employee record', async () => {
  const service = new EmployeesService(employeeAuditWriter);

  await expect(service.create(context([]), createInput)).rejects.toMatchObject({
    code: 'EMPLOYEE_CREATE_FORBIDDEN',
    statusCode: 403,
  });
});

it('rechecks the read permission before listing Employees', async () => {
  const service = new EmployeesService(employeeAuditWriter);

  await expect(service.list(context([]))).rejects.toMatchObject({
    code: 'EMPLOYEE_READ_FORBIDDEN',
    statusCode: 403,
  });
});

it('rechecks the Personnel Document permission before resolving the own Employee', async () => {
  const service = new EmployeesService(employeeAuditWriter);

  await expect(service.findOwn(context([]))).rejects.toMatchObject({
    code: 'EMPLOYEE_DOCUMENT_READ_FORBIDDEN',
    statusCode: 403,
  });
});

it('rechecks the update permission before changing Membership links', async () => {
  const service = new EmployeesService(employeeAuditWriter);

  await expect(service.linkMembership(context([]), employeeId, membershipId)).rejects.toMatchObject(
    { code: 'EMPLOYEE_UPDATE_FORBIDDEN', statusCode: 403 },
  );
  await expect(service.unlinkMembership(context([]), employeeId)).rejects.toMatchObject({
    code: 'EMPLOYEE_UPDATE_FORBIDDEN',
    statusCode: 403,
  });
});

it('rejects malformed birth dates at the service boundary', async () => {
  const service = new EmployeesService(employeeAuditWriter);

  await expect(
    service.create(context([{ code: 'personnel.employees.create', scopePolicy: 'AGENCY' }]), {
      ...createInput,
      birthDate: '12 May 1994',
    }),
  ).rejects.toMatchObject({ code: 'EMPLOYEE_BIRTH_DATE_INVALID', statusCode: 400 });
});

it('uses a typed error for Employee workflow failures', () => {
  expect(new EmployeeServiceError('message', 409, 'CODE')).toBeInstanceOf(Error);
});
