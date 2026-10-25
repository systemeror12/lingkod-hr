import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  findLeaveCatalogueEntry,
  parseLeaveRuleParameters,
  type LeaveAuthorityCitation,
} from '../leave-policies/leave-catalogue';

/**
 * Deterministic, pure MANDATORY_CHARGE_FROM_ACCOUNT evaluation for one
 * Employee and calendar year. The service resolves the governing policy, the
 * personnel profile, the vacation Leave Account, its ledger, and its posted
 * allocations; this module only explains the outcome. Missing or unattributable
 * facts fail closed as INDETERMINATE. An assessment reports the obligation; it
 * never posts to the ledger or forfeits credits.
 */

export const MANDATORY_LEAVE_RESULTS = ['SUBJECT', 'NOT_SUBJECT', 'INDETERMINATE'] as const;
export type MandatoryLeaveResult = (typeof MANDATORY_LEAVE_RESULTS)[number];

export type MandatoryLeaveIndeterminateReason =
  | 'MISSING_POLICY'
  | 'UNSUPPORTED_POLICY'
  | 'UNSUPPORTED_PERSONNEL_PROFILE'
  | 'MISSING_VACATION_ACCOUNT'
  | 'AMBIGUOUS_VACATION_ACCOUNT'
  | 'ALLOCATION_NOT_ATTRIBUTABLE';

export type MandatoryLeaveRuleOutcome = 'PASS' | 'FAIL' | 'INDETERMINATE' | 'NOT_EVALUATED';

export interface MandatoryLeaveRuleResult {
  rule: string;
  outcome: MandatoryLeaveRuleOutcome;
  detail: string;
  authorityCitations: readonly LeaveAuthorityCitation[];
}

export interface MandatoryLeavePolicyFact {
  id: string;
  versionNo: number;
  leaveTypeCode: string;
  evaluatorKind: string;
  chargedLeaveTypeCode: string | null;
  ruleParameters: unknown;
}

export interface MandatoryLeaveAccountFact {
  id: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
}

export interface MandatoryLeaveLedgerFact {
  id: string;
  leaveAccountId: string;
  effectiveDate: string;
  quantity: string;
  reversesEntryId: string | null;
}

/** One posted LEAVE_ACCOUNT approval allocation line and its applied cancellations. */
export interface MandatoryLeaveAllocationFact {
  lineId: string;
  leavePostingId: string;
  leaveApplicationVersionId: string;
  leaveAccountId: string;
  dateFrom: string;
  dateTo: string;
  quantity: string;
  unitCode: string;
  /**
   * The line's working dates, rebuilt from the date facts preserved with the
   * posted application, or null when those facts cannot place them.
   */
  workingDates: readonly string[] | null;
  /** Exact-date scopes of applied cancellations (#220). */
  cancellations: readonly { dateFrom: string; dateTo: string; quantity: string }[];
}

export interface MandatoryLeaveEvaluationInput {
  assessmentYear: number;
  /** As-of date inside the assessment year. */
  asOf: string;
  /**
   * The Employee's personnel profile, or null when it is not admitted. LingkodHR
   * does not track Employee profiles yet, so the service derives it from the
   * governing policy's applicability rules.
   */
  personnelProfile: { profile: string | null; basis: 'POLICY_APPLICABILITY' };
  policy: MandatoryLeavePolicyFact | null;
  /** Vacation Leave Accounts whose open period overlaps the year up to the as-of date. */
  vacationAccounts: readonly MandatoryLeaveAccountFact[];
  /** Ledger entries in posting order; the evaluator orders them by effective date. */
  ledgerEntries: readonly MandatoryLeaveLedgerFact[];
  allocations: readonly MandatoryLeaveAllocationFact[];
}

export interface MandatoryLeaveThresholdBasis {
  minimumAccountCredits: string;
  reached: boolean;
  reachedOn: string | null;
  balanceOnReachedDate: string | null;
  /** The ledger entry whose posting first brought the running balance to the minimum. */
  reachedByEntryId: string | null;
  peakBalance: string;
  peakOn: string;
  /** Reversed entries and their reversals, left out of the running balance. */
  excludedReversalEntryIds: string[];
}

