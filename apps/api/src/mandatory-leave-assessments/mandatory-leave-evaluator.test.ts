import { describe, expect, it } from 'vitest';
import {
  evaluateMandatoryLeave,
  type MandatoryLeaveAllocationFact,
  type MandatoryLeaveEvaluationInput,
  type MandatoryLeaveLedgerFact,
} from './mandatory-leave-evaluator';

function entry(
  effectiveDate: string,
  quantity: string,
  id = effectiveDate,
): MandatoryLeaveLedgerFact {
  return { id: `entry-${id}`, leaveAccountId: 'account-1', effectiveDate, quantity };
}

function allocation(
  overrides: Partial<MandatoryLeaveAllocationFact> = {},
): MandatoryLeaveAllocationFact {
  return {
    lineId: 'line-1',
    leavePostingId: 'posting-1',
    leaveApplicationVersionId: 'version-1',
    leaveAccountId: 'account-1',
    dateFrom: '2026-03-02',
    dateTo: '2026-03-04',
    quantity: '3.0000',
    cancelledQuantity: '0.0000',
    unitCode: 'WORKING_DAY',
    ...overrides,
  };
}

function input(
  overrides: Partial<MandatoryLeaveEvaluationInput> = {},
): MandatoryLeaveEvaluationInput {
  return {
    assessmentYear: 2026,
    asOf: '2026-10-04',
    personnelProfile: { profile: 'ORDINARY_CIVILIAN_NGA', basis: 'POLICY_APPLICABILITY' },
    policy: {
      id: 'policy-1',
      versionNo: 1,
      leaveTypeCode: 'MANDATORY_LEAVE',
      evaluatorKind: 'MANDATORY_CHARGE_FROM_ACCOUNT',
      chargedLeaveTypeCode: 'VACATION_LEAVE',
      ruleParameters: { requiredWorkingDays: 5, minimumAccountCredits: 10 },
    },
    vacationAccounts: [
      { id: 'account-1', status: 'ACTIVE', openedAt: '2020-01-01', closedAt: null },
    ],
    ledgerEntries: [entry('2025-12-31', '12.0000')],
    allocations: [],
    ...overrides,
  };
}

function ruleOutcome(result: ReturnType<typeof evaluateMandatoryLeave>, rule: string) {
  return result.ruleResults.find((item) => item.rule === rule)?.outcome;
}

