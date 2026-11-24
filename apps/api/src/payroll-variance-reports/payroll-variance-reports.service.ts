import { Injectable } from '@nestjs/common';
import type { PayrollVarianceReport, Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { randomUUID } from 'node:crypto';
import { requestDatabaseContext } from '../database-context';
import {
  PAYROLL_VARIANCE_REPORT_CONTRACT,
  planPayrollVarianceReport,
  type VarianceReportPeriod,
  type VarianceSourceException,
  type VarianceSourceResult,
} from './payroll-variance-report-contract';

export const PAYROLL_VARIANCE_REPORT_GENERATED = 'PAYROLL_VARIANCE_REPORT_GENERATED';

const PERMISSION = 'payroll.registers.generate';

export class PayrollVarianceReportsServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PayrollVarianceReportsServiceError';
  }
}

export interface PayrollVarianceReportView {
  id: string;
  payrollPeriodId: string;
  calculationVersion: number;
  contract: { code: string; version: number };
  generatedAt: string;
  generatedByMembershipId: string;
  /** The report's exact bytes, as canonical JSON. */
  content: string;
  /** SHA-256 hex of `content`. */
  checksum: string;
}

/**
 * Generates the Payroll Variance and Exception Report of a FINALIZED payroll
 * (PAY-009, #645). It needs `payroll.registers.generate` held Agency-wide,
 * which #12's story 10 gives the register, variance report, and remittance
 * schedules alike, and claims no payroll function.
 */
@Injectable()
export class PayrollVarianceReportsService {
  /**
   * Generate the period's report with one Audit Event, or return the one
   * already generated unchanged and write nothing.
   */
  async generate(context: RequestContext, periodId: string): Promise<PayrollVarianceReportView> {
    requirePermission(context, 'Generating a Payroll Variance and Exception Report');
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const period = await lockFinalizedPeriod(transaction, context, periodId);
      const stored = await transaction.payrollVarianceReport.findUnique({
        where: { payrollPeriodId: periodId },
      });
      if (stored) return toView(stored);

      const prior = await priorComparablePeriod(transaction, context, period);
      const id = randomUUID();
      const generatedAt = new Date();
      const plan = planPayrollVarianceReport({
        agencyId: context.agencyId,
        reportId: id,
        generatedAt: generatedAt.toISOString(),
        period,
        results: await readResults(transaction, context, period),
        prior: prior && {
          period: prior,
          results: await readResults(transaction, context, prior),
        },
        exceptions: await readExceptions(transaction, context, periodId),
      });
      const contract = await transaction.payrollExportContractVersion.findUniqueOrThrow({
        where: { code_version: PAYROLL_VARIANCE_REPORT_CONTRACT },
        select: { id: true },
      });
      const created = await transaction.payrollVarianceReport.create({
        data: {
          id,
          agencyId: context.agencyId,
          payrollPeriodId: periodId,
          calculationVersion: period.calculationVersion,
          payrollExportContractVersionId: contract.id,
          generatedByMembershipId: context.membershipId,
          generatedAt,
          content: plan.content,
          checksum: plan.checksum,
        },
      });
      await transaction.auditEvent.create({
        data: {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          entityType: 'PayrollVarianceReport',
          entityId: id,
          action: PAYROLL_VARIANCE_REPORT_GENERATED,
          newStatus: 'GENERATED',
          requestId: context.requestId,
          metadata: {
            payrollPeriodId: periodId,
            calculationVersion: period.calculationVersion,
            priorPayrollPeriodId: prior?.id ?? null,
            priorCalculationVersion: prior?.calculationVersion ?? null,
            contract: PAYROLL_VARIANCE_REPORT_CONTRACT,
            checksum: plan.checksum,
          },
          // One report per period: generating again returns it.
          idempotencyKey: 'generated',
        },
      });
      return toView(created);
    });
  }

  /** The period's report, or null when none has been generated yet. Writes nothing. */
  async read(context: RequestContext, periodId: string): Promise<PayrollVarianceReportView | null> {
    requirePermission(context, 'Reading a Payroll Variance and Exception Report');
    const stored = await withDatabaseContext(
      requestDatabaseContext(context),
      async (transaction) => {
        const period = await transaction.payrollPeriod.findFirst({
          where: { agencyId: context.agencyId, id: periodId },
          select: { id: true },
        });
        if (!period) {
          throw new PayrollVarianceReportsServiceError(
            'The Payroll Period could not be found.',
            404,
            'PAYROLL_PERIOD_NOT_FOUND',
          );
        }
        return transaction.payrollVarianceReport.findUnique({
          where: { payrollPeriodId: periodId },
        });
      },
    );
    return stored && toView(stored);
  }
}

