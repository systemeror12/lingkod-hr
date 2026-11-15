import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { z } from 'zod';
import { requestDatabaseContext } from '../database-context';
import { payrollCalculationHash } from '../payroll-calculation/calculation-hash';
import { SPECIAL_PERIOD_COMPONENT_CODES } from '../payroll-calculation/payroll-calculation.service';
import { claimPayrollFunction } from './payroll-period-actors';
import { freezePayrollRuleSnapshot } from './payroll-rule-snapshots';
import {
  payrollPeriodCalculationStartSchema,
  payrollPeriodCancelSchema,
  payrollPeriodCreateSchema,
  payrollPeriodCutoffMoveSchema,
  type PayrollPeriodStatus,
  type PayrollRunType,
} from './payroll-periods.schemas';

export interface PayrollPeriodSummary {
  id: string;
  code: string;
  runType: PayrollRunType;
  periodFrom: string;
  periodTo: string;
  cutoffAt: string;
  paymentDate: string;
  status: PayrollPeriodStatus;
  carriesAdjustments: boolean;
  calculationVersion: number;
  payComponentIds: string[];
  voidReason: string | null;
  voidedAt: string | null;
  rowVersion: number;
}

/** The Payroll Certification in force on a period. */
export interface PayrollCertificationSummary {
  id: string;
  calculationVersion: number;
  calculationHash: string;
  certifiedByMembershipId: string;
  certifiedAt: string;
}

/**
 * A period as a reviewer reads it: its summary, the hash of its current
 * calculation version (null before the first calculation completes and while
 * one runs), and the certification in force.
 */
export interface PayrollPeriodDetail extends PayrollPeriodSummary {
  calculationHash: string | null;
  certification: PayrollCertificationSummary | null;
}

export class PayrollPeriodsServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PayrollPeriodsServiceError';
  }
}

export const summarySelect = {
  id: true,
  code: true,
  runType: true,
  periodFrom: true,
  periodTo: true,
  cutoffAt: true,
  paymentDate: true,
  status: true,
  carriesAdjustments: true,
  calculationVersion: true,
  voidReason: true,
  voidedAt: true,
  rowVersion: true,
  components: { select: { payComponentId: true }, orderBy: { payComponentId: 'asc' } },
} satisfies Prisma.PayrollPeriodSelect;

type PeriodRow = Prisma.PayrollPeriodGetPayload<{ select: typeof summarySelect }>;

const dateOf = (value: string) => new Date(`${value}T00:00:00.000Z`);
const isoDateOf = (value: Date) => value.toISOString().slice(0, 10);

/** Whether the dates are the first and last day of one calendar month (ADR 0015). */
export function isOneCalendarMonth(periodFrom: string, periodTo: string): boolean {
  const from = dateOf(periodFrom);
  const lastDay = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
  return from.getUTCDate() === 1 && isoDateOf(lastDay) === periodTo;
}

/**
 * Payroll Period commands of the Payroll Preparer (hris-controls.md §5.20):
 * create a period, move its cutoff, cancel it, and start its calculation
 * while it is DRAFT. Each command claims the actor's PREPARATION function on
 * the period. The review commands are `PayrollCertificationService`'s.
 */