export interface MandatoryLeaveInputFacts {
  assessmentYear: number;
  asOf: string;
  personnelProfile: { profile: string | null; basis: 'POLICY_APPLICABILITY' };
  policy: {
    id: string;
    versionNo: number;
    leaveTypeCode: string;
    evaluatorKind: string;
    chargedLeaveTypeCode: string | null;
    requiredWorkingDays: string | null;
    minimumAccountCredits: string | null;
    authorityCitations: readonly LeaveAuthorityCitation[];
  } | null;
  vacationAccount: MandatoryLeaveAccountFact | null;
  vacationAccountCandidateIds: string[];
  thresholdBasis: MandatoryLeaveThresholdBasis | null;
  balanceFacts: {
    openingBalance: string;
    balanceAsOf: string;
    ledgerEntryIds: string[];
  } | null;
  fulfillmentFacts: {
    allocations: {
      lineId: string;
      leavePostingId: string;
      leaveApplicationVersionId: string;
      dateFrom: string;
      dateTo: string;
      quantity: string;
      cancelledQuantity: string;
      netQuantity: string;
      /** Net working dates counted in the year, or null for an in-year line that cannot be placed. */
      countedDates: string[] | null;
      countedQuantity: string;
    }[];
    unattributableLineIds: string[];
  } | null;
  indeterminateReasons: MandatoryLeaveIndeterminateReason[];
}

export interface MandatoryLeaveEvaluation {
  result: MandatoryLeaveResult;
  policyVersionId: string | null;
  leaveAccountId: string | null;
  requiredQuantity: string | null;
  fulfilledQuantity: string | null;
  indeterminateReasons: MandatoryLeaveIndeterminateReason[];
  materialFingerprint: string;
  inputFacts: MandatoryLeaveInputFacts;
  ruleResults: MandatoryLeaveRuleResult[];
}

const ZERO = new Prisma.Decimal(0);

