import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import {
  PayrollExportReconciliationError,
  type PayrollExportReconciliation,
} from '../payroll-periods/payroll-export-reconciliation';
import {
  ACCOUNTING_SUPPORT_EXPORT_CONTRACT,
  buildAccountingSupportExport,
} from './accounting-support-export-contract';

export const ACCOUNTING_SUPPORT_EXPORT_GENERATED = 'PAYROLL_ACCOUNTING_EXPORT_GENERATED';
export const ACCOUNTING_SUPPORT_EXPORT_DOWNLOADED = 'PAYROLL_ACCOUNTING_EXPORT_DOWNLOADED';
export const PAYROLL_EXPORT_EXTERNAL_OUTCOME_RECORDED = 'PAYROLL_EXPORT_EXTERNAL_OUTCOME_RECORDED';

/** The three §6.10 permissions; each is held Agency-wide. */
export const ACCOUNTING_EXPORT_PERMISSIONS = {
  generate: 'payroll.accounting_exports.generate',
  employeeDetail: 'payroll.export_detail.read',
  recordOutcome: 'payroll.export_outcomes.record',
} as const;

export const PAYROLL_EXPORT_EXTERNAL_OUTCOMES = [
  'HANDED_OFF',
  'RECEIVED',
  'RETURNED',
  'POSTED',
] as const;

const externalReference = z.string().trim().min(1, 'Enter the external reference.').max(200);
const evidenceDocumentVersionId = z.string().uuid();
const reason = z.string().trim().min(1, 'Enter the reason.').max(2000);

/**
 * A Payroll Export External Outcome (#29). A receipt, return, or posting is
 * externally evidenced, so it names the external reference and the finalized
 * Document Version that evidences it; a return also gives its reason. A
 * handoff may name either.
 */
export const payrollExportExternalOutcomeSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('HANDED_OFF'),
      externalReference: externalReference.optional(),
      evidenceDocumentVersionId: evidenceDocumentVersionId.optional(),
    })
    .strict(),
  z
    .object({
      outcome: z.enum(['RECEIVED', 'POSTED']),
      externalReference,
      evidenceDocumentVersionId,
    })
    .strict(),
  z
    .object({
      outcome: z.literal('RETURNED'),
      externalReference,
      evidenceDocumentVersionId,
      reason,
    })
    .strict(),
]);

export type PayrollExportExternalOutcomeInput = z.input<typeof payrollExportExternalOutcomeSchema>;

export class AccountingSupportExportsServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'AccountingSupportExportsServiceError';
  }
}

export interface PayrollExportExternalOutcomeView {
  id: string;
  accountingSupportExportId: string;
  outcome: (typeof PAYROLL_EXPORT_EXTERNAL_OUTCOMES)[number];
  externalReference: string | null;
  evidenceDocumentVersionId: string | null;
  reason: string | null;
  recordedByMembershipId: string;
  recordedAt: string;
}

export interface AccountingSupportExportView {
  id: string;
  payrollPeriodId: string;
  calculationVersion: number;
  calculationHash: string;
  contract: { code: string; version: number };
  generatedAt: string;
  generatedByMembershipId: string;
  /** SHA-256 hex of the export's bytes. */
  checksum: string;
  /** SHA-256 hex of the Employee Detail Companion's bytes. */
  employeeDetailChecksum: string;
  reconciliation: PayrollExportReconciliation;
  /** Every outcome recorded against it, oldest first. */
  externalOutcomes: PayrollExportExternalOutcomeView[];
}

export interface AccountingSupportExportArtifact {
  fileName: string;
  contentType: string;
  content: string;
  checksum: string;
}

const outcomeSelect = {
  id: true,
  accountingSupportExportId: true,
  outcome: true,
  externalReference: true,
  evidenceDocumentVersionId: true,
  reason: true,
  recordedByMembershipId: true,
  recordedAt: true,
} satisfies Prisma.PayrollExportExternalOutcomeSelect;

type ExportRow = Prisma.FinalizedPayrollAccountingSupportExportGetPayload<object>;
type OutcomeRow = Prisma.PayrollExportExternalOutcomeGetPayload<{ select: typeof outcomeSelect }>;

/**
 * The Finalized Payroll Accounting Support Export of a FINALIZED payroll
 * (#29, #355), its Employee Detail Companion, and the Payroll Export External
 * Outcomes recorded against it. Generating, downloading, and recording claim
 * no payroll function (hris-controls.md §5.20). Nothing here asserts a
 * journal entry or posting, and a download is never an outcome.
 */
