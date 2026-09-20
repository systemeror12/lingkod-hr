/**
 * Payroll-owned monetization earning input contract.
 *
 * Leave supplies authority-bound quantities and provenance only. Payroll owns
 * salary resolution, the fixed calculation, rounding, and the immutable
 * Monetization Earning Input. The production binding must fail closed until
 * the Payroll module owns this contract.
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
  adjustmentKey: string;
  monetizationPostingId: string;
  originalPayrollInputId: string;
  scope: 'WHOLE' | 'PARTIAL';
  reversedQuantity: string;
  retainedQuantity: string;
  reason: string;
}

export type MonetizationAdjustmentResult = MonetizationPortAccepted | MonetizationPortFailure;

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

export function isAccepted(
  result: MonetizationEarningInputResult | MonetizationAdjustmentResult,
): result is MonetizationPortAccepted {
  return result.kind === 'ACCEPTED' || result.kind === 'ALREADY_ACCEPTED';
}
