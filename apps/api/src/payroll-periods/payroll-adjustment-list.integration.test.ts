import type { RequestContext } from '@lingkod-hr/auth';
import type { Prisma, PrismaClient } from '@prisma/client';
import { withDatabaseContext } from '@lingkod-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import { DocumentsService } from '../documents/documents.service';
import { BasicSalaryCalculator } from '../payroll-calculation/basic-salary.calculator';
import { DaysWithoutPayCalculator } from '../payroll-calculation/days-without-pay.calculator';
import { PayrollCalculationService } from '../payroll-calculation/payroll-calculation.service';
import {
  payrollSourcesReader,
  RecordedPayBases,
} from '../payroll-calculation/payroll-calculation.test-fixtures';
import { PayrollAdjustmentsService } from './payroll-adjustments.service';
import { PayrollApprovalService } from './payroll-approval.service';
import { PayrollCertificationService } from './payroll-certification.service';
import { PayrollCheckpointReviewService } from './payroll-checkpoint-review.service';
import { PayrollFinalizationService } from './payroll-finalization.service';
import { PayrollPeriodsService } from './payroll-periods.service';
import {
  cleanupPayrollTenants,
  createAdminClient,
  createPayrollTenant,
  FIXTURE_PREFIX,
  type PayrollTenant,
} from './payroll-periods.test-fixtures';

const enabled = process.env.DATABASE_E2E === 'true';

