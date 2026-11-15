import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { afterAll, expect, it } from 'vitest';
import { AttendancePeriodsService } from '../attendance-periods/attendance-periods.service';
import {
  mandatoryLeaveAssessmentAuditWriter,
  MandatoryLeaveAssessmentsService,
} from '../mandatory-leave-assessments/mandatory-leave-assessments.service';
import { PayrollInputsService } from '../payroll-inputs/payroll-inputs.service';
import { deficitChargeAgencyIds, duePublicationIds } from './attendance-deficit-charges.consumer';
import {
  AttendanceDeficitChargesService,
  type PublicationDeficitCharges,
} from './attendance-deficit-charges.service';

const enabled = process.env.DATABASE_E2E === 'true';
const tenants: { agency: { id: string }; user: { id: string } }[] = [];
let adminClient: PrismaClient | undefined;

async function admin(): Promise<PrismaClient> {
  if (adminClient) return adminClient;
  const databaseUrl =
    process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!databaseUrl) throw new Error('A database owner URL is required for the integration test.');
  adminClient = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  return adminClient;
}

/**
 * Fixture rows stand in for a locked Attendance Period and opened Leave
 * Accounts. They are written with triggers off, so their upstream approval
 * and authority rows need not exist; every row the charge writes goes through
 * the live triggers, constraints, and RLS.
 */
async function seed<T>(run: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return (await admin()).$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    return run(transaction);
  });
}

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

