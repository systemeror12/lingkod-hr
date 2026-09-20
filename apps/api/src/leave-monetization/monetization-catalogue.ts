import { Prisma } from '@prisma/client';

/**
 * National monetization rules from CSC MC No. 41, s. 1998 (ss. 22-24), as
 * amended by CSC MC No. 16, s. 2002, with the conversion factor published by
 * CSC MC No. 2, s. 2016 and adopted by DBM BC No. 2016-2.
 *
 * The national sources leave several facts unresolved. Those facts must come
 * from an agency authority snapshot; the catalogue reports INDETERMINATE
 * instead of filling them with defaults.
 */
export const MONETIZATION_CALCULATOR_KIND = 'MCL_FIXED_FACTOR_0_0481927';
export const MONETIZATION_FACTOR = '0.0481927';
export const REGULAR_MONETIZATION_CITATION =
  'CSC MC No. 41, s. 1998, s. 22 (VL only, at least 15 days, minimum 10 days, retain 5, maximum 30 a year)';
export const SPECIAL_MONETIZATION_CITATION =
  'CSC MC No. 41, s. 1998, s. 23 as amended by CSC MC No. 16, s. 2002 (at least 50% of VL/SL for valid and justifiable reasons)';

export const MONETIZATION_KINDS = ['REGULAR', 'SPECIAL'] as const;
export type MonetizationKind = (typeof MONETIZATION_KINDS)[number];

export const MONETIZATION_ATTESTATION_TYPES = [
  'AUTHENTICATED_SUBMISSION',
  'SIGNED_DOCUMENT',
] as const;
export type MonetizationAttestationType = (typeof MONETIZATION_ATTESTATION_TYPES)[number];

export const MONETIZATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'CREDIT_CERTIFIED',
  'NEEDS_INFORMATION',
  'FOR_APPROVAL',
  'APPROVED',
  'REJECTED',
  'POSTED',
  'WITHDRAWN',
  'CANCELLED',
] as const;
export type MonetizationStatus = (typeof MONETIZATION_STATUSES)[number];

export const MONETIZATION_ASSESSMENT_RESULTS = ['ELIGIBLE', 'INELIGIBLE', 'INDETERMINATE'] as const;
export type MonetizationAssessmentResult = (typeof MONETIZATION_ASSESSMENT_RESULTS)[number];

export const MONETIZATION_FUNDING_RESULTS = ['SUPPORTED', 'UNSUPPORTED', 'INDETERMINATE'] as const;
export type MonetizationFundingResult = (typeof MONETIZATION_FUNDING_RESULTS)[number];

export const MONETIZATION_ADJUSTMENT_SCOPES = ['WHOLE', 'PARTIAL'] as const;
export type MonetizationAdjustmentScope = (typeof MONETIZATION_ADJUSTMENT_SCOPES)[number];

export const MONETIZATION_ADJUSTMENT_STATUSES = [
  'DRAFT',
  'FOR_APPROVAL',
  'APPROVED',
  'APPLIED',
  'REJECTED',
  'BLOCKED',
  'RETRYABLE',
] as const;
export type MonetizationAdjustmentStatus = (typeof MONETIZATION_ADJUSTMENT_STATUSES)[number];

export const REGULAR_MONETIZATION_RULES = {
  leaveTypeCode: 'VACATION_LEAVE',
  minimumPostedBalance: new Prisma.Decimal(15),
  minimumMonetizedQuantity: new Prisma.Decimal(10),
  retainedQuantity: new Prisma.Decimal(5),
  annualLimit: new Prisma.Decimal(30),
} as const;

export const SPECIAL_MONETIZATION_MINIMUM_SHARE = new Prisma.Decimal('0.5');
export const SPECIAL_MONETIZATION_LEAVE_TYPE_CODES = ['VACATION_LEAVE', 'SICK_LEAVE'] as const;

export interface MonetizationAuthoritySnapshot {
  citations: string[];
  valuationDate?: string | undefined;
  fiscalPeriod?: string | undefined;
  salarySourceReference?: string | undefined;
  specialPercentageBasis?: 'PER_ACCOUNT' | 'COMBINED' | undefined;
  fractionalCreditRounding?: 'DOWN' | 'NEAREST' | undefined;
}

export interface MonetizationAccountFacts {
  leaveAccountId: string;
  leaveTypeCode: string;
  postedBalance: Prisma.Decimal;
  activeCommitments: Prisma.Decimal;
}

export interface MonetizationAllocationInput {
  leaveAccountId: string;
  requestedQuantity: Prisma.Decimal;
}

