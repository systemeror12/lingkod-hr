import { Inject, Injectable } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import {
  claimFunction,
  lockPeriod,
  moveStatus,
  requirePermission,
  requireStatus,
  revokeCertificationInForce,
} from './payroll-certification.service';
import type { PayrollFunction } from './payroll-period-actors';
import {
  auditEvent,
  checkpointReviewSelect,
  parse,
  PayrollPeriodsServiceError,
  summarySelect,
  toCheckpointReviewView,
  toSummary,
  type PayrollCheckpointReviewView,
  type PayrollPeriodSummary,
} from './payroll-periods.service';
import {
  payrollCheckpointReviewSchema,
  type PayrollExportCheckpoint,
} from './payroll-periods.schemas';

/** Each checkpoint's §6.10 permission and the payroll function recording it claims (#330). */
const CHECKPOINTS = {
  BUDGET: {
    permission: 'payroll.periods.review_funding',
    payrollFunction: 'BUDGET_REVIEW',
    command: 'Recording the Budget checkpoint review',
  },
  ACCOUNTING: {
    permission: 'payroll.periods.review_accounting',
    payrollFunction: 'ACCOUNTING_REVIEW',
    command: 'Recording the Accounting checkpoint review',
  },
} as const satisfies Record<
  PayrollExportCheckpoint,
  { permission: string; payrollFunction: PayrollFunction; command: string }
>;

export interface PayrollCheckpointReviewResult {
  review: PayrollCheckpointReviewView;
  period: PayrollPeriodSummary;
}

/**
 * The Budget and Accounting checkpoint reviews of a CERTIFIED Payroll Period
 * (hris-controls.md §5.20, #29, #330). Each records one immutable Payroll
 * Export Checkpoint Review against the exact Certified Payroll Review Export
 * the reviewer names, which must be the period's current one. The two are
 * independent and may be recorded in either order; a reviewer who is only
 * waiting records nothing.
 *
 * - Confirm keeps the period CERTIFIED and records the external reference and
 *   the finalized Document Version that evidences it.
 * - Return records the reason, and in the same transaction revokes the
 *   certification, supersedes the export, and so revokes the other review, and
 *   moves the period to FOR_REVIEW.
 *
 * Each needs its own permission held Agency-wide and claims BUDGET_REVIEW or
 * ACCOUNTING_REVIEW on the period; a person who holds another function there
 * is refused. The period row lock orders a review against a concurrent review,
 * revocation, or return.
 */
@Injectable()
export class PayrollCheckpointReviewService {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  async record(
    context: RequestContext,
    checkpoint: PayrollExportCheckpoint,
    periodId: string,
    reviewExportId: string,
    rawInput: unknown,
  ): Promise<PayrollCheckpointReviewResult> {
    const { permission, payrollFunction, command } = CHECKPOINTS[checkpoint];
    requirePermission(context, permission, command);
    const input = parse(payrollCheckpointReviewSchema, rawInput);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const period = await lockPeriod(transaction, context, periodId);
      requireStatus(period, 'CERTIFIED');
      const reviewExport = await transaction.certifiedPayrollReviewExport.findFirst({
        where: { agencyId: context.agencyId, payrollPeriodId: periodId, id: reviewExportId },
        select: { supersededAt: true },
      });
      if (!reviewExport) {
        throw new PayrollPeriodsServiceError(
          'The Certified Payroll Review Export could not be found.',
          404,
          'PAYROLL_REVIEW_EXPORT_NOT_FOUND',
        );
      }
      if (reviewExport.supersededAt) {
        throw new PayrollPeriodsServiceError(
          'This Certified Payroll Review Export was superseded. Review the current export of the period.',
          409,
          'PAYROLL_REVIEW_EXPORT_SUPERSEDED',
        );
      }
      const recorded = await transaction.payrollExportCheckpointReview.findUnique({
        where: {
          certifiedPayrollReviewExportId_checkpoint: {
            certifiedPayrollReviewExportId: reviewExportId,
            checkpoint,
          },
        },
        select: { outcome: true },
      });
      if (recorded) {
        throw new PayrollPeriodsServiceError(
          `The ${checkpoint} checkpoint review of this export is already recorded as ${recorded.outcome}.`,
          409,
          'PAYROLL_CHECKPOINT_REVIEW_RECORDED',
        );
      }
      if (input.evidenceDocumentVersionId) {
        const evidence = await this.documents.resolveFinalizedVersionInTransaction(
          transaction,
          context,
          input.evidenceDocumentVersionId,
        );
        if (!evidence) {
          throw new PayrollPeriodsServiceError(
            'The evidence must be an exact finalized Document Version of this Agency.',
            400,
            'PAYROLL_CHECKPOINT_REVIEW_EVIDENCE_INVALID',
          );
        }
      }
      await claimFunction(transaction, context, periodId, payrollFunction);

      const review = toCheckpointReviewView(
        await transaction.payrollExportCheckpointReview.create({
          data: {
            agencyId: context.agencyId,
            payrollPeriodId: periodId,
            certifiedPayrollReviewExportId: reviewExportId,
            checkpoint,
            outcome: input.outcome,
            externalReference: input.externalReference ?? null,
            evidenceDocumentVersionId: input.evidenceDocumentVersionId ?? null,
            reason: input.outcome === 'RETURNED' ? input.reason : null,
            reviewedByMembershipId: context.membershipId,
          },
          select: checkpointReviewSelect,
        }),
      );
      const metadata = {
        payrollExportCheckpointReviewId: review.id,
        checkpoint,
        reviewExportId,
        externalReference: review.externalReference,
        evidenceDocumentVersionId: review.evidenceDocumentVersionId,
      };

      if (input.outcome === 'CONFIRMED') {
        await transaction.auditEvent.create({
          data: auditEvent(context, {
            action: 'PAYROLL_CHECKPOINT_REVIEW_CONFIRMED',
            entityId: periodId,
            previousStatus: 'CERTIFIED',
            newStatus: 'CERTIFIED',
            reason: null,
            metadata,
          }),
        });
        const unchanged = await transaction.payrollPeriod.findUniqueOrThrow({
          where: { agencyId_id: { agencyId: context.agencyId, id: periodId } },
          select: summarySelect,
        });
        return { review, period: toSummary(unchanged) };
      }

      const revoked = await revokeCertificationInForce(
        transaction,
        context,
        periodId,
        input.reason,
      );
      const after = await moveStatus(transaction, context, periodId, period, 'FOR_REVIEW');
      await transaction.auditEvent.create({
        data: auditEvent(context, {
          action: 'PAYROLL_CHECKPOINT_REVIEW_RETURNED',
          entityId: periodId,
          previousStatus: 'CERTIFIED',
          newStatus: 'FOR_REVIEW',
          reason: input.reason,
          metadata: {
            ...metadata,
            ...revoked,
            revokedCheckpointReviewIds: revoked.revokedCheckpointReviewIds.filter(
              (id) => id !== review.id,
            ),
          },
        }),
      });
      return { review, period: after };
    });
  }
}
