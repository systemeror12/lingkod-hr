import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { PayrollInputSubmission } from '../payroll-inputs/payroll-inputs.schemas';
import { PayrollInputsService } from '../payroll-inputs/payroll-inputs.service';
import {
  type MonetizationAdjustmentRequest,
  type MonetizationAdjustmentResult,
  type MonetizationEarningInputRequest,
  type MonetizationEarningInputResult,
  type MonetizationPortActor,
  type MonetizationPortFailure,
  type PayrollMonetizationPort,
} from './payroll-monetization.port';

/**
 * Leave's binding to the Payroll Input inbox (payroll-schema.md §4). Leave
 * posts the approved credit quantity and its provenance as one
 * `MONETIZATION_EARNING` input keyed by the posting key; Payroll resolves the
 * salary, applies the fixed calculation and rounding, and answers with the
 * amount, or fails closed naming each missing fact.
 */
@Injectable()
export class PayrollInboxMonetizationAdapter implements PayrollMonetizationPort {
  constructor(@Inject(PayrollInputsService) private readonly payrollInputs: PayrollInputsService) {}

  async submitEarningInput(
    actor: MonetizationPortActor,
    request: MonetizationEarningInputRequest,
  ): Promise<MonetizationEarningInputResult> {
    const answer = await withDatabaseContext(
      { agencyId: request.agencyId, userId: actor.userId, membershipId: actor.membershipId },
      (transaction) =>
        this.payrollInputs.acceptInTransaction(transaction, {
          agencyId: request.agencyId,
          employeeId: request.employeeId,
          sourceModule: 'LEAVE',
          inputKind: 'MONETIZATION_EARNING',
          sourceKey: request.postingKey,
          sourceType: 'MONETIZATION_POSTING',
          sourceId: request.monetizationRequestVersionId,
          effectiveDate: request.valuationDate,
          quantity: request.quantity,
          payload: {
            postingKey: request.postingKey,
            monetizationRequestId: request.monetizationRequestId,
            monetizationRequestVersionId: request.monetizationRequestVersionId,
            fundingDeterminationId: request.fundingDeterminationId,
            approvalRequestId: request.approvalRequestId,
            calculatorKind: request.calculatorKind,
            factor: request.factor,
            valuationDate: request.valuationDate,
            fiscalPeriod: request.fiscalPeriod,
            allocations: request.allocations,
            authoritySnapshot: request.authoritySnapshot,
            fundingSnapshot: request.fundingSnapshot,
            approvalSnapshot: request.approvalSnapshot,
          } as unknown as PayrollInputSubmission['payload'],
        }),
    );
    if (!('code' in answer)) {
      if (answer.amount === undefined) {
        throw new Error('Payroll accepted a Monetization Earning Input without an amount.');
      }
      return {
        kind: answer.outcome,
        payrollInputId: answer.payrollInputId,
        amount: answer.amount,
        payrollResult: answer,
      };
    }
    return refusal(answer);
  }

  /**
   * Answer a Monetization Adjustment through the inbox's withdrawal, keyed by
   * the adjustment (#357). Payroll cancels the posted input; credits the
   * adjustment retains come back as a replacement input that Payroll values
   * like the original. The cancellation and its replacement commit together,
   * so a refused replacement leaves the posted input `PENDING`.
   */
  async adjustEarningInput(
    actor: MonetizationPortActor,
    request: MonetizationAdjustmentRequest,
  ): Promise<MonetizationAdjustmentResult> {
    try {
      return await withDatabaseContext(
        { agencyId: request.agencyId, userId: actor.userId, membershipId: actor.membershipId },
        async (transaction): Promise<MonetizationAdjustmentResult> => {
          const withdrawal = await this.payrollInputs.withdrawInTransaction(transaction, {
            agencyId: request.agencyId,
            sourceModule: 'LEAVE',
            payrollInputId: request.originalPayrollInputId,
            correctionKey: request.adjustmentKey,
          });
          if ('code' in withdrawal) return refusal(withdrawal);
          if (!new Prisma.Decimal(request.retainedQuantity).greaterThan(0)) {
            const deferred = 'payrollAdjustmentId' in withdrawal;
            return {
              kind:
                withdrawal.outcome === 'WITHDRAWN' || withdrawal.outcome === 'DEFERRED'
                  ? 'ACCEPTED'
                  : 'ALREADY_ACCEPTED',
              payrollInputId: withdrawal.payrollInputId,
              status: deferred ? 'CONSUMED' : 'CANCELLED',
              amount: null,
              payrollResult: { withdrawal },
            };
          }
          const replacement = await this.payrollInputs.acceptInTransaction(transaction, {
            agencyId: request.agencyId,
            employeeId: request.employeeId,
            sourceModule: 'LEAVE',
            inputKind: 'MONETIZATION_EARNING',
            sourceKey: request.adjustmentKey,
            sourceType: 'MONETIZATION_ADJUSTMENT',
            sourceId: request.adjustmentId,
            effectiveDate: request.valuationDate,
            quantity: request.retainedQuantity,
            replacesPayrollInputId: request.originalPayrollInputId,
            payload: {
              adjustmentKey: request.adjustmentKey,
              monetizationAdjustmentId: request.adjustmentId,
              monetizationPostingId: request.monetizationPostingId,
              scope: request.scope,
              reversedQuantity: request.reversedQuantity,
              retainedQuantity: request.retainedQuantity,
              reason: request.reason,
              calculatorKind: request.calculatorKind,
              factor: request.factor,
              valuationDate: request.valuationDate,
            },
          });
          if ('code' in replacement) throw new ReplacementRefused(refusal(replacement));
          return {
            kind: replacement.outcome,
            payrollInputId: replacement.payrollInputId,
            status: 'PENDING',
            amount: replacement.amount ?? null,
            payrollResult: { withdrawal, replacement },
          };
        },
      );
    } catch (error) {
      if (error instanceof ReplacementRefused) return error.answer;
      throw error;
    }
  }
}

/** Rolls back the withdrawal when Payroll refuses its replacement. */
class ReplacementRefused extends Error {
  constructor(readonly answer: MonetizationPortFailure) {
    super(answer.reason);
  }
}

function refusal(answer: {
  outcome: 'REJECTED' | 'RETRYABLE_FAILURE';
  code: string;
  reason: string;
  missingFacts?: string[];
}): MonetizationPortFailure {
  return {
    kind: answer.outcome,
    code: answer.code,
    reason: answer.reason,
    missingFacts: answer.missingFacts ?? [],
  };
}
