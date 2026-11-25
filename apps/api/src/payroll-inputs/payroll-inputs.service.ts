import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import {
  livePayrollsCarrying,
  openPayrollAdjustment,
} from '../payroll-periods/payroll-adjustments';
import { PayrollMonetizationCalculator } from '../payroll-monetization/payroll-monetization.calculator';
import {
  payrollInputSubmissionSchema,
  type PayrollInputKind,
  type PayrollInputListFilters,
  type PayrollInputSourceModule,
  type PayrollInputStatus,
  type PayrollInputSubmission,
  type PayrollInputWithdrawal,
} from './payroll-inputs.schemas';

/**
 * Payroll's answer to a source module. `REJECTED` will not change on retry;
 * `RETRYABLE_FAILURE` means Payroll cannot accept the input yet and the same
 * request may succeed later. Neither creates a Payroll Input. A monetization
 * earning's answer carries the amount Payroll computed, and a refusal for a
 * missing authority or salary fact names it in `missingFacts`.
 */
export type PayrollInputAcceptance =
  | { outcome: 'ACCEPTED' | 'ALREADY_ACCEPTED'; payrollInputId: string; amount?: string }
  | {
      outcome: 'REJECTED' | 'RETRYABLE_FAILURE';
      code: string;
      reason: string;
      missingFacts?: string[];
    };

/**
 * Payroll's answer to a withdrawal, with the same failure meanings as
 * acceptance. `DEFERRED` means a finalized payroll consumed the input, so it
 * stays `CONSUMED` and the withdrawal waits in the named Payroll Adjustment
 * against that payroll, with the adjustment's current status (#650).
 */
export type PayrollInputWithdrawalAnswer =
  | { outcome: 'WITHDRAWN' | 'ALREADY_WITHDRAWN'; payrollInputId: string }
  | PayrollInputDeferral
  | { outcome: 'REJECTED' | 'RETRYABLE_FAILURE'; code: string; reason: string };

export interface PayrollInputDeferral {
  outcome: 'DEFERRED' | 'ALREADY_DEFERRED';
  payrollInputId: string;
  payrollAdjustmentId: string;
  originalPayrollPeriodId: string;
  adjustmentStatus: 'OPEN' | 'POSTED' | 'CANCELLED';
}

export interface PayrollInputSummary {
  id: string;
  employeeId: string;
  sourceModule: PayrollInputSourceModule;
  inputKind: PayrollInputKind;
  sourceKey: string;
  sourceType: string;
  sourceId: string;
  effectiveDate: string;
  quantity: string | null;
  amount: string | null;
  status: PayrollInputStatus;
  acceptedAt: string;
  consumedByPayrollPeriodId: string | null;
  replacesPayrollInputId: string | null;
}

export class PayrollInputsServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PayrollInputsServiceError';
  }
}

const LIST_LIMIT = 200;

/**
 * The blocking exception a withdrawal writes on each live period that uses the
 * input (migration 0181).
 */
export const PAYROLL_INPUT_WITHDRAWN = 'PAYROLL_INPUT_WITHDRAWN';

const summarySelect = {
  id: true,
  employeeId: true,
  sourceModule: true,
  inputKind: true,
  sourceKey: true,
  sourceType: true,
  sourceId: true,
  effectiveDate: true,
  quantity: true,
  amount: true,
  status: true,
  acceptedAt: true,
  consumedByPayrollPeriodId: true,
  replacesPayrollInputId: true,
} as const;

/**
 * The Payroll Input inbox, and the only way a source module posts to Payroll
 * (payroll-schema.md §4).
 */
@Injectable()
export class PayrollInputsService {
  /**
   * Without a calculator, as in tests of sources that post no monetization,
   * a monetization earning fails closed.
   */
  constructor(
    @Inject(PayrollMonetizationCalculator)
    private readonly monetization?: PayrollMonetizationCalculator,
  ) {}

