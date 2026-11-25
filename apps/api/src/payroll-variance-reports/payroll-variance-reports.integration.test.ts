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
  type PayrollTenant,
} from '../payroll-periods/payroll-periods.test-fixtures';
import { PAYROLL_VARIANCE_REPORT_STATEMENT } from './payroll-variance-report-contract';
import { PayrollVarianceReportsService } from './payroll-variance-reports.service';

const enabled = process.env.DATABASE_E2E === 'true';

/** A result's lines, as [component code, line type, amount]. */
type LineSpec = [string, string, string];

interface PeriodSpec {
  code: string;
  runType?: string;
  month: string;
  status?: string;
  version?: number;
  /** Employee number to the lines of their result at the period's version. */
  results: Record<string, LineSpec[]>;
}

interface Report {
  statement: string;
  variance: {
    status: string;
    reason?: string;
    priorComparablePeriod?: { code: string; calculationVersion: number };
    employees?: {
      agencyEmployeeNumber: string;
      inPriorPeriod: boolean;
      inThisPeriod: boolean;
      priorNetAmount: string | null;
      netAmount: string | null;
      components: {
        componentCode: string;
        priorAmount: string | null;
        currentAmount: string | null;
      }[];
    }[];
  };
  exceptions: {
    calculationVersion: number;
    exceptionType: string;
    status: string;
    employee: { agencyEmployeeNumber: string } | null;
    decision: { reason: string; decidedByMembershipId: string } | null;
    holds: { reason: string }[];
  }[];
}

const sha256 = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');

