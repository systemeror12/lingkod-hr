import { expect, it } from 'vitest';
import {
  leaveIdempotencyKeySchema,
  leavePolicyActivationSchema,
  leavePolicyAuthoritySchema,
  leavePolicyVersionCreateSchema,
  leavePolicyVersionUpdateSchema,
  leaveReasonSchema,
  leaveTypeAsOfSchema,
  leaveTypeCreateSchema,
  leaveTypeIdSchema,
  leaveTypeUpdateSchema,
} from './leave-policies.schemas';

const documentId = '00000000-0000-4000-8000-000000000001';

it('validates catalogue-driven Leave Type creation and updates', () => {
  expect(leaveTypeCreateSchema.safeParse({ catalogueCode: 'VACATION_LEAVE' }).success).toBe(true);
  expect(leaveTypeCreateSchema.safeParse({ catalogueCode: '' }).success).toBe(false);
  expect(
    leaveTypeCreateSchema.safeParse({ catalogueCode: 'VACATION_LEAVE', creditBased: true }).success,
  ).toBe(false);

  expect(
    leaveTypeUpdateSchema.safeParse({ name: 'Vacation Leave', status: 'INACTIVE' }).success,
  ).toBe(true);
  expect(leaveTypeUpdateSchema.safeParse({ status: 'ARCHIVED' }).success).toBe(false);
  expect(leaveTypeUpdateSchema.safeParse({ rowVersion: 0 }).success).toBe(false);
});

it('validates Leave Policy Version drafts against the accepted vocabularies', () => {
  const draft = {
    effectiveDate: '2026-01-01',
    approvalRouteCode: 'LEAVE-ROUTE-1',
    applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'], excludedProfiles: [] },
    documentRequirements: { additional: ['MEDICAL_CERTIFICATE'] },
    reason: 'Initial policy version.',
  };
  expect(leavePolicyVersionCreateSchema.safeParse(draft).success).toBe(true);
  expect(leavePolicyVersionUpdateSchema.safeParse({ ...draft, rowVersion: 1 }).success).toBe(true);

  expect(
    leavePolicyVersionCreateSchema.safeParse({
      ...draft,
      applicability: { profiles: ['SPACE_FORCE_OFFICER'] },
    }).success,
  ).toBe(false);
  expect(
    leavePolicyVersionCreateSchema.safeParse({
      ...draft,
      applicability: { profiles: [] },
    }).success,
  ).toBe(false);
  expect(
    leavePolicyVersionCreateSchema.safeParse({
      ...draft,
      documentRequirements: { additional: ['SIGNED_LEAVE_APPLICATION_FORM', 'NOT_A_KIND'] },
    }).success,
  ).toBe(false);
  expect(
    leavePolicyVersionCreateSchema.safeParse({ ...draft, effectiveDate: '01/01/2026' }).success,
  ).toBe(false);
  expect(
    leavePolicyVersionCreateSchema.safeParse({
      ...draft,
      ruleParameters: { formula: 'credits * 2' },
    }).success,
  ).toBe(false);
  expect(leavePolicyVersionCreateSchema.safeParse({ ...draft, reason: '  ' }).success).toBe(false);
});

it('validates authority links against exact document versions', () => {
  expect(
    leavePolicyAuthoritySchema.safeParse({
      authorityClass: 'NATIONAL_RULE',
      documentId,
      citation: 'Rule XVI, sections 1-3',
    }).success,
  ).toBe(true);
  expect(
    leavePolicyAuthoritySchema.safeParse({
      authorityClass: 'AGENCY_CONFIGURATION',
      documentId,
      citation: 'Agency leave policy',
      validationReason: 'Reviewed by the HRMO.',
    }).success,
  ).toBe(true);
  expect(
    leavePolicyAuthoritySchema.safeParse({
      authorityClass: 'ADMIN_FORMULA',
      documentId,
      citation: 'Formula',
    }).success,
  ).toBe(false);
  expect(
    leavePolicyAuthoritySchema.safeParse({
      authorityClass: 'NATIONAL_RULE',
      documentId: 'not-a-uuid',
      citation: 'Rule XVI',
    }).success,
  ).toBe(false);
  expect(
    leavePolicyAuthoritySchema.safeParse({
      authorityClass: 'NATIONAL_RULE',
      documentId,
      citation: '   ',
    }).success,
  ).toBe(false);
});

it('validates activation input, identifiers, as-of dates, and idempotency keys', () => {
  expect(leavePolicyActivationSchema.safeParse({ reason: 'Approved.' }).success).toBe(true);
  expect(leavePolicyActivationSchema.safeParse({}).success).toBe(false);
  expect(leaveTypeIdSchema.safeParse(documentId).success).toBe(true);
  expect(leaveTypeIdSchema.safeParse('leave-1').success).toBe(false);
  expect(leaveTypeAsOfSchema.safeParse(undefined).success).toBe(true);
  expect(leaveTypeAsOfSchema.safeParse('2026-05-01').success).toBe(true);
  expect(leaveTypeAsOfSchema.safeParse('2026-15-01').success).toBe(false);
  expect(leaveIdempotencyKeySchema.safeParse('activate-1').success).toBe(true);
  expect(leaveIdempotencyKeySchema.safeParse('').success).toBe(false);
  expect(leaveReasonSchema.safeParse('x'.repeat(501)).success).toBe(false);
});