  /**
   * Accept one source effect inside the caller's transaction, which must carry
   * the caller's Agency database context. The input commits or rolls back with
   * that transaction. A retry with the same source key and payload returns the
   * existing input; the same key with a different payload is rejected.
   */
  async acceptInTransaction(
    transaction: Prisma.TransactionClient,
    submission: PayrollInputSubmission,
  ): Promise<PayrollInputAcceptance> {
    const parsed = payrollInputSubmissionSchema.safeParse(submission);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return rejected(
        'PAYROLL_INPUT_INVALID',
        `${issue?.path.map(String).join('.') || 'request'}: ${issue?.message ?? 'invalid'}`,
      );
    }
    const request = parsed.data;
    const quantity = request.quantity == null ? null : new Prisma.Decimal(request.quantity);
    const payloadHash = createHash('sha256')
      .update(
        canonicalJson({
          employeeId: request.employeeId,
          inputKind: request.inputKind,
          sourceType: request.sourceType,
          sourceId: request.sourceId,
          effectiveDate: request.effectiveDate,
          quantity: quantity?.toFixed(4) ?? null,
          payload: request.payload,
          // Only a replacement adds the key, so earlier inputs keep their hash.
          ...(request.replacesPayrollInputId
            ? { replacesPayrollInputId: request.replacesPayrollInputId }
            : {}),
        }),
      )
      .digest('hex');
    const key = {
      agencyId: request.agencyId,
      sourceModule: request.sourceModule,
      sourceKey: request.sourceKey,
    };

    const existing = await findByKey(transaction, key);
    if (existing) return replay(existing, payloadHash);

    // Under RLS this also refuses an Agency other than the caller's context.
    const employee = await transaction.employee.findFirst({
      where: { agencyId: request.agencyId, id: request.employeeId },
      select: { id: true },
    });
    if (!employee) {
      return rejected('PAYROLL_INPUT_EMPLOYEE_NOT_FOUND', 'The Employee is not in this Agency.');
    }

    // Payroll computes a monetization amount itself and freezes how beside the
    // source's payload; the hash stays the source's request (#161).
    let amount: string | null = null;
    let payloadSnapshot = request.payload as Prisma.InputJsonObject;
    if (request.inputKind === 'MONETIZATION_EARNING') {
      if (!this.monetization) {
        return {
          outcome: 'RETRYABLE_FAILURE',
          code: 'PAYROLL_INPUT_VALUATION_UNAVAILABLE',
          reason: 'Payroll has no monetization calculator bound.',
        };
      }
      const valued = await this.monetization.valueInTransaction(transaction, request);
      if (!valued.ok) {
        return {
          outcome: valued.outcome,
          code: valued.code,
          reason: valued.reason,
          missingFacts: valued.missingFacts,
        };
      }
      amount = valued.amount;
      payloadSnapshot = { ...payloadSnapshot, payrollValuation: valued.valuation };
    }

    // A replacement names a withdrawn input of the same source, Employee, and
    // kind: cancelled, or consumed with its withdrawal deferred to an adjustment.
    if (request.replacesPayrollInputId) {
      const replaced = await transaction.payrollInput.findFirst({
        where: { agencyId: request.agencyId, id: request.replacesPayrollInputId },
        select: { id: true, employeeId: true, sourceModule: true, inputKind: true, status: true },
      });
      if (
        !replaced ||
        replaced.employeeId !== request.employeeId ||
        replaced.sourceModule !== request.sourceModule ||
        replaced.inputKind !== request.inputKind
      ) {
        return rejected(
          'PAYROLL_INPUT_REPLACED_NOT_FOUND',
          'The replaced Payroll Input is not one this source posted for the Employee and kind.',
        );
      }
      if (
        replaced.status !== 'CANCELLED' &&
        !(
          replaced.status === 'CONSUMED' &&
          (await deferralOf(transaction, request.agencyId, replaced.id))
        )
      ) {
        return rejected(
          'PAYROLL_INPUT_REPLACED_NOT_WITHDRAWN',
          'A replacement needs its earlier Payroll Input withdrawn first.',
        );
      }
    }

