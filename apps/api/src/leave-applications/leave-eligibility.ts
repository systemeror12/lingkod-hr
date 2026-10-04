import type {
  LeaveAuthorityCitation,
  LeaveCalendarBasis,
  LeaveEntitlementBasis,
  LeaveEvaluatorKind,
  LeaveQualifyingEvent,
  LeaveRuleParameters,
} from '../leave-policies/leave-catalogue';

/**
 * Deterministic, pure Leave eligibility evaluation. The service resolves every
 * policy, schedule, holiday, evidence, and account fact first; this module only
 * explains the outcome. Anything the accepted sources do not settle fails
 * closed as INDETERMINATE, never as a favorable default.
 */

export const LEAVE_ELIGIBILITY_RESULTS = ['ELIGIBLE', 'INELIGIBLE', 'INDETERMINATE'] as const;
export type LeaveEligibilityResult = (typeof LEAVE_ELIGIBILITY_RESULTS)[number];

export const LEAVE_RULE_OUTCOMES = ['PASS', 'FAIL', 'INDETERMINATE', 'NOT_EVALUATED'] as const;
export type LeaveRuleOutcome = (typeof LEAVE_RULE_OUTCOMES)[number];

export interface LeaveEligibilityRuleResult {
  rule: string;
  outcome: LeaveRuleOutcome;
  detail: string;
  authorityCitations: readonly LeaveAuthorityCitation[];
}

export interface LeaveEligibilityMissingFact {
  fact: string;
  detail: string;
}

export interface LeaveEligibilityPeriod {
  dateFrom: string;
  dateTo: string;
}

export interface LeaveEligibilityDateFact {
  date: string;
  policyVersionId: string | null;
  policyVersionNo: number | null;
  calendarBasis: LeaveCalendarBasis | null;
  approvalRouteCode: string | null;
  scheduleAssignmentId: string | null;
  holidayCalendarVersionId: string | null;
  ruleType: 'REST' | 'FIXED' | 'FLEXIBLE' | null;
  requiredMinutes: number | null;
  nonWorkingHoliday: boolean | null;
  holidayEntries: readonly { holidayDate: string; dayType: string }[];
  missing: readonly string[];
}

export interface LeaveEligibilityInput {
  leaveTypeCode: string;
  evaluatorKind: LeaveEvaluatorKind;
  entitlementBasis: LeaveEntitlementBasis;
  calendarBasis: LeaveCalendarBasis;
  ruleParameters: LeaveRuleParameters;
  applicability: {
    profiles: readonly string[];
    excludedProfiles: readonly string[];
  };
  requiredEvidenceKinds: readonly string[];
  providedEvidenceKinds: readonly string[];
  policyDetails: { qualifyingEvent?: LeaveQualifyingEvent };
  commutationChoice: 'REQUESTED' | 'NOT_REQUESTED' | null;
  periods: readonly LeaveEligibilityPeriod[];
  dateFacts: readonly LeaveEligibilityDateFact[];
  accountAvailableQuantity: number | null;
  chargesAccount: boolean;
  authorityCitations: readonly LeaveAuthorityCitation[];
}

export interface LeaveEligibilitySegment {
  policyVersionId: string;
  scheduleAssignmentId: string | null;
  holidayCalendarVersionId: string | null;
  dateFrom: string;
  dateTo: string;
  requestedQuantity: number;
  requestedUnit: string;
  accountQuantity: number | null;
}

export interface LeaveEligibilityOutcome {
  result: LeaveEligibilityResult;
  ruleResults: LeaveEligibilityRuleResult[];
  missingFacts: LeaveEligibilityMissingFact[];
  inputFacts: Record<string, unknown>;
  segments: LeaveEligibilitySegment[];
  requestedQuantity: number | null;
  requestedUnit: string;
}

function rule(
  name: string,
  outcome: LeaveRuleOutcome,
  detail: string,
  authorityCitations: readonly LeaveAuthorityCitation[] = [],
): LeaveEligibilityRuleResult {
  return { rule: name, outcome, detail, authorityCitations };
}

function grantedDaysFor(input: LeaveEligibilityInput): number | undefined {
  const { qualifyingEvent } = input.policyDetails;
  if (!qualifyingEvent) return input.ruleParameters.grantedDays;
  const variant = input.ruleParameters.variants?.find(({ code }) => code === qualifyingEvent);
  return variant?.grantedDays ?? input.ruleParameters.grantedDays;
}

