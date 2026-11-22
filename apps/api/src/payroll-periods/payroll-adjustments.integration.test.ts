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

describe.skipIf(!enabled)('Payroll Adjustments in PostgreSQL', () => {
  // Test fixtures only: the rates are not from any issuance, and 2863 sits
  // clear of every other test's rule versions.
  const suffix = `${Date.now()}-adjustments`;
  const scheduleCode = `${FIXTURE_PREFIX}ADJUSTMENT-SCHEDULE-${suffix}`;
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
    };
  }

  /** Fixture rows written with triggers off, standing in for what another command would write. */
  const seed = <T>(run: (transaction: Prisma.TransactionClient) => Promise<T>) =>
    admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      return run(transaction);
    });

  /** An Agency whose Employees are each SG-11 step 1 from January 2863. */
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
          employeeNumber: `ADJUSTMENT-${label}-${index}-${suffix}`,
          legalName: `Adjustment ${label} ${index}`,
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `adjustment-${label.toLowerCase()}-${index}-${suffix}@example.test`,
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
              effectiveFrom: new Date('2863-01-01'),
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
        storageKey: `adjustments/${agency.id}/${document.id}`,
        contentHash: 'c'.repeat(64),
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

  /** A DRAFT regular period for one month of 2863. */
  function draftMonth(people: ReturnType<typeof roles>, month: string) {
    return periods.create(people.preparer, {
      code: `ADJ-2863-${month}`,
      runType: 'REGULAR',
      periodFrom: `2863-${month}-01`,
      periodTo: new Date(Date.UTC(2863, Number(month), 0)).toISOString().slice(0, 10),
      cutoffAt: new Date().toISOString(),
      paymentDate: `2863-${month}-15`,
    });
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
    return started;
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
    return finalization.finalize(people.approver, periodId, { rowVersion: approved.rowVersion });
  }

  /** Each line of the Employee's result in the period's current version. */
  async function linesOf(periodId: string, employeeId: string) {
    const period = await admin.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
    const result = await admin.payrollEmployee.findFirst({
      where: {
        payrollPeriodId: periodId,
        calculationVersion: period.calculationVersion,
        employeeId,
      },
      include: { lines: true },
    });
    // The result's own lines first, then each adjustment's.
    return result?.lines
      .map((line) => ({
        lineType: line.lineType,
        amount: line.amount.toFixed(2),
        payrollAdjustmentId: line.payrollAdjustmentId,
      }))
      .sort((a, b) =>
        (a.payrollAdjustmentId ?? '') === (b.payrollAdjustmentId ?? '')
          ? Number(a.amount) - Number(b.amount)
          : (a.payrollAdjustmentId ?? '') < (b.payrollAdjustmentId ?? '')
            ? -1
            : 1,
      );
  }

  const adjustmentsOf = (originalPayrollPeriodId: string) =>
    admin.payrollAdjustment.findMany({
      where: { originalPayrollPeriodId },
      include: { causes: { orderBy: { createdAt: 'asc' } } },
      orderBy: { openedAt: 'asc' },
    });

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
          verifiedOn: new Date('2026-11-21'),
          verifiedBy: 'LingkodHR test fixture',
          effectiveFrom: new Date('2863-01-01'),
          effectiveTo: new Date('2863-12-31'),
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
      await transaction.payrollHold.deleteMany({ where });
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

  /**
   * An Agency of two Employees whose March 2863 was finalized with the first
   * under an active Payroll Hold, so finalization opened their adjustment.
   */
  async function heldMarch(label: string) {
    const { tenant, people, employees } = await agencyWith(label, 2);
    const [held, paid] = employees as [(typeof employees)[0], (typeof employees)[0]];

    // The held Employee's pay basis is not on record, so March's first
    // calculation blocks them. The hold command is not built yet: the hold
    // stands in for what it would write in DRAFT against that exception.
    payBases.bases.delete(held.id);
    const march = await draftMonth(people, '03');
    const blocked = await periods.startCalculation(people.preparer, march.id, {
      rowVersion: march.rowVersion,
    });
    await expect(
      calculation.run({
        agencyId: tenant.agency.id,
        payrollPeriodId: march.id,
        calculationVersion: blocked.calculationVersion,
      }),
    ).resolves.toMatchObject({ outcome: 'RETURNED' });
    const exception = await admin.payrollException.findFirstOrThrow({
      where: { payrollPeriodId: march.id, employeeId: held.id, severity: 'BLOCKING' },
    });
    const hold = await seed((transaction) =>
      transaction.payrollHold.create({
        data: {
          agencyId: tenant.agency.id,
          payrollPeriodId: march.id,
          employeeId: held.id,
          payrollExceptionId: exception.id,
          reason: 'Awaiting the appointment papers.',
          placedByMembershipId: tenant.persons[0]!.membership.id,
        },
      }),
    );
    const returned = await periods.read(people.reader, march.id);
    await calculate(tenant, people, returned);
    // The papers arrive; the held month is paid on the salary on record for it.
    payBases.bases.set(held.id, { payBasis: 'MONTHLY_FULL_TIME', employmentFraction: null });
    await finalize(tenant, people, march.id);
    return { tenant, people, held, paid, march, hold };
  }

  it('opens an adjustment for a held Employee on finalization and pays the held month next', async () => {
    const { tenant, people, held, paid, march, hold } = await heldMarch('HOLD');
    await expect(linesOf(march.id, held.id)).resolves.toBeUndefined();
    await expect(linesOf(march.id, paid.id)).resolves.toEqual([
      { lineType: 'EARNING', amount: '44000.00', payrollAdjustmentId: null },
    ]);

    const [opened] = await adjustmentsOf(march.id);
    expect(opened).toMatchObject({
      employeeId: held.id,
      status: 'OPEN',
      causes: [{ origin: 'PAYROLL_HOLD', payrollHoldId: hold.id, reason: null }],
    });
    await expect(
      admin.auditEvent.findFirstOrThrow({
        where: { entityId: march.id, action: 'PAYROLL_PERIOD_FINALIZED' },
      }),
    ).resolves.toMatchObject({
      metadata: { postedPayrollAdjustmentIds: [], openedPayrollAdjustmentIds: [opened!.id] },
    });
    const marchLines = () =>
      admin.payrollLine.findMany({
        where: { payrollEmployee: { payrollPeriodId: march.id } },
        orderBy: { id: 'asc' },
      });
    const marchBefore = await marchLines();

    // April carries the open adjustment: the held Employee is paid April and,
    // through lines linked to the adjustment, the held March.
    const april = await draftMonth(people, '04');
    const aprilStarted = await calculate(tenant, people, april);
    await expect(
      admin.payrollRuleSnapshotItem.count({
        where: {
          payrollAdjustmentId: opened!.id,
          snapshot: {
            payrollPeriodId: april.id,
            calculationVersion: aprilStarted.calculationVersion,
          },
        },
      }),
    ).resolves.toBe(1);
    await expect(linesOf(april.id, held.id)).resolves.toEqual([
      { lineType: 'EARNING', amount: '44000.00', payrollAdjustmentId: null },
      { lineType: 'EARNING', amount: '44000.00', payrollAdjustmentId: opened!.id },
    ]);
    await expect(linesOf(april.id, paid.id)).resolves.toEqual([
      { lineType: 'EARNING', amount: '44000.00', payrollAdjustmentId: null },
    ]);
    const carriedLine = await admin.payrollLine.findFirstOrThrow({
      where: { payrollAdjustmentId: opened!.id },
    });
    expect(carriedLine.sourceSnapshot).toMatchObject({
      payrollAdjustment: {
        payrollAdjustmentId: opened!.id,
        originalPayrollPeriodId: march.id,
        periodFrom: '2863-03-01',
        periodTo: '2863-03-31',
      },
      recalculatedAmount: '44000.0000',
      previousAmount: '0.0000',
    });
    const aprilResult = await admin.payrollEmployee.findFirstOrThrow({
      where: { payrollPeriodId: april.id, employeeId: held.id },
    });
    expect(aprilResult.grossAmount.toFixed(2)).toBe('88000.00');
    expect(aprilResult.netAmount.toFixed(2)).toBe('88000.00');

    // The hold did not carry over, and April's finalization posts the adjustment.
    await finalize(tenant, people, april.id);
    await expect(adjustmentsOf(march.id)).resolves.toEqual([
      expect.objectContaining({
        id: opened!.id,
        status: 'POSTED',
        postedByPayrollPeriodId: april.id,
        postedAt: expect.any(Date),
      }),
    ]);
    await expect(adjustmentsOf(april.id)).resolves.toEqual([]);

    // The original payroll is never changed.
    await expect(linesOf(march.id, paid.id)).resolves.toEqual([
      { lineType: 'EARNING', amount: '44000.00', payrollAdjustmentId: null },
    ]);
    await expect(linesOf(march.id, held.id)).resolves.toBeUndefined();
    await expect(marchLines()).resolves.toEqual(marchBefore);

    // A recalculation of March now counts what April already paid: nothing is owed.
    const asked = await adjustments.openRecalculation(people.preparer, march.id, {
      employeeId: held.id,
      reason: 'Confirm the held month was paid in full.',
    });
    expect(asked.adjustments).toEqual([
      { payrollAdjustmentId: expect.any(String), employeeId: held.id, joined: false },
    ]);
    const may = await draftMonth(people, '05');
    await calculate(tenant, people, may);
    await expect(linesOf(may.id, held.id)).resolves.toEqual([
      { lineType: 'EARNING', amount: '44000.00', payrollAdjustmentId: null },
    ]);
    await finalize(tenant, people, may.id);
    await expect(
      admin.payrollAdjustment.findUniqueOrThrow({
        where: { id: asked.adjustments[0]!.payrollAdjustmentId },
      }),
    ).resolves.toMatchObject({ status: 'POSTED', postedByPayrollPeriodId: may.id });
  });

  it('pays a positive adjustment in a supplemental payroll, which pays nothing else', async () => {
    const { tenant, people, held, paid, march } = await heldMarch('SUPPLEMENTAL');
    const [opened] = await adjustmentsOf(march.id);

    const supplemental = await periods.create(people.preparer, {
      code: 'ADJ-2863-SUPPLEMENTAL',
      runType: 'SPECIAL',
      periodFrom: '2863-04-01',
      periodTo: '2863-04-10',
      cutoffAt: new Date().toISOString(),
      paymentDate: '2863-04-10',
      carriesAdjustments: true,
    });
    expect(supplemental).toMatchObject({ carriesAdjustments: true, payComponentIds: [] });
    await calculate(tenant, people, supplemental);
    await expect(linesOf(supplemental.id, held.id)).resolves.toEqual([
      { lineType: 'EARNING', amount: '44000.00', payrollAdjustmentId: opened!.id },
    ]);
    // An Employee it owes nothing has no result in it.
    await expect(linesOf(supplemental.id, paid.id)).resolves.toBeUndefined();
    await finalize(tenant, people, supplemental.id);
    await expect(adjustmentsOf(march.id)).resolves.toEqual([
      expect.objectContaining({ status: 'POSTED', postedByPayrollPeriodId: supplemental.id }),
    ]);

    // A regular period refuses the flag: it always carries the open adjustments.
    await expect(
      periods.create(people.preparer, {
        code: 'ADJ-2863-04-FLAGGED',
        runType: 'REGULAR',
        periodFrom: '2863-04-01',
        periodTo: '2863-04-30',
        cutoffAt: new Date().toISOString(),
        paymentDate: '2863-04-15',
        carriesAdjustments: true,
      }),
    ).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_REGULAR_CARRIES_ADJUSTMENTS' });
  });

  it('joins a second cause to the open adjustment and counts the difference once', async () => {
    const { tenant, people, employees } = await agencyWith('JOIN', 1);
    const [employee] = employees as [(typeof employees)[0]];
    const march = await draftMonth(people, '03');
    await calculate(tenant, people, march);
    await finalize(tenant, people, march.id);

    // A retroactive step increment recorded in Personnel after March was paid.
    await seed((transaction) =>
      transaction.serviceSegment.updateMany({
        where: { agencyId: tenant.agency.id, employeeId: employee.id },
        data: { salaryStep: 2 },
      }),
    );
    const first = await adjustments.openRecalculation(people.preparer, march.id, {
      employeeId: employee.id,
      reason: 'Step increment effective January 2863, recorded late.',
    });
    const second = await adjustments.openRecalculation(people.preparer, march.id, {
      reason: 'Recalculate March for every Employee after the step increments.',
    });
    expect(second.adjustments).toEqual([
      {
        payrollAdjustmentId: first.adjustments[0]!.payrollAdjustmentId,
        employeeId: employee.id,
        joined: true,
      },
    ]);
    const [adjustment] = await adjustmentsOf(march.id);
    expect(adjustment).toMatchObject({
      status: 'OPEN',
      causes: [
        {
          origin: 'RECALCULATION',
          reason: 'Step increment effective January 2863, recorded late.',
          openedByMembershipId: people.preparer.membershipId,
        },
        { origin: 'RECALCULATION', openedByMembershipId: people.preparer.membershipId },
      ],
    });
    await expect(
      admin.auditEvent.count({
        where: { entityId: march.id, action: 'PAYROLL_ADJUSTMENT_RECALCULATION_OPENED' },
      }),
    ).resolves.toBe(2);
    // Opening claims no payroll function on March.
    await expect(
      admin.payrollPeriodActor.count({
        where: { payrollPeriodId: march.id, membershipId: people.preparer.membershipId },
      }),
    ).resolves.toBe(1);

    const april = await draftMonth(people, '04');
    await calculate(tenant, people, april);
    await expect(linesOf(april.id, employee.id)).resolves.toEqual([
      { lineType: 'EARNING', amount: '46200.00', payrollAdjustmentId: null },
      { lineType: 'EARNING', amount: '2200.00', payrollAdjustmentId: adjustment!.id },
    ]);

    // While April carries it, a further cause would not be counted, so it is refused.
    await expect(
      adjustments.openRecalculation(people.preparer, march.id, {
        employeeId: employee.id,
        reason: 'Once more.',
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_ADJUSTMENT_IN_PAYROLL' });
    await finalize(tenant, people, april.id);
    await expect(adjustmentsOf(march.id)).resolves.toEqual([
      expect.objectContaining({ status: 'POSTED', postedByPayrollPeriodId: april.id }),
    ]);

    // The increment is withdrawn: March now pays less than was paid, so the
    // adjustment stays OPEN and the carrying period reports it.
    await seed((transaction) =>
      transaction.serviceSegment.updateMany({
        where: { agencyId: tenant.agency.id, employeeId: employee.id },
        data: { salaryStep: 1 },
      }),
    );
    const recovery = await adjustments.openRecalculation(people.preparer, march.id, {
      employeeId: employee.id,
      reason: 'The step increment was recorded in error.',
    });
    const may = await draftMonth(people, '05');
    const mayStarted = await calculate(tenant, people, may);
    await expect(linesOf(may.id, employee.id)).resolves.toEqual([
      { lineType: 'EARNING', amount: '44000.00', payrollAdjustmentId: null },
    ]);
    await expect(
      admin.payrollException.findFirstOrThrow({
        where: {
          payrollPeriodId: may.id,
          calculationVersion: mayStarted.calculationVersion,
          exceptionType: 'PAYROLL_ADJUSTMENT_NEGATIVE',
        },
      }),
    ).resolves.toMatchObject({
      employeeId: employee.id,
      severity: 'WARNING',
      details: {
        payrollAdjustmentId: recovery.adjustments[0]!.payrollAdjustmentId,
        netDifference: '-2200.0000',
      },
    });
    await finalize(tenant, people, may.id);
    await expect(
      admin.payrollAdjustment.findUniqueOrThrow({
        where: { id: recovery.adjustments[0]!.payrollAdjustmentId },
      }),
    ).resolves.toMatchObject({ status: 'OPEN', postedByPayrollPeriodId: null });
  });

  it('refuses an adjustment against a payroll that is not finalized, and across Agencies', async () => {
    const own = await agencyWith('REFUSE', 1);
    const other = await agencyWith('OTHER', 1);
    const [employee] = own.employees as [(typeof own.employees)[0]];
    const [stranger] = other.employees as [(typeof other.employees)[0]];
    const ask = { employeeId: employee.id, reason: 'Recalculate.' };

    const march = await draftMonth(own.people, '03');
    await expect(
      adjustments.openRecalculation(own.people.preparer, march.id, ask),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_PERIOD_NOT_FINALIZED' });
    await calculate(own.tenant, own.people, march);
    await expect(
      adjustments.openRecalculation(own.people.preparer, march.id, ask),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_PERIOD_NOT_FINALIZED' });
    // The database refuses one written around the command.
    await expect(
      withDatabaseContext(own.tenant.persons[0]!.scope, (transaction) =>
        transaction.payrollAdjustment.create({
          data: {
            agencyId: own.tenant.agency.id,
            originalPayrollPeriodId: march.id,
            employeeId: employee.id,
            status: 'OPEN',
          },
        }),
      ),
    ).rejects.toThrow(/opens only against a FINALIZED Payroll Period/);
    await finalize(own.tenant, own.people, march.id);

    await expect(
      adjustments.openRecalculation(own.people.reader, march.id, ask),
    ).rejects.toMatchObject({ statusCode: 403, code: 'PAYROLL_ADJUSTMENT_FORBIDDEN' });
    await expect(
      adjustments.openRecalculation(other.people.preparer, march.id, ask),
    ).rejects.toMatchObject({ statusCode: 404, code: 'PAYROLL_PERIOD_NOT_FOUND' });
    await expect(
      adjustments.openRecalculation(own.people.preparer, march.id, {
        employeeId: stranger.id,
        reason: 'Recalculate.',
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'EMPLOYEE_NOT_FOUND' });
    await expect(
      adjustments.openRecalculation(own.people.preparer, march.id, { reason: '  ' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' });

    // Another Agency's context can neither write into this Agency nor name its period.
    await expect(
      withDatabaseContext(other.tenant.persons[0]!.scope, (transaction) =>
        transaction.payrollAdjustment.create({
          data: {
            agencyId: own.tenant.agency.id,
            originalPayrollPeriodId: march.id,
            employeeId: employee.id,
            status: 'OPEN',
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withDatabaseContext(other.tenant.persons[0]!.scope, (transaction) =>
        transaction.payrollAdjustment.create({
          data: {
            agencyId: other.tenant.agency.id,
            originalPayrollPeriodId: march.id,
            employeeId: stranger.id,
            status: 'OPEN',
          },
        }),
      ),
    ).rejects.toThrow();

    const opened = await adjustments.openRecalculation(own.people.preparer, march.id, ask);
    const id = opened.adjustments[0]!.payrollAdjustmentId;
    await expect(
      withDatabaseContext(other.tenant.persons[0]!.scope, (transaction) =>
        transaction.payrollAdjustment.findMany({ where: { id } }),
      ),
    ).resolves.toEqual([]);
    // Only a later period's finalization posts it, and nothing deletes it.
    await expect(
      withDatabaseContext(own.tenant.persons[0]!.scope, (transaction) =>
        transaction.payrollAdjustment.update({
          where: { id },
          data: { status: 'POSTED', postedByPayrollPeriodId: march.id, postedAt: new Date() },
        }),
      ),
    ).rejects.toThrow(/posted only by the finalization of a later period/);
    await expect(
      withDatabaseContext(own.tenant.persons[0]!.scope, (transaction) =>
        transaction.payrollAdjustment.delete({ where: { id } }),
      ),
    ).rejects.toThrow();
  });
});
