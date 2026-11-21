import { Injectable } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import {
  claimFunction,
  lockPeriod,
  moveStatus,
  refuseOpenBlockingExceptions,
  requirePermission,
  requireStatus,
  revokeCertificationInForce,
} from './payroll-certification.service';
import {
  auditEvent,
  parse,
  PayrollPeriodsServiceError,
  stale,
  type PayrollPeriodSummary,
} from './payroll-periods.service';
import {
  PAYROLL_EXPORT_CHECKPOINTS,
  payrollPeriodApproveSchema,
  payrollPeriodReasonedCommandSchema,
} from './payroll-periods.schemas';

/**
 * The Payroll Approver's commands before finalization (hris-controls.md
 * §5.20, #330, #638), each with its own §6.10 permission and Audit Event:
 *
 * - Approve (`CERTIFIED → APPROVED`) needs both checkpoint reviews confirmed
 *   on the current Certified Payroll Review Export and no open blocking
 *   exception. It writes no row of its own: the certification in force binds
 *   the approved version and hash, and an APPROVED period can no longer be
 *   certified, reviewed, or recalculated, so the version stays locked.
 * - Return before finalization (`APPROVED → FOR_REVIEW`) records the reason on
 *   the certification it revokes, which supersedes the export and so revokes
 *   its reviews.
 *
 * Both claim APPROVAL on the period; a person who holds another payroll
 * function there is refused. Each locks the period row, so two concurrent
 * commands run one after the other and the second sees the first's result.
 */
@Injectable()
export class PayrollApprovalService {
  async approve(
    context: RequestContext,
    periodId: string,
    rawInput: unknown,
  ): Promise<PayrollPeriodSummary> {
    requirePermission(context, 'payroll.periods.approve', 'Approving a Payroll Period');
    const input = parse(payrollPeriodApproveSchema, rawInput);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const period = await lockPeriod(transaction, context, periodId);
      requireStatus(period, 'CERTIFIED');
      if (period.rowVersion !== input.rowVersion) throw stale();
      await refuseOpenBlockingExceptions(
        transaction,
        context,
        periodId,
        period.calculationVersion,
        'Revoke the certification and return the period for correction',
      );
      const certification = await transaction.payrollCertification.findFirst({
        where: { agencyId: context.agencyId, payrollPeriodId: periodId, revokedAt: null },
        select: { id: true, calculationVersion: true, calculationHash: true },
      });
      const reviewExport =
        certification &&
        (await transaction.certifiedPayrollReviewExport.findFirst({
          where: {
            agencyId: context.agencyId,
            payrollCertificationId: certification.id,
            supersededAt: null,
          },
          select: { id: true, checksum: true },
        }));
      if (!certification || !reviewExport) {
        throw new Error('A CERTIFIED Payroll Period has no current certification and export.');
      }
      // A returned review supersedes its export, so the current one holds only confirmations.
      const reviews = await transaction.payrollExportCheckpointReview.findMany({
        where: {
          agencyId: context.agencyId,
          certifiedPayrollReviewExportId: reviewExport.id,
          outcome: 'CONFIRMED',
        },
        select: { id: true, checkpoint: true },
        orderBy: { reviewedAt: 'asc' },
      });
      const unconfirmed = PAYROLL_EXPORT_CHECKPOINTS.filter(
        (checkpoint) => !reviews.some((review) => review.checkpoint === checkpoint),
      );
      if (unconfirmed.length > 0) {
        throw new PayrollPeriodsServiceError(
          `Approval needs both checkpoint reviews confirmed on the current Certified Payroll Review Export; ${unconfirmed.join(
            ' and ',
          )} is not confirmed yet.`,
          409,
          'PAYROLL_CHECKPOINT_REVIEWS_UNCONFIRMED',
        );
      }
      await claimFunction(transaction, context, periodId, 'APPROVAL');

      const after = await moveStatus(transaction, context, periodId, period, 'APPROVED');
      await transaction.auditEvent.create({
        data: auditEvent(context, {
          action: 'PAYROLL_PERIOD_APPROVED',
          entityId: periodId,
          previousStatus: 'CERTIFIED',
          newStatus: 'APPROVED',
          reason: null,
          metadata: {
            payrollCertificationId: certification.id,
            calculationVersion: certification.calculationVersion,
            calculationHash: certification.calculationHash,
            certifiedPayrollReviewExportId: reviewExport.id,
            reviewExportChecksum: reviewExport.checksum,
            checkpointReviewIds: reviews.map((review) => review.id),
          },
        }),
      });
      return after;
    });
  }

  /** Return an APPROVED period to FOR_REVIEW before finalization, with a reason. */
  async returnBeforeFinalization(
    context: RequestContext,
    periodId: string,
    rawInput: unknown,
  ): Promise<PayrollPeriodSummary> {
    requirePermission(
      context,
      'payroll.periods.return_approved',
      'Returning an approved Payroll Period',
    );
    const input = parse(payrollPeriodReasonedCommandSchema, rawInput);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const period = await lockPeriod(transaction, context, periodId);
      requireStatus(period, 'APPROVED');
      if (period.rowVersion !== input.rowVersion) throw stale();
      await claimFunction(transaction, context, periodId, 'APPROVAL');

      const revoked = await revokeCertificationInForce(
        transaction,
        context,
        periodId,
        input.reason,
      );
      const after = await moveStatus(transaction, context, periodId, period, 'FOR_REVIEW');
      await transaction.auditEvent.create({
        data: auditEvent(context, {
          action: 'PAYROLL_PERIOD_RETURNED_BEFORE_FINALIZATION',
          entityId: periodId,
          previousStatus: 'APPROVED',
          newStatus: 'FOR_REVIEW',
          reason: input.reason,
          metadata: revoked,
        }),
      });
      return after;
    });
  }
}
