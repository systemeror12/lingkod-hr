import { expect, it } from 'vitest';
import {
  evaluateLeaveEligibility,
  type LeaveEligibilityDateFact,
  type LeaveEligibilityInput,
  type LeaveEligibilityRuleResult,
} from './leave-eligibility';

function dateFact(overrides: Partial<LeaveEligibilityDateFact> = {}): LeaveEligibilityDateFact {
  return {
    date: '2026-03-02',
    policyVersionId: 'policy-1',
    policyVersionNo: 1,
    calendarBasis: 'WORKING_DAY',
    approvalRouteCode: 'LEAVE_STANDARD',
    scheduleAssignmentId: 'assignment-1',
    holidayCalendarVersionId: 'calendar-1',
    ruleType: 'FIXED',
    requiredMinutes: 480,
    nonWorkingHoliday: false,
    holidayEntries: [],
    missing: [],
    ...overrides,
  };
}

function input(overrides: Partial<LeaveEligibilityInput> = {}): LeaveEligibilityInput {
  return {
    leaveTypeCode: 'VACATION_LEAVE',
    evaluatorKind: 'SERVICE_ACCRUAL',
    entitlementBasis: 'ACCRUED_ACCOUNT',
    calendarBasis: 'WORKING_DAY',
    ruleParameters: { grantedDays: 15 },
    applicability: { profiles: ['ALL'], excludedProfiles: [] },
    requiredEvidenceKinds: [],
    providedEvidenceKinds: [],
    policyDetails: {},
    commutationChoice: null,
    periods: [{ dateFrom: '2026-03-02', dateTo: '2026-03-04' }],
    dateFacts: [dateFact(), dateFact({ date: '2026-03-03' }), dateFact({ date: '2026-03-04' })],
    accountAvailableQuantity: 15,
    chargesAccount: true,
    authorityCitations: [],
    ...overrides,
  };
}

function ruleResult(
  results: readonly LeaveEligibilityRuleResult[],
  rule: string,
): LeaveEligibilityRuleResult {
  const found = results.find((candidate) => candidate.rule === rule);
  if (!found) throw new Error(`Expected a ${rule} rule result.`);
  return found;
}

it('marks a fully resolved working-day request eligible with one segment', () => {
  const outcome = evaluateLeaveEligibility(input());

  expect(outcome.result).toBe('ELIGIBLE');
  expect(outcome.requestedQuantity).toBe(3);
  expect(outcome.requestedUnit).toBe('WORKING_DAY');
  expect(outcome.missingFacts).toEqual([]);
  expect(outcome.segments).toEqual([
    {
      policyVersionId: 'policy-1',
      scheduleAssignmentId: 'assignment-1',
      holidayCalendarVersionId: 'calendar-1',
      dateFrom: '2026-03-02',
      dateTo: '2026-03-04',
      requestedQuantity: 3,
      requestedUnit: 'WORKING_DAY',
      accountQuantity: 3,
    },
  ]);
});

it('excludes non-working holidays and rest days from the requested quantity', () => {
  const outcome = evaluateLeaveEligibility(
    input({
      dateFacts: [
        dateFact(),
        dateFact({ date: '2026-03-03', ruleType: 'REST' }),
        dateFact({
          date: '2026-03-04',
          nonWorkingHoliday: true,
          holidayEntries: [{ holidayDate: '2026-03-04', dayType: 'REGULAR_HOLIDAY' }],
        }),
      ],
    }),
  );

  expect(outcome.result).toBe('ELIGIBLE');
  expect(outcome.requestedQuantity).toBe(1);
  expect(outcome.segments[0]?.requestedQuantity).toBe(1);
});

it('fails closed while any requested date has unresolved facts', () => {
  const outcome = evaluateLeaveEligibility(
    input({
      dateFacts: [
        dateFact(),
        dateFact({ date: '2026-03-03', missing: ['MISSING_SCHEDULE_ASSIGNMENT'] }),
      ],
    }),
  );

  expect(outcome.result).toBe('INDETERMINATE');
  expect(outcome.missingFacts).toEqual([
    {
      fact: 'MISSING_SCHEDULE_ASSIGNMENT',
      detail: 'MISSING_SCHEDULE_ASSIGNMENT is unresolved for 2026-03-03.',
    },
  ]);
  expect(outcome.segments).toEqual([]);
  expect(ruleResult(outcome.ruleResults, 'QUANTITY').outcome).toBe('INDETERMINATE');
});

