import { Injectable } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import {
  claimFunction,
  lockPeriod,
  requireStatus,
} from '../payroll-periods/payroll-certification.service';
import {
  lockPayslipForCommand,
  parseReason,
  PAYSLIP_RELEASED,
  payslipAuditEvent,
  payslipReleasedOutboxEvent,
  requireAgencyWide,
  toPayslipView,
  type PayslipView,
} from './payslips.shared';

const PERMISSION = 'payroll.payslips.release';

export interface PeriodPayslipRelease {
  payrollPeriodId: string;
  /** The Payslips this command released, none when nothing was READY. */
  releasedPayslipIds: string[];
  /** Payslips still generating; a later release takes them once READY. */
  generatingCount: number;
}

/**
 * Releases Payslips to their Employees (hris-controls.md §5.21, #640), by
 * hand: nothing releases automatically, and release does not wait on
 * Disbursement Outcomes. Both commands need `payroll.payslips.release` held
 * Agency-wide and claim the APPROVAL payroll function on the period in their
 * own transaction (§5.20). Each released Payslip gets a `PAYSLIP_RELEASED`
 * Audit Event and the Outbox Event that notifies its Employee after commit.
 */
@Injectable()
export class PayslipReleaseService {
  /**
   * Release every READY Payslip of a FINALIZED period. A WITHHELD Payslip
   * stays withheld, and one still GENERATING is counted, so releasing again
   * later takes it; a release with nothing READY writes only the claim.
   */
  async releasePeriod(context: RequestContext, periodId: string): Promise<PeriodPayslipRelease> {
    requireAgencyWide(context, PERMISSION, 'Releasing payslips');
    return withDatabaseContext(
      requestDatabaseContext(context, 'payroll-transition'),
      async (transaction) => {
        requireStatus(await lockPeriod(transaction, context, periodId), 'FINALIZED');
        await claimFunction(transaction, context, periodId, 'APPROVAL');

        const results = await transaction.payrollEmployee.findMany({
          where: { agencyId: context.agencyId, payrollPeriodId: periodId, status: 'FINALIZED' },
          select: { id: true, employeeId: true },
        });
        const employeeIdOf = new Map(results.map((result) => [result.id, result.employeeId]));
        const payslips = await transaction.payslip.findMany({
          where: {
            agencyId: context.agencyId,
            payrollEmployeeId: { in: [...employeeIdOf.keys()] },
            status: { in: ['GENERATING', 'READY'] },
          },
          orderBy: { id: 'asc' },
          select: { id: true, payrollEmployeeId: true, status: true, documentId: true },
        });
        const ready = payslips.filter((payslip) => payslip.status === 'READY');
        const generatingCount = payslips.length - ready.length;
        if (ready.length === 0) {
          return { payrollPeriodId: periodId, releasedPayslipIds: [], generatingCount };
        }

        // The period lock holds off every other payslip command, and generation
        // never moves a READY Payslip, so each READY one found is still READY.
        const updated = await transaction.payslip.updateMany({
          where: { id: { in: ready.map((payslip) => payslip.id) }, status: 'READY' },
          data: {
            status: 'RELEASED',
            releasedAt: new Date(),
            releasedByMembershipId: context.membershipId,
          },
        });
        if (updated.count !== ready.length) {
          throw new Error('A READY Payslip changed while its period was locked.');
        }
        await transaction.auditEvent.createMany({
          data: ready.map((payslip) =>
            payslipAuditEvent(context, {
              action: PAYSLIP_RELEASED,
              payslipId: payslip.id,
              previousStatus: 'READY',
              newStatus: 'RELEASED',
              reason: null,
              idempotencyKey: 'released',
              metadata: {
                payrollPeriodId: periodId,
                payrollEmployeeId: payslip.payrollEmployeeId,
                documentId: payslip.documentId,
              },
            }),
          ),
        });
        await transaction.outboxEvent.createMany({
          data: ready.map((payslip) =>
            payslipReleasedOutboxEvent(context, {
              payslipId: payslip.id,
              payrollPeriodId: periodId,
              payrollEmployeeId: payslip.payrollEmployeeId,
              employeeId: employeeIdOf.get(payslip.payrollEmployeeId)!,
            }),
          ),
        });
        return {
          payrollPeriodId: periodId,
          releasedPayslipIds: ready.map((payslip) => payslip.id),
          generatingCount,
        };
      },
    );
  }

  /** Release one WITHHELD Payslip, with a reason. Its withholding stays on record. */
  async releaseWithheld(
    context: RequestContext,
    payslipId: string,
    rawInput: unknown,
  ): Promise<PayslipView> {
    requireAgencyWide(context, PERMISSION, 'Releasing a withheld payslip');
    const reason = parseReason(rawInput);
    return withDatabaseContext(
      requestDatabaseContext(context, 'payroll-transition'),
      async (transaction) => {
        const { payslip, payrollPeriodId, employeeId } = await lockPayslipForCommand(
          transaction,
          context,
          payslipId,
          'WITHHELD',
        );
        const row = await transaction.payslip.update({
          where: { id: payslip.id },
          data: {
            status: 'RELEASED',
            releasedAt: new Date(),
            releasedByMembershipId: context.membershipId,
          },
        });
        await transaction.auditEvent.create({
          data: payslipAuditEvent(context, {
            action: PAYSLIP_RELEASED,
            payslipId: payslip.id,
            previousStatus: 'WITHHELD',
            newStatus: 'RELEASED',
            reason,
            idempotencyKey: 'released',
            metadata: {
              payrollPeriodId,
              payrollEmployeeId: payslip.payrollEmployeeId,
              documentId: payslip.documentId,
            },
          }),
        });
        await transaction.outboxEvent.create({
          data: payslipReleasedOutboxEvent(context, {
            payslipId: payslip.id,
            payrollPeriodId,
            payrollEmployeeId: payslip.payrollEmployeeId,
            employeeId,
          }),
        });
        return toPayslipView(row, payrollPeriodId);
      },
    );
  }
}
