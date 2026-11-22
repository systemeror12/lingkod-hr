import { createHash, randomUUID } from 'node:crypto';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupPayrollTenants,
  cleanupPlatformFixtures,
  createAdminClient,
  createPayrollTenant,
  FIXTURE_PREFIX,
  type PayrollTenant,
} from '../payroll-periods/payroll-periods.test-fixtures';
import { CONTRIBUTION_REMITTANCE_STATEMENT } from './contribution-remittance-contract';
import { ContributionRemittancesService } from './contribution-remittances.service';

const enabled = process.env.DATABASE_E2E === 'true';

/** One Employee's Contribution Lines, as [type, employee share, employer share]. */
type LineSpec = [string, string, string];

interface EmployeeSpec {
  number: string;
  lines: LineSpec[];
  /** A result of an earlier calculation version, whose lines no output may carry. */
  stale?: boolean;
}

const sha256 = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');

describe.skipIf(!enabled)('Contribution remittance schedules in PostgreSQL', () => {
  const suffix = `${Date.now()}-contribution-remittance`;
  const service = new ContributionRemittancesService();
  let admin: PrismaClient;
  let ruleVersionId: string;
  let contractVersionId: string;
  const tenants: PayrollTenant[] = [];

  beforeAll(async () => {
    admin = await createAdminClient();
    const version = await admin.nationalPayrollRuleVersion.create({
      data: {
        ruleKind: 'GSIS_CONTRIBUTION',
        code: `${FIXTURE_PREFIX}CONTRIBUTION-${suffix}`,
        name: 'Test contribution rates',
        issuingAuthority: 'Test authority',
        issuanceReference: 'Test fixture, not an issuance',
        sourceUrl: 'https://example.test/contribution',
        verifiedOn: new Date('2026-11-22'),
        verifiedBy: 'LingkodHR test fixture',
        effectiveFrom: new Date('2875-01-01'),
        effectiveTo: new Date('2875-12-31'),
      },
    });
    ruleVersionId = version.id;
    contractVersionId = (
      await admin.payrollExportContractVersion.findUniqueOrThrow({
        where: { code_version: { code: 'CONTRIBUTION_REMITTANCE', version: 1 } },
      })
    ).id;
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      for (const { agency } of tenants) {
        const where = { agencyId: agency.id };
        await transaction.remittanceSchedule.deleteMany({ where });
        await transaction.contributionSummary.deleteMany({ where });
        await transaction.employee.deleteMany({ where });
      }
    });
    await cleanupPayrollTenants(admin, tenants);
    await cleanupPlatformFixtures(admin, suffix);
    await admin.$disconnect();
  });

  /** Fixture rows written with triggers off, standing in for what finalization wrote. */
  const seed = <T>(run: (transaction: Prisma.TransactionClient) => Promise<T>) =>
    admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      return run(transaction);
    });

  /**
   * An Agency of its own with a REGULAR March 2875 period in `status` at
   * calculation version 2, one result per spec, and its Contribution Lines.
   * Two people hold `payroll.registers.generate`; a third holds only
   * `payroll.periods.read`.
   */
  async function finalizedPayroll(label: string, specs: EmployeeSpec[], status = 'FINALIZED') {
    const tenant = await createPayrollTenant(admin, suffix, `CONTRIBUTION-${label}`, 3);
    tenants.push(tenant);
    const { agency, persons } = tenant;
    const membershipId = persons[0]!.membership.id;
    const as = (index: number, codes: string[]): RequestContext => ({
      ...persons[index]!.context,
      permissions: codes.map((code) => ({ code, scopePolicy: 'AGENCY' as const })),
    });
    const periodId = await seed(async (transaction) => {
      const period = await transaction.payrollPeriod.create({
        data: {
          agencyId: agency.id,
          code: `PAY-2875-03-${label}`,
          runType: 'REGULAR',
          periodFrom: new Date('2875-03-01'),
          periodTo: new Date('2875-03-31'),
          cutoffAt: new Date('2875-03-20T00:00:00Z'),
          paymentDate: new Date('2875-03-31'),
          status,
          calculationVersion: 2,
          finalizedAt: status === 'FINALIZED' ? new Date() : null,
        },
      });
      for (const spec of specs) {
        const employee = await transaction.employee.create({
          data: {
            agencyId: agency.id,
            employeeNumber: `${spec.number}-${label}`,
            legalName: `Member ${spec.number}`,
            birthDate: new Date('1990-01-01'),
            sex: 'FEMALE',
            civilStatus: 'SINGLE',
            contactEmail:
              `contribution-${label}-${spec.number}-${suffix}@example.test`.toLowerCase(),
            serviceStatus: 'ACTIVE',
            createdByMembershipId: membershipId,
            updatedByMembershipId: membershipId,
          },
        });
        const result = await transaction.payrollEmployee.create({
          data: {
            agencyId: agency.id,
            payrollPeriodId: period.id,
            calculationVersion: spec.stale ? 1 : 2,
            employeeId: employee.id,
            compensationBasisSnapshot: {},
            status: status === 'FINALIZED' && !spec.stale ? 'FINALIZED' : 'CALCULATED',
            grossAmount: '30000',
            totalDeductions: '0',
            netAmount: '30000',
            calculationHash: 'f'.repeat(64),
          },
        });
        for (const [contributionType, employeeShare, employerShare] of spec.lines) {
          await transaction.contributionLine.create({
            data: {
              agencyId: agency.id,
              payrollEmployeeId: result.id,
              contributionType,
              employeeShare,
              employerShare,
              compensationBase: '30000',
              ruleVersionId,
            },
          });
        }
      }
      return period.id;
    });
    return {
      tenant,
      periodId,
      preparer: as(0, ['payroll.registers.generate']),
      approver: as(1, ['payroll.registers.generate', 'payroll.periods.read']),
      reader: as(2, ['payroll.periods.read']),
    };
  }

  const summariesOf = (agencyId: string) =>
    admin.contributionSummary.count({ where: { agencyId } });

  it('generates a schedule per type whose totals equal its lines, and returns the same artifacts again', async () => {
    const payroll = await finalizedPayroll('HAPPY', [
      {
        number: 'E-002',
        lines: [
          ['GSIS', '1800.00', '2400.00'],
          ['PAGIBIG', '200.00', '200.00'],
          ['EMPLOYEES_COMPENSATION', '0', '100.00'],
        ],
      },
      {
        number: 'E-001',
        lines: [
          ['GSIS', '2700.00', '3600.00'],
          ['PHILHEALTH', '750.00', '750.00'],
          ['PAGIBIG', '200.00', '200.00'],
          ['EMPLOYEES_COMPENSATION', '0', '100.00'],
        ],
      },
      { number: 'E-003', stale: true, lines: [['GSIS', '9999.00', '9999.00']] },
    ]);

    const generated = await service.generate(payroll.preparer, payroll.periodId);
    expect(generated).toMatchObject({
      payrollPeriodId: payroll.periodId,
      calculationVersion: 2,
      contract: { code: 'CONTRIBUTION_REMITTANCE', version: 1 },
      generatedByMembershipId: payroll.preparer.membershipId,
    });
    expect(
      generated.schedules.map((schedule) => [
        schedule.contributionType,
        schedule.lineCount,
        schedule.employeeShareTotal,
        schedule.employerShareTotal,
        schedule.totalAmount,
      ]),
    ).toEqual([
      ['GSIS', 2, '4500.0000', '6000.0000', '10500.0000'],
      ['PHILHEALTH', 1, '750.0000', '750.0000', '1500.0000'],
      ['PAGIBIG', 2, '400.0000', '400.0000', '800.0000'],
      ['EMPLOYEES_COMPENSATION', 2, '0.0000', '200.0000', '200.0000'],
    ]);

    const gsis = JSON.parse(generated.schedules[0]!.content) as {
      artifact: string;
      statement: string;
      lines: { agencyEmployeeNumber: string; employeeShare: string; ruleVersion: unknown }[];
    };
    expect(gsis.artifact).toBe('REMITTANCE_SCHEDULE');
    expect(gsis.statement).toBe(CONTRIBUTION_REMITTANCE_STATEMENT);
    expect(gsis.lines.map((line) => [line.agencyEmployeeNumber, line.employeeShare])).toEqual([
      ['E-001-HAPPY', '2700.0000'],
      ['E-002-HAPPY', '1800.0000'],
    ]);
    expect(gsis.lines[0]!.ruleVersion).toEqual({
      id: ruleVersionId,
      code: `${FIXTURE_PREFIX}CONTRIBUTION-${suffix}`,
    });
    for (const artifact of [generated, ...generated.schedules]) {
      expect(sha256(artifact.content)).toBe(artifact.checksum);
    }
    const summary = JSON.parse(generated.content) as {
      contributions: { scheduleChecksum: string }[];
      totals: unknown;
    };
    expect(summary.contributions.map((entry) => entry.scheduleChecksum)).toEqual(
      generated.schedules.map((schedule) => schedule.checksum),
    );
    expect(summary.totals).toEqual({
      lineCount: 7,
      employeeShareTotal: '5650.0000',
      employerShareTotal: '7350.0000',
      totalAmount: '13000.0000',
    });

    // Generating again, by anyone permitted, returns the stored artifacts and writes nothing.
    const again = await service.generate(payroll.approver, payroll.periodId);
    expect(again).toEqual(generated);
    expect(await summariesOf(payroll.tenant.agency.id)).toBe(1);
    expect(await service.read(payroll.approver, payroll.periodId, generated.id)).toEqual(generated);

    const events = await admin.auditEvent.findMany({
      where: { agencyId: payroll.tenant.agency.id, entityId: generated.id },
      select: { action: true, actorMembershipId: true, metadata: true },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'CONTRIBUTION_REMITTANCE_GENERATED',
      actorMembershipId: payroll.preparer.membershipId,
      metadata: { payrollPeriodId: payroll.periodId, checksum: generated.checksum },
    });

    // The artifacts never change, even for the database owner.
    await expect(
      admin.contributionSummary.update({
        where: { id: generated.id },
        data: { calculationVersion: 1 },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      admin.remittanceSchedule.deleteMany({ where: { contributionSummaryId: generated.id } }),
    ).rejects.toThrow(/immutable/);
  });

  it('gives a payroll with no contribution line four empty schedules', async () => {
    const payroll = await finalizedPayroll('EMPTY', [{ number: 'E-001', lines: [] }]);
    const generated = await service.generate(payroll.preparer, payroll.periodId);
    expect(
      generated.schedules.map((schedule) => [schedule.lineCount, schedule.totalAmount]),
    ).toEqual([
      [0, '0.0000'],
      [0, '0.0000'],
      [0, '0.0000'],
      [0, '0.0000'],
    ]);
  });

  it('refuses a payroll that is not FINALIZED', async () => {
    const payroll = await finalizedPayroll(
      'APPROVED',
      [{ number: 'E-001', lines: [['GSIS', '100.00', '100.00']] }],
      'APPROVED',
    );
    await expect(service.generate(payroll.preparer, payroll.periodId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONTRIBUTION_REMITTANCE_PAYROLL_NOT_FINALIZED',
    });
    expect(await summariesOf(payroll.tenant.agency.id)).toBe(0);
  });

  it('needs payroll.registers.generate to generate or read', async () => {
    const payroll = await finalizedPayroll('FORBIDDEN', [
      { number: 'E-001', lines: [['GSIS', '100.00', '100.00']] },
    ]);
    await expect(service.generate(payroll.reader, payroll.periodId)).rejects.toMatchObject({
      statusCode: 403,
      code: 'CONTRIBUTION_REMITTANCE_FORBIDDEN',
    });
    const generated = await service.generate(payroll.preparer, payroll.periodId);
    await expect(
      service.read(payroll.reader, payroll.periodId, generated.id),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.read(payroll.preparer, randomUUID(), generated.id)).rejects.toMatchObject({
      statusCode: 404,
      code: 'CONTRIBUTION_SUMMARY_NOT_FOUND',
    });
    await expect(service.generate(payroll.preparer, randomUUID())).rejects.toMatchObject({
      statusCode: 404,
      code: 'PAYROLL_PERIOD_NOT_FOUND',
    });
  });

  describe('database guards', () => {
    const content = '{}';
    const summaryRow = (payroll: Awaited<ReturnType<typeof finalizedPayroll>>, id: string) => ({
      id,
      agencyId: payroll.tenant.agency.id,
      payrollPeriodId: payroll.periodId,
      calculationVersion: 2,
      payrollExportContractVersionId: contractVersionId,
      generatedByMembershipId: payroll.preparer.membershipId,
      generatedAt: new Date(),
      content,
      checksum: sha256(content),
    });
    const scheduleRow = (
      payroll: Awaited<ReturnType<typeof finalizedPayroll>>,
      summaryId: string,
      contributionType: string,
      employeeShareTotal = '0',
      employerShareTotal = '0',
      lineCount = 0,
    ) => ({
      agencyId: payroll.tenant.agency.id,
      contributionSummaryId: summaryId,
      contributionType,
      lineCount,
      employeeShareTotal,
      employerShareTotal,
      totalAmount: (Number(employeeShareTotal) + Number(employerShareTotal)).toFixed(4),
      content,
      checksum: sha256(content),
    });

    it('admits a schedule only when its totals equal its contribution lines', async () => {
      const payroll = await finalizedPayroll('GUARD-TOTALS', [
        { number: 'E-001', lines: [['GSIS', '100.00', '120.00']] },
      ]);
      const id = randomUUID();
      await expect(
        withDatabaseContext(payroll.tenant.persons[0]!.scope, async (transaction) => {
          await transaction.contributionSummary.create({ data: summaryRow(payroll, id) });
          await transaction.remittanceSchedule.create({
            data: scheduleRow(payroll, id, 'GSIS', '100.00', '119.99', 1),
          });
        }),
      ).rejects.toThrow(/totals equal the Contribution Lines/);
      expect(await summariesOf(payroll.tenant.agency.id)).toBe(0);
    });

    it('commits a summary only with a schedule of every type', async () => {
      const payroll = await finalizedPayroll('GUARD-COUNT', [{ number: 'E-001', lines: [] }]);
      const id = randomUUID();
      await expect(
        withDatabaseContext(payroll.tenant.persons[0]!.scope, async (transaction) => {
          await transaction.contributionSummary.create({ data: summaryRow(payroll, id) });
          for (const type of ['GSIS', 'PHILHEALTH', 'PAGIBIG']) {
            await transaction.remittanceSchedule.create({ data: scheduleRow(payroll, id, type) });
          }
        }),
      ).rejects.toThrow(/one Remittance Schedule for each/);
      expect(await summariesOf(payroll.tenant.agency.id)).toBe(0);
    });

    it('admits a schedule only with its new summary', async () => {
      const payroll = await finalizedPayroll('GUARD-LATE', [{ number: 'E-001', lines: [] }]);
      const generated = await service.generate(payroll.preparer, payroll.periodId);
      await expect(
        withDatabaseContext(payroll.tenant.persons[0]!.scope, (transaction) =>
          transaction.remittanceSchedule.create({
            data: scheduleRow(payroll, generated.id, 'GSIS'),
          }),
        ),
      ).rejects.toThrow(/written only with its new Contribution Summary/);
    });
  });
});
