import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { AttendancePeriodsService } from '../attendance-periods/attendance-periods.service';
import type { AttendanceDeficitFact } from '../attendance-periods/attendance-periods.types';
import { MandatoryLeaveAssessmentsService } from '../mandatory-leave-assessments/mandatory-leave-assessments.service';
import { PayrollInputsService } from '../payroll-inputs/payroll-inputs.service';
import { convertTableII, TABLE_II_AUTHORITY } from './table-ii';

/** The ledger and Payroll source type of an Attendance Deficit Charge. */
export const DEFICIT_CHARGE_SOURCE_TYPE = 'ATTENDANCE_DEFICIT_CHARGE';
const VACATION_LEAVE_CODE = 'VACATION_LEAVE';
const FAILURE_ACTION = 'ATTENDANCE_DEFICIT_CHARGE_FAILED';
const ZERO = new Prisma.Decimal(0);

export interface UnchargedDeficitFact {
  attendancePayrollFactId: string;
  workDate: string;
  deficitType: 'TARDINESS' | 'UNDERTIME';
  minutes: number;
  expectedMinutes: number;
  /**
   * `FLEXIBLE_HOURS_DEFICIT`, `COMPRESSED_WORKWEEK_DAY`, and
   * `EXPECTED_DUTY_NOT_480` are #654 gaps no authority converts.
   * `NO_VACATION_LEAVE_ACCOUNT` and `NO_VACATION_POLICY_VERSION` clear once HR
   * opens or activates them. Otherwise the code is the last Payroll refusal,
   * or `NOT_YET_CHARGED`. A rerun charges the fact once its gap is resolved.
   */
  reason: { code: string; message: string };
}

export interface AttendanceDeficitChargeSummary {
  id: string;
  attendancePayrollFactId: string;
  workDate: string;
  deficitType: 'TARDINESS' | 'UNDERTIME';
  deficitMinutes: number;
  expectedMinutes: number;
  leaveAccountId: string;
  policyVersionId: string;
  convertedQuantity: string;
  chargedQuantity: string;
  unpaidQuantity: string;
  leaveLedgerEntryId: string | null;
  payrollInputId: string | null;
  supersedesChargeId: string | null;
  createdAt: string;
}

export interface EmployeeDeficitCharges {
  employeeId: string;
  charges: AttendanceDeficitChargeSummary[];
  uncharged: UnchargedDeficitFact[];
  /** Set when this run's Payroll answer rolled the Employee's charges back. */
  failure: { code: string; reason: string } | null;
}

export interface PublicationDeficitCharges {
  attendancePayrollPublicationId: string;
  employees: EmployeeDeficitCharges[];
}

export class AttendanceDeficitChargeServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'AttendanceDeficitChargeServiceError';
  }
}

/** Who runs a charge: a User rerunning it, or the outbox consumer with none. */
export interface DeficitChargeActor {
  agencyId: string;
  requestId: string;
  userId: string | null;
  membershipId: string | null;
}

/** Payroll refused an effect; the Employee's transaction rolls back. */
class PayrollRefusal extends Error {
  constructor(
    readonly code: string,
    readonly reason: string,
  ) {
    super(reason);
  }
}

type ChargeRecord = Prisma.AttendanceDeficitChargeGetPayload<object>;

interface VacationAccount {
  id: string;
  leaveTypeId: string;
  openedAt: Date;
}

/**
 * Charges tardiness and undertime to vacation leave (ADR 0012, MC41 section
 * 34). Each TARDINESS or UNDERTIME Attendance Payroll Fact gets one immutable
 * Attendance Deficit Charge, decided under the vacation Leave Account lock in
 * Work Date order. The covered part is one negative ledger entry; the Unpaid
 * Deficit Remainder is one Payroll Input in the same transaction. Only an
 * adjustment publication replaces a charge.
 */