export interface MonetizationAssessmentFacts {
  kind: MonetizationKind;
  reason: string | null;
  accounts: readonly MonetizationAccountFacts[];
  allocations: readonly MonetizationAllocationInput[];
  priorMonetizedQuantityInYear: Prisma.Decimal;
  authoritySnapshot: MonetizationAuthoritySnapshot;
}

export type MonetizationRuleOutcome = 'PASS' | 'FAIL' | 'INDETERMINATE';

export interface MonetizationRuleResult {
  rule: string;
  outcome: MonetizationRuleOutcome;
  message: string;
  citation: string;
}

export interface MonetizationAssessment {
  result: MonetizationAssessmentResult;
  ruleResults: MonetizationRuleResult[];
}

function rule(
  name: string,
  outcome: MonetizationRuleOutcome,
  message: string,
  citation: string,
): MonetizationRuleResult {
  return { rule: name, outcome, message, citation };
}

function availableQuantity(facts: MonetizationAccountFacts): Prisma.Decimal {
  return facts.postedBalance.minus(facts.activeCommitments);
}

function allocationQuantity(allocations: readonly MonetizationAllocationInput[]): Prisma.Decimal {
  return allocations.reduce(
    (total, allocation) => total.plus(allocation.requestedQuantity),
    new Prisma.Decimal(0),
  );
}

/**
 * Pure, explainable eligibility assessment. Callers supply the immutable facts
 * and receive one rule result per check so the stored assessment explains
 * every PASS, FAIL, and INDETERMINATE outcome.
 */
export function assessMonetization(facts: MonetizationAssessmentFacts): MonetizationAssessment {
  return facts.kind === 'REGULAR' ? assessRegular(facts) : assessSpecial(facts);
}

function assessRegular(facts: MonetizationAssessmentFacts): MonetizationAssessment {
  const results: MonetizationRuleResult[] = [];
  const accounts = new Map(facts.accounts.map((account) => [account.leaveAccountId, account]));

  const wrongType = facts.allocations.filter(
    (allocation) =>
      accounts.get(allocation.leaveAccountId)?.leaveTypeCode !==
      REGULAR_MONETIZATION_RULES.leaveTypeCode,
  );
  results.push(
    rule(
      'REGULAR_VL_ONLY',
      wrongType.length === 0 ? 'PASS' : 'FAIL',
      wrongType.length === 0
        ? 'Ordinary monetization draws on vacation leave only.'
        : 'Ordinary monetization covers vacation leave only.',
      REGULAR_MONETIZATION_CITATION,
    ),
  );

  for (const allocation of facts.allocations) {
    const account = accounts.get(allocation.leaveAccountId);
    if (!account) continue;
    const available = availableQuantity(account);
    if (available.lessThan(REGULAR_MONETIZATION_RULES.minimumPostedBalance)) {
      results.push(
        rule(
          'REGULAR_MINIMUM_BALANCE',
          'FAIL',
          'At least 15 vacation-leave days must stand to the credit of the employee.',
          REGULAR_MONETIZATION_CITATION,
        ),
      );
    }
    if (
      available
        .minus(allocation.requestedQuantity)
        .lessThan(REGULAR_MONETIZATION_RULES.retainedQuantity)
    ) {
      results.push(
        rule(
          'REGULAR_RETAIN_FIVE_DAYS',
          'FAIL',
          'At least five vacation-leave days must remain after monetization.',
          REGULAR_MONETIZATION_CITATION,
        ),
      );
    }
  }

  const requested = allocationQuantity(facts.allocations);
  if (requested.lessThan(REGULAR_MONETIZATION_RULES.minimumMonetizedQuantity)) {
    results.push(
      rule(
        'REGULAR_MINIMUM_TEN_DAYS',
        'FAIL',
        'A regular monetization request is at least ten vacation-leave days.',
        REGULAR_MONETIZATION_CITATION,
      ),
    );
  }

  if (
    facts.priorMonetizedQuantityInYear
      .plus(requested)
      .greaterThan(REGULAR_MONETIZATION_RULES.annualLimit)
  ) {
    results.push(
      rule(
        'REGULAR_ANNUAL_LIMIT',
        'FAIL',
        'No more than thirty vacation-leave days may be monetized in a year.',
        REGULAR_MONETIZATION_CITATION,
      ),
    );
  }

  results.push(valuationDateRule(facts.authoritySnapshot));
  return summarize(results);
}