describe.skipIf(!enabled)('Payroll Adjustment list in PostgreSQL', () => {
  // Test fixtures only: the rates are not from any issuance, and 2864 sits
  // clear of every other test's rule versions.
  const suffix = `${Date.now()}-adjustment-list`;
  const scheduleCode = `${FIXTURE_PREFIX}ADJUSTMENT-LIST-SCHEDULE-${suffix}`;
  const periods = new PayrollPeriodsService();
  const certification = new PayrollCertificationService();
  const approval = new PayrollApprovalService();
  const finalization = new PayrollFinalizationService();
  const adjustments = new PayrollAdjustmentsService();
  const reviews = new PayrollCheckpointReviewService(
    new DocumentsService({} as never, {} as never),
  );
  const payBases = new RecordedPayBases();
  const basis = new CompensationBasisService(payBases);
  const nothing = { calculate: () => ({ lines: [], exceptions: [] }) };
  const calculation = new PayrollCalculationService(
    basis,
    new BasicSalaryCalculator(),
    payrollSourcesReader(basis),
    new DaysWithoutPayCalculator(),
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
        'payroll.inputs.adjust',
      ]),
      certifier: as(1, ['payroll.periods.read', 'payroll.periods.certify']),
      budgetOfficer: as(2, ['payroll.periods.read', 'payroll.periods.review_funding']),
      accountingReviewer: as(3, ['payroll.periods.read', 'payroll.periods.review_accounting']),
      approver: as(4, [
        'payroll.periods.read',
        'payroll.periods.approve',
        'payroll.periods.finalize',
      ]),
      reader: as(5, ['payroll.periods.read']),
      inputsOnly: as(5, ['payroll.inputs.read']),
    };
  }

  const seed = <T>(run: (transaction: Prisma.TransactionClient) => Promise<T>) =>
    admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      return run(transaction);
    });

  /** An Agency whose Employees are each SG-11 step 1 from January 2864. */
  async function agencyWith(label: string, employeeCount: number) {
    const tenant = await createPayrollTenant(admin, suffix, label, 6);
    tenants.push(tenant);
    const { agency, persons } = tenant;
    const membershipId = persons[0]!.membership.id;
    const unit = await admin.organizationUnit.create({
      data: {
        agencyId: agency.id,
        code: `UNIT-${label}-${suffix}`,
        unitType: 'DIVISION',
        status: 'ACTIVE',
      },
    });
    const employees = [];
    for (let index = 0; index < employeeCount; index += 1) {
      const employee = await admin.employee.create({
        data: {
          agencyId: agency.id,
          employeeNumber: `ADJ-LIST-${label}-${index}-${suffix}`,
          legalName: `Adjustment List ${label} ${index}`,
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `adjustment-list-${label.toLowerCase()}-${index}-${suffix}@example.test`,
          serviceStatus: 'ACTIVE',
          createdByMembershipId: membershipId,
          updatedByMembershipId: membershipId,
        },
      });
      payBases.bases.set(employee.id, { payBasis: 'MONTHLY_FULL_TIME', employmentFraction: null });
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
              effectiveFrom: new Date('2864-01-01'),
              effectiveTo: null,
              status: 'ACTIVE',
              createdByMembershipId: membershipId,
            },
          }),
      );
      employees.push(employee);
    }
    return { tenant, people: roles(tenant), employees };
  }

  async function evidenceVersion(tenant: PayrollTenant) {
    const { agency, persons } = tenant;
    const document = await admin.document.create({
      data: {
        agencyId: agency.id,
        documentType: 'EXTERNAL_EVIDENCE',
        classification: 'INTERNAL',
        status: 'APPROVED',
        createdByMembershipId: persons[0]!.membership.id,
      },
    });
    const version = await admin.documentVersion.create({
      data: {
        agencyId: agency.id,
        documentId: document.id,
        versionNo: 1,
        storageKey: `adjustment-list/${agency.id}/${document.id}`,
        contentHash: 'd'.repeat(64),
        mimeType: 'application/pdf',
        sizeBytes: 1,
        issuedAt: new Date(),
        createdByMembershipId: persons[0]!.membership.id,
      },
    });
    await admin.document.update({
      where: { id: document.id },
      data: { currentVersionId: version.id },
    });
    return version.id;
  }

  /** Start and run a DRAFT period's calculation, expecting it FOR_REVIEW. */
  async function calculate(
    tenant: PayrollTenant,
    people: ReturnType<typeof roles>,
    period: { id: string; rowVersion: number },
  ) {
    const started = await periods.startCalculation(people.preparer, period.id, {
      rowVersion: period.rowVersion,
    });
    await expect(
      calculation.run({
        agencyId: tenant.agency.id,
        payrollPeriodId: period.id,
        calculationVersion: started.calculationVersion,
      }),
    ).resolves.toMatchObject({ outcome: 'FOR_REVIEW' });
  }

  /** Certify, review, approve, and finalize a FOR_REVIEW period. */
  async function finalize(
    tenant: PayrollTenant,
    people: ReturnType<typeof roles>,
    periodId: string,
  ) {
    const reviewed = await periods.read(people.certifier, periodId);
    await certification.certify(people.certifier, periodId, {
      calculationVersion: reviewed.calculationVersion,
      calculationHash: reviewed.calculationHash,
    });
    const certified = await periods.read(people.certifier, periodId);
    const exportId = certified.certification!.reviewExportId!;
    const evidence = await evidenceVersion(tenant);
    await reviews.record(people.budgetOfficer, 'BUDGET', periodId, exportId, {
      outcome: 'CONFIRMED',
      externalReference: `ORS-${periodId.slice(0, 8)}`,
      evidenceDocumentVersionId: evidence,
    });
    await reviews.record(people.accountingReviewer, 'ACCOUNTING', periodId, exportId, {
      outcome: 'CONFIRMED',
      externalReference: `JEV-${periodId.slice(0, 8)}`,
      evidenceDocumentVersionId: evidence,
    });
    const approved = await approval.approve(people.approver, periodId, {
      rowVersion: certified.rowVersion,
    });
    await finalization.finalize(people.approver, periodId, { rowVersion: approved.rowVersion });
  }

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
          verifiedOn: new Date('2026-11-25'),
          verifiedBy: 'LingkodHR test fixture',
          effectiveFrom: new Date('2864-01-01'),
          effectiveTo: new Date('2864-12-31'),
        },
      });
      await transaction.salaryGradeRate.createMany({
        data: [
          { ruleVersionId: version.id, salaryGrade: 11, salaryStep: 1, monthlyRate: '44000' },
          { ruleVersionId: version.id, salaryGrade: 11, salaryStep: 2, monthlyRate: '46200' },
        ],
      });
      return version.id;
    });
  });

  afterAll(async () => {
    if (!admin) return;
    await seed(async (transaction) => {
      const where = { agencyId: { in: tenants.map((each) => each.agency.id) } };
      await transaction.payrollAdjustmentCause.deleteMany({ where });
      await transaction.outboxEvent.deleteMany({ where });
      await transaction.payrollLineSource.deleteMany({ where });
      await transaction.payrollLine.deleteMany({ where });
      await transaction.payrollRuleSnapshotItem.deleteMany({ where });
      await transaction.payrollAdjustment.deleteMany({ where });
      await transaction.payrollExportCheckpointReview.deleteMany({ where });
      await transaction.documentVersion.deleteMany({ where });
      await transaction.document.deleteMany({ where });
      await transaction.serviceSegment.deleteMany({ where });
      await transaction.employee.deleteMany({ where });
      await transaction.organizationUnit.deleteMany({ where });
      await transaction.$executeRaw`DELETE FROM salary_grade_rates WHERE rule_version_id = CAST(${scheduleId} AS uuid)`;
      await transaction.$executeRaw`DELETE FROM national_payroll_rule_versions WHERE code = ${scheduleCode}`;
    });
    await cleanupPayrollTenants(admin, tenants);
    await admin.$disconnect();
  });

  it('lists each adjustment with its causes, the period carrying it, and the one that posted it', async () => {
    const { tenant, people, employees } = await agencyWith('LIST', 2);
    const [raised, unchanged] = employees as [(typeof employees)[0], (typeof employees)[0]];
    const march = await periods.create(people.preparer, {
      code: 'ADJ-LIST-2864-03',
      runType: 'REGULAR',
      periodFrom: '2864-03-01',
      periodTo: '2864-03-31',
      cutoffAt: new Date().toISOString(),
      paymentDate: '2864-03-15',
    });
    await calculate(tenant, people, march);
    await finalize(tenant, people, march.id);
    await expect(adjustments.list(people.reader, {})).resolves.toEqual([]);

    // A step increment recorded after March was paid raises one Employee's March.
    await seed((transaction) =>
      transaction.serviceSegment.updateMany({
        where: { agencyId: tenant.agency.id, employeeId: raised.id },
        data: { salaryStep: 2 },
      }),
    );
    const owed = await adjustments.openRecalculation(people.preparer, march.id, {
      employeeId: raised.id,
      reason: 'Step increment effective January 2864, recorded late.',
    });
    const none = await adjustments.openRecalculation(people.preparer, march.id, {
      employeeId: unchanged.id,
      reason: 'Check March for this Employee too.',
    });
    const owedId = owed.adjustments[0]!.payrollAdjustmentId;
    const noneId = none.adjustments[0]!.payrollAdjustmentId;
    const marchRef = { id: march.id, code: 'ADJ-LIST-2864-03', status: 'FINALIZED' };

    const opened = await adjustments.list(people.reader, {});
    expect(opened.map((row) => row.id)).toEqual([noneId, owedId]);
    expect(opened[1]).toEqual({
      id: owedId,
      employeeId: raised.id,
      status: 'OPEN',
      openedAt: expect.any(String),
      postedAt: null,
      cancelledAt: null,
      originalPayrollPeriod: marchRef,
      carriedBy: [],
      postedBy: null,
      causes: [
        {
          id: expect.any(String),
          origin: 'RECALCULATION',
          reason: 'Step increment effective January 2864, recorded late.',
          payrollInputId: null,
          sourceCorrectionKey: null,
          payrollHoldId: null,
          openedByMembershipId: people.preparer.membershipId,
          openedByName: 'Payroll Period LIST User 0',
          createdAt: expect.any(String),
        },
      ],
    });

    // The supplemental payroll carries both while it is reviewed; it pays only the positive one.
    const supplemental = await periods.create(people.preparer, {
      code: 'ADJ-LIST-2864-SUPPLEMENTAL',
      runType: 'SPECIAL',
      periodFrom: '2864-04-01',
      periodTo: '2864-04-10',
      cutoffAt: new Date().toISOString(),
      paymentDate: '2864-04-10',
      carriesAdjustments: true,
    });
    await calculate(tenant, people, supplemental);
    const supplementalRef = {
      id: supplemental.id,
      code: 'ADJ-LIST-2864-SUPPLEMENTAL',
      status: 'FOR_REVIEW',
    };
    const carried = await adjustments.list(people.reader, {});
    expect(carried.map(({ id, carriedBy }) => ({ id, carriedBy }))).toEqual([
      { id: noneId, carriedBy: [supplementalRef] },
      { id: owedId, carriedBy: [supplementalRef] },
    ]);

    await finalize(tenant, people, supplemental.id);
    const finalizedRef = { ...supplementalRef, status: 'FINALIZED' };
    const posted = await adjustments.list(people.reader, {});
    expect(posted).toEqual([
      expect.objectContaining({ id: noneId, status: 'OPEN', carriedBy: [], postedBy: null }),
      expect.objectContaining({
        id: owedId,
        status: 'POSTED',
        postedAt: expect.any(String),
        carriedBy: [],
        postedBy: finalizedRef,
      }),
    ]);

    // Filters by status and by original period.
    await expect(adjustments.list(people.reader, { status: 'OPEN' })).resolves.toEqual([
      expect.objectContaining({ id: noneId }),
    ]);
    await expect(adjustments.list(people.reader, { status: 'POSTED' })).resolves.toEqual([
      expect.objectContaining({ id: owedId }),
    ]);
    await expect(
      adjustments.list(people.reader, { originalPayrollPeriodId: march.id }),
    ).resolves.toHaveLength(2);
    await expect(
      adjustments.list(people.reader, { originalPayrollPeriodId: supplemental.id }),
    ).resolves.toEqual([]);
  });

  it('reads a source correction waiting in an adjustment, and keeps each Agency to its own', async () => {
    const own = await agencyWith('SOURCE', 1);
    const other = await agencyWith('ELSEWHERE', 1);
    const [employee] = own.employees as [(typeof own.employees)[0]];
    const march = await periods.create(own.people.preparer, {
      code: 'ADJ-SOURCE-2864-03',
      runType: 'REGULAR',
      periodFrom: '2864-03-01',
      periodTo: '2864-03-31',
      cutoffAt: new Date().toISOString(),
      paymentDate: '2864-03-15',
    });
    await calculate(own.tenant, own.people, march);
    await finalize(own.tenant, own.people, march.id);

    // What a source's withdrawal of a consumed input writes (#650), standing in for that command.
    const inputId = crypto.randomUUID();
    const adjustmentId = await seed(async (transaction) => {
      const adjustment = await transaction.payrollAdjustment.create({
        data: {
          agencyId: own.tenant.agency.id,
          originalPayrollPeriodId: march.id,
          employeeId: employee.id,
          status: 'OPEN',
        },
      });
      await transaction.payrollAdjustmentCause.create({
        data: {
          agencyId: own.tenant.agency.id,
          payrollAdjustmentId: adjustment.id,
          origin: 'SOURCE_CORRECTION',
          payrollInputId: inputId,
          sourceCorrectionKey: `LEAVE_CANCELLATION:${suffix}`,
        },
      });
      return adjustment.id;
    });

    await expect(adjustments.list(own.people.reader, { status: 'OPEN' })).resolves.toEqual([
      expect.objectContaining({
        id: adjustmentId,
        status: 'OPEN',
        causes: [
          expect.objectContaining({
            origin: 'SOURCE_CORRECTION',
            payrollInputId: inputId,
            sourceCorrectionKey: `LEAVE_CANCELLATION:${suffix}`,
            reason: null,
            openedByMembershipId: null,
            openedByName: null,
          }),
        ],
      }),
    ]);

    // Another Agency reads none of it, even by naming the period.
    await expect(adjustments.list(other.people.reader, {})).resolves.toEqual([]);
    await expect(
      adjustments.list(other.people.reader, { originalPayrollPeriodId: march.id }),
    ).resolves.toEqual([]);
    await expect(adjustments.list(own.people.inputsOnly, {})).rejects.toMatchObject({
      statusCode: 403,
      code: 'PAYROLL_PERIOD_READ_FORBIDDEN',
    });
    await expect(adjustments.list(own.people.reader, { status: 'PAID' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_INPUT',
    });
    await expect(
      adjustments.list(own.people.reader, { originalPayrollPeriodId: 'not-a-period' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' });
  });
});
