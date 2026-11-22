import { Prisma } from '@prisma/client';
import type { CompensationBasis } from '../compensation-basis/compensation-basis.service';
import { ruleVersionsInEffectDuring } from '../payroll-periods/payroll-rule-snapshots';
import { authorizedDeductionsParameters } from '../payroll-rule-versions/national-payroll-rule-versions';
import {
  blocking,
  type CalculatedException,
  type CalculatedLine,
  type CalculatedLoanDeduction,
  type CalculationContext,
  type CalculatorOutcome,
  type DeductionObligationDue,
  type EmployeePayrollSources,
  type PayrollCalculator,
} from './payroll-calculator';

export const LOAN_DEDUCTION_COMPONENT_CODE = 'LOAN_DEDUCTION';
const RULE_KIND = 'AUTHORIZED_DEDUCTIONS';

/**
 * Applies an Employee's Deduction Obligations to a regular period's pay, by
 * the `AUTHORIZED_DEDUCTIONS` version in effect on every date of the month
 * (FY 2026 GAA sec. 62; docs/research/salary-overpayment-recovery-authorities.md
 * R6). It runs last, so the withholding tax and the compulsory contributions,
 * every earlier deduction, are taken first. Then the obligations:
 *
 * - those of the version's `priorityPayeeCategories`, in that order;
 * - the rest in the order incurred;
 * - each for its scheduled amount, capped at its outstanding balance;
 * - none below `monthlyNetTakeHomeFloor`: an obligation takes only what
 *   leaves net pay at the floor, and what it cannot take is not deducted.
 *
 * Obligations incurred the same day keep a fixed order, by payee and issuer
 * reference. Each obligation gets a Loan Deduction Line, with the amount not
 * deducted, and a `LOAN_DEDUCTION` Payroll Line when it takes anything. A
 * stopped amount is also a warning, so the review sees it: what a period
 * cannot take stays owed.
 *
 * It blocks when no version is in effect on every date, when the version
 * changes inside the month, and when the version does not allow an
 * obligation's payee category.
 */
