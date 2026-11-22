import { Injectable } from '@nestjs/common';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { livePayrollsCarrying, openPayrollAdjustment } from './payroll-adjustments';
import { auditEvent, parse, PayrollPeriodsServiceError } from './payroll-periods.service';
import { payrollAdjustmentRecalculationSchema } from './payroll-periods.schemas';

/** The Audit Event action of a recalculation request. */
export const PAYROLL_ADJUSTMENT_RECALCULATION_OPENED = 'PAYROLL_ADJUSTMENT_RECALCULATION_OPENED';

export interface PayrollRecalculationResult {
  payrollPeriodId: string;
  /** One per Employee: the OPEN adjustment, and whether the cause joined one already open. */
  adjustments: { payrollAdjustmentId: string; employeeId: string; joined: boolean }[];
}

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
}
