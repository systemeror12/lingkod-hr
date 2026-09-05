import { expect, it } from 'vitest';
import {
  personnelActionCreateSchema,
  personnelActionDecisionSchema,
  personnelActionListSchema,
  personnelActionReviewSchema,
} from './personnel-actions.schemas';

it('bounds Personnel Action list pages', () => {
  expect(personnelActionListSchema.parse({ limit: '25' })).toEqual({ limit: 25 });
  expect(personnelActionListSchema.safeParse({ limit: '101' }).success).toBe(false);
});

const evidence = (evidenceType: string) => ({
  evidenceType,
  documentId: '00000000-0000-4000-8000-000000000005',
  documentVersionId: '00000000-0000-4000-8000-000000000006',
  sourceDate: '2026-08-28',
});

it('accepts the source-backed STEP_INCREMENT contract', () => {
  const input = {
    employeeId: '00000000-0000-4000-8000-000000000004',
    actionType: 'STEP_INCREMENT',
    proposedEffectivity: '2026-10-01',
    targetFacts: { newSalaryStep: 3 },
    reason: 'Apply the signed Notice of Step Increment on its stated date.',
    evidence: [
      evidence('NOSI'),
      evidence('CURRENT_COMPENSATION'),
      evidence('PERFORMANCE_OR_SERVICE'),
      evidence('SERVICE_CONTINUITY'),
    ],
  };

  expect(personnelActionCreateSchema.parse(input)).toEqual(input);
});

it('rejects OTHER and arbitrary effect payloads', () => {
  expect(
    personnelActionCreateSchema.safeParse({
      employeeId: '00000000-0000-4000-8000-000000000004',
      actionType: 'OTHER',
      proposedEffectivity: '2026-10-01',
      targetFacts: { employeeStatus: 'ACTIVE' },
      reason: 'Unsupported generic change.',
      evidence: [evidence('AUTHORITY')],
    }).success,
  ).toBe(false);
  expect(
    personnelActionCreateSchema.safeParse({
      employeeId: '00000000-0000-4000-8000-000000000004',
      actionType: 'STEP_INCREMENT',
      proposedEffectivity: '2026-10-01',
      targetFacts: { newSalaryStep: 3, employeeStatus: 'ACTIVE' },
      reason: 'Unsupported generic change.',
      evidence: [evidence('NOSI')],
    }).success,
  ).toBe(false);
});

it('keeps review and authority decisions distinct and reasoned', () => {
  expect(
    personnelActionReviewSchema.parse({
      decision: 'RETURN',
      reason: 'The service-period evidence is incomplete.',
    }),
  ).toEqual({ decision: 'RETURN', reason: 'The service-period evidence is incomplete.' });
  expect(personnelActionDecisionSchema.safeParse({ decision: 'APPROVE', reason: '' }).success).toBe(
    false,
  );
  expect(
    personnelActionReviewSchema.safeParse({ decision: 'APPROVE', reason: 'Looks good.' }).success,
  ).toBe(false);
});
