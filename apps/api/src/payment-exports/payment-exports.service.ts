import { Injectable } from '@nestjs/common';
import type { PaymentExport, Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import {
  decryptProtectedValue,
  getConfig,
  parseProtectedValueKey,
  ProtectedValueError,
  type ProtectedValueKey,
} from '@lingkod-hr/config';
import { withDatabaseContext } from '@lingkod-hr/database';
import { createHash, randomUUID } from 'node:crypto';
import { requestDatabaseContext } from '../database-context';
import { manilaToday } from '../employee-scope';
import {
  PAYMENT_EXPORT_CONTRACT,
  PaymentExportBlockedError,
  planPaymentExport,
  renderPaymentExportCsv,
  renderPaymentExportSummary,
  type PaymentExportControls,
  type PaymentExportPeriod,
  type PaymentExportSnapshot,
} from './payment-export-contract';

export const PAYMENT_EXPORT_GENERATED = 'PAYMENT_EXPORT_GENERATED';
export const PAYMENT_EXPORT_DOWNLOADED = 'PAYMENT_EXPORT_DOWNLOADED';

const PERMISSION = 'payroll.payment_exports.generate';
const ENCRYPTION_VERSION = 1;

export class PaymentExportsServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PaymentExportsServiceError';
  }
}

export interface PaymentInstructionView {
  id: string;
  payrollEmployeeId: string;
  /** The designated Payroll Bank Account the instruction snapshots. */
  payrollBankAccountId: string;
  agencyEmployeeNumber: string;
  payeeLegalName: string;
  destinationType: string;
  institutionIdentifierScheme: string;
  institutionIdentifier: string;
  institutionName: string;
  /** Masked except its last four characters; only the CSV carries the full identifier. */
  maskedAccountIdentifier: string;
  accountHolderName: string;
  amount: string;
  paymentReference: string;
}

export interface PaymentExportView {
  id: string;
  payrollPeriodId: string;
  calculationVersion: number;
  paymentDate: string;
  contract: { code: string; version: number };
  currency: string;
  generatedAt: string;
  generatedByMembershipId: string;
  /** SHA-256 hex of the CSV's bytes. */
  checksum: string;
  /** SHA-256 hex of the summary's bytes. */
  summaryChecksum: string;
  controls: PaymentExportControls;
  instructions: PaymentInstructionView[];
}

export interface PaymentExportArtifact {
  fileName: string;
  contentType: string;
  content: string;
  checksum: string;
}

const instructionSelect = {
  id: true,
  payrollEmployeeId: true,
  payrollBankAccountId: true,
  agencyEmployeeNumber: true,
  payeeLegalName: true,
  destinationType: true,
  institutionIdentifierScheme: true,
  institutionIdentifier: true,
  institutionName: true,
  maskedAccountIdentifier: true,
  accountHolderName: true,
  amount: true,
  paymentReference: true,
} satisfies Prisma.PaymentInstructionSelect;

type ExportRow = PaymentExport;
type InstructionRow = Prisma.PaymentInstructionGetPayload<{ select: typeof instructionSelect }>;

/**
 * Generates and downloads the Payment Export of a FINALIZED payroll (#28,
 * #337). Both need `payroll.payment_exports.generate` held Agency-wide.
 * Generating claims no payroll function (hris-controls.md §5.20) and marks
 * no one paid.
 */
@Injectable()
export class PaymentExportsService {
  private readonly protectedValueKey: ProtectedValueKey | null;

  constructor() {
    const rawKey = getConfig().DATA_ENCRYPTION_KEY;
    try {
      this.protectedValueKey = rawKey ? parseProtectedValueKey(rawKey) : null;
    } catch (error: unknown) {
      if (!(error instanceof ProtectedValueError)) throw error;
      this.protectedValueKey = null;
    }
  }