@Injectable()
export class AttendanceDeficitChargesService {
  constructor(
    @Inject(AttendancePeriodsService) private readonly attendance: AttendancePeriodsService,
    @Inject(PayrollInputsService) private readonly payroll: PayrollInputsService,
    @Inject(MandatoryLeaveAssessmentsService)
    private readonly mandatoryLeave: MandatoryLeaveAssessmentsService,
  ) {}

  /** A User's rerun of one publication's charge (`leave.deficit_charges.run`). */
  async run(context: RequestContext, publicationId: string): Promise<PublicationDeficitCharges> {
    this.assertAgencyWide(context, 'leave.deficit_charges.run');
    return this.chargePublication(
      {
        agencyId: context.agencyId,
        requestId: context.requestId,
        userId: context.userId,
        membershipId: context.membershipId,
      },
      publicationId,
    );
  }

  /** One publication's charges and uncharged facts per Employee (`leave.deficit_charges.read`). */
  async read(context: RequestContext, publicationId: string): Promise<PublicationDeficitCharges> {
    this.assertAgencyWide(context, 'leave.deficit_charges.read');
    return withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      this.reportInTransaction(transaction, context.agencyId, publicationId),
    );
  }

  /**
   * Payroll's read for its blocking exception (#341): each Employee of the
   * publication with a fact that is owed a charge and has none, with the
   * reason. Runs in the caller's Agency transaction.
   */
  async unchargedFactsInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    publicationId: string,
  ): Promise<Array<{ employeeId: string; uncharged: UnchargedDeficitFact[] }>> {
    const report = await this.reportInTransaction(transaction, agencyId, publicationId);
    return report.employees
      .filter((employee) => employee.uncharged.length > 0)
      .map(({ employeeId, uncharged }) => ({ employeeId, uncharged }));
  }

  /**
   * Charge every Employee of one publication, each in its own transaction.
   * Idempotent: a charged fact is returned as it is, and a fact that could not
   * be charged is tried again.
   */
  async chargePublication(
    actor: DeficitChargeActor,
    publicationId: string,
  ): Promise<PublicationDeficitCharges> {
    const read = await withDatabaseContext({ agencyId: actor.agencyId }, (transaction) =>
      this.attendance.deficitFactsInTransaction(transaction, actor.agencyId, publicationId),
    );
    if (!read) throw publicationNotFound();
    const employees: EmployeeDeficitCharges[] = [];
    for (const [employeeId, facts] of groupByEmployee(read.facts)) {
      try {
        employees.push(
          await withDatabaseContext(databaseContext(actor), (transaction) =>
            this.chargeEmployee(transaction, actor, publicationId, employeeId, facts),
          ),
        );
      } catch (error: unknown) {
        if (!(error instanceof PayrollRefusal)) throw error;
        const failure = { code: error.code, reason: error.reason };
        employees.push(
          await withDatabaseContext(databaseContext(actor), async (transaction) => {
            await transaction.auditEvent.create({
              data: {
                ...auditActor(actor),
                action: FAILURE_ACTION,
                entityType: 'AttendancePayrollPublication',
                entityId: publicationId,
                reason: error.reason,
                metadata: { employeeId, ...failure },
              },
            });
            const report = await this.employeeReport(
              transaction,
              actor.agencyId,
              publicationId,
              employeeId,
              facts,
            );
            return { ...report, failure };
          }),
        );
      }
    }
    return { attendancePayrollPublicationId: publicationId, employees };
  }

  private async chargeEmployee(
    transaction: Prisma.TransactionClient,
    actor: DeficitChargeActor,
    publicationId: string,
    employeeId: string,
    facts: readonly AttendanceDeficitFact[],
  ): Promise<EmployeeDeficitCharges> {
    const { agencyId } = actor;
    const account = await this.vacationAccount(transaction, agencyId, employeeId);
    // The account lock serializes every charge and posting on the balance, so
    // a concurrent run of the same publication waits here and then finds the
    // charges this one committed.
    if (account) await lockAccount(transaction, agencyId, account.id);
    const known = await this.chargesFor(transaction, agencyId, facts);
    const posted: { leaveAccountId: string; effectiveDate: Date }[] = [];
    const charges: AttendanceDeficitChargeSummary[] = [];
    const uncharged: UnchargedDeficitFact[] = [];

    for (const fact of facts) {
      const existing = known.byFact.get(fact.id);
      if (existing) {
        charges.push(chargeSummary(existing));
        continue;
      }
      const predecessor = known.headOf(fact);
      const owed = owedCharge(fact, predecessor);
      if (!owed) continue;
      const policyVersionId = account
        ? await this.policyVersionOn(transaction, agencyId, account.leaveTypeId, fact.workDate)
        : null;
      const gap = dutyGap(fact) ?? accountGap(fact, account, policyVersionId);
      if (gap || !account || !policyVersionId) {
        uncharged.push(uncharge(fact, gap ?? notYetCharged()));
        continue;
      }

      const chargeId = randomUUID();
      if (predecessor && predecessor.leaveAccountId !== account.id) {
        await lockAccount(transaction, agencyId, predecessor.leaveAccountId);
      }
      if (predecessor?.leaveLedgerEntryId) {
        await transaction.leaveLedgerEntry.create({
          data: {
            agencyId,
            leaveAccountId: predecessor.leaveAccountId,
            quantity: predecessor.chargedQuantity,
            effectiveDate: predecessor.workDate,
            sourceType: DEFICIT_CHARGE_SOURCE_TYPE,
            sourceId: chargeId,
            sourcePostingKey: 'REVERSAL',
            policyVersionId: predecessor.policyVersionId,
            reversesEntryId: predecessor.leaveLedgerEntryId,
            postedByMembershipId: actor.membershipId,
          },
        });
        posted.push({
          leaveAccountId: predecessor.leaveAccountId,
          effectiveDate: predecessor.workDate,
        });
      }
      if (predecessor?.payrollInputId) {
        const answer = await this.payroll.withdrawInTransaction(transaction, {
          agencyId,
          sourceModule: 'LEAVE',
          payrollInputId: predecessor.payrollInputId,
          // The correcting fact names this correction, as it keys the replacement.
          correctionKey: `${DEFICIT_CHARGE_SOURCE_TYPE}:${fact.id}`,
        });
        if (!('payrollInputId' in answer)) throw new PayrollRefusal(answer.code, answer.reason);
      }

      const workDate = toDatabaseDate(fact.workDate);
      const conversion = convertTableII(fact.correctedMinutes);
      const converted = new Prisma.Decimal(conversion.quantity);
      const available = await this.availableCredits(transaction, agencyId, account.id, workDate);
      const charged = Prisma.Decimal.min(converted, floorThousandths(available));
      const unpaid = converted.minus(charged);

      let leaveLedgerEntryId: string | null = null;
      if (charged.greaterThan(0)) {
        const entry = await transaction.leaveLedgerEntry.create({
          data: {
            agencyId,
            leaveAccountId: account.id,
            quantity: charged.negated(),
            effectiveDate: workDate,
            sourceType: DEFICIT_CHARGE_SOURCE_TYPE,
            sourceId: chargeId,
            sourcePostingKey: 'CHARGE',
            policyVersionId,
            postedByMembershipId: actor.membershipId,
          },
          select: { id: true },
        });
        leaveLedgerEntryId = entry.id;
        posted.push({ leaveAccountId: account.id, effectiveDate: workDate });
      }

      let payrollInputId: string | null = null;
      if (unpaid.greaterThan(0)) {
        const answer = await this.payroll.acceptInTransaction(transaction, {
          agencyId,
          employeeId,
          sourceModule: 'LEAVE',
          inputKind: 'UNPAID_DEFICIT_REMAINDER',
          sourceKey: `${DEFICIT_CHARGE_SOURCE_TYPE}:${fact.id}`,
          sourceType: 'AttendanceDeficitCharge',
          sourceId: chargeId,
          effectiveDate: fact.workDate,
          quantity: unpaid.toFixed(3),
          replacesPayrollInputId: predecessor?.payrollInputId ?? null,
          payload: {
            attendanceDeficitChargeId: chargeId,
            attendancePayrollPublicationId: publicationId,
            attendancePayrollFactId: fact.id,
            workDate: fact.workDate,
            deficitType: fact.factType,
            deficitMinutes: fact.correctedMinutes,
            expectedMinutes: fact.expectedMinutes,
            conversion: {
              authority: TABLE_II_AUTHORITY,
              hoursRow: thousandths(conversion.hoursThousandths),
              minutesRow: thousandths(conversion.minutesThousandths),
              convertedQuantity: conversion.quantity,
            },
            chargedQuantity: charged.toFixed(3),
            unpaidQuantity: unpaid.toFixed(3),
            leaveAccountId: account.id,
            supersedesChargeId: predecessor?.id ?? null,
          },
        });
        if (!('payrollInputId' in answer)) throw new PayrollRefusal(answer.code, answer.reason);
        payrollInputId = answer.payrollInputId;
      }

      const charge = await transaction.attendanceDeficitCharge.create({
        data: {
          id: chargeId,
          agencyId,
          employeeId,
          attendancePayrollFactId: fact.id,
          workDate,
          deficitType: fact.factType,
          deficitMinutes: fact.correctedMinutes,
          expectedMinutes: fact.expectedMinutes,
          leaveAccountId: account.id,
          policyVersionId,
          convertedQuantity: converted,
          chargedQuantity: charged,
          unpaidQuantity: unpaid,
          leaveLedgerEntryId,
          payrollInputId,
          supersedesChargeId: predecessor?.id ?? null,
        },
      });
      known.add(charge);
      charges.push(chargeSummary(charge));
      await transaction.auditEvent.create({
        data: {
          ...auditActor(actor),
          action: 'ATTENDANCE_DEFICIT_CHARGED',
          entityType: 'AttendanceDeficitCharge',
          entityId: chargeId,
          newStatus: 'CHARGED',
          metadata: {
            attendancePayrollPublicationId: publicationId,
            attendancePayrollFactId: fact.id,
            employeeId,
            workDate: fact.workDate,
            deficitType: fact.factType,
            deficitMinutes: fact.correctedMinutes,
            authority: TABLE_II_AUTHORITY,
            convertedQuantity: conversion.quantity,
            chargedQuantity: charged.toFixed(3),
            unpaidQuantity: unpaid.toFixed(3),
            leaveLedgerEntryId,
            payrollInputId,
            supersedesChargeId: predecessor?.id ?? null,
            withdrawnPayrollInputId: predecessor?.payrollInputId ?? null,
          },
        },
      });
    }

    if (posted.length) {
      await this.mandatoryLeave.reevaluateLeaveAccounts(
        transaction,
        mandatoryLeaveContext(actor),
        posted,
      );
    }
    return { employeeId, charges, uncharged, failure: null };
  }

  private async reportInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    publicationId: string,
  ): Promise<PublicationDeficitCharges> {
    const read = await this.attendance.deficitFactsInTransaction(
      transaction,
      agencyId,
      publicationId,
    );
    if (!read) throw publicationNotFound();
    const employees: EmployeeDeficitCharges[] = [];
    for (const [employeeId, facts] of groupByEmployee(read.facts)) {
      employees.push(
        await this.employeeReport(transaction, agencyId, publicationId, employeeId, facts),
      );
    }
    return { attendancePayrollPublicationId: publicationId, employees };
  }

  /** The same decisions `chargeEmployee` makes, without writing. */
  private async employeeReport(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    publicationId: string,
    employeeId: string,
    facts: readonly AttendanceDeficitFact[],
  ): Promise<EmployeeDeficitCharges> {
    const account = await this.vacationAccount(transaction, agencyId, employeeId);
    const known = await this.chargesFor(transaction, agencyId, facts);
    const lastFailure = await transaction.auditEvent.findFirst({
      where: {
        agencyId,
        action: FAILURE_ACTION,
        entityType: 'AttendancePayrollPublication',
        entityId: publicationId,
        metadata: { path: ['employeeId'], equals: employeeId },
      },
      orderBy: { occurredAt: 'desc' },
      select: { metadata: true },
    });
    const charges: AttendanceDeficitChargeSummary[] = [];
    const uncharged: UnchargedDeficitFact[] = [];
    for (const fact of facts) {
      const existing = known.byFact.get(fact.id);
      if (existing) {
        charges.push(chargeSummary(existing));
        continue;
      }
      if (!owedCharge(fact, known.headOf(fact))) continue;
      const policyVersionId = account
        ? await this.policyVersionOn(transaction, agencyId, account.leaveTypeId, fact.workDate)
        : null;
      const gap = dutyGap(fact) ?? accountGap(fact, account, policyVersionId);
      uncharged.push(
        uncharge(fact, gap ?? failureReason(lastFailure?.metadata) ?? notYetCharged()),
      );
    }
    return { employeeId, charges, uncharged, failure: null };
  }

  /** The Employee's active vacation Leave Account, if any. */
  private async vacationAccount(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
  ): Promise<VacationAccount | null> {
    return transaction.leaveAccount.findFirst({
      where: { agencyId, employeeId, status: 'ACTIVE', leaveType: { code: VACATION_LEAVE_CODE } },
      select: { id: true, leaveTypeId: true, openedAt: true },
    });
  }

  private async policyVersionOn(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    leaveTypeId: string,
    workDate: string,
  ): Promise<string | null> {
    const date = toDatabaseDate(workDate);
    const version = await transaction.leavePolicyVersion.findFirst({
      where: {
        agencyId,
        leaveTypeId,
        status: { in: ['ACTIVE', 'SUPERSEDED'] },
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: { id: true },
    });
    return version?.id ?? null;
  }

  /**
   * The facts' own charges and those of their earlier facts. `headOf` is the
   * live charge of the same economic fact: the one no later charge replaced.
   */
  private async chargesFor(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    facts: readonly AttendanceDeficitFact[],
  ) {
    const factIds = facts.flatMap((fact) => [fact.id, ...fact.earlierFactIds]);
    const rows = factIds.length
      ? await transaction.attendanceDeficitCharge.findMany({
          where: { agencyId, attendancePayrollFactId: { in: [...new Set(factIds)] } },
        })
      : [];
    const byFact = new Map(rows.map((row) => [row.attendancePayrollFactId, row]));
    const replaced = new Set(
      rows.flatMap((row) => (row.supersedesChargeId ? [row.supersedesChargeId] : [])),
    );
    return {
      byFact,
      add(charge: ChargeRecord) {
        byFact.set(charge.attendancePayrollFactId, charge);
        if (charge.supersedesChargeId) replaced.add(charge.supersedesChargeId);
      },
      headOf(fact: AttendanceDeficitFact): ChargeRecord | null {
        for (const factId of [...fact.earlierFactIds].reverse()) {
          const charge = byFact.get(factId);
          if (charge && !replaced.has(charge.id)) return charge;
        }
        return null;
      },
    };
  }

  /**
   * The posted balance as of the Work Date, or the current posted balance when
   * lower, less active Leave Credit Commitments (ADR 0012).
   */
  private async availableCredits(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    leaveAccountId: string,
    workDate: Date,
  ): Promise<Prisma.Decimal> {
    const today = toDatabaseDate(manilaToday());
    const [asOfWorkDate, current, committed] = await Promise.all([
      transaction.leaveLedgerEntry.aggregate({
        where: { agencyId, leaveAccountId, effectiveDate: { lte: workDate } },
        _sum: { quantity: true },
      }),
      transaction.leaveLedgerEntry.aggregate({
        where: { agencyId, leaveAccountId, effectiveDate: { lte: today } },
        _sum: { quantity: true },
      }),
      transaction.leaveCreditCommitment.aggregate({
        where: { agencyId, leaveAccountId, status: 'ACTIVE' },
        _sum: { quantity: true },
      }),
    ]);
    const posted = Prisma.Decimal.min(
      asOfWorkDate._sum.quantity ?? ZERO,
      current._sum.quantity ?? ZERO,
    );
    return Prisma.Decimal.max(posted.minus(committed._sum.quantity ?? ZERO), ZERO);
  }

  private assertAgencyWide(context: RequestContext, permission: string): void {
    if (!holdsAgencyWide(context, permission)) {
      throw new AttendanceDeficitChargeServiceError(
        `This needs the ${permission} permission for the whole Agency.`,
        403,
        'ATTENDANCE_DEFICIT_CHARGE_FORBIDDEN',
      );
    }
  }
}