function requirePermission(context: RequestContext, command: string): void {
  if (!holdsAgencyWide(context, PERMISSION)) {
    throw new PayrollVarianceReportsServiceError(
      `${command} needs the ${PERMISSION} permission for the whole Agency.`,
      403,
      'PAYROLL_VARIANCE_REPORT_FORBIDDEN',
    );
  }
}

const PERIOD_SELECT = {
  id: true,
  code: true,
  runType: true,
  periodFrom: true,
  periodTo: true,
  paymentDate: true,
  status: true,
  calculationVersion: true,
  finalizedAt: true,
} as const;

/** The period, locked until the command commits, so concurrent generations serialize. */
async function lockFinalizedPeriod(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
): Promise<VarianceReportPeriod> {
  await transaction.$queryRaw`
    SELECT 1 FROM "payroll_periods"
    WHERE "agency_id" = CAST(${context.agencyId} AS uuid) AND "id" = CAST(${periodId} AS uuid)
    FOR UPDATE
  `;
  const period = await transaction.payrollPeriod.findUnique({
    where: { agencyId_id: { agencyId: context.agencyId, id: periodId } },
    select: PERIOD_SELECT,
  });
  if (!period) {
    throw new PayrollVarianceReportsServiceError(
      'The Payroll Period could not be found.',
      404,
      'PAYROLL_PERIOD_NOT_FOUND',
    );
  }
  if (period.status !== 'FINALIZED' || !period.finalizedAt) {
    throw new PayrollVarianceReportsServiceError(
      `The Payroll Period is ${period.status}; only a FINALIZED payroll produces a Payroll Variance and Exception Report.`,
      409,
      'PAYROLL_VARIANCE_REPORT_PAYROLL_NOT_FINALIZED',
    );
  }
  return toPeriod(period);
}

/**
 * The Agency's last FINALIZED regular period before this one, as the net pay
 * variance check finds it (#623). A SPECIAL period has none.
 */
async function priorComparablePeriod(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  period: VarianceReportPeriod,
): Promise<VarianceReportPeriod | null> {
  if (period.runType !== 'REGULAR') return null;
  const prior = await transaction.payrollPeriod.findFirst({
    where: {
      agencyId: context.agencyId,
      runType: 'REGULAR',
      status: 'FINALIZED',
      periodFrom: { lt: new Date(`${period.periodFrom}T00:00:00.000Z`) },
    },
    orderBy: { periodFrom: 'desc' },
    select: PERIOD_SELECT,
  });
  return prior && toPeriod(prior);
}

