import { expect, it } from 'vitest';
import {
  leaveApplicationCertificationSchema,
  leaveApplicationCreateSchema,
  leaveApplicationDecisionSchema,
  leaveApplicationDocumentSchema,
  leaveApplicationDraftSchema,
  leaveApplicationListSchema,
  leaveApplicationPeriodSchema,
  leaveApplicationRecommendationSchema,
  leaveApplicationReturnSchema,
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

it('accepts optional certification balance dates only', () => {
  expect(leaveApplicationCertificationSchema.parse({})).toEqual({});
  expect(leaveApplicationCertificationSchema.parse({ balanceAsOf: '2026-03-01' })).toMatchObject({
    balanceAsOf: '2026-03-01',
  });
  expect(leaveApplicationCertificationSchema.safeParse({ balanceAsOf: 'March 1' }).success).toBe(
    false,
  );
  expect(leaveApplicationCertificationSchema.safeParse({ unexpected: true }).success).toBe(false);
});

it('requires a reason for a negative recommendation', () => {
  expect(
    leaveApplicationRecommendationSchema.safeParse({ outcome: 'RECOMMEND_APPROVAL' }).success,
  ).toBe(true);
  expect(
    leaveApplicationRecommendationSchema.safeParse({ outcome: 'RECOMMEND_REJECTION' }).success,
  ).toBe(false);
  expect(
    leaveApplicationRecommendationSchema.safeParse({
      outcome: 'RECOMMEND_REJECTION',
      reason: 'The application exceeds the period allowed.',
    }).success,
  ).toBe(true);
  expect(
    leaveApplicationRecommendationSchema.safeParse({ outcome: 'RECOMMEND_LATER' }).success,
  ).toBe(false);
});

it('requires a rejection reason and bounded allocation lines', () => {
  expect(leaveApplicationDecisionSchema.safeParse({ decision: 'APPROVE' }).success).toBe(true);
  expect(leaveApplicationDecisionSchema.safeParse({ decision: 'REJECT' }).success).toBe(false);
  expect(
    leaveApplicationDecisionSchema.safeParse({
      decision: 'REJECT',
      comments: 'The requested dates are not covered.',
    }).success,
  ).toBe(true);
  expect(
    leaveApplicationDecisionSchema.safeParse({
      decision: 'APPROVE',
      allocations: [
        {
          segmentId: documentId,
          allocationKind: 'LEAVE_ACCOUNT',
          quantity: '2',
          accountQuantity: '1.5',
        },
        { segmentId: documentId, allocationKind: 'LEAVE_WITHOUT_PAY' },
      ],
    }).success,
  ).toBe(true);
  expect(
    leaveApplicationDecisionSchema.safeParse({
      decision: 'APPROVE',
      allocations: [{ segmentId: documentId, allocationKind: 'BORROWED' }],
    }).success,
  ).toBe(false);
  expect(
    leaveApplicationDecisionSchema.safeParse({
      decision: 'APPROVE',
      allocations: [
        { segmentId: documentId, allocationKind: 'LEAVE_ACCOUNT', quantity: '0.00005' },
      ],
    }).success,
  ).toBe(false);
  expect(
    leaveApplicationDecisionSchema.safeParse({ decision: 'APPROVE', allocations: [] }).success,
  ).toBe(false);
});

it('requires a return reason', () => {
  expect(
    leaveApplicationReturnSchema.safeParse({ reason: 'Attach the signed form.' }).success,
  ).toBe(true);
  expect(leaveApplicationReturnSchema.safeParse({}).success).toBe(false);
  expect(leaveApplicationReturnSchema.safeParse({ reason: '   ' }).success).toBe(false);
});
