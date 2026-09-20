import { expect, it } from 'vitest';
import {
  leaveApplicationCreateSchema,
  leaveApplicationDocumentSchema,
  leaveApplicationDraftSchema,
  leaveApplicationListSchema,
  leaveApplicationPeriodSchema,
  leaveApplicationSubmitSchema,
  leaveApplicationWithdrawSchema,
} from './leave-applications.schemas';

const documentId = '00000000-0000-4000-8000-000000000001';
const leaveTypeId = '00000000-0000-4000-8000-000000000002';

it('validates Leave Application creation', () => {
  expect(leaveApplicationCreateSchema.safeParse({ leaveTypeId }).success).toBe(true);
  expect(
    leaveApplicationCreateSchema.safeParse({ leaveTypeId, employeeId: documentId }).success,
  ).toBe(true);
  expect(leaveApplicationCreateSchema.safeParse({ leaveTypeId: 'not-a-uuid' }).success).toBe(false);
  expect(leaveApplicationCreateSchema.safeParse({ leaveTypeId, unexpected: true }).success).toBe(
    false,
  );
});

it('validates draft facts and period ranges', () => {
  expect(
    leaveApplicationDraftSchema.safeParse({
      reason: 'Family rest and recreation.',
      commutationChoice: 'NOT_REQUESTED',
      policyDetails: { qualifyingEvent: 'LIVE_CHILDBIRTH' },
      periods: [{ dateFrom: '2026-03-02', dateTo: '2026-03-04' }],
      documents: [{ documentId, purposeCode: 'MEDICAL_CERTIFICATE' }],
    }).success,
  ).toBe(true);
  expect(
    leaveApplicationDraftSchema.safeParse({
      periods: [{ dateFrom: '2026-03-04', dateTo: '2026-03-02' }],
    }).success,
  ).toBe(false);
  expect(leaveApplicationDraftSchema.safeParse({ periods: [] }).success).toBe(false);
  expect(
    leaveApplicationDraftSchema.safeParse({
      documents: [{ documentId, purposeCode: 'RENDERED_FORM' }],
    }).success,
  ).toBe(false);
  expect(leaveApplicationPeriodSchema.safeParse({ dateFrom: '2026-03-02' }).success).toBe(false);
});

it('requires a typed attestation when submitting', () => {
  expect(
    leaveApplicationSubmitSchema.safeParse({
      formTemplateDocumentVersionId: documentId,
      attestation: { type: 'AUTHENTICATED_SUBMISSION' },
    }).success,
  ).toBe(true);
  expect(
    leaveApplicationSubmitSchema.safeParse({
      formTemplateDocumentVersionId: documentId,
      attestation: {
        type: 'SIGNED_DOCUMENT',
        documentId,
        receivedAt: '2026-03-01T01:00:00.000Z',
      },
    }).success,
  ).toBe(true);
  expect(
    leaveApplicationSubmitSchema.safeParse({
      formTemplateDocumentVersionId: documentId,
      attestation: { type: 'SIGNED_DOCUMENT', documentId },
    }).success,
  ).toBe(false);
  expect(
    leaveApplicationSubmitSchema.safeParse({
      formTemplateDocumentVersionId: documentId,
      attestation: { type: 'VERBAL' },
    }).success,
  ).toBe(false);
});

it('requires a withdrawal reason and accepts optional evidence', () => {
  expect(leaveApplicationWithdrawSchema.safeParse({ reason: 'Trip cancelled.' }).success).toBe(
    true,
  );
  expect(
    leaveApplicationWithdrawSchema.safeParse({
      reason: 'Trip cancelled.',
      evidenceDocumentId: documentId,
    }).success,
  ).toBe(true);
  expect(leaveApplicationWithdrawSchema.safeParse({ reason: '   ' }).success).toBe(false);
});

it('allows submitted-document purposes beyond evidence kinds', () => {
  expect(
    leaveApplicationDocumentSchema.safeParse({ documentId, purposeCode: 'SIGNED_FORM' }).success,
  ).toBe(true);
  expect(
    leaveApplicationDocumentSchema.safeParse({ documentId, purposeCode: 'WITHDRAWAL_EVIDENCE' })
      .success,
  ).toBe(true);
  expect(
    leaveApplicationDocumentSchema.safeParse({ documentId, purposeCode: 'UNSUPPORTED' }).success,
  ).toBe(false);
});

it('bounds and defaults the application list query', () => {
  expect(leaveApplicationListSchema.parse({})).toEqual({ limit: 50 });
  expect(leaveApplicationListSchema.parse({ limit: '25' })).toEqual({ limit: 25 });
  expect(leaveApplicationListSchema.safeParse({ limit: '0' }).success).toBe(false);
  expect(leaveApplicationListSchema.safeParse({ limit: '201' }).success).toBe(false);
  expect(leaveApplicationListSchema.safeParse({ status: 'DRAFT' }).success).toBe(true);
  expect(leaveApplicationListSchema.safeParse({ status: 'POSTED' }).success).toBe(true);
  expect(leaveApplicationListSchema.safeParse({ status: 'UNKNOWN' }).success).toBe(false);
  expect(leaveApplicationListSchema.safeParse({ leaveTypeId: 'not-a-uuid' }).success).toBe(false);
});