@Injectable()
export class AccountingSupportExportsService {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  /**
   * Generate the period's export and its companion in one transaction, or
   * return the one already generated, unchanged. It classifies every Payroll
   * Line of the finalized version and proves the Payroll Export
   * Reconciliation, the companion's totals included. A failure refuses with
   * `PAYROLL_EXPORT_RECONCILIATION_FAILED` and stores nothing. The period
   * lock orders concurrent generations.
   */
  async generate(context: RequestContext, periodId: string): Promise<AccountingSupportExportView> {
    requirePermission(
      context,
      'generate',
      'Generating a Finalized Payroll Accounting Support Export',
    );
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const period = await lockFinalizedPeriod(transaction, context, periodId);
      const stored = await transaction.finalizedPayrollAccountingSupportExport.findUnique({
        where: { payrollPeriodId: periodId },
      });
      if (stored) return toView(stored, await readOutcomes(transaction, stored));

      const certification = await transaction.payrollCertification.findFirst({
        where: { agencyId: context.agencyId, payrollPeriodId: periodId, revokedAt: null },
        select: { id: true, calculationVersion: true, calculationHash: true },
      });
      if (!certification || certification.calculationVersion !== period.calculationVersion) {
        throw new Error(
          'A FINALIZED Payroll Period has no certification of its finalized version.',
        );
      }
      const scope = {
        agencyId: context.agencyId,
        payrollPeriodId: periodId,
        calculationVersion: period.calculationVersion,
      };
      const results = await transaction.payrollEmployee.findMany({
        where: scope,
        select: {
          id: true,
          employeeId: true,
          calculationHash: true,
          grossAmount: true,
          totalDeductions: true,
          netAmount: true,
        },
      });
      const employees = new Map(
        (
          await transaction.employee.findMany({
            where: {
              agencyId: context.agencyId,
              id: { in: results.map((result) => result.employeeId) },
            },
            select: { id: true, employeeNumber: true, legalName: true },
          })
        ).map((employee) => [employee.id, employee]),
      );
      const lines = await transaction.payrollLine.findMany({
        where: { agencyId: context.agencyId, payrollEmployee: scope },
        select: {
          id: true,
          payrollEmployeeId: true,
          payComponentId: true,
          lineType: true,
          amount: true,
        },
      });
      const components = await transaction.payComponent.findMany({
        where: { id: { in: [...new Set(lines.map((line) => line.payComponentId))] } },
        select: { id: true, code: true, name: true, category: true, reportingCategory: true },
      });

      const id = randomUUID();
      const header = {
        id,
        agencyId: context.agencyId,
        payrollPeriod: {
          id: periodId,
          code: period.code,
          runType: period.runType,
          periodFrom: period.periodFrom,
          periodTo: period.periodTo,
          paymentDate: period.paymentDate,
        },
        finalization: {
          calculationVersion: period.calculationVersion,
          calculationHash: certification.calculationHash,
          payrollCertificationId: certification.id,
          finalizedAt: period.finalizedAt,
        },
      };
      let artifacts;
      try {
        artifacts = buildAccountingSupportExport({
          header,
          results: results.map((result) => ({
            ...result,
            employeeNumber: employees.get(result.employeeId)!.employeeNumber,
            legalName: employees.get(result.employeeId)!.legalName,
            grossAmount: result.grossAmount.toString(),
            totalDeductions: result.totalDeductions.toString(),
            netAmount: result.netAmount.toString(),
          })),
          lines: lines.map((line) => ({ ...line, amount: line.amount.toString() })),
          components,
          checksum: sha256,
        });
      } catch (error: unknown) {
        if (error instanceof PayrollExportReconciliationError) {
          throw new AccountingSupportExportsServiceError(
            error.message,
            409,
            'PAYROLL_EXPORT_RECONCILIATION_FAILED',
          );
        }
        throw error;
      }

      const contract = await transaction.payrollExportContractVersion.findUniqueOrThrow({
        where: { code_version: ACCOUNTING_SUPPORT_EXPORT_CONTRACT },
        select: { id: true },
      });
      const created = await transaction.finalizedPayrollAccountingSupportExport.create({
        data: {
          id,
          agencyId: context.agencyId,
          payrollPeriodId: periodId,
          calculationVersion: period.calculationVersion,
          calculationHash: certification.calculationHash,
          payrollExportContractVersionId: contract.id,
          content: artifacts.content,
          checksum: sha256(artifacts.content),
          employeeDetailContent: artifacts.employeeDetailContent,
          employeeDetailChecksum: artifacts.employeeDetailChecksum,
          generatedByMembershipId: context.membershipId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          ...audit(context, ACCOUNTING_SUPPORT_EXPORT_GENERATED, id),
          newStatus: 'GENERATED',
          metadata: {
            payrollPeriodId: periodId,
            calculationVersion: period.calculationVersion,
            calculationHash: certification.calculationHash,
            contract: ACCOUNTING_SUPPORT_EXPORT_CONTRACT,
            checksum: created.checksum,
            employeeDetailChecksum: created.employeeDetailChecksum,
            ...artifacts.classified.reconciliation,
          },
          // One export per period: generating again returns it.
          idempotencyKey: 'generated',
        },
      });
      return toView(created, []);
    });
  }

  /**
   * The period's export with its outcomes, or null when none has been generated yet. Writes
   * nothing; it carries neither file's content.
   */
  async read(
    context: RequestContext,
    periodId: string,
  ): Promise<AccountingSupportExportView | null> {
    requirePermission(context, 'generate', 'Reading a Finalized Payroll Accounting Support Export');
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const period = await transaction.payrollPeriod.findFirst({
        where: { agencyId: context.agencyId, id: periodId },
        select: { id: true },
      });
      if (!period) {
        throw new AccountingSupportExportsServiceError(
          'The Payroll Period could not be found.',
          404,
          'PAYROLL_PERIOD_NOT_FOUND',
        );
      }
      const stored = await transaction.finalizedPayrollAccountingSupportExport.findUnique({
        where: { payrollPeriodId: periodId },
      });
      return stored && toView(stored, await readOutcomes(transaction, stored));
    });
  }

  /** Download the export, which carries no employee-level detail; audited, and not an outcome. */
  async downloadExport(
    context: RequestContext,
    periodId: string,
    exportId: string,
  ): Promise<AccountingSupportExportArtifact> {
    requirePermission(
      context,
      'generate',
      'Downloading a Finalized Payroll Accounting Support Export',
    );
    return this.download(context, periodId, exportId, 'EXPORT');
  }

  /** Download the Employee Detail Companion, which needs its own permission; audited, and not an outcome. */
  async downloadEmployeeDetail(
    context: RequestContext,
    periodId: string,
    exportId: string,
  ): Promise<AccountingSupportExportArtifact> {
    requirePermission(context, 'employeeDetail', 'Downloading an Employee Detail Companion');
    return this.download(context, periodId, exportId, 'EMPLOYEE_DETAIL');
  }

  /**
   * Record one Payroll Export External Outcome against the export. Outcomes
   * are append-only: each is a new row, any sequence is accepted, and none
   * changes the export.
   */
  async recordOutcome(
    context: RequestContext,
    periodId: string,
    exportId: string,
    rawInput: unknown,
  ): Promise<PayrollExportExternalOutcomeView> {
    requirePermission(context, 'recordOutcome', 'Recording a Payroll Export External Outcome');
    const parsed = payrollExportExternalOutcomeSchema.safeParse(rawInput);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new AccountingSupportExportsServiceError(
        `${issue?.path.map(String).join('.') || 'request'}: ${issue?.message ?? 'invalid'}`,
        400,
        'INVALID_INPUT',
      );
    }
    const input = parsed.data;
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const stored = await readExport(transaction, context, periodId, exportId);
      if (input.evidenceDocumentVersionId) {
        const evidence = await this.documents.resolveFinalizedVersionInTransaction(
          transaction,
          context,
          input.evidenceDocumentVersionId,
        );
        if (!evidence) {
          throw new AccountingSupportExportsServiceError(
            'The evidence must be an exact finalized Document Version of this Agency.',
            400,
            'PAYROLL_EXPORT_OUTCOME_EVIDENCE_INVALID',
          );
        }
      }
      const outcome = toOutcomeView(
        await transaction.payrollExportExternalOutcome.create({
          data: {
            agencyId: context.agencyId,
            accountingSupportExportId: stored.id,
            outcome: input.outcome,
            externalReference: input.externalReference ?? null,
            evidenceDocumentVersionId: input.evidenceDocumentVersionId ?? null,
            reason: input.outcome === 'RETURNED' ? input.reason : null,
            recordedByMembershipId: context.membershipId,
          },
          select: outcomeSelect,
        }),
      );
      await transaction.auditEvent.create({
        data: {
          ...audit(context, PAYROLL_EXPORT_EXTERNAL_OUTCOME_RECORDED, stored.id),
          newStatus: outcome.outcome,
          reason: outcome.reason,
          metadata: {
            payrollPeriodId: stored.payrollPeriodId,
            payrollExportExternalOutcomeId: outcome.id,
            externalReference: outcome.externalReference,
            evidenceDocumentVersionId: outcome.evidenceDocumentVersionId,
            checksum: stored.checksum,
          },
        },
      });
      return outcome;
    });
  }

  private download(
    context: RequestContext,
    periodId: string,
    exportId: string,
    artifact: 'EXPORT' | 'EMPLOYEE_DETAIL',
  ): Promise<AccountingSupportExportArtifact> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const stored = await readExport(transaction, context, periodId, exportId);
      const [content, checksum, suffix] =
        artifact === 'EXPORT'
          ? [stored.content, stored.checksum, '']
          : [stored.employeeDetailContent, stored.employeeDetailChecksum, '-employee-detail'];
      await transaction.auditEvent.create({
        data: {
          ...audit(context, ACCOUNTING_SUPPORT_EXPORT_DOWNLOADED, stored.id),
          metadata: { payrollPeriodId: stored.payrollPeriodId, artifact, checksum },
        },
      });
      return {
        fileName: `accounting-support-export-${stored.id}${suffix}-v${ACCOUNTING_SUPPORT_EXPORT_CONTRACT.version}.json`,
        contentType: 'application/json; charset=utf-8',
        content,
        checksum,
      };
    });
  }
}

