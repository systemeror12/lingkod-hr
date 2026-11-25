/**
 * Payroll-owned monetization earning input contract.
 *
 * Leave supplies authority-bound quantities and provenance only. Payroll owns
 * salary resolution, the fixed calculation, rounding, and the immutable
 * Monetization Earning Input in its inbox (`PayrollInboxMonetizationAdapter`).
 */
export interface MonetizationPortActor {
  agencyId: string;
  userId: string;
  membershipId: string;
}

export interface MonetizationEarningAllocation {
  leaveAccountId: string;
  leaveTypeCode: string;
  policyVersionId: string;
  quantity: string;
}

export interface MonetizationEarningInputRequest {
  agencyId: string;
  employeeId: string;
  postingKey: string;
  monetizationRequestId: string;
  monetizationRequestVersionId: string;
  fundingDeterminationId: string;
  approvalRequestId: string;
  valuationDate: string;
  fiscalPeriod: string | null;
  calculatorKind: string;
  factor: string;
  quantity: string;
  allocations: readonly MonetizationEarningAllocation[];
  authoritySnapshot: unknown;
  fundingSnapshot: unknown;
  approvalSnapshot: unknown;
}

export type MonetizationPortFailureKind = 'REJECTED' | 'RETRYABLE_FAILURE' | 'INDETERMINATE';

export interface MonetizationPortAccepted {
  kind: 'ACCEPTED' | 'ALREADY_ACCEPTED';
  payrollInputId: string;
  amount: string;
  payrollResult: unknown;
}

export interface MonetizationPortFailure {
  kind: MonetizationPortFailureKind;
  code: string;
  reason: string;
  missingFacts: string[];
}

export type MonetizationEarningInputResult = MonetizationPortAccepted | MonetizationPortFailure;

export interface MonetizationAdjustmentRequest {
  agencyId: string;
  employeeId: string;
  adjustmentId: string;
  /** The stable correction key; a retry of the same adjustment sends it again. */
  adjustmentKey: string;
  monetizationPostingId: string;
  originalPayrollInputId: string;
  scope: 'WHOLE' | 'PARTIAL';
  reversedQuantity: string;
  retainedQuantity: string;
  reason: string;
  /** The posting's valuation provenance, which a retained replacement keeps. */
  valuationDate: string;
  calculatorKind: string;
  factor: string;
}

/**
 * Payroll's acceptance of a Monetization Adjustment: the original input when
 * no credits are retained, else the `PENDING` replacement Payroll valued for
 * the retained credits. The original is `CANCELLED`, or stays `CONSUMED` when
 * a finalized payroll paid it and its withdrawal waits in a Payroll
 * Adjustment, which `payrollResult` names (#650).
 */
export interface MonetizationAdjustmentAccepted {
  kind: 'ACCEPTED' | 'ALREADY_ACCEPTED';
  payrollInputId: string;
  status: 'CANCELLED' | 'CONSUMED' | 'PENDING';
  amount: string | null;
  payrollResult: unknown;
}

export type MonetizationAdjustmentResult = MonetizationAdjustmentAccepted | MonetizationPortFailure;

export interface PayrollMonetizationPort {
  submitEarningInput(
    actor: MonetizationPortActor,
    request: MonetizationEarningInputRequest,
  ): Promise<MonetizationEarningInputResult>;

  adjustEarningInput(
    actor: MonetizationPortActor,
    request: MonetizationAdjustmentRequest,
  ): Promise<MonetizationAdjustmentResult>;
}

export const PAYROLL_MONETIZATION_PORT = Symbol('PAYROLL_MONETIZATION_PORT');

export function isAccepted<
  Result extends MonetizationEarningInputResult | MonetizationAdjustmentResult,
>(result: Result): result is Extract<Result, { kind: 'ACCEPTED' | 'ALREADY_ACCEPTED' }> {
  return result.kind === 'ACCEPTED' || result.kind === 'ALREADY_ACCEPTED';
}
