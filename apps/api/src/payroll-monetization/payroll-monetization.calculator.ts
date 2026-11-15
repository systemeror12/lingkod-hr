import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  CompensationBasisService,
  type CompensationBasis,
} from '../compensation-basis/compensation-basis.service';

/**
 * The fixed monetization calculator: S × credits × the constant factor
 * 0.0481927, which CSC MC No. 2, s. 2016 sets for terminal leave and
 * monetization alike and DBM BC No. 2016-2, sec. 3.1 adopts for MLC
 * (docs/research/leave-monetization-terminal-leave-valuation-authorities.md,
 * question 2). S is the highest monthly salary received. Leave names the same
 * calculator and factor as provenance; Payroll refuses any other.
 */
export const MONETIZATION_CALCULATOR_KIND = 'MCL_FIXED_FACTOR_0_0481927';
export const MONETIZATION_FACTOR = '0.0481927';
export const MONETIZATION_FACTOR_AUTHORITY = [
  'CSC MC No. 2, s. 2016',
  'CSC Resolution No. 1501530',
  'DBM BC No. 2016-2, sec. 3.1',
] as const;

/** A centavo rounding mechanism, applied only under an authority that names it. */
export interface MonetizationRounding {
  kind: 'HALF_UP_2DP';
  authority: Prisma.InputJsonObject;
}

/**
 * The evidence-backed rules for a Monetization Earning Input, each null until
 * one is recorded. No source settles the valuation date or centavo rounding
 * (#614, questions 1 and 4). The authority's S is the highest monthly salary
 * received, and no recorded rule says which compensation-basis value that is;
 * `salaryRule` is that rule, under which Payroll reads the monthly rate the
 * compensation basis resolves on the valuation date. The production binding
 * resolves none, so every monetization fails closed.
 */
export interface MonetizationValuationRules {
  resolve(input: { agencyId: string; employeeId: string; valuationDate: string }): Promise<{
    salaryRule: Prisma.InputJsonObject | null;
    valuationDateRule: Prisma.InputJsonObject | null;
    rounding: MonetizationRounding | null;
  }>;
}

export const MONETIZATION_VALUATION_RULES = Symbol('MONETIZATION_VALUATION_RULES');

export const unresolvedMonetizationValuationRules: MonetizationValuationRules = {
  async resolve() {
    return { salaryRule: null, valuationDateRule: null, rounding: null };
  },
};

/** The compensation basis read the calculator needs, so tests can supply a resolved one. */
export type MonetizationCompensationBasis = Pick<CompensationBasisService, 'resolveInTransaction'>;

export type MonetizationValuation =
  | { ok: true; amount: string; valuation: Prisma.InputJsonObject }
  | {
      ok: false;
      outcome: 'REJECTED' | 'RETRYABLE_FAILURE';
      code: string;
      reason: string;
      missingFacts: string[];
    };

/** The provenance Payroll reads from Leave's monetization payload. */
const monetizationPayloadSchema = z.object({
  calculatorKind: z.string(),
  factor: z.string().regex(/^\d+(\.\d+)?$/),
  valuationDate: z.string(),
});

@Injectable()
export class PayrollMonetizationCalculator {
  constructor(
    @Inject(CompensationBasisService)
    private readonly compensationBasis: MonetizationCompensationBasis,
    @Inject(MONETIZATION_VALUATION_RULES)
    private readonly rules: MonetizationValuationRules,
  ) {}

