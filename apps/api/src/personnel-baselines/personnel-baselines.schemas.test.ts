import { expect, it } from 'vitest';
import {
  personnelBaselineCreateSchema,
  personnelBaselineReviewSchema,
} from './personnel-baselines.schemas';

const input = {
  employeeId: '00000000-0000-4000-8000-000000000004',
  authorityDocumentId: '00000000-0000-4000-8000-000000000005',
  authorityEvidenceVersionId: '00000000-0000-4000-8000-000000000006',
  firstGovernmentServiceDate: '2020-01-01',
  agencyServiceStartDate: '2026-01-01',
  organizationUnitId: '00000000-0000-4000-8000-000000000007',
  appointmentStatus: 'PERMANENT',
  salaryGrade: 18,
  salaryStep: 1,
  positionId: '00000000-0000-4000-8000-000000000008',
  reason: 'Verified adoption of existing service facts.',
};

it('accepts complete evidence-backed baseline input', () => {
  expect(personnelBaselineCreateSchema.parse(input)).toEqual(input);
});

it('requires an explicit review decision and reason', () => {
  expect(personnelBaselineReviewSchema.safeParse({ decision: 'APPROVE' }).success).toBe(false);
});
