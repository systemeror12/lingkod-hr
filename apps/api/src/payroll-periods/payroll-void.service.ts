import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import { instructionsBlockingVoid } from '../payment-exports/disbursement-outcomes.service';
import {
  claimFunction,
  lockPeriod,
  requirePermission,
  requireStatus,
  type LockedPeriod,
} from './payroll-certification.service';
import {
  auditEvent,
  lockRegularPeriodSequence,
  parse,
  PayrollPeriodsServiceError,
  stale,
  summarySelect,
  toSummary,
  type PayrollPeriodSummary,
} from './payroll-periods.service';
import {
  payrollPeriodApproveVoidSchema,
  payrollPeriodReasonedCommandSchema,
  payrollPeriodVoidRequestSchema,
} from './payroll-periods.schemas';

export const PAYROLL_PERIOD_VOID_REQUESTED = 'PAYROLL_PERIOD_VOID_REQUESTED';
export const PAYROLL_PERIOD_VOID_DECLINED = 'PAYROLL_PERIOD_VOID_DECLINED';
export const PAYROLL_PERIOD_VOIDED = 'PAYROLL_PERIOD_VOIDED';

/**
 * Void and replace a FINALIZED Payroll Period (hris-controls.md §5.20, #330,
 * #358, ADR 0016), in two steps by two people:
 *
 * - Request (`payroll.periods.void`) records a reason and a supporting
 *   finalized Document Version on the period, which stays FINALIZED. It
 *   claims no payroll function.
 * - Decline (`payroll.periods.approve_void`) clears the request, with a
 *   reason; the request stays in its Audit Events.
 * - Approve (`payroll.periods.approve_void`) voids the period in one
 *   transaction: the period and its finalized results become VOIDED, its
 *   sources are released so a replacement regular period for the same month
 *   consumes them, its Payslips become SUPERSEDED, open Payroll Adjustments
 *   against it are cancelled, and those it posted reopen.
 *
 * Decline and approval claim APPROVAL, and neither is the requester's. The
 * request and the approval each refuse while the void conditions fail: a
 * regular period has a later regular period that is not VOIDED, or a Payment
 * Instruction of the period was handed off (its latest Disbursement Outcome
 * is SUBMITTED, ACCEPTED, or SETTLED). Each first takes the Agency's regular
 * period sequence lock, which creating a regular period also takes, then
 * locks the period row, which recording an outcome also locks, so both
 * answers hold until it commits.
 *
 * Approval does not take the payroll input acceptance lock. That lock keeps
 * an input's `accepted_at` stamp and its commit on one side of a cutoff (ADR
 * 0014); the void stamps nothing, the inputs it returns were accepted long
 * before, and its writes become visible together when it commits. No other
 * period can be calculating on them meanwhile except a special one, and the
 * finalization of whichever period uses them rechecks that each is unconsumed.
 *
 * The voided period's Payment Export, Payroll Register, and Accounting
 * Support Export are superseded by the period's VOIDED status: each stays
 * readable, and none is generated again, because each is generated only for a
 * FINALIZED period.
 */