function grantedMonthsFor(input: LeaveEligibilityInput): number | undefined {
  const { qualifyingEvent } = input.policyDetails;
  if (!qualifyingEvent) return input.ruleParameters.grantedMonths;
  const variant = input.ruleParameters.variants?.find(({ code }) => code === qualifyingEvent);
  return variant?.grantedMonths ?? input.ruleParameters.grantedMonths;
}

function dateContribution(fact: LeaveEligibilityDateFact): number {
  if (fact.calendarBasis === 'CALENDAR_DAY') return 1;
  if (fact.calendarBasis === 'SCHEDULED_TIME') return fact.requiredMinutes ?? 0;
  if (fact.calendarBasis === 'WORKING_DAY') {
    if (fact.ruleType === 'REST' || fact.nonWorkingHoliday === true) return 0;
    return 1;
  }
  return 0;
}

export function evaluateLeaveEligibility(input: LeaveEligibilityInput): LeaveEligibilityOutcome {
  const rules: LeaveEligibilityRuleResult[] = [];
  const missing = new Map<string, LeaveEligibilityMissingFact>();
  const addMissing = (fact: string, detail: string) => {
    if (!missing.has(fact)) missing.set(fact, { fact, detail });
  };

  const dateFacts = input.dateFacts;
  const policyDates = dateFacts.filter((fact) => fact.policyVersionId !== null);
  const missingPolicyDates = dateFacts.filter((fact) => fact.policyVersionId === null);

  if (dateFacts.length === 0 || missingPolicyDates.length > 0) {
    for (const fact of missingPolicyDates) {
      addMissing('MISSING_POLICY_VERSION', `No Leave Policy Version covers ${fact.date}.`);
    }
    if (dateFacts.length === 0) {
      addMissing('MISSING_POLICY_VERSION', 'The application has no dated period to evaluate.');
    }
    rules.push(
      rule(
        'LEAVE_POLICY_VERSION',
        'INDETERMINATE',
        'An effective Leave Policy Version is required for every requested date.',
      ),
    );
  } else {
    rules.push(
      rule('LEAVE_POLICY_VERSION', 'PASS', 'Every requested date has a Leave Policy Version.'),
    );
  }

  rules.push(
    rule(
      'PERSONNEL_PROFILE',
      'NOT_EVALUATED',
      `Employee personnel profile is not tracked; the Agency configured ${input.applicability.profiles.join(', ') || 'no'} profile(s).`,
    ),
  );

  for (const kind of input.requiredEvidenceKinds) {
    if (input.providedEvidenceKinds.includes(kind)) {
      rules.push(
        rule(
          `REQUIRED_EVIDENCE:${kind}`,
          'PASS',
          `${kind} evidence is attached.`,
          input.authorityCitations,
        ),
      );
    } else {
      addMissing(`MISSING_EVIDENCE:${kind}`, `Attach the required ${kind} evidence.`);
      rules.push(
        rule(
          `REQUIRED_EVIDENCE:${kind}`,
          'INDETERMINATE',
          `${kind} evidence is required before submission.`,
          input.authorityCitations,
        ),
      );
    }
  }
  if (input.requiredEvidenceKinds.length === 0) {
    rules.push(rule('REQUIRED_EVIDENCE', 'PASS', 'This Leave Type requires no separate evidence.'));
  }

  const commutation = input.ruleParameters.commutation;
  if (commutation === undefined) {
    rules.push(
      rule('COMMUTATION', 'NOT_EVALUATED', 'This Leave Type configures no commutation rule.'),
    );
  } else if (input.commutationChoice === null) {
    addMissing('MISSING_COMMUTATION_CHOICE', 'Choose whether to request commutation.');
    rules.push(
      rule(
        'COMMUTATION',
        'INDETERMINATE',
        'A commutation choice is required by the application form.',
      ),
    );
  } else if (commutation === 'NOT_COMMUTABLE' && input.commutationChoice === 'REQUESTED') {
    rules.push(
      rule(
        'COMMUTATION',
        'FAIL',
        'This Leave Type cannot be commuted to money.',
        input.authorityCitations,
      ),
    );
  } else {
    rules.push(rule('COMMUTATION', 'PASS', `Commutation is ${input.commutationChoice}.`));
  }

  const isEventBound = input.evaluatorKind === 'EVENT_BOUND_ALLOWANCE';
  const eventCodes = [
    ...(input.ruleParameters.qualifyingEvent ? [input.ruleParameters.qualifyingEvent] : []),
    ...(input.ruleParameters.variants ?? []).map(({ code }) => code),
  ];
  if (isEventBound) {
    const selected = input.policyDetails.qualifyingEvent;
    if (!selected) {
      addMissing('MISSING_QUALIFYING_EVENT', 'State the qualifying event for this Leave Type.');
      rules.push(
        rule(
          'QUALIFYING_EVENT',
          'INDETERMINATE',
          'The qualifying event is required for this Leave Type.',
          input.authorityCitations,
        ),
      );
    } else if (!eventCodes.includes(selected)) {
      rules.push(
        rule(
          'QUALIFYING_EVENT',
          'FAIL',
          `${selected} is not an accepted qualifying event for this Leave Type.`,
          input.authorityCitations,
        ),
      );
    } else {
      rules.push(rule('QUALIFYING_EVENT', 'PASS', `${selected} is an accepted qualifying event.`));
    }
  }

  const indeterminateDates = dateFacts.filter((fact) => fact.missing.length > 0);
  let requestedQuantity: number | null = null;
  const requestedUnit = input.calendarBasis;
  let quantityComputable = false;

  if (input.calendarBasis === 'SOURCE_DEFINED') {
    addMissing(
      'SOURCE_DEFINED_QUANTITY_UNSUPPORTED',
      'The accepted sources define this quantity in their own unit, so it cannot be computed yet.',
    );
    rules.push(
      rule(
        'QUANTITY',
        'INDETERMINATE',
        'The requested quantity is defined by the source and is not computable in this unit.',
        input.authorityCitations,
      ),
    );
  } else if (indeterminateDates.length > 0) {
    for (const fact of indeterminateDates) {
      for (const code of fact.missing) {
        addMissing(code, `${code} is unresolved for ${fact.date}.`);
      }
    }
    rules.push(
      rule(
        'QUANTITY',
        'INDETERMINATE',
        `Schedule, holiday, or policy input is unresolved for ${indeterminateDates.length} date(s).`,
      ),
    );
  } else {
    requestedQuantity = dateFacts.reduce((total, fact) => total + dateContribution(fact), 0);
    quantityComputable = true;
    if (requestedQuantity <= 0) {
      rules.push(
        rule('QUANTITY', 'FAIL', 'The requested period contains no chargeable days or minutes.'),
      );
    } else {
      rules.push(
        rule(
          'QUANTITY',
          'PASS',
          `The requested quantity is ${requestedQuantity} ${requestedUnit}.`,
        ),
      );
    }
    const grantedDays = grantedDaysFor(input);
    if (grantedDays !== undefined && requestedQuantity > 0 && requestedQuantity > grantedDays) {
      rules.push(
        rule(
          'ENTITLEMENT_LIMIT',
          'FAIL',
          `The requested quantity exceeds the granted ${grantedDays} day(s).`,
          input.authorityCitations,
        ),
      );
    } else if (grantedDays !== undefined) {
      rules.push(
        rule(
          'ENTITLEMENT_LIMIT',
          'PASS',
          `The requested quantity is within ${grantedDays} day(s).`,
        ),
      );
    } else if (grantedMonthsFor(input) !== undefined) {
      rules.push(
        rule(
          'ENTITLEMENT_LIMIT',
          'NOT_EVALUATED',
          'The entitlement is expressed in months and is certified downstream.',
        ),
      );
    }
  }

  const minimumCredits = input.ruleParameters.minimumAccountCredits;
  if (minimumCredits !== undefined) {
    if (input.accountAvailableQuantity === null) {
      addMissing('MISSING_LEAVE_ACCOUNT', 'The charged Leave Account could not be resolved.');
      rules.push(
        rule(
          'MINIMUM_ACCOUNT_CREDITS',
          'INDETERMINATE',
          `This Leave Type requires at least ${minimumCredits} available credit day(s).`,
          input.authorityCitations,
        ),
      );
    } else if (input.accountAvailableQuantity < minimumCredits) {
      rules.push(
        rule(
          'MINIMUM_ACCOUNT_CREDITS',
          'FAIL',
          `This Leave Type requires at least ${minimumCredits} available credit day(s).`,
          input.authorityCitations,
        ),
      );
    } else {
      rules.push(
        rule(
          'MINIMUM_ACCOUNT_CREDITS',
          'PASS',
          `The charged Leave Account has at least ${minimumCredits} available credit day(s).`,
        ),
      );
    }
  }

  const routeCodes = [
    ...new Set(
      policyDates
        .map((fact) => fact.approvalRouteCode)
        .filter((code): code is string => code !== null && code.length > 0),
    ),
  ];
  if (routeCodes.length === 0) {
    addMissing(
      'MISSING_APPROVAL_ROUTE',
      'No Approval Route code is configured for the requested dates.',
    );
    rules.push(
      rule(
        'APPROVAL_ROUTE',
        'INDETERMINATE',
        'An Approval Route code is required before submission.',
      ),
    );
  } else if (routeCodes.length > 1) {
    addMissing(
      'CONFLICTING_APPROVAL_ROUTE',
      `The requested dates resolve to conflicting Approval Route codes: ${routeCodes.join(', ')}.`,
    );
    rules.push(
      rule(
        'APPROVAL_ROUTE',
        'INDETERMINATE',
        'The requested dates resolve to conflicting Approval Route codes.',
      ),
    );
  } else {
    rules.push(rule('APPROVAL_ROUTE', 'PASS', `Approval Route ${routeCodes[0]} applies.`));
  }

  const segments: LeaveEligibilitySegment[] = [];
  if (quantityComputable) {
    for (const fact of dateFacts) {
      const key = `${fact.policyVersionId}|${fact.scheduleAssignmentId}|${fact.holidayCalendarVersionId}`;
      const contribution = dateContribution(fact);
      const last = segments[segments.length - 1];
      const lastKey = last
        ? `${last.policyVersionId}|${last.scheduleAssignmentId}|${last.holidayCalendarVersionId}`
        : null;
      if (last && lastKey === key) {
        last.dateTo = fact.date;
        last.requestedQuantity += contribution;
      } else {
        segments.push({
          policyVersionId: fact.policyVersionId!,
          scheduleAssignmentId: fact.scheduleAssignmentId,
          holidayCalendarVersionId: fact.holidayCalendarVersionId,
          dateFrom: fact.date,
          dateTo: fact.date,
          requestedQuantity: contribution,
          requestedUnit: fact.calendarBasis ?? requestedUnit,
          accountQuantity: null,
        });
      }
    }
    for (const segment of segments) {
      segment.accountQuantity = input.chargesAccount ? segment.requestedQuantity : null;
    }
  }

  const result: LeaveEligibilityResult = rules.some(({ outcome }) => outcome === 'FAIL')
    ? 'INELIGIBLE'
    : rules.some(({ outcome }) => outcome === 'INDETERMINATE')
      ? 'INDETERMINATE'
      : 'ELIGIBLE';

  const inputFacts: Record<string, unknown> = {
    leaveTypeCode: input.leaveTypeCode,
    evaluatorKind: input.evaluatorKind,
    entitlementBasis: input.entitlementBasis,
    calendarBasis: input.calendarBasis,
    applicability: input.applicability,
    requiredEvidenceKinds: input.requiredEvidenceKinds,
    providedEvidenceKinds: input.providedEvidenceKinds,
    policyDetails: input.policyDetails,
    commutationChoice: input.commutationChoice,
    periods: input.periods,
    requestedUnit,
    requestedQuantity,
    grantedDays: grantedDaysFor(input) ?? null,
    grantedMonths: grantedMonthsFor(input) ?? null,
    minimumAccountCredits: input.ruleParameters.minimumAccountCredits ?? null,
    accountAvailableQuantity: input.accountAvailableQuantity,
    approvalRouteCodes: routeCodes,
    segmentCount: segments.length,
  };

  return {
    result,
    ruleResults: rules,
    missingFacts: [...missing.values()],
    inputFacts,
    segments,
    requestedQuantity,
    requestedUnit,
  };
}