    const acceptedAt = await lockPayrollInputAcceptance(transaction, request.agencyId, 'SHARED');
    // ON CONFLICT DO NOTHING keeps a concurrent duplicate from aborting the
    // caller's transaction; the committed winner is read back and compared.
    const { count } = await transaction.payrollInput.createMany({
      data: {
        ...key,
        acceptedAt,
        employeeId: request.employeeId,
        inputKind: request.inputKind,
        sourceType: request.sourceType,
        sourceId: request.sourceId,
        effectiveDate: new Date(`${request.effectiveDate}T00:00:00.000Z`),
        quantity,
        amount: amount === null ? null : new Prisma.Decimal(amount),
        status: 'PENDING',
        payloadSnapshot,
        payloadHash,
        replacesPayrollInputId: request.replacesPayrollInputId ?? null,
      },
      skipDuplicates: true,
    });
    const stored = await findByKey(transaction, key);
    if (!stored) throw new Error('The accepted Payroll Input could not be read back.');
    return count === 1
      ? { outcome: 'ACCEPTED', payrollInputId: stored.id, ...amountOf(stored) }
      : replay(stored, payloadHash);
  }

  /**
   * Withdraw a source module's own input inside the caller's transaction, which
   * must carry the caller's Agency database context (payroll-schema.md §4,
   * #330 D11 #15). A `PENDING` input becomes `CANCELLED` under the source's
   * correction key, and stays readable. A retry with the same key answers
   * `ALREADY_WITHDRAWN`; the key cannot withdraw another input. A replacement
   * is then accepted with `replacesPayrollInputId` in the same transaction.
   *
   * When a live calculation uses the input, {@link withdrawFromLiveCalculation}
   * also blocks each such period until it is returned and recalculated (#649).
   * When a finalized payroll consumed it, {@link deferToPayrollAdjustment}
   * leaves it unchanged and records the withdrawal in a Payroll Adjustment
   * against that payroll (#650); a replacement may then name it too. Two
   * concurrent withdrawals of different inputs under one key fail the second
   * caller's transaction on the key's unique index.
   */
  async withdrawInTransaction(
    transaction: Prisma.TransactionClient,
    request: PayrollInputWithdrawal,
  ): Promise<PayrollInputWithdrawalAnswer> {
    const { agencyId, sourceModule, payrollInputId } = request;
    const correctionKey = request.correctionKey.trim();
    if (!correctionKey) {
      return rejected(
        'PAYROLL_INPUT_INVALID',
        'correctionKey: A stable correction key is required.',
      );
    }
    // A deferred withdrawal keeps its key on its adjustment cause, not the input.
    const keyed = await transaction.payrollInput.findFirst({
      where: { agencyId, sourceModule, sourceCorrectionKey: correctionKey },
      select: { id: true },
    });
    const keyedCause = await transaction.payrollAdjustmentCause.findFirst({
      where: { agencyId, sourceCorrectionKey: correctionKey },
      select: { payrollInputId: true },
    });
    if (
      (keyed && keyed.id !== payrollInputId) ||
      (keyedCause && keyedCause.payrollInputId !== payrollInputId)
    ) {
      return rejected(
        'PAYROLL_CORRECTION_KEY_CONFLICT',
        'The correction key already withdrew another Payroll Input.',
      );
    }

    // A finalization, a void, or another withdrawal may change the input
    // between the read and the write; the next pass answers its new state.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const input = await transaction.payrollInput.findFirst({
        where: { agencyId, id: payrollInputId },
        select: {
          sourceModule: true,
          status: true,
          sourceCorrectionKey: true,
          consumedByPayrollPeriodId: true,
        },
      });
      const settled = settledWithdrawal(input, request, correctionKey);
      if (settled) return settled;
      if (input?.status === 'CONSUMED') {
        const deferred = await deferToPayrollAdjustment(
          transaction,
          request,
          correctionKey,
          input.consumedByPayrollPeriodId,
        );
        if (deferred) return deferred;
        continue;
      }

      // Before the period rows, in the order a calculation start takes them.
      await lockPayrollInputAcceptance(transaction, agencyId, 'SHARED');
      const live = await lockLiveCalculations(transaction, agencyId, payrollInputId);
      const cancelled = await transaction.payrollInput.updateMany({
        where: { agencyId, id: payrollInputId, sourceModule, status: 'PENDING' },
        data: { status: 'CANCELLED', sourceCorrectionKey: correctionKey },
      });
      if (cancelled.count === 1) {
        if (live.length > 0) {
          await withdrawFromLiveCalculation(transaction, agencyId, payrollInputId, live);
        }
        return { outcome: 'WITHDRAWN', payrollInputId };
      }
    }
    throw new Error('The Payroll Input kept changing while it was withdrawn.');
  }

  /** Payroll Inputs of the acting Agency, newest first, by source module and status. */
  async list(
    context: RequestContext,
    filters: PayrollInputListFilters,
  ): Promise<PayrollInputSummary[]> {
    if (!holdsAgencyWide(context, 'payroll.inputs.read')) {
      throw new PayrollInputsServiceError(
        'Reading Payroll Inputs needs the payroll.inputs.read permission for the whole Agency.',
        403,
        'PAYROLL_INPUT_READ_FORBIDDEN',
      );
    }
    const rows = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      transaction.payrollInput.findMany({
        where: {
          agencyId: context.agencyId,
          ...(filters.sourceModule ? { sourceModule: filters.sourceModule } : {}),
          ...(filters.status ? { status: filters.status } : {}),
        },
        orderBy: [{ acceptedAt: 'desc' }, { id: 'desc' }],
        take: LIST_LIMIT,
        select: summarySelect,
      }),
    );
    return rows.map((row) => ({
      ...row,
      sourceModule: row.sourceModule as PayrollInputSourceModule,
      inputKind: row.inputKind as PayrollInputKind,
      status: row.status as PayrollInputStatus,
      effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
      quantity: row.quantity?.toFixed(4) ?? null,
      amount: row.amount?.toFixed(4) ?? null,
      acceptedAt: row.acceptedAt.toISOString(),
    }));
  }
}