@Injectable()
export class PayrollPeriodsService {
  /** Read one period with what certifying it binds (`payroll.periods.read`). */
  async read(context: RequestContext, periodId: string): Promise<PayrollPeriodDetail> {
    if (!holdsAgencyWide(context, 'payroll.periods.read')) {
      throw new PayrollPeriodsServiceError(
        'Reading a Payroll Period needs the payroll.periods.read permission for the whole Agency.',
        403,
        'PAYROLL_PERIOD_READ_FORBIDDEN',
      );
    }
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const period = await transaction.payrollPeriod.findUnique({
        where: { agencyId_id: { agencyId: context.agencyId, id: periodId } },
        select: summarySelect,
      });
      if (!period) {
        throw new PayrollPeriodsServiceError(
          'The Payroll Period could not be found.',
          404,
          'PAYROLL_PERIOD_NOT_FOUND',
        );
      }
      const certification = await transaction.payrollCertification.findFirst({
        where: { agencyId: context.agencyId, payrollPeriodId: periodId, revokedAt: null },
        select: {
          id: true,
          calculationVersion: true,
          calculationHash: true,
          certifiedByMembershipId: true,
          certifiedAt: true,
        },
      });
      const calculated = period.calculationVersion > 0 && period.status !== 'CALCULATING';
      return {
        ...toSummary(period),
        calculationHash: calculated
          ? await readCalculationHash(transaction, context, periodId, period.calculationVersion)
          : null,
        certification: certification && {
          ...certification,
          certifiedAt: certification.certifiedAt.toISOString(),
        },
      };
    });
  }

  async create(context: RequestContext, rawInput: unknown): Promise<PayrollPeriodSummary> {
    requireCreatePermission(context);
    const input = parse(payrollPeriodCreateSchema, rawInput);
    if (input.runType === 'REGULAR') {
      if (!isOneCalendarMonth(input.periodFrom, input.periodTo)) {
        throw invalid(
          'PAYROLL_PERIOD_NOT_ONE_MONTH',
          'A regular Payroll Period covers exactly one calendar month.',
        );
      }
      if (input.payComponentIds.length > 0) {
        throw invalid(
          'PAYROLL_PERIOD_REGULAR_COMPONENTS',
          'A regular Payroll Period pays every applicable component and names none.',
        );
      }
    } else if (input.payComponentIds.length === 0) {
      throw invalid(
        'PAYROLL_PERIOD_COMPONENT_REQUIRED',
        'A special Payroll Period names at least one component it pays.',
      );
    }

    const key = {
      agencyId: context.agencyId,
      code: input.code,
      runType: input.runType,
      periodFrom: input.periodFrom,
    };
    try {
      return await withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
        if (input.payComponentIds.length > 0) {
          const found = await transaction.payComponent.count({
            where: { id: { in: input.payComponentIds } },
          });
          if (found !== input.payComponentIds.length) {
            throw invalid(
              'PAYROLL_PERIOD_COMPONENT_NOT_FOUND',
              'Name components from the pay component catalogue.',
            );
          }
        }
        const conflict = await findCreateConflict(transaction, key);
        if (conflict) throw conflict;

        const period = await transaction.payrollPeriod.create({
          data: {
            agencyId: context.agencyId,
            code: input.code,
            runType: input.runType,
            periodFrom: dateOf(input.periodFrom),
            periodTo: dateOf(input.periodTo),
            cutoffAt: new Date(input.cutoffAt),
            paymentDate: dateOf(input.paymentDate),
            status: 'DRAFT',
            components: {
              createMany: {
                data: input.payComponentIds.map((payComponentId) => ({ payComponentId })),
              },
            },
          },
          select: summarySelect,
        });
        await claimPreparation(transaction, context, period.id);
        const summary = toSummary(period);
        await transaction.auditEvent.create({
          data: auditEvent(context, {
            action: 'PAYROLL_PERIOD_CREATED',
            entityId: period.id,
            previousStatus: null,
            newStatus: 'DRAFT',
            reason: null,
            metadata: { after: auditData(summary) },
          }),
        });
        return summary;
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // A concurrent create won the unique index; name the rule it hit.
        const conflict = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
          findCreateConflict(transaction, key),
        );
        throw (
          conflict ??
          new PayrollPeriodsServiceError(
            'Another Payroll Period conflicts with this one.',
            409,
            'PAYROLL_PERIOD_CONFLICT',
          )
        );
      }
      throw error;
    }
  }

  /** Move the cutoff of a DRAFT period, with a reason. */
  async moveCutoff(
    context: RequestContext,
    periodId: string,
    rawInput: unknown,
  ): Promise<PayrollPeriodSummary> {
    requireCreatePermission(context);
    const input = parse(payrollPeriodCutoffMoveSchema, rawInput);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const before = await findDraftForCommand(transaction, context, periodId, input.rowVersion);
      const after = await updateDraft(transaction, context, periodId, input.rowVersion, {
        cutoffAt: new Date(input.cutoffAt),
      });
      await transaction.auditEvent.create({
        data: auditEvent(context, {
          action: 'PAYROLL_PERIOD_CUTOFF_MOVED',
          entityId: periodId,
          previousStatus: 'DRAFT',
          newStatus: 'DRAFT',
          reason: input.reason,
          metadata: {
            before: { cutoffAt: before.cutoffAt.toISOString() },
            after: { cutoffAt: after.cutoffAt },
          },
        }),
      });
      return after;
    });
  }

  /** Cancel a DRAFT period with a reason. It becomes VOIDED; it consumed nothing. */
  async cancelDraft(
    context: RequestContext,
    periodId: string,
    rawInput: unknown,
  ): Promise<PayrollPeriodSummary> {
    requireCreatePermission(context);
    const input = parse(payrollPeriodCancelSchema, rawInput);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      await findDraftForCommand(transaction, context, periodId, input.rowVersion);
      const after = await updateDraft(transaction, context, periodId, input.rowVersion, {
        status: 'VOIDED',
        voidReason: input.reason,
        voidedByMembershipId: context.membershipId,
        voidedAt: new Date(),
      });
      await transaction.auditEvent.create({
        data: auditEvent(context, {
          action: 'PAYROLL_PERIOD_DRAFT_CANCELLED',
          entityId: periodId,
          previousStatus: 'DRAFT',
          newStatus: 'VOIDED',
          reason: input.reason,
          metadata: { after: { status: 'VOIDED' } },
        }),
      });
      return after;
    });
  }

  /**
   * Start calculation: the cutoff has passed, so the period moves to
   * CALCULATING at its next calculation version and freezes that version's
   * rule snapshot, in one transaction. The committed CALCULATING period is the
   * queued job `PayrollCalculationJob` runs. A missing required rule refuses
   * the start and changes nothing. A concurrent second start finds the period
   * no longer DRAFT at its row version and is refused.
   *
   * A period calculated before is recalculated the same way, once it is back
   * in DRAFT: the next version takes a fresh snapshot, and every earlier
   * version's results, lines, and exceptions stay as they were. From
   * FOR_REVIEW onward the start is refused with what must happen first (#624).
   */
  async startCalculation(
    context: RequestContext,
    periodId: string,
    rawInput: unknown,
  ): Promise<PayrollPeriodSummary> {
    if (!holdsAgencyWide(context, 'payroll.periods.calculate')) {
      throw new PayrollPeriodsServiceError(
        'Starting a calculation needs the payroll.periods.calculate permission for the whole Agency.',
        403,
        'PAYROLL_PERIOD_CALCULATE_FORBIDDEN',
      );
    }
    const input = parse(payrollPeriodCalculationStartSchema, rawInput);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const before = await findDraftForCommand(
        transaction,
        context,
        periodId,
        input.rowVersion,
        calculationRefusal,
      );
      if (before.runType !== 'REGULAR') {
        const named = await transaction.payComponent.findMany({
          where: { id: { in: before.components.map((component) => component.payComponentId) } },
          orderBy: { code: 'asc' },
          select: { code: true },
        });
        const uncalculated = named
          .map((component) => component.code)
          .filter((code) => !SPECIAL_PERIOD_COMPONENT_CODES.includes(code));
        if (named.length === 0 || uncalculated.length > 0) {
          throw new PayrollPeriodsServiceError(
            `A special Payroll Period pays only the components it names, and ${
              named.length === 0
                ? 'it names none'
                : `${uncalculated.join(', ')} ${uncalculated.length === 1 ? 'has' : 'have'} no calculator yet`
            }.`,
            409,
            'PAYROLL_PERIOD_SPECIAL_NOT_CALCULABLE',
          );
        }
      }
      if (Date.now() < before.cutoffAt.getTime()) {
        throw new PayrollPeriodsServiceError(
          `The cutoff ${before.cutoffAt.toISOString()} has not passed; calculation starts at or after it.`,
          409,
          'PAYROLL_PERIOD_CUTOFF_NOT_PASSED',
        );
      }
      const after = await updateDraft(transaction, context, periodId, input.rowVersion, {
        status: 'CALCULATING',
        calculationVersion: { increment: 1 },
      });
      const snapshot = await freezePayrollRuleSnapshot(transaction, {
        agencyId: context.agencyId,
        payrollPeriodId: periodId,
      });
      if (snapshot.outcome === 'REFUSED') {
        // Throwing rolls back the version and status the update just took.
        throw new PayrollPeriodsServiceError(snapshot.reason, 409, snapshot.code);
      }
      await transaction.auditEvent.create({
        data: auditEvent(context, {
          action: 'PAYROLL_PERIOD_CALCULATION_STARTED',
          entityId: periodId,
          previousStatus: 'DRAFT',
          newStatus: 'CALCULATING',
          reason: null,
          metadata: {
            calculationVersion: after.calculationVersion,
            payrollRuleSnapshotId: snapshot.snapshotId,
          },
        }),
      });
      return after;
    });
  }
}

