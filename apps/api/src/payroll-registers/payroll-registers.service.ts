import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PayrollRegister, Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import {
  classifyPayrollExport,
  PayrollExportReconciliationError,
} from '../payroll-periods/payroll-export-reconciliation';
import { renderTextPdf } from '../payslips/payslip-pdf';
import { payrollRegisterText, type PayrollRegisterStatement } from './payroll-register-pdf';

export const PAYROLL_REGISTER_GENERATED = 'PAYROLL_REGISTER_GENERATED';
export const PAYROLL_REGISTER_DOCUMENT_TYPE = 'PAYROLL_REGISTER';

const PERMISSION = 'payroll.registers.generate';
const MIME_TYPE = 'application/pdf';

export class PayrollRegistersServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PayrollRegistersServiceError';
  }
}

export interface PayrollRegisterView {
  id: string;
  payrollPeriodId: string;
  calculationVersion: number;
  /** The issued PDF, read through the shared document service. */
  documentId: string;
  resultCount: number;
  grossAmount: string;
  totalDeductions: string;
  netAmount: string;
  generatedAt: string;
  generatedByMembershipId: string;
}

interface FinalizedPeriod {
  id: string;
  code: string;
  runType: string;
  periodFrom: Date;
  periodTo: Date;
  paymentDate: Date;
  calculationVersion: number;
  finalizedAt: Date;
}

/**
 * Generates the Payroll Register of a FINALIZED payroll (PAY-009,
 * payroll-schema.md §12, #353): one PDF per period, LingkodHR's own
 * Printable System View (#617), issued through the shared document service.
 * It needs `payroll.registers.generate` held Agency-wide and claims no
 * payroll function.
 *
 * The register's totals are proved before anything is stored: the period's
 * FINALIZED results must still hash to the certification it was finalized
 * at, and each result's lines must sum to its totals, by the Payroll Export
 * Reconciliation. A mismatch refuses generation and stores nothing.
 *
 * Generation is idempotent. The PDF is rendered from finalized rows only, so
 * the same period always gives the same bytes, stored under a key of the
 * period and those bytes before the recording transaction. That transaction
 * locks the period and records the register only if the period has none, so
 * a repeat, or the loser of two at once, returns the stored register and
 * writes nothing.
 */
@Injectable()
export class PayrollRegistersService {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  async generate(context: RequestContext, periodId: string): Promise<PayrollRegisterView> {
    if (!holdsAgencyWide(context, PERMISSION)) {
      throw new PayrollRegistersServiceError(
        `Generating a Payroll Register needs the ${PERMISSION} permission for the whole Agency.`,
        403,
        'PAYROLL_REGISTER_FORBIDDEN',
      );
    }
    const prepared = await withDatabaseContext(
      requestDatabaseContext(context),
      async (transaction) => {
        const period = await readFinalizedPeriod(transaction, context, periodId);
        const stored = await transaction.payrollRegister.findUnique({
          where: { payrollPeriodId: periodId },
        });
        if (stored) return { stored };
        return { statement: await readStatement(transaction, context, period) };
      },
    );
    if (prepared.stored) return toView(prepared.stored);

    const { statement } = prepared;
    const content = renderTextPdf(payrollRegisterText(statement));
    const contentHash = createHash('sha256').update(content).digest('hex');
    const storageKey = `payroll-registers/${context.agencyId}/${periodId}/${contentHash}.pdf`;
    await this.documents.storeRendering(storageKey, content, MIME_TYPE);

    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      await transaction.$queryRaw`
        SELECT 1 FROM "payroll_periods"
        WHERE "agency_id" = CAST(${context.agencyId} AS uuid) AND "id" = CAST(${periodId} AS uuid)
        FOR UPDATE
      `;
      const stored = await transaction.payrollRegister.findUnique({
        where: { payrollPeriodId: periodId },
      });
      if (stored) return toView(stored);

      const issued = await this.documents.createIssuedVersionInTransaction(transaction, context, {
        documentType: PAYROLL_REGISTER_DOCUMENT_TYPE,
        classification: 'CONFIDENTIAL',
        content,
        mimeType: MIME_TYPE,
        storageKey,
      });
      const { totals, period } = statement;
      const created = await transaction.payrollRegister.create({
        data: {
          agencyId: context.agencyId,
          payrollPeriodId: periodId,
          calculationVersion: period.calculationVersion,
          documentId: issued.documentId,
          resultCount: totals.resultCount,
          grossAmount: totals.grossAmount,
          totalDeductions: totals.totalDeductions,
          netAmount: totals.netAmount,
          generatedByMembershipId: context.membershipId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: PAYROLL_REGISTER_GENERATED,
          entityType: 'PayrollRegister',
          entityId: created.id,
          newStatus: 'GENERATED',
          requestId: context.requestId,
          // One register per period: generating again returns it.
          idempotencyKey: 'generated',
          metadata: {
            payrollPeriodId: periodId,
            calculationVersion: period.calculationVersion,
            calculationHash: period.calculationHash,
            documentId: issued.documentId,
            documentVersionId: issued.versionId,
            contentHash,
            ...totals,
          },
        },
      });
      return toView(created);
    });
  }
}

