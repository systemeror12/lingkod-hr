import { Injectable } from '@nestjs/common';
import type { DeductionSummary, Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { randomUUID } from 'node:crypto';
import { requestDatabaseContext } from '../database-context';
import {
  DEDUCTION_SUMMARIES_CONTRACT,
  planDeductionSummaries,
  type DeductionSummariesPeriod,
} from './deduction-summaries-contract';

export const DEDUCTION_SUMMARIES_GENERATED = 'DEDUCTION_SUMMARIES_GENERATED';

const PERMISSION = 'payroll.registers.generate';

export class DeductionSummariesServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'DeductionSummariesServiceError';
  }
}

/** One artifact: its exact bytes, as canonical JSON, and their SHA-256 hex. */
interface ArtifactView<Totals> {
  content: string;
  checksum: string;
  totals: Totals;
}

export interface DeductionSummariesView {
  id: string;
  payrollPeriodId: string;
  calculationVersion: number;
  contract: { code: string; version: number };
  generatedAt: string;
  generatedByMembershipId: string;
  taxSummary: ArtifactView<{
    lineCount: number;
    taxableCompensationTotal: string;
    nonTaxableCompensationTotal: string;
    withholdingTaxTotal: string;
  }>;
  loanRemittanceSummary: ArtifactView<{
    lineCount: number;
    amountDueTotal: string;
    deductedTotal: string;
    notDeductedTotal: string;
  }>;
  deductionRegister: ArtifactView<{ lineCount: number; amountTotal: string }>;
}

/**
 * Generates and reads the Tax Summary, Loan Remittance Summary, and Deduction
 * Register of a FINALIZED payroll (PAY-009, #646): Structured Exports for
 * review that are no BIR form and file or remit nothing (PAY-010). Both need
 * `payroll.registers.generate` held Agency-wide. Generating claims no payroll
 * function (hris-controls.md §5.20).
 */
@Injectable()
export class DeductionSummariesService {
  /**
   * Generate the period's three artifacts in one transaction, with one Audit
   * Event, or return the ones already generated unchanged and write nothing.
   */
  async generate(context: RequestContext, periodId: string): Promise<DeductionSummariesView> {
    requirePermission(context, 'Generating deduction summaries');
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const period = await lockFinalizedPeriod(transaction, context, periodId);
      const stored = await transaction.deductionSummary.findUnique({
        where: { payrollPeriodId: periodId },
      });
      if (stored) return toView(stored);

      const id = randomUUID();
      const generatedAt = new Date();
      const plan = planDeductionSummaries({
        agencyId: context.agencyId,
        summaryId: id,
        generatedAt: generatedAt.toISOString(),
        period,
        ...(await readSourceLines(transaction, context, period)),
      });
      const contract = await transaction.payrollExportContractVersion.findUniqueOrThrow({
        where: { code_version: DEDUCTION_SUMMARIES_CONTRACT },
        select: { id: true },
      });
      const { taxSummary, loanRemittanceSummary, deductionRegister } = plan;
      const created = await transaction.deductionSummary.create({
        data: {
          id,
          agencyId: context.agencyId,
          payrollPeriodId: periodId,
          calculationVersion: period.calculationVersion,
          payrollExportContractVersionId: contract.id,
          generatedByMembershipId: context.membershipId,
          generatedAt,
          taxSummaryContent: taxSummary.content,
          taxSummaryChecksum: taxSummary.checksum,
          taxLineCount: taxSummary.totals.lineCount,
          taxableCompensationTotal: taxSummary.totals.taxableCompensationTotal,
          nonTaxableCompensationTotal: taxSummary.totals.nonTaxableCompensationTotal,
          withholdingTaxTotal: taxSummary.totals.withholdingTaxTotal,
          loanRemittanceContent: loanRemittanceSummary.content,
          loanRemittanceChecksum: loanRemittanceSummary.checksum,
          loanLineCount: loanRemittanceSummary.totals.lineCount,
          loanAmountDueTotal: loanRemittanceSummary.totals.amountDueTotal,
          loanDeductedTotal: loanRemittanceSummary.totals.deductedTotal,
          loanNotDeductedTotal: loanRemittanceSummary.totals.notDeductedTotal,
          deductionRegisterContent: deductionRegister.content,
          deductionRegisterChecksum: deductionRegister.checksum,
          deductionLineCount: deductionRegister.totals.lineCount,
          deductionTotal: deductionRegister.totals.amountTotal,
        },
      });
      const view = toView(created);
      await transaction.auditEvent.create({
        data: {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          entityType: 'DeductionSummary',
          entityId: id,
          action: DEDUCTION_SUMMARIES_GENERATED,
          newStatus: 'GENERATED',
          requestId: context.requestId,
          metadata: {
            payrollPeriodId: periodId,
            calculationVersion: period.calculationVersion,
            contract: DEDUCTION_SUMMARIES_CONTRACT,
            taxSummary: { checksum: view.taxSummary.checksum, ...view.taxSummary.totals },
            loanRemittanceSummary: {
              checksum: view.loanRemittanceSummary.checksum,
              ...view.loanRemittanceSummary.totals,
            },
            deductionRegister: {
              checksum: view.deductionRegister.checksum,
              ...view.deductionRegister.totals,
            },
          },
          // One row per period: generating again returns it.
          idempotencyKey: 'generated',
        },
      });
      return view;
    });
  }

  /** The period's three artifacts, or null when none have been generated yet. Writes nothing. */
  async readForPeriod(
    context: RequestContext,
    periodId: string,
  ): Promise<DeductionSummariesView | null> {
    requirePermission(context, 'Reading deduction summaries');
    const stored = await withDatabaseContext(
      requestDatabaseContext(context),
      async (transaction) => {
        const period = await transaction.payrollPeriod.findFirst({
          where: { agencyId: context.agencyId, id: periodId },
          select: { id: true },
        });
        if (!period) {
          throw new DeductionSummariesServiceError(
            'The Payroll Period could not be found.',
            404,
            'PAYROLL_PERIOD_NOT_FOUND',
          );
        }
        return transaction.deductionSummary.findUnique({ where: { payrollPeriodId: periodId } });
      },
    );
    return stored && toView(stored);
  }

  /** Read a stored period's three artifacts. */
  async read(
    context: RequestContext,
    periodId: string,
    summaryId: string,
  ): Promise<DeductionSummariesView> {
    requirePermission(context, 'Reading deduction summaries');
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const stored = await transaction.deductionSummary.findFirst({
        where: { agencyId: context.agencyId, payrollPeriodId: periodId, id: summaryId },
      });
      if (!stored) {
        throw new DeductionSummariesServiceError(
          'The Deduction Summary could not be found.',
          404,
          'DEDUCTION_SUMMARY_NOT_FOUND',
        );
      }
      return toView(stored);
    });
  }
}