@Injectable()
export class PayrollVoidService {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  async request(
    context: RequestContext,
    periodId: string,
    rawInput: unknown,
  ): Promise<PayrollPeriodSummary> {
    requirePermission(context, 'payroll.periods.void', 'Requesting a payroll void');
    const input = parse(payrollPeriodVoidRequestSchema, rawInput);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      await lockRegularPeriodSequence(transaction, context.agencyId);
      const period = await lockFinalized(transaction, context, periodId, input.rowVersion);
      if (period.voidRequestedByMembershipId) {
        throw new PayrollPeriodsServiceError(
          'A void of this Payroll Period is already requested; it is approved or declined first.',
          409,
          'PAYROLL_VOID_ALREADY_REQUESTED',
        );
      }
      await refuseVoidConditions(transaction, context, periodId, period);
      const evidence = await this.documents.resolveFinalizedVersionInTransaction(
        transaction,
        context,
        input.documentVersionId,
      );
      if (!evidence) {
        throw new PayrollPeriodsServiceError(
          'The supporting document must be an exact finalized Document Version of this Agency.',
          400,
          'PAYROLL_VOID_DOCUMENT_INVALID',
        );
      }
      const after = await updatePeriod(transaction, context, periodId, period, {
        voidRequestedByMembershipId: context.membershipId,
        voidRequestedAt: new Date(),
        voidReason: input.reason,
        voidDocumentVersionId: input.documentVersionId,
      });
      await transaction.auditEvent.create({
        data: auditEvent(context, {
          action: PAYROLL_PERIOD_VOID_REQUESTED,
          entityId: periodId,
          previousStatus: 'FINALIZED',
          newStatus: 'FINALIZED',
          reason: input.reason,
          metadata: { documentVersionId: input.documentVersionId },
        }),
      });
      return after;
    });
  }

  async decline(
    context: RequestContext,
    periodId: string,
    rawInput: unknown,
  ): Promise<PayrollPeriodSummary> {
    requirePermission(context, 'payroll.periods.approve_void', 'Declining a payroll void');
    const input = parse(payrollPeriodReasonedCommandSchema, rawInput);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const period = await lockFinalized(transaction, context, periodId, input.rowVersion);
      const request = requireOpenRequest(context, period);
      await claimFunction(transaction, context, periodId, 'APPROVAL');
      const after = await updatePeriod(transaction, context, periodId, period, {
        voidRequestedByMembershipId: null,
        voidRequestedAt: null,
        voidReason: null,
        voidDocumentVersionId: null,
      });
      await transaction.auditEvent.create({
        data: auditEvent(context, {
          action: PAYROLL_PERIOD_VOID_DECLINED,
          entityId: periodId,
          previousStatus: 'FINALIZED',
          newStatus: 'FINALIZED',
          reason: input.reason,
          metadata: { declinedRequest: request },
        }),
      });
      return after;
    });
  }

  /**
   * Approve the open void request. A retry by the approver at the row version
   * they sent returns the voided period and writes nothing; anyone else then
   * finds it VOIDED.
   */
  async approve(
    context: RequestContext,
    periodId: string,
    rawInput: unknown,
  ): Promise<PayrollPeriodSummary> {
    requirePermission(context, 'payroll.periods.approve_void', 'Approving a payroll void');
    const input = parse(payrollPeriodApproveVoidSchema, rawInput);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      await lockRegularPeriodSequence(transaction, context.agencyId);
      const locked = await lockPeriod(transaction, context, periodId);
      const period = await readVoidColumns(transaction, context, periodId, locked);
      if (
        locked.status === 'VOIDED' &&
        locked.rowVersion === input.rowVersion + 1 &&
        period.voidedByMembershipId === context.membershipId
      ) {
        return readSummary(transaction, context, periodId);
      }
      requireStatus(locked, 'FINALIZED');
      if (locked.rowVersion !== input.rowVersion) throw stale();
      const request = requireOpenRequest(context, period);
      await refuseVoidConditions(transaction, context, periodId, period);
      await claimFunction(transaction, context, periodId, 'APPROVAL');

      // The period first: every guard below admits its write only once the
      // period row is VOIDED by this transaction.
      const after = await updatePeriod(transaction, context, periodId, period, {
        status: 'VOIDED',
        voidedByMembershipId: context.membershipId,
        voidedAt: new Date(),
      });
      const results = await transaction.payrollEmployee.updateMany({
        where: { agencyId: context.agencyId, payrollPeriodId: periodId, status: 'FINALIZED' },
        data: { status: 'VOIDED' },
      });
      const released = await releaseSources(transaction, context, periodId);
      const supersededPayslipIds = await supersedePayslips(transaction, context, periodId);
      const adjustments = await settleAdjustments(transaction, context, periodId);
      const supersededExports = await exportsOf(transaction, context, periodId);

      await transaction.auditEvent.create({
        data: {
          ...auditEvent(context, {
            action: PAYROLL_PERIOD_VOIDED,
            entityId: periodId,
            previousStatus: 'FINALIZED',
            newStatus: 'VOIDED',
            reason: request.reason,
            metadata: {
              voidRequest: request,
              calculationVersion: locked.calculationVersion,
              voidedResultCount: results.count,
              ...released,
              supersededPayslipIds,
              ...adjustments,
              ...supersededExports,
            },
          }),
          // A period is voided once.
          idempotencyKey: 'voided',
        },
      });
      return after;
    });
  }
}