/**
 * Payroll's answer for an input that is `CANCELLED` or not the source's.
 * `PENDING` and `CONSUMED` inputs get `null`: their handlers answer them.
 */
function settledWithdrawal(
  input: { sourceModule: string; status: string; sourceCorrectionKey: string | null } | null,
  request: PayrollInputWithdrawal,
  correctionKey: string,
): PayrollInputWithdrawalAnswer | null {
  if (!input || input.sourceModule !== request.sourceModule) {
    return rejected('PAYROLL_INPUT_NOT_FOUND', 'The Payroll Input is not one this source posted.');
  }
  if (input.status === 'CANCELLED') {
    // The key is citext, so a retry matches it without regard to case.
    return input.sourceCorrectionKey?.toLowerCase() === correctionKey.toLowerCase()
      ? { outcome: 'ALREADY_WITHDRAWN', payrollInputId: request.payrollInputId }
      : rejected(
          'PAYROLL_INPUT_ALREADY_WITHDRAWN',
          'Another correction already withdrew the Payroll Input.',
        );
  }
  return null;
}

/**
 * The handler for an input a `FINALIZED` payroll consumed (#650, #330 D11
 * #15, ADR 0016). The finalized payroll and the input stay as they are:
 * Payroll opens the Employee's Payroll Adjustment against that payroll, or
 * joins the `OPEN` one, with a `SOURCE_CORRECTION` cause naming the input and
 * the source's correction key, and answers `DEFERRED` with the adjustment.
 * The period that carries the adjustment recalculates the original without
 * the input. A retry under the same key answers `ALREADY_DEFERRED` with the
 * adjustment's current status; another key is refused, as for a cancelled
 * input. Voiding the payroll later cancels the adjustment and makes the input
 * `CANCELLED` under this key (#358).
 *
 * The consuming period's row is locked `FOR SHARE` before the input row, in
 * the order a void takes them, so a void either committed first, leaving the
 * input `PENDING` (answered `null` for the caller to read again), or waits
 * for this cause and then cancels the input. A cause that joins an adjustment
 * a live period already carries would not be counted, so that is refused as
 * retryable until the carrying period is finalized or returned to `DRAFT`.
 */