function requireCreatePermission(context: RequestContext): void {
  if (!holdsAgencyWide(context, 'payroll.periods.create')) {
    throw new PayrollPeriodsServiceError(
      'Payroll Period commands need the payroll.periods.create permission for the whole Agency.',
      403,
      'PAYROLL_PERIOD_CREATE_FORBIDDEN',
    );
  }
}

export function parse<Schema extends z.ZodType>(
  schema: Schema,
  rawInput: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(rawInput);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw invalid(
    'INVALID_INPUT',
    `${issue?.path.map(String).join('.') || 'request'}: ${issue?.message ?? 'invalid'}`,
  );
}

function invalid(code: string, message: string): PayrollPeriodsServiceError {
  return new PayrollPeriodsServiceError(message, 400, code);
}

async function findCreateConflict(
  transaction: Prisma.TransactionClient,
  key: { agencyId: string; code: string; runType: PayrollRunType; periodFrom: string },
): Promise<PayrollPeriodsServiceError | null> {
  const sameCode = await transaction.payrollPeriod.findUnique({
    where: { agencyId_code: { agencyId: key.agencyId, code: key.code } },
    select: { id: true },
  });
  if (sameCode) {
    return new PayrollPeriodsServiceError(
      'Another Payroll Period of this Agency has this code.',
      409,
      'PAYROLL_PERIOD_CODE_EXISTS',
    );
  }
  if (key.runType !== 'REGULAR') return null;

  const sameMonth = await transaction.payrollPeriod.findFirst({
    where: {
      agencyId: key.agencyId,
      runType: 'REGULAR',
      periodFrom: dateOf(key.periodFrom),
      status: { not: 'VOIDED' },
    },
    select: { id: true },
  });
  if (sameMonth) {
    return new PayrollPeriodsServiceError(
      'A regular Payroll Period already covers this month.',
      409,
      'PAYROLL_PERIOD_DUPLICATE_MONTH',
    );
  }
  const openRegular = await transaction.payrollPeriod.findFirst({
    where: {
      agencyId: key.agencyId,
      runType: 'REGULAR',
      status: { notIn: ['FINALIZED', 'VOIDED'] },
    },
    select: { code: true },
  });
  if (openRegular) {
    return new PayrollPeriodsServiceError(
      `Regular Payroll Period ${openRegular.code} is still open; finalize or cancel it first.`,
      409,
      'PAYROLL_PERIOD_OPEN_REGULAR_EXISTS',
    );
  }
  return null;
}