interface VoidablePeriod extends LockedPeriod {
  runType: string;
  periodFrom: Date;
  voidRequestedByMembershipId: string | null;
  voidRequestedAt: Date | null;
  voidReason: string | null;
  voidDocumentVersionId: string | null;
  voidedByMembershipId: string | null;
}

async function lockFinalized(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
  rowVersion: number,
): Promise<VoidablePeriod> {
  const locked = await lockPeriod(transaction, context, periodId);
  requireStatus(locked, 'FINALIZED');
  if (locked.rowVersion !== rowVersion) throw stale();
  return readVoidColumns(transaction, context, periodId, locked);
}

async function readVoidColumns(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
  locked: LockedPeriod,
): Promise<VoidablePeriod> {
  const row = await transaction.payrollPeriod.findUniqueOrThrow({
    where: { agencyId_id: { agencyId: context.agencyId, id: periodId } },
    select: {
      runType: true,
      periodFrom: true,
      voidRequestedByMembershipId: true,
      voidRequestedAt: true,
      voidReason: true,
      voidDocumentVersionId: true,
      voidedByMembershipId: true,
    },
  });
  return { ...locked, ...row };
}

/** The open request, which the person deciding it never made. */
function requireOpenRequest(context: RequestContext, period: VoidablePeriod) {
  const { voidRequestedByMembershipId, voidRequestedAt, voidReason, voidDocumentVersionId } =
    period;
  if (!voidRequestedByMembershipId || !voidRequestedAt || !voidReason || !voidDocumentVersionId) {
    throw new PayrollPeriodsServiceError(
      'No void of this Payroll Period is requested.',
      409,
      'PAYROLL_VOID_NOT_REQUESTED',
    );
  }
  if (voidRequestedByMembershipId === context.membershipId) {
    throw new PayrollPeriodsServiceError(
      'You requested this void, so a different person approves or declines it.',
      409,
      'PAYROLL_VOID_REQUESTER_DECIDES',
    );
  }
  return {
    requestedByMembershipId: voidRequestedByMembershipId,
    requestedAt: voidRequestedAt.toISOString(),
    reason: voidReason,
    documentVersionId: voidDocumentVersionId,
  };
}

/**
 * Refuse while the void conditions fail (hris-controls.md §5.20): a regular
 * period has a later regular period that is not VOIDED, or a Payment
 * Instruction of the period was handed off. After money has moved, every
 * correction is a Payroll Adjustment.
 */
async function refuseVoidConditions(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
  period: VoidablePeriod,
): Promise<void> {
  if (period.runType === 'REGULAR') {
    const later = await transaction.payrollPeriod.findFirst({
      where: {
        agencyId: context.agencyId,
        runType: 'REGULAR',
        periodFrom: { gt: period.periodFrom },
        status: { not: 'VOIDED' },
      },
      orderBy: { periodFrom: 'asc' },
      select: { code: true, status: true },
    });
    if (later) {
      throw new PayrollPeriodsServiceError(
        `Regular Payroll Period ${later.code} (${later.status}) comes after this one, so this payroll is no longer voided${
          later.status === 'DRAFT' ? '; cancel that draft first' : ''
        }. A Payroll Adjustment corrects it.`,
        409,
        'PAYROLL_VOID_LATER_PERIOD',
      );
    }
  }
  const handedOff = await instructionsBlockingVoid(transaction, {
    agencyId: context.agencyId,
    payrollPeriodId: periodId,
  });
  if (handedOff.length > 0) {
    throw new PayrollPeriodsServiceError(
      `${handedOff.length} Payment ${
        handedOff.length === 1
          ? 'Instruction of this payroll was'
          : 'Instructions of this payroll were'
      } handed off for payment, so it is no longer voided. A Payroll Adjustment corrects it.`,
      409,
      'PAYROLL_VOID_PAYMENT_HANDED_OFF',
    );
  }
}

