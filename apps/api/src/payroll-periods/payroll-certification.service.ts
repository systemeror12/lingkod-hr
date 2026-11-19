import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { claimPayrollFunction, type PayrollFunction } from './payroll-period-actors';
import { generateReviewExport, supersedeReviewExport } from './payroll-review-export.service';
import {
  auditEvent,
  parse,
  PayrollPeriodsServiceError,
  readCalculationHash,
  stale,
  summarySelect,
  toSummary,
  type PayrollPeriodSummary,
} from './payroll-periods.service';
import {
  payrollPeriodCertifySchema,
  payrollPeriodReasonedCommandSchema,
  type PayrollPeriodStatus,
} from './payroll-periods.schemas';

export interface LockedPeriod {
  status: PayrollPeriodStatus;
  calculationVersion: number;
  rowVersion: number;
}

/**
 * The HR certification commands of a Payroll Period (hris-controls.md §5.20),
 * each with its own §6.10 permission and Audit Event:
 *
 * - Certify (`FOR_REVIEW → CERTIFIED`) records a Payroll Certification of the
 *   calculation version and hash the certifier reviewed, and generates its
 *   Certified Payroll Review Export in the same transaction (#636). It is
 *   refused while that version has an open blocking exception, when the
 *   version or hash is no longer the period's, or when the export does not
 *   reconcile; a refusal stores nothing.
 * - Revoke certification (`CERTIFIED → FOR_REVIEW`) records the revocation,
 *   with a reason, on the certification in force.
 * - Return for correction (`FOR_REVIEW → DRAFT`) sends the period back to the
 *   Payroll Preparer, with a reason. Payroll Inputs the calculation used are
 *   no longer held by a live calculation once it is DRAFT.
 *
 * Certify and revoke claim the actor's payroll function on the period; return
 * claims none (#330). Each command locks the period row, so two concurrent
 * commands run one after the other and the second sees the first's result.
 */