/**
 * Why a period that is not DRAFT cannot be calculated, and what returns it to
 * DRAFT (hris-controls.md §5.20). A certified or approved version stands, and
 * a finalized payroll is corrected only by a Payroll Adjustment (#328 D6 #13).
 */
export function calculationRefusal(status: string): string {
  switch (status) {
    case 'CALCULATING':
      return 'The Payroll Period is CALCULATING; wait for its calculation to finish.';
    case 'FOR_REVIEW':
      return 'The Payroll Period is FOR_REVIEW; it is calculated again only after a reviewer returns it for correction.';
    case 'CERTIFIED':
      return 'The Payroll Period is CERTIFIED, and its certified calculation version stands. It is calculated again only after the certification is revoked and the period is returned for correction.';
    case 'APPROVED':
      return 'The Payroll Period is APPROVED, and its approved calculation version stands. It is calculated again only after it is returned before finalization and then returned for correction.';
    case 'FINALIZED':
      return 'The Payroll Period is FINALIZED and is never calculated again; a Payroll Adjustment corrects it.';
    case 'VOIDED':
      return 'The Payroll Period is VOIDED, which is final.';
    default:
      return notDraft(status);
  }
}

const notDraft = (status: string) =>
  `The Payroll Period is ${status}; this command applies only while it is DRAFT.`;

