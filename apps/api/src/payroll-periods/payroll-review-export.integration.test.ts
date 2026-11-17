import { createHash } from 'node:crypto';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import { BasicSalaryCalculator } from '../payroll-calculation/basic-salary.calculator';
import { requestDatabaseContext } from '../database-context';
import { PayrollCalculationService } from '../payroll-calculation/payroll-calculation.service';
import { payrollSourcesReader } from '../payroll-calculation/payroll-calculation.test-fixtures';
import { PersonnelSalaryFactsService } from '../personnel-salary-facts/personnel-salary-facts.service';
import { PayrollCertificationService } from './payroll-certification.service';
import { PayrollPeriodsService } from './payroll-periods.service';
import {
  CERTIFIED_PAYROLL_REVIEW_EXPORT_STATEMENT,
  generateReviewExport,
  PayrollReviewExportService,
} from './payroll-review-export.service';
import {
  cleanupPayrollTenants,
  createAdminClient,
  createPayrollTenant,
  FIXTURE_PREFIX,
  type PayrollTenant,
} from './payroll-periods.test-fixtures';

const enabled = process.env.DATABASE_E2E === 'true';

/** Personnel records no pay basis yet (#619); every fixture Employee is monthly full-time. */
class MonthlyFullTime extends PersonnelSalaryFactsService {
  override async readInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    from: string,
    to: string,
  ) {
    const stretches = await super.readInTransaction(transaction, agencyId, employeeId, from, to);
    return stretches.map((stretch) =>
      stretch.status === 'IN_SERVICE'
        ? { ...stretch, payBasis: 'MONTHLY_FULL_TIME', employmentFraction: null }
        : stretch,
    ) as never;
  }
}