async function readFinalizedPeriod(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
): Promise<FinalizedPeriod> {
  const period = await transaction.payrollPeriod.findUnique({
    where: { agencyId_id: { agencyId: context.agencyId, id: periodId } },
    select: {
      id: true,
      code: true,
      runType: true,
      periodFrom: true,
      periodTo: true,
      paymentDate: true,
      status: true,
      calculationVersion: true,
      finalizedAt: true,
    },
  });
  if (!period) {
    throw new PayrollRegistersServiceError(
      'The Payroll Period could not be found.',
      404,
      'PAYROLL_PERIOD_NOT_FOUND',
    );
  }
  const { status, finalizedAt, ...rest } = period;
  if (status !== 'FINALIZED' || !finalizedAt) {
    throw new PayrollRegistersServiceError(
      `The Payroll Period is ${status}; only a FINALIZED payroll produces a Payroll Register.`,
      409,
      'PAYROLL_REGISTER_PAYROLL_NOT_FINALIZED',
    );
  }
  return { ...rest, finalizedAt };
}

/**
 * The register's statement: the FINALIZED results of the finalized version,
 * classified and reconciled against their lines and the certification the
 * period was finalized at.
 */
async function readStatement(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  period: FinalizedPeriod,
): Promise<PayrollRegisterStatement> {
  const { agencyId } = context;
  const { calculationVersion } = period;
  const [agency, certification, results] = await Promise.all([
    transaction.agency.findUniqueOrThrow({ where: { id: agencyId }, select: { name: true } }),
    transaction.payrollCertification.findFirst({
      where: { agencyId, payrollPeriodId: period.id, revokedAt: null, calculationVersion },
      select: { calculationHash: true },
    }),
    transaction.payrollEmployee.findMany({
      where: { agencyId, payrollPeriodId: period.id, calculationVersion, status: 'FINALIZED' },
      select: {
        id: true,
        employeeId: true,
        calculationHash: true,
        grossAmount: true,
        totalDeductions: true,
        netAmount: true,
      },
    }),
  ]);
  if (!certification) {
    throw new Error(`FINALIZED Payroll Period ${period.id} has no certification of its version.`);
  }
  const resultIds = results.map((result) => result.id);
  const [employees, lines] = await Promise.all([
    transaction.employee.findMany({
      where: { agencyId, id: { in: results.map((result) => result.employeeId) } },
      select: { id: true, employeeNumber: true, legalName: true },
    }),
    transaction.payrollLine.findMany({
      where: { agencyId, payrollEmployeeId: { in: resultIds } },
      select: {
        id: true,
        payrollEmployeeId: true,
        payComponentId: true,
        lineType: true,
        amount: true,
      },
    }),
  ]);
  const components = await transaction.payComponent.findMany({
    where: { id: { in: [...new Set(lines.map((line) => line.payComponentId))] } },
    select: { id: true, code: true, name: true, category: true, reportingCategory: true },
  });

  const sourceResults = results.map((result) => ({
    id: result.id,
    employeeId: result.employeeId,
    calculationHash: result.calculationHash,
    grossAmount: result.grossAmount.toFixed(4),
    totalDeductions: result.totalDeductions.toFixed(4),
    netAmount: result.netAmount.toFixed(4),
  }));
  let classified;
  try {
    classified = classifyPayrollExport({
      expectedCalculationHash: certification.calculationHash,
      results: sourceResults,
      lines: lines.map((line) => ({ ...line, amount: line.amount.toFixed(4) })),
      components,
    });
  } catch (error: unknown) {
    if (error instanceof PayrollExportReconciliationError) {
      throw new PayrollRegistersServiceError(
        `The Payroll Register does not reconcile to the finalized results and lines; nothing was generated. ${error.failures.join(' ')}`,
        409,
        'PAYROLL_REGISTER_RECONCILIATION_FAILED',
      );
    }
    throw error;
  }

  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const rows = sourceResults.map((result) => {
    const employee = employeeById.get(result.employeeId);
    if (!employee) throw new Error(`Payroll Employee Result ${result.id} names no Employee.`);
    return {
      employeeNumber: employee.employeeNumber,
      legalName: employee.legalName,
      grossAmount: result.grossAmount,
      totalDeductions: result.totalDeductions,
      netAmount: result.netAmount,
    };
  });
  rows.sort((a, b) =>
    a.employeeNumber < b.employeeNumber ? -1 : a.employeeNumber > b.employeeNumber ? 1 : 0,
  );
  return {
    agencyName: agency.name,
    period: {
      code: period.code,
      runType: period.runType,
      periodFrom: isoDate(period.periodFrom),
      periodTo: isoDate(period.periodTo),
      paymentDate: isoDate(period.paymentDate),
      finalizedAt: period.finalizedAt.toISOString(),
      calculationVersion,
      calculationHash: certification.calculationHash,
    },
    rows,
    components: classified.classifiedLines,
    totals: classified.reconciliation,
  };
}

function toView(row: PayrollRegister): PayrollRegisterView {
  return {
    id: row.id,
    payrollPeriodId: row.payrollPeriodId,
    calculationVersion: row.calculationVersion,
    documentId: row.documentId,
    resultCount: row.resultCount,
    grossAmount: row.grossAmount.toFixed(4),
    totalDeductions: row.totalDeductions.toFixed(4),
    netAmount: row.netAmount.toFixed(4),
    generatedAt: row.generatedAt.toISOString(),
    generatedByMembershipId: row.generatedByMembershipId,
  };
}

const isoDate = (value: Date) => value.toISOString().slice(0, 10);
