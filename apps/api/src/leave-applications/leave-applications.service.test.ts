import { AttendancePostedLeaveInputsService } from '../attendance-posted-leave-inputs/attendance-posted-leave-inputs.service';
import { expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { ApprovalCompletionRegistry } from '../approvals/approval.service';
import { findLeaveCatalogueEntry } from '../leave-policies/leave-catalogue';
import {
  LeaveApplicationsService,
  leaveApplicationAuditWriter,
  permittedAllocationKinds,
} from './leave-applications.service';

const documentsService = {} as ConstructorParameters<typeof LeaveApplicationsService>[1];
const approvalsService = {} as ConstructorParameters<typeof LeaveApplicationsService>[2];
const completionRegistry = new ApprovalCompletionRegistry();
const workSchedules = {} as ConstructorParameters<typeof LeaveApplicationsService>[4];
const workArrangements = {} as ConstructorParameters<typeof LeaveApplicationsService>[5];
const holidayCalendars = {} as ConstructorParameters<typeof LeaveApplicationsService>[6];

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
    completionRegistry,
    workSchedules,
    workArrangements,
    holidayCalendars,
    new AttendancePostedLeaveInputsService(),
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

it('requires leave.applications.route before routing', async () => {
  await expect(service().route(context([]), applicationId)).rejects.toMatchObject({
    code: 'LEAVE_APPLICATION_ROUTE_FORBIDDEN',
    statusCode: 403,
  });
});

it('requires leave.credits.certify before certifying', async () => {
  await expect(service().certify(context([]), applicationId, {})).rejects.toMatchObject({
    code: 'LEAVE_APPLICATION_CERTIFY_FORBIDDEN',
    statusCode: 403,
  });
});

it('requires leave.applications.recommend before recommending', async () => {
  await expect(
    service().recommend(context([]), applicationId, { outcome: 'RECOMMEND_APPROVAL' }),
  ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_RECOMMEND_FORBIDDEN', statusCode: 403 });
});

it('requires the matching decision permission before deciding', async () => {
  await expect(
    service().decide(context([]), applicationId, { decision: 'APPROVE' }),
  ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_APPROVED_FORBIDDEN', statusCode: 403 });
  await expect(
    service().decide(context([]), applicationId, {
      decision: 'REJECT',
      comments: 'Outside the entitlement.',
    }),
  ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_REJECTED_FORBIDDEN', statusCode: 403 });
});

it('requires leave.applications.return before returning', async () => {
  await expect(
    service().returnToApplicant(context([]), applicationId, { reason: 'Attach the signed form.' }),
  ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_RETURN_FORBIDDEN', statusCode: 403 });
});

function kindsFor(code: string): string[] {
  const entry = findLeaveCatalogueEntry(code);
  if (!entry) throw new Error(`Missing catalogue entry ${code}`);
  return [
    ...permittedAllocationKinds({
      chargedLeaveTypeId: entry.chargedLeaveTypeCode ? leaveTypeId : null,
      entitlementBasis: entry.entitlementBasis,
      ruleParameters: entry.ruleParameters,
      leaveType: { code },
    }),
  ];
}

it('derives allocation kinds from the bound policy entry', () => {
  expect(kindsFor('VACATION_LEAVE')).toEqual(['LEAVE_ACCOUNT', 'LEAVE_WITHOUT_PAY']);
  expect(kindsFor('MANDATORY_LEAVE')).toEqual(['LEAVE_ACCOUNT', 'LEAVE_WITHOUT_PAY']);
  expect(kindsFor('SPECIAL_PRIVILEGE_LEAVE')).toEqual(['LEAVE_ACCOUNT', 'LEAVE_WITHOUT_PAY']);
  expect(kindsFor('MATERNITY_LEAVE')).toEqual(['NON_CREDIT']);
  expect(kindsFor('SPECIAL_EMERGENCY_LEAVE')).toEqual(['NON_CREDIT']);
  expect(kindsFor('STUDY_LEAVE')).toEqual(['NON_CREDIT']);
  expect(kindsFor('LEAVE_WITHOUT_PAY')).toEqual(['LEAVE_WITHOUT_PAY']);
});

it('falls back to the catalogue when a stored policy is unreadable', () => {
  expect(
    permittedAllocationKinds({
      chargedLeaveTypeId: null,
      entitlementBasis: 'ACCRUED_ACCOUNT',
      ruleParameters: null,
      leaveType: { code: 'VACATION_LEAVE' },
    }),
  ).toEqual(['LEAVE_ACCOUNT', 'LEAVE_WITHOUT_PAY']);
  expect(
    permittedAllocationKinds({
      chargedLeaveTypeId: null,
      entitlementBasis: 'NON_CREDIT_AUTHORIZATION',
      ruleParameters: { paid: false, chargesLedger: false },
      leaveType: { code: 'LEAVE_WITHOUT_PAY' },
    }),
  ).toEqual(['LEAVE_WITHOUT_PAY']);
});

it('requires leave.applications.request_cancel before requesting a cancellation', async () => {
  await expect(
    service().requestCancellation(context([]), applicationId, {
      scopeType: 'WHOLE',
      reason: 'Plans changed.',
    }),
  ).rejects.toMatchObject({
    code: 'LEAVE_APPLICATION_REQUEST_CANCEL_FORBIDDEN',
    statusCode: 403,
  });
});

it('requires the permission that matches the cancellation decision', async () => {
  const approver = context([{ code: 'leave.applications.cancel', scopePolicy: 'AGENCY' }]);
  await expect(
    service().decideCancellation(approver, applicationId, {
      decision: 'REJECT',
      comments: 'Still needed.',
    }),
  ).rejects.toMatchObject({
    code: 'LEAVE_APPLICATION_CANCELLATION_REJECTED_FORBIDDEN',
    statusCode: 403,
  });
  await expect(
    service().decideCancellation(context([]), applicationId, { decision: 'APPROVE' }),
  ).rejects.toMatchObject({
    code: 'LEAVE_APPLICATION_CANCELLATION_APPROVED_FORBIDDEN',
    statusCode: 403,
  });
});

it('requires leave.applications.post before posting approved leave', async () => {
  await expect(service().post(context([]), applicationId, 'post-1')).rejects.toMatchObject({
    code: 'LEAVE_APPLICATION_POST_FORBIDDEN',
    statusCode: 403,
  });
});

it('requires leave.applications.apply_cancellation before applying effects', async () => {
  await expect(
    service().applyCancellation(context([]), applicationId, documentId, 'apply-cancellation'),
  ).rejects.toMatchObject({
    code: 'LEAVE_APPLICATION_APPLY_CANCELLATION_FORBIDDEN',
    statusCode: 403,
  });
});