export class AuthorizedDeductionsCalculator implements PayrollCalculator {
  calculate(
    _basis: CompensationBasis,
    context: CalculationContext,
    earlierLines: readonly CalculatedLine[],
    sources: EmployeePayrollSources,
  ): CalculatorOutcome {
    const obligations = sources.deductionObligations;
    if (obligations.length === 0) return { lines: [], exceptions: [] };

    const versions = context.snapshotRuleVersions.filter(
      (version) => version.ruleKind === RULE_KIND,
    );
    const coverage = ruleVersionsInEffectDuring(
      RULE_KIND,
      versions,
      context.periodFrom,
      context.periodTo,
    );
    if (coverage.status === 'NOT_IN_EFFECT') {
      return {
        lines: [],
        exceptions: [
          blocking(
            'AUTHORIZED_DEDUCTIONS_RULE_NOT_IN_EFFECT',
            `${coverage.reason} The Employee's Deduction Obligations are not applied without it.`,
            { ruleKind: RULE_KIND },
          ),
        ],
      };
    }
    if (coverage.ruleVersionIds.length > 1) {
      return {
        lines: [],
        exceptions: [
          blocking(
            'AUTHORIZED_DEDUCTIONS_RULE_CHANGE_IN_PERIOD',
            `The ${RULE_KIND} version changes inside ${context.periodFrom} to ${context.periodTo}. No recorded rule says which month's floor and order apply.`,
            { ruleVersionIds: coverage.ruleVersionIds },
          ),
        ],
      };
    }
    const version = versions.find((candidate) => candidate.id === coverage.ruleVersionIds[0])!;
    const parameters = authorizedDeductionsParameters.parse(version.parameters);

    const notAllowed = obligations.filter(
      (obligation) => !parameters.allowedPayeeCategories.includes(obligation.payeeCategory),
    );
    if (notAllowed.length > 0) {
      return {
        lines: [],
        exceptions: notAllowed.map((obligation) =>
          blocking(
            'DEDUCTION_PAYEE_NOT_ALLOWED',
            `${RULE_KIND} version ${version.code} does not allow deductions payable to ${obligation.payeeCategory}, so ${obligation.payeeName} ${obligation.issuerReference} cannot be deducted. End the obligation or hold the Employee.`,
            { deductionObligationId: obligation.id, payeeCategory: obligation.payeeCategory },
          ),
        ),
      };
    }

    const sum = (lineType: CalculatedLine['lineType']) =>
      earlierLines
        .filter((line) => line.lineType === lineType)
        .reduce((total, line) => total.add(line.amount), new Prisma.Decimal(0));
    const floor = new Prisma.Decimal(parameters.monthlyNetTakeHomeFloor);
    let net = sum('EARNING').sub(sum('DEDUCTION'));
    const netBeforeObligations = net;

    const lines: CalculatedLine[] = [];
    const loanDeductions: CalculatedLoanDeduction[] = [];
    const stopped: Record<string, string>[] = [];
    let notTaken = new Prisma.Decimal(0);
    for (const [index, obligation] of inDeductionOrder(
      obligations,
      parameters.priorityPayeeCategories,
    ).entries()) {
      const due = Prisma.Decimal.min(obligation.scheduledAmount, obligation.outstandingBalance);
      const deducted = Prisma.Decimal.min(due, Prisma.Decimal.max(net.sub(floor), 0));
      const notDeducted = due.sub(deducted);
      net = net.sub(deducted);
      notTaken = notTaken.add(notDeducted);
      const priority = index + 1;
      loanDeductions.push({
        deductionObligationId: obligation.id,
        priority,
        amountDue: due.toFixed(4),
        deductedAmount: deducted.toFixed(4),
        notDeductedAmount: notDeducted.toFixed(4),
        ruleVersionId: version.id,
      });
      if (deducted.gt(0)) {
        lines.push({
          componentCode: LOAN_DEDUCTION_COMPONENT_CODE,
          lineType: 'DEDUCTION',
          ruleVersionId: version.id,
          quantity: null,
          rate: null,
          amount: deducted.toFixed(4),
          source: {
            ruleVersionCode: version.code,
            deductionObligationId: obligation.id,
            payeeCategory: obligation.payeeCategory,
            payeeName: obligation.payeeName,
            issuerReference: obligation.issuerReference,
            incurredOn: obligation.incurredOn,
            ...(obligation.payrollAdjustmentId
              ? { payrollAdjustmentId: obligation.payrollAdjustmentId }
              : {}),
            priority,
            amountDue: due.toFixed(4),
            notDeductedAmount: notDeducted.toFixed(4),
            monthlyNetTakeHomeFloor: floor.toFixed(4),
          },
        });
      }
      if (notDeducted.gt(0)) {
        stopped.push({
          deductionObligationId: obligation.id,
          payeeName: obligation.payeeName,
          issuerReference: obligation.issuerReference,
          amountDue: due.toFixed(4),
          deductedAmount: deducted.toFixed(4),
          notDeductedAmount: notDeducted.toFixed(4),
        });
      }
    }

    const exceptions: CalculatedException[] = [];
    if (stopped.length > 0) {
      exceptions.push({
        exceptionType: 'NET_PAY_FLOOR_STOPPED_DEDUCTION',
        severity: 'WARNING',
        details: {
          message: `The monthly net take-home floor of ${floor.toFixed(2)} in ${RULE_KIND} version ${version.code} stopped ${notTaken.toFixed(2)} of the Employee's Deduction Obligations. It is not deducted and stays owed.`,
          ruleVersionCode: version.code,
          monthlyNetTakeHomeFloor: floor.toFixed(4),
          netBeforeObligations: netBeforeObligations.toFixed(4),
          notDeductedAmount: notTaken.toFixed(4),
          obligations: stopped,
        },
      });
    }
    return { lines, exceptions, loanDeductions };
  }
}

/**
 * The priority categories' obligations in their listed order, then the rest
 * in the order incurred. Ties keep a fixed order by payee and issuer reference.
 */
export function inDeductionOrder(
  obligations: readonly DeductionObligationDue[],
  priorityPayeeCategories: readonly string[],
): DeductionObligationDue[] {
  const rank = (obligation: DeductionObligationDue) => {
    const index = priorityPayeeCategories.indexOf(obligation.payeeCategory);
    return index === -1 ? priorityPayeeCategories.length : index;
  };
  const key = (obligation: DeductionObligationDue) =>
    [obligation.incurredOn, obligation.payeeName, obligation.issuerReference] as const;
  return [...obligations].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const [left, right] = [key(a), key(b)];
    for (let index = 0; index < left.length; index += 1) {
      if (left[index]! < right[index]!) return -1;
      if (left[index]! > right[index]!) return 1;
    }
    return 0;
  });
}