async function updatePeriod(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
  period: LockedPeriod,
  data: Prisma.PayrollPeriodUncheckedUpdateInput,
): Promise<PayrollPeriodSummary> {
  const row = await transaction.payrollPeriod.update({
    where: { agencyId_id: { agencyId: context.agencyId, id: periodId } },
    data: { ...data, rowVersion: period.rowVersion + 1 },
    select: summarySelect,
  });
  return toSummary(row);
}

async function readSummary(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
): Promise<PayrollPeriodSummary> {
  return toSummary(
    await transaction.payrollPeriod.findUniqueOrThrow({
      where: { agencyId_id: { agencyId: context.agencyId, id: periodId } },
      select: summarySelect,
    }),
  );
}

/**
 * Release what the payroll consumed, so the replacement consumes it (ADR
 * 0014): its Payroll Inputs return to PENDING, its Attendance Payroll Fact
 * consumptions get `released_at`, and its once-only Authorized Payroll
 * Component Inputs lose their consuming period. An input a source correction
 * was waiting on, in an open Payroll Adjustment against the period, becomes
 * CANCELLED under that correction's key instead, since the source withdrew it.
 */
async function releaseSources(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
) {
  const { agencyId } = context;
  const waiting = await transaction.$queryRaw<{ payroll_input_id: string; key: string }[]>`
    SELECT DISTINCT ON (c."payroll_input_id")
           c."payroll_input_id"::text, c."source_correction_key"::text AS "key"
    FROM "payroll_adjustment_causes" c
    JOIN "payroll_adjustments" a
      ON a."agency_id" = c."agency_id" AND a."id" = c."payroll_adjustment_id"
    JOIN "payroll_inputs" i
      ON i."agency_id" = c."agency_id" AND i."id" = c."payroll_input_id"
    WHERE a."agency_id" = CAST(${agencyId} AS uuid)
      AND a."original_payroll_period_id" = CAST(${periodId} AS uuid)
      AND a."status" = 'OPEN'
      AND c."origin" = 'SOURCE_CORRECTION'
      AND i."status" = 'CONSUMED'
      AND i."consumed_by_payroll_period_id" = CAST(${periodId} AS uuid)
    ORDER BY c."payroll_input_id", c."created_at", c."id"
  `;
  for (const input of waiting) {
    await transaction.payrollInput.update({
      where: { agencyId_id: { agencyId, id: input.payroll_input_id } },
      data: {
        status: 'CANCELLED',
        consumedByPayrollPeriodId: null,
        sourceCorrectionKey: input.key,
      },
    });
  }
  const returned = await transaction.payrollInput.findMany({
    where: { agencyId, status: 'CONSUMED', consumedByPayrollPeriodId: periodId },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  await transaction.payrollInput.updateMany({
    where: { agencyId, status: 'CONSUMED', consumedByPayrollPeriodId: periodId },
    data: { status: 'PENDING', consumedByPayrollPeriodId: null },
  });
  const facts = await transaction.payrollConsumedAttendanceFact.findMany({
    where: { agencyId, payrollPeriodId: periodId, releasedAt: null },
    orderBy: { attendancePayrollFactId: 'asc' },
    select: { attendancePayrollFactId: true },
  });
  await transaction.payrollConsumedAttendanceFact.updateMany({
    where: { agencyId, payrollPeriodId: periodId, releasedAt: null },
    data: { releasedAt: new Date() },
  });
  const authorized = await transaction.authorizedPayrollComponentInput.findMany({
    where: { agencyId, consumedByPayrollPeriodId: periodId },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  await transaction.authorizedPayrollComponentInput.updateMany({
    where: { agencyId, consumedByPayrollPeriodId: periodId },
    data: { consumedByPayrollPeriodId: null },
  });
  return {
    returnedPayrollInputIds: returned.map((row) => row.id),
    cancelledPayrollInputIds: waiting.map((row) => row.payroll_input_id),
    releasedAttendancePayrollFactIds: facts.map((row) => row.attendancePayrollFactId),
    releasedAuthorizedPayrollComponentInputIds: authorized.map((row) => row.id),
  };
}

/** Every Payslip of the period's results, from any status, becomes SUPERSEDED. */
async function supersedePayslips(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
): Promise<string[]> {
  const rows = await transaction.$queryRaw<{ id: string }[]>`
    UPDATE "payslips" s SET "status" = 'SUPERSEDED'
    FROM "payroll_employees" r
    WHERE r."agency_id" = s."agency_id"
      AND r."id" = s."payroll_employee_id"
      AND s."agency_id" = CAST(${context.agencyId} AS uuid)
      AND r."payroll_period_id" = CAST(${periodId} AS uuid)
      AND s."status" <> 'SUPERSEDED'
    RETURNING s."id"::text
  `;
  return rows.map((row) => row.id).sort();
}

/**
 * Cancel every OPEN Payroll Adjustment against the period, and reopen every
 * adjustment it posted. An Employee has at most one OPEN adjustment per
 * original period, so a posted one whose Employee already has another OPEN
 * against the same original is cancelled instead: that one's recalculation
 * counts the whole difference, since it counts only POSTED adjustments in
 * FINALIZED results as already paid.
 */
async function settleAdjustments(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
) {
  const { agencyId } = context;
  const cancelledAt = new Date();
  const against = await transaction.payrollAdjustment.findMany({
    where: { agencyId, originalPayrollPeriodId: periodId, status: 'OPEN' },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  await transaction.payrollAdjustment.updateMany({
    where: { agencyId, id: { in: against.map((row) => row.id) } },
    data: { status: 'CANCELLED', cancelledAt },
  });

  const carried = await transaction.payrollAdjustment.findMany({
    where: { agencyId, postedByPayrollPeriodId: periodId, status: 'POSTED' },
    orderBy: { id: 'asc' },
    select: { id: true, originalPayrollPeriodId: true, employeeId: true },
  });
  const reopened: string[] = [];
  const covered: { payrollAdjustmentId: string; openPayrollAdjustmentId: string }[] = [];
  for (const adjustment of carried) {
    const open = await transaction.payrollAdjustment.findFirst({
      where: {
        agencyId,
        originalPayrollPeriodId: adjustment.originalPayrollPeriodId,
        employeeId: adjustment.employeeId,
        status: 'OPEN',
      },
      select: { id: true },
    });
    await transaction.payrollAdjustment.update({
      where: { agencyId_id: { agencyId, id: adjustment.id } },
      data: open
        ? { status: 'CANCELLED', postedByPayrollPeriodId: null, postedAt: null, cancelledAt }
        : { status: 'OPEN', postedByPayrollPeriodId: null, postedAt: null },
    });
    if (open) {
      covered.push({ payrollAdjustmentId: adjustment.id, openPayrollAdjustmentId: open.id });
    } else {
      reopened.push(adjustment.id);
    }
  }
  return {
    cancelledPayrollAdjustmentIds: against.map((row) => row.id),
    reopenedPayrollAdjustmentIds: reopened,
    coveredPayrollAdjustments: covered,
  };
}

/** The outputs the void supersedes by voiding their period, for its Audit Event. */
async function exportsOf(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  payrollPeriodId: string,
) {
  const where = { agencyId: context.agencyId, payrollPeriodId };
  const [paymentExport, register, accountingExport] = await Promise.all([
    transaction.paymentExport.findFirst({ where, select: { id: true } }),
    transaction.payrollRegister.findFirst({ where, select: { id: true } }),
    transaction.finalizedPayrollAccountingSupportExport.findFirst({ where, select: { id: true } }),
  ]);
  return {
    supersededPaymentExportId: paymentExport?.id ?? null,
    supersededPayrollRegisterId: register?.id ?? null,
    supersededAccountingSupportExportId: accountingExport?.id ?? null,
  };
}
