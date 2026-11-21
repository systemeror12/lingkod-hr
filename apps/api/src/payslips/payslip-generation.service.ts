import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { withDatabaseContext } from '@lingkod-hr/database';
import { log } from '@lingkod-hr/observability';
import { DocumentsService } from '../documents/documents.service';
import { PAYROLL_PERIOD_FINALIZED } from '../payroll-periods/payroll-finalization.service';
import { payslipText, renderTextPdf, type PayslipStatement } from './payslip-pdf';

export const PAYSLIP_DOCUMENT_TYPE = 'PAYSLIP';
const PAYSLIP_MIME_TYPE = 'application/pdf';
const LINE_TYPE_ORDER = ['EARNING', 'DEDUCTION', 'EMPLOYER_SHARE', 'INFORMATIONAL'];

/**
 * Generates the Payslips of a finalized Payroll Period (hris-controls.md
 * §5.21, payroll-schema.md §12, #336): one per FINALIZED Payroll Employee
 * Result, so an Employee held out of the payroll has none, and one with only
 * Payroll Adjustment lines has one. Each starts GENERATING; its PDF is stored
 * through the shared document service, and it becomes READY naming the
 * Document in one transaction.
 *
 * Generation is idempotent. The unique result makes a second generation find
 * the same Payslip, and the file is stored under a key of the Payslip and its
 * bytes before the transaction, so a failed store leaves it GENERATING for
 * the next pass with nothing recorded. The transaction locks the Payslip and
 * records a Document only while it is still GENERATING, so of two runs at once
 * one records it and the other finds it READY.
 *
 * It only reads finalized payroll rows; it writes Payslips, Documents, and
 * Audit Events.
 */