it('requires a Leave Policy Version for every requested date', () => {
  const outcome = evaluateLeaveEligibility(
    input({
      dateFacts: [
        dateFact(),
        dateFact({ date: '2026-03-03', policyVersionId: null, policyVersionNo: null }),
      ],
    }),
  );

  expect(outcome.result).toBe('INDETERMINATE');
  expect(outcome.missingFacts).toContainEqual({
    fact: 'MISSING_POLICY_VERSION',
    detail: 'No Leave Policy Version covers 2026-03-03.',
  });
  expect(ruleResult(outcome.ruleResults, 'LEAVE_POLICY_VERSION').outcome).toBe('INDETERMINATE');
});

it('blocks submission until required evidence is attached', () => {
  const required = 'SICK_LEAVE_MEDICAL_CERTIFICATE';
  const missing = evaluateLeaveEligibility(input({ requiredEvidenceKinds: [required] }));

  expect(missing.result).toBe('INDETERMINATE');
  expect(missing.missingFacts).toContainEqual({
    fact: `MISSING_EVIDENCE:${required}`,
    detail: `Attach the required ${required} evidence.`,
  });

  const attached = evaluateLeaveEligibility(
    input({ requiredEvidenceKinds: [required], providedEvidenceKinds: [required] }),
  );

  expect(attached.result).toBe('ELIGIBLE');
  expect(ruleResult(attached.ruleResults, `REQUIRED_EVIDENCE:${required}`).outcome).toBe('PASS');
});

it('rejects a commutation request for a non-commutable leave type', () => {
  const outcome = evaluateLeaveEligibility(
    input({
      ruleParameters: { grantedDays: 15, commutation: 'NOT_COMMUTABLE' },
      commutationChoice: 'REQUESTED',
    }),
  );

  expect(outcome.result).toBe('INELIGIBLE');
  expect(ruleResult(outcome.ruleResults, 'COMMUTATION').outcome).toBe('FAIL');
});

it('rejects a request longer than the granted entitlement', () => {
  const outcome = evaluateLeaveEligibility(input({ ruleParameters: { grantedDays: 2 } }));

  expect(outcome.result).toBe('INELIGIBLE');
  expect(ruleResult(outcome.ruleResults, 'ENTITLEMENT_LIMIT')).toMatchObject({
    outcome: 'FAIL',
    detail: 'The requested quantity exceeds the granted 2 day(s).',
  });
});

it('requires an exact working-day count when the policy configures one', () => {
  const outcome = evaluateLeaveEligibility(input({ ruleParameters: { requiredWorkingDays: 5 } }));

  expect(outcome.result).toBe('INELIGIBLE');
  expect(ruleResult(outcome.ruleResults, 'REQUIRED_WORKING_DAYS').outcome).toBe('FAIL');
});

it('resolves minimum account credits against the charged account', () => {
  const parameters = { minimumAccountCredits: 5 };

  const unresolved = evaluateLeaveEligibility(
    input({ ruleParameters: parameters, accountAvailableQuantity: null }),
  );
  expect(unresolved.result).toBe('INDETERMINATE');
  expect(unresolved.missingFacts).toContainEqual({
    fact: 'MISSING_LEAVE_ACCOUNT',
    detail: 'The charged Leave Account could not be resolved.',
  });

  const insufficient = evaluateLeaveEligibility(
    input({ ruleParameters: parameters, accountAvailableQuantity: 3 }),
  );
  expect(insufficient.result).toBe('INELIGIBLE');
  expect(ruleResult(insufficient.ruleResults, 'MINIMUM_ACCOUNT_CREDITS').outcome).toBe('FAIL');

  const sufficient = evaluateLeaveEligibility(
    input({ ruleParameters: parameters, accountAvailableQuantity: 5 }),
  );
  expect(sufficient.result).toBe('ELIGIBLE');
  expect(ruleResult(sufficient.ruleResults, 'MINIMUM_ACCOUNT_CREDITS').outcome).toBe('PASS');
});