export function evaluateMandatoryLeave(
  input: MandatoryLeaveEvaluationInput,
): MandatoryLeaveEvaluation {
  const citations = findLeaveCatalogueEntry('MANDATORY_LEAVE')?.authorityCitations ?? [];
  const supportedProfiles = findLeaveCatalogueEntry('MANDATORY_LEAVE')?.personnelProfiles ?? [];
  const yearStart = `${input.assessmentYear}-01-01`;
  const yearEnd = `${input.assessmentYear}-12-31`;
  const reasons: MandatoryLeaveIndeterminateReason[] = [];
  const rules: MandatoryLeaveRuleResult[] = [];
  const rule = (
    name: string,
    outcome: MandatoryLeaveRuleOutcome,
    detail: string,
    authorityCitations: readonly LeaveAuthorityCitation[] = [],
  ) => rules.push({ rule: name, outcome, detail, authorityCitations });

  // Governing policy and its thresholds.
  const thresholds = input.policy ? policyThresholds(input.policy) : null;
  if (!input.policy) {
    reasons.push('MISSING_POLICY');
    rule(
      'LEAVE_POLICY_VERSION',
      'INDETERMINATE',
      `No MANDATORY_LEAVE Leave Policy Version governs ${input.asOf}.`,
    );
  } else if (!thresholds) {
    reasons.push('UNSUPPORTED_POLICY');
    rule(
      'LEAVE_POLICY_VERSION',
      'INDETERMINATE',
      `Leave Policy Version ${input.policy.versionNo} does not state a MANDATORY_CHARGE_FROM_ACCOUNT rule with a charged Leave Type, required working days, and minimum account credits.`,
    );
  } else {
    rule(
      'LEAVE_POLICY_VERSION',
      'PASS',
      `Leave Policy Version ${input.policy.versionNo} requires ${formatQuantity(thresholds.required)} working days once the ${input.policy.chargedLeaveTypeCode} balance reaches ${formatQuantity(thresholds.minimum)}.`,
      citations,
    );
  }

  // Personnel profile.
  const profile = input.personnelProfile.profile;
  const profileAdmitted =
    profile !== null && (supportedProfiles as readonly string[]).includes(profile);
  if (!input.policy) {
    rule('PERSONNEL_PROFILE', 'NOT_EVALUATED', 'Requires a governing policy.');
  } else if (profileAdmitted) {
    rule(
      'PERSONNEL_PROFILE',
      'PASS',
      `The governing policy admits the ${profile} profile; Employee profiles are not tracked.`,
    );
  } else {
    reasons.push('UNSUPPORTED_PERSONNEL_PROFILE');
    rule(
      'PERSONNEL_PROFILE',
      'INDETERMINATE',
      `Mandatory leave is evaluated only for ${supportedProfiles.join(', ')}; the governing policy does not admit it.`,
    );
  }

  // Vacation Leave Account.
  const account = input.vacationAccounts.length === 1 ? input.vacationAccounts[0]! : null;
  if (input.vacationAccounts.length === 0) {
    reasons.push('MISSING_VACATION_ACCOUNT');
    rule(
      'VACATION_LEAVE_ACCOUNT',
      'INDETERMINATE',
      `No vacation Leave Account was open between ${yearStart} and ${input.asOf}.`,
    );
  } else if (!account) {
    reasons.push('AMBIGUOUS_VACATION_ACCOUNT');
    rule(
      'VACATION_LEAVE_ACCOUNT',
      'INDETERMINATE',
      `${input.vacationAccounts.length} vacation Leave Accounts were open between ${yearStart} and ${input.asOf}.`,
    );
  } else {
    rule('VACATION_LEAVE_ACCOUNT', 'PASS', `Vacation Leave Account ${account.id} is used.`);
  }

  // Threshold: the posted balance reached the minimum at any point from January 1
  // to the as-of date. The running balance takes entries in effective-date order,
  // then posting order, so a reached threshold stays reached. A reversal exactly
  // negates its original, so both leave the running balance.
  let thresholdBasis: MandatoryLeaveThresholdBasis | null = null;
  let balanceFacts: MandatoryLeaveInputFacts['balanceFacts'] = null;
  if (account && thresholds && profileAdmitted) {
    const entries = input.ledgerEntries.filter(
      (item) => item.leaveAccountId === account.id && item.effectiveDate <= input.asOf,
    );
    // Each reversal chain cancels in pairs. An odd chain, where a reversal was
    // itself reversed, keeps only its first entry: the original is reinstated.
    const ids = new Set(entries.map((item) => item.id));
    const reversalOf = new Map(
      entries.flatMap((item) => (item.reversesEntryId ? [[item.reversesEntryId, item]] : [])),
    );
    const excluded: string[] = [];
    let pairs = 0;
    for (const root of entries) {
      if (root.reversesEntryId && ids.has(root.reversesEntryId)) continue;
      const chain = [root];
      for (let next = reversalOf.get(root.id); next; next = reversalOf.get(next.id)) {
        chain.push(next);
      }
      pairs += Math.floor(chain.length / 2);
      excluded.push(...chain.slice(chain.length % 2).map((item) => item.id));
    }
    excluded.sort();
    const counted = entries.filter((item) => !excluded.includes(item.id));
    const opening = sum(counted.filter((item) => item.effectiveDate < yearStart));
    // Array sort is stable, so posting order holds within one effective date.
    const running = counted
      .filter((item) => item.effectiveDate >= yearStart)
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    let balance = opening;
    let peak = { balance: opening, date: yearStart };
    let reached = opening.gte(thresholds.minimum)
      ? { balance: opening, date: yearStart, entryId: null as string | null }
      : null;
    for (const item of running) {
      balance = balance.plus(item.quantity);
      if (balance.gt(peak.balance)) peak = { balance, date: item.effectiveDate };
      if (!reached && balance.gte(thresholds.minimum)) {
        reached = { balance, date: item.effectiveDate, entryId: item.id };
      }
    }
    thresholdBasis = {
      minimumAccountCredits: formatQuantity(thresholds.minimum),
      reached: reached !== null,
      reachedOn: reached?.date ?? null,
      balanceOnReachedDate: reached ? formatQuantity(reached.balance) : null,
      reachedByEntryId: reached?.entryId ?? null,
      peakBalance: formatQuantity(peak.balance),
      peakOn: peak.date,
      excludedReversalEntryIds: excluded,
    };
    balanceFacts = {
      openingBalance: formatQuantity(opening),
      balanceAsOf: formatQuantity(balance),
      ledgerEntryIds: entries.map((item) => item.id).sort(),
    };
    const order =
      'The running balance takes posted entries in effective-date order, then posting order';
    const method =
      pairs > 0
        ? `${order}, and leaves out ${pairs} reversed ${pairs === 1 ? 'entry and its reversal' : 'entries and their reversals'}.`
        : `${order}.`;
    rule(
      'BALANCE_THRESHOLD',
      reached ? 'PASS' : 'FAIL',
      reached
        ? `The posted vacation balance reached ${formatQuantity(reached.balance)} on ${reached.date}${reached.entryId ? ` with ledger entry ${reached.entryId}` : ''}, at least ${formatQuantity(thresholds.minimum)}. ${method}`
        : `The posted vacation balance peaked at ${formatQuantity(peak.balance)} on ${peak.date}, below ${formatQuantity(thresholds.minimum)}. ${method}`,
      citations,
    );
  } else {
    rule(
      'BALANCE_THRESHOLD',
      'NOT_EVALUATED',
      'Requires a governing policy, an admitted personnel profile, and one vacation Leave Account.',
    );
  }

  // Fulfillment: posted working days charged to the vacation account in the year.
  let fulfillmentFacts: MandatoryLeaveInputFacts['fulfillmentFacts'] = null;
  let fulfilled: Prisma.Decimal | null = null;
  if (account && thresholdBasis) {
    const contributing: NonNullable<MandatoryLeaveInputFacts['fulfillmentFacts']>['allocations'] =
      [];
    const unattributable: string[] = [];
    for (const line of input.allocations) {
      if (line.leaveAccountId !== account.id) continue;
      if (line.dateTo < yearStart || line.dateFrom > yearEnd) continue;
      const cancelled = line.cancellations.reduce(
        (total, scope) => total.plus(scope.quantity),
        ZERO,
      );
      const net = new Prisma.Decimal(line.quantity).minus(cancelled);
      if (net.lte(ZERO)) continue;
      if (line.unitCode !== 'WORKING_DAY') {
        unattributable.push(line.lineId);
        continue;
      }
      // A line inside the year counts its net quantity even when its dates
      // cannot be placed; a line crossing the year needs every date placed.
      const netDates = placeNetWorkingDates(line);
      const countedDates =
        netDates?.filter((date) => date >= yearStart && date <= yearEnd) ?? null;
      if (!countedDates && (line.dateFrom < yearStart || line.dateTo > yearEnd)) {
        unattributable.push(line.lineId);
        continue;
      }
      const counted = countedDates ? new Prisma.Decimal(countedDates.length) : net;
      if (counted.lte(ZERO)) continue;
      contributing.push({
        lineId: line.lineId,
        leavePostingId: line.leavePostingId,
        leaveApplicationVersionId: line.leaveApplicationVersionId,
        dateFrom: line.dateFrom,
        dateTo: line.dateTo,
        quantity: formatQuantity(new Prisma.Decimal(line.quantity)),
        cancelledQuantity: formatQuantity(cancelled),
        netQuantity: formatQuantity(net),
        countedDates,
        countedQuantity: formatQuantity(counted),
      });
    }
    contributing.sort(
      (a, b) => a.dateFrom.localeCompare(b.dateFrom) || a.lineId.localeCompare(b.lineId),
    );
    unattributable.sort();
    fulfillmentFacts = { allocations: contributing, unattributableLineIds: unattributable };
    fulfilled = contributing.reduce((total, line) => total.plus(line.countedQuantity), ZERO);
    if (unattributable.length > 0) {
      reasons.push('ALLOCATION_NOT_ATTRIBUTABLE');
      rule(
        'FULFILLMENT',
        'INDETERMINATE',
        `${unattributable.length} posted allocation line(s) are not in working days, or cross the year boundary without exactly placeable working dates, so their working dates in ${input.assessmentYear} cannot be counted.`,
      );
    } else if (!thresholdBasis.reached) {
      rule(
        'FULFILLMENT',
        'NOT_EVALUATED',
        `No obligation applies; ${formatQuantity(fulfilled)} working days of vacation leave are posted in ${input.assessmentYear}.`,
      );
    } else {
      const met = fulfilled.gte(thresholds!.required);
      rule(
        'FULFILLMENT',
        met ? 'PASS' : 'FAIL',
        `${formatQuantity(fulfilled)} of ${formatQuantity(thresholds!.required)} required working days of vacation leave are posted in ${input.assessmentYear}.`,
        citations,
      );
    }
  } else {
    rule(
      'FULFILLMENT',
      'NOT_EVALUATED',
      'Requires a governing policy, an admitted personnel profile, and one vacation Leave Account.',
    );
  }

  const result: MandatoryLeaveResult =
    reasons.length > 0 ? 'INDETERMINATE' : thresholdBasis?.reached ? 'SUBJECT' : 'NOT_SUBJECT';
  const requiredQuantity = result === 'SUBJECT' ? formatQuantity(thresholds!.required) : null;
  const fulfilledQuantity =
    result === 'INDETERMINATE' || !fulfilled ? null : formatQuantity(fulfilled);
  const policyVersionId = input.policy?.id ?? null;
  const leaveAccountId = account?.id ?? null;

  const inputFacts: MandatoryLeaveInputFacts = {
    assessmentYear: input.assessmentYear,
    asOf: input.asOf,
    personnelProfile: input.personnelProfile,
    policy: input.policy
      ? {
          id: input.policy.id,
          versionNo: input.policy.versionNo,
          leaveTypeCode: input.policy.leaveTypeCode,
          evaluatorKind: input.policy.evaluatorKind,
          chargedLeaveTypeCode: input.policy.chargedLeaveTypeCode,
          requiredWorkingDays: thresholds ? formatQuantity(thresholds.required) : null,
          minimumAccountCredits: thresholds ? formatQuantity(thresholds.minimum) : null,
          authorityCitations: citations,
        }
      : null,
    vacationAccount: account,
    vacationAccountCandidateIds: input.vacationAccounts.map((item) => item.id).sort(),
    thresholdBasis,
    balanceFacts,
    fulfillmentFacts,
    indeterminateReasons: reasons,
  };

  return {
    result,
    policyVersionId,
    leaveAccountId,
    requiredQuantity,
    fulfilledQuantity,
    indeterminateReasons: reasons,
    materialFingerprint: fingerprint({
      result,
      policyVersionId,
      leaveAccountId,
      requiredQuantity,
      fulfilledQuantity,
      // The peak balance only explains a NOT_SUBJECT result; it is not material.
      thresholdBasis: thresholdBasis && {
        minimumAccountCredits: thresholdBasis.minimumAccountCredits,
        reachedOn: thresholdBasis.reachedOn,
        balanceOnReachedDate: thresholdBasis.balanceOnReachedDate,
      },
      indeterminateReasons: reasons,
    }),
    inputFacts,
    ruleResults: rules,
  };
}