async function createTenant(label: string) {
  const db = await admin();
  const suffix = `${Date.now()}-${label}-${randomUUID().slice(0, 8)}`;
  const agency = await db.agency.create({
    data: {
      code: `ADC-${suffix}`,
      name: `Deficit ${label} Agency`,
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await db.user.create({
    data: {
      emailNormalized: `deficit-${suffix}@example.test`,
      displayName: `Deficit ${label} User`,
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await db.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const { leaveTypeId, policyVersionId, periodId } = await seed(async (transaction) => {
    const leaveType = await transaction.leaveType.create({
      data: {
        agencyId: agency.id,
        code: 'VACATION_LEAVE',
        name: 'Vacation Leave',
        status: 'ACTIVE',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const policy = await transaction.leavePolicyVersion.create({
      data: {
        agencyId: agency.id,
        leaveTypeId: leaveType.id,
        versionNo: 1,
        entitlementBasis: 'ACCRUED_ACCOUNT',
        calendarBasis: 'WORKING_DAY',
        evaluatorKind: 'SERVICE_ACCRUAL',
        approvalRouteCode: 'LEAVE',
        effectiveFrom: date('2026-01-01'),
        status: 'ACTIVE',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const period = await transaction.attendancePeriod.create({
      data: {
        agencyId: agency.id,
        code: `P-${suffix}`,
        dateFrom: date('2026-11-01'),
        dateTo: date('2026-11-15'),
        status: 'FINALIZED',
      },
    });
    return { leaveTypeId: leaveType.id, policyVersionId: policy.id, periodId: period.id };
  });
  const tenant = {
    agency,
    user,
    membership,
    suffix,
    leaveTypeId,
    policyVersionId,
    periodId,
    publications: 0,
  };
  tenants.push(tenant);
  return tenant;
}

type Tenant = Awaited<ReturnType<typeof createTenant>>;

async function addEmployee(tenant: Tenant, label: string) {
  return (await admin()).employee.create({
    data: {
      agencyId: tenant.agency.id,
      employeeNumber: `EMP-${label}-${tenant.suffix}`,
      legalName: `Employee ${label}`,
      birthDate: new Date('1990-01-01'),
      sex: 'FEMALE',
      civilStatus: 'SINGLE',
      contactEmail: `deficit-${label}-${tenant.suffix}@example.test`,
      serviceStatus: 'ACTIVE',
      createdByMembershipId: tenant.membership.id,
      updatedByMembershipId: tenant.membership.id,
    },
  });
}

/** Open a vacation Leave Account with a posted opening balance and an optional commitment. */
async function openVacation(
  tenant: Tenant,
  employeeId: string,
  balance: string,
  committed?: string,
): Promise<string> {
  return seed(async (transaction) => {
    const account = await transaction.leaveAccount.create({
      data: {
        agencyId: tenant.agency.id,
        employeeId,
        leaveTypeId: tenant.leaveTypeId,
        unitCode: 'CREDIT_DAY',
        status: 'ACTIVE',
        openedAt: date('2026-01-01'),
      },
    });
    await transaction.leaveLedgerEntry.create({
      data: {
        agencyId: tenant.agency.id,
        leaveAccountId: account.id,
        quantity: new Prisma.Decimal(balance),
        effectiveDate: date('2026-01-01'),
        sourceType: 'TEST_OPENING',
        sourceId: randomUUID(),
        sourcePostingKey: 'OPENING',
        policyVersionId: tenant.policyVersionId,
      },
    });
    if (committed) {
      await transaction.leaveCreditCommitment.create({
        data: {
          agencyId: tenant.agency.id,
          leaveAccountId: account.id,
          quantity: new Prisma.Decimal(committed),
          sourceType: 'TEST_APPLICATION',
          sourceId: randomUUID(),
          sourceCommitmentKey: 'COMMIT',
          status: 'ACTIVE',
          effectiveFrom: new Date('2026-10-01T00:00:00.000Z'),
        },
      });
    }
    return account.id;
  });
}

interface FactSeed {
  employeeId: string;
  workDate: string;
  factType: 'TARDINESS' | 'UNDERTIME' | 'ABSENCE';
  minutes: number;
  prior?: number;
  expectedMinutes?: number;
  scheduleType?: 'REGULAR' | 'FLEXIBLE' | 'COMPRESSED';
}

/** A locked Attendance Period Version and its publication, as lock or adjustment writes them. */
async function publish(
  tenant: Tenant,
  facts: FactSeed[],
  predecessorPublicationId: string | null = null,
): Promise<{ publicationId: string; factIds: string[] }> {
  tenant.publications += 1;
  const versionNo = tenant.publications;
  const createdAt = new Date(Date.UTC(2026, 10, 15, 0, versionNo));
  return seed(async (transaction) => {
    const agencyId = tenant.agency.id;
    const version = await transaction.attendancePeriodVersion.create({
      data: {
        agencyId,
        attendancePeriodId: tenant.periodId,
        versionNo,
        status: 'LOCKED',
        approvalRouteVersionId: randomUUID(),
        submittedByMembershipId: tenant.membership.id,
        submittedAt: createdAt,
        reviewedByMembershipId: randomUUID(),
        reviewedAt: createdAt,
        lockedByMembershipId: tenant.membership.id,
        lockedAt: createdAt,
        reconciliation: {},
      },
    });
    const publication = await transaction.attendancePayrollPublication.create({
      data: {
        agencyId,
        attendancePeriodVersionId: version.id,
        predecessorPublicationId,
        publicationType: predecessorPublicationId ? 'ADJUSTMENT' : 'ORIGINAL',
        idempotencyKey: `publication:${version.id}`,
        publishedAt: createdAt,
      },
    });
    const days = new Map<string, string>();
    const factIds: string[] = [];
    for (const fact of facts) {
      const dayKey = `${fact.employeeId}|${fact.workDate}`;
      let dayId = days.get(dayKey);
      if (!dayId) {
        let workScheduleVersionId: string | null = null;
        if (fact.scheduleType) {
          const schedule = await transaction.workSchedule.create({
            data: { agencyId, code: `WS-${randomUUID()}`, name: 'Schedule' },
          });
          const scheduleVersion = await transaction.workScheduleVersion.create({
            data: {
              agencyId,
              workScheduleId: schedule.id,
              versionNo: 1,
              scheduleType: fact.scheduleType,
              status: 'DRAFT',
              effectiveFrom: date('2026-01-01'),
            },
          });
          workScheduleVersionId = scheduleVersion.id;
        }
        // A correction successor replaces the current Day of that Work Date.
        await transaction.attendanceDay.updateMany({
          where: { agencyId, employeeId: fact.employeeId, workDate: date(fact.workDate) },
          data: { isCurrent: false },
        });
        const day = await transaction.attendanceDay.create({
          data: {
            agencyId,
            attendancePeriodId: tenant.periodId,
            employeeId: fact.employeeId,
            workDate: date(fact.workDate),
            workScheduleVersionId,
            dayClassification: 'SCHEDULED',
            status: 'APPROVED',
            expectedMinutes: fact.expectedMinutes ?? 480,
            calculationVersion: versionNo,
            ruleSnapshot: {},
          },
        });
        dayId = day.id;
        days.set(dayKey, dayId);
      }
      const prior = fact.prior;
      const row = await transaction.attendancePayrollFact.create({
        data: {
          agencyId,
          attendancePayrollPublicationId: publication.id,
          attendanceDayId: dayId,
          employeeId: fact.employeeId,
          workDate: date(fact.workDate),
          factType: fact.factType,
          stableSourceKey: `${fact.employeeId}|${fact.workDate}|${fact.factType}|NONE`,
          correctedMinutes: fact.minutes,
          priorMinutes: prior ?? null,
          differenceDirection:
            prior === undefined ? null : fact.minutes > prior ? 'INCREASE' : 'DECREASE',
          differenceMinutes: prior === undefined ? null : Math.abs(fact.minutes - prior),
          createdAt,
        },
      });
      factIds.push(row.id);
    }
    return { publicationId: publication.id, factIds };
  });
}

function charger() {
  const attendance = new AttendancePeriodsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return new AttendanceDeficitChargesService(
    attendance,
    new PayrollInputsService(),
    new MandatoryLeaveAssessmentsService(mandatoryLeaveAssessmentAuditWriter),
  );
}

function runner(tenant: Tenant): RequestContext {
  return {
    requestId: `deficit-charge-integration-${tenant.suffix}`,
    userId: tenant.user.id,
    agencyId: tenant.agency.id,
    membershipId: tenant.membership.id,
    primaryOrganizationUnitId: null,
    permissions: [
      { code: 'leave.deficit_charges.run', scopePolicy: 'AGENCY' },
      { code: 'leave.deficit_charges.read', scopePolicy: 'AGENCY' },
    ],
  };
}

async function balance(accountId: string): Promise<string> {
  const sum = await (
    await admin()
  ).leaveLedgerEntry.aggregate({
    where: { leaveAccountId: accountId },
    _sum: { quantity: true },
  });
  return (sum._sum.quantity ?? new Prisma.Decimal(0)).toFixed(3);
}

function employeeOf(result: PublicationDeficitCharges, employeeId: string) {
  const employee = result.employees.find((row) => row.employeeId === employeeId);
  if (!employee) throw new Error(`No result for Employee ${employeeId}`);
  return employee;
}

afterAll(async () => {
  if (!adminClient) return;
  const tables = [
    'attendance_deficit_charges',
    'payroll_inputs',
    'mandatory_leave_assessments',
    'leave_credit_commitments',
    'leave_ledger_entries',
    'leave_accounts',
    'leave_policy_versions',
    'leave_types',
    'attendance_payroll_facts',
    'attendance_payroll_publications',
    'attendance_days',
    'attendance_period_versions',
    'attendance_periods',
    'work_schedule_versions',
    'work_schedules',
    'audit_events',
    'outbox_events',
    'employees',
    'agency_memberships',
  ];
  await adminClient.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    for (const tenant of tenants) {
      for (const table of tables) {
        await transaction.$executeRawUnsafe(
          `DELETE FROM "${table}" WHERE "agency_id" = $1::uuid`,
          tenant.agency.id,
        );
      }
      await transaction.agency.delete({ where: { id: tenant.agency.id } });
      await transaction.user.delete({ where: { id: tenant.user.id } });
    }
  });
  await adminClient.$disconnect();
});

it.skipIf(!enabled)(
  'charges the ADR 0012 worked example once, and an adjustment reverses and replaces it',
  async () => {
    const db = await admin();
    const tenant = await createTenant('worked');
    const foreign = await createTenant('foreign');
    const employee = await addEmployee(tenant, 'worked');
    const accountId = await openVacation(tenant, employee.id, '0.200');
    const service = charger();
    const original = await publish(tenant, [
      { employeeId: employee.id, workDate: '2026-11-03', factType: 'TARDINESS', minutes: 37 },
      { employeeId: employee.id, workDate: '2026-11-05', factType: 'UNDERTIME', minutes: 90 },
      { employeeId: employee.id, workDate: '2026-11-06', factType: 'ABSENCE', minutes: 480 },
    ]);

    const first = employeeOf(
      await service.run(runner(tenant), original.publicationId),
      employee.id,
    );
    expect(first.uncharged).toEqual([]);
    expect(first.failure).toBeNull();
    expect(
      first.charges.map(
        ({ workDate, deficitType, convertedQuantity, chargedQuantity, unpaidQuantity }) => ({
          workDate,
          deficitType,
          convertedQuantity,
          chargedQuantity,
          unpaidQuantity,
        }),
      ),
    ).toEqual([
      {
        workDate: '2026-11-03',
        deficitType: 'TARDINESS',
        convertedQuantity: '0.077',
        chargedQuantity: '0.077',
        unpaidQuantity: '0.000',
      },
      {
        workDate: '2026-11-05',
        deficitType: 'UNDERTIME',
        convertedQuantity: '0.187',
        chargedQuantity: '0.123',
        unpaidQuantity: '0.064',
      },
    ]);
    const [tardiness, undertime] = first.charges;
    expect(tardiness?.payrollInputId).toBeNull();
    expect(await balance(accountId)).toBe('0.000');

    // The covered part is one entry sourced by the charge on the Work Date;
    // the remainder is one pending Payroll Input with its provenance.
    const undertimeEntry = await db.leaveLedgerEntry.findUniqueOrThrow({
      where: { id: undertime!.leaveLedgerEntryId! },
    });
    expect(undertimeEntry).toMatchObject({
      sourceType: 'ATTENDANCE_DEFICIT_CHARGE',
      sourceId: undertime!.id,
      effectiveDate: date('2026-11-05'),
      postedByMembershipId: tenant.membership.id,
    });
    expect(undertimeEntry.quantity.toFixed(3)).toBe('-0.123');
    const remainder = await db.payrollInput.findUniqueOrThrow({
      where: { id: undertime!.payrollInputId! },
    });
    expect(remainder).toMatchObject({
      sourceModule: 'LEAVE',
      inputKind: 'UNPAID_DEFICIT_REMAINDER',
      sourceType: 'AttendanceDeficitCharge',
      sourceId: undertime!.id,
      status: 'PENDING',
      effectiveDate: date('2026-11-05'),
    });
    expect(remainder.quantity?.toFixed(3)).toBe('0.064');
    expect(remainder.payloadSnapshot).toMatchObject({
      attendancePayrollFactId: original.factIds[1],
      deficitMinutes: 90,
      conversion: {
        authority: 'CSC MC No. 41, s. 1998, Table II',
        hoursRow: '0.125',
        minutesRow: '0.062',
        convertedQuantity: '0.187',
      },
    });

    // A retry returns the existing charges and writes nothing.
    const counts = async () => ({
      charges: await db.attendanceDeficitCharge.count({ where: { agencyId: tenant.agency.id } }),
      entries: await db.leaveLedgerEntry.count({ where: { leaveAccountId: accountId } }),
      inputs: await db.payrollInput.count({ where: { agencyId: tenant.agency.id } }),
    });
    const before = await counts();
    const retry = employeeOf(
      await service.run(runner(tenant), original.publicationId),
      employee.id,
    );
    expect(retry.charges.map((charge) => charge.id)).toEqual(
      first.charges.map((charge) => charge.id),
    );
    expect(await counts()).toEqual(before);

    // Rows are immutable.
    await expect(
      db.attendanceDeficitCharge.update({
        where: { id: tardiness!.id },
        data: { deficitMinutes: 1 },
      }),
    ).rejects.toThrow();

    // The Locked Attendance Adjustment corrects 5 November to 30 minutes.
    const adjustment = await publish(
      tenant,
      [
        {
          employeeId: employee.id,
          workDate: '2026-11-05',
          factType: 'UNDERTIME',
          minutes: 30,
          prior: 90,
        },
      ],
      original.publicationId,
    );
    const corrected = employeeOf(
      await service.run(runner(tenant), adjustment.publicationId),
      employee.id,
    );
    expect(corrected.charges).toHaveLength(1);
    const successor = corrected.charges[0]!;
    expect(successor).toMatchObject({
      attendancePayrollFactId: adjustment.factIds[0],
      supersedesChargeId: undertime!.id,
      deficitMinutes: 30,
      convertedQuantity: '0.062',
      chargedQuantity: '0.062',
      unpaidQuantity: '0.000',
      payrollInputId: null,
    });
    expect(await balance(accountId)).toBe('0.061');
    const reversal = await db.leaveLedgerEntry.findFirstOrThrow({
      where: { reversesEntryId: undertimeEntry.id },
    });
    expect(reversal).toMatchObject({ sourceId: successor.id, effectiveDate: date('2026-11-05') });
    expect(reversal.quantity.toFixed(3)).toBe('0.123');
    // Payroll's earlier input is withdrawn, and the original charge is unchanged.
    await expect(
      db.payrollInput.findUniqueOrThrow({ where: { id: remainder.id } }),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
    await expect(
      db.attendanceDeficitCharge.findUniqueOrThrow({ where: { id: undertime!.id } }),
    ).resolves.toMatchObject({ unpaidQuantity: new Prisma.Decimal('0.064') });

    // The superseded original fact is never charged again, and nothing is owed.
    await service.run(runner(tenant), original.publicationId);
    await service.run(runner(tenant), adjustment.publicationId);
    expect(await balance(accountId)).toBe('0.061');
    await expect(service.read(runner(tenant), original.publicationId)).resolves.toMatchObject({
      employees: [{ employeeId: employee.id, uncharged: [] }],
    });
    await expect(duePublicationIds(tenant.agency.id)).resolves.toEqual([]);
    await expect(
      db.auditEvent.count({
        where: { agencyId: tenant.agency.id, action: 'ATTENDANCE_DEFICIT_CHARGED' },
      }),
    ).resolves.toBe(3);

    // Another Agency cannot read or run this publication.
    await expect(service.read(runner(foreign), original.publicationId)).rejects.toMatchObject({
      statusCode: 404,
    });
  },
);

it.skipIf(!enabled)(
  'sends the whole conversion to Payroll when no credit is available and posts no entry',
  async () => {
    const db = await admin();
    const tenant = await createTenant('zero');
    const employee = await addEmployee(tenant, 'zero');
    // .100 posted but all of it committed to a pending leave application.
    const accountId = await openVacation(tenant, employee.id, '0.100', '0.100');
    const { publicationId } = await publish(tenant, [
      { employeeId: employee.id, workDate: '2026-11-04', factType: 'TARDINESS', minutes: 30 },
    ]);

    const result = employeeOf(await charger().run(runner(tenant), publicationId), employee.id);
    expect(result.charges[0]).toMatchObject({
      convertedQuantity: '0.062',
      chargedQuantity: '0.000',
      unpaidQuantity: '0.062',
      leaveLedgerEntryId: null,
    });
    expect(await balance(accountId)).toBe('0.100');
    const input = await db.payrollInput.findUniqueOrThrow({
      where: { id: result.charges[0]!.payrollInputId! },
    });
    expect(input.quantity?.toFixed(3)).toBe('0.062');

    // An adjustment to 45 minutes withdraws that input and links its replacement.
    const adjustment = await publish(
      tenant,
      [
        {
          employeeId: employee.id,
          workDate: '2026-11-04',
          factType: 'TARDINESS',
          minutes: 45,
          prior: 30,
        },
      ],
      publicationId,
    );
    const corrected = employeeOf(
      await charger().run(runner(tenant), adjustment.publicationId),
      employee.id,
    );
    expect(corrected.charges[0]).toMatchObject({
      supersedesChargeId: result.charges[0]!.id,
      convertedQuantity: '0.094',
      chargedQuantity: '0.000',
      unpaidQuantity: '0.094',
    });
    await expect(
      db.payrollInput.findUniqueOrThrow({ where: { id: input.id } }),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
    const replacement = await db.payrollInput.findUniqueOrThrow({
      where: { id: corrected.charges[0]!.payrollInputId! },
    });
    expect(replacement).toMatchObject({ status: 'PENDING', replacesPayrollInputId: input.id });
    expect(replacement.quantity?.toFixed(3)).toBe('0.094');
  },
);

it.skipIf(!enabled)(
  'rolls an Employee back when Payroll rejects or cannot yet take an effect, with the reason',
  async () => {
    const db = await admin();
    const tenant = await createTenant('refused');
    const employee = await addEmployee(tenant, 'refused');
    const accountId = await openVacation(tenant, employee.id, '0.100');
    const service = charger();
    const { publicationId, factIds } = await publish(tenant, [
      { employeeId: employee.id, workDate: '2026-11-03', factType: 'TARDINESS', minutes: 10 },
      { employeeId: employee.id, workDate: '2026-11-04', factType: 'UNDERTIME', minutes: 60 },
    ]);
    // An unrelated input already holds the second fact's source key.
    await db.payrollInput.create({
      data: {
        agencyId: tenant.agency.id,
        employeeId: employee.id,
        sourceModule: 'LEAVE',
        inputKind: 'UNPAID_DEFICIT_REMAINDER',
        sourceKey: `ATTENDANCE_DEFICIT_CHARGE:${factIds[1]}`,
        sourceType: 'Other',
        sourceId: randomUUID(),
        effectiveDate: date('2026-11-04'),
        quantity: new Prisma.Decimal('1'),
        status: 'PENDING',
        payloadSnapshot: {},
        payloadHash: 'conflict',
      },
    });

    const rejected = employeeOf(await service.run(runner(tenant), publicationId), employee.id);
    expect(rejected.failure).toMatchObject({ code: 'PAYROLL_INPUT_SOURCE_KEY_CONFLICT' });
    expect(rejected.charges).toEqual([]);
    expect(rejected.uncharged.map((fact) => fact.reason.code)).toEqual([
      'PAYROLL_INPUT_SOURCE_KEY_CONFLICT',
      'PAYROLL_INPUT_SOURCE_KEY_CONFLICT',
    ]);
    // The first fact's covered entry rolled back with the refused second one.
    expect(await balance(accountId)).toBe('0.100');
    await expect(
      db.attendanceDeficitCharge.count({ where: { agencyId: tenant.agency.id } }),
    ).resolves.toBe(0);
    await expect(
      db.auditEvent.findFirst({
        where: { agencyId: tenant.agency.id, action: 'ATTENDANCE_DEFICIT_CHARGE_FAILED' },
      }),
    ).resolves.toMatchObject({ entityId: publicationId, reason: expect.any(String) });
    // Payroll's blocking-exception read reports the same reason.
    const uncharged = await service.read(runner(tenant), publicationId);
    expect(employeeOf(uncharged, employee.id).uncharged[0]?.reason.code).toBe(
      'PAYROLL_INPUT_SOURCE_KEY_CONFLICT',
    );

    // Once the conflict is gone, the same run charges both facts.
    await seed((transaction) =>
      transaction.payrollInput.deleteMany({ where: { agencyId: tenant.agency.id } }),
    );
    const charged = employeeOf(await service.run(runner(tenant), publicationId), employee.id);
    expect(charged.failure).toBeNull();
    expect(charged.charges.map((charge) => charge.unpaidQuantity)).toEqual(['0.000', '0.046']);
    expect(await balance(accountId)).toBe('0.000');

    // A consumed remainder cannot be withdrawn yet, so the adjustment rolls back.
    await seed((transaction) =>
      transaction.payrollInput.updateMany({
        where: { agencyId: tenant.agency.id },
        data: { status: 'CONSUMED', consumedByPayrollPeriodId: randomUUID() },
      }),
    );
    const adjustment = await publish(
      tenant,
      [
        {
          employeeId: employee.id,
          workDate: '2026-11-04',
          factType: 'UNDERTIME',
          minutes: 20,
          prior: 60,
        },
      ],
      publicationId,
    );
    const retryable = employeeOf(
      await service.run(runner(tenant), adjustment.publicationId),
      employee.id,
    );
    expect(retryable.failure).toMatchObject({
      code: 'PAYROLL_INPUT_CONSUMED_CORRECTION_UNAVAILABLE',
    });
    expect(retryable.uncharged).toHaveLength(1);
    expect(await balance(accountId)).toBe('0.000');
    await expect(
      db.leaveLedgerEntry.count({
        where: { leaveAccountId: accountId, reversesEntryId: { not: null } },
      }),
    ).resolves.toBe(0);
  },
);

it.skipIf(!enabled)(
  'leaves a fact uncharged with its gap, and a rerun charges it once resolved',
  async () => {
    const db = await admin();
    const tenant = await createTenant('gaps');
    const scheduled = await addEmployee(tenant, 'scheduled');
    const unopened = await addEmployee(tenant, 'unopened');
    await openVacation(tenant, scheduled.id, '1.000');
    const service = charger();
    const { publicationId } = await publish(tenant, [
      {
        employeeId: scheduled.id,
        workDate: '2026-11-03',
        factType: 'TARDINESS',
        minutes: 15,
        expectedMinutes: 600,
        scheduleType: 'COMPRESSED',
      },
      {
        employeeId: scheduled.id,
        workDate: '2026-11-04',
        factType: 'UNDERTIME',
        minutes: 15,
        scheduleType: 'FLEXIBLE',
      },
      {
        employeeId: scheduled.id,
        workDate: '2026-11-05',
        factType: 'TARDINESS',
        minutes: 15,
        expectedMinutes: 240,
      },
      { employeeId: unopened.id, workDate: '2026-11-03', factType: 'TARDINESS', minutes: 15 },
    ]);

    const first = await service.run(runner(tenant), publicationId);
    expect(
      employeeOf(first, scheduled.id).uncharged.map(({ workDate, reason }) => [
        workDate,
        reason.code,
      ]),
    ).toEqual([
      ['2026-11-03', 'COMPRESSED_WORKWEEK_DAY'],
      ['2026-11-04', 'FLEXIBLE_HOURS_DEFICIT'],
      ['2026-11-05', 'EXPECTED_DUTY_NOT_480'],
    ]);
    expect(employeeOf(first, unopened.id).uncharged[0]?.reason.code).toBe(
      'NO_VACATION_LEAVE_ACCOUNT',
    );
    await expect(
      db.attendanceDeficitCharge.count({ where: { agencyId: tenant.agency.id } }),
    ).resolves.toBe(0);
    await expect(
      service.unchargedFactsInTransaction(db, tenant.agency.id, publicationId),
    ).resolves.toHaveLength(2);
    // The consumer finds the Agency by its lock event and keeps the publication due.
    await seed((transaction) =>
      transaction.outboxEvent.create({
        data: {
          agencyId: tenant.agency.id,
          eventType: 'ATTENDANCE_PERIOD_LOCKED',
          aggregateType: 'AttendancePeriodVersion',
          aggregateId: randomUUID(),
          idempotencyKey: `attendance-period-lock:${tenant.suffix}`,
          payload: { payrollPublicationId: publicationId },
        },
      }),
    );
    expect(await deficitChargeAgencyIds()).toContain(tenant.agency.id);
    await expect(duePublicationIds(tenant.agency.id)).resolves.toEqual([publicationId]);

    // HR opens the missing account; the rerun charges that fact only.
    const accountId = await openVacation(tenant, unopened.id, '1.000');
    const rerun = await service.run(runner(tenant), publicationId);
    expect(employeeOf(rerun, unopened.id).charges[0]).toMatchObject({
      convertedQuantity: '0.031',
      chargedQuantity: '0.031',
    });
    expect(employeeOf(rerun, unopened.id).uncharged).toEqual([]);
    expect(employeeOf(rerun, scheduled.id).uncharged).toHaveLength(3);
    expect(await balance(accountId)).toBe('0.969');
  },
);

it.skipIf(!enabled)('charges each fact once when two runs of one publication race', async () => {
  const db = await admin();
  const tenant = await createTenant('race');
  const employee = await addEmployee(tenant, 'race');
  const accountId = await openVacation(tenant, employee.id, '0.050');
  const { publicationId } = await publish(tenant, [
    { employeeId: employee.id, workDate: '2026-11-03', factType: 'TARDINESS', minutes: 20 },
    { employeeId: employee.id, workDate: '2026-11-04', factType: 'TARDINESS', minutes: 20 },
  ]);

  const [left, right] = await Promise.all([
    charger().run(runner(tenant), publicationId),
    charger().chargePublication(
      { agencyId: tenant.agency.id, requestId: 'consumer', userId: null, membershipId: null },
      publicationId,
    ),
  ]);
  const ids = (result: PublicationDeficitCharges) =>
    employeeOf(result, employee.id).charges.map((charge) => charge.id);
  expect(ids(left)).toEqual(ids(right));
  await expect(
    db.attendanceDeficitCharge.count({ where: { agencyId: tenant.agency.id } }),
  ).resolves.toBe(2);
  // .042 then .008 of the next .042, leaving .034 for Payroll.
  expect(employeeOf(left, employee.id).charges.map((charge) => charge.unpaidQuantity)).toEqual([
    '0.000',
    '0.034',
  ]);
  expect(await balance(accountId)).toBe('0.000');
  await expect(db.payrollInput.count({ where: { agencyId: tenant.agency.id } })).resolves.toBe(1);
});
