import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { withDatabaseContext } from '@lingkod-hr/database';
import { isUniqueViolation } from './monetization-support';
import {
  type MonetizationAdjustmentRequest,
  type MonetizationAdjustmentResult,
  type MonetizationEarningInputRequest,
  type MonetizationEarningInputResult,
  type MonetizationPortAccepted,
  type MonetizationPortActor,
  type MonetizationPortFailure,
  type MonetizationPortFailureKind,
  type PayrollMonetizationPort,
} from './payroll-monetization.port';

/**
 * Payroll-owned authority that resolves the highest monthly salary and the
 * rounding rule for a valuation date. Leave code never supplies either value.
 */
export interface MonetizationSalarySource {
  resolve(input: {
    agencyId: string;
    employeeId: string;
    valuationDate: string;
  }): Promise<MonetizationSalaryResolution | null>;
}

export interface MonetizationSalaryResolution {
  monthlySalary: string;
  sourceReference: string;
  salarySourceSnapshot: unknown;
  rounding: {
    kind: 'HALF_UP_2DP';
    snapshot: unknown;
  };
}

export const MONETIZATION_SALARY_SOURCE = Symbol('MONETIZATION_SALARY_SOURCE');

function failure(
  kind: MonetizationPortFailureKind,
  code: string,
  reason: string,
  missingFacts: string[] = [],
): MonetizationPortFailure {
  return { kind, code, reason, missingFacts };
}

function roundAmount(
  unrounded: Prisma.Decimal,
  rounding: MonetizationSalaryResolution['rounding'],
): Prisma.Decimal {
  switch (rounding.kind) {
    case 'HALF_UP_2DP':
      return unrounded.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }
}

function computeAmount(
  monthlySalary: string,
  quantity: string,
  factor: string,
  rounding: MonetizationSalaryResolution['rounding'],
): { amount: Prisma.Decimal; calculationSnapshot: Prisma.JsonObject } {
  const unrounded = new Prisma.Decimal(monthlySalary)
    .times(new Prisma.Decimal(quantity))
    .times(new Prisma.Decimal(factor));
  const amount = roundAmount(unrounded, rounding);
  return {
    amount,
    calculationSnapshot: {
      monthlySalary: new Prisma.Decimal(monthlySalary).toFixed(2),
      quantity: new Prisma.Decimal(quantity).toFixed(4),
      factor: new Prisma.Decimal(factor).toFixed(7),
      unrounded: unrounded.toFixed(10),
      rounded: amount.toFixed(2),
      rounding: rounding.kind,
    },
  };
}

function acceptedFromRow(row: {
  id: string;
  amount: Prisma.Decimal;
  payloadSnapshot: Prisma.JsonValue;
}): MonetizationPortAccepted {
  return {
    kind: 'ALREADY_ACCEPTED',
    payrollInputId: row.id,
    amount: row.amount.toFixed(2),
    payrollResult: row.payloadSnapshot,
  };
}

/**
 * Phase-local determinate Payroll binding. It writes the real immutable
 * Monetization Earning Input rows and is replaced when the Payroll module owns
 * `payroll_inputs`. Tests bind it with a determinate salary source; production
 * never binds it.
 */
@Injectable()
export class LocalPayrollMonetizationAdapter implements PayrollMonetizationPort {
  constructor(
    @Inject(MONETIZATION_SALARY_SOURCE)
    private readonly salarySource: MonetizationSalarySource,
  ) {}

