import { Injectable } from '@nestjs/common';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { livePayrollsCarrying, openPayrollAdjustment } from './payroll-adjustments';
import { auditEvent, parse, PayrollPeriodsServiceError } from './payroll-periods.service';
import {
  payrollAdjustmentListQuerySchema,
  payrollAdjustmentRecalculationSchema,
  type PayrollAdjustmentStatus,
  type PayrollPeriodStatus,
} from './payroll-periods.schemas';

/** The Audit Event action of a recalculation request. */
export const PAYROLL_ADJUSTMENT_RECALCULATION_OPENED = 'PAYROLL_ADJUSTMENT_RECALCULATION_OPENED';

export interface PayrollRecalculationResult {
  payrollPeriodId: string;
  /** One per Employee: the OPEN adjustment, and whether the cause joined one already open. */
  adjustments: { payrollAdjustmentId: string; employeeId: string; joined: boolean }[];
}

/** A Payroll Period a Payroll Adjustment names. */
export interface PayrollAdjustmentPeriodRef {
  id: string;
  code: string;
  status: PayrollPeriodStatus;
}

/**
 * Why a Payroll Adjustment opened, or a later cause that joined it. A
 * `SOURCE_CORRECTION` names the consumed input and the source's correction
 * key; a `PAYROLL_HOLD` names the hold; a `RECALCULATION` names who asked and
 * why. `openedByName` is that member's display name, or null when none.
 */
export interface PayrollAdjustmentCauseView {
  id: string;
  origin: 'SOURCE_CORRECTION' | 'PAYROLL_HOLD' | 'RECALCULATION';
  reason: string | null;
  payrollInputId: string | null;
  sourceCorrectionKey: string | null;
  payrollHoldId: string | null;
  openedByMembershipId: string | null;
  openedByName: string | null;
  createdAt: string;
}

/**
 * One Payroll Adjustment as the list reads it (#651). `carriedBy` lists, for
 * an `OPEN` one, each period past DRAFT and not yet FINALIZED whose current
 * calculation version carries it; nothing stops a regular and a special
 * period carrying it at once, and the first to finalize posts it.
 * `postedBy` is the period that posted it, null when none did, as for a
 * recovery the COA route posts. The amount is not stored on the adjustment:
 * the carrying period's Payroll Lines hold the difference.
 */
export interface PayrollAdjustmentView {
  id: string;
  employeeId: string;
  status: PayrollAdjustmentStatus;
  openedAt: string;
  postedAt: string | null;
  cancelledAt: string | null;
  originalPayrollPeriod: PayrollAdjustmentPeriodRef;
  carriedBy: PayrollAdjustmentPeriodRef[];
  postedBy: PayrollAdjustmentPeriodRef | null;
  causes: PayrollAdjustmentCauseView[];
}

/** The newest adjustments the list returns at most. */
export const PAYROLL_ADJUSTMENT_LIST_LIMIT = 200;

/**
 * Open a Payroll Adjustment for recalculation (hris-controls.md §5.20, #356,
 * ADR 0016): a user with `payroll.inputs.adjust`, Agency-wide, asks with a
 * reason that Payroll recalculate one FINALIZED period for one Employee or for
 * all of its Employees. No amount is entered; the next period that carries the
 * adjustment calculates the difference. Payroll never opens one on its own,
 * and opening claims no payroll function.
 *
 * Each Employee's cause joins the OPEN adjustment when there is one, so a
 * difference is counted once. The request is refused while a period past
 * DRAFT already carries one of those adjustments, since its difference is
 * already calculated: it posts on that period's finalization, and a later
 * recalculation then counts what changed since.
 */