function requirePermission(context: RequestContext, command: string): void {
  if (!holdsAgencyWide(context, PERMISSION)) {
    throw new DeductionSummariesServiceError(
      `${command} needs the ${PERMISSION} permission for the whole Agency.`,
      403,
      'DEDUCTION_SUMMARIES_FORBIDDEN',
    );
  }
}

/** The period, locked until the command commits, so concurrent generations serialize. */
async function lockFinalizedPeriod(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
): Promise<DeductionSummariesPeriod> {
  const [row] = await transaction.$queryRaw<
    {
      code: string;
      run_type: string;
      period_from: string;
      period_to: string;
      payment_date: string;
      status: string;
      calculation_version: number;
      finalized_at: Date | null;
    }[]
  >`
    SELECT "code"::text, "run_type", "period_from"::text, "period_to"::text,
           "payment_date"::text, "status", "calculation_version", "finalized_at"
    FROM "payroll_periods"
    WHERE "agency_id" = CAST(${context.agencyId} AS uuid)
      AND "id" = CAST(${periodId} AS uuid)
    FOR UPDATE
  `;
  if (!row) {
    throw new DeductionSummariesServiceError(
      'The Payroll Period could not be found.',
      404,
      'PAYROLL_PERIOD_NOT_FOUND',
    );
  }
  if (row.status !== 'FINALIZED' || !row.finalized_at) {
    throw new DeductionSummariesServiceError(
      `The Payroll Period is ${row.status}; only a FINALIZED payroll produces deduction summaries.`,
      409,
      'DEDUCTION_SUMMARIES_PAYROLL_NOT_FINALIZED',
    );
  }
  return {
    id: periodId,
    code: row.code,
    runType: row.run_type,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    paymentDate: row.payment_date,
    calculationVersion: row.calculation_version,
    finalizedAt: row.finalized_at.toISOString(),
  };
}

/**
 * The Tax Lines, Loan Deduction Lines, and `DEDUCTION` Payroll Lines of the
 * FINALIZED results of the finalized version, each with its Employee.
 */