/**
 * The line's working dates net of its applied cancellations, or null unless
 * every charged and cancelled day lands on an exact working date: the line
 * charges all of its working dates, and each cancellation scope cancels all of
 * the working dates inside its range.
 */
function placeNetWorkingDates(line: MandatoryLeaveAllocationFact): string[] | null {
  if (!line.workingDates || !new Prisma.Decimal(line.quantity).equals(line.workingDates.length)) {
    return null;
  }
  let remaining = [...line.workingDates];
  for (const scope of line.cancellations) {
    const inScope = (date: string) => date >= scope.dateFrom && date <= scope.dateTo;
    const cancelled = remaining.filter(inScope);
    if (!new Prisma.Decimal(scope.quantity).equals(cancelled.length)) return null;
    remaining = remaining.filter((date) => !inScope(date));
  }
  return remaining;
}

function policyThresholds(
  policy: MandatoryLeavePolicyFact,
): { required: Prisma.Decimal; minimum: Prisma.Decimal } | null {
  if (policy.evaluatorKind !== 'MANDATORY_CHARGE_FROM_ACCOUNT') return null;
  if (!policy.chargedLeaveTypeCode) return null;
  const parsed = parseLeaveRuleParameters(policy.ruleParameters);
  if (!parsed.success) return null;
  const { requiredWorkingDays, minimumAccountCredits } = parsed.data;
  if (requiredWorkingDays === undefined || minimumAccountCredits === undefined) return null;
  return {
    required: new Prisma.Decimal(requiredWorkingDays),
    minimum: new Prisma.Decimal(minimumAccountCredits),
  };
}

function sum(entries: readonly MandatoryLeaveLedgerFact[]): Prisma.Decimal {
  return entries.reduce((total, item) => total.plus(item.quantity), ZERO);
}

function formatQuantity(value: Prisma.Decimal): string {
  return value.toFixed(4);
}

function fingerprint(material: unknown): string {
  return createHash('sha256').update(canonicalJson(material)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
