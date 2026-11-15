import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import { payrollCalculationHash } from '../payroll-calculation/calculation-hash';
import { BasicSalaryCalculator } from '../payroll-calculation/basic-salary.calculator';
import { PayrollCalculationService } from '../payroll-calculation/payroll-calculation.service';
import { payrollSourcesReader } from '../payroll-calculation/payroll-calculation.test-fixtures';
import { PersonnelSalaryFactsService } from '../personnel-salary-facts/personnel-salary-facts.service';
import { PayrollCertificationService } from './payroll-certification.service';
import { PayrollPeriodsService } from './payroll-periods.service';
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

describe.skipIf(!enabled)('Payroll certification in PostgreSQL', () => {
  // Test fixtures only: the rates are not from any issuance, and 2886 sits
  // clear of every other test's rule versions.
  const suffix = `${Date.now()}-certify`;
  const scheduleCode = `${FIXTURE_PREFIX}CERTIFY-SCHEDULE-${suffix}`;
  const periods = new PayrollPeriodsService();
  const certification = new PayrollCertificationService();
  const basis = new CompensationBasisService(new MonthlyFullTime());
  // Basic salary is enough to give the results a hash; the later calculators write nothing.
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
    const certifierCodes = [
      'payroll.periods.read',
      'payroll.periods.certify',
      'payroll.periods.revoke_certification',
      'payroll.periods.return',
    ];
    return {
      // The preparer also holds certify, so only the one-function rule stops them.
      preparer: as(0, [
        'payroll.periods.create',
        'payroll.periods.calculate',
        'payroll.periods.read',
        'payroll.periods.certify',
      ]),
      certifier: as(1, certifierCodes),
      secondCertifier: as(2, certifierCodes),
      approver: as(3, [
        'payroll.periods.read',
        'payroll.periods.revoke_certification',
        'payroll.periods.return',
      ]),
      accountingReviewer: as(4, ['payroll.periods.read', 'payroll.periods.return']),
    };
  }

  /** An Agency with one SG-11 step-1 Employee in service all year. */
  async function tenant(label: string) {
    const created = await createPayrollTenant(admin, suffix, label, 5);
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
    const employee = await admin.employee.create({
      data: {
        agencyId: agency.id,
        employeeNumber: `CERTIFY-${label}-${suffix}`,
        legalName: `Certify ${label}`,
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `certify-${label.toLowerCase()}-${suffix}@example.test`,
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
            effectiveFrom: new Date('2886-01-01'),
            effectiveTo: null,
            status: 'ACTIVE',
            createdByMembershipId: membershipId,
          },
        }),
    );
    return created;
  }

  /** Start and run the next calculation of a DRAFT period, as the preparer. */
  async function calculate(payrollTenant: PayrollTenant, periodId: string) {
    const { rowVersion } = await admin.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
    const started = await periods.startCalculation(roles(payrollTenant).preparer, periodId, {
      rowVersion,
    });
    const outcome = await calculation.run({
      agencyId: payrollTenant.agency.id,
      payrollPeriodId: periodId,
      calculationVersion: started.calculationVersion,
    });
    expect(outcome).toMatchObject({ outcome: 'FOR_REVIEW' });
    return periods.read(roles(payrollTenant).certifier, periodId);
  }

  /** Create the March 2886 regular period and calculate it to FOR_REVIEW. */
  async function calculatedPeriod(payrollTenant: PayrollTenant) {
    const period = await periods.create(roles(payrollTenant).preparer, {
      code: `CERTIFY-2886-03-${suffix}`,
      runType: 'REGULAR',
      periodFrom: '2886-03-01',
      periodTo: '2886-03-31',
      cutoffAt: '2026-01-01T00:00:00+08:00',
      paymentDate: '2886-03-15',
    });
    return calculate(payrollTenant, period.id);
  }

  const actorsOf = (payrollPeriodId: string) =>
    admin.payrollPeriodActor.findMany({
      where: { payrollPeriodId },
      select: { membershipId: true, payrollFunction: true },
    });

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
          verifiedOn: new Date('2026-11-15'),
          verifiedBy: 'LingkodHR test fixture',
          effectiveFrom: new Date('2886-01-01'),
          effectiveTo: new Date('2886-12-31'),
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

  it('certifies the reviewed version and hash, revokes with a reason, and returns for correction', async () => {
    const payrollTenant = await tenant('FLOW');
    const people = roles(payrollTenant);
    const period = await calculatedPeriod(payrollTenant);
    const results = await admin.payrollEmployee.findMany({
      where: { payrollPeriodId: period.id, calculationVersion: 1 },
    });
    expect(results).toHaveLength(1);
    expect(period).toMatchObject({
      status: 'FOR_REVIEW',
      calculationVersion: 1,
      calculationHash: payrollCalculationHash(results),
      certification: null,
    });

    await expect(
      certification.certify(people.certifier, period.id, {
        calculationVersion: 1,
        calculationHash: 'f'.repeat(64),
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_CALCULATION_HASH_CHANGED' });
    await expect(
      certification.certify(people.certifier, period.id, {
        calculationVersion: 2,
        calculationHash: period.calculationHash,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_CALCULATION_VERSION_CHANGED' });
    // A refused certify claims no function and records nothing.
    await expect(actorsOf(period.id)).resolves.toEqual([
      { membershipId: people.preparer.membershipId, payrollFunction: 'PREPARATION' },
    ]);

    const certified = await certification.certify(people.certifier, period.id, {
      calculationVersion: 1,
      calculationHash: period.calculationHash,
    });
    expect(certified).toMatchObject({
      status: 'CERTIFIED',
      calculationVersion: 1,
      rowVersion: period.rowVersion + 1,
    });
    const first = await periods.read(people.certifier, period.id);
    expect(first.certification).toMatchObject({
      calculationVersion: 1,
      calculationHash: period.calculationHash,
      certifiedByMembershipId: people.certifier.membershipId,
    });
    await expect(eventsOf(period.id, 'PAYROLL_PERIOD_CERTIFIED')).resolves.toEqual([
      expect.objectContaining({
        actorMembershipId: people.certifier.membershipId,
        previousStatus: 'FOR_REVIEW',
        newStatus: 'CERTIFIED',
        metadata: {
          payrollCertificationId: first.certification!.id,
          calculationVersion: 1,
          calculationHash: period.calculationHash,
        },
      }),
    ]);
    await expect(
      certification.returnForCorrection(people.accountingReviewer, period.id, {
        reason: 'Recheck',
        rowVersion: certified.rowVersion,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_PERIOD_NOT_FOR_REVIEW' });

    // A Payroll Approver revokes in APPROVAL, and needs a reason.
    await expect(
      certification.revokeCertification(people.approver, period.id, {
        reason: ' ',
        rowVersion: certified.rowVersion,
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' });
    const revoked = await certification.revokeCertification(people.approver, period.id, {
      reason: 'The Accounting Reviewer found a wrong step.',
      rowVersion: certified.rowVersion,
    });
    expect(revoked).toMatchObject({ status: 'FOR_REVIEW', calculationVersion: 1 });
    await expect(
      admin.payrollCertification.findUniqueOrThrow({ where: { id: first.certification!.id } }),
    ).resolves.toMatchObject({
      revokedByMembershipId: people.approver.membershipId,
      revocationReason: 'The Accounting Reviewer found a wrong step.',
      revokedAt: expect.any(Date),
    });
    await expect(eventsOf(period.id, 'PAYROLL_PERIOD_CERTIFICATION_REVOKED')).resolves.toEqual([
      expect.objectContaining({
        actorMembershipId: people.approver.membershipId,
        previousStatus: 'CERTIFIED',
        newStatus: 'FOR_REVIEW',
        reason: 'The Accounting Reviewer found a wrong step.',
      }),
    ]);
    await expect(
      certification.revokeCertification(people.certifier, period.id, {
        reason: 'Again',
        rowVersion: revoked.rowVersion,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_PERIOD_NOT_CERTIFIED' });

    // The certifier certifies the same version again, then revokes it in HR_CERTIFICATION.
    const again = await certification.certify(people.certifier, period.id, {
      calculationVersion: 1,
      calculationHash: period.calculationHash,
    });
    await certification.revokeCertification(people.certifier, period.id, {
      reason: 'Personnel corrected the salary step.',
      rowVersion: again.rowVersion,
    });
    const reviewed = await periods.read(people.certifier, period.id);
    expect(reviewed).toMatchObject({ status: 'FOR_REVIEW', certification: null });
    await expect(
      admin.payrollCertification.count({ where: { payrollPeriodId: period.id, revokedAt: null } }),
    ).resolves.toBe(0);

    // Return claims no function and needs a reason.
    await expect(
      certification.returnForCorrection(people.accountingReviewer, period.id, {
        rowVersion: reviewed.rowVersion,
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' });
    await expect(
      certification.returnForCorrection(people.accountingReviewer, period.id, {
        reason: 'Stale',
        rowVersion: reviewed.rowVersion - 1,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_PERIOD_STALE' });
    const returned = await certification.returnForCorrection(people.accountingReviewer, period.id, {
      reason: 'Correct the salary step and recalculate.',
      rowVersion: reviewed.rowVersion,
    });
    expect(returned).toMatchObject({ status: 'DRAFT', calculationVersion: 1 });
    await expect(eventsOf(period.id, 'PAYROLL_PERIOD_RETURNED')).resolves.toEqual([
      expect.objectContaining({
        actorMembershipId: people.accountingReviewer.membershipId,
        previousStatus: 'FOR_REVIEW',
        newStatus: 'DRAFT',
        reason: 'Correct the salary step and recalculate.',
        metadata: { calculationVersion: 1 },
      }),
    ]);
    const actors = await actorsOf(period.id);
    expect(actors).toEqual(
      expect.arrayContaining([
        { membershipId: people.preparer.membershipId, payrollFunction: 'PREPARATION' },
        { membershipId: people.certifier.membershipId, payrollFunction: 'HR_CERTIFICATION' },
        { membershipId: people.approver.membershipId, payrollFunction: 'APPROVAL' },
      ]),
    );
    expect(actors).toHaveLength(3);

    // The recalculation is a new version: a certification of the old one is refused.
    const recalculated = await calculate(payrollTenant, period.id);
    expect(recalculated).toMatchObject({ status: 'FOR_REVIEW', calculationVersion: 2 });
    await expect(
      certification.certify(people.certifier, period.id, {
        calculationVersion: 1,
        calculationHash: period.calculationHash,
      }),
    ).rejects.toMatchObject({ code: 'PAYROLL_CALCULATION_VERSION_CHANGED' });
    await expect(
      certification.certify(people.certifier, period.id, {
        calculationVersion: 2,
        calculationHash: recalculated.calculationHash,
      }),
    ).resolves.toMatchObject({ status: 'CERTIFIED', calculationVersion: 2 });
  });

  it('lets one of two certifiers acting at once certify, and refuses the other', async () => {
    const payrollTenant = await tenant('RACE');
    const people = roles(payrollTenant);
    const period = await calculatedPeriod(payrollTenant);
    const input = { calculationVersion: 1, calculationHash: period.calculationHash };

    const outcomes = await Promise.allSettled([
      certification.certify(people.certifier, period.id, input),
      certification.certify(people.secondCertifier, period.id, input),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const [refused] = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(refused).toMatchObject({
      reason: { statusCode: 409, code: 'PAYROLL_PERIOD_NOT_FOR_REVIEW' },
    });
    await expect(
      admin.payrollCertification.count({ where: { payrollPeriodId: period.id } }),
    ).resolves.toBe(1);
    await expect(eventsOf(period.id, 'PAYROLL_PERIOD_CERTIFIED')).resolves.toHaveLength(1);
    // Only the winner holds HR_CERTIFICATION; the refused certify rolled its claim back.
    const certifiers = (await actorsOf(period.id)).filter(
      (actor) => actor.payrollFunction === 'HR_CERTIFICATION',
    );
    expect(certifiers).toHaveLength(1);
  });

  it('refuses a person who already acts in another payroll function', async () => {
    const payrollTenant = await tenant('FORBIDDEN');
    const people = roles(payrollTenant);
    const period = await calculatedPeriod(payrollTenant);

    // The preparer holds payroll.periods.certify, but prepares this period.
    await expect(
      certification.certify(people.preparer, period.id, {
        calculationVersion: 1,
        calculationHash: period.calculationHash,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_FUNCTION_CONFLICT' });
    await expect(periods.read(people.certifier, period.id)).resolves.toMatchObject({
      status: 'FOR_REVIEW',
      certification: null,
    });

    // A Payroll Approver who revoked acts in APPROVAL, so cannot later certify.
    const certified = await certification.certify(people.certifier, period.id, {
      calculationVersion: 1,
      calculationHash: period.calculationHash,
    });
    await certification.revokeCertification(people.approver, period.id, {
      reason: 'Funding is not yet confirmed.',
      rowVersion: certified.rowVersion,
    });
    await expect(
      certification.certify(
        {
          ...people.approver,
          permissions: [{ code: 'payroll.periods.certify', scopePolicy: 'AGENCY' }],
        },
        period.id,
        { calculationVersion: 1, calculationHash: period.calculationHash },
      ),
    ).rejects.toMatchObject({ code: 'PAYROLL_FUNCTION_CONFLICT' });
  });

  it('refuses to certify while the current version has an open blocking exception', async () => {
    const payrollTenant = await tenant('BLOCKED');
    const people = roles(payrollTenant);
    const draft = await periods.create(people.preparer, {
      code: `CERTIFY-BLOCKED-${suffix}`,
      runType: 'REGULAR',
      periodFrom: '2886-04-01',
      periodTo: '2886-04-30',
      cutoffAt: '2026-01-01T00:00:00+08:00',
      paymentDate: '2886-04-15',
    });
    // A calculation returns a blocking exception to DRAFT, so FOR_REVIEW with
    // one is reached only as a source cancellation will (#649): the fixture
    // steps through the moves the period guard allows.
    await admin.payrollPeriod.update({
      where: { id: draft.id },
      data: { status: 'CALCULATING', calculationVersion: 1 },
    });
    await admin.payrollException.create({
      data: {
        agencyId: payrollTenant.agency.id,
        payrollPeriodId: draft.id,
        calculationVersion: 1,
        exceptionType: 'PAYROLL_INPUT_CANCELLED',
        severity: 'BLOCKING',
        status: 'OPEN',
        details: { message: 'A Payroll Input this calculation used was cancelled.' },
      },
    });
    await admin.payrollPeriod.update({ where: { id: draft.id }, data: { status: 'FOR_REVIEW' } });

    await expect(
      certification.certify(people.certifier, draft.id, {
        calculationVersion: 1,
        calculationHash: payrollCalculationHash([]),
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_PERIOD_BLOCKING_EXCEPTION' });
    await expect(
      admin.payrollCertification.count({ where: { payrollPeriodId: draft.id } }),
    ).resolves.toBe(0);
  });

  it('keeps certifications in the database: written while FOR_REVIEW, revoked once, never deleted', async () => {
    const payrollTenant = await tenant('GUARD');
    const people = roles(payrollTenant);
    const period = await calculatedPeriod(payrollTenant);
    const row = {
      agencyId: payrollTenant.agency.id,
      payrollPeriodId: period.id,
      calculationHash: period.calculationHash!,
      certifiedByMembershipId: people.certifier.membershipId,
    };
    await expect(
      admin.payrollCertification.create({ data: { ...row, calculationVersion: 2 } }),
    ).rejects.toThrow(/certified while FOR_REVIEW/);

    const certified = await certification.certify(people.certifier, period.id, {
      calculationVersion: 1,
      calculationHash: period.calculationHash,
    });
    const { id } = (await periods.read(people.certifier, period.id)).certification!;
    await expect(
      admin.payrollCertification.update({
        where: { id },
        data: { calculationHash: 'e'.repeat(64) },
      }),
    ).rejects.toThrow(/only to record its revocation/);
    await expect(admin.payrollCertification.delete({ where: { id } })).rejects.toThrow(
      /cannot be deleted/,
    );
    await certification.revokeCertification(people.certifier, period.id, {
      reason: 'Recheck the leave without pay.',
      rowVersion: certified.rowVersion,
    });
    await expect(
      admin.payrollCertification.update({
        where: { id },
        data: { revocationReason: 'Rewritten' },
      }),
    ).rejects.toThrow(/only to record its revocation/);
  });

  it('seeds the §6.10 roles with the review permissions', async () => {
    const grants = await admin.rolePermission.findMany({
      where: {
        role: {
          agencyId: null,
          code: { in: ['hr_certifier', 'accounting_reviewer', 'payroll_approver'] },
        },
        permission: {
          code: {
            in: [
              'payroll.periods.certify',
              'payroll.periods.revoke_certification',
              'payroll.periods.return',
            ],
          },
        },
      },
      select: {
        scopePolicy: true,
        role: { select: { code: true } },
        permission: { select: { code: true } },
      },
    });
    expect(
      grants
        .map((grant) => `${grant.role.code} ${grant.permission.code} ${grant.scopePolicy}`)
        .sort(),
    ).toEqual([
      'accounting_reviewer payroll.periods.return AGENCY',
      'hr_certifier payroll.periods.certify AGENCY',
      'hr_certifier payroll.periods.return AGENCY',
      'hr_certifier payroll.periods.revoke_certification AGENCY',
      'payroll_approver payroll.periods.return AGENCY',
      'payroll_approver payroll.periods.revoke_certification AGENCY',
    ]);
  });
});