it('fails closed when the requested dates resolve to conflicting approval routes', () => {
  const outcome = evaluateLeaveEligibility(
    input({
      dateFacts: [
        dateFact(),
        dateFact({ date: '2026-03-03', approvalRouteCode: 'LEAVE_TEACHING' }),
      ],
    }),
  );

  expect(outcome.result).toBe('INDETERMINATE');
  expect(outcome.missingFacts).toContainEqual({
    fact: 'CONFLICTING_APPROVAL_ROUTE',
    detail:
      'The requested dates resolve to conflicting Approval Route codes: LEAVE_STANDARD, LEAVE_TEACHING.',
  });
});

it('never guesses a source-defined quantity', () => {
  const outcome = evaluateLeaveEligibility(
    input({
      calendarBasis: 'SOURCE_DEFINED',
      dateFacts: [dateFact({ calendarBasis: 'SOURCE_DEFINED' })],
    }),
  );

  expect(outcome.result).toBe('INDETERMINATE');
  expect(outcome.missingFacts).toContainEqual({
    fact: 'SOURCE_DEFINED_QUANTITY_UNSUPPORTED',
    detail:
      'The accepted sources define this quantity in their own unit, so it cannot be computed yet.',
  });
});

it('requires a qualifying event for event-bound leave and applies its variant grant', () => {
  const eventBound = {
    evaluatorKind: 'EVENT_BOUND_ALLOWANCE',
    ruleParameters: { variants: [{ code: 'LIVE_CHILDBIRTH', grantedDays: 105 }] },
  } as const;

  const missingEvent = evaluateLeaveEligibility(input(eventBound));
  expect(missingEvent.result).toBe('INDETERMINATE');
  expect(missingEvent.missingFacts).toContainEqual({
    fact: 'MISSING_QUALIFYING_EVENT',
    detail: 'State the qualifying event for this Leave Type.',
  });

  const accepted = evaluateLeaveEligibility(
    input({ ...eventBound, policyDetails: { qualifyingEvent: 'LIVE_CHILDBIRTH' } }),
  );
  expect(accepted.result).toBe('ELIGIBLE');
  expect(ruleResult(accepted.ruleResults, 'ENTITLEMENT_LIMIT').outcome).toBe('PASS');

  const rejected = evaluateLeaveEligibility(
    input({ ...eventBound, policyDetails: { qualifyingEvent: 'DECLARED_CALAMITY' } }),
  );
  expect(rejected.result).toBe('INELIGIBLE');
  expect(ruleResult(rejected.ruleResults, 'QUALIFYING_EVENT').outcome).toBe('FAIL');
});

it('charges scheduled time by required minutes', () => {
  const outcome = evaluateLeaveEligibility(
    input({
      calendarBasis: 'SCHEDULED_TIME',
      ruleParameters: {},
      dateFacts: [
        dateFact({ calendarBasis: 'SCHEDULED_TIME', requiredMinutes: 240 }),
        dateFact({ date: '2026-03-03', calendarBasis: 'SCHEDULED_TIME', requiredMinutes: 120 }),
      ],
    }),
  );

  expect(outcome.result).toBe('ELIGIBLE');
  expect(outcome.requestedQuantity).toBe(360);
  expect(outcome.requestedUnit).toBe('SCHEDULED_TIME');
});

it('reports the untracked personnel profile without blocking', () => {
  const outcome = evaluateLeaveEligibility(
    input({ applicability: { profiles: ['ALL'], excludedProfiles: [] } }),
  );

  expect(outcome.result).toBe('ELIGIBLE');
  expect(ruleResult(outcome.ruleResults, 'PERSONNEL_PROFILE').outcome).toBe('NOT_EVALUATED');
});

it('records no account quantity when the leave type does not charge the ledger', () => {
  const outcome = evaluateLeaveEligibility(input({ chargesAccount: false }));

  expect(outcome.segments[0]?.accountQuantity).toBeNull();
});