/**
 * Whether a fact is owed a charge now: a later publication has not replaced
 * it, and it has minutes or an earlier charge to correct to zero.
 */
function owedCharge(fact: AttendanceDeficitFact, predecessor: ChargeRecord | null): boolean {
  if (fact.supersededByLaterFact) return false;
  return fact.correctedMinutes > 0 || predecessor !== null;
}

/**
 * The #654 gaps: Table II converts only a 480-minute day, and no text converts
 * tardiness or undertime on a flexible-hours day, a 600-minute compressed
 * workweek day, a part-time day, or any other duty.
 */
function dutyGap(fact: AttendanceDeficitFact): UnchargedDeficitFact['reason'] | null {
  if (fact.dayRuleType === 'FLEXIBLE' || fact.scheduleType === 'FLEXIBLE') {
    return {
      code: 'FLEXIBLE_HOURS_DEFICIT',
      message:
        'MC 41 section 30 converts absence incurred on flexible hours, not tardiness or undertime; no authority converts this fact (#654).',
    };
  }
  if (fact.expectedMinutes === 480) return null;
  if (fact.scheduleType === 'COMPRESSED' && fact.expectedMinutes === 600) {
    return {
      code: 'COMPRESSED_WORKWEEK_DAY',
      message:
        'MC 6 s. 2026 section V.B.2.6 states no divisor for late or undertime minutes on a 600-minute compressed-workweek day (#654).',
    };
  }
  return {
    code: 'EXPECTED_DUTY_NOT_480',
    message: `Table II covers only a 480-minute day; no authority converts a ${fact.expectedMinutes}-minute day, part-time or otherwise (#654).`,
  };
}

