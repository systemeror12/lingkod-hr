import { Inject, Injectable } from '@nestjs/common';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { PayrollInputSubmission } from '../payroll-inputs/payroll-inputs.schemas';
import { PayrollInputsService } from '../payroll-inputs/payroll-inputs.service';
import {
  type MonetizationAdjustmentResult,
  type MonetizationEarningInputRequest,
  type MonetizationEarningInputResult,
  type MonetizationPortActor,
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
    return {
      kind: answer.outcome,
      code: answer.code,
      reason: answer.reason,
      missingFacts: answer.missingFacts ?? [],
    };
  }

  /** Monetization Adjustment binds to the inbox's withdrawal in #357; until then it fails closed. */
  async adjustEarningInput(): Promise<MonetizationAdjustmentResult> {
    return {
      kind: 'INDETERMINATE',
      code: 'PAYROLL_MONETIZATION_AUTHORITY_MISSING',
      reason: 'Payroll has not bound a linked-adjustment contract for monetization earning inputs.',
      missingFacts: ['LINKED_PAYROLL_ADJUSTMENT_CONTRACT'],
    };
  }
}
