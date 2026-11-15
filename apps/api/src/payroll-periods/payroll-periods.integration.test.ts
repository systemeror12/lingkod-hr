import { withDatabaseContext } from '@lingkod-hr/database';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimPayrollFunction } from './payroll-period-actors';
import { PayrollPeriodsService } from './payroll-periods.service';
import {
  cleanupPayrollTenants,
  cleanupPlatformFixtures,
  createAdminClient,
  createPayComponent,
  createPayrollTenant,
  type PayrollTenant,
} from './payroll-periods.test-fixtures';

const enabled = process.env.DATABASE_E2E === 'true';

describe.skipIf(!enabled)('Payroll Periods in PostgreSQL', () => {
  const suffix = `${Date.now()}`;
  const service = new PayrollPeriodsService();
  let admin: PrismaClient;
  let home: PayrollTenant;
  let foreign: PayrollTenant;
  let componentId: string;

  const regular = (code: string, month: string) => ({
    code,
    runType: 'REGULAR' as const,
    periodFrom: `${month}-01`,
    periodTo: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
      .toISOString()
      .slice(0, 10),
    cutoffAt: `${month}-20T17:00:00+08:00`,
    paymentDate: `${month}-28`,
  });

  beforeAll(async () => {
    admin = await createAdminClient();
    home = await createPayrollTenant(admin, suffix, 'HOME', 3);
    foreign = await createPayrollTenant(admin, suffix, 'FOREIGN');
    componentId = (await createPayComponent(admin, suffix)).id;
  });

  afterAll(async () => {
    await cleanupPayrollTenants(admin, [home, foreign]);
    await cleanupPlatformFixtures(admin, suffix);
    await admin.$disconnect();
  });

  it('creates periods, refuses duplicates and a second open regular, and allows void-and-replace', async () => {
    const preparer = home.persons[0]!;
    const march = await service.create(preparer.context, regular('REG-2801-03', '2801-03'));
    expect(march).toMatchObject({
      runType: 'REGULAR',
      periodFrom: '2801-03-01',
      periodTo: '2801-03-31',
      cutoffAt: '2801-03-20T09:00:00.000Z',
      status: 'DRAFT',
      calculationVersion: 0,
      payComponentIds: [],
      rowVersion: 1,
    });
    await expect(
      admin.payrollPeriodActor.findMany({ where: { payrollPeriodId: march.id } }),
    ).resolves.toEqual([
      expect.objectContaining({
        membershipId: preparer.membership.id,
        payrollFunction: 'PREPARATION',
      }),
    ]);
    await expect(admin.auditEvent.findMany({ where: { entityId: march.id } })).resolves.toEqual([
      expect.objectContaining({
        action: 'PAYROLL_PERIOD_CREATED',
        actorMembershipId: preparer.membership.id,
        previousStatus: null,
        newStatus: 'DRAFT',
      }),
    ]);

    const refusal = (input: unknown) => service.create(preparer.context, input);
    await expect(
      refusal({
        ...regular('REG-BAD', '2801-05'),
        periodFrom: '2801-05-02',
        periodTo: '2801-06-01',
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'PAYROLL_PERIOD_NOT_ONE_MONTH' });
    await expect(
      refusal({ ...regular('REG-HALF', '2801-05'), periodTo: '2801-05-15' }),
    ).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_ONE_MONTH' });
    await expect(
      refusal({ ...regular('REG-COMP', '2801-05'), payComponentIds: [componentId] }),
    ).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_REGULAR_COMPONENTS' });
    await expect(
      refusal({ ...regular('SP-NONE', '2801-05'), runType: 'SPECIAL' }),
    ).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_COMPONENT_REQUIRED' });
    await expect(
      refusal({
        ...regular('SP-UNKNOWN', '2801-05'),
        runType: 'SPECIAL',
        payComponentIds: [home.agency.id],
      }),
    ).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_COMPONENT_NOT_FOUND' });
    await expect(refusal(regular('reg-2801-03', '2801-04'))).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_PERIOD_CODE_EXISTS',
    });
    await expect(refusal(regular('REG-2801-03-B', '2801-03'))).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_PERIOD_DUPLICATE_MONTH',
    });
    await expect(refusal(regular('REG-2801-04', '2801-04'))).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_PERIOD_OPEN_REGULAR_EXISTS',
    });
    await expect(
      service.create(
        {
          ...preparer.context,
          permissions: [{ code: 'payroll.periods.create', scopePolicy: 'OWN' }],
        },
        regular('REG-OWN', '2801-04'),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    // A special period may overlap the open regular month.
    const special = await service.create(preparer.context, {
      ...regular('SP-2801-03', '2801-03'),
      runType: 'SPECIAL',
      periodFrom: '2801-03-10',
      periodTo: '2801-04-20',
      payComponentIds: [componentId],
    });
    expect(special).toMatchObject({ status: 'DRAFT', payComponentIds: [componentId] });

    // The indexes hold without the service: a duplicate month, a second open
    // regular, and a regular period that is not one month.
    const direct = (data: Record<string, unknown>) =>
      withDatabaseContext(preparer.scope, (transaction) =>
        transaction.payrollPeriod.create({
          data: {
            agencyId: home.agency.id,
            code: `DIRECT-${Math.random()}`,
            runType: 'REGULAR',
            periodFrom: new Date('2801-03-01'),
            periodTo: new Date('2801-03-31'),
            cutoffAt: new Date('2801-03-20T09:00:00Z'),
            paymentDate: new Date('2801-03-28'),
            status: 'DRAFT',
            ...data,
          },
        }),
      );
    await expect(direct({})).rejects.toThrow(/payroll_periods_regular_month_key|Unique constraint/);
    await expect(
      direct({ periodFrom: new Date('2801-04-01'), periodTo: new Date('2801-04-30') }),
    ).rejects.toThrow(/payroll_periods_one_open_regular_key|Unique constraint/);
    await expect(
      direct({ periodFrom: new Date('2801-09-01'), periodTo: new Date('2801-09-29') }),
    ).rejects.toThrow(/payroll_periods_regular_month_check/);
    await expect(direct({ status: 'FINALIZED' })).rejects.toThrow(/created as DRAFT/);

    // Cancelling the draft frees its month for a replacement with a new code.
    await expect(
      service.cancelDraft(preparer.context, march.id, { reason: ' ', rowVersion: 1 }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service.cancelDraft(preparer.context, march.id, { reason: 'Wrong cutoff', rowVersion: 9 }),
    ).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_STALE' });
    const voided = await service.cancelDraft(preparer.context, march.id, {
      reason: 'Created with the wrong payment date',
      rowVersion: 1,
    });
    expect(voided).toMatchObject({
      status: 'VOIDED',
      voidReason: 'Created with the wrong payment date',
      rowVersion: 2,
    });
    await expect(
      admin.payrollPeriod.findUniqueOrThrow({ where: { id: march.id } }),
    ).resolves.toMatchObject({ voidedByMembershipId: preparer.membership.id });
    await expect(
      admin.auditEvent.findFirst({
        where: { entityId: march.id, action: 'PAYROLL_PERIOD_DRAFT_CANCELLED' },
      }),
    ).resolves.toMatchObject({
      previousStatus: 'DRAFT',
      newStatus: 'VOIDED',
      reason: 'Created with the wrong payment date',
    });
    await expect(
      service.cancelDraft(preparer.context, march.id, { reason: 'Again', rowVersion: 2 }),
    ).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_DRAFT' });
    await expect(
      admin.payrollPeriod.update({
        where: { id: march.id },
        data: { paymentDate: new Date('2801-03-27') },
      }),
    ).rejects.toThrow(/voided Payroll Period is final/);

    const replacement = await service.create(preparer.context, regular('REG-2801-03-R', '2801-03'));
    expect(replacement).toMatchObject({ periodFrom: '2801-03-01', status: 'DRAFT' });
    await expect(admin.payrollPeriod.delete({ where: { id: replacement.id } })).rejects.toThrow(
      /cannot be deleted/,
    );
  });

  it('moves a draft cutoff with an Audit Event and refuses it outside DRAFT', async () => {
    const preparer = home.persons[0]!;
    const period = await service.create(preparer.context, {
      ...regular('SP-CUTOFF', '2801-06'),
      runType: 'SPECIAL',
      payComponentIds: [componentId],
    });

    await expect(
      service.moveCutoff(preparer.context, period.id, {
        cutoffAt: '2801-06-22T17:00:00+08:00',
        reason: '',
        rowVersion: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    const moved = await service.moveCutoff(preparer.context, period.id, {
      cutoffAt: '2801-06-22T17:00:00+08:00',
      reason: 'Attendance lock moved to the 22nd',
      rowVersion: 1,
    });
    expect(moved).toMatchObject({ cutoffAt: '2801-06-22T09:00:00.000Z', rowVersion: 2 });
    await expect(
      admin.auditEvent.findFirst({
        where: { entityId: period.id, action: 'PAYROLL_PERIOD_CUTOFF_MOVED' },
      }),
    ).resolves.toMatchObject({
      reason: 'Attendance lock moved to the 22nd',
      metadata: {
        before: { cutoffAt: '2801-06-20T09:00:00.000Z' },
        after: { cutoffAt: '2801-06-22T09:00:00.000Z' },
      },
    });

    // Calculation starts: the period leaves DRAFT with its first version.
    await withDatabaseContext(preparer.scope, (transaction) =>
      transaction.payrollPeriod.update({
        where: { id: period.id },
        data: { status: 'CALCULATING', calculationVersion: 1 },
      }),
    );
    await expect(
      service.moveCutoff(preparer.context, period.id, {
        cutoffAt: '2801-06-25T17:00:00+08:00',
        reason: 'Too late',
        rowVersion: 2,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_PERIOD_NOT_DRAFT' });
    await expect(
      admin.payrollPeriod.update({
        where: { id: period.id },
        data: { cutoffAt: new Date('2801-06-25T09:00:00Z') },
      }),
    ).rejects.toThrow(/moves only while it is DRAFT/);
    await expect(
      service.cancelDraft(preparer.context, period.id, { reason: 'Too late', rowVersion: 2 }),
    ).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_DRAFT' });

    // The database keeps the status graph and the calculation-version count.
    await expect(
      admin.payrollPeriod.update({ where: { id: period.id }, data: { status: 'FINALIZED' } }),
    ).rejects.toThrow(/cannot move from CALCULATING to FINALIZED/);
    await expect(
      admin.payrollPeriod.update({ where: { id: period.id }, data: { calculationVersion: 5 } }),
    ).rejects.toThrow(/one calculation version/);
    await expect(
      admin.payrollPeriod.update({
        where: { id: period.id },
        data: { periodTo: new Date('2801-06-29') },
      }),
    ).rejects.toThrow(/keeps its code, run type, and dates/);
  });

  it('keeps each person to one payroll function, even when two are claimed at once', async () => {
    const [preparer, certifier, racer] = home.persons;
    const period = await service.create(preparer!.context, {
      ...regular('SP-ACTORS', '2801-07'),
      runType: 'SPECIAL',
      payComponentIds: [componentId],
    });
    const claim = (person: typeof preparer, payrollFunction: 'PREPARATION' | 'HR_CERTIFICATION') =>
      withDatabaseContext(person!.scope, (transaction) =>
        claimPayrollFunction(transaction, {
          agencyId: home.agency.id,
          payrollPeriodId: period.id,
          membershipId: person!.membership.id,
          payrollFunction,
        }),
      );

    // The certifier's function is fixed, so their preparation command is refused.
    await expect(claim(certifier, 'HR_CERTIFICATION')).resolves.toEqual({ outcome: 'CLAIMED' });
    await expect(claim(certifier, 'HR_CERTIFICATION')).resolves.toEqual({ outcome: 'CLAIMED' });
    await expect(
      service.moveCutoff(certifier!.context, period.id, {
        cutoffAt: '2801-07-25T17:00:00+08:00',
        reason: 'Certifier tries to prepare',
        rowVersion: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_FUNCTION_CONFLICT' });
    await expect(
      admin.payrollPeriod.findUniqueOrThrow({ where: { id: period.id } }),
    ).resolves.toMatchObject({ rowVersion: 1 });
    await expect(claim(preparer, 'HR_CERTIFICATION')).resolves.toEqual({
      outcome: 'REFUSED',
      heldFunction: 'PREPARATION',
    });

    // Two functions claimed at once by one person: exactly one wins.
    const results = await Promise.all([
      claim(racer, 'PREPARATION'),
      claim(racer, 'HR_CERTIFICATION'),
    ]);
    expect(results.map((result) => result.outcome).sort()).toEqual(['CLAIMED', 'REFUSED']);
    const held = await admin.payrollPeriodActor.findMany({
      where: { payrollPeriodId: period.id, membershipId: racer!.membership.id },
    });
    expect(held).toHaveLength(1);
    const winner = results.findIndex((result) => result.outcome === 'CLAIMED');
    expect(held[0]!.payrollFunction).toBe(winner === 0 ? 'PREPARATION' : 'HR_CERTIFICATION');

    await expect(
      admin.payrollPeriodActor.updateMany({
        where: { payrollPeriodId: period.id },
        data: { payrollFunction: 'APPROVAL' },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      admin.payrollPeriodActor.deleteMany({ where: { payrollPeriodId: period.id } }),
    ).rejects.toThrow(/immutable/);
  });

  it('isolates Payroll Periods by Agency', async () => {
    const preparer = home.persons[0]!;
    const outsider = foreign.persons[0]!;
    const period = await service.create(preparer.context, {
      ...regular('SP-RLS', '2801-08'),
      runType: 'SPECIAL',
      payComponentIds: [componentId],
    });

    await expect(
      service.moveCutoff(outsider.context, period.id, {
        cutoffAt: '2801-08-25T17:00:00+08:00',
        reason: 'Cross-Agency',
        rowVersion: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      service.cancelDraft(outsider.context, period.id, { reason: 'Cross-Agency', rowVersion: 1 }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      withDatabaseContext(outsider.scope, (transaction) =>
        Promise.all([
          transaction.payrollPeriod.count({ where: { agencyId: home.agency.id } }),
          transaction.payrollPeriodComponent.count({ where: { agencyId: home.agency.id } }),
          transaction.payrollPeriodActor.count({ where: { agencyId: home.agency.id } }),
        ]),
      ),
    ).resolves.toEqual([0, 0, 0]);
    await expect(
      withDatabaseContext(outsider.scope, (transaction) =>
        transaction.payrollPeriod.updateMany({
          where: { id: period.id },
          data: { cutoffAt: new Date('2801-08-25T09:00:00Z') },
        }),
      ),
    ).resolves.toEqual({ count: 0 });
    await expect(
      withDatabaseContext(outsider.scope, (transaction) =>
        transaction.payrollPeriod.create({
          data: {
            agencyId: home.agency.id,
            code: 'SP-FORGED',
            runType: 'SPECIAL',
            periodFrom: new Date('2801-08-01'),
            periodTo: new Date('2801-08-31'),
            cutoffAt: new Date('2801-08-20T09:00:00Z'),
            paymentDate: new Date('2801-08-28'),
            status: 'DRAFT',
          },
        }),
      ),
    ).rejects.toThrow();
    // A foreign membership cannot act on this Agency's period.
    await expect(
      withDatabaseContext(outsider.scope, (transaction) =>
        claimPayrollFunction(transaction, {
          agencyId: home.agency.id,
          payrollPeriodId: period.id,
          membershipId: outsider.membership.id,
          payrollFunction: 'APPROVAL',
        }),
      ),
    ).rejects.toThrow();
    // The same code is independent in another Agency.
    await expect(
      service.create(outsider.context, {
        ...regular('SP-RLS', '2801-08'),
        runType: 'SPECIAL',
        payComponentIds: [componentId],
      }),
    ).resolves.toMatchObject({ code: 'SP-RLS' });
  });
});
