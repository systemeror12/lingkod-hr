import type { RequestContext } from '@lingkod-hr/auth';
import type { Prisma, PrismaClient } from '@prisma/client';
import { withDatabaseContext } from '@lingkod-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import { DeductionObligationsService } from '../deduction-obligations/deduction-obligations.service';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
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
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe.skipIf(!enabled)('Recovering a negative Payroll Adjustment in PostgreSQL', () => {
  // Test fixtures only: the floor and order follow FY 2026 GAA sec. 62
  // (salary-overpayment-recovery-authorities.md R6), but no real version is
  // loaded, and the rates are not from any issuance. 2866 and 2867 sit clear
  // of every other test's rule versions; the deduction rule covers 2866 only,
  // so a 2867 period stands in for FY 2027, whose GAA is not issued.
  const suffix = `${Date.now()}-recovery`;
  const codes = {
    schedule: `${FIXTURE_PREFIX}RECOVERY-SCHEDULE-${suffix}`,
    deductions: `${FIXTURE_PREFIX}RECOVERY-DEDUCTIONS-${suffix}`,
  };
  const periods = new PayrollPeriodsService();
  const certification = new PayrollCertificationService();
  const approval = new PayrollApprovalService();
  const finalization = new PayrollFinalizationService();
  const adjustments = new PayrollAdjustmentsService();
  const documents = new DocumentsService({} as never, documentAuditWriter);
  const obligations = new DeductionObligationsService(documents);
  const reviews = new PayrollCheckpointReviewService(documents);
  const payBases = new RecordedPayBases();
  const basis = new CompensationBasisService(payBases);
  // Only basic salary pays here, and the Deduction Obligations apply after it.
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
        'payroll.deductions.manage',
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
  type People = ReturnType<typeof roles>;

  /** Fixture rows written with triggers off, standing in for what another command would write. */
  const seed = <T>(run: (transaction: Prisma.TransactionClient) => Promise<T>) =>
    admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      return run(transaction);
    });

  /** An Agency whose Employees are SG-11 step 2 from January 2866, each to `serviceTo`. */
  async function agencyWith(label: string, serviceTo: (string | null)[]) {
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
    for (const [index, effectiveTo] of serviceTo.entries()) {
      const employee = await admin.employee.create({
        data: {
          agencyId: agency.id,
          employeeNumber: `RECOVERY-${label}-${index}-${suffix}`,
          legalName: `Recovery ${label} ${index}`,
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `recovery-${label.toLowerCase()}-${index}-${suffix}@example.test`,
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
              salaryStep: 2,
              effectiveFrom: date('2866-01-01'),
              effectiveTo: effectiveTo ? date(effectiveTo) : null,
              status: 'ACTIVE',
              createdByMembershipId: membershipId,
            },
          }),
      );
      employees.push(employee);
    }
    return { tenant, people: roles(tenant), employees };
  }

  /** A finalized Document Version, such as a COA decision or an official receipt. */
  async function documentVersion(tenant: PayrollTenant, documentType: string) {
    const { agency, persons } = tenant;
    const document = await admin.document.create({
      data: {
        agencyId: agency.id,
        documentType,
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
        storageKey: `recovery/${agency.id}/${document.id}`,
        contentHash: 'e'.repeat(64),
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
    return { authorityDocumentId: document.id, authorityDocumentVersionId: version.id };
  }

  /** A DRAFT regular period for one month. */
  function draftMonth(people: People, year: number, month: number) {
    const mm = String(month).padStart(2, '0');
    return periods.create(people.preparer, {
      code: `REC-${year}-${mm}`,
      runType: 'REGULAR',
      periodFrom: `${year}-${mm}-01`,
      periodTo: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
      cutoffAt: new Date().toISOString(),
      paymentDate: `${year}-${mm}-15`,
    });
  }

  /** Start and run a DRAFT period's calculation. */
  async function calculate(tenant: PayrollTenant, people: People, period: { id: string }) {
    const draft = await periods.read(people.reader, period.id);
    const started = await periods.startCalculation(people.preparer, period.id, {
      rowVersion: draft.rowVersion,
    });
    const outcome = await calculation.run({
      agencyId: tenant.agency.id,
      payrollPeriodId: period.id,
      calculationVersion: started.calculationVersion,
    });
    return { ...started, outcome };
  }

  /** Certify, review, approve, and finalize a FOR_REVIEW period through its own review chain. */
  async function finalize(tenant: PayrollTenant, people: People, periodId: string) {
    const reviewed = await periods.read(people.certifier, periodId);
    await certification.certify(people.certifier, periodId, {
      calculationVersion: reviewed.calculationVersion,
      calculationHash: reviewed.calculationHash,
    });
    const certified = await periods.read(people.certifier, periodId);
    const exportId = certified.certification!.reviewExportId!;
    const evidence = await documentVersion(tenant, 'EXTERNAL_EVIDENCE');
    await reviews.record(people.budgetOfficer, 'BUDGET', periodId, exportId, {
      outcome: 'CONFIRMED',
      externalReference: `ORS-${periodId.slice(0, 8)}`,
      evidenceDocumentVersionId: evidence.authorityDocumentVersionId,
    });
    await reviews.record(people.accountingReviewer, 'ACCOUNTING', periodId, exportId, {
      outcome: 'CONFIRMED',
      externalReference: `JEV-${periodId.slice(0, 8)}`,
      evidenceDocumentVersionId: evidence.authorityDocumentVersionId,
    });
    const approved = await approval.approve(people.approver, periodId, {
      rowVersion: certified.rowVersion,
    });
    return finalization.finalize(people.approver, periodId, { rowVersion: approved.rowVersion });
  }

  /** The Employee's result in the period's current version, with its lines and loan lines. */
  async function resultOf(periodId: string, employeeId: string) {
    const period = await admin.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
    const result = await admin.payrollEmployee.findFirst({
      where: {
        payrollPeriodId: periodId,
        calculationVersion: period.calculationVersion,
        employeeId,
      },
      include: { lines: true },
    });
    if (!result) return undefined;
    const components = new Map(
      (await admin.payComponent.findMany({ select: { id: true, code: true } })).map((component) => [
        component.id,
        component.code,
      ]),
    );
    const loans = await admin.loanDeductionLine.findMany({
      where: { payrollEmployeeId: result.id },
      orderBy: { priority: 'asc' },
    });
    return {
      status: result.status,
      net: result.netAmount.toFixed(2),
      lines: result.lines
        .map((line) => ({
          code: components.get(line.payComponentId),
          amount: line.amount.toFixed(2),
          payrollAdjustmentId: line.payrollAdjustmentId,
          deductionObligationId:
            ((line.sourceSnapshot ?? {}) as { deductionObligationId?: string })
              .deductionObligationId ?? null,
          recovers:
            ((line.sourceSnapshot ?? {}) as { payrollAdjustmentId?: string }).payrollAdjustmentId ??
            null,
        }))
        .sort((a, b) => Number(b.amount) - Number(a.amount)),
      loans: loans.map((loan) => ({
        deductionObligationId: loan.deductionObligationId,
        priority: loan.priority,
        due: loan.amountDue.toFixed(2),
        deducted: loan.deductedAmount.toFixed(2),
        notDeducted: loan.notDeductedAmount.toFixed(2),
      })),
    };
  }

  const exceptionsOf = async (periodId: string, employeeId: string) => {
    const period = await admin.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
    return admin.payrollException.findMany({
      where: {
        payrollPeriodId: periodId,
        calculationVersion: period.calculationVersion,
        employeeId,
      },
      orderBy: { exceptionType: 'asc' },
    });
  };

  /** Correct the Employees' step to 1 for 2866, as Personnel would after the month was paid. */
  const stepCorrected = (tenant: PayrollTenant) =>
    seed((transaction) =>
      transaction.serviceSegment.updateMany({
        where: { agencyId: tenant.agency.id },
        data: { salaryStep: 1 },
      }),
    );

  beforeAll(async () => {
    admin = await createAdminClient();
    const rule = {
      issuingAuthority: 'Test authority',
      issuanceReference: 'Test fixture, not an issuance',
      sourceUrl: 'https://example.test/recovery',
      verifiedOn: date('2026-11-22'),
      verifiedBy: 'LingkodHR test fixture',
    };
    await admin.$transaction(async (transaction) => {
      const schedule = await transaction.nationalPayrollRuleVersion.create({
        data: {
          ...rule,
          ruleKind: 'SALARY_SCHEDULE',
          code: codes.schedule,
          name: 'Test SALARY_SCHEDULE',
          effectiveFrom: date('2866-01-01'),
          effectiveTo: date('2867-12-31'),
        },
      });
      await transaction.salaryGradeRate.createMany({
        data: [
          { ruleVersionId: schedule.id, salaryGrade: 11, salaryStep: 1, monthlyRate: '44000' },
          { ruleVersionId: schedule.id, salaryGrade: 11, salaryStep: 2, monthlyRate: '46200' },
        ],
      });
      await transaction.nationalPayrollRuleVersion.create({
        data: {
          ...rule,
          ruleKind: 'AUTHORIZED_DEDUCTIONS',
          code: codes.deductions,
          name: 'Test AUTHORIZED_DEDUCTIONS',
          effectiveFrom: date('2866-01-01'),
          effectiveTo: date('2866-12-31'),
          parameters: {
            allowedPayeeCategories: [
              'GSIS',
              'NATIONAL_GOVERNMENT_COA_DECISION',
              'EMPLOYEE_COOPERATIVE_OR_ASSOCIATION',
            ],
            priorityPayeeCategories: ['GSIS'],
            monthlyNetTakeHomeFloor: '5000.00',
          },
        },
      });
    });
  });

  afterAll(async () => {
    if (!admin) return;
    await seed(async (transaction) => {
      const where = { agencyId: { in: tenants.map((each) => each.agency.id) } };
      await transaction.loanDeductionLine.deleteMany({ where });
      await transaction.deductionObligation.deleteMany({ where });
      await transaction.payrollAdjustmentCause.deleteMany({ where });
      await transaction.outboxEvent.deleteMany({ where });
      await transaction.payrollLineSource.deleteMany({ where });
      await transaction.payrollLine.deleteMany({ where });
      await transaction.payrollRuleSnapshotItem.deleteMany({ where });
      await transaction.payrollAdjustment.deleteMany({ where });
      await transaction.payrollExportCheckpointReview.deleteMany({ where });
      await transaction.document.updateMany({ where, data: { currentVersionId: null } });
      await transaction.documentVersion.deleteMany({ where });
      await transaction.document.deleteMany({ where });
      await transaction.serviceSegment.deleteMany({ where });
      await transaction.employee.deleteMany({ where });
      await transaction.organizationUnit.deleteMany({ where });
    });
    await cleanupPayrollTenants(admin, tenants);
    await seed(async (transaction) => {
      await transaction.$executeRaw`DELETE FROM salary_grade_rates WHERE rule_version_id IN (SELECT id FROM national_payroll_rule_versions WHERE code = ${codes.schedule})`;
      for (const code of Object.values(codes)) {
        await transaction.$executeRaw`DELETE FROM national_payroll_rule_versions WHERE code = ${code}`;
      }
    });
    await admin.$disconnect();
  });

  it('records a COA recovery, deducts it by priority and floor through two periods, and closes it', async () => {
    const { tenant, people, employees } = await agencyWith('SERVING', [null]);
    const [employee] = employees as [(typeof employees)[0]];
    const scope = tenant.persons[0]!.scope;

    // March is paid at step 2; Personnel then corrects 2866 to step 1.
    const march = await draftMonth(people, 2866, 3);
    await calculate(tenant, people, march);
    await finalize(tenant, people, march.id);
    await stepCorrected(tenant);
    const opened = await adjustments.openRecalculation(people.preparer, march.id, {
      employeeId: employee.id,
      reason: 'Step 2 was recorded in error; the Employee is step 1 for 2866.',
    });
    const adjustmentId = opened.adjustments[0]!.payrollAdjustmentId;
    const coa = await documentVersion(tenant, 'EXTERNAL_EVIDENCE');
    const decision = {
      payeeName: 'National Government',
      issuerReference: `COE-2866-${suffix}`,
      // The date the decision became final and executory (ADR 0017).
      incurredOn: '2866-04-20',
      // The monthly amount COA approved on the Employee's request.
      scheduledAmount: '2000',
      effectiveFrom: '2866-05-01',
      ...coa,
    };

    // No calculation has found the amount yet.
    await expect(
      obligations.recordRecovery(people.preparer, adjustmentId, decision),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_ADJUSTMENT_NOT_NEGATIVE' });

    // April carries the adjustment as today: no line, a warning, and it stays OPEN.
    const april = await draftMonth(people, 2866, 4);
    await expect(calculate(tenant, people, april)).resolves.toMatchObject({
      outcome: { outcome: 'FOR_REVIEW' },
    });
    const warning = (await exceptionsOf(april.id, employee.id)).find(
      (exception) => exception.exceptionType === 'PAYROLL_ADJUSTMENT_NEGATIVE',
    );
    expect(warning).toMatchObject({
      exceptionType: 'PAYROLL_ADJUSTMENT_NEGATIVE',
      severity: 'WARNING',
      details: {
        payrollAdjustmentId: adjustmentId,
        netDifference: '-2200.0000',
        lines: [{ componentCode: 'BASIC_SALARY', lineType: 'EARNING', amount: '-2200.0000' }],
      },
    });
    await expect(resultOf(april.id, employee.id)).resolves.toMatchObject({
      lines: [{ code: 'BASIC_SALARY', amount: '44000.00', payrollAdjustmentId: null }],
    });
    await finalize(tenant, people, april.id);
    await expect(
      admin.payrollAdjustment.findUniqueOrThrow({ where: { id: adjustmentId } }),
    ).resolves.toMatchObject({ status: 'OPEN' });

    // The database refuses a recovery written around the command: a balance
    // the recorder entered, and a posting with no obligation.
    const payeeRuleVersionId = (
      await admin.nationalPayrollRuleVersion.findFirstOrThrow({ where: { code: codes.deductions } })
    ).id;
    await expect(
      withDatabaseContext(scope, (transaction) =>
        transaction.deductionObligation.create({
          data: {
            agencyId: tenant.agency.id,
            employeeId: employee.id,
            payeeCategory: 'NATIONAL_GOVERNMENT_COA_DECISION',
            payeeName: 'National Government',
            issuerReference: 'COE-ENTERED',
            incurredOn: date('2866-04-20'),
            outstandingBalance: '1000',
            scheduledAmount: '1000',
            authorityDocumentVersionId: coa.authorityDocumentVersionId,
            payeeRuleVersionId,
            effectiveFrom: date('2866-05-01'),
            status: 'ACTIVE',
            recordedByMembershipId: scope.membershipId,
            payrollAdjustmentId: adjustmentId,
            payrollExceptionId: warning!.id,
          },
        }),
      ),
    ).rejects.toThrow(/balance is the negative difference/);
    await expect(
      withDatabaseContext(scope, (transaction) =>
        transaction.payrollAdjustment.update({
          where: { id: adjustmentId },
          data: { status: 'POSTED', postedAt: new Date() },
        }),
      ),
    ).rejects.toThrow(/only as the COA obligation that recovers it is recorded/);

    // The Employee's other obligations: a GSIS loan (statutory, so first,
    // although incurred later) and a cooperative loan incurred before the
    // recovery, so ahead of it in the order incurred.
    const loanAuthority = await documentVersion(tenant, 'SALARY_DEDUCTION_AUTHORITY');
    const gsis = await obligations.record(people.preparer, employee.id, {
      payeeCategory: 'GSIS',
      payeeName: 'Government Service Insurance System',
      issuerReference: `GSIS-${suffix}`,
      incurredOn: '2866-04-25',
      outstandingBalance: '50000',
      scheduledAmount: '500',
      effectiveFrom: '2866-05-01',
      ...loanAuthority,
    });
    const cooperative = await obligations.record(people.preparer, employee.id, {
      payeeCategory: 'EMPLOYEE_COOPERATIVE_OR_ASSOCIATION',
      payeeName: 'Employees Cooperative',
      issuerReference: `COOP-${suffix}`,
      incurredOn: '2865-06-01',
      outstandingBalance: '38000',
      scheduledAmount: '38000',
      effectiveFrom: '2866-05-01',
      ...loanAuthority,
    });

    const recovery = await obligations.recordRecovery(people.preparer, adjustmentId, decision);
    expect(recovery).toMatchObject({
      employeeId: employee.id,
      payeeCategory: 'NATIONAL_GOVERNMENT_COA_DECISION',
      incurredOn: '2866-04-20',
      // The balance is the calculated recovery, not entered.
      outstandingBalance: '2200.0000',
      scheduledAmount: '2000.0000',
      status: 'ACTIVE',
      payrollAdjustmentId: adjustmentId,
      payrollExceptionId: warning!.id,
    });
    // The same transaction posted the adjustment: no period's lines carry it.
    await expect(
      admin.payrollAdjustment.findUniqueOrThrow({ where: { id: adjustmentId } }),
    ).resolves.toMatchObject({
      status: 'POSTED',
      postedByPayrollPeriodId: null,
      postedAt: expect.any(Date),
    });
    await expect(
      admin.auditEvent.findFirstOrThrow({
        where: { entityId: recovery.id, action: 'DEDUCTION_OBLIGATION_RECORDED' },
      }),
    ).resolves.toMatchObject({
      actorMembershipId: people.preparer.membershipId,
      metadata: {
        payrollAdjustment: { id: adjustmentId, previousStatus: 'OPEN', newStatus: 'POSTED' },
        recoveryAmountFrom: {
          payrollExceptionId: warning!.id,
          payrollPeriodId: april.id,
          netDifference: '-2200.0000',
        },
      },
    });
    // One obligation per adjustment.
    await expect(
      obligations.recordRecovery(people.preparer, adjustmentId, {
        ...decision,
        issuerReference: 'COE-AGAIN',
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_ADJUSTMENT_NOT_OPEN' });

    // May: GSIS first, then the cooperative loan, then the recovery, which
    // the floor stops at net take-home pay of 5,000.00. The rest stays owed.
    const may = await draftMonth(people, 2866, 5);
    await expect(calculate(tenant, people, may)).resolves.toMatchObject({
      outcome: { outcome: 'FOR_REVIEW' },
    });
    await expect(resultOf(may.id, employee.id)).resolves.toEqual({
      status: 'CALCULATED',
      net: '5000.00',
      lines: [
        expect.objectContaining({ code: 'BASIC_SALARY', amount: '44000.00' }),
        expect.objectContaining({
          code: 'LOAN_DEDUCTION',
          amount: '38000.00',
          deductionObligationId: cooperative.id,
          recovers: null,
        }),
        expect.objectContaining({
          code: 'LOAN_DEDUCTION',
          amount: '500.00',
          deductionObligationId: gsis.id,
          recovers: null,
        }),
        {
          code: 'LOAN_DEDUCTION',
          amount: '500.00',
          payrollAdjustmentId: null,
          deductionObligationId: recovery.id,
          recovers: adjustmentId,
        },
      ].sort((a, b) => Number(b.amount) - Number(a.amount)),
      loans: [
        {
          deductionObligationId: gsis.id,
          priority: 1,
          due: '500.00',
          deducted: '500.00',
          notDeducted: '0.00',
        },
        {
          deductionObligationId: cooperative.id,
          priority: 2,
          due: '38000.00',
          deducted: '38000.00',
          notDeducted: '0.00',
        },
        {
          deductionObligationId: recovery.id,
          priority: 3,
          due: '2000.00',
          deducted: '500.00',
          notDeducted: '1500.00',
        },
      ],
    });
    await expect(exceptionsOf(may.id, employee.id)).resolves.toEqual([
      expect.objectContaining({ exceptionType: 'NET_PAY_FLOOR_STOPPED_DEDUCTION' }),
      expect.objectContaining({ exceptionType: 'NET_PAY_VARIANCE' }),
    ]);
    // The recovery goes through May's own review chain to finalization.
    await expect(finalize(tenant, people, may.id)).resolves.toMatchObject({ status: 'FINALIZED' });

    // The cooperative loan is paid off. The Employee pays 1,500.00 of the
    // shortfall at the agency cashier; the change records it, with the
    // official receipt as its authority, and the 200.00 still owed.
    await obligations.end(people.preparer, cooperative.id, {
      effectiveTo: '2866-05-31',
      reason: 'Paid in full.',
    });
    const receipt = await documentVersion(tenant, 'EXTERNAL_EVIDENCE');
    const changed = await obligations.change(people.preparer, recovery.id, {
      outstandingBalance: '200',
      scheduledAmount: '2000',
      effectiveFrom: '2866-06-01',
      reason: 'Paid 1,500.00 of the May shortfall at the agency cashier.',
      ...receipt,
    });
    expect(changed).toMatchObject({
      supersedesObligationId: recovery.id,
      payrollAdjustmentId: adjustmentId,
      outstandingBalance: '200.0000',
    });

    // June takes what is still owed, and the recovery is collected.
    const june = await draftMonth(people, 2866, 6);
    await calculate(tenant, people, june);
    await expect(resultOf(june.id, employee.id)).resolves.toMatchObject({
      net: '43300.00',
      loans: [
        { deductionObligationId: gsis.id, deducted: '500.00' },
        { deductionObligationId: changed.id, due: '200.00', deducted: '200.00' },
      ],
    });
    await finalize(tenant, people, june.id);

    // A later recalculation of March finds nothing more to recover: the
    // recovered difference counts as settled. July deducts the recovery no
    // more, and posts the new adjustment, whose difference is zero.
    const again = await adjustments.openRecalculation(people.preparer, march.id, {
      employeeId: employee.id,
      reason: 'Confirm March after the recovery.',
    });
    const july = await draftMonth(people, 2866, 7);
    await calculate(tenant, people, july);
    await expect(resultOf(july.id, employee.id)).resolves.toMatchObject({
      net: '43500.00',
      lines: [
        { code: 'BASIC_SALARY', amount: '44000.00', payrollAdjustmentId: null },
        { code: 'LOAN_DEDUCTION', amount: '500.00', deductionObligationId: gsis.id },
      ],
      loans: [{ deductionObligationId: gsis.id }],
    });
    // No PAYROLL_ADJUSTMENT_NEGATIVE: only the variance from June.
    await expect(exceptionsOf(july.id, employee.id)).resolves.toEqual([
      expect.objectContaining({ exceptionType: 'NET_PAY_VARIANCE' }),
    ]);
    await finalize(tenant, people, july.id);
    await expect(
      admin.payrollAdjustment.findUniqueOrThrow({
        where: { id: again.adjustments[0]!.payrollAdjustmentId },
      }),
    ).resolves.toMatchObject({ status: 'POSTED', postedByPayrollPeriodId: july.id });
  });

  it('never collects from an Employee with no later pay, and blocks in a year with no deduction rule', async () => {
    const { tenant, people, employees } = await agencyWith('SEPARATED', [null, '2866-10-31']);
    const [serving, separated] = employees as [(typeof employees)[0], (typeof employees)[0]];

    const october = await draftMonth(people, 2866, 10);
    await calculate(tenant, people, october);
    await finalize(tenant, people, october.id);
    await stepCorrected(tenant);
    const opened = await adjustments.openRecalculation(people.preparer, october.id, {
      reason: 'Step 2 was recorded in error for 2866.',
    });
    const adjustmentOf = (employeeId: string) =>
      opened.adjustments.find((each) => each.employeeId === employeeId)!.payrollAdjustmentId;

    // November carries both: the separated Employee's result holds no line.
    const november = await draftMonth(people, 2866, 11);
    await expect(calculate(tenant, people, november)).resolves.toMatchObject({
      outcome: { outcome: 'FOR_REVIEW' },
    });
    await expect(resultOf(november.id, separated.id)).resolves.toMatchObject({ lines: [] });
    await finalize(tenant, people, november.id);

    const coa = await documentVersion(tenant, 'EXTERNAL_EVIDENCE');
    const decision = (employeeId: string, scheduledAmount: string) =>
      obligations.recordRecovery(people.preparer, adjustmentOf(employeeId), {
        payeeName: 'National Government',
        issuerReference: `COE-${employeeId.slice(0, 8)}`,
        incurredOn: '2866-11-20',
        scheduledAmount,
        effectiveFrom: '2866-12-01',
        ...coa,
      });
    const servingRecovery = await decision(serving.id, '1000');
    await decision(separated.id, '2200');

    // December deducts from the serving Employee only. The separated one has
    // no pay, so no result, and nothing is collected through payroll.
    const december = await draftMonth(people, 2866, 12);
    await calculate(tenant, people, december);
    await expect(resultOf(december.id, serving.id)).resolves.toMatchObject({
      net: '43000.00',
      loans: [{ deductionObligationId: servingRecovery.id, deducted: '1000.00' }],
    });
    await expect(resultOf(december.id, separated.id)).resolves.toBeUndefined();
    await finalize(tenant, people, december.id);

    // January 2867 has no deduction rule in effect: the recovery still owed
    // blocks the Employee rather than being taken without a floor.
    const january = await draftMonth(people, 2867, 1);
    await expect(calculate(tenant, people, january)).resolves.toMatchObject({
      outcome: { outcome: 'RETURNED' },
    });
    await expect(exceptionsOf(january.id, serving.id)).resolves.toEqual([
      expect.objectContaining({
        exceptionType: 'AUTHORIZED_DEDUCTIONS_RULE_NOT_IN_EFFECT',
        severity: 'BLOCKING',
      }),
    ]);
    await expect(resultOf(january.id, serving.id)).resolves.toMatchObject({
      status: 'EXCEPTION',
      lines: [],
    });
    await expect(resultOf(january.id, separated.id)).resolves.toBeUndefined();
  });
});