  /**
   * Generate the period's Payment Export in one transaction, or return the
   * one already generated: the stored snapshot and its checksums do not
   * change, so generating again returns the same artifact. A missing,
   * ineffective, or unverified destination for any positive-net-pay result,
   * or any reconciliation mismatch, refuses the whole export and stores
   * nothing. Destinations are taken as designated today in Asia/Manila.
   */
  async generate(context: RequestContext, periodId: string): Promise<PaymentExportView> {
    requirePermission(context, 'Generating a Payment Export');
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const period = await lockFinalizedPeriod(transaction, context, periodId);
      const stored = await transaction.paymentExport.findUnique({
        where: { payrollPeriodId: periodId },
      });
      if (stored) return toView(stored, await readInstructions(transaction, stored));

      const results = await readSourceResults(transaction, context, period);
      const destinations = await transaction.payrollBankAccount.findMany({
        where: {
          agencyId: context.agencyId,
          employeeId: { in: results.map((result) => result.employeeId) },
        },
        select: {
          id: true,
          employeeId: true,
          status: true,
          effectiveFrom: true,
          effectiveTo: true,
          bankCode: true,
          accountName: true,
          maskedAccountNumber: true,
          encryptedAccountNumber: true,
          encryptionVersion: true,
        },
      });
      let plan;
      try {
        plan = planPaymentExport({
          period,
          results,
          destinations: destinations.map((account) => ({
            ...account,
            effectiveFrom: isoDate(account.effectiveFrom),
            effectiveTo: account.effectiveTo ? isoDate(account.effectiveTo) : null,
          })),
          onDate: manilaToday(),
        });
      } catch (error: unknown) {
        if (error instanceof PaymentExportBlockedError) {
          throw new PaymentExportsServiceError(error.message, 409, error.code);
        }
        throw error;
      }

      const byId = new Map(destinations.map((account) => [account.id, account]));
      const id = randomUUID();
      const generatedAt = new Date();
      const rows = plan.instructions.map((instruction) => ({ ...instruction, id: randomUUID() }));
      const snapshot: PaymentExportSnapshot = {
        id,
        agencyId: context.agencyId,
        generatedAt: generatedAt.toISOString(),
        currency: 'PHP',
        period,
        controls: plan.controls,
        instructions: rows.map((row) => ({
          ...row,
          accountIdentifier: this.accountIdentifier(byId.get(row.payrollBankAccountId)!),
        })),
      };
      const checksum = sha256(renderPaymentExportCsv(snapshot));
      const summaryContent = renderPaymentExportSummary(snapshot, plan.excluded, checksum);

      const contract = await transaction.payrollExportContractVersion.findUniqueOrThrow({
        where: { code_version: PAYMENT_EXPORT_CONTRACT },
        select: { id: true },
      });
      const created = await transaction.paymentExport.create({
        data: {
          id,
          agencyId: context.agencyId,
          payrollPeriodId: periodId,
          calculationVersion: period.calculationVersion,
          paymentDate: new Date(`${period.paymentDate}T00:00:00.000Z`),
          payrollExportContractVersionId: contract.id,
          currency: 'PHP',
          generatedByMembershipId: context.membershipId,
          generatedAt,
          checksum,
          summaryContent,
          summaryChecksum: sha256(summaryContent),
          ...plan.controls,
        },
      });
      await transaction.paymentInstruction.createMany({
        data: rows.map((row) => ({ ...row, agencyId: context.agencyId, paymentExportId: id })),
      });
      await transaction.auditEvent.create({
        data: {
          ...audit(context, PAYMENT_EXPORT_GENERATED, id),
          newStatus: 'GENERATED',
          metadata: {
            payrollPeriodId: periodId,
            calculationVersion: period.calculationVersion,
            contract: PAYMENT_EXPORT_CONTRACT,
            checksum,
            summaryChecksum: created.summaryChecksum,
            ...plan.controls,
          },
          // One Payment Export per period: generating again returns it.
          idempotencyKey: 'generated',
        },
      });
      return toView(created, await readInstructions(transaction, created));
    });
  }

  /**
   * Download the CSV, with full destination details. It is rendered again
   * from the stored export and instructions and must match the stored
   * checksum, so the file is always the artifact first generated. Each
   * download is an Audit Event.
   */
  async downloadCsv(
    context: RequestContext,
    periodId: string,
    exportId: string,
  ): Promise<PaymentExportArtifact> {
    requirePermission(context, 'Downloading a Payment Export');
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const stored = await readExport(transaction, context, periodId, exportId);
      const instructions = await readInstructions(transaction, stored);
      const accounts = await transaction.payrollBankAccount.findMany({
        where: {
          agencyId: context.agencyId,
          id: { in: instructions.map((instruction) => instruction.payrollBankAccountId) },
        },
        select: {
          id: true,
          employeeId: true,
          bankCode: true,
          encryptedAccountNumber: true,
          encryptionVersion: true,
        },
      });
      const byId = new Map(accounts.map((account) => [account.id, account]));
      const content = renderPaymentExportCsv({
        ...(await storedSnapshot(transaction, stored)),
        instructions: instructions.map(({ payrollBankAccountId, amount, ...instruction }) => ({
          ...instruction,
          amount: amount.toFixed(2),
          accountIdentifier: this.accountIdentifier(byId.get(payrollBankAccountId)!),
        })),
      });
      const checksum = sha256(content);
      if (checksum !== stored.checksum) {
        throw new PaymentExportsServiceError(
          'The Payment Export CSV no longer matches its checksum and was not downloaded.',
          500,
          'PAYMENT_EXPORT_CHECKSUM_MISMATCH',
        );
      }
      await auditDownload(transaction, context, stored, 'CSV', checksum);
      return {
        fileName: `payment-export-${stored.id}-v${PAYMENT_EXPORT_CONTRACT.version}.csv`,
        contentType: 'text/csv; charset=utf-8',
        content,
        checksum,
      };
    });
  }

  /** Download the stored reconciliation summary, with masked account numbers; audited. */
  async downloadSummary(
    context: RequestContext,
    periodId: string,
    exportId: string,
  ): Promise<PaymentExportArtifact> {
    requirePermission(context, 'Downloading a Payment Export');
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const stored = await readExport(transaction, context, periodId, exportId);
      await auditDownload(transaction, context, stored, 'SUMMARY', stored.summaryChecksum);
      return {
        fileName: `payment-export-${stored.id}-summary.txt`,
        contentType: 'text/plain; charset=utf-8',
        content: stored.summaryContent,
        checksum: stored.summaryChecksum,
      };
    });
  }

  /** The destination's account number, opened from its immutable ciphertext. */
  private accountIdentifier(account: {
    id: string;
    employeeId: string;
    bankCode: string;
    encryptedAccountNumber: Uint8Array;
    encryptionVersion: number;
  }): string {
    if (!this.protectedValueKey) {
      throw new PaymentExportsServiceError(
        'Payroll bank account encryption is not configured, so the Payment Export cannot carry account numbers.',
        503,
        'PAYMENT_EXPORT_ENCRYPTION_UNAVAILABLE',
      );
    }
    const unreadable = new PaymentExportsServiceError(
      `The account number of Payroll Bank Account ${account.id} cannot be read; nothing was exported.`,
      500,
      'PAYMENT_EXPORT_DESTINATION_UNREADABLE',
    );
    if (account.encryptionVersion !== ENCRYPTION_VERSION) throw unreadable;
    let opened;
    try {
      opened = decryptProtectedValue(
        Buffer.from(account.encryptedAccountNumber),
        this.protectedValueKey,
      );
    } catch {
      throw unreadable;
    }
    if (!sealedFor(opened.metadata, account.employeeId, account.bankCode)) throw unreadable;
    return opened.plaintext;
  }
}