@Injectable()
export class PayrollAdjustmentsService {
  async openRecalculation(
    context: RequestContext,
    periodId: string,
    rawInput: unknown,
  ): Promise<PayrollRecalculationResult> {
    if (!holdsAgencyWide(context, 'payroll.inputs.adjust')) {
      throw new PayrollPeriodsServiceError(
        'Opening a Payroll Adjustment needs the payroll.inputs.adjust permission for the whole Agency.',
        403,
        'PAYROLL_ADJUSTMENT_FORBIDDEN',
      );
    }
    const input = parse(payrollAdjustmentRecalculationSchema, rawInput);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const [period] = await transaction.$queryRaw<
        { status: string; calculation_version: number }[]
      >`
        SELECT "status", "calculation_version" FROM "payroll_periods"
        WHERE "agency_id" = CAST(${context.agencyId} AS uuid)
          AND "id" = CAST(${periodId} AS uuid)
        FOR SHARE
      `;
      if (!period) {
        throw new PayrollPeriodsServiceError(
          'The Payroll Period could not be found.',
          404,
          'PAYROLL_PERIOD_NOT_FOUND',
        );
      }
      if (period.status !== 'FINALIZED') {
        throw new PayrollPeriodsServiceError(
          `The Payroll Period is ${period.status}. Only a FINALIZED payroll is corrected by a Payroll Adjustment.`,
          409,
          'PAYROLL_PERIOD_NOT_FINALIZED',
        );
      }

      let employeeIds: string[];
      if (input.employeeId) {
        const employee = await transaction.employee.findFirst({
          where: { agencyId: context.agencyId, id: input.employeeId },
          select: { id: true },
        });
        if (!employee) {
          throw new PayrollPeriodsServiceError(
            'The Employee could not be found.',
            404,
            'EMPLOYEE_NOT_FOUND',
          );
        }
        employeeIds = [employee.id];
      } else {
        // Its Employees: those its final version paid, and those an adjustment
        // against it already covers, such as a held Employee.
        const rows = await transaction.$queryRaw<{ employee_id: string }[]>`
          SELECT "employee_id"::text FROM "payroll_employees"
          WHERE "agency_id" = CAST(${context.agencyId} AS uuid)
            AND "payroll_period_id" = CAST(${periodId} AS uuid)
            AND "calculation_version" = ${period.calculation_version}
          UNION
          SELECT "employee_id"::text FROM "payroll_adjustments"
          WHERE "agency_id" = CAST(${context.agencyId} AS uuid)
            AND "original_payroll_period_id" = CAST(${periodId} AS uuid)
            AND "status" <> 'CANCELLED'
          ORDER BY 1
        `;
        employeeIds = rows.map((row) => row.employee_id);
      }

      const open = await transaction.payrollAdjustment.findMany({
        where: {
          agencyId: context.agencyId,
          originalPayrollPeriodId: periodId,
          employeeId: { in: employeeIds },
          status: 'OPEN',
        },
        select: { id: true },
      });
      const carriers = await livePayrollsCarrying(
        transaction,
        context.agencyId,
        open.map((adjustment) => adjustment.id),
      );
      if (carriers.length > 0) {
        const codes = [...new Set(carriers.map((carrier) => carrier.code))].join(', ');
        throw new PayrollPeriodsServiceError(
          `Payroll Period ${codes} already carries ${
            carriers.length === 1 ? 'an adjustment' : 'adjustments'
          } for this period and calculated ${
            carriers.length === 1 ? 'its' : 'their'
          } difference. Ask again after it is finalized or returned to DRAFT.`,
          409,
          'PAYROLL_ADJUSTMENT_IN_PAYROLL',
        );
      }

      const adjustments: PayrollRecalculationResult['adjustments'] = [];
      for (const employeeId of employeeIds) {
        const opened = await openPayrollAdjustment(transaction, {
          agencyId: context.agencyId,
          originalPayrollPeriodId: periodId,
          employeeId,
          cause: {
            origin: 'RECALCULATION',
            reason: input.reason,
            openedByMembershipId: context.membershipId,
          },
        });
        adjustments.push({ ...opened, employeeId });
      }
      await transaction.auditEvent.create({
        data: auditEvent(context, {
          action: PAYROLL_ADJUSTMENT_RECALCULATION_OPENED,
          entityId: periodId,
          previousStatus: 'FINALIZED',
          newStatus: 'FINALIZED',
          reason: input.reason,
          metadata: { employeeId: input.employeeId ?? null, adjustments },
        }),
      });
      return { payrollPeriodId: periodId, adjustments };
    });
  }

  /**
   * The Agency's Payroll Adjustments, newest first, at most
   * `PAYROLL_ADJUSTMENT_LIST_LIMIT`, filtered by status and original period
   * (#651). Read-only, with `payroll.periods.read` for the whole Agency.
   */
  async list(context: RequestContext, rawQuery: unknown): Promise<PayrollAdjustmentView[]> {
    if (!holdsAgencyWide(context, 'payroll.periods.read')) {
      throw new PayrollPeriodsServiceError(
        'Reading Payroll Adjustments needs the payroll.periods.read permission for the whole Agency.',
        403,
        'PAYROLL_PERIOD_READ_FORBIDDEN',
      );
    }
    const query = parse(payrollAdjustmentListQuerySchema, rawQuery ?? {});
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const rows = await transaction.payrollAdjustment.findMany({
        where: {
          agencyId: context.agencyId,
          ...(query.status ? { status: query.status } : {}),
          ...(query.originalPayrollPeriodId
            ? { originalPayrollPeriodId: query.originalPayrollPeriodId }
            : {}),
        },
        orderBy: [{ openedAt: 'desc' }, { id: 'asc' }],
        take: PAYROLL_ADJUSTMENT_LIST_LIMIT,
        select: {
          id: true,
          employeeId: true,
          status: true,
          openedAt: true,
          postedAt: true,
          cancelledAt: true,
          originalPayrollPeriodId: true,
          postedByPayrollPeriodId: true,
          causes: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        },
      });
      if (rows.length === 0) return [];

      const open = rows.filter((row) => row.status === 'OPEN').map((row) => row.id);
      const carriers =
        open.length === 0
          ? []
          : await transaction.$queryRaw<{ payrollAdjustmentId: string; periodId: string }[]>`
              SELECT DISTINCT i."payroll_adjustment_id"::text AS "payrollAdjustmentId",
                     p."id"::text AS "periodId"
              FROM "payroll_rule_snapshot_items" i
              JOIN "payroll_rule_snapshots" s
                ON s."agency_id" = i."agency_id" AND s."id" = i."payroll_rule_snapshot_id"
              JOIN "payroll_periods" p
                ON p."agency_id" = s."agency_id" AND p."id" = s."payroll_period_id"
               AND p."calculation_version" = s."calculation_version"
              WHERE i."agency_id" = CAST(${context.agencyId} AS uuid)
                AND i."payroll_adjustment_id" = ANY(CAST(${open} AS uuid[]))
                AND p."status" IN ('CALCULATING', 'FOR_REVIEW', 'CERTIFIED', 'APPROVED')
              ORDER BY 1, 2
            `;
      const periodIds = new Set([
        ...rows.map((row) => row.originalPayrollPeriodId),
        ...rows.flatMap((row) => row.postedByPayrollPeriodId ?? []),
        ...carriers.map((row) => row.periodId),
      ]);
      const membershipIds = new Set(
        rows.flatMap((row) => row.causes.flatMap((cause) => cause.openedByMembershipId ?? [])),
      );
      const [periods, memberships] = await Promise.all([
        transaction.payrollPeriod.findMany({
          where: { agencyId: context.agencyId, id: { in: [...periodIds] } },
          select: { id: true, code: true, status: true },
        }),
        membershipIds.size === 0
          ? []
          : transaction.agencyMembership.findMany({
              where: { agencyId: context.agencyId, id: { in: [...membershipIds] } },
              select: { id: true, user: { select: { displayName: true } } },
            }),
      ]);
      const periodById = new Map(
        periods.map((period) => [
          period.id,
          { id: period.id, code: period.code, status: period.status as PayrollPeriodStatus },
        ]),
      );
      const periodOf = (id: string): PayrollAdjustmentPeriodRef => {
        const period = periodById.get(id);
        if (!period) throw new Error(`Payroll Period ${id} of a Payroll Adjustment was not found.`);
        return period;
      };
      const names = new Map(memberships.map((row) => [row.id, row.user.displayName]));

      return rows.map((row): PayrollAdjustmentView => ({
        id: row.id,
        employeeId: row.employeeId,
        status: row.status as PayrollAdjustmentStatus,
        openedAt: row.openedAt.toISOString(),
        postedAt: row.postedAt?.toISOString() ?? null,
        cancelledAt: row.cancelledAt?.toISOString() ?? null,
        originalPayrollPeriod: periodOf(row.originalPayrollPeriodId),
        carriedBy: carriers
          .filter((carrier) => carrier.payrollAdjustmentId === row.id)
          .map((carrier) => periodOf(carrier.periodId)),
        postedBy: row.postedByPayrollPeriodId ? periodOf(row.postedByPayrollPeriodId) : null,
        causes: row.causes.map((cause) => ({
          id: cause.id,
          origin: cause.origin as PayrollAdjustmentCauseView['origin'],
          reason: cause.reason,
          payrollInputId: cause.payrollInputId,
          sourceCorrectionKey: cause.sourceCorrectionKey,
          payrollHoldId: cause.payrollHoldId,
          openedByMembershipId: cause.openedByMembershipId,
          openedByName: cause.openedByMembershipId
            ? (names.get(cause.openedByMembershipId) ?? null)
            : null,
          createdAt: cause.createdAt.toISOString(),
        })),
      }));
    });
  }
}
