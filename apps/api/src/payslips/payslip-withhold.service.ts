import { Injectable } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import {
  lockPayslipForCommand,
  parseReason,
  PAYSLIP_WITHHELD,
  payslipAuditEvent,
  requireAgencyWide,
  toPayslipView,
  type PayslipView,
} from './payslips.shared';

/**
 * Withholds one READY Payslip from its Employee (hris-controls.md §5.21,
 * #640). It needs `payroll.payslips.withhold` held Agency-wide and a reason,
 * and claims the APPROVAL payroll function on the period (§5.20). It never
 * stops payment: the Payment Instruction is unaffected. A RELEASED Payslip
 * cannot be withheld, and a WITHHELD one is released singly.
 */
@Injectable()
export class PayslipWithholdService {
  async withhold(
    context: RequestContext,
    payslipId: string,
    rawInput: unknown,
  ): Promise<PayslipView> {
    requireAgencyWide(context, 'payroll.payslips.withhold', 'Withholding a payslip');
    const reason = parseReason(rawInput);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const { payslip, payrollPeriodId } = await lockPayslipForCommand(
        transaction,
        context,
        payslipId,
        'READY',
      );
      const row = await transaction.payslip.update({
        where: { id: payslip.id },
        data: {
          status: 'WITHHELD',
          withheldAt: new Date(),
          withheldByMembershipId: context.membershipId,
          withholdReason: reason,
        },
      });
      await transaction.auditEvent.create({
        data: payslipAuditEvent(context, {
          action: PAYSLIP_WITHHELD,
          payslipId: payslip.id,
          previousStatus: 'READY',
          newStatus: 'WITHHELD',
          reason,
          // A Payslip is withheld at most once: only a READY one can be.
          idempotencyKey: 'withheld',
          metadata: { payrollPeriodId, payrollEmployeeId: payslip.payrollEmployeeId },
        }),
      });
      return toPayslipView(row, payrollPeriodId);
    });
  }
}