async function deferToPayrollAdjustment(
  transaction: Prisma.TransactionClient,
  request: PayrollInputWithdrawal,
  correctionKey: string,
  consumedByPayrollPeriodId: string | null,
): Promise<PayrollInputWithdrawalAnswer | null> {
  const { agencyId, payrollInputId } = request;
  const [period] = consumedByPayrollPeriodId
    ? await transaction.$queryRaw<{ status: string }[]>`
        SELECT "status" FROM "payroll_periods"
        WHERE "agency_id" = CAST(${agencyId} AS uuid)
          AND "id" = CAST(${consumedByPayrollPeriodId} AS uuid)
        FOR SHARE`
    : [];
  const [input] = await transaction.$queryRaw<
    { employee_id: string; status: string; consumed_by_payroll_period_id: string | null }[]
  >`
    SELECT "employee_id"::text, "status", "consumed_by_payroll_period_id"::text
    FROM "payroll_inputs"
    WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${payrollInputId} AS uuid)
    FOR UPDATE`;
  if (
    !input ||
    input.status !== 'CONSUMED' ||
    input.consumed_by_payroll_period_id !== consumedByPayrollPeriodId
  ) {
    return null;
  }
  if (period?.status !== 'FINALIZED') {
    return {
      outcome: 'RETRYABLE_FAILURE',
      code: 'PAYROLL_INPUT_CONSUMED_CORRECTION_UNAVAILABLE',
      reason: 'The Payroll Input is consumed by a payroll that is not FINALIZED.',
    };
  }
  const originalPayrollPeriodId = consumedByPayrollPeriodId!;

  const existing = await deferralOf(transaction, agencyId, payrollInputId);
  if (existing) {
    if (existing.sourceCorrectionKey.toLowerCase() !== correctionKey.toLowerCase()) {
      return rejected(
        'PAYROLL_INPUT_ALREADY_WITHDRAWN',
        'Another correction already withdrew the Payroll Input.',
      );
    }
    return {
      outcome: 'ALREADY_DEFERRED',
      payrollInputId,
      payrollAdjustmentId: existing.payrollAdjustmentId,
      originalPayrollPeriodId,
      adjustmentStatus: existing.adjustmentStatus,
    };
  }

  const open = await transaction.payrollAdjustment.findFirst({
    where: {
      agencyId,
      originalPayrollPeriodId,
      employeeId: input.employee_id,
      status: 'OPEN',
    },
    select: { id: true },
  });
  const [carrier] = await livePayrollsCarrying(transaction, agencyId, open ? [open.id] : []);
  if (carrier) {
    return {
      outcome: 'RETRYABLE_FAILURE',
      code: 'PAYROLL_ADJUSTMENT_IN_PAYROLL',
      reason: `Payroll Period ${carrier.code} already carries the Employee's adjustment for this payroll and calculated its difference. Retry after it is finalized or returned to DRAFT.`,
    };
  }
  const { payrollAdjustmentId } = await openPayrollAdjustment(transaction, {
    agencyId,
    originalPayrollPeriodId,
    employeeId: input.employee_id,
    cause: { origin: 'SOURCE_CORRECTION', payrollInputId, sourceCorrectionKey: correctionKey },
  });
  return {
    outcome: 'DEFERRED',
    payrollInputId,
    payrollAdjustmentId,
    originalPayrollPeriodId,
    adjustmentStatus: 'OPEN',
  };
}

/** The source correction a Payroll Adjustment holds for a consumed input, if any. */
async function deferralOf(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  payrollInputId: string,
) {
  const cause = await transaction.payrollAdjustmentCause.findFirst({
    where: { agencyId, origin: 'SOURCE_CORRECTION', payrollInputId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      payrollAdjustmentId: true,
      sourceCorrectionKey: true,
      adjustment: { select: { status: true } },
    },
  });
  return cause
    ? {
        payrollAdjustmentId: cause.payrollAdjustmentId,
        sourceCorrectionKey: cause.sourceCorrectionKey!,
        adjustmentStatus: cause.adjustment.status as PayrollInputDeferral['adjustmentStatus'],
      }
    : null;
}

/**
 * The Agency's lock between accepting Payroll Inputs (`SHARED`) and starting
 * a calculation (`EXCLUSIVE`), taken before any Payroll Period row. Under it,
 * an acceptance stamps `accepted_at` from the clock, not from its
 * transaction's start, so an input either commits before a start fixes its
 * cutoff, or is accepted after that cutoff (ADR 0014). Without it, an input
 * whose transaction began before the cutoff could commit after the
 * calculation read the inbox, and a recalculation at the same cutoff would
 * take it. Returns the database clock once the lock is held.
 */