describe('evaluateMandatoryLeave', () => {
  it('is SUBJECT with policy quantities when the balance reached the policy minimum', () => {
    const result = evaluateMandatoryLeave(input());

    expect(result.result).toBe('SUBJECT');
    expect(result.requiredQuantity).toBe('5.0000');
    expect(result.fulfilledQuantity).toBe('0.0000');
    expect(result.policyVersionId).toBe('policy-1');
    expect(result.leaveAccountId).toBe('account-1');
    expect(result.inputFacts.thresholdBasis).toMatchObject({
      minimumAccountCredits: '10.0000',
      reached: true,
      reachedOn: '2026-01-01',
      balanceOnReachedDate: '12.0000',
    });
    expect(ruleOutcome(result, 'BALANCE_THRESHOLD')).toBe('PASS');
    expect(ruleOutcome(result, 'FULFILLMENT')).toBe('FAIL');
  });

  it('reads thresholds from the policy rather than constants', () => {
    const result = evaluateMandatoryLeave(
      input({
        policy: {
          ...input().policy!,
          ruleParameters: { requiredWorkingDays: 3, minimumAccountCredits: 15 },
        },
      }),
    );

    expect(result.result).toBe('NOT_SUBJECT');
    expect(result.inputFacts.thresholdBasis).toMatchObject({ minimumAccountCredits: '15.0000' });
  });

  it('is NOT_SUBJECT with no required quantity when the balance never reached the minimum', () => {
    const result = evaluateMandatoryLeave(
      input({
        ledgerEntries: [entry('2025-12-31', '6.0000'), entry('2026-02-28', '1.2500')],
        allocations: [allocation({ quantity: '2.0000' })],
      }),
    );

    expect(result.result).toBe('NOT_SUBJECT');
    expect(result.requiredQuantity).toBeNull();
    expect(result.fulfilledQuantity).toBe('2.0000');
    expect(result.inputFacts.thresholdBasis).toMatchObject({
      reached: false,
      peakBalance: '7.2500',
      peakOn: '2026-02-28',
    });
    expect(ruleOutcome(result, 'BALANCE_THRESHOLD')).toBe('FAIL');
  });

  it('stays SUBJECT when the balance reached the minimum earlier in the year and later dropped', () => {
    const result = evaluateMandatoryLeave(
      input({
        ledgerEntries: [
          entry('2025-12-31', '8.7500'),
          entry('2026-01-31', '1.2500'),
          entry('2026-03-02', '-4.0000'),
        ],
        allocations: [allocation({ dateTo: '2026-03-05', quantity: '4.0000' })],
      }),
    );

    expect(result.result).toBe('SUBJECT');
    expect(result.inputFacts.thresholdBasis).toMatchObject({
      reachedOn: '2026-01-31',
      balanceOnReachedDate: '10.0000',
    });
    expect(result.inputFacts.balanceFacts).toMatchObject({ balanceAsOf: '6.0000' });
    expect(result.fulfilledQuantity).toBe('4.0000');
  });

  it('ignores ledger entries after the as-of date when testing the threshold', () => {
    const result = evaluateMandatoryLeave(
      input({
        asOf: '2026-05-31',
        ledgerEntries: [entry('2025-12-31', '9.0000'), entry('2026-06-30', '1.2500')],
      }),
    );

    expect(result.result).toBe('NOT_SUBJECT');
  });

  it('keeps a met obligation SUBJECT with fulfilled at least required', () => {
    const result = evaluateMandatoryLeave(
      input({
        allocations: [
          allocation({ lineId: 'line-1', quantity: '3.0000' }),
          allocation({
            lineId: 'line-2',
            leavePostingId: 'posting-2',
            dateFrom: '2026-07-06',
            dateTo: '2026-07-08',
            quantity: '3.0000',
          }),
        ],
      }),
    );

    expect(result.result).toBe('SUBJECT');
    expect(result.fulfilledQuantity).toBe('6.0000');
    expect(ruleOutcome(result, 'FULFILLMENT')).toBe('PASS');
  });

  it('counts future-dated posted leave in the year, net of applied cancellations', () => {
    const result = evaluateMandatoryLeave(
      input({
        asOf: '2026-10-04',
        allocations: [
          allocation({ dateFrom: '2026-12-14', dateTo: '2026-12-18', quantity: '5.0000' }),
          allocation({
            lineId: 'line-2',
            dateFrom: '2026-04-06',
            dateTo: '2026-04-07',
            quantity: '2.0000',
            cancelledQuantity: '1.5000',
          }),
        ],
      }),
    );

    expect(result.fulfilledQuantity).toBe('5.5000');
    expect(result.inputFacts.fulfillmentFacts?.allocations).toHaveLength(2);
  });

  it('ignores allocations outside the year and fully cancelled allocations', () => {
    const result = evaluateMandatoryLeave(
      input({
        allocations: [
          allocation({ dateFrom: '2025-12-01', dateTo: '2025-12-03' }),
          allocation({ lineId: 'line-2', cancelledQuantity: '3.0000' }),
          allocation({ lineId: 'line-3', leaveAccountId: 'other-account' }),
        ],
      }),
    );

    expect(result.fulfilledQuantity).toBe('0.0000');
    expect(result.inputFacts.fulfillmentFacts?.allocations).toEqual([]);
  });

  it('is INDETERMINATE without a governing policy', () => {
    const result = evaluateMandatoryLeave(
      input({ policy: null, personnelProfile: { profile: null, basis: 'POLICY_APPLICABILITY' } }),
    );

    expect(result.result).toBe('INDETERMINATE');
    expect(result.indeterminateReasons).toEqual(['MISSING_POLICY']);
    expect(ruleOutcome(result, 'PERSONNEL_PROFILE')).toBe('NOT_EVALUATED');
    expect(result.policyVersionId).toBeNull();
    expect(result.requiredQuantity).toBeNull();
    expect(result.fulfilledQuantity).toBeNull();
    expect(ruleOutcome(result, 'LEAVE_POLICY_VERSION')).toBe('INDETERMINATE');
  });

  it('is INDETERMINATE when the policy is not a mandatory charge-from-account rule', () => {
    const result = evaluateMandatoryLeave(
      input({
        policy: { ...input().policy!, ruleParameters: { requiredWorkingDays: 5 } },
      }),
    );

    expect(result.result).toBe('INDETERMINATE');
    expect(result.indeterminateReasons).toContain('UNSUPPORTED_POLICY');
  });

  it('is INDETERMINATE for an unsupported personnel profile', () => {
    const result = evaluateMandatoryLeave(
      input({ personnelProfile: { profile: null, basis: 'POLICY_APPLICABILITY' } }),
    );

    expect(result.result).toBe('INDETERMINATE');
    expect(result.indeterminateReasons).toEqual(['UNSUPPORTED_PERSONNEL_PROFILE']);
    expect(result.policyVersionId).toBe('policy-1');
    expect(ruleOutcome(result, 'PERSONNEL_PROFILE')).toBe('INDETERMINATE');
    expect(ruleOutcome(result, 'BALANCE_THRESHOLD')).toBe('NOT_EVALUATED');
    expect(ruleOutcome(result, 'FULFILLMENT')).toBe('NOT_EVALUATED');
    expect(result.fulfilledQuantity).toBeNull();
  });

  it('is INDETERMINATE without a vacation Leave Account', () => {
    const result = evaluateMandatoryLeave(input({ vacationAccounts: [], ledgerEntries: [] }));

    expect(result.result).toBe('INDETERMINATE');
    expect(result.indeterminateReasons).toEqual(['MISSING_VACATION_ACCOUNT']);
    expect(result.leaveAccountId).toBeNull();
  });

  it('is INDETERMINATE when more than one vacation Leave Account covers the year', () => {
    const result = evaluateMandatoryLeave(
      input({
        vacationAccounts: [
          { id: 'account-1', status: 'CLOSED', openedAt: '2020-01-01', closedAt: '2026-03-31' },
          { id: 'account-2', status: 'ACTIVE', openedAt: '2026-04-01', closedAt: null },
        ],
      }),
    );

    expect(result.result).toBe('INDETERMINATE');
    expect(result.indeterminateReasons).toEqual(['AMBIGUOUS_VACATION_ACCOUNT']);
  });

  it('is INDETERMINATE when a posted allocation cannot be attributed to the year', () => {
    const result = evaluateMandatoryLeave(
      input({
        allocations: [allocation({ dateFrom: '2026-12-29', dateTo: '2027-01-04' })],
      }),
    );

    expect(result.result).toBe('INDETERMINATE');
    expect(result.indeterminateReasons).toEqual(['ALLOCATION_NOT_ATTRIBUTABLE']);
    expect(ruleOutcome(result, 'FULFILLMENT')).toBe('INDETERMINATE');
  });

  it('records why every rule passed or failed', () => {
    const result = evaluateMandatoryLeave(input());

    expect(result.ruleResults.map((item) => item.rule)).toEqual([
      'LEAVE_POLICY_VERSION',
      'PERSONNEL_PROFILE',
      'VACATION_LEAVE_ACCOUNT',
      'BALANCE_THRESHOLD',
      'FULFILLMENT',
    ]);
    expect(result.inputFacts.personnelProfile).toEqual({
      profile: 'ORDINARY_CIVILIAN_NGA',
      basis: 'POLICY_APPLICABILITY',
    });
    expect(result.inputFacts.policy).toMatchObject({ id: 'policy-1', versionNo: 1 });
  });

  it('fingerprints only material facts', () => {
    const base = evaluateMandatoryLeave(input());
    const laterSameFacts = evaluateMandatoryLeave(input({ asOf: '2026-10-05' }));
    const moreFulfilled = evaluateMandatoryLeave(input({ allocations: [allocation()] }));
    const otherPolicy = evaluateMandatoryLeave(
      input({ policy: { ...input().policy!, id: 'policy-2', versionNo: 2 } }),
    );

    expect(laterSameFacts.materialFingerprint).toBe(base.materialFingerprint);
    expect(moreFulfilled.materialFingerprint).not.toBe(base.materialFingerprint);
    expect(otherPolicy.materialFingerprint).not.toBe(base.materialFingerprint);
    expect(base.materialFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not treat a higher peak below the minimum as material', () => {
    const before = evaluateMandatoryLeave(
      input({ ledgerEntries: [entry('2025-12-31', '6.0000')] }),
    );
    const accrued = evaluateMandatoryLeave(
      input({ ledgerEntries: [entry('2025-12-31', '6.0000'), entry('2026-01-31', '1.2500')] }),
    );

    expect(accrued.result).toBe('NOT_SUBJECT');
    expect(accrued.materialFingerprint).toBe(before.materialFingerprint);
  });
});
