import { expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import {
  LeaveApplicationsService,
  leaveApplicationAuditWriter,
} from './leave-applications.service';

const documentsService = {} as ConstructorParameters<typeof LeaveApplicationsService>[1];
const approvalsService = {} as ConstructorParameters<typeof LeaveApplicationsService>[2];
const workSchedules = {} as ConstructorParameters<typeof LeaveApplicationsService>[3];
const workArrangements = {} as ConstructorParameters<typeof LeaveApplicationsService>[4];
const holidayCalendars = {} as ConstructorParameters<typeof LeaveApplicationsService>[5];

const agencyId = '00000000-0000-4000-8000-000000000001';
const applicationId = '00000000-0000-4000-8000-000000000002';
const leaveTypeId = '00000000-0000-4000-8000-000000000003';
const documentId = '00000000-0000-4000-8000-000000000004';

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'leave-application-service-test',
    userId: '00000000-0000-4000-8000-000000000005',
    agencyId,
    membershipId: '00000000-0000-4000-8000-000000000006',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

function service() {
  return new LeaveApplicationsService(
    leaveApplicationAuditWriter,
    documentsService,
    approvalsService,
    workSchedules,
    workArrangements,
    holidayCalendars,
  );
}

it('requires leave.applications.create before listing applications', async () => {
  await expect(service().list(context([]))).rejects.toMatchObject({
    code: 'LEAVE_APPLICATION_FORBIDDEN',
    statusCode: 403,
  });
});

it('requires leave.applications.create before reading an application', async () => {
  await expect(service().findById(context([]), applicationId)).rejects.toMatchObject({
    code: 'LEAVE_APPLICATION_FORBIDDEN',
    statusCode: 403,
  });
});

it('requires leave.applications.create before previewing eligibility', async () => {
  await expect(service().preview(context([]), applicationId)).rejects.toMatchObject({
    code: 'LEAVE_APPLICATION_FORBIDDEN',
    statusCode: 403,
  });
});

it('requires leave.applications.create before creating a draft', async () => {
  await expect(service().create(context([]), { leaveTypeId })).rejects.toMatchObject({
    code: 'LEAVE_APPLICATION_CREATE_FORBIDDEN',
    statusCode: 403,
  });
});

it('requires leave.applications.create before updating a draft', async () => {
  await expect(
    service().update(context([]), applicationId, { reason: 'Rest.' }),
  ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_CREATE_FORBIDDEN', statusCode: 403 });
});

it('requires leave.applications.create before appending a submitted document', async () => {
  await expect(
    service().appendDocument(context([]), applicationId, {
      documentId,
      purposeCode: 'SIGNED_FORM',
    }),
  ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_CREATE_FORBIDDEN', statusCode: 403 });
});

it('requires leave.applications.submit before submitting', async () => {
  await expect(
    service().submit(context([]), applicationId, {
      formTemplateDocumentVersionId: documentId,
      attestation: { type: 'AUTHENTICATED_SUBMISSION' },
    }),
  ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_SUBMIT_FORBIDDEN', statusCode: 403 });
});

it('requires leave.applications.withdraw before withdrawing', async () => {
  await expect(
    service().withdraw(context([]), applicationId, { reason: 'Trip cancelled.' }),
  ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_WITHDRAW_FORBIDDEN', statusCode: 403 });
});
