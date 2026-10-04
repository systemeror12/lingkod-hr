import { expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import {
  LeaveAccountsService,
  LeaveAccountServiceError,
  isCreditBearingLeaveType,
  leaveAccountAuditWriter,
} from './leave-accounts.service';
import {
  mandatoryLeaveAssessmentAuditWriter,
  MandatoryLeaveAssessmentsService,
} from '../mandatory-leave-assessments/mandatory-leave-assessments.service';

const documentsService = {} as ConstructorParameters<typeof LeaveAccountsService>[1];
const agencyId = '00000000-0000-4000-8000-000000000001';
const accountId = '00000000-0000-4000-8000-000000000002';
const entryId = '00000000-0000-4000-8000-000000000003';
const employeeId = '00000000-0000-4000-8000-000000000004';
const leaveTypeId = '00000000-0000-4000-8000-000000000005';
const documentId = '00000000-0000-4000-8000-000000000006';

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'leave-account-service-test',
    userId: '00000000-0000-4000-8000-000000000007',
    agencyId,
    membershipId: '00000000-0000-4000-8000-000000000008',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

const adjust = { code: 'leave.credits.adjust', scopePolicy: 'AGENCY' } as const;
const evidence = { code: 'documents.evidence.read', scopePolicy: 'AGENCY' } as const;

function service() {
  return new LeaveAccountsService(
    leaveAccountAuditWriter,
    documentsService,
    new MandatoryLeaveAssessmentsService(mandatoryLeaveAssessmentAuditWriter),
  );
}

it('requires leave.accounts.read before exposing accounts', async () => {
  await expect(service().list(context([]))).rejects.toMatchObject({
    code: 'LEAVE_ACCOUNT_READ_FORBIDDEN',
    statusCode: 403,
  });
});

it('requires leave.credits.adjust before opening an account', async () => {
  await expect(
    service().open(context([{ code: 'leave.accounts.read', scopePolicy: 'AGENCY' }]), {
      employeeId,
      leaveTypeId,
      effectiveDate: '2026-01-05',
      openingQuantity: 15,
      evidenceDocumentId: documentId,
    }),
  ).rejects.toMatchObject({ code: 'LEAVE_CREDIT_ADJUST_FORBIDDEN', statusCode: 403 });
});

it('requires evidence read access before binding account evidence', async () => {
  await expect(
    service().open(context([adjust]), {
      employeeId,
      leaveTypeId,
      effectiveDate: '2026-01-05',
      openingQuantity: 15,
      evidenceDocumentId: documentId,
    }),
  ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_EVIDENCE_FORBIDDEN', statusCode: 403 });
});

it('rejects malformed dates before touching agency data', async () => {
  await expect(
    service().open(context([adjust, evidence]), {
      employeeId,
      leaveTypeId,
      effectiveDate: '2026-02-30',
      openingQuantity: 15,
      evidenceDocumentId: documentId,
    }),
  ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_DATE_INVALID', statusCode: 400 });
  await expect(
    service().close(context([adjust]), accountId, { closedAt: '2026-13-01', reason: 'Separated.' }),
  ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_DATE_INVALID', statusCode: 400 });
});

it('rejects quantities beyond four decimal places', async () => {
  await expect(
    service().open(context([adjust, evidence]), {
      employeeId,
      leaveTypeId,
      effectiveDate: '2026-01-05',
      openingQuantity: 1.23456,
      evidenceDocumentId: documentId,
    }),
  ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_QUANTITY_INVALID', statusCode: 400 });
  await expect(
    service().recordAdjustment(context([adjust, evidence]), accountId, {
      quantity: 1.23456,
      effectiveDate: '2026-01-05',
      authorityDocumentId: documentId,
      evidenceDocumentId: documentId,
      reason: 'Correct the accrual.',
    }),
  ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_QUANTITY_INVALID', statusCode: 400 });
});

it('requires a stated reason for lifecycle actions', async () => {
  await expect(
    service().freeze(context([adjust]), accountId, { reason: '   ' }),
  ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_REASON_REQUIRED', statusCode: 400 });
  await expect(
    service().unfreeze(context([adjust]), accountId, { reason: '' }),
  ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_REASON_REQUIRED', statusCode: 400 });
});

it('requires a stated reason for adjustments and reversals', async () => {
  await expect(
    service().recordAdjustment(context([adjust, evidence]), accountId, {
      quantity: 1,
      effectiveDate: '2026-01-05',
      authorityDocumentId: documentId,
      evidenceDocumentId: documentId,
      reason: '   ',
    }),
  ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_REASON_REQUIRED', statusCode: 400 });
  await expect(
    service().reverseEntry(context([adjust, evidence]), accountId, entryId, {
      authorityDocumentId: documentId,
      evidenceDocumentId: documentId,
      reason: '',
    }),
  ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_REASON_REQUIRED', statusCode: 400 });
});

it('rejects a zero adjustment quantity before touching agency data', async () => {
  await expect(
    service().recordAdjustment(context([adjust, evidence]), accountId, {
      quantity: 0,
      effectiveDate: '2026-01-05',
      authorityDocumentId: documentId,
      evidenceDocumentId: documentId,
      reason: 'Correct the accrual.',
    }),
  ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_QUANTITY_INVALID', statusCode: 400 });
});

it('requires evidence read access before reversing a posted entry', async () => {
  await expect(
    service().reverseEntry(context([adjust]), accountId, entryId, {
      authorityDocumentId: documentId,
      evidenceDocumentId: documentId,
      reason: 'Correct the posting.',
    }),
  ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_EVIDENCE_FORBIDDEN', statusCode: 403 });
});

it('treats only credit-bearing catalogue bases as accounts', () => {
  expect(isCreditBearingLeaveType('VACATION_LEAVE')).toBe(true);
  expect(isCreditBearingLeaveType('SICK_LEAVE')).toBe(true);
  expect(isCreditBearingLeaveType('MANDATORY_LEAVE')).toBe(false);
  expect(isCreditBearingLeaveType('SPECIAL_LEAVE_BENEFITS')).toBe(false);
  expect(isCreditBearingLeaveType('NOT_A_LEAVE_TYPE')).toBe(false);
});

it('carries typed codes and reasons on service errors', () => {
  const error = new LeaveAccountServiceError(
    'The posting would take the posted balance below zero.',
    409,
    'LEAVE_ACCOUNT_INSUFFICIENT_BALANCE',
    ['POSTED:4.0000', 'REQUESTED:-7.0000'],
  );
  expect(error).toBeInstanceOf(Error);
  expect(error.statusCode).toBe(409);
  expect(error.reasons).toEqual(['POSTED:4.0000', 'REQUESTED:-7.0000']);
});
