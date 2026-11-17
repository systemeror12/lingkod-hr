import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { createHash } from 'node:crypto';
import { requestDatabaseContext } from '../database-context';
import { canonicalJson } from '../payroll-calculation/calculation-hash';
import {
  classifyPayrollExport,
  PayrollExportReconciliationError,
} from './payroll-export-reconciliation';
import { PayrollPeriodsServiceError } from './payroll-periods.service';

/** The contract version this code renders; migration 0178 defines it. */
export const CERTIFIED_PAYROLL_REVIEW_EXPORT_CONTRACT = {
  code: 'CERTIFIED_PAYROLL_REVIEW_EXPORT',
  version: 1,
} as const;

/** Contract version 1's statement, verbatim: the export asserts no external state (#29). */
export const CERTIFIED_PAYROLL_REVIEW_EXPORT_STATEMENT =
  'This Structured Export is HRIS payroll data from one certified payroll snapshot. It does not assert that funds were validated or obligated, that an accounting entry was posted, or that a receiving system accepted the data.';

export interface CertifiedPayrollReviewExportView {
  id: string;
  payrollPeriodId: string;
  payrollCertificationId: string;
  /** The exact artifact bytes, as canonical JSON; `contract` inside names its version. */
  content: string;
  /** SHA-256 hex of `content`. */
  checksum: string;
  generatedByMembershipId: string;
  generatedAt: string;
  supersededAt: string | null;
}

const exportSelect = {
  id: true,
  payrollPeriodId: true,
  payrollCertificationId: true,
  content: true,
  checksum: true,
  generatedByMembershipId: true,
  generatedAt: true,
  supersededAt: true,
} satisfies Prisma.CertifiedPayrollReviewExportSelect;

type ExportRow = Prisma.CertifiedPayrollReviewExportGetPayload<{ select: typeof exportSelect }>;

/**
 * Generate the Certified Payroll Review Export (#29, #636) of the Payroll
 * Certification in force, inside the caller's transaction. `Certify HR
 * inputs` calls it right after it records the certification and moves the
 * period to CERTIFIED, so the export exists the moment the period does
 * (mvp-workflows.md, payroll lifecycle).
 *
 * It classifies every Payroll Line of the certified calculation version and
 * proves the Payroll Export Reconciliation. A failure throws
 * `PAYROLL_EXPORT_RECONCILIATION_FAILED`, so the caller's transaction, and the
 * certification with it, stores nothing. It is idempotent for one
 * certification: when the certification already has an export, it returns
 * that stored row. The period lock orders it against a revocation and a
 * concurrent call. Revoking the certification supersedes the export.
 */
