import type { Prisma, PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import type { DocumentStorage } from '../documents/documents.storage';
import {
  cleanupPayrollTenants,
  createAdminClient,
  createPayrollTenant,
  type PayrollTenant,
} from '../payroll-periods/payroll-periods.test-fixtures';
import { PayslipGenerationService } from './payslip-generation.service';
import { PayslipReadService } from './payslip-read.service';
import { PayslipReleaseService } from './payslip-release.service';
import { PayslipWithholdService } from './payslip-withhold.service';

const enabled = process.env.DATABASE_E2E === 'true';

/** Test double of the S3 adapter. */
class MemoryStorage implements DocumentStorage {
  async putObject() {}
  async deleteObject() {}
  async signedReadUrl(key: string) {
    return `https://storage.example.test/${key}`;
  }
}

describe.skipIf(!enabled)('Payslip release, withholding, and the own read in PostgreSQL', () => {
  const suffix = `${Date.now()}-payslip-release`;
  const tenants: PayrollTenant[] = [];
  const documents = new DocumentsService(new MemoryStorage(), documentAuditWriter);
  const generation = new PayslipGenerationService(documents);
  const release = new PayslipReleaseService();
  const withholding = new PayslipWithholdService();
  const reading = new PayslipReadService(documents);
  let admin: PrismaClient;

  /** Fixture rows written with triggers off, standing in for what another command would write. */
  const seed = <T>(run: (transaction: Prisma.TransactionClient) => Promise<T>) =>
    admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      return run(transaction);
    });

  const as = (tenant: PayrollTenant, index: number, codes: string[], scope = 'AGENCY') =>
    ({
      ...tenant.persons[index]!.context,
      permissions: codes.map((code) => ({ code, scopePolicy: scope })),
    }) as RequestContext;

  /**
   * An Agency whose regular period of March 2875 was finalized by its
   * Payroll Approver (person 0), with a READY Payslip for each of two
   * Employees, linked to persons 2 and 3. Person 1 prepared the period and
   * holds the Payroll Approver's permissions too. Test fixture only: the
   * amounts are not from any issuance.
   */
  async function releasablePeriod(label: string) {
    const tenant = await createPayrollTenant(admin, suffix, `PAYSLIP-RELEASE-${label}`, 4);
    tenants.push(tenant);
    const agencyId = tenant.agency.id;
    const [approver, preparer, first, second] = tenant.persons.map((person) => person.membership);
    const setup = await seed(async (transaction) => {
      const employee = (name: string) =>
        transaction.employee.create({
          data: {
            agencyId,
            employeeNumber: `PAYSLIP-${label}-${name}-${suffix}`,
            legalName: `Payslip ${label} ${name}`,
            birthDate: new Date('1990-01-01'),
            sex: 'FEMALE',
            civilStatus: 'SINGLE',
            contactEmail: `payslip-${label}-${name}-${suffix}@example.test`.toLowerCase(),
            serviceStatus: 'ACTIVE',
            createdByMembershipId: approver!.id,
            updatedByMembershipId: approver!.id,
          },
        });
      const employees = [await employee('FIRST'), await employee('SECOND')];
      for (const [index, membership] of [first, second].entries()) {
        await transaction.agencyMembership.update({
          where: { id: membership!.id },
          data: { employeeId: employees[index]!.id },
        });
      }
      const period = await transaction.payrollPeriod.create({
        data: {
          agencyId,
          code: `PAYSLIP-2875-03-${label}`,
          runType: 'REGULAR',
          periodFrom: new Date('2875-03-01'),
          periodTo: new Date('2875-03-31'),
          cutoffAt: new Date('2875-03-10T00:00:00Z'),
          paymentDate: new Date('2875-03-15'),
          status: 'FINALIZED',
          calculationVersion: 1,
          finalizedAt: new Date('2875-03-14T02:00:00Z'),
        },
      });
      const results = [];
      for (const each of employees) {
        results.push(
          await transaction.payrollEmployee.create({
            data: {
              agencyId,
              payrollPeriodId: period.id,
              calculationVersion: 1,
              employeeId: each.id,
              compensationBasisSnapshot: {},
              status: 'FINALIZED',
              grossAmount: '0',
              totalDeductions: '0',
              netAmount: '0',
              calculationHash: 'e'.repeat(64),
            },
          }),
        );
      }
      await transaction.payrollPeriodActor.createMany({
        data: [
          {
            agencyId,
            payrollPeriodId: period.id,
            membershipId: preparer!.id,
            payrollFunction: 'PREPARATION',
          },
          {
            agencyId,
            payrollPeriodId: period.id,
            membershipId: approver!.id,
            payrollFunction: 'APPROVAL',
          },
        ],
      });
      await transaction.auditEvent.create({
        data: {
          agencyId,
          actorUserId: tenant.persons[0]!.user.id,
          actorMembershipId: approver!.id,
          actorType: 'USER',
          action: 'PAYROLL_PERIOD_FINALIZED',
          entityType: 'PayrollPeriod',
          entityId: period.id,
          previousStatus: 'APPROVED',
          newStatus: 'FINALIZED',
          idempotencyKey: 'finalized',
        },
      });
      return { periodId: period.id, results };
    });
    expect(await generation.generateForPeriod(agencyId, setup.periodId)).toEqual({
      ready: 2,
      failed: 0,
    });
    const payslipOf = async (index: number) =>
      admin.payslip.findUniqueOrThrow({
        where: { payrollEmployeeId: setup.results[index]!.id },
      });
    const approverPermissions = ['payroll.payslips.release', 'payroll.payslips.withhold'];
    return {
      tenant,
      agencyId,
      periodId: setup.periodId,
      results: setup.results,
      payslips: [await payslipOf(0), await payslipOf(1)],
      payslipOf,
      approver: as(tenant, 0, approverPermissions),
      preparer: as(tenant, 1, approverPermissions),
      first: as(tenant, 2, ['payroll.payslips.read'], 'OWN'),
      second: as(tenant, 3, ['payroll.payslips.read'], 'OWN'),
    };
  }

  beforeAll(async () => {
    admin = await createAdminClient();
  });

  afterAll(async () => {
    if (!admin) return;
    await seed(async (transaction) => {
      const where = { agencyId: { in: tenants.map((each) => each.agency.id) } };
      await transaction.payslip.deleteMany({ where });
      await transaction.outboxEvent.deleteMany({ where });
      await transaction.document.updateMany({ where, data: { currentVersionId: null } });
      await transaction.documentVersion.deleteMany({ where });
      await transaction.document.deleteMany({ where });
      await transaction.agencyMembership.updateMany({ where, data: { employeeId: null } });
      await transaction.payrollEmployee.deleteMany({ where });
      await transaction.employee.deleteMany({ where });
    });
    await cleanupPayrollTenants(admin, tenants);
    await admin.$disconnect();
  });

  it('releases every READY Payslip of the period, notifies each Employee after commit, and shows each Employee only their own', async () => {
    const setup = await releasablePeriod('ALL');
    const [first, second] = setup.payslips;

    // Nothing is readable before release.
    await expect(reading.listOwn(setup.first)).resolves.toEqual([]);
    await expect(reading.readOwn(setup.first, first!.id)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PAYSLIP_NOT_FOUND',
    });

    const released = await release.releasePeriod(setup.approver, setup.periodId);
    expect(released).toEqual({
      payrollPeriodId: setup.periodId,
      releasedPayslipIds: [first!.id, second!.id].sort(),
      generatingCount: 0,
    });
    for (const index of [0, 1]) {
      expect(await setup.payslipOf(index)).toMatchObject({
        status: 'RELEASED',
        releasedByMembershipId: setup.approver.membershipId,
        withheldAt: null,
      });
    }
    const audit = await admin.auditEvent.findMany({
      where: { agencyId: setup.agencyId, action: 'PAYSLIP_RELEASED' },
    });
    expect(audit.map((event) => event.entityId).sort()).toEqual([first!.id, second!.id].sort());
    expect(audit[0]).toMatchObject({
      entityType: 'Payslip',
      actorMembershipId: setup.approver.membershipId,
      previousStatus: 'READY',
      newStatus: 'RELEASED',
    });
    const outbox = await admin.outboxEvent.findMany({
      where: { agencyId: setup.agencyId, eventType: 'PAYSLIP_RELEASED' },
    });
    expect(outbox.map((event) => event.aggregateId).sort()).toEqual([first!.id, second!.id].sort());
    const firstEmployeeId = setup.tenant.persons[2]!.membership.id;
    const linked = await admin.agencyMembership.findUniqueOrThrow({
      where: { id: firstEmployeeId },
    });
    expect(outbox.find((event) => event.aggregateId === first!.id)?.payload).toEqual({
      payslipId: first!.id,
      payrollPeriodId: setup.periodId,
      payrollEmployeeId: first!.payrollEmployeeId,
      employeeId: linked.employeeId,
    });

    // Releasing again finds nothing READY and writes nothing more.
    await expect(release.releasePeriod(setup.approver, setup.periodId)).resolves.toEqual({
      payrollPeriodId: setup.periodId,
      releasedPayslipIds: [],
      generatingCount: 0,
    });
    expect(
      await admin.outboxEvent.count({
        where: { agencyId: setup.agencyId, eventType: 'PAYSLIP_RELEASED' },
      }),
    ).toBe(2);

    // Each Employee reads only their own.
    const own = await reading.listOwn(setup.first);
    expect(own).toMatchObject([
      {
        id: first!.id,
        payrollPeriodId: setup.periodId,
        periodCode: 'PAYSLIP-2875-03-ALL',
        paymentDate: '2875-03-15',
        netAmount: '0.0000',
      },
    ]);
    const detail = await reading.readOwn(setup.first, first!.id);
    expect(detail.payslip.id).toBe(first!.id);
    expect(detail.file.accessUrl).toMatch(/^https:\/\/storage\.example\.test\/payslips\//);
    await expect(reading.readOwn(setup.first, second!.id)).rejects.toMatchObject({
      code: 'PAYSLIP_NOT_FOUND',
    });
    // An Agency-wide grant still reads only the caller's own.
    await expect(
      reading.listOwn(as(setup.tenant, 3, ['payroll.payslips.read'])),
    ).resolves.toMatchObject([{ id: second!.id }]);
    // A Membership linked to no Employee has none.
    await expect(reading.listOwn(as(setup.tenant, 0, ['payroll.payslips.read']))).resolves.toEqual(
      [],
    );

    // A superseded Payslip is no longer readable. Test fixture only: the void command (#358) writes this.
    await seed((transaction) =>
      transaction.payslip.update({ where: { id: first!.id }, data: { status: 'SUPERSEDED' } }),
    );
    await expect(reading.listOwn(setup.first)).resolves.toEqual([]);
    await expect(reading.readOwn(setup.first, first!.id)).rejects.toMatchObject({
      code: 'PAYSLIP_NOT_FOUND',
    });
  });

  it('withholds one READY Payslip with a reason, hides it, and releases it singly with a reason', async () => {
    const setup = await releasablePeriod('WITHHOLD');
    const [first, second] = setup.payslips;

    await expect(withholding.withhold(setup.approver, first!.id, {})).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_INPUT',
    });
    await expect(
      withholding.withhold(setup.approver, first!.id, { reason: '   ' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    const withheld = await withholding.withhold(setup.approver, first!.id, {
      reason: 'Under review by the HRMO',
    });
    expect(withheld).toMatchObject({
      id: first!.id,
      payrollPeriodId: setup.periodId,
      status: 'WITHHELD',
      withheldByMembershipId: setup.approver.membershipId,
      withholdReason: 'Under review by the HRMO',
      releasedAt: null,
    });
    expect(
      await admin.auditEvent.findFirst({
        where: { agencyId: setup.agencyId, entityId: first!.id, action: 'PAYSLIP_WITHHELD' },
      }),
    ).toMatchObject({ reason: 'Under review by the HRMO', newStatus: 'WITHHELD' });
    await expect(
      withholding.withhold(setup.approver, first!.id, { reason: 'Again' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYSLIP_NOT_READY' });

    // The period's release leaves a WITHHELD Payslip withheld, and its Employee cannot read it.
    await expect(release.releasePeriod(setup.approver, setup.periodId)).resolves.toMatchObject({
      releasedPayslipIds: [second!.id],
    });
    expect((await setup.payslipOf(0)).status).toBe('WITHHELD');
    await expect(reading.listOwn(setup.first)).resolves.toEqual([]);
    await expect(reading.readOwn(setup.first, first!.id)).rejects.toMatchObject({
      code: 'PAYSLIP_NOT_FOUND',
    });

    // A RELEASED Payslip cannot be withheld, nor released singly.
    await expect(
      withholding.withhold(setup.approver, second!.id, { reason: 'Too late' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYSLIP_NOT_READY' });
    await expect(
      release.releaseWithheld(setup.approver, second!.id, { reason: 'Again' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYSLIP_NOT_WITHHELD' });

    await expect(release.releaseWithheld(setup.approver, first!.id, {})).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(
      release.releaseWithheld(setup.approver, first!.id, { reason: 'Review cleared' }),
    ).resolves.toMatchObject({
      status: 'RELEASED',
      releasedByMembershipId: setup.approver.membershipId,
      // The withholding stays on record.
      withholdReason: 'Under review by the HRMO',
    });
    expect(
      await admin.auditEvent.findFirst({
        where: { agencyId: setup.agencyId, entityId: first!.id, action: 'PAYSLIP_RELEASED' },
      }),
    ).toMatchObject({ reason: 'Review cleared', previousStatus: 'WITHHELD' });
    expect(
      await admin.outboxEvent.count({
        where: { agencyId: setup.agencyId, eventType: 'PAYSLIP_RELEASED', aggregateId: first!.id },
      }),
    ).toBe(1);
    await expect(reading.listOwn(setup.first)).resolves.toMatchObject([{ id: first!.id }]);
  });

  it('refuses a person who acts in another payroll function, and one without the permission Agency-wide', async () => {
    const setup = await releasablePeriod('FUNCTION');
    const [first] = setup.payslips;

    // The preparer holds release and withhold, but prepares this period.
    await expect(release.releasePeriod(setup.preparer, setup.periodId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_FUNCTION_CONFLICT',
      message: expect.stringMatching(/PREPARATION.*APPROVAL/),
    });
    await expect(
      withholding.withhold(setup.preparer, first!.id, { reason: 'Not mine to withhold' }),
    ).rejects.toMatchObject({ code: 'PAYROLL_FUNCTION_CONFLICT' });
    // Holding the permission only for oneself is not enough.
    await expect(
      release.releasePeriod(
        as(setup.tenant, 0, ['payroll.payslips.release'], 'OWN'),
        setup.periodId,
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: 'PAYSLIP_FORBIDDEN' });
    await expect(reading.listOwn(setup.approver)).rejects.toMatchObject({
      statusCode: 403,
      code: 'PAYSLIP_FORBIDDEN',
    });
    expect(
      (await admin.payslip.findMany({ where: { agencyId: setup.agencyId } })).map(
        (each) => each.status,
      ),
    ).toEqual(['READY', 'READY']);

    // A first command claims APPROVAL for the person, who keeps it.
    const fresh = as(setup.tenant, 2, ['payroll.payslips.release']);
    await release.releasePeriod(fresh, setup.periodId);
    expect(
      await admin.payrollPeriodActor.findUnique({
        where: {
          payrollPeriodId_membershipId: {
            payrollPeriodId: setup.periodId,
            membershipId: fresh.membershipId,
          },
        },
      }),
    ).toMatchObject({ payrollFunction: 'APPROVAL' });
  });

  it('refuses a period that is not FINALIZED', async () => {
    const setup = await releasablePeriod('STATUS');
    const draft = await seed((transaction) =>
      transaction.payrollPeriod.create({
        data: {
          agencyId: setup.agencyId,
          code: 'PAYSLIP-2875-04-STATUS',
          runType: 'REGULAR',
          periodFrom: new Date('2875-04-01'),
          periodTo: new Date('2875-04-30'),
          cutoffAt: new Date('2875-04-10T00:00:00Z'),
          paymentDate: new Date('2875-04-15'),
          status: 'DRAFT',
        },
      }),
    );
    await expect(release.releasePeriod(setup.approver, draft.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_PERIOD_NOT_FINALIZED',
    });
  });

  it("reads every Payslip of a period in its status, Agency-wide only, and never another Agency's", async () => {
    const setup = await releasablePeriod('PERIOD-READ');
    const other = await releasablePeriod('PERIOD-READ-AWAY');
    const [first, second] = setup.payslips;
    const officer = as(setup.tenant, 0, ['payroll.payslips.read']);
    // A FINALIZED result whose Payslip generation has not created yet. Test fixture only.
    const pending = await seed(async (transaction) => {
      const employee = await transaction.employee.create({
        data: {
          agencyId: setup.agencyId,
          employeeNumber: `PAYSLIP-PERIOD-READ-THIRD-${suffix}`,
          legalName: 'Payslip PERIOD-READ THIRD',
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `payslip-period-read-third-${suffix}@example.test`.toLowerCase(),
          serviceStatus: 'ACTIVE',
          createdByMembershipId: setup.approver.membershipId,
          updatedByMembershipId: setup.approver.membershipId,
        },
      });
      return transaction.payrollEmployee.create({
        data: {
          agencyId: setup.agencyId,
          payrollPeriodId: setup.periodId,
          calculationVersion: 1,
          employeeId: employee.id,
          compensationBasisSnapshot: {},
          status: 'FINALIZED',
          grossAmount: '0',
          totalDeductions: '0',
          netAmount: '0',
          calculationHash: 'f'.repeat(64),
        },
      });
    });

    await withholding.withhold(setup.approver, first!.id, { reason: 'Held for review' });
    await release.releasePeriod(setup.approver, setup.periodId);
    const entries = await reading.listPeriod(officer, setup.periodId);
    expect(
      entries.map((entry) => [entry.employee.legalName, entry.payslip?.status ?? null]),
    ).toEqual([
      ['Payslip PERIOD-READ FIRST', 'WITHHELD'],
      ['Payslip PERIOD-READ SECOND', 'RELEASED'],
      ['Payslip PERIOD-READ THIRD', null],
    ]);
    expect(entries[0]).toMatchObject({
      payrollEmployeeId: setup.results[0]!.id,
      payslip: {
        id: first!.id,
        withholdReason: 'Held for review',
        payrollPeriodId: setup.periodId,
      },
    });
    expect(entries[1]!.payslip).toMatchObject({ id: second!.id });
    expect(entries[2]!.payrollEmployeeId).toBe(pending.id);

    // The own read, held at any scope short of Agency-wide, does not reach the period read.
    await expect(reading.listPeriod(setup.first, setup.periodId)).rejects.toMatchObject({
      statusCode: 403,
      code: 'PAYSLIP_FORBIDDEN',
    });
    // Another Agency's officer does not find the period, and reads only their own.
    await expect(
      reading.listPeriod(as(other.tenant, 0, ['payroll.payslips.read']), setup.periodId),
    ).rejects.toMatchObject({ statusCode: 404, code: 'PAYROLL_PERIOD_NOT_FOUND' });
    await expect(
      reading.listPeriod(as(other.tenant, 0, ['payroll.payslips.read']), other.periodId),
    ).resolves.toHaveLength(2);
  });

  it('rejects another Agency, in the service and under row-level security', async () => {
    const setup = await releasablePeriod('HOME');
    const other = await releasablePeriod('AWAY');
    const [first] = setup.payslips;
    await release.releasePeriod(setup.approver, setup.periodId);

    await expect(release.releasePeriod(other.approver, setup.periodId)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PAYROLL_PERIOD_NOT_FOUND',
    });
    await expect(
      withholding.withhold(other.approver, setup.payslips[1]!.id, { reason: 'Not ours' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'PAYSLIP_NOT_FOUND' });
    await expect(
      release.releaseWithheld(other.approver, first!.id, { reason: 'Not ours' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'PAYSLIP_NOT_FOUND' });
    await expect(reading.readOwn(other.first, first!.id)).rejects.toMatchObject({
      code: 'PAYSLIP_NOT_FOUND',
    });
    expect(
      await withDatabaseContext({ agencyId: other.agencyId }, (transaction) =>
        transaction.payslip.findMany({ where: { id: first!.id } }),
      ),
    ).toEqual([]);
    expect(
      await withDatabaseContext({ agencyId: other.agencyId }, (transaction) =>
        transaction.payslip.updateMany({
          where: { id: other.payslips[0]!.id },
          data: { agencyId: setup.agencyId },
        }),
      ).catch((error: unknown) => (error instanceof Error ? error.message : error)),
    ).toMatch(/permission denied|row-level security/);
  });

  it('admits release and withholding only on a FINALIZED period by a person acting in APPROVAL, and only their own columns', async () => {
    const setup = await releasablePeriod('GUARD');
    const [first, second] = setup.payslips;
    const update = (sql: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
      withDatabaseContext({ agencyId: setup.agencyId }, async (transaction) => {
        await sql(transaction);
      });
    const preparerId = setup.preparer.membershipId;
    const approverId = setup.approver.membershipId;

    // The preparer holds PREPARATION, not APPROVAL.
    await expect(
      update(
        (transaction) =>
          transaction.$executeRaw`UPDATE payslips SET status = 'RELEASED', released_at = now(), released_by_membership_id = CAST(${preparerId} AS uuid) WHERE id = CAST(${first!.id} AS uuid)`,
      ),
    ).rejects.toThrow(/by a person acting in its APPROVAL function/);
    await expect(
      update(
        (transaction) =>
          transaction.$executeRaw`UPDATE payslips SET status = 'WITHHELD', withheld_at = now(), withheld_by_membership_id = CAST(${approverId} AS uuid) WHERE id = CAST(${first!.id} AS uuid)`,
      ),
    ).rejects.toThrow(/records only who withheld it, when, and why/);
    await expect(
      update(
        (transaction) =>
          transaction.$executeRaw`UPDATE payslips SET status = 'RELEASED', released_at = now(), released_by_membership_id = CAST(${approverId} AS uuid), withhold_reason = 'x' WHERE id = CAST(${first!.id} AS uuid)`,
      ),
    ).rejects.toThrow(/records only who released it and when/);
    await expect(
      update(
        (transaction) =>
          transaction.$executeRaw`UPDATE payslips SET status = 'SUPERSEDED' WHERE id = CAST(${first!.id} AS uuid)`,
      ),
    ).rejects.toThrow(/superseded, changing nothing else, only by the void of its payroll/);

    await withholding.withhold(setup.approver, first!.id, { reason: 'Held for review' });
    await release.releasePeriod(setup.approver, setup.periodId);
    await expect(
      update(
        (transaction) =>
          transaction.$executeRaw`UPDATE payslips SET withhold_reason = 'Changed' WHERE id = CAST(${first!.id} AS uuid)`,
      ),
    ).rejects.toThrow(/A Payslip changes only GENERATING → READY/);
    await expect(
      update(
        (transaction) =>
          transaction.$executeRaw`UPDATE payslips SET status = 'WITHHELD', withheld_at = now(), withheld_by_membership_id = CAST(${approverId} AS uuid), withhold_reason = 'Too late' WHERE id = CAST(${second!.id} AS uuid)`,
      ),
    ).rejects.toThrow(/A Payslip changes only GENERATING → READY/);
  });

  it('seeds release and withhold to the Payroll Approver alone, the own read to the Employee, and the Agency-wide read as §6.10 marks it A or R (0197)', async () => {
    const grants = await admin.rolePermission.findMany({
      where: {
        role: { agencyId: null },
        permission: { code: { startsWith: 'payroll.payslips.' } },
      },
      select: {
        scopePolicy: true,
        role: { select: { code: true } },
        permission: { select: { code: true } },
      },
    });
    expect(
      grants
        .map((grant) => `${grant.permission.code} ${grant.role.code} ${grant.scopePolicy}`)
        .sort(),
    ).toEqual([
      'payroll.payslips.read accounting_reviewer AGENCY',
      'payroll.payslips.read cashier AGENCY',
      'payroll.payslips.read employee OWN',
      'payroll.payslips.read internal_auditor AGENCY',
      'payroll.payslips.read payroll_approver AGENCY',
      'payroll.payslips.read payroll_preparer AGENCY',
      'payroll.payslips.release payroll_approver AGENCY',
      'payroll.payslips.withhold payroll_approver AGENCY',
    ]);
  });
});