@Injectable()
export class PayrollCertificationService {
  async certify(
    context: RequestContext,
    periodId: string,
    rawInput: unknown,
  ): Promise<PayrollPeriodSummary> {
    requirePermission(context, 'payroll.periods.certify', 'Certifying a Payroll Period');
    const input = parse(payrollPeriodCertifySchema, rawInput);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const period = await lockPeriod(transaction, context, periodId);
      requireStatus(period, 'FOR_REVIEW');
      if (period.calculationVersion !== input.calculationVersion) {
        throw new PayrollPeriodsServiceError(
          `The Payroll Period is at calculation version ${period.calculationVersion}, not ${input.calculationVersion}. Review the current version before certifying.`,
          409,
          'PAYROLL_CALCULATION_VERSION_CHANGED',
        );
      }
      const blocking = await transaction.payrollException.count({
        where: {
          agencyId: context.agencyId,
          payrollPeriodId: periodId,
          calculationVersion: period.calculationVersion,
          severity: 'BLOCKING',
          status: 'OPEN',
        },
      });
      if (blocking > 0) {
        throw new PayrollPeriodsServiceError(
          `Calculation version ${period.calculationVersion} has ${blocking} open blocking ${
            blocking === 1 ? 'exception' : 'exceptions'
          }. Return the period for correction; a blocking exception is never waived.`,
          409,
          'PAYROLL_PERIOD_BLOCKING_EXCEPTION',
        );
      }
      const calculationHash = await readCalculationHash(
        transaction,
        context,
        periodId,
        period.calculationVersion,
      );
      if (calculationHash !== input.calculationHash) {
        throw new PayrollPeriodsServiceError(
          'The calculation hash no longer matches the results you reviewed. Review the current results before certifying.',
          409,
          'PAYROLL_CALCULATION_HASH_CHANGED',
        );
      }
      await claimFunction(transaction, context, periodId, 'HR_CERTIFICATION');

      const certification = await transaction.payrollCertification.create({
        data: {
          agencyId: context.agencyId,
          payrollPeriodId: periodId,
          calculationVersion: period.calculationVersion,
          calculationHash,
          certifiedByMembershipId: context.membershipId,
        },
        select: { id: true },
      });
      const after = await moveStatus(transaction, context, periodId, period, 'CERTIFIED');
      const reviewExport = await generateReviewExport(transaction, context, periodId);
      await transaction.auditEvent.create({
        data: auditEvent(context, {
          action: 'PAYROLL_PERIOD_CERTIFIED',
          entityId: periodId,
          previousStatus: 'FOR_REVIEW',
          newStatus: 'CERTIFIED',
          reason: null,
          metadata: {
            payrollCertificationId: certification.id,
            calculationVersion: period.calculationVersion,
            calculationHash,
            certifiedPayrollReviewExportId: reviewExport.id,
            reviewExportChecksum: reviewExport.checksum,
          },
        }),
      });
      return after;
    });
  }

  /**
   * Revoke the certification in force and supersede its Certified Payroll
   * Review Export, which revokes the export's checkpoint reviews. The HR
   * Certifier acts in HR_CERTIFICATION; a Payroll Approver, who holds no
   * certify permission, acts in APPROVAL (#330).
   */
  async revokeCertification(
    context: RequestContext,
    periodId: string,
    rawInput: unknown,
  ): Promise<PayrollPeriodSummary> {
    requirePermission(
      context,
      'payroll.periods.revoke_certification',
      'Revoking a Payroll Certification',
    );
    const input = parse(payrollPeriodReasonedCommandSchema, rawInput);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const period = await lockPeriod(transaction, context, periodId);
      requireStatus(period, 'CERTIFIED');
      if (period.rowVersion !== input.rowVersion) throw stale();
      await claimFunction(
        transaction,
        context,
        periodId,
        holdsAgencyWide(context, 'payroll.periods.certify') ? 'HR_CERTIFICATION' : 'APPROVAL',
      );

      const revoked = await revokeCertificationInForce(
        transaction,
        context,
        periodId,
        input.reason,
      );
      const after = await moveStatus(transaction, context, periodId, period, 'FOR_REVIEW');
      await transaction.auditEvent.create({
        data: auditEvent(context, {
          action: 'PAYROLL_PERIOD_CERTIFICATION_REVOKED',
          entityId: periodId,
          previousStatus: 'CERTIFIED',
          newStatus: 'FOR_REVIEW',
          reason: input.reason,
          metadata: revoked,
        }),
      });
      return after;
    });
  }

  /** Return a FOR_REVIEW period to the Payroll Preparer for correction. */
  async returnForCorrection(
    context: RequestContext,
    periodId: string,
    rawInput: unknown,
  ): Promise<PayrollPeriodSummary> {
    requirePermission(context, 'payroll.periods.return', 'Returning a Payroll Period');
    const input = parse(payrollPeriodReasonedCommandSchema, rawInput);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const period = await lockPeriod(transaction, context, periodId);
      requireStatus(period, 'FOR_REVIEW');
      if (period.rowVersion !== input.rowVersion) throw stale();
      const after = await moveStatus(transaction, context, periodId, period, 'DRAFT');
      await transaction.auditEvent.create({
        data: auditEvent(context, {
          action: 'PAYROLL_PERIOD_RETURNED',
          entityId: periodId,
          previousStatus: 'FOR_REVIEW',
          newStatus: 'DRAFT',
          reason: input.reason,
          metadata: { calculationVersion: period.calculationVersion },
        }),
      });
      return after;
    });
  }
}

export function requirePermission(
  context: RequestContext,
  permission: string,
  command: string,
): void {
  if (!holdsAgencyWide(context, permission)) {
    throw new PayrollPeriodsServiceError(
      `${command} needs the ${permission} permission for the whole Agency.`,
      403,
      'PAYROLL_PERIOD_REVIEW_FORBIDDEN',
    );
  }
}