export async function generateReviewExport(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
): Promise<CertifiedPayrollReviewExportView> {
  const [period] = await transaction.$queryRaw<
    {
      code: string;
      run_type: string;
      period_from: string;
      period_to: string;
      payment_date: string;
      status: string;
    }[]
  >`
    SELECT "code", "run_type", "period_from"::text AS "period_from",
           "period_to"::text AS "period_to", "payment_date"::text AS "payment_date", "status"
    FROM "payroll_periods"
    WHERE "agency_id" = CAST(${context.agencyId} AS uuid)
      AND "id" = CAST(${periodId} AS uuid)
    FOR UPDATE
  `;
  if (!period) {
    throw new PayrollPeriodsServiceError(
      'The Payroll Period could not be found.',
      404,
      'PAYROLL_PERIOD_NOT_FOUND',
    );
  }
  const certification = await transaction.payrollCertification.findFirst({
    where: { agencyId: context.agencyId, payrollPeriodId: periodId, revokedAt: null },
    select: { id: true, calculationVersion: true, calculationHash: true, certifiedAt: true },
  });
  if (!certification || !['CERTIFIED', 'APPROVED'].includes(period.status)) {
    throw new PayrollPeriodsServiceError(
      `The Payroll Period is ${period.status}; a Certified Payroll Review Export is generated only from the certification in force.`,
      409,
      'PAYROLL_PERIOD_NOT_CERTIFIED',
    );
  }

  const stored = await transaction.certifiedPayrollReviewExport.findUnique({
    where: { payrollCertificationId: certification.id },
    select: exportSelect,
  });
  if (stored) return toView(stored);

  const contract = await transaction.payrollExportContractVersion.findUniqueOrThrow({
    where: { code_version: CERTIFIED_PAYROLL_REVIEW_EXPORT_CONTRACT },
    select: { id: true },
  });
  const scope = {
    agencyId: context.agencyId,
    payrollPeriodId: periodId,
    calculationVersion: certification.calculationVersion,
  };
  const results = await transaction.payrollEmployee.findMany({
    where: scope,
    select: {
      id: true,
      employeeId: true,
      calculationHash: true,
      grossAmount: true,
      totalDeductions: true,
      netAmount: true,
    },
  });
  const lines = await transaction.payrollLine.findMany({
    where: { agencyId: context.agencyId, payrollEmployee: scope },
    select: {
      id: true,
      payrollEmployeeId: true,
      payComponentId: true,
      lineType: true,
      amount: true,
    },
  });
  const components = await transaction.payComponent.findMany({
    where: { id: { in: [...new Set(lines.map((line) => line.payComponentId))] } },
    select: { id: true, code: true, name: true, category: true, reportingCategory: true },
  });

  let classified;
  try {
    classified = classifyPayrollExport({
      expectedCalculationHash: certification.calculationHash,
      results: results.map((result) => ({
        ...result,
        grossAmount: result.grossAmount.toString(),
        totalDeductions: result.totalDeductions.toString(),
        netAmount: result.netAmount.toString(),
      })),
      lines: lines.map((line) => ({ ...line, amount: line.amount.toString() })),
      components,
    });
  } catch (error: unknown) {
    if (error instanceof PayrollExportReconciliationError) {
      throw new PayrollPeriodsServiceError(
        error.message,
        409,
        'PAYROLL_EXPORT_RECONCILIATION_FAILED',
      );
    }
    throw error;
  }

  const content = canonicalJson({
    contract: CERTIFIED_PAYROLL_REVIEW_EXPORT_CONTRACT,
    statement: CERTIFIED_PAYROLL_REVIEW_EXPORT_STATEMENT,
    agencyId: context.agencyId,
    payrollPeriod: {
      id: periodId,
      code: period.code,
      runType: period.run_type,
      periodFrom: period.period_from,
      periodTo: period.period_to,
      paymentDate: period.payment_date,
    },
    certification: {
      id: certification.id,
      calculationVersion: certification.calculationVersion,
      calculationHash: certification.calculationHash,
      certifiedAt: certification.certifiedAt.toISOString(),
    },
    ...classified,
  });
  const created = await transaction.certifiedPayrollReviewExport.create({
    data: {
      agencyId: context.agencyId,
      payrollPeriodId: periodId,
      payrollCertificationId: certification.id,
      payrollExportContractVersionId: contract.id,
      content,
      checksum: createHash('sha256').update(content, 'utf8').digest('hex'),
      generatedByMembershipId: context.membershipId,
    },
    select: exportSelect,
  });
  return toView(created);
}

/** Reads Certified Payroll Review Exports, current or superseded (`payroll.periods.read`). */
@Injectable()
export class PayrollReviewExportService {
  /** Read one export of the Agency, current or superseded. */
  async read(
    context: RequestContext,
    periodId: string,
    exportId: string,
  ): Promise<CertifiedPayrollReviewExportView> {
    requireRead(context);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const row = await transaction.certifiedPayrollReviewExport.findFirst({
        where: { agencyId: context.agencyId, payrollPeriodId: periodId, id: exportId },
        select: exportSelect,
      });
      if (!row) {
        throw new PayrollPeriodsServiceError(
          'The Certified Payroll Review Export could not be found.',
          404,
          'PAYROLL_REVIEW_EXPORT_NOT_FOUND',
        );
      }
      return toView(row);
    });
  }
}

/**
 * Supersede the current export of a certification being revoked, in the
 * revoking transaction. Returns the superseded export's id, or null when none
 * was generated.
 */
export async function supersedeReviewExport(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  payrollCertificationId: string,
): Promise<string | null> {
  const current = await transaction.certifiedPayrollReviewExport.findFirst({
    where: { agencyId, payrollCertificationId, supersededAt: null },
    select: { id: true },
  });
  if (!current) return null;
  await transaction.certifiedPayrollReviewExport.update({
    where: { id: current.id },
    data: { supersededAt: new Date() },
  });
  return current.id;
}

function requireRead(context: RequestContext): void {
  if (!holdsAgencyWide(context, 'payroll.periods.read')) {
    throw new PayrollPeriodsServiceError(
      'Reading a Certified Payroll Review Export needs the payroll.periods.read permission for the whole Agency.',
      403,
      'PAYROLL_REVIEW_EXPORT_FORBIDDEN',
    );
  }
}

function toView(row: ExportRow): CertifiedPayrollReviewExportView {
  return {
    id: row.id,
    payrollPeriodId: row.payrollPeriodId,
    payrollCertificationId: row.payrollCertificationId,
    content: row.content,
    checksum: row.checksum,
    generatedByMembershipId: row.generatedByMembershipId,
    generatedAt: row.generatedAt.toISOString(),
    supersededAt: row.supersededAt?.toISOString() ?? null,
  };
}
