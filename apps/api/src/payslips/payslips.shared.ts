import type { Payslip, Prisma } from '@prisma/client';
import { hasPermission, holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { z } from 'zod';
import {
  claimFunction,
  lockPeriod,
  requireStatus,
} from '../payroll-periods/payroll-certification.service';
import { parse } from '../payroll-periods/payroll-periods.service';

export const PAYSLIP_RELEASED = 'PAYSLIP_RELEASED';
export const PAYSLIP_WITHHELD = 'PAYSLIP_WITHHELD';

export class PayslipsServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PayslipsServiceError';
  }
}

/** Withholding, and releasing a WITHHELD Payslip, each give a reason (§5.21). */
export const payslipReasonSchema = z
  .object({ reason: z.string().trim().min(1, 'A reason is required.').max(2000) })
  .strict();

export const parseReason = (rawInput: unknown) => parse(payslipReasonSchema, rawInput).reason;

/** A Payslip as the Payroll Approver's commands return it. */
export interface PayslipView {
  id: string;
  payrollPeriodId: string;
  payrollEmployeeId: string;
  status: string;
  releasedAt: string | null;
  releasedByMembershipId: string | null;
  withheldAt: string | null;
  withheldByMembershipId: string | null;
  withholdReason: string | null;
}

export function toPayslipView(row: Payslip, payrollPeriodId: string): PayslipView {
  return {
    id: row.id,
    payrollPeriodId,
    payrollEmployeeId: row.payrollEmployeeId,
    status: row.status,
    releasedAt: row.releasedAt?.toISOString() ?? null,
    releasedByMembershipId: row.releasedByMembershipId,
    withheldAt: row.withheldAt?.toISOString() ?? null,
    withheldByMembershipId: row.withheldByMembershipId,
    withholdReason: row.withholdReason,
  };
}

/** Release and withhold need their permission for the whole Agency (§6.10). */
export function requireAgencyWide(
  context: RequestContext,
  permission: string,
  command: string,
): void {
  if (!holdsAgencyWide(context, permission)) {
    throw new PayslipsServiceError(
      `${command} needs the ${permission} permission for the whole Agency.`,
      403,
      'PAYSLIP_FORBIDDEN',
    );
  }
}

/** The own read needs its permission at any scope; it never reaches past the caller. */
export function requireHeld(context: RequestContext, permission: string): void {
  if (!hasPermission(context, permission)) {
    throw new PayslipsServiceError(
      `Reading payslips needs the ${permission} permission.`,
      403,
      'PAYSLIP_FORBIDDEN',
    );
  }
}

export const payslipNotFound = () =>
  new PayslipsServiceError('The Payslip could not be found.', 404, 'PAYSLIP_NOT_FOUND');

/**
 * Lock one Payslip for a single-Payslip command, after its period: every
 * payslip command locks the period first, so they serialize with each other
 * and with the period's release. The period must be FINALIZED and the Payslip
 * in `from`; the caller then claims APPROVAL (§5.20).
 */
export async function lockPayslipForCommand(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  payslipId: string,
  from: 'READY' | 'WITHHELD',
): Promise<{ payslip: Payslip; payrollPeriodId: string; employeeId: string }> {
  const [found] = await transaction.$queryRaw<{ payroll_period_id: string; employee_id: string }[]>`
    SELECT r."payroll_period_id", r."employee_id"
    FROM "payslips" s
    JOIN "payroll_employees" r ON r."agency_id" = s."agency_id" AND r."id" = s."payroll_employee_id"
    WHERE s."agency_id" = CAST(${context.agencyId} AS uuid) AND s."id" = CAST(${payslipId} AS uuid)
  `;
  if (!found) throw payslipNotFound();
  requireStatus(await lockPeriod(transaction, context, found.payroll_period_id), 'FINALIZED');
  const [locked] = await transaction.$queryRaw<{ status: string }[]>`
    SELECT "status" FROM "payslips"
    WHERE "agency_id" = CAST(${context.agencyId} AS uuid) AND "id" = CAST(${payslipId} AS uuid)
    FOR UPDATE
  `;
  if (locked?.status !== from) {
    throw new PayslipsServiceError(
      `The Payslip is ${locked?.status ?? 'missing'}; this command applies only while it is ${from}.`,
      409,
      `PAYSLIP_NOT_${from}`,
    );
  }
  await claimFunction(transaction, context, found.payroll_period_id, 'APPROVAL');
  const payslip = await transaction.payslip.findUniqueOrThrow({ where: { id: payslipId } });
  return { payslip, payrollPeriodId: found.payroll_period_id, employeeId: found.employee_id };
}

/** One Audit Event on a Payslip, by the acting person. */
export function payslipAuditEvent(
  context: RequestContext,
  event: {
    action: string;
    payslipId: string;
    previousStatus: string;
    newStatus: string;
    reason: string | null;
    idempotencyKey: string;
    metadata: Prisma.InputJsonObject;
  },
): Prisma.AuditEventCreateManyInput {
  const { payslipId, ...rest } = event;
  return {
    agencyId: context.agencyId,
    actorUserId: context.userId,
    actorMembershipId: context.membershipId,
    actorType: 'USER',
    entityType: 'Payslip',
    entityId: payslipId,
    requestId: context.requestId,
    ...rest,
  };
}

/**
 * The `PAYSLIP_RELEASED` Outbox Event: the notification to the Employee,
 * delivered after the release commits (technical-architecture.md §12).
 */
export interface PayslipReleasedEvent {
  payslipId: string;
  payrollPeriodId: string;
  payrollEmployeeId: string;
  employeeId: string;
}

export function payslipReleasedOutboxEvent(
  context: RequestContext,
  event: PayslipReleasedEvent,
): Prisma.OutboxEventCreateManyInput {
  return {
    agencyId: context.agencyId,
    eventType: PAYSLIP_RELEASED,
    aggregateType: 'Payslip',
    aggregateId: event.payslipId,
    // A Payslip is released once.
    idempotencyKey: 'released',
    payload: { ...event },
  };
}
