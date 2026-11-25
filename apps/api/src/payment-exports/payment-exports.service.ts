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
import { z } from 'zod';
import { requestDatabaseContext } from '../database-context';
import { manilaToday } from '../employee-scope';
import type {
  DisbursementOutcomeKind,
  DisbursementOutcomeView,
} from './disbursement-outcomes.service';
import {
  PAYMENT_EXPORT_CONTRACT,
  PaymentExportBlockedError,
  planPaymentExport,
  planPaymentRetry,
  renderPaymentExportCsv,
  renderPaymentExportSummary,
  type PaymentExportControls,
  type PaymentExportPeriod,
  type PaymentExportPlan,
  type PaymentExportSnapshot,
} from './payment-export-contract';

export const PAYMENT_EXPORT_GENERATED = 'PAYMENT_EXPORT_GENERATED';
export const PAYMENT_EXPORT_DOWNLOADED = 'PAYMENT_EXPORT_DOWNLOADED';
export const PAYMENT_EXPORT_RETRY_GENERATED = 'PAYMENT_EXPORT_RETRY_GENERATED';

const PERMISSION = 'payroll.payment_exports.generate';
const ENCRYPTION_VERSION = 1;

/** The latest Disbursement Outcomes after which an instruction may be handed off again (#28). */
const RETRYABLE_OUTCOMES: readonly string[] = ['REJECTED', 'RETURNED'];

/** Request fields that would change who is paid or how much; a retry never takes them. */
const PAYEE_OR_AMOUNT_FIELDS = [
  'amount',
  'payee',
  'payeeLegalName',
  'payrollEmployeeId',
  'employeeId',
  'agencyEmployeeNumber',
] as const;

/** Retrying a REJECTED or RETURNED Payment Instruction needs only the reason. */
export const paymentRetrySchema = z
  .object({
    reason: z
      .string({ error: 'A retry needs a reason.' })
      .trim()
      .min(1, 'A retry needs a reason.')
      .max(2000),
  })
  .strict();

export type PaymentRetryInput = z.input<typeof paymentRetrySchema>;

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
  /** The REJECTED or RETURNED attempt this instruction retries, with the reason (#643). */
  priorPaymentInstructionId: string | null;
  retryReason: string | null;
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
  /** The export whose instruction this retry export resends; null for the period's original. */
  supersedesPaymentExportId: string | null;
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

/** A Payment Instruction as the period's list reads it: with its outcomes and whether it is retried. */
export interface PaymentInstructionRecord extends PaymentInstructionView {
  /** Its Disbursement Outcomes in their order, oldest first; the last is the latest. */
  outcomes: DisbursementOutcomeView[];
  /** The instruction that retried this attempt, in a superseding export; null if none has. */
  retriedByPaymentInstructionId: string | null;
  /** Whether `retry` would take it now: its latest outcome is REJECTED or RETURNED, and no instruction retried it. */
  retryable: boolean;
}