/** The period row, locked FOR UPDATE until the command commits. */
export async function lockPeriod(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
): Promise<LockedPeriod> {
  const [row] = await transaction.$queryRaw<
    { status: PayrollPeriodStatus; calculation_version: number; row_version: number }[]
  >`
    SELECT "status", "calculation_version", "row_version" FROM "payroll_periods"
    WHERE "agency_id" = CAST(${context.agencyId} AS uuid)
      AND "id" = CAST(${periodId} AS uuid)
    FOR UPDATE
  `;
  if (!row) {
    throw new PayrollPeriodsServiceError(
      'The Payroll Period could not be found.',
      404,
      'PAYROLL_PERIOD_NOT_FOUND',
    );
  }
  return {
    status: row.status,
    calculationVersion: row.calculation_version,
    rowVersion: row.row_version,
  };
}

export function requireStatus(period: LockedPeriod, status: PayrollPeriodStatus): void {
  if (period.status !== status) {
    throw new PayrollPeriodsServiceError(
      `The Payroll Period is ${period.status}; this command applies only while it is ${status}.`,
      409,
      `PAYROLL_PERIOD_NOT_${status}`,
    );
  }
}

export async function claimFunction(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  payrollPeriodId: string,
  payrollFunction: PayrollFunction,
): Promise<void> {
  const claim = await claimPayrollFunction(transaction, {
    agencyId: context.agencyId,
    payrollPeriodId,
    membershipId: context.membershipId,
    payrollFunction,
  });
  if (claim.outcome === 'REFUSED') {
    throw new PayrollPeriodsServiceError(
      `You act in ${claim.heldFunction} on this Payroll Period, so you cannot also act in ${payrollFunction}.`,
      409,
      'PAYROLL_FUNCTION_CONFLICT',
    );
  }
}

export async function moveStatus(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
  period: LockedPeriod,
  status: PayrollPeriodStatus,
): Promise<PayrollPeriodSummary> {
  const row = await transaction.payrollPeriod.update({
    where: { agencyId_id: { agencyId: context.agencyId, id: periodId } },
    data: { status, rowVersion: period.rowVersion + 1 },
    select: summarySelect,
  });
  return toSummary(row);
}

/**
 * Revoke the certification in force on a CERTIFIED period, with the reason,
 * as the acting member, and supersede its Certified Payroll Review Export. A
 * checkpoint review is in force only while its export is current, so this
 * revokes the export's reviews too (#330). Returns what it revoked, for the
 * caller's Audit Event.
 */
export async function revokeCertificationInForce(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
  reason: string,
) {
  const certification = await transaction.payrollCertification.findFirst({
    where: { agencyId: context.agencyId, payrollPeriodId: periodId, revokedAt: null },
    select: { id: true, calculationVersion: true, calculationHash: true },
  });
  if (!certification) {
    throw new Error('A CERTIFIED Payroll Period has no certification in force.');
  }
  await transaction.payrollCertification.update({
    where: { id: certification.id },
    data: {
      revokedByMembershipId: context.membershipId,
      revokedAt: new Date(),
      revocationReason: reason,
    },
  });
  const supersededReviewExportId = await supersedeReviewExport(
    transaction,
    context.agencyId,
    certification.id,
  );
  const revokedCheckpointReviews = supersededReviewExportId
    ? await transaction.payrollExportCheckpointReview.findMany({
        where: {
          agencyId: context.agencyId,
          certifiedPayrollReviewExportId: supersededReviewExportId,
        },
        select: { id: true },
        orderBy: { reviewedAt: 'asc' },
      })
    : [];
  return {
    payrollCertificationId: certification.id,
    calculationVersion: certification.calculationVersion,
    calculationHash: certification.calculationHash,
    supersededReviewExportId,
    revokedCheckpointReviewIds: revokedCheckpointReviews.map((review) => review.id),
  };
}