function requirePermission(
  context: RequestContext,
  permission: keyof typeof ACCOUNTING_EXPORT_PERMISSIONS,
  command: string,
): void {
  const code = ACCOUNTING_EXPORT_PERMISSIONS[permission];
  if (!holdsAgencyWide(context, code)) {
    throw new AccountingSupportExportsServiceError(
      `${command} needs the ${code} permission for the whole Agency.`,
      403,
      'PAYROLL_ACCOUNTING_EXPORT_FORBIDDEN',
    );
  }
}

/** The period, locked until the command commits, so concurrent generations serialize. */
async function lockFinalizedPeriod(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
) {
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
    throw new AccountingSupportExportsServiceError(
      'The Payroll Period could not be found.',
      404,
      'PAYROLL_PERIOD_NOT_FOUND',
    );
  }
  if (row.status !== 'FINALIZED' || !row.finalized_at) {
    throw new AccountingSupportExportsServiceError(
      `The Payroll Period is ${row.status}; only a FINALIZED payroll produces a Finalized Payroll Accounting Support Export.`,
      409,
      'PAYROLL_ACCOUNTING_EXPORT_PAYROLL_NOT_FINALIZED',
    );
  }
  return {
    code: row.code,
    runType: row.run_type,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    paymentDate: row.payment_date,
    calculationVersion: row.calculation_version,
    finalizedAt: row.finalized_at.toISOString(),
  };
}