/** The DRAFT period at `rowVersion`, after claiming the actor's PREPARATION function. */
async function findDraftForCommand(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
  rowVersion: number,
  refusal: (status: string) => string = notDraft,
) {
  const period = await transaction.payrollPeriod.findUnique({
    where: { agencyId_id: { agencyId: context.agencyId, id: periodId } },
    select: {
      status: true,
      rowVersion: true,
      cutoffAt: true,
      runType: true,
      components: { select: { payComponentId: true } },
    },
  });
  if (!period) {
    throw new PayrollPeriodsServiceError(
      'The Payroll Period could not be found.',
      404,
      'PAYROLL_PERIOD_NOT_FOUND',
    );
  }
  if (period.status !== 'DRAFT') {
    throw new PayrollPeriodsServiceError(refusal(period.status), 409, 'PAYROLL_PERIOD_NOT_DRAFT');
  }
  if (period.rowVersion !== rowVersion) throw stale();
  await claimPreparation(transaction, context, periodId);
  return period;
}

async function updateDraft(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
  rowVersion: number,
  data: Prisma.PayrollPeriodUncheckedUpdateManyInput,
): Promise<PayrollPeriodSummary> {
  const { count } = await transaction.payrollPeriod.updateMany({
    where: { agencyId: context.agencyId, id: periodId, status: 'DRAFT', rowVersion },
    data: { ...data, rowVersion: { increment: 1 } },
  });
  if (count !== 1) throw stale();
  const period = await transaction.payrollPeriod.findUniqueOrThrow({
    where: { agencyId_id: { agencyId: context.agencyId, id: periodId } },
    select: summarySelect,
  });
  return toSummary(period);
}

/**
 * The hash a certification binds for one calculation version: see
 * `payrollCalculationHash`. A version with no Payroll Employee Result hashes
 * the empty list.
 */
export async function readCalculationHash(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  payrollPeriodId: string,
  calculationVersion: number,
): Promise<string> {
  const results = await transaction.payrollEmployee.findMany({
    where: { agencyId: context.agencyId, payrollPeriodId, calculationVersion },
    select: { employeeId: true, calculationHash: true },
  });
  return payrollCalculationHash(results);
}

export function stale(): PayrollPeriodsServiceError {
  return new PayrollPeriodsServiceError(
    'The Payroll Period changed since it was read; reload it and try again.',
    409,
    'PAYROLL_PERIOD_STALE',
  );
}

async function claimPreparation(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  payrollPeriodId: string,
): Promise<void> {
  const claim = await claimPayrollFunction(transaction, {
    agencyId: context.agencyId,
    payrollPeriodId,
    membershipId: context.membershipId,
    payrollFunction: 'PREPARATION',
  });
  if (claim.outcome === 'REFUSED') {
    throw new PayrollPeriodsServiceError(
      `You act in ${claim.heldFunction} on this Payroll Period, so you cannot also prepare it.`,
      409,
      'PAYROLL_FUNCTION_CONFLICT',
    );
  }
}

export function auditEvent(
  context: RequestContext,
  event: {
    action: string;
    entityId: string;
    previousStatus: string | null;
    newStatus: string;
    reason: string | null;
    metadata: Prisma.InputJsonObject;
  },
): Prisma.AuditEventUncheckedCreateInput {
  return {
    agencyId: context.agencyId,
    actorUserId: context.userId,
    actorMembershipId: context.membershipId,
    actorType: 'USER',
    entityType: 'PayrollPeriod',
    requestId: context.requestId,
    ...event,
  };
}

function auditData(summary: PayrollPeriodSummary): Prisma.InputJsonObject {
  return {
    code: summary.code,
    runType: summary.runType,
    periodFrom: summary.periodFrom,
    periodTo: summary.periodTo,
    cutoffAt: summary.cutoffAt,
    paymentDate: summary.paymentDate,
    payComponentIds: summary.payComponentIds,
  };
}

export function toSummary(row: PeriodRow): PayrollPeriodSummary {
  return {
    id: row.id,
    code: row.code,
    runType: row.runType as PayrollRunType,
    periodFrom: isoDateOf(row.periodFrom),
    periodTo: isoDateOf(row.periodTo),
    cutoffAt: row.cutoffAt.toISOString(),
    paymentDate: isoDateOf(row.paymentDate),
    status: row.status as PayrollPeriodStatus,
    carriesAdjustments: row.carriesAdjustments,
    calculationVersion: row.calculationVersion,
    payComponentIds: row.components.map((component) => component.payComponentId),
    voidReason: row.voidReason,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    rowVersion: row.rowVersion,
  };
}
