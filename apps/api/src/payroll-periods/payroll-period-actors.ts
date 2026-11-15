import type { Prisma } from '@prisma/client';

/** The payroll functions of hris-controls.md §5.20, one per person per period. */
export type PayrollFunction =
  | 'PREPARATION'
  | 'HR_CERTIFICATION'
  | 'BUDGET_REVIEW'
  | 'ACCOUNTING_REVIEW'
  | 'APPROVAL'
  | 'DISBURSEMENT';

export type PayrollFunctionClaim =
  { outcome: 'CLAIMED' } | { outcome: 'REFUSED'; heldFunction: PayrollFunction };

/**
 * Claim the person's payroll function on a Payroll Period, inside the command's
 * own transaction (#330). The first command a person performs on the period
 * fixes their function across every calculation version; a command of another
 * function is refused, with no override. The primary key serializes concurrent
 * claims: the later insert waits, does nothing, and reads the winner.
 */
export async function claimPayrollFunction(
  transaction: Prisma.TransactionClient,
  claim: {
    agencyId: string;
    payrollPeriodId: string;
    membershipId: string;
    payrollFunction: PayrollFunction;
  },
): Promise<PayrollFunctionClaim> {
  await transaction.payrollPeriodActor.createMany({ data: claim, skipDuplicates: true });
  const held = await transaction.payrollPeriodActor.findUnique({
    where: {
      payrollPeriodId_membershipId: {
        payrollPeriodId: claim.payrollPeriodId,
        membershipId: claim.membershipId,
      },
    },
    select: { payrollFunction: true },
  });
  if (!held) throw new Error('The claimed payroll function could not be read back.');
  return held.payrollFunction === claim.payrollFunction
    ? { outcome: 'CLAIMED' }
    : { outcome: 'REFUSED', heldFunction: held.payrollFunction as PayrollFunction };
}