@Injectable()
export class PayslipGenerationService {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  /** Generate every Payslip of the period still to be generated; each failure is logged and left GENERATING. */
  async generateForPeriod(
    agencyId: string,
    payrollPeriodId: string,
  ): Promise<{ ready: number; failed: number }> {
    const generating = await withDatabaseContext({ agencyId }, async (transaction) => {
      const results = await transaction.payrollEmployee.findMany({
        where: { agencyId, payrollPeriodId, status: 'FINALIZED' },
        select: { id: true },
      });
      const payrollEmployeeIds = results.map((result) => result.id);
      await transaction.payslip.createMany({
        data: payrollEmployeeIds.map((payrollEmployeeId) => ({
          agencyId,
          payrollEmployeeId,
          status: 'GENERATING',
        })),
        skipDuplicates: true,
      });
      return transaction.payslip.findMany({
        where: { agencyId, payrollEmployeeId: { in: payrollEmployeeIds }, status: 'GENERATING' },
        orderBy: { id: 'asc' },
        select: { id: true, payrollEmployeeId: true },
      });
    });
    let ready = 0;
    let failed = 0;
    for (const payslip of generating) {
      try {
        await this.generate(agencyId, payrollPeriodId, payslip);
        ready += 1;
      } catch (error: unknown) {
        failed += 1;
        log('error', 'api.payslip_generation_failed', {
          agencyId,
          payrollPeriodId,
          payslipId: payslip.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { ready, failed };
  }

  /** Store one Payslip's PDF, then mark it READY with its Document unless another run already did. */
  private async generate(
    agencyId: string,
    payrollPeriodId: string,
    payslip: { id: string; payrollEmployeeId: string },
  ): Promise<void> {
    const { statement, finalizedByMembershipId } = await withDatabaseContext(
      { agencyId },
      (transaction) =>
        readStatement(transaction, agencyId, payrollPeriodId, payslip.payrollEmployeeId),
    );
    const content = renderTextPdf(payslipText(statement));
    const contentHash = createHash('sha256').update(content).digest('hex');
    const storageKey = `payslips/${agencyId}/${payslip.id}/${contentHash}.pdf`;
    await this.documents.storeRendering(storageKey, content, PAYSLIP_MIME_TYPE);

    await withDatabaseContext({ agencyId }, async (transaction) => {
      const [locked] = await transaction.$queryRaw<{ status: string }[]>`
        SELECT "status" FROM "payslips"
        WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${payslip.id} AS uuid)
        FOR UPDATE
      `;
      if (locked?.status !== 'GENERATING') return;
      const requestId = `payslip-generation:${payslip.id}`;
      const issued = await this.documents.createIssuedVersionInTransaction(
        transaction,
        { agencyId, userId: null, membershipId: finalizedByMembershipId, requestId },
        {
          documentType: PAYSLIP_DOCUMENT_TYPE,
          classification: 'CONFIDENTIAL',
          content,
          mimeType: PAYSLIP_MIME_TYPE,
          storageKey,
        },
      );
      await transaction.payslip.update({
        where: { id: payslip.id },
        data: { status: 'READY', documentId: issued.documentId },
      });
      await transaction.auditEvent.create({
        data: {
          agencyId,
          actorType: 'SYSTEM',
          action: 'PAYSLIP_READY',
          entityType: 'Payslip',
          entityId: payslip.id,
          previousStatus: 'GENERATING',
          newStatus: 'READY',
          requestId,
          // A Payslip becomes READY once.
          idempotencyKey: 'ready',
          metadata: {
            payrollPeriodId,
            payrollEmployeeId: payslip.payrollEmployeeId,
            calculationVersion: statement.result.calculationVersion,
            documentId: issued.documentId,
            documentVersionId: issued.versionId,
            contentHash,
          },
        },
      });
    });
  }
}

/**
 * What a Payslip states, read from the finalized result, its lines, and
 * their components and rule versions, and the person whose finalization the
 * Payslip follows.
 */
async function readStatement(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  payrollPeriodId: string,
  payrollEmployeeId: string,
): Promise<{ statement: PayslipStatement; finalizedByMembershipId: string }> {
  const result = await transaction.payrollEmployee.findUniqueOrThrow({
    where: { agencyId_id: { agencyId, id: payrollEmployeeId } },
  });
  if (result.status !== 'FINALIZED' || result.payrollPeriodId !== payrollPeriodId) {
    throw new Error(
      `Payroll Employee Result ${payrollEmployeeId} is not a FINALIZED result of its period.`,
    );
  }
  const [agency, period, employee, finalization, lines] = await Promise.all([
    transaction.agency.findUniqueOrThrow({ where: { id: agencyId }, select: { name: true } }),
    transaction.payrollPeriod.findUniqueOrThrow({
      where: { agencyId_id: { agencyId, id: payrollPeriodId } },
    }),
    transaction.employee.findFirstOrThrow({
      where: { agencyId, id: result.employeeId },
      select: { employeeNumber: true, legalName: true },
    }),
    transaction.auditEvent.findFirst({
      where: { agencyId, entityId: payrollPeriodId, action: PAYROLL_PERIOD_FINALIZED },
      select: { actorMembershipId: true },
    }),
    transaction.payrollLine.findMany({
      where: { agencyId, payrollEmployeeId },
      orderBy: { id: 'asc' },
    }),
  ]);
  if (!period.finalizedAt || !finalization?.actorMembershipId) {
    throw new Error(`Payroll Period ${payrollPeriodId} has no recorded finalization.`);
  }
  const [components, ruleVersions] = await Promise.all([
    transaction.payComponent.findMany({
      where: { id: { in: [...new Set(lines.map((line) => line.payComponentId))] } },
      select: { id: true, code: true, name: true },
    }),
    transaction.nationalPayrollRuleVersion.findMany({
      where: { id: { in: [...new Set(lines.flatMap((line) => line.ruleVersionId ?? []))] } },
      select: { id: true, code: true, name: true, issuanceReference: true },
    }),
  ]);
  const componentById = new Map(components.map((component) => [component.id, component]));
  const ruleVersionById = new Map(ruleVersions.map(({ id, ...version }) => [id, version]));
  const statementLines = lines.map((line) => {
    const component = componentById.get(line.payComponentId);
    if (!component) throw new Error(`Payroll Line ${line.id} names a pay component not found.`);
    const source = (line.sourceSnapshot ?? {}) as Record<string, unknown>;
    return {
      componentCode: component.code,
      componentName: component.name,
      lineType: line.lineType,
      quantity: line.quantity?.toFixed(4) ?? null,
      rate: line.rate?.toFixed(8) ?? null,
      amount: line.amount.toFixed(4),
      unit: text(source.unit),
      formula: text(source.formula),
      authority: text(source.authority),
      ruleVersion: (line.ruleVersionId && ruleVersionById.get(line.ruleVersionId)) || null,
    };
  });
  statementLines.sort(
    (a, b) =>
      LINE_TYPE_ORDER.indexOf(a.lineType) - LINE_TYPE_ORDER.indexOf(b.lineType) ||
      a.componentCode.localeCompare(b.componentCode),
  );
  return {
    finalizedByMembershipId: finalization.actorMembershipId,
    statement: {
      agencyName: agency.name,
      period: {
        code: period.code,
        runType: period.runType,
        periodFrom: isoDate(period.periodFrom),
        periodTo: isoDate(period.periodTo),
        paymentDate: isoDate(period.paymentDate),
        finalizedAt: period.finalizedAt.toISOString(),
      },
      employee,
      result: {
        id: result.id,
        calculationVersion: result.calculationVersion,
        calculationHash: result.calculationHash,
        grossAmount: result.grossAmount.toFixed(4),
        totalDeductions: result.totalDeductions.toFixed(4),
        netAmount: result.netAmount.toFixed(4),
      },
      lines: statementLines,
    },
  };
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);
const isoDate = (value: Date) => value.toISOString().slice(0, 10);
