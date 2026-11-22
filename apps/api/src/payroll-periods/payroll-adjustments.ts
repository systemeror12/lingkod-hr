import type { Prisma } from '@prisma/client';

/** Why a Payroll Adjustment opens, or a later cause that joins it (payroll-schema.md §10). */
export type PayrollAdjustmentCause =
  | { origin: 'PAYROLL_HOLD'; payrollHoldId: string }
  | { origin: 'RECALCULATION'; reason: string; openedByMembershipId: string };

/**
 * Open the Employee's Payroll Adjustment against a FINALIZED period, or join
 * the OPEN one, and record the cause, in the caller's transaction. The OPEN
 * adjustment is locked first, so a finalization posting it either waits for
 * this cause or has posted it, and then a new adjustment opens. A concurrent
 * open of the same adjustment waits on the one-open index and then joins it.
 */
export async function openPayrollAdjustment(
  transaction: Prisma.TransactionClient,
  request: {
    agencyId: string;
    originalPayrollPeriodId: string;
    employeeId: string;
    cause: PayrollAdjustmentCause;
  },
): Promise<{ payrollAdjustmentId: string; joined: boolean }> {
  const { agencyId, originalPayrollPeriodId, employeeId, cause } = request;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [open] = await transaction.$queryRaw<{ id: string }[]>`
      SELECT "id"::text FROM "payroll_adjustments"
      WHERE "agency_id" = CAST(${agencyId} AS uuid)
        AND "original_payroll_period_id" = CAST(${originalPayrollPeriodId} AS uuid)
        AND "employee_id" = CAST(${employeeId} AS uuid)
        AND "status" = 'OPEN'
      FOR UPDATE
    `;
    let payrollAdjustmentId = open?.id;
    if (!payrollAdjustmentId) {
      const [created] = await transaction.$queryRaw<{ id: string }[]>`
        INSERT INTO "payroll_adjustments"
          ("agency_id", "original_payroll_period_id", "employee_id", "status")
        VALUES (CAST(${agencyId} AS uuid), CAST(${originalPayrollPeriodId} AS uuid),
                CAST(${employeeId} AS uuid), 'OPEN')
        ON CONFLICT ("original_payroll_period_id", "employee_id") WHERE "status" = 'OPEN'
        DO NOTHING
        RETURNING "id"::text
      `;
      // A concurrent open committed first: join it.
      if (!created) continue;
      payrollAdjustmentId = created.id;
    }
    await transaction.payrollAdjustmentCause.create({
      data: {
        agencyId,
        payrollAdjustmentId,
        origin: cause.origin,
        ...(cause.origin === 'PAYROLL_HOLD'
          ? { payrollHoldId: cause.payrollHoldId }
          : { reason: cause.reason, openedByMembershipId: cause.openedByMembershipId }),
      },
    });
    return { payrollAdjustmentId, joined: Boolean(open) };
  }
  throw new Error('The Payroll Adjustment kept changing while a cause was recorded.');
}

/**
 * The periods whose current calculation version, past DRAFT and not yet
 * FINALIZED, carries one of the adjustments: their difference is already
 * calculated, so a cause that joined now would not be counted.
 */
export async function livePayrollsCarrying(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  payrollAdjustmentIds: string[],
): Promise<{ payrollAdjustmentId: string; code: string }[]> {
  if (payrollAdjustmentIds.length === 0) return [];
  return transaction.$queryRaw<{ payrollAdjustmentId: string; code: string }[]>`
    SELECT DISTINCT i."payroll_adjustment_id"::text AS "payrollAdjustmentId", p."code"::text
    FROM "payroll_rule_snapshot_items" i
    JOIN "payroll_rule_snapshots" s
      ON s."agency_id" = i."agency_id" AND s."id" = i."payroll_rule_snapshot_id"
    JOIN "payroll_periods" p
      ON p."agency_id" = s."agency_id" AND p."id" = s."payroll_period_id"
     AND p."calculation_version" = s."calculation_version"
    WHERE i."agency_id" = CAST(${agencyId} AS uuid)
      AND i."payroll_adjustment_id" = ANY(CAST(${payrollAdjustmentIds} AS uuid[]))
      AND p."status" IN ('CALCULATING', 'FOR_REVIEW', 'CERTIFIED', 'APPROVED')
    ORDER BY 2, 1
  `;
}