function assessSpecial(facts: MonetizationAssessmentFacts): MonetizationAssessment {
  const results: MonetizationRuleResult[] = [];
  const accounts = new Map(facts.accounts.map((account) => [account.leaveAccountId, account]));

  results.push(
    rule(
      'SPECIAL_VALID_REASON',
      facts.reason && facts.reason.trim().length > 0 ? 'PASS' : 'FAIL',
      'Special monetization requires a valid and justifiable reason.',
      SPECIAL_MONETIZATION_CITATION,
    ),
  );

  const wrongType = facts.allocations.filter(
    (allocation) =>
      !(SPECIAL_MONETIZATION_LEAVE_TYPE_CODES as readonly string[]).includes(
        accounts.get(allocation.leaveAccountId)?.leaveTypeCode ?? '',
      ),
  );
  results.push(
    rule(
      'SPECIAL_VL_SL_ONLY',
      wrongType.length === 0 ? 'PASS' : 'FAIL',
      'Special monetization covers accumulated vacation and sick leave only.',
      SPECIAL_MONETIZATION_CITATION,
    ),
  );

  results.push(
    rule(
      'SPECIAL_PERCENTAGE_BASIS',
      facts.authoritySnapshot.specialPercentageBasis ? 'PASS' : 'INDETERMINATE',
      facts.authoritySnapshot.specialPercentageBasis
        ? 'The authority snapshot states whether the 50% share applies per account or to the combined balance.'
        : 'The national rules do not state whether the 50% share applies per account or to the combined balance.',
      SPECIAL_MONETIZATION_CITATION,
    ),
  );

  results.push(
    rule(
      'SPECIAL_FRACTIONAL_ROUNDING',
      facts.authoritySnapshot.fractionalCreditRounding ? 'PASS' : 'INDETERMINATE',
      facts.authoritySnapshot.fractionalCreditRounding
        ? 'The authority snapshot states how fractional credits are rounded.'
        : 'The national rules do not state how fractional 50% credits are rounded.',
      SPECIAL_MONETIZATION_CITATION,
    ),
  );

  if (
    facts.authoritySnapshot.specialPercentageBasis === 'PER_ACCOUNT' &&
    facts.authoritySnapshot.fractionalCreditRounding
  ) {
    for (const allocation of facts.allocations) {
      const account = accounts.get(allocation.leaveAccountId);
      if (!account) continue;
      const share = applyShare(availableQuantity(account), facts.authoritySnapshot);
      if (allocation.requestedQuantity.greaterThan(share)) {
        results.push(
          rule(
            'SPECIAL_FIFTY_PERCENT_PER_ACCOUNT',
            'FAIL',
            'At most 50% of the account balance may be monetized.',
            SPECIAL_MONETIZATION_CITATION,
          ),
        );
      }
    }
  }

  if (
    facts.authoritySnapshot.specialPercentageBasis === 'COMBINED' &&
    facts.authoritySnapshot.fractionalCreditRounding
  ) {
    const available = facts.accounts.reduce(
      (total, account) => total.plus(availableQuantity(account)),
      new Prisma.Decimal(0),
    );
    const share = applyShare(available, facts.authoritySnapshot);
    if (allocationQuantity(facts.allocations).greaterThan(share)) {
      results.push(
        rule(
          'SPECIAL_FIFTY_PERCENT_COMBINED',
          'FAIL',
          'At most 50% of the combined vacation and sick leave balance may be monetized.',
          SPECIAL_MONETIZATION_CITATION,
        ),
      );
    }
  }

  results.push(valuationDateRule(facts.authoritySnapshot));
  return summarize(results);
}

function applyShare(
  available: Prisma.Decimal,
  snapshot: MonetizationAuthoritySnapshot,
): Prisma.Decimal {
  const share = available.times(SPECIAL_MONETIZATION_MINIMUM_SHARE);
  if (snapshot.fractionalCreditRounding === 'DOWN') {
    return share.toDecimalPlaces(4, Prisma.Decimal.ROUND_DOWN);
  }
  return share.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

function valuationDateRule(snapshot: MonetizationAuthoritySnapshot): MonetizationRuleResult {
  return rule(
    'MONETIZATION_VALUATION_DATE',
    snapshot.valuationDate ? 'PASS' : 'INDETERMINATE',
    snapshot.valuationDate
      ? 'The authority snapshot states the valuation date for salary and balance facts.'
      : 'The national rules do not state whether salary and balance fix at request, approval, release, or payment.',
    'DBM BC No. 2016-2; CSC MC No. 5, s. 2021 (no national MLC valuation-date rule)',
  );
}

function summarize(results: MonetizationRuleResult[]): MonetizationAssessment {
  const result = results.some(({ outcome }) => outcome === 'FAIL')
    ? 'INELIGIBLE'
    : results.some(({ outcome }) => outcome === 'INDETERMINATE')
      ? 'INDETERMINATE'
      : 'ELIGIBLE';
  return { result, ruleResults: results };
}