export interface PaymentExportRecord extends Omit<PaymentExportView, 'instructions'> {
  instructions: PaymentInstructionRecord[];
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
  priorPaymentInstructionId: true,
  retryReason: true,
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
 * Generates, retries, and downloads the Payment Exports of a FINALIZED
 * payroll (#28, #337, #643). Each needs `payroll.payment_exports.generate`
 * held Agency-wide. Generating or retrying claims no payroll function
 * (hris-controls.md §5.20) and marks no one paid.
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
      const stored = await transaction.paymentExport.findFirst({
        where: {
          agencyId: context.agencyId,
          payrollPeriodId: periodId,
          supersedesPaymentExportId: null,
        },
      });
      if (stored) return toView(stored, await readInstructions(transaction, stored));

      const results = await readSourceResults(transaction, context, period);
      const destinations = await readDestinations(
        transaction,
        context,
        results.map((result) => result.employeeId),
      );
      const plan = planned(() =>
        planPaymentExport({ period, results, destinations, onDate: manilaToday() }),
      );
      return this.write(transaction, context, period, plan, destinations);
    });
  }

  /**
   * The period's Payment Exports, oldest first: its original, then each
   * superseding retry export. Each instruction carries its Disbursement
   * Outcomes in sequence and whether it can be retried now, so a reader needs
   * no rule of its own. A period with none, or not FINALIZED, lists none.
   */
  async list(context: RequestContext, periodId: string): Promise<PaymentExportRecord[]> {
    requirePermission(context, 'Reading Payment Exports');
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const period = await transaction.payrollPeriod.findFirst({
        where: { agencyId: context.agencyId, id: periodId },
        select: { id: true },
      });
      if (!period) throw periodNotFound();
      const rows = await transaction.paymentExport.findMany({
        where: { agencyId: context.agencyId, payrollPeriodId: periodId },
        orderBy: [{ generatedAt: 'asc' }, { id: 'asc' }],
      });
      const views: PaymentExportView[] = [];
      for (const row of rows) views.push(toView(row, await readInstructions(transaction, row)));
      const instructions = views.flatMap((view) => view.instructions);
      const outcomes = await transaction.disbursementOutcome.findMany({
        where: {
          agencyId: context.agencyId,
          paymentInstructionId: { in: instructions.map((instruction) => instruction.id) },
        },
        orderBy: [{ paymentInstructionId: 'asc' }, { sequence: 'asc' }],
      });
      const retriedBy = new Map(
        instructions
          .filter((instruction) => instruction.priorPaymentInstructionId !== null)
          .map((instruction) => [instruction.priorPaymentInstructionId!, instruction.id]),
      );
      return views.map((view) => ({
        ...view,
        instructions: view.instructions.map((instruction) => {
          const recorded = outcomes
            .filter((outcome) => outcome.paymentInstructionId === instruction.id)
            .map(outcomeView);
          const retriedByPaymentInstructionId = retriedBy.get(instruction.id) ?? null;
          const latest = recorded.at(-1);
          return {
            ...instruction,
            outcomes: recorded,
            retriedByPaymentInstructionId,
            retryable:
              retriedByPaymentInstructionId === null &&
              latest !== undefined &&
              RETRYABLE_OUTCOMES.includes(latest.outcome),
          };
        }),
      }));
    });
  }

  /**
   * Retry one Payment Instruction after its latest Disbursement Outcome is
   * REJECTED or RETURNED and its Employee's destination is corrected (#28,
   * #643): a superseding Payment Export, written like any other, with one new
   * instruction linked to the prior attempt and the reason. It resends the
   * prior payee, amount, and payment reference to the Employee's designated
   * destination today in Asia/Manila, which must differ from the prior one.
   * The prior export and instruction never change.
   *
   * Refused while the latest outcome is anything else, or none; once the
   * attempt has been retried, so only the latest attempt of a chain is
   * retried; and for any payee or amount in the request, which is a Payroll
   * Adjustment (ADR 0016). The period row lock orders two retries at once,
   * and orders a retry against a Disbursement Outcome recorded meanwhile.
   */
  async retry(
    context: RequestContext,
    target: { periodId: string; exportId: string; instructionId: string },
    rawInput: unknown,
  ): Promise<PaymentExportView> {
    requirePermission(context, 'Retrying a Payment Instruction');
    const { reason } = parseRetry(rawInput);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const period = await lockFinalizedPeriod(transaction, context, target.periodId);
      const superseded = await readExport(transaction, context, target.periodId, target.exportId);
      const prior = await transaction.paymentInstruction.findFirst({
        where: {
          agencyId: context.agencyId,
          paymentExportId: superseded.id,
          id: target.instructionId,
        },
        select: instructionSelect,
      });
      if (!prior) {
        throw new PaymentExportsServiceError(
          'The Payment Instruction could not be found.',
          404,
          'PAYMENT_INSTRUCTION_NOT_FOUND',
        );
      }
      const retried = await transaction.paymentInstruction.findFirst({
        where: { agencyId: context.agencyId, priorPaymentInstructionId: prior.id },
        select: { id: true, paymentExportId: true },
      });
      if (retried) {
        throw new PaymentExportsServiceError(
          `This Payment Instruction was already retried by Payment Instruction ${retried.id} in Payment Export ${retried.paymentExportId}; only the latest attempt can be retried.`,
          409,
          'PAYMENT_INSTRUCTION_ALREADY_RETRIED',
        );
      }
      const latest = await transaction.disbursementOutcome.findFirst({
        where: { agencyId: context.agencyId, paymentInstructionId: prior.id },
        orderBy: { sequence: 'desc' },
        select: { outcome: true },
      });
      if (!latest || !RETRYABLE_OUTCOMES.includes(latest.outcome)) {
        throw new PaymentExportsServiceError(
          `${
            latest
              ? `This Payment Instruction's latest Disbursement Outcome is ${latest.outcome}`
              : 'This Payment Instruction has no Disbursement Outcome yet'
          }; it is handed off again only after it is REJECTED or RETURNED.`,
          409,
          'PAYMENT_INSTRUCTION_NOT_RETRYABLE',
        );
      }

      const { employeeId } = await transaction.payrollEmployee.findUniqueOrThrow({
        where: { agencyId_id: { agencyId: context.agencyId, id: prior.payrollEmployeeId } },
        select: { employeeId: true },
      });
      const destinations = await readDestinations(transaction, context, [employeeId]);
      const plan = planned(() =>
        planPaymentRetry({
          prior: { ...prior, amount: prior.amount.toFixed(2) },
          employeeId,
          destinations,
          onDate: manilaToday(),
        }),
      );
      return this.write(transaction, context, period, plan, destinations, {
        supersedesPaymentExportId: superseded.id,
        priorPaymentInstructionId: prior.id,
        priorOutcome: latest.outcome,
        reason,
      });
    });
  }

  /**
   * Store a planned export, its instructions, and its Audit Event, with the
   * CSV's and the summary's checksums. A retry's export supersedes the prior
   * attempt's, and its instruction names that attempt and the reason.
   */
  private async write(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    period: PaymentExportPeriod,
    plan: PaymentExportPlan,
    destinations: Destination[],
    retry?: NonNullable<PaymentExportSnapshot['retry']> & { priorOutcome: string },
  ): Promise<PaymentExportView> {
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
      ...(retry && {
        retry: {
          supersedesPaymentExportId: retry.supersedesPaymentExportId,
          priorPaymentInstructionId: retry.priorPaymentInstructionId,
          reason: retry.reason,
        },
      }),
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
        payrollPeriodId: period.id,
        supersedesPaymentExportId: retry?.supersedesPaymentExportId ?? null,
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
      data: rows.map((row) => ({
        ...row,
        agencyId: context.agencyId,
        paymentExportId: id,
        priorPaymentInstructionId: retry?.priorPaymentInstructionId ?? null,
        retryReason: retry?.reason ?? null,
      })),
    });
    await transaction.auditEvent.create({
      data: {
        ...audit(context, retry ? PAYMENT_EXPORT_RETRY_GENERATED : PAYMENT_EXPORT_GENERATED, id),
        newStatus: 'GENERATED',
        reason: retry?.reason ?? null,
        metadata: {
          payrollPeriodId: period.id,
          calculationVersion: period.calculationVersion,
          contract: PAYMENT_EXPORT_CONTRACT,
          checksum,
          summaryChecksum: created.summaryChecksum,
          ...plan.controls,
          ...(retry && {
            supersedesPaymentExportId: retry.supersedesPaymentExportId,
            priorPaymentInstructionId: retry.priorPaymentInstructionId,
            priorOutcome: retry.priorOutcome,
            paymentInstructionId: rows[0]!.id,
          }),
        },
        // One original export per period: generating again returns it. A
        // retry export is generated once, for the attempt it resends.
        idempotencyKey: 'generated',
      },
    });
    return toView(created, await readInstructions(transaction, created));
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

/** The parsed reason, after refusing any payee or amount a retry would change. */
function parseRetry(rawInput: unknown): z.output<typeof paymentRetrySchema> {
  if (typeof rawInput === 'object' && rawInput !== null) {
    const changed = PAYEE_OR_AMOUNT_FIELDS.filter((field) => field in rawInput);
    if (changed.length > 0) {
      throw new PaymentExportsServiceError(
        `A retry resends its prior attempt's payee and amount to a corrected destination, so it cannot set ${changed.join(', ')}. A payee or amount change is a Payroll Adjustment against the finalized payroll (ADR 0016); nothing was generated.`,
        409,
        'PAYMENT_RETRY_CHANGES_PAYEE_OR_AMOUNT',
      );
    }
  }
  const parsed = paymentRetrySchema.safeParse(rawInput);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new PaymentExportsServiceError(
    `${issue?.path.map(String).join('.') || 'request'}: ${issue?.message ?? 'invalid'}`,
    400,
    'INVALID_INPUT',
  );
}