async function readExport(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
  exportId: string,
): Promise<ExportRow> {
  const row = await transaction.finalizedPayrollAccountingSupportExport.findFirst({
    where: { agencyId: context.agencyId, payrollPeriodId: periodId, id: exportId },
  });
  if (!row) {
    throw new AccountingSupportExportsServiceError(
      'The Finalized Payroll Accounting Support Export could not be found.',
      404,
      'PAYROLL_ACCOUNTING_EXPORT_NOT_FOUND',
    );
  }
  return row;
}

function readOutcomes(
  transaction: Prisma.TransactionClient,
  stored: ExportRow,
): Promise<OutcomeRow[]> {
  return transaction.payrollExportExternalOutcome.findMany({
    where: { agencyId: stored.agencyId, accountingSupportExportId: stored.id },
    select: outcomeSelect,
    orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
  });
}

function audit(
  context: RequestContext,
  action: string,
  exportId: string,
): Prisma.AuditEventUncheckedCreateInput {
  return {
    agencyId: context.agencyId,
    actorUserId: context.userId,
    actorMembershipId: context.membershipId,
    actorType: 'USER',
    entityType: 'FinalizedPayrollAccountingSupportExport',
    entityId: exportId,
    action,
    requestId: context.requestId,
  };
}

function toOutcomeView(row: OutcomeRow): PayrollExportExternalOutcomeView {
  return {
    ...row,
    outcome: row.outcome as PayrollExportExternalOutcomeView['outcome'],
    recordedAt: row.recordedAt.toISOString(),
  };
}

function toView(row: ExportRow, outcomes: OutcomeRow[]): AccountingSupportExportView {
  const content = JSON.parse(row.content) as { reconciliation: PayrollExportReconciliation };
  return {
    id: row.id,
    payrollPeriodId: row.payrollPeriodId,
    calculationVersion: row.calculationVersion,
    calculationHash: row.calculationHash,
    contract: ACCOUNTING_SUPPORT_EXPORT_CONTRACT,
    generatedAt: row.generatedAt.toISOString(),
    generatedByMembershipId: row.generatedByMembershipId,
    checksum: row.checksum,
    employeeDetailChecksum: row.employeeDetailChecksum,
    reconciliation: content.reconciliation,
    externalOutcomes: outcomes.map(toOutcomeView),
  };
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
