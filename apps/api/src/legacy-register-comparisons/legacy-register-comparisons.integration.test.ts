import { createHash } from 'node:crypto';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requestDatabaseContext } from '../database-context';
import {
  cleanupPayrollTenants,
  createAdminClient,
  createPayrollTenant,
  type PayrollTenant,
} from '../payroll-periods/payroll-periods.test-fixtures';
import {
  LEGACY_REGISTER_COMPARED,
  LegacyRegisterComparisonsService,
} from './legacy-register-comparisons.service';

const enabled = process.env.DATABASE_E2E === 'true';

const OWN_TABLES = ['legacy_register_comparisons', 'legacy_register_differences', 'audit_events'];

/** One finalized line; amounts are test fixtures, not from any issuance. */
type LineSpec = readonly [code: string, lineType: string, amount: string];

describe.skipIf(!enabled)('Legacy Register Comparison in PostgreSQL', () => {
  const suffix = `${Date.now()}-legacy-register`;
  const tenants: PayrollTenant[] = [];
  const service = new LegacyRegisterComparisonsService();
  let admin: PrismaClient;
  let componentId: (code: string) => string;

  /** Fixture rows written with triggers off, standing in for what finalization (#335) wrote. */
  const seed = <T>(run: (transaction: Prisma.TransactionClient) => Promise<T>) =>
    admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      return run(transaction);
    });

  /**
   * An Agency with a regular period in `status` at calculation version 2.
   * Each Employee with lines has a version-2 result in `status` with them, and
   * a replaced version-1 result whose lines are all 1 peso more. An Employee
   * with no lines has no result. Person 0 holds the comparison permission;
   * person 1 holds only `payroll.periods.read`.
   */
  async function payroll(
    label: string,
    employees: Record<string, LineSpec[]>,
    status = 'FINALIZED',
  ) {
    const tenant = await createPayrollTenant(admin, suffix, `LEGACY-${label}`, 2);
    tenants.push(tenant);
    const { agency, persons } = tenant;
    const agencyId = agency.id;
    const membershipId = persons[0]!.membership.id;
    const as = (index: number, codes: string[]): RequestContext => ({
      ...persons[index]!.context,
      permissions: codes.map((code) => ({ code, scopePolicy: 'AGENCY' as const })),
    });
    const periodId = await seed(async (transaction) => {
      const period = await transaction.payrollPeriod.create({
        data: {
          agencyId,
          code: `LEGACY-2875-04-${label}`,
          runType: 'REGULAR',
          periodFrom: new Date('2875-04-01'),
          periodTo: new Date('2875-04-30'),
          cutoffAt: new Date('2875-04-10T00:00:00Z'),
          paymentDate: new Date('2875-04-15'),
          status,
          calculationVersion: 2,
          finalizedAt: status === 'FINALIZED' ? new Date('2875-04-14T02:00:00Z') : null,
        },
      });
      for (const [number, lines] of Object.entries(employees)) {
        const employee = await transaction.employee.create({
          data: {
            agencyId,
            employeeNumber: number,
            legalName: `Payee ${number}`,
            birthDate: new Date('1990-01-01'),
            sex: 'FEMALE',
            civilStatus: 'SINGLE',
            contactEmail: `legacy-${label}-${number}-${suffix}@example.test`.toLowerCase(),
            serviceStatus: 'ACTIVE',
            createdByMembershipId: membershipId,
            updatedByMembershipId: membershipId,
          },
        });
        if (lines.length === 0) continue;
        for (const [calculationVersion, resultStatus, extra] of [
          [2, status === 'FINALIZED' ? 'FINALIZED' : 'CALCULATED', 0],
          [1, 'CALCULATED', 1],
        ] as const) {
          const result = await transaction.payrollEmployee.create({
            data: {
              agencyId,
              payrollPeriodId: period.id,
              calculationVersion,
              employeeId: employee.id,
              compensationBasisSnapshot: {},
              status: resultStatus,
              calculationHash: createHash('sha256')
                .update(`${label}:${number}:${calculationVersion}`)
                .digest('hex'),
            },
          });
          await transaction.payrollLine.createMany({
            data: lines.map(([code, lineType, amount]) => ({
              agencyId,
              payrollEmployeeId: result.id,
              payComponentId: componentId(code),
              lineType,
              amount: (Number(amount) + extra).toFixed(4),
              sourceSnapshot: {},
            })),
          });
        }
      }
      return period.id;
    });
    return {
      agencyId,
      periodId,
      preparer: as(0, ['payroll.legacy_registers.compare']),
      reader: as(1, ['payroll.periods.read']),
    };
  }

  const csv = (...rows: string[]) =>
    Buffer.from(['employee_number,component_code,amount', ...rows].join('\r\n') + '\r\n');

  /**
   * What the import could change without writing its own tables, so equal
   * snapshots prove it wrote no payroll table.
   *
   * Every Agency-owned table, the payroll ones included, has `agency_id`
   * (payroll-schema.md, Scope): its rows of this test's Agency, which no
   * concurrent test file writes, get a row count and an order-free checksum,
   * read as the database owner, which RLS does not hide rows from. The
   * comparison's own two tables and the audit trail are left out.
   *
   * A table without `agency_id` is shared with concurrent test files, so its
   * rows can't be compared. Instead the snapshot names each one the import's
   * database role may write. The platform-wide payroll tables
   * (`pay_components`, `national_payroll_rule_versions`,
   * `salary_grade_rates`, `payroll_export_contract_versions`) must never be
   * among them, since that role holds only `SELECT` on them (ADR 0013).
   */
  async function snapshot(agencyId: string, role: string) {
    const tables = await admin.$queryRaw<{ name: string; agencyOwned: boolean }[]>`
      SELECT t.table_name AS name,
             EXISTS (
               SELECT 1 FROM information_schema.columns c
               WHERE c.table_schema = 'public' AND c.table_name = t.table_name
                 AND c.column_name = 'agency_id'
             ) AS "agencyOwned"
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND t.table_name <> ALL(${OWN_TABLES})
      ORDER BY t.table_name
    `;
    const agencyRows: Record<string, string> = {};
    const writableShared: string[] = [];
    for (const { name, agencyOwned } of tables) {
      if (agencyOwned) {
        const [row] = await admin.$queryRawUnsafe<{ rows: string; checksum: string }[]>(
          `SELECT count(*)::text AS rows,
                  COALESCE(sum(hashtextextended(t::text, 0)::numeric), 0)::text AS checksum
           FROM "${name}" t WHERE t."agency_id" = CAST($1 AS uuid)`,
          agencyId,
        );
        agencyRows[name] = `${row!.rows}:${row!.checksum}`;
        continue;
      }
      const [writable] = await admin.$queryRaw<{ writable: boolean }[]>`
        SELECT has_table_privilege(${role}, ${`public."${name}"`}, 'INSERT, UPDATE, DELETE, TRUNCATE')
          AS writable
      `;
      if (writable!.writable) writableShared.push(name);
    }
    return { agencyRows, writableShared };
  }

  /** The database role the service runs as for `context`. */
  const roleOf = async (context: RequestContext) =>
    withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const [row] = await transaction.$queryRaw<{ role: string }[]>`SELECT current_user AS role`;
      return row!.role;
    });

  const PLATFORM_PAYROLL_TABLES = [
    'pay_components',
    'national_payroll_rule_versions',
    'salary_grade_rates',
    'payroll_export_contract_versions',
  ];

  const comparisonsOf = (agencyId: string) =>
    admin.legacyRegisterComparison.findMany({ where: { agencyId } });
  const differencesOf = (agencyId: string) =>
    admin.legacyRegisterDifference.findMany({ where: { agencyId } });
  const auditsOf = (agencyId: string) =>
    admin.auditEvent.findMany({ where: { agencyId, action: LEGACY_REGISTER_COMPARED } });

  beforeAll(async () => {
    admin = await createAdminClient();
    const components = await admin.payComponent.findMany({
      where: {
        code: { in: ['BASIC_SALARY', 'PERA', 'GSIS_PERSONAL_SHARE', 'DAYS_WITHOUT_PAY'] },
      },
    });
    componentId = (code) => components.find((each) => each.code === code)!.id;
  });

  afterAll(async () => {
    if (!admin) return;
    await seed(async (transaction) => {
      const where = { agencyId: { in: tenants.map((each) => each.agency.id) } };
      await transaction.legacyRegisterDifference.deleteMany({ where });
      await transaction.legacyRegisterComparison.deleteMany({ where });
      await transaction.payrollLine.deleteMany({ where });
      await transaction.payrollEmployee.deleteMany({ where });
      await transaction.employee.deleteMany({ where });
    });
    await cleanupPayrollTenants(admin, tenants);
    await admin.$disconnect();
  });

  it('stores both values of every difference, and changes no payroll table', async () => {
    const period = await payroll('HAPPY', {
      'E-001': [
        ['BASIC_SALARY', 'EARNING', '30000.25'],
        ['PERA', 'EARNING', '2000'],
        ['GSIS_PERSONAL_SHARE', 'DEDUCTION', '2700.5'],
      ],
      'E-002': [
        ['BASIC_SALARY', 'EARNING', '44000'],
        ['DAYS_WITHOUT_PAY', 'DEDUCTION', '2000'],
        ['DAYS_WITHOUT_PAY', 'DEDUCTION', '1000'],
      ],
      'E-003': [],
    });
    const file = csv(
      'E-001,BASIC_SALARY,30000.25',
      'E-001,PERA,2000.50',
      // Numbers and codes match whatever their case; two lines sum to one amount.
      'e-002,basic_salary,44000.00',
      'E-002,DAYS_WITHOUT_PAY,3000',
      // An Employee with no result in this payroll.
      'E-003,BASIC_SALARY,1000',
    );

    const role = await roleOf(period.preparer);
    const before = await snapshot(period.agencyId, role);
    // Six lines in each of two versions of two results: the payroll tables have rows.
    expect(before.agencyRows.payroll_lines).toMatch(/^12:/);
    expect(before.agencyRows.payroll_employees).toMatch(/^4:/);
    for (const table of PLATFORM_PAYROLL_TABLES) {
      expect(before.writableShared).not.toContain(table);
    }
    const comparison = await service.compare(period.preparer, period.periodId, file);
    expect(await snapshot(period.agencyId, role)).toEqual(before);

    expect(comparison).toMatchObject({
      payrollPeriodId: period.periodId,
      calculationVersion: 2,
      rowCount: 5,
      differenceCount: 3,
      comparedByMembershipId: period.preparer.membershipId,
    });
    expect(comparison.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // The finalized version's lines, never the replaced version's.
    expect(
      comparison.differences.map(
        ({ employeeNumber, payComponentCode, legacyAmount, payrollAmount }) => ({
          employeeNumber,
          payComponentCode,
          legacyAmount,
          payrollAmount,
        }),
      ),
    ).toEqual([
      {
        employeeNumber: 'E-001',
        payComponentCode: 'GSIS_PERSONAL_SHARE',
        legacyAmount: null,
        payrollAmount: '2700.5000',
      },
      {
        employeeNumber: 'E-001',
        payComponentCode: 'PERA',
        legacyAmount: '2000.5000',
        payrollAmount: '2000.0000',
      },
      {
        employeeNumber: 'E-003',
        payComponentCode: 'BASIC_SALARY',
        legacyAmount: '1000.0000',
        payrollAmount: null,
      },
    ]);
    expect(await differencesOf(period.agencyId)).toHaveLength(3);

    const [audit, ...noOtherAudit] = await auditsOf(period.agencyId);
    expect(noOtherAudit).toEqual([]);
    expect(audit).toMatchObject({
      actorMembershipId: period.preparer.membershipId,
      entityType: 'LegacyRegisterComparison',
      entityId: comparison.id,
    });
    expect(audit!.metadata).toEqual({
      payrollPeriodId: period.periodId,
      calculationVersion: 2,
      contentHash: comparison.contentHash,
      rowCount: 5,
      differenceCount: 3,
    });

    // The same file again returns the stored comparison and writes nothing.
    expect(await service.compare(period.preparer, period.periodId, file)).toEqual(comparison);
    expect(await comparisonsOf(period.agencyId)).toHaveLength(1);
    expect(await auditsOf(period.agencyId)).toHaveLength(1);

    const { differences, ...summary } = comparison;
    expect(await service.list(period.preparer, period.periodId)).toEqual([summary]);
    expect(await service.get(period.preparer, period.periodId, comparison.id)).toEqual(comparison);
    expect(differences).toHaveLength(3);
  });

  it('rejects unknown Employees and components with reasons, writing nothing', async () => {
    const period = await payroll('UNKNOWN', { 'E-001': [['BASIC_SALARY', 'EARNING', '30000']] });
    const role = await roleOf(period.preparer);
    const before = await snapshot(period.agencyId, role);
    expect(before.agencyRows.payroll_lines).toMatch(/^2:/);
    await expect(
      service.compare(
        period.preparer,
        period.periodId,
        csv('E-001,BASIC_SALARY,30000', 'E-404,BASIC_SALARY,1', 'E-001,NOT_A_COMPONENT,1'),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'LEGACY_REGISTER_INVALID',
      issues: [
        expect.objectContaining({ line: 3, code: 'EMPLOYEE_UNKNOWN' }),
        expect.objectContaining({ line: 4, code: 'COMPONENT_UNKNOWN' }),
      ],
    });
    await expect(
      service.compare(period.preparer, period.periodId, csv('E-001,BASIC_SALARY,thirty')),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ line: 2, code: 'AMOUNT_INVALID' })],
    });
    expect(await snapshot(period.agencyId, role)).toEqual(before);
    expect(await comparisonsOf(period.agencyId)).toEqual([]);
    expect(await auditsOf(period.agencyId)).toEqual([]);
  });

  it('compares only a FINALIZED payroll of the Agency, for the permission holder', async () => {
    const approved = await payroll(
      'APPROVED',
      { 'E-001': [['BASIC_SALARY', 'EARNING', '1']] },
      'APPROVED',
    );
    const file = csv('E-001,BASIC_SALARY,1');
    await expect(service.compare(approved.preparer, approved.periodId, file)).rejects.toMatchObject(
      {
        statusCode: 409,
        code: 'LEGACY_REGISTER_PAYROLL_NOT_FINALIZED',
      },
    );
    await expect(service.compare(approved.reader, approved.periodId, file)).rejects.toMatchObject({
      statusCode: 403,
    });

    const other = await payroll('OTHER', { 'E-001': [['BASIC_SALARY', 'EARNING', '1']] });
    await expect(service.compare(approved.preparer, other.periodId, file)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PAYROLL_PERIOD_NOT_FOUND',
    });
    const stored = await service.compare(other.preparer, other.periodId, file);
    await expect(
      service.get(approved.preparer, approved.periodId, stored.id),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(await comparisonsOf(approved.agencyId)).toEqual([]);
  });

  it('keeps comparisons and differences immutable for the application', async () => {
    const period = await payroll('IMMUTABLE', { 'E-001': [['BASIC_SALARY', 'EARNING', '1']] });
    const stored = await service.compare(
      period.preparer,
      period.periodId,
      csv('E-001,BASIC_SALARY,2'),
    );
    const asApp = <T>(run: (transaction: Prisma.TransactionClient) => Promise<T>) =>
      withDatabaseContext(requestDatabaseContext(period.preparer), run);

    await expect(
      asApp((transaction) =>
        transaction.legacyRegisterComparison.update({
          where: { id: stored.id },
          data: { rowCount: 9 },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      asApp((transaction) => transaction.legacyRegisterDifference.deleteMany({ where: {} })),
    ).rejects.toThrow();
    // A difference joins only the comparison written in its own transaction.
    await expect(
      asApp((transaction) =>
        transaction.legacyRegisterDifference.create({
          data: {
            agencyId: period.agencyId,
            legacyRegisterComparisonId: stored.id,
            employeeId: stored.differences[0]!.employeeId,
            payComponentId: componentId('PERA'),
            legacyAmount: '1',
          },
        }),
      ),
    ).rejects.toThrow(/written only with its new comparison/);
    expect(await differencesOf(period.agencyId)).toHaveLength(1);
  });
});