export async function lockPayrollInputAcceptance(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  mode: 'SHARED' | 'EXCLUSIVE',
): Promise<Date> {
  const key = `payroll_input_acceptance:${agencyId}`;
  if (mode === 'SHARED') {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`;
  } else {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
  const [{ now }] = await transaction.$queryRaw<[{ now: Date }]>`SELECT clock_timestamp() AS "now"`;
  return now;
}

interface LiveCalculation {
  payrollPeriodId: string;
  calculationVersion: number;
  status: string;
}

/**
 * The open periods whose live calculation uses the input. By ADR 0014 a period
 * uses every unconsumed input accepted at or before its cutoff; past `DRAFT`
 * that use is live. No recorded rule maps an input kind to a special period's
 * components, so a live special period counts too. Locking the Agency's open
 * periods holds a calculation start, a cutoff move, or a status move until
 * the caller commits, and waits out a running calculation.
 */
async function lockLiveCalculations(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  payrollInputId: string,
): Promise<LiveCalculation[]> {
  const periods = await transaction.$queryRaw<
    { id: string; calculation_version: number; status: string; live: boolean }[]
  >`
    SELECT p."id", p."calculation_version", p."status",
           p."status" <> 'DRAFT' AND p."cutoff_at" >= i."accepted_at" AS "live"
    FROM "payroll_periods" p
    JOIN "payroll_inputs" i ON i."agency_id" = p."agency_id" AND i."id" = ${payrollInputId}::uuid
    WHERE p."agency_id" = ${agencyId}::uuid AND p."status" NOT IN ('FINALIZED', 'VOIDED')
    ORDER BY p."id"
    FOR SHARE OF p`;
  return periods
    .filter((period) => period.live)
    .map((period) => ({
      payrollPeriodId: period.id,
      calculationVersion: period.calculation_version,
      status: period.status,
    }));
}

/**
 * The handler for an input a `CALCULATING`, `FOR_REVIEW`, `CERTIFIED`, or
 * `APPROVED` period uses, once the caller has cancelled it (#649, #330 D11
 * #15). Each such period gets a `PAYROLL_INPUT_WITHDRAWN` blocking exception
 * on its current version, which refuses certification, approval, and
 * finalization until the period is returned and recalculated; the next
 * version no longer reads the cancelled input. Nothing else changes: the
 * input keeps its payload, and no correction record links to it. A queued
 * calculation counts the exception and returns to `DRAFT`; a running one was
 * waited out, so the mark lands on the version it committed.
 */
async function withdrawFromLiveCalculation(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  payrollInputId: string,
  live: LiveCalculation[],
): Promise<void> {
  const input = await transaction.payrollInput.findFirstOrThrow({
    where: { agencyId, id: payrollInputId },
    select: { employeeId: true, sourceModule: true, inputKind: true, sourceCorrectionKey: true },
  });
  await transaction.payrollException.createMany({
    data: live.map((period) => ({
      agencyId,
      payrollPeriodId: period.payrollPeriodId,
      calculationVersion: period.calculationVersion,
      employeeId: input.employeeId,
      exceptionType: PAYROLL_INPUT_WITHDRAWN,
      severity: 'BLOCKING',
      status: 'OPEN',
      details: {
        message: `${input.sourceModule} withdrew a ${input.inputKind} Payroll Input that calculation version ${period.calculationVersion} uses. Return the period and calculate it again; certification, approval, and finalization are refused until then.`,
        payrollInputId,
        sourceModule: input.sourceModule,
        inputKind: input.inputKind,
        sourceCorrectionKey: input.sourceCorrectionKey,
        periodStatus: period.status,
      },
    })),
  });
}

function findByKey(
  transaction: Prisma.TransactionClient,
  key: { agencyId: string; sourceModule: string; sourceKey: string },
) {
  return transaction.payrollInput.findUnique({
    where: { agencyId_sourceModule_sourceKey: key },
    select: { id: true, payloadHash: true, amount: true },
  });
}

function replay(
  existing: { id: string; payloadHash: string; amount: Prisma.Decimal | null },
  payloadHash: string,
): PayrollInputAcceptance {
  return existing.payloadHash === payloadHash
    ? { outcome: 'ALREADY_ACCEPTED', payrollInputId: existing.id, ...amountOf(existing) }
    : rejected(
        'PAYROLL_INPUT_SOURCE_KEY_CONFLICT',
        'The source key already names a Payroll Input with a different payload.',
      );
}

/** Only a monetization earning has an amount, so other answers keep their shape. */
function amountOf(input: { amount: Prisma.Decimal | null }): { amount?: string } {
  return input.amount === null ? {} : { amount: input.amount.toFixed(2) };
}

function rejected(
  code: string,
  reason: string,
): { outcome: 'REJECTED'; code: string; reason: string } {
  return { outcome: 'REJECTED', code, reason };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
