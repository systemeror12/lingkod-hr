import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { claimPayrollFunction, type PayrollFunction } from './payroll-period-actors';
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

interface LockedPeriod {
  status: PayrollPeriodStatus;
  calculationVersion: number;
  rowVersion: number;
}

/**
 * The HR certification commands of a Payroll Period (hris-controls.md §5.20),
 * each with its own §6.10 permission and Audit Event:
 *
 * - Certify (`FOR_REVIEW → CERTIFIED`) records a Payroll Certification of the
 *   calculation version and hash the certifier reviewed. It is refused while
 *   that version has an open blocking exception, or when the version or hash
 *   is no longer the period's.
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
          },
        }),
      });
      return after;
    });
  }

  /**
   * Revoke the certification in force. The HR Certifier acts in
   * HR_CERTIFICATION; a Payroll Approver, who holds no certify permission,
   * acts in APPROVAL (#330). The Certified Payroll Review Export and its
   * checkpoint reviews this must also supersede arrive with #636 and #637.
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
          revocationReason: input.reason,
        },
      });
      const after = await moveStatus(transaction, context, periodId, period, 'FOR_REVIEW');
      await transaction.auditEvent.create({
        data: auditEvent(context, {
          action: 'PAYROLL_PERIOD_CERTIFICATION_REVOKED',
          entityId: periodId,
          previousStatus: 'CERTIFIED',
          newStatus: 'FOR_REVIEW',
          reason: input.reason,
          metadata: {
            payrollCertificationId: certification.id,
            calculationVersion: certification.calculationVersion,
            calculationHash: certification.calculationHash,
          },
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

function requirePermission(context: RequestContext, permission: string, command: string): void {
  if (!holdsAgencyWide(context, permission)) {
    throw new PayrollPeriodsServiceError(
      `${command} needs the ${permission} permission for the whole Agency.`,
      403,
      'PAYROLL_PERIOD_REVIEW_FORBIDDEN',
    );
  }
}

/** The period row, locked FOR UPDATE until the command commits. */
async function lockPeriod(
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

function requireStatus(period: LockedPeriod, status: PayrollPeriodStatus): void {
  if (period.status !== status) {
    throw new PayrollPeriodsServiceError(
      `The Payroll Period is ${period.status}; this command applies only while it is ${status}.`,
      409,
      `PAYROLL_PERIOD_NOT_${status}`,
    );
  }
}

async function claimFunction(
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

async function moveStatus(
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