function requirePermission(context: RequestContext, command: string): void {
  if (!holdsAgencyWide(context, PERMISSION)) {
    throw new PaymentExportsServiceError(
      `${command} needs the ${PERMISSION} permission for the whole Agency.`,
      403,
      'PAYMENT_EXPORT_FORBIDDEN',
    );
  }
}

/** The period, locked until the command commits, so concurrent generations serialize. */
async function lockFinalizedPeriod(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
): Promise<PaymentExportPeriod> {
  const [row] = await transaction.$queryRaw<
    {
      code: string;
      run_type: string;
      period_from: string;
      period_to: string;
      payment_date: string;
      status: string;
      calculation_version: number;
    }[]
  >`
    SELECT "code"::text, "run_type", "period_from"::text, "period_to"::text,
           "payment_date"::text, "status", "calculation_version"
    FROM "payroll_periods"
    WHERE "agency_id" = CAST(${context.agencyId} AS uuid)
      AND "id" = CAST(${periodId} AS uuid)
    FOR UPDATE
  `;
  if (!row) throw periodNotFound();
  if (row.status !== 'FINALIZED') {
    throw new PaymentExportsServiceError(
      `The Payroll Period is ${row.status}; only a FINALIZED payroll produces a Payment Export.`,
      409,
      'PAYMENT_EXPORT_PAYROLL_NOT_FINALIZED',
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
  };
}

/** The FINALIZED results of the finalized version, each with its line sums and Employee. */
async function readSourceResults(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  period: PaymentExportPeriod,
) {
  const rows = await transaction.$queryRaw<
    {
      payroll_employee_id: string;
      employee_id: string;
      employee_number: string;
      legal_name: string;
      gross_amount: string;
      total_deductions: string;
      net_amount: string;
      earning_line_total: string;
      deduction_line_total: string;
    }[]
  >`
    SELECT r."id"::text AS "payroll_employee_id", r."employee_id"::text,
           e."employee_number"::text, e."legal_name"::text,
           r."gross_amount"::text, r."total_deductions"::text, r."net_amount"::text,
           sums."earning_line_total"::text, sums."deduction_line_total"::text
    FROM "payroll_employees" r
    JOIN "employees" e ON e."agency_id" = r."agency_id" AND e."id" = r."employee_id"
    CROSS JOIN LATERAL (
      SELECT COALESCE(sum(l."amount") FILTER (WHERE l."line_type" = 'EARNING'), 0)
               AS "earning_line_total",
             COALESCE(sum(l."amount") FILTER (WHERE l."line_type" = 'DEDUCTION'), 0)
               AS "deduction_line_total"
      FROM "payroll_lines" l
      WHERE l."agency_id" = r."agency_id" AND l."payroll_employee_id" = r."id"
    ) sums
    WHERE r."agency_id" = CAST(${context.agencyId} AS uuid)
      AND r."payroll_period_id" = CAST(${period.id} AS uuid)
      AND r."calculation_version" = ${period.calculationVersion}
      AND r."status" = 'FINALIZED'
  `;
  return rows.map((row) => ({
    payrollEmployeeId: row.payroll_employee_id,
    employeeId: row.employee_id,
    agencyEmployeeNumber: row.employee_number,
    payeeLegalName: row.legal_name,
    grossAmount: row.gross_amount,
    totalDeductions: row.total_deductions,
    netAmount: row.net_amount,
    earningLineTotal: row.earning_line_total,
    deductionLineTotal: row.deduction_line_total,
  }));
}

async function readExport(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
  exportId: string,
): Promise<ExportRow> {
  const row = await transaction.paymentExport.findFirst({
    where: { agencyId: context.agencyId, payrollPeriodId: periodId, id: exportId },
  });
  if (!row) {
    throw new PaymentExportsServiceError(
      'The Payment Export could not be found.',
      404,
      'PAYMENT_EXPORT_NOT_FOUND',
    );
  }
  return row;
}

function readInstructions(
  transaction: Prisma.TransactionClient,
  stored: ExportRow,
): Promise<InstructionRow[]> {
  return transaction.paymentInstruction.findMany({
    where: { agencyId: stored.agencyId, paymentExportId: stored.id },
    select: instructionSelect,
    orderBy: [{ agencyEmployeeNumber: 'asc' }, { payrollEmployeeId: 'asc' }],
  });
}

/** The export's own snapshot; the period's code, run type, and dates never change (migration 0153). */
async function storedSnapshot(
  transaction: Prisma.TransactionClient,
  stored: ExportRow,
): Promise<Omit<PaymentExportSnapshot, 'instructions'>> {
  const period = await transaction.payrollPeriod.findUniqueOrThrow({
    where: { agencyId_id: { agencyId: stored.agencyId, id: stored.payrollPeriodId } },
    select: { code: true, runType: true, periodFrom: true, periodTo: true },
  });
  return {
    id: stored.id,
    agencyId: stored.agencyId,
    generatedAt: stored.generatedAt.toISOString(),
    currency: stored.currency,
    period: {
      id: stored.payrollPeriodId,
      code: period.code,
      runType: period.runType,
      periodFrom: isoDate(period.periodFrom),
      periodTo: isoDate(period.periodTo),
      paymentDate: isoDate(stored.paymentDate),
      calculationVersion: stored.calculationVersion,
    },
    controls: controlsOf(stored),
  };
}

async function auditDownload(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  stored: ExportRow,
  artifact: 'CSV' | 'SUMMARY',
  checksum: string,
): Promise<void> {
  await transaction.auditEvent.create({
    data: {
      ...audit(context, PAYMENT_EXPORT_DOWNLOADED, stored.id),
      metadata: { payrollPeriodId: stored.payrollPeriodId, artifact, checksum },
    },
  });
}

function audit(
  context: RequestContext,
  action: string,
  paymentExportId: string,
): Prisma.AuditEventUncheckedCreateInput {
  return {
    agencyId: context.agencyId,
    actorUserId: context.userId,
    actorMembershipId: context.membershipId,
    actorType: 'USER',
    entityType: 'PaymentExport',
    entityId: paymentExportId,
    action,
    requestId: context.requestId,
  };
}

function controlsOf(row: ExportRow): PaymentExportControls {
  return {
    sourceResultCount: row.sourceResultCount,
    sourceNetTotal: row.sourceNetTotal.toFixed(2),
    instructionCount: row.instructionCount,
    instructionTotal: row.instructionTotal.toFixed(2),
    excludedResultCount: row.excludedResultCount,
    excludedResultTotal: row.excludedResultTotal.toFixed(2),
  };
}

function toView(row: ExportRow, instructions: InstructionRow[]): PaymentExportView {
  return {
    id: row.id,
    payrollPeriodId: row.payrollPeriodId,
    calculationVersion: row.calculationVersion,
    paymentDate: isoDate(row.paymentDate),
    contract: PAYMENT_EXPORT_CONTRACT,
    currency: row.currency,
    generatedAt: row.generatedAt.toISOString(),
    generatedByMembershipId: row.generatedByMembershipId,
    checksum: row.checksum,
    summaryChecksum: row.summaryChecksum,
    controls: controlsOf(row),
    instructions: instructions.map(({ amount, ...instruction }) => ({
      ...instruction,
      amount: amount.toFixed(2),
    })),
  };
}

/** The bank account service seals each number for its Employee and bank. */
function sealedFor(metadata: Buffer, employeeId: string, bankCode: string): boolean {
  try {
    const value: unknown = JSON.parse(metadata.toString('utf8'));
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as { purpose?: unknown }).purpose === 'PAYROLL_BANK_ACCOUNT' &&
      (value as { employeeId?: unknown }).employeeId === employeeId &&
      (value as { bankCode?: unknown }).bankCode === bankCode
    );
  } catch {
    return false;
  }
}

function periodNotFound(): PaymentExportsServiceError {
  return new PaymentExportsServiceError(
    'The Payroll Period could not be found.',
    404,
    'PAYROLL_PERIOD_NOT_FOUND',
  );
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