  /**
   * Value one Monetization Earning Input inside the inbox's transaction. Leave
   * supplies the quantity and provenance; the rules come from their authority,
   * and under a salary rule the salary comes from the compensation basis. A
   * missing fact fails closed and names itself in `missingFacts`.
   */
  async valueInTransaction(
    transaction: Prisma.TransactionClient,
    input: {
      agencyId: string;
      employeeId: string;
      effectiveDate: string;
      quantity?: string | null | undefined;
      payload: Record<string, unknown>;
    },
  ): Promise<MonetizationValuation> {
    const payload = monetizationPayloadSchema.safeParse(input.payload);
    if (!payload.success || input.quantity == null) {
      return rejected(
        'PAYROLL_MONETIZATION_PAYLOAD_INVALID',
        'A monetization earning needs its credit quantity, calculator, factor, and valuation date.',
      );
    }
    const { calculatorKind, factor, valuationDate } = payload.data;
    if (
      calculatorKind !== MONETIZATION_CALCULATOR_KIND ||
      !new Prisma.Decimal(factor).equals(MONETIZATION_FACTOR)
    ) {
      return rejected(
        'PAYROLL_MONETIZATION_CALCULATOR_MISMATCH',
        `Payroll values monetization only with ${MONETIZATION_CALCULATOR_KIND} and the factor ${MONETIZATION_FACTOR}.`,
      );
    }
    if (valuationDate !== input.effectiveDate) {
      return rejected(
        'PAYROLL_MONETIZATION_PAYLOAD_INVALID',
        "A monetization earning's effective date is its valuation date.",
      );
    }

    const rules = await this.rules.resolve({
      agencyId: input.agencyId,
      employeeId: input.employeeId,
      valuationDate,
    });
    const salary = rules.salaryRule
      ? monthlySalaryOn(
          await this.compensationBasis.resolveInTransaction(
            transaction,
            input.agencyId,
            input.employeeId,
            valuationDate,
            valuationDate,
          ),
        )
      : null;
    const missingFacts = [
      ...(salary ? [] : ['AUTHORITATIVE_SALARY_SOURCE']),
      ...(rules.rounding ? [] : ['ROUNDING_RULE']),
      ...(rules.valuationDateRule ? [] : ['VALUATION_DATE_RULE']),
    ];
    if (!rules.salaryRule || !rules.rounding || !rules.valuationDateRule) {
      return retryable(
        'PAYROLL_MONETIZATION_AUTHORITY_MISSING',
        'Payroll has no recorded authority yet for the monetization salary, valuation date, or centavo rounding.',
        missingFacts,
      );
    }
    if (!salary) {
      return retryable(
        'PAYROLL_SALARY_SOURCE_MISSING',
        'Under the salary rule, the compensation basis resolves no monthly salary on the valuation date.',
        missingFacts,
      );
    }

    const unrounded = new Prisma.Decimal(salary.monthlyRate)
      .times(input.quantity)
      .times(MONETIZATION_FACTOR);
    const amount = round(unrounded, rules.rounding);
    return {
      ok: true,
      amount: amount.toFixed(2),
      valuation: {
        calculatorKind: MONETIZATION_CALCULATOR_KIND,
        factor: MONETIZATION_FACTOR,
        factorAuthority: [...MONETIZATION_FACTOR_AUTHORITY],
        valuationDate,
        valuationDateRule: rules.valuationDateRule,
        salary: {
          source: 'COMPENSATION_BASIS',
          rule: rules.salaryRule,
          monthlySalary: salary.monthlyRate,
          stretch: salary.stretch as unknown as Prisma.InputJsonObject,
        },
        rounding: { kind: rules.rounding.kind, authority: rules.rounding.authority },
        calculation: {
          monthlySalary: salary.monthlyRate,
          quantity: new Prisma.Decimal(input.quantity).toFixed(4),
          factor: MONETIZATION_FACTOR,
          unrounded: unrounded.toFixed(),
          rounded: amount.toFixed(2),
        },
      },
    };
  }
}

/** The monthly rate of the one resolved stretch covering the valuation date, if any. */
function monthlySalaryOn(basis: CompensationBasis) {
  const [stretch] = basis.stretches;
  if (basis.status !== 'RESOLVED' || basis.stretches.length !== 1 || !stretch) return null;
  if (stretch.status !== 'RESOLVED' || stretch.rate.monthlyRate === null) return null;
  return { monthlyRate: stretch.rate.monthlyRate, stretch };
}

function round(unrounded: Prisma.Decimal, rounding: MonetizationRounding): Prisma.Decimal {
  switch (rounding.kind) {
    case 'HALF_UP_2DP':
      return unrounded.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }
}

function rejected(code: string, reason: string): MonetizationValuation {
  return { ok: false, outcome: 'REJECTED', code, reason, missingFacts: [] };
}

function retryable(code: string, reason: string, missingFacts: string[]): MonetizationValuation {
  return { ok: false, outcome: 'RETRYABLE_FAILURE', code, reason, missingFacts };
}