describe.skipIf(!enabled)('Certified Payroll Review Export in PostgreSQL', () => {
  // Test fixtures only: the rate is not from any issuance, and 2887 sits
  // clear of every other test's rule versions.
  const suffix = `${Date.now()}-review-export`;
  const scheduleCode = `${FIXTURE_PREFIX}REVIEW-EXPORT-SCHEDULE-${suffix}`;
  const periods = new PayrollPeriodsService();
  const certification = new PayrollCertificationService();
  const reviewExport = new PayrollReviewExportService();
  const basis = new CompensationBasisService(new MonthlyFullTime());
  const nothing = { calculate: () => ({ lines: [], exceptions: [] }) };
  const calculation = new PayrollCalculationService(
    basis,
    new BasicSalaryCalculator(),
    payrollSourcesReader(basis),
    nothing,
    nothing,
    nothing,
    nothing,
    nothing,
    nothing,
    nothing,
    nothing,
    nothing,
    nothing,
    nothing,
  );
  let admin: PrismaClient;
  let scheduleId: string;
  const tenants: PayrollTenant[] = [];

  /** The people of one Agency, each holding the permissions of one §6.10 role. */
  function roles(tenant: PayrollTenant) {
    const as = (index: number, codes: string[]): RequestContext => ({
      ...tenant.persons[index]!.context,
      permissions: codes.map((code) => ({ code, scopePolicy: 'AGENCY' as const })),
    });
    return {
      preparer: as(0, [
        'payroll.periods.create',
        'payroll.periods.calculate',
        'payroll.periods.read',
      ]),
      certifier: as(1, [
        'payroll.periods.read',
        'payroll.periods.certify',
        'payroll.periods.revoke_certification',
      ]),
      budgetOfficer: as(2, ['payroll.periods.read']),
      accountingReviewer: as(3, ['payroll.periods.read', 'payroll.periods.return']),
    };
  }

  /** An Agency with two SG-11 step-1 Employees in service all year. */
  async function tenant(label: string) {
    const created = await createPayrollTenant(admin, suffix, label, 4);
    tenants.push(created);
    const { agency, persons } = created;
    const membershipId = persons[0]!.membership.id;
    const unit = await admin.organizationUnit.create({
      data: {
        agencyId: agency.id,
        code: `UNIT-${label}-${suffix}`,
        unitType: 'DIVISION',
        status: 'ACTIVE',
      },
    });
    for (const index of [1, 2]) {
      const employee = await admin.employee.create({
        data: {
          agencyId: agency.id,
          employeeNumber: `EXPORT-${label}-${index}-${suffix}`,
          legalName: `Export ${label} ${index}`,
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `export-${label.toLowerCase()}-${index}-${suffix}@example.test`,
          serviceStatus: 'ACTIVE',
          createdByMembershipId: membershipId,
          updatedByMembershipId: membershipId,
        },
      });
      await withDatabaseContext(
        { ...persons[0]!.scope, capabilities: ['personnel-baseline-transition'] },
        (transaction) =>
          transaction.serviceSegment.create({
            data: {
              agencyId: agency.id,
              employeeId: employee.id,
              organizationUnitId: unit.id,
              appointmentStatus: 'PERMANENT',
              salaryGrade: 11,
              salaryStep: 1,
              effectiveFrom: new Date('2887-01-01'),
              effectiveTo: null,
              status: 'ACTIVE',
              createdByMembershipId: membershipId,
            },
          }),
      );
    }
    return created;
  }

  /** Create the March 2887 regular period and calculate it to FOR_REVIEW. */
  async function calculatedPeriod(payrollTenant: PayrollTenant) {
    const people = roles(payrollTenant);
    const draft = await periods.create(people.preparer, {
      code: `EXPORT-2887-03-${suffix}`,
      runType: 'REGULAR',
      periodFrom: '2887-03-01',
      periodTo: '2887-03-31',
      cutoffAt: '2026-01-01T00:00:00+08:00',
      paymentDate: '2887-03-15',
    });
    const started = await periods.startCalculation(people.preparer, draft.id, {
      rowVersion: draft.rowVersion,
    });
    await expect(
      calculation.run({
        agencyId: payrollTenant.agency.id,
        payrollPeriodId: draft.id,
        calculationVersion: started.calculationVersion,
      }),
    ).resolves.toMatchObject({ outcome: 'FOR_REVIEW' });
    return periods.read(people.certifier, draft.id);
  }

  /** Certify the period's current version as the HR Certifier. */
  async function certify(payrollTenant: PayrollTenant, periodId: string) {
    const period = await periods.read(roles(payrollTenant).certifier, periodId);
    return certification.certify(roles(payrollTenant).certifier, periodId, {
      calculationVersion: period.calculationVersion,
      calculationHash: period.calculationHash,
    });
  }

  /** A calculated period, certified. */
  async function certifiedPeriod(payrollTenant: PayrollTenant) {
    const period = await calculatedPeriod(payrollTenant);
    const certified = await certify(payrollTenant, period.id);
    return { ...period, rowVersion: certified.rowVersion };
  }

  /** The current export, found as #625 and #637 will: through the period detail. */
  async function currentExport(context: RequestContext, periodId: string) {
    const { certification: inForce } = await periods.read(context, periodId);
    expect(inForce?.reviewExportId).toEqual(expect.any(String));
    return reviewExport.read(context, periodId, inForce!.reviewExportId!);
  }

  /** Generate in a transaction of its own, as certify does inside its own. */
  const generateAs = (context: RequestContext, periodId: string) =>
    withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      generateReviewExport(transaction, context, periodId),
    );

  const exportCount = (payrollPeriodId: string) =>
    admin.certifiedPayrollReviewExport.count({ where: { payrollPeriodId } });

  const eventsOf = (entityId: string, action: string) =>
    admin.auditEvent.findMany({ where: { entityId, action }, orderBy: { occurredAt: 'asc' } });

  beforeAll(async () => {
    admin = await createAdminClient();
    scheduleId = await admin.$transaction(async (transaction) => {
      const version = await transaction.nationalPayrollRuleVersion.create({
        data: {
          ruleKind: 'SALARY_SCHEDULE',
          code: scheduleCode,
          name: 'Test salary schedule',
          issuingAuthority: 'Test authority',
          issuanceReference: 'Test fixture, not an issuance',
          sourceUrl: 'https://example.test/salary-schedule',
          verifiedOn: new Date('2026-11-16'),
          verifiedBy: 'LingkodHR test fixture',
          effectiveFrom: new Date('2887-01-01'),
          effectiveTo: new Date('2887-12-31'),
        },
      });
      await transaction.salaryGradeRate.create({
        data: { ruleVersionId: version.id, salaryGrade: 11, salaryStep: 1, monthlyRate: '31705' },
      });
      return version.id;
    });
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const where = { agencyId: { in: tenants.map((each) => each.agency.id) } };
      await transaction.serviceSegment.deleteMany({ where });
      await transaction.employee.deleteMany({ where });
      await transaction.organizationUnit.deleteMany({ where });
      await transaction.$executeRaw`DELETE FROM salary_grade_rates WHERE rule_version_id = CAST(${scheduleId} AS uuid)`;
      await transaction.$executeRaw`DELETE FROM national_payroll_rule_versions WHERE code = ${scheduleCode}`;
    });
    await cleanupPayrollTenants(admin, tenants);
    await admin.$disconnect();
  });

  it('generates one checksummed, reconciled export of the certified snapshot as it certifies', async () => {
    const payrollTenant = await tenant('GENERATE');
    const people = roles(payrollTenant);
    const period = await calculatedPeriod(payrollTenant);
    await expect(generateAs(people.certifier, period.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_PERIOD_NOT_CERTIFIED',
    });
    await certify(payrollTenant, period.id);

    const generated = await currentExport(people.budgetOfficer, period.id);
    expect(generated).toMatchObject({
      payrollPeriodId: period.id,
      generatedByMembershipId: people.certifier.membershipId,
      supersededAt: null,
    });
    expect(generated.checksum).toBe(
      createHash('sha256').update(generated.content, 'utf8').digest('hex'),
    );
    const content = JSON.parse(generated.content) as Record<string, unknown>;
    const { id: certificationId, certifiedAt } = await admin.payrollCertification.findFirstOrThrow({
      where: { payrollPeriodId: period.id, revokedAt: null },
    });
    expect(generated.payrollCertificationId).toBe(certificationId);
    expect(content).toEqual({
      contract: { code: 'CERTIFIED_PAYROLL_REVIEW_EXPORT', version: 1 },
      statement: CERTIFIED_PAYROLL_REVIEW_EXPORT_STATEMENT,
      agencyId: payrollTenant.agency.id,
      payrollPeriod: {
        id: period.id,
        code: period.code,
        runType: 'REGULAR',
        periodFrom: '2887-03-01',
        periodTo: '2887-03-31',
        paymentDate: '2887-03-15',
      },
      certification: {
        id: certificationId,
        calculationVersion: 1,
        calculationHash: period.calculationHash,
        certifiedAt: certifiedAt.toISOString(),
      },
      classifiedLines: [
        {
          lineNo: 1,
          payComponentCode: 'BASIC_SALARY',
          payComponentName: 'Basic salary',
          componentKind: 'EARNING',
          payrollEffect: 'ADDS',
          reportingCategory: null,
          amount: '63410.0000',
          sourceLineCount: 2,
        },
      ],
      reconciliation: {
        resultCount: 2,
        sourceLineCount: 2,
        classifiedSourceLineCount: 2,
        grossAmount: '63410.0000',
        totalDeductions: '0.0000',
        netAmount: '63410.0000',
        employerShareAmount: '0.0000',
        informationalAmount: '0.0000',
      },
    });
    // The contract version defines every field the artifact carries, and the
    // same no-assertion statement.
    const contract = await admin.payrollExportContractVersion.findUniqueOrThrow({
      where: { code_version: { code: 'CERTIFIED_PAYROLL_REVIEW_EXPORT', version: 1 } },
    });
    const definition = contract.definition as { statement: string; fields: object };
    expect(definition.statement).toBe(CERTIFIED_PAYROLL_REVIEW_EXPORT_STATEMENT);
    expect(Object.keys(definition.fields)).toEqual(expect.arrayContaining(Object.keys(content)));
    expect(generated.content).toMatch(/does not assert that funds were validated or obligated/);

    // The certification's Audit Event names the export it generated.
    await expect(eventsOf(period.id, 'PAYROLL_PERIOD_CERTIFIED')).resolves.toEqual([
      expect.objectContaining({
        actorMembershipId: people.certifier.membershipId,
        metadata: {
          payrollCertificationId: certificationId,
          calculationVersion: 1,
          calculationHash: period.calculationHash,
          certifiedPayrollReviewExportId: generated.id,
          reviewExportChecksum: generated.checksum,
        },
      }),
    ]);
  });

  it('returns the same artifact when generating again for the same snapshot, also in a race', async () => {
    const payrollTenant = await tenant('RETRY');
    const people = roles(payrollTenant);
    const period = await certifiedPeriod(payrollTenant);
    const stored = await currentExport(people.certifier, period.id);

    await expect(generateAs(people.certifier, period.id)).resolves.toEqual(stored);
    const [first, second] = await Promise.all([
      generateAs(people.certifier, period.id),
      generateAs(people.certifier, period.id),
    ]);
    expect(first).toEqual(stored);
    expect(second).toEqual(stored);
    await expect(exportCount(period.id)).resolves.toBe(1);
  });

  it('supersedes the export when the certification is revoked, and exports the next certification anew', async () => {
    const payrollTenant = await tenant('REVOKE');
    const people = roles(payrollTenant);
    const period = await certifiedPeriod(payrollTenant);
    const first = await currentExport(people.budgetOfficer, period.id);

    const revoked = await certification.revokeCertification(people.certifier, period.id, {
      reason: 'Personnel corrected the salary step.',
      rowVersion: period.rowVersion,
    });
    expect(revoked.status).toBe('FOR_REVIEW');
    const superseded = await reviewExport.read(people.budgetOfficer, period.id, first.id);
    expect(superseded).toEqual({ ...first, supersededAt: expect.any(String) });
    await expect(eventsOf(period.id, 'PAYROLL_PERIOD_CERTIFICATION_REVOKED')).resolves.toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({ supersededReviewExportId: first.id }),
      }),
    ]);
    await expect(periods.read(people.budgetOfficer, period.id)).resolves.toMatchObject({
      certification: null,
    });
    // With no certification in force there is nothing to export.
    await expect(generateAs(people.certifier, period.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_PERIOD_NOT_CERTIFIED',
    });

    // Recertifying the same version generates a new export; the old one stays superseded.
    await certify(payrollTenant, period.id);
    const second = await currentExport(people.budgetOfficer, period.id);
    expect(second.id).not.toBe(first.id);
    expect(second.supersededAt).toBeNull();
    expect(second.payrollCertificationId).not.toBe(first.payrollCertificationId);
    const linesOf = (view: { content: string }) => {
      const { classifiedLines, reconciliation } = JSON.parse(view.content) as Record<
        string,
        unknown
      >;
      return { classifiedLines, reconciliation };
    };
    expect(linesOf(second)).toEqual(linesOf(first));
    await expect(reviewExport.read(people.budgetOfficer, period.id, first.id)).resolves.toEqual(
      superseded,
    );
    await expect(exportCount(period.id)).resolves.toBe(2);
  });

  it('refuses certification and stores nothing when the snapshot does not reconcile', async () => {
    const payrollTenant = await tenant('UNRECONCILED');
    const people = roles(payrollTenant);
    const period = await calculatedPeriod(payrollTenant);
    // Only a test can change a stored line: the immutability trigger is lifted here.
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const line = await transaction.payrollLine.findFirstOrThrow({
        where: { agencyId: payrollTenant.agency.id },
      });
      await transaction.payrollLine.update({ where: { id: line.id }, data: { amount: '1' } });
    });

    await expect(certify(payrollTenant, period.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_EXPORT_RECONCILIATION_FAILED',
      message: expect.stringMatching(/does not reconcile to its lines/),
    });
    await expect(periods.read(people.certifier, period.id)).resolves.toMatchObject({
      status: 'FOR_REVIEW',
      rowVersion: period.rowVersion,
      certification: null,
    });
    await expect(
      admin.payrollCertification.count({ where: { payrollPeriodId: period.id } }),
    ).resolves.toBe(0);
    await expect(exportCount(period.id)).resolves.toBe(0);
    await expect(eventsOf(period.id, 'PAYROLL_PERIOD_CERTIFIED')).resolves.toEqual([]);
    await expect(
      admin.payrollPeriodActor.count({
        where: { payrollPeriodId: period.id, payrollFunction: 'HR_CERTIFICATION' },
      }),
    ).resolves.toBe(0);
  });

  it('keeps another Agency from reading or generating the export', async () => {
    const payrollTenant = await tenant('OWNER');
    const outsider = roles(await tenant('OUTSIDER')).certifier;
    const period = await certifiedPeriod(payrollTenant);
    const generated = await currentExport(roles(payrollTenant).budgetOfficer, period.id);

    await expect(reviewExport.read(outsider, period.id, generated.id)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PAYROLL_REVIEW_EXPORT_NOT_FOUND',
    });
    await expect(generateAs(outsider, period.id)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PAYROLL_PERIOD_NOT_FOUND',
    });
    await expect(exportCount(period.id)).resolves.toBe(1);
  });

  it('keeps exports and contract versions immutable in the database', async () => {
    const payrollTenant = await tenant('GUARD');
    const people = roles(payrollTenant);
    const period = await certifiedPeriod(payrollTenant);
    const generated = await currentExport(people.budgetOfficer, period.id);
    const where = { id: generated.id };

    await expect(
      admin.certifiedPayrollReviewExport.update({ where, data: { content: '{}' } }),
    ).rejects.toThrow(/only to record its supersession/);
    await expect(admin.certifiedPayrollReviewExport.delete({ where })).rejects.toThrow(
      /cannot be deleted/,
    );
    await expect(
      admin.payrollExportContractVersion.updateMany({
        where: { code: 'CERTIFIED_PAYROLL_REVIEW_EXPORT' },
        data: { definition: {} },
      }),
    ).rejects.toThrow(/immutable/);

    // A second export of the certification is refused.
    const { id: contractVersionId } = await admin.payrollExportContractVersion.findFirstOrThrow({
      where: { code: 'CERTIFIED_PAYROLL_REVIEW_EXPORT', version: 1 },
    });
    const row = {
      agencyId: payrollTenant.agency.id,
      payrollPeriodId: period.id,
      payrollCertificationId: generated.payrollCertificationId,
      payrollExportContractVersionId: contractVersionId,
      content: generated.content,
      checksum: generated.checksum,
      generatedByMembershipId: people.certifier.membershipId,
    };
    await expect(admin.certifiedPayrollReviewExport.create({ data: row })).rejects.toThrow(
      /Unique constraint/,
    );

    const revoked = await certification.revokeCertification(people.certifier, period.id, {
      reason: 'Recheck.',
      rowVersion: period.rowVersion,
    });
    await expect(
      admin.certifiedPayrollReviewExport.update({ where, data: { supersededAt: new Date() } }),
    ).rejects.toThrow(/only to record its supersession/);

    // A revoked certification's export cannot be written again under a new row.
    await expect(
      admin.certifiedPayrollReviewExport.create({
        data: { ...row, payrollCertificationId: generated.payrollCertificationId },
      }),
    ).rejects.toThrow(/only from the certification in force/);
    // Certified again, the new certification already has its export: a forged
    // row is refused by the checksum CHECK, or else by the one-export key.
    await certify(payrollTenant, period.id);
    const current = await admin.payrollCertification.findFirstOrThrow({
      where: { payrollPeriodId: period.id, revokedAt: null },
    });
    await expect(
      admin.certifiedPayrollReviewExport.create({
        data: { ...row, payrollCertificationId: current.id, checksum: 'f'.repeat(64) },
      }),
    ).rejects.toThrow(/checksum_check/);
    await expect(
      admin.certifiedPayrollReviewExport.create({
        data: { ...row, payrollCertificationId: current.id },
      }),
    ).rejects.toThrow(/Unique constraint/);
    expect(revoked.status).toBe('FOR_REVIEW');
  });
});