async function readSourceLines(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  period: DeductionSummariesPeriod,
) {
  const results = await transaction.$queryRaw<
    { id: string; employee_number: string; legal_name: string }[]
  >`
    SELECT r."id"::text, e."employee_number"::text, e."legal_name"::text
    FROM "payroll_employees" r
    JOIN "employees" e ON e."agency_id" = r."agency_id" AND e."id" = r."employee_id"
    WHERE r."agency_id" = CAST(${context.agencyId} AS uuid)
      AND r."payroll_period_id" = CAST(${period.id} AS uuid)
      AND r."calculation_version" = ${period.calculationVersion}
      AND r."status" = 'FINALIZED'
  `;
  const employees = new Map(
    results.map((row) => [
      row.id,
      {
        payrollEmployeeId: row.id,
        agencyEmployeeNumber: row.employee_number,
        employeeName: row.legal_name,
      },
    ]),
  );
  const ids = [...employees.keys()];
  const employeeOf = (payrollEmployeeId: string) => employees.get(payrollEmployeeId)!;
  const where = { agencyId: context.agencyId, payrollEmployeeId: { in: ids } };

  const [taxLines, loanLines, deductionLines] = await Promise.all([
    transaction.taxLine.findMany({ where }),
    transaction.loanDeductionLine.findMany({ where }),
    transaction.payrollLine.findMany({ where: { ...where, lineType: 'DEDUCTION' } }),
  ]);
  const [ruleVersions, obligations, components] = await Promise.all([
    transaction.nationalPayrollRuleVersion.findMany({
      where: { id: { in: [...new Set(taxLines.map((line) => line.ruleVersionId))] } },
      select: { id: true, code: true },
    }),
    transaction.deductionObligation.findMany({
      where: {
        agencyId: context.agencyId,
        id: { in: [...new Set(loanLines.map((line) => line.deductionObligationId))] },
      },
      select: { id: true, payeeCategory: true, payeeName: true, issuerReference: true },
    }),
    transaction.payComponent.findMany({
      where: { id: { in: [...new Set(deductionLines.map((line) => line.payComponentId))] } },
      select: { id: true, code: true, name: true },
    }),
  ]);
  const ruleCode = new Map(ruleVersions.map((version) => [version.id, version.code]));
  const obligation = new Map(obligations.map((row) => [row.id, row]));
  const component = new Map(components.map((row) => [row.id, row]));

  return {
    taxLines: taxLines.map((line) => ({
      taxLineId: line.id,
      ...employeeOf(line.payrollEmployeeId),
      taxableCompensation: line.taxableCompensation.toString(),
      nonTaxableCompensation: line.nonTaxableCompensation.toString(),
      withholdingTax: line.withholdingTax.toString(),
      yearEndAdjustment: yearEndReason(line.yearEndAdjustment),
      ruleVersionId: line.ruleVersionId,
      ruleVersionCode: ruleCode.get(line.ruleVersionId)!,
    })),
    loanDeductionLines: loanLines.map((line) => {
      const source = obligation.get(line.deductionObligationId)!;
      return {
        loanDeductionLineId: line.id,
        deductionObligationId: line.deductionObligationId,
        payeeCategory: source.payeeCategory,
        payeeName: source.payeeName,
        issuerReference: source.issuerReference,
        ...employeeOf(line.payrollEmployeeId),
        amountDue: line.amountDue.toString(),
        deductedAmount: line.deductedAmount.toString(),
        notDeductedAmount: line.notDeductedAmount.toString(),
      };
    }),
    deductionLines: deductionLines.map((line) => {
      const source = component.get(line.payComponentId)!;
      return {
        payrollLineId: line.id,
        ...employeeOf(line.payrollEmployeeId),
        componentCode: source.code,
        componentName: source.name,
        amount: line.amount.toString(),
        payrollAdjustmentId: line.payrollAdjustmentId,
      };
    }),
  };
}

/** The year-end adjustment's reason (#633), or null when the Tax Line has none. */
function yearEndReason(adjustment: Prisma.JsonValue): string | null {
  if (adjustment === null || typeof adjustment !== 'object' || Array.isArray(adjustment)) {
    return null;
  }
  return typeof adjustment.reason === 'string' ? adjustment.reason : null;
}

function toView(row: DeductionSummary): DeductionSummariesView {
  return {
    id: row.id,
    payrollPeriodId: row.payrollPeriodId,
    calculationVersion: row.calculationVersion,
    contract: DEDUCTION_SUMMARIES_CONTRACT,
    generatedAt: row.generatedAt.toISOString(),
    generatedByMembershipId: row.generatedByMembershipId,
    taxSummary: {
      content: row.taxSummaryContent,
      checksum: row.taxSummaryChecksum,
      totals: {
        lineCount: row.taxLineCount,
        taxableCompensationTotal: row.taxableCompensationTotal.toFixed(4),
        nonTaxableCompensationTotal: row.nonTaxableCompensationTotal.toFixed(4),
        withholdingTaxTotal: row.withholdingTaxTotal.toFixed(4),
      },
    },
    loanRemittanceSummary: {
      content: row.loanRemittanceContent,
      checksum: row.loanRemittanceChecksum,
      totals: {
        lineCount: row.loanLineCount,
        amountDueTotal: row.loanAmountDueTotal.toFixed(4),
        deductedTotal: row.loanDeductedTotal.toFixed(4),
        notDeductedTotal: row.loanNotDeductedTotal.toFixed(4),
      },
    },
    deductionRegister: {
      content: row.deductionRegisterContent,
      checksum: row.deductionRegisterChecksum,
      totals: {
        lineCount: row.deductionLineCount,
        amountTotal: row.deductionTotal.toFixed(4),
      },
    },
  };
}