function accountGap(
  fact: AttendanceDeficitFact,
  account: VacationAccount | null,
  policyVersionId: string | null,
): UnchargedDeficitFact['reason'] | null {
  if (!account || account.openedAt > toDatabaseDate(fact.workDate)) {
    return {
      code: 'NO_VACATION_LEAVE_ACCOUNT',
      message: 'The Employee has no active vacation Leave Account open on the Work Date.',
    };
  }
  if (!policyVersionId) {
    return {
      code: 'NO_VACATION_POLICY_VERSION',
      message: 'No vacation Leave Policy Version is effective on the Work Date.',
    };
  }
  return null;
}

function notYetCharged(): UnchargedDeficitFact['reason'] {
  return { code: 'NOT_YET_CHARGED', message: 'The charge has not run for this fact yet.' };
}

function failureReason(
  metadata: Prisma.JsonValue | undefined,
): UnchargedDeficitFact['reason'] | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const { code, reason } = metadata;
  return typeof code === 'string' && typeof reason === 'string' ? { code, message: reason } : null;
}

function uncharge(
  fact: AttendanceDeficitFact,
  reason: UnchargedDeficitFact['reason'],
): UnchargedDeficitFact {
  return {
    attendancePayrollFactId: fact.id,
    workDate: fact.workDate,
    deficitType: fact.factType,
    minutes: fact.correctedMinutes,
    expectedMinutes: fact.expectedMinutes,
    reason,
  };
}