  async submitEarningInput(
    actor: MonetizationPortActor,
    request: MonetizationEarningInputRequest,
  ): Promise<MonetizationEarningInputResult> {
    const salary = await this.salarySource.resolve({
      agencyId: request.agencyId,
      employeeId: request.employeeId,
      valuationDate: request.valuationDate,
    });
    if (!salary) {
      return failure(
        'INDETERMINATE',
        'PAYROLL_SALARY_SOURCE_MISSING',
        'No authoritative highest-monthly-salary source resolves for the valuation date.',
        ['AUTHORITATIVE_SALARY_SOURCE'],
      );
    }
    const { amount, calculationSnapshot } = computeAmount(
      salary.monthlySalary,
      request.quantity,
      request.factor,
      salary.rounding,
    );
    if (amount.isNegative()) {
      return failure(
        'REJECTED',
        'PAYROLL_AMOUNT_INVALID',
        'The fixed calculation produced a negative amount.',
      );
    }
    const payloadSnapshot = {
      postingKey: request.postingKey,
      monetizationRequestId: request.monetizationRequestId,
      monetizationRequestVersionId: request.monetizationRequestVersionId,
      fundingDeterminationId: request.fundingDeterminationId,
      approvalRequestId: request.approvalRequestId,
      calculatorKind: request.calculatorKind,
      factor: new Prisma.Decimal(request.factor).toFixed(7),
      valuationDate: request.valuationDate,
      fiscalPeriod: request.fiscalPeriod,
      allocations: request.allocations.map((allocation) => ({
        leaveAccountId: allocation.leaveAccountId,
        leaveTypeCode: allocation.leaveTypeCode,
        policyVersionId: allocation.policyVersionId,
        quantity: new Prisma.Decimal(allocation.quantity).toFixed(4),
      })),
      authoritySnapshot: request.authoritySnapshot as Prisma.JsonValue,
      fundingSnapshot: request.fundingSnapshot as Prisma.JsonValue,
      approvalSnapshot: request.approvalSnapshot as Prisma.JsonValue,
      salarySourceReference: salary.sourceReference,
    };
    const databaseContext = {
      agencyId: request.agencyId,
      userId: actor.userId,
      membershipId: actor.membershipId,
    };
    try {
      const row = await withDatabaseContext(databaseContext, (transaction) =>
        transaction.payrollMonetizationEarningInput.create({
          data: {
            agencyId: request.agencyId,
            employeeId: request.employeeId,
            sourceType: 'MONETIZATION_POSTING',
            sourceId: request.monetizationRequestVersionId,
            sourceVersionKey: request.postingKey,
            status: 'PENDING',
            quantity: new Prisma.Decimal(request.quantity),
            amount,
            effectiveDate: new Date(`${request.valuationDate}T00:00:00.000Z`),
            valuationDate: new Date(`${request.valuationDate}T00:00:00.000Z`),
            calculatorKind: request.calculatorKind,
            factor: new Prisma.Decimal(request.factor),
            salarySourceSnapshot: salary.salarySourceSnapshot as Prisma.InputJsonValue,
            roundingSnapshot: salary.rounding.snapshot as Prisma.InputJsonValue,
            calculationSnapshot,
            payloadSnapshot,
            createdByMembershipId: actor.membershipId,
          },
          select: { id: true, amount: true, payloadSnapshot: true },
        }),
      );
      return {
        kind: 'ACCEPTED',
        payrollInputId: row.id,
        amount: row.amount.toFixed(2),
        payrollResult: row.payloadSnapshot,
      };
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await withDatabaseContext(databaseContext, (transaction) =>
        transaction.payrollMonetizationEarningInput.findFirst({
          where: {
            agencyId: request.agencyId,
            sourceType: 'MONETIZATION_POSTING',
            sourceId: request.monetizationRequestVersionId,
            sourceVersionKey: request.postingKey,
          },
          select: { id: true, amount: true, payloadSnapshot: true },
        }),
      );
      if (!existing) throw error;
      return acceptedFromRow(existing);
    }
  }

