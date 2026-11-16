import { Prisma } from '@prisma/client';
import { currentBillings } from '../contribution-billings/contribution-billings.service';
import { blocking } from './payroll-calculator';
import {
  type CheckedException,
  type CheckedRun,
  type PayrollCheck,
  resultsOf,
} from './payroll-check';

export const CONTRIBUTION_BILLING_DIFFERENCE = 'CONTRIBUTION_BILLING_DIFFERENCE';

const ZERO = new Prisma.Decimal(0);

/**
 * Reconciliation against issuer billing (BRD PAY-004, #349): each current
 * contribution billing recorded for the period is compared with the
 * Contribution Line of its type in the Employee's `CALCULATED` result, or with
 * zero when there is none. A difference in either share blocks, with both
 * values, until a Payroll Preparer explains it by resolving its exception.
 *
 * The explanation holds for the same difference only: a later calculation
 * finds it explained while a `RESOLVED` exception of an earlier version names
 * the same billing and the same calculated shares. A corrected billing or a
 * changed calculation is a new difference. The billing never replaces the
 * calculated line.
 *
 * An Employee with no billing, or with no `CALCULATED` result, such as one
 * blocked or held, is not compared.
 */
export class ContributionBillingCheck implements PayrollCheck {
  async check(transaction: Prisma.TransactionClient, run: CheckedRun): Promise<CheckedException[]> {
    if (run.runType !== 'REGULAR') return [];
    const billings = currentBillings(
      await transaction.contributionBilling.findMany({
        where: { agencyId: run.agencyId, payrollPeriodId: run.payrollPeriodId },
        orderBy: [{ employeeId: 'asc' }, { contributionType: 'asc' }],
        select: {
          id: true,
          employeeId: true,
          contributionType: true,
          employeeShare: true,
          employerShare: true,
          supersedesContributionBillingId: true,
        },
      }),
    );
    if (billings.length === 0) return [];

    const results = new Map(
      (
        await transaction.payrollEmployee.findMany({
          where: {
            ...resultsOf(run),
            status: 'CALCULATED',
            employeeId: { in: billings.map((billing) => billing.employeeId) },
          },
          select: {
            id: true,
            employeeId: true,
            contributions: {
              select: { contributionType: true, employeeShare: true, employerShare: true },
            },
          },
        })
      ).map((result) => [result.employeeId, result]),
    );
    const explained = new Set(
      (
        await transaction.payrollException.findMany({
          where: {
            agencyId: run.agencyId,
            payrollPeriodId: run.payrollPeriodId,
            calculationVersion: { lt: run.calculationVersion },
            exceptionType: CONTRIBUTION_BILLING_DIFFERENCE,
            status: 'RESOLVED',
          },
          select: { details: true },
        })
      ).map(({ details }) => {
        const value = details as Record<string, unknown>;
        return differenceKey(
          value.contributionBillingId,
          value.calculatedEmployeeShare,
          value.calculatedEmployerShare,
        );
      }),
    );

    return billings.flatMap((billing) => {
      const result = results.get(billing.employeeId);
      if (!result) return [];
      const line = result.contributions.find(
        (contribution) => contribution.contributionType === billing.contributionType,
      );
      const calculatedEmployeeShare = line?.employeeShare ?? ZERO;
      const calculatedEmployerShare = line?.employerShare ?? ZERO;
      if (
        billing.employeeShare.equals(calculatedEmployeeShare) &&
        billing.employerShare.equals(calculatedEmployerShare)
      ) {
        return [];
      }
      const values = {
        contributionBillingId: billing.id,
        contributionType: billing.contributionType,
        billedEmployeeShare: billing.employeeShare.toString(),
        billedEmployerShare: billing.employerShare.toString(),
        calculatedEmployeeShare: calculatedEmployeeShare.toString(),
        calculatedEmployerShare: calculatedEmployerShare.toString(),
      };
      if (
        explained.has(
          differenceKey(
            values.contributionBillingId,
            values.calculatedEmployeeShare,
            values.calculatedEmployerShare,
          ),
        )
      ) {
        return [];
      }
      return [
        {
          employeeId: billing.employeeId,
          ...blocking(
            CONTRIBUTION_BILLING_DIFFERENCE,
            `The issuer billed ${values.billedEmployeeShare} employee and ${values.billedEmployerShare} employer share of ${billing.contributionType}, but the calculation has ${values.calculatedEmployeeShare} and ${values.calculatedEmployerShare}. Explain the difference by resolving this exception, or correct the billing or its cause, then calculate again.`,
            { payrollEmployeeId: result.id, ...values },
          ),
        },
      ];
    });
  }
}

function differenceKey(billingId: unknown, employeeShare: unknown, employerShare: unknown) {
  return JSON.stringify([billingId, employeeShare, employerShare]);
}