/** Facts by Employee, each in Work Date order. */
function groupByEmployee(
  facts: readonly AttendanceDeficitFact[],
): Map<string, AttendanceDeficitFact[]> {
  const groups = new Map<string, AttendanceDeficitFact[]>();
  for (const fact of facts) {
    const group = groups.get(fact.employeeId) ?? [];
    group.push(fact);
    groups.set(fact.employeeId, group);
  }
  for (const group of groups.values()) {
    group.sort(
      (left, right) =>
        left.workDate.localeCompare(right.workDate) ||
        left.stableSourceKey.localeCompare(right.stableSourceKey),
    );
  }
  return new Map([...groups].sort(([left], [right]) => left.localeCompare(right)));
}

function chargeSummary(record: ChargeRecord): AttendanceDeficitChargeSummary {
  return {
    id: record.id,
    attendancePayrollFactId: record.attendancePayrollFactId,
    workDate: formatDate(record.workDate),
    deficitType: record.deficitType as 'TARDINESS' | 'UNDERTIME',
    deficitMinutes: record.deficitMinutes,
    expectedMinutes: record.expectedMinutes,
    leaveAccountId: record.leaveAccountId,
    policyVersionId: record.policyVersionId,
    convertedQuantity: record.convertedQuantity.toFixed(3),
    chargedQuantity: record.chargedQuantity.toFixed(3),
    unpaidQuantity: record.unpaidQuantity.toFixed(3),
    leaveLedgerEntryId: record.leaveLedgerEntryId,
    payrollInputId: record.payrollInputId,
    supersedesChargeId: record.supersedesChargeId,
    createdAt: record.createdAt.toISOString(),
  };
}