  async adjustEarningInput(
    actor: MonetizationPortActor,
    request: MonetizationAdjustmentRequest,
  ): Promise<MonetizationAdjustmentResult> {
    const databaseContext = {
      agencyId: request.agencyId,
      userId: actor.userId,
      membershipId: actor.membershipId,
    };
    return withDatabaseContext(databaseContext, async (transaction) => {
      const existingOutcome = await transaction.payrollMonetizationAdjustmentOutcome.findFirst({
        where: { agencyId: request.agencyId, monetizationAdjustmentId: request.adjustmentId },
        select: { earningInputId: true, linkedInputId: true, result: true },
      });
      if (existingOutcome) {
        return {
          kind: 'ALREADY_ACCEPTED',
          payrollInputId: existingOutcome.earningInputId,
          amount: '0.00',
          payrollResult: {
            linkedInputId: existingOutcome.linkedInputId,
            status: existingOutcome.result,
          },
        } satisfies MonetizationPortAccepted;
      }
      const original = await transaction.payrollMonetizationEarningInput.findFirst({
        where: { agencyId: request.agencyId, id: request.originalPayrollInputId },
      });
      if (!original) {
        return failure(
          'REJECTED',
          'PAYROLL_INPUT_NOT_FOUND',
          'The Monetization Earning Input does not exist in this Agency.',
        );
      }
      const retainedQuantity = new Prisma.Decimal(request.retainedQuantity);
      if (original.status !== 'PENDING' && original.status !== 'CONSUMED') {
        return failure(
          'REJECTED',
          'PAYROLL_INPUT_ALREADY_ADJUSTED',
          'The Monetization Earning Input is no longer available for adjustment.',
        );
      }
      if (request.scope === 'PARTIAL' && retainedQuantity.lessThanOrEqualTo(0)) {
        return failure(
          'REJECTED',
          'PAYROLL_ADJUSTMENT_QUANTITY_INVALID',
          'A partial adjustment must retain a positive quantity.',
        );
      }

      let linkedInputId: string | null = null;
      let reversedQuantity = new Prisma.Decimal(request.reversedQuantity);
      if (original.status === 'PENDING') {
        await transaction.payrollMonetizationEarningInput.update({
          where: { agencyId_id: { agencyId: request.agencyId, id: original.id } },
          data: { status: request.scope === 'WHOLE' ? 'CANCELLED' : 'SUPERSEDED' },
        });
      }

      if (request.scope === 'PARTIAL') {
        const amount = original.amount
          .times(retainedQuantity)
          .dividedBy(original.quantity)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        const replacement = await transaction.payrollMonetizationEarningInput.create({
          data: {
            agencyId: request.agencyId,
            employeeId: original.employeeId,
            sourceType: 'MONETIZATION_ADJUSTMENT',
            sourceId: request.adjustmentId,
            sourceVersionKey: `${request.adjustmentKey}:REPLACEMENT`,
            status: 'PENDING',
            quantity: retainedQuantity,
            amount,
            effectiveDate: original.effectiveDate,
            valuationDate: original.valuationDate,
            calculatorKind: original.calculatorKind,
            factor: original.factor,
            salarySourceSnapshot: original.salarySourceSnapshot as Prisma.InputJsonValue,
            roundingSnapshot: original.roundingSnapshot as Prisma.InputJsonValue,
            calculationSnapshot: {
              basedOnPayrollInputId: original.id,
              originalAmount: original.amount.toFixed(2),
              originalQuantity: original.quantity.toFixed(4),
              retainedQuantity: retainedQuantity.toFixed(4),
              rounded: amount.toFixed(2),
            },
            payloadSnapshot: {
              adjustmentId: request.adjustmentId,
              adjustmentKey: request.adjustmentKey,
              replacesInputId: original.status === 'CONSUMED' ? original.id : null,
              supersedesInputId: original.status === 'PENDING' ? original.id : null,
              reason: request.reason,
            },
            ...(original.status === 'PENDING' ? { supersedesInputId: original.id } : {}),
            createdByMembershipId: actor.membershipId,
          },
          select: { id: true },
        });
        linkedInputId = replacement.id;
        reversedQuantity = original.quantity.minus(retainedQuantity);
      }

      await transaction.payrollMonetizationAdjustmentOutcome.create({
        data: {
          agencyId: request.agencyId,
          monetizationAdjustmentId: request.adjustmentId,
          earningInputId: original.id,
          result: 'ACCEPTED',
          linkedInputId,
          payloadSnapshot: {
            adjustmentId: request.adjustmentId,
            adjustmentKey: request.adjustmentKey,
            monetizationPostingId: request.monetizationPostingId,
            scope: request.scope,
            reversedQuantity: reversedQuantity.toFixed(4),
            retainedQuantity: retainedQuantity.toFixed(4),
            originalStatus: original.status,
            linkedInputId,
            reason: request.reason,
          },
          recordedByMembershipId: actor.membershipId,
          recordedAt: new Date(),
        },
      });
      return {
        kind: 'ACCEPTED',
        payrollInputId: original.id,
        amount: original.amount.toFixed(2),
        payrollResult: { linkedInputId, reversedQuantity: reversedQuantity.toFixed(4) },
      };
    });
  }
}