describe.skipIf(!enabled)('Payroll Variance and Exception Report in PostgreSQL', () => {
  const suffix = `${Date.now()}-variance-report`;
  const service = new PayrollVarianceReportsService();
  let admin: PrismaClient;
  let componentId: (code: string) => string;
  const tenants: PayrollTenant[] = [];

  beforeAll(async () => {
    admin = await createAdminClient();
    const components = await admin.payComponent.findMany({
      where: { code: { in: ['BASIC_SALARY', 'PERA', 'GSIS_PERSONAL_SHARE'] } },
    });
    componentId = (code) => components.find((each) => each.code === code)!.id;
  });

  afterAll(async () => {
    if (!admin) return;
    await seed(async (transaction) => {
      const where = { agencyId: { in: tenants.map((each) => each.agency.id) } };
      await transaction.payrollVarianceReport.deleteMany({ where });
      await transaction.payrollHold.deleteMany({ where });
      await transaction.payrollLine.deleteMany({ where });
      await transaction.payrollException.deleteMany({ where });
      await transaction.payrollEmployee.deleteMany({ where });
      await transaction.employee.deleteMany({ where });
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
   * An Agency of its own with the given periods of 2875, each `FINALIZED`
   * unless stated, its results `FINALIZED` at the period's version, and
   * replaced results of the version before, which no report may read. Two people hold
   * `payroll.registers.generate`; a third holds only `payroll.periods.read`.
   */
  async function agencyWith(label: string, periods: PeriodSpec[]) {
    const tenant = await createPayrollTenant(admin, suffix, `VARIANCE-${label}`, 3);
    tenants.push(tenant);
    const { agency, persons } = tenant;
    const agencyId = agency.id;
    const membershipId = persons[0]!.membership.id;
    const as = (index: number, codes: string[]): RequestContext => ({
      ...persons[index]!.context,
      permissions: codes.map((code) => ({ code, scopePolicy: 'AGENCY' as const })),
    });
    const employees = new Map<string, string>();
    const employeeId = async (transaction: Prisma.TransactionClient, number: string) => {
      const known = employees.get(number);
      if (known) return known;
      const employee = await transaction.employee.create({
        data: {
          agencyId,
          employeeNumber: `${number}-${label}`,
          legalName: `Member ${number}`,
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `variance-${label}-${number}-${suffix}@example.test`.toLowerCase(),
          serviceStatus: 'ACTIVE',
          createdByMembershipId: membershipId,
          updatedByMembershipId: membershipId,
        },
      });
      employees.set(number, employee.id);
      return employee.id;
    };
    const periodIds = await seed(async (transaction) => {
      const ids: Record<string, string> = {};
      for (const spec of periods) {
        const status = spec.status ?? 'FINALIZED';
        const version = spec.version ?? 2;
        const lastDay = new Date(Date.UTC(2875, Number(spec.month), 0)).toISOString().slice(0, 10);
        const period = await transaction.payrollPeriod.create({
          data: {
            agencyId,
            code: `${spec.code}-${label}`,
            runType: spec.runType ?? 'REGULAR',
            periodFrom: new Date(`2875-${spec.month}-01`),
            periodTo: new Date(lastDay),
            cutoffAt: new Date(`2875-${spec.month}-20T00:00:00Z`),
            paymentDate: new Date(lastDay),
            status,
            calculationVersion: version,
            finalizedAt: status === 'FINALIZED' ? new Date(`${lastDay}T00:00:00Z`) : null,
          },
        });
        ids[spec.code] = period.id;
        for (const [number, lines] of Object.entries(spec.results)) {
          const sum = (type: string) =>
            lines
              .filter(([, lineType]) => lineType === type)
              .reduce((total, [, , amount]) => total + Number(amount), 0);
          const deductions = sum('DEDUCTION');
          for (const [calculationVersion, resultStatus] of [
            [version, status === 'FINALIZED' ? 'FINALIZED' : 'CALCULATED'],
            [version - 1, 'CALCULATED'],
          ] as const) {
            if (calculationVersion < 1) continue;
            const result = await transaction.payrollEmployee.create({
              data: {
                agencyId,
                payrollPeriodId: period.id,
                calculationVersion,
                employeeId: await employeeId(transaction, number),
                compensationBasisSnapshot: {},
                status: resultStatus,
                // A replaced result's pay differs, so reading it would show.
                grossAmount: String(sum('EARNING') + (calculationVersion === version ? 0 : 999)),
                totalDeductions: String(deductions),
                netAmount: String(
                  sum('EARNING') - deductions + (calculationVersion === version ? 0 : 999),
                ),
                calculationHash: 'f'.repeat(64),
              },
            });
            await transaction.payrollLine.createMany({
              data: lines.map(([code, lineType, amount]) => ({
                agencyId,
                payrollEmployeeId: result.id,
                payComponentId: componentId(code),
                lineType,
                amount: calculationVersion === version ? amount : '1',
                sourceSnapshot: {},
              })),
            });
          }
        }
      }
      return ids;
    });
    return {
      tenant,
      periodIds,
      employeeId: (number: string) => seed((transaction) => employeeId(transaction, number)),
      preparer: as(0, ['payroll.registers.generate']),
      approver: as(1, ['payroll.registers.generate', 'payroll.periods.read']),
      reader: as(2, ['payroll.periods.read']),
    };
  }

  const reportsOf = (agencyId: string) =>
    admin.payrollVarianceReport.count({ where: { agencyId } });
  const parse = (content: string) => JSON.parse(content) as Report;

  it('compares with the last FINALIZED regular period, by Employee and component, and lists every exception', async () => {
    const payroll = await agencyWith('HAPPY', [
      {
        code: 'PAY-2875-01',
        month: '01',
        results: { 'E-001': [['BASIC_SALARY', 'EARNING', '1.00']] },
      },
      {
        code: 'PAY-2875-02',
        month: '02',
        version: 1,
        results: {
          'E-001': [
            ['BASIC_SALARY', 'EARNING', '30000.00'],
            ['PERA', 'EARNING', '2000.00'],
            ['GSIS_PERSONAL_SHARE', 'DEDUCTION', '2700.00'],
          ],
          'E-003': [['BASIC_SALARY', 'EARNING', '25000.00']],
        },
      },
      // A later special run is never the prior comparable period.
      { code: 'SPECIAL-2875-02', runType: 'SPECIAL', month: '02', results: {} },
      {
        code: 'PAY-2875-03',
        month: '03',
        results: {
          // PERA removed.
          'E-001': [
            ['BASIC_SALARY', 'EARNING', '30000.00'],
            ['GSIS_PERSONAL_SHARE', 'DEDUCTION', '2700.00'],
          ],
          // A new Employee.
          'E-002': [['BASIC_SALARY', 'EARNING', '20000.00']],
          // Unchanged, so not listed.
          'E-003': [['BASIC_SALARY', 'EARNING', '25000.00']],
        },
      },
    ]);
    const periodId = payroll.periodIds['PAY-2875-03']!;
    const agencyId = payroll.tenant.agency.id;
    const decider = payroll.preparer.membershipId;
    const held = await payroll.employeeId('E-004');
    const first = await payroll.employeeId('E-001');
    await seed(async (transaction) => {
      const blocking = await transaction.payrollException.create({
        data: {
          agencyId,
          payrollPeriodId: periodId,
          calculationVersion: 1,
          employeeId: held,
          exceptionType: 'BASIC_SALARY_MISSING',
          severity: 'BLOCKING',
          status: 'OPEN',
          details: { message: 'No basic salary line.' },
        },
      });
      await transaction.payrollHold.create({
        data: {
          agencyId,
          payrollPeriodId: periodId,
          employeeId: held,
          payrollExceptionId: blocking.id,
          reason: 'Awaiting the appointment papers.',
          placedByMembershipId: decider,
        },
      });
      await transaction.payrollException.create({
        data: {
          agencyId,
          payrollPeriodId: periodId,
          calculationVersion: 2,
          employeeId: first,
          exceptionType: 'NET_PAY_VARIANCE',
          severity: 'WARNING',
          status: 'ACKNOWLEDGED',
          details: { message: 'Net pay is down 2000.' },
          reason: 'PERA ended with the detail.',
          resolvedByMembershipId: decider,
        },
      });
    });

    const generated = await service.generate(payroll.preparer, periodId);
    expect(generated).toMatchObject({
      payrollPeriodId: periodId,
      calculationVersion: 2,
      contract: { code: 'PAYROLL_VARIANCE_EXCEPTION_REPORT', version: 1 },
      generatedByMembershipId: payroll.preparer.membershipId,
    });
    expect(sha256(generated.content)).toBe(generated.checksum);

    const report = parse(generated.content);
    expect(report.statement).toBe(PAYROLL_VARIANCE_REPORT_STATEMENT);
    expect(report.variance.status).toBe('COMPARED');
    expect(report.variance.priorComparablePeriod).toMatchObject({
      code: 'PAY-2875-02-HAPPY',
      calculationVersion: 1,
    });
    expect(report.variance.employees).toEqual([
      expect.objectContaining({
        agencyEmployeeNumber: 'E-001-HAPPY',
        inPriorPeriod: true,
        inThisPeriod: true,
        priorNetAmount: '29300.0000',
        netAmount: '27300.0000',
        components: [
          expect.objectContaining({
            componentCode: 'PERA',
            priorAmount: '2000.0000',
            currentAmount: null,
          }),
        ],
      }),
      expect.objectContaining({
        agencyEmployeeNumber: 'E-002-HAPPY',
        inPriorPeriod: false,
        inThisPeriod: true,
        priorNetAmount: null,
        netAmount: '20000.0000',
        components: [
          expect.objectContaining({
            componentCode: 'BASIC_SALARY',
            priorAmount: null,
            currentAmount: '20000.0000',
          }),
        ],
      }),
    ]);
    expect(report.exceptions).toEqual([
      expect.objectContaining({
        calculationVersion: 1,
        exceptionType: 'BASIC_SALARY_MISSING',
        status: 'OPEN',
        employee: expect.objectContaining({ agencyEmployeeNumber: 'E-004-HAPPY' }),
        decision: null,
        holds: [expect.objectContaining({ reason: 'Awaiting the appointment papers.' })],
      }),
      expect.objectContaining({
        calculationVersion: 2,
        exceptionType: 'NET_PAY_VARIANCE',
        status: 'ACKNOWLEDGED',
        decision: { reason: 'PERA ended with the detail.', decidedByMembershipId: decider },
        holds: [],
      }),
    ]);

    // Generating again, by anyone permitted, returns the stored report and writes nothing.
    const again = await service.generate(payroll.approver, periodId);
    expect(again).toEqual(generated);
    expect(await reportsOf(agencyId)).toBe(1);
    const events = await admin.auditEvent.findMany({
      where: { agencyId, entityId: generated.id },
      select: { action: true, actorMembershipId: true, metadata: true },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'PAYROLL_VARIANCE_REPORT_GENERATED',
      actorMembershipId: payroll.preparer.membershipId,
      metadata: {
        payrollPeriodId: periodId,
        priorPayrollPeriodId: payroll.periodIds['PAY-2875-02'],
        checksum: generated.checksum,
      },
    });

    // The report never changes, even for the database owner.
    await expect(
      admin.payrollVarianceReport.update({
        where: { id: generated.id },
        data: { calculationVersion: 1 },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      admin.payrollVarianceReport.delete({ where: { id: generated.id } }),
    ).rejects.toThrow(/immutable/);
  });

  it('says there is no prior comparable period rather than reporting zero variance', async () => {
    const results: PeriodSpec['results'] = { 'E-001': [['BASIC_SALARY', 'EARNING', '30000.00']] };
    const payroll = await agencyWith('NO-PRIOR', [
      // Not FINALIZED, so not comparable.
      { code: 'PAY-2875-01', month: '01', status: 'APPROVED', results },
      { code: 'PAY-2875-02', month: '02', results },
      { code: 'BONUS-2875', runType: 'SPECIAL', month: '05', results },
    ]);

    const regular = parse(
      (await service.generate(payroll.preparer, payroll.periodIds['PAY-2875-02']!)).content,
    );
    expect(regular.variance).toEqual({
      status: 'NO_PRIOR_COMPARABLE_PERIOD',
      reason:
        'The Agency has no FINALIZED regular Payroll Period before this one, so nothing is compared.',
    });

    const special = parse(
      (await service.generate(payroll.preparer, payroll.periodIds['BONUS-2875']!)).content,
    );
    expect(special.variance).toEqual({
      status: 'NO_PRIOR_COMPARABLE_PERIOD',
      reason:
        'Payroll Period BONUS-2875-NO-PRIOR is a SPECIAL run, and only a regular run has a prior comparable period, so nothing is compared.',
    });
  });

  it('reads the period’s report only once generated, to the permitted of its own Agency', async () => {
    const results: PeriodSpec['results'] = { 'E-001': [['BASIC_SALARY', 'EARNING', '1.00']] };
    const payroll = await agencyWith('READ', [{ code: 'PAY-2875-02', month: '02', results }]);
    const other = await agencyWith('READ-OTHER', [{ code: 'PAY-2875-02', month: '02', results }]);
    const periodId = payroll.periodIds['PAY-2875-02']!;

    expect(await service.read(payroll.preparer, periodId)).toBeNull();
    const generated = await service.generate(payroll.preparer, periodId);
    expect(await service.read(payroll.approver, periodId)).toEqual(generated);
    expect(await reportsOf(payroll.tenant.agency.id)).toBe(1);

    await expect(service.read(payroll.reader, periodId)).rejects.toMatchObject({
      statusCode: 403,
      code: 'PAYROLL_VARIANCE_REPORT_FORBIDDEN',
    });
    await expect(service.read(other.preparer, periodId)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PAYROLL_PERIOD_NOT_FOUND',
    });
  });

  it('refuses a payroll that is not FINALIZED, without the permission, or of another Agency', async () => {
    const results: PeriodSpec['results'] = { 'E-001': [['BASIC_SALARY', 'EARNING', '1.00']] };
    const payroll = await agencyWith('REFUSED', [
      { code: 'PAY-2875-01', month: '01', status: 'APPROVED', results },
      { code: 'PAY-2875-02', month: '02', results },
    ]);
    const other = await agencyWith('OTHER', [{ code: 'PAY-2875-02', month: '02', results }]);

    await expect(
      service.generate(payroll.preparer, payroll.periodIds['PAY-2875-01']!),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_VARIANCE_REPORT_PAYROLL_NOT_FINALIZED',
    });
    await expect(
      service.generate(payroll.reader, payroll.periodIds['PAY-2875-02']!),
    ).rejects.toMatchObject({ statusCode: 403, code: 'PAYROLL_VARIANCE_REPORT_FORBIDDEN' });
    await expect(
      service.generate(payroll.preparer, other.periodIds['PAY-2875-02']!),
    ).rejects.toMatchObject({ statusCode: 404, code: 'PAYROLL_PERIOD_NOT_FOUND' });
    await expect(service.generate(payroll.preparer, randomUUID())).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(await reportsOf(payroll.tenant.agency.id)).toBe(0);
    expect(await reportsOf(other.tenant.agency.id)).toBe(0);
  });

  it('admits a report only for a FINALIZED payroll at its version, and shows it only to its Agency', async () => {
    const payroll = await agencyWith('GUARD', [
      { code: 'PAY-2875-01', month: '01', status: 'APPROVED', results: {} },
      { code: 'PAY-2875-02', month: '02', results: {} },
    ]);
    const other = await agencyWith('GUARD-OTHER', [
      { code: 'PAY-2875-02', month: '02', results: {} },
    ]);
    const contract = await admin.payrollExportContractVersion.findUniqueOrThrow({
      where: { code_version: { code: 'PAYROLL_VARIANCE_EXCEPTION_REPORT', version: 1 } },
    });
    const content = '{}';
    const row = (periodId: string, calculationVersion = 2) => ({
      agencyId: payroll.tenant.agency.id,
      payrollPeriodId: periodId,
      calculationVersion,
      payrollExportContractVersionId: contract.id,
      generatedByMembershipId: payroll.preparer.membershipId,
      generatedAt: new Date(),
      content,
      checksum: sha256(content),
    });
    const insert = (data: ReturnType<typeof row>) =>
      withDatabaseContext(payroll.tenant.persons[0]!.scope, (transaction) =>
        transaction.payrollVarianceReport.create({ data }),
      );

    await expect(insert(row(payroll.periodIds['PAY-2875-01']!))).rejects.toThrow(
      /only from a FINALIZED payroll/,
    );
    await expect(insert(row(payroll.periodIds['PAY-2875-02']!, 1))).rejects.toThrow(
      /only from a FINALIZED payroll/,
    );
    await expect(
      insert({ ...row(payroll.periodIds['PAY-2875-02']!), checksum: 'f'.repeat(64) }),
    ).rejects.toThrow(/checksum_check/);
    expect(await reportsOf(payroll.tenant.agency.id)).toBe(0);

    // Another Agency's report is invisible under forced RLS.
    await service.generate(other.preparer, other.periodIds['PAY-2875-02']!);
    expect(await reportsOf(other.tenant.agency.id)).toBe(1);
    await expect(
      withDatabaseContext(payroll.tenant.persons[0]!.scope, (transaction) =>
        transaction.payrollVarianceReport.count(),
      ),
    ).resolves.toBe(0);
  });
});