/** The FINALIZED results of a period's finalized version, with their lines. */
async function readResults(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  period: VarianceReportPeriod,
): Promise<VarianceSourceResult[]> {
  const { agencyId } = context;
  const results = await transaction.payrollEmployee.findMany({
    where: {
      agencyId,
      payrollPeriodId: period.id,
      calculationVersion: period.calculationVersion,
      status: 'FINALIZED',
    },
    select: { id: true, employeeId: true, netAmount: true },
  });
  const [employees, lines] = await Promise.all([
    readEmployees(
      transaction,
      context,
      results.map((result) => result.employeeId),
    ),
    transaction.payrollLine.findMany({
      where: { agencyId, payrollEmployeeId: { in: results.map((result) => result.id) } },
      select: { payrollEmployeeId: true, payComponentId: true, lineType: true, amount: true },
    }),
  ]);
  const components = new Map(
    (
      await transaction.payComponent.findMany({
        where: { id: { in: [...new Set(lines.map((line) => line.payComponentId))] } },
        select: { id: true, code: true, name: true },
      })
    ).map((component) => [component.id, component]),
  );
  const linesOf = new Map<string, VarianceSourceResult['lines'][number][]>();
  for (const line of lines) {
    const component = components.get(line.payComponentId)!;
    const own = linesOf.get(line.payrollEmployeeId) ?? [];
    own.push({
      payComponentId: line.payComponentId,
      componentCode: component.code,
      componentName: component.name,
      lineType: line.lineType,
      amount: line.amount.toFixed(4),
    });
    linesOf.set(line.payrollEmployeeId, own);
  }
  return results.map((result) => {
    const employee = employees.get(result.employeeId)!;
    return {
      employeeId: result.employeeId,
      agencyEmployeeNumber: employee.agencyEmployeeNumber,
      employeeName: employee.employeeName,
      netAmount: result.netAmount.toFixed(4),
      lines: linesOf.get(result.id) ?? [],
    };
  });
}

/** Every Payroll Exception of the period, of every version, with its holds. */
async function readExceptions(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
): Promise<VarianceSourceException[]> {
  const where = { agencyId: context.agencyId, payrollPeriodId: periodId };
  const [exceptions, holds] = await Promise.all([
    transaction.payrollException.findMany({ where }),
    transaction.payrollHold.findMany({ where }),
  ]);
  const employees = await readEmployees(
    transaction,
    context,
    exceptions.flatMap((exception) => (exception.employeeId ? [exception.employeeId] : [])),
  );
  return exceptions.map((exception) => ({
    id: exception.id,
    calculationVersion: exception.calculationVersion,
    exceptionType: exception.exceptionType,
    severity: exception.severity,
    status: exception.status,
    details: exception.details,
    reason: exception.reason,
    resolvedByMembershipId: exception.resolvedByMembershipId,
    employee: exception.employeeId
      ? { id: exception.employeeId, ...employees.get(exception.employeeId)! }
      : null,
    holds: holds
      .filter((hold) => hold.payrollExceptionId === exception.id)
      .map((hold) => ({
        id: hold.id,
        reason: hold.reason,
        placedByMembershipId: hold.placedByMembershipId,
        placedAt: hold.placedAt.toISOString(),
        liftedByMembershipId: hold.liftedByMembershipId,
        liftedAt: hold.liftedAt?.toISOString() ?? null,
      })),
  }));
}

async function readEmployees(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  ids: string[],
) {
  const employees = await transaction.employee.findMany({
    where: { agencyId: context.agencyId, id: { in: [...new Set(ids)] } },
    select: { id: true, employeeNumber: true, legalName: true },
  });
  return new Map(
    employees.map((employee) => [
      employee.id,
      { agencyEmployeeNumber: employee.employeeNumber, employeeName: employee.legalName },
    ]),
  );
}

function toPeriod(period: {
  id: string;
  code: string;
  runType: string;
  periodFrom: Date;
  periodTo: Date;
  paymentDate: Date;
  calculationVersion: number;
  finalizedAt: Date | null;
}): VarianceReportPeriod {
  return {
    id: period.id,
    code: period.code,
    runType: period.runType,
    periodFrom: isoDate(period.periodFrom),
    periodTo: isoDate(period.periodTo),
    paymentDate: isoDate(period.paymentDate),
    calculationVersion: period.calculationVersion,
    finalizedAt: period.finalizedAt!.toISOString(),
  };
}

function toView(row: PayrollVarianceReport): PayrollVarianceReportView {
  return {
    id: row.id,
    payrollPeriodId: row.payrollPeriodId,
    calculationVersion: row.calculationVersion,
    contract: PAYROLL_VARIANCE_REPORT_CONTRACT,
    generatedAt: row.generatedAt.toISOString(),
    generatedByMembershipId: row.generatedByMembershipId,
    content: row.content,
    checksum: row.checksum,
  };
}

const isoDate = (value: Date) => value.toISOString().slice(0, 10);