/** A plan, or the refusal it raised, as this service's error. */
function planned(plan: () => PaymentExportPlan): PaymentExportPlan {
  try {
    return plan();
  } catch (error: unknown) {
    if (error instanceof PaymentExportBlockedError) {
      throw new PaymentExportsServiceError(error.message, 409, error.code);
    }
    throw error;
  }
}

type Destination = Awaited<ReturnType<typeof readDestinations>>[number];

/** Every Payroll Bank Account of the Employees, with its dates as ISO text and its ciphertext. */
async function readDestinations(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  employeeIds: string[],
) {
  const accounts = await transaction.payrollBankAccount.findMany({
    where: { agencyId: context.agencyId, employeeId: { in: employeeIds } },
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
  return accounts.map((account) => ({
    ...account,
    effectiveFrom: isoDate(account.effectiveFrom),
    effectiveTo: account.effectiveTo ? isoDate(account.effectiveTo) : null,
  }));
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
    supersedesPaymentExportId: row.supersedesPaymentExportId,
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

function outcomeView(row: {
  id: string;
  paymentInstructionId: string;
  sequence: number;
  outcome: string;
  externalReference: string | null;
  evidenceDocumentVersionId: string | null;
  reason: string | null;
  recordedByMembershipId: string;
  recordedAt: Date;
}): DisbursementOutcomeView {
  return {
    id: row.id,
    paymentInstructionId: row.paymentInstructionId,
    sequence: row.sequence,
    outcome: row.outcome as DisbursementOutcomeKind,
    externalReference: row.externalReference,
    evidenceDocumentVersionId: row.evidenceDocumentVersionId,
    reason: row.reason,
    recordedByMembershipId: row.recordedByMembershipId,
    recordedAt: row.recordedAt.toISOString(),
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