async function lockAccount(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  accountId: string,
): Promise<void> {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "leave_accounts" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${accountId} AS uuid) FOR NO KEY UPDATE`,
  );
}

function databaseContext(actor: DeficitChargeActor) {
  return {
    agencyId: actor.agencyId,
    ...(actor.userId ? { userId: actor.userId } : {}),
    ...(actor.membershipId ? { membershipId: actor.membershipId } : {}),
  };
}

function auditActor(actor: DeficitChargeActor) {
  return {
    agencyId: actor.agencyId,
    actorUserId: actor.userId,
    actorMembershipId: actor.membershipId,
    actorType: actor.userId ? 'USER' : 'SYSTEM',
    requestId: actor.requestId,
  };
}

/**
 * Mandatory Leave re-evaluation takes a RequestContext for its audit actor.
 * The outbox consumer has no User, so its events carry no actor identifiers.
 */
function mandatoryLeaveContext(actor: DeficitChargeActor): RequestContext {
  return {
    requestId: actor.requestId,
    agencyId: actor.agencyId,
    userId: actor.userId as string,
    membershipId: actor.membershipId as string,
    primaryOrganizationUnitId: null,
    permissions: [],
  };
}

/** Credits are charged in Table II's thousandths, never past what is available. */
function floorThousandths(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(3, Prisma.Decimal.ROUND_FLOOR);
}

function thousandths(value: number): string {
  return (value / 1000).toFixed(3);
}

function toDatabaseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function manilaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function publicationNotFound(): AttendanceDeficitChargeServiceError {
  return new AttendanceDeficitChargeServiceError(
    'The Attendance Payroll Publication could not be found.',
    404,
    'ATTENDANCE_PAYROLL_PUBLICATION_NOT_FOUND',
  );
}
