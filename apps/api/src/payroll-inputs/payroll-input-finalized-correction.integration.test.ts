import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@lingkod-hr/auth';
import { encryptProtectedValue, getConfig, parseProtectedValueKey } from '@lingkod-hr/config';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { Prisma, PrismaClient } from '@prisma/client';
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
import { PayrollApprovalService } from '../payroll-periods/payroll-approval.service';
import { PayrollCertificationService } from '../payroll-periods/payroll-certification.service';
import { PayrollCheckpointReviewService } from '../payroll-periods/payroll-checkpoint-review.service';
import { PayrollFinalizationService } from '../payroll-periods/payroll-finalization.service';
import { PayrollPeriodsService } from '../payroll-periods/payroll-periods.service';
import {
  cleanupPayrollTenants,
  createAdminClient,
  createPayrollTenant,
  FIXTURE_PREFIX,
  type PayrollTenant,
} from '../payroll-periods/payroll-periods.test-fixtures';
import { PayrollVoidService } from '../payroll-periods/payroll-void.service';
import { PayrollInputsService } from './payroll-inputs.service';

const enabled = process.env.DATABASE_E2E === 'true';

describe.skipIf(!enabled)('Correcting a Payroll Input a finalized payroll consumed (#650)', () => {
  // Test fixtures only: the rate is not from any issuance, and 2872 sits
  // clear of every other test's rule versions and periods.
  const suffix = `${Date.now()}-finalized-input`;
  const scheduleCode = `${FIXTURE_PREFIX}FINALIZED-INPUT-SCHEDULE-2872-${suffix}`;
  const documents = new DocumentsService({} as never, {} as never);
  const inputs = new PayrollInputsService();
  const periods = new PayrollPeriodsService();
  const certification = new PayrollCertificationService();
  const approval = new PayrollApprovalService();
  const finalization = new PayrollFinalizationService();
  const reviews = new PayrollCheckpointReviewService(documents);
  const voids = new PayrollVoidService(documents);
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

  function roles(tenant: PayrollTenant) {
    const as = (index: number, codes: string[]): RequestContext => ({
      ...tenant.persons[index]!.context,
      permissions: [...codes, 'payroll.periods.read'].map((code) => ({
        code,
        scopePolicy: 'AGENCY' as const,
      })),
    });
    const approver = [
      'payroll.periods.approve',
      'payroll.periods.finalize',
      'payroll.periods.void',
      'payroll.periods.approve_void',
    ];
    return {
      preparer: as(0, ['payroll.periods.create', 'payroll.periods.calculate']),
      certifier: as(1, ['payroll.periods.certify']),
      budgetOfficer: as(2, ['payroll.periods.review_funding']),
      accountingReviewer: as(3, ['payroll.periods.review_accounting']),
      approver: as(4, approver),
      secondApprover: as(5, approver),
    };
  }

  /** Fixture rows written with triggers off, standing in for what another command would write. */
  const seed = <T>(run: (transaction: Prisma.TransactionClient) => Promise<T>) =>
    admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      return run(transaction);
    });

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
        storageKey: `finalized-input/${agency.id}/${document.id}`,
        contentHash: 'f'.repeat(64),
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

  /** Leave's day without pay on `workDate`, accepted PENDING. */
  async function leaveWithoutPay(agencyId: string, employeeId: string, workDate: string) {
    const accepted = await withDatabaseContext({ agencyId }, (transaction) =>
      inputs.acceptInTransaction(transaction, {
        agencyId,
        employeeId,
        sourceModule: 'LEAVE',
        inputKind: 'LEAVE_WITHOUT_PAY',
        sourceKey: `leave-posting:${randomUUID()}:payroll`,
        sourceType: 'LeavePosting',
        sourceId: randomUUID(),
        effectiveDate: workDate,
        quantity: '1',
        payload: { unitCode: 'WORKING_DAY', workDates: [{ workDate, quantity: '1.0000' }] },
      }),
    );
    if (!('payrollInputId' in accepted)) throw new Error(`Payroll refused: ${accepted.reason}`);
    return accepted.payrollInputId;
  }

  /**
   * An Agency whose one SG-11 step-1 Employee took two days of leave without
   * pay in March 2872, each posted as a Payroll Input, with a verified account.
   */
  async function agency(label: string) {
    const tenant = await createPayrollTenant(admin, suffix, `FIN-${label}`, 6);
    tenants.push(tenant);
    const {
      agency: { id: agencyId },
      persons,
    } = tenant;
    const membershipId = persons[0]!.membership.id;
    const unit = await admin.organizationUnit.create({
      data: { agencyId, code: `UNIT-${label}-${suffix}`, unitType: 'DIVISION', status: 'ACTIVE' },
    });
    const employee = await admin.employee.create({
      data: {
        agencyId,
        employeeNumber: `FIN-${label}-${suffix}`,
        legalName: `Finalized Input ${label}`,
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `finalized-input-${label.toLowerCase()}-${suffix}@example.test`,
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
            agencyId,
            employeeId: employee.id,
            organizationUnitId: unit.id,
            appointmentStatus: 'PERMANENT',
            salaryGrade: 11,
            salaryStep: 1,
            effectiveFrom: new Date('2872-01-01'),
            effectiveTo: null,
            status: 'ACTIVE',
            createdByMembershipId: membershipId,
          },
        }),
    );
    const first = await leaveWithoutPay(agencyId, employee.id, '2872-03-05');
    const second = await leaveWithoutPay(agencyId, employee.id, '2872-03-06');
    const key = parseProtectedValueKey(getConfig().DATA_ENCRYPTION_KEY!);
    const sealed = encryptProtectedValue('0011234567', key, {
      metadata: JSON.stringify({
        purpose: 'PAYROLL_BANK_ACCOUNT',
        employeeId: employee.id,
        bankCode: 'LBP',
      }),
    });
    await seed((transaction) =>
      transaction.payrollBankAccount.create({
        data: {
          agencyId,
          employeeId: employee.id,
          bankCode: 'LBP',
          accountName: `Holder ${label}`,
          encryptedAccountNumber: new Uint8Array(sealed.envelope),
          maskedAccountNumber: sealed.maskedValue,
          verificationState: 'VERIFIED',
          verifiedAt: new Date('2000-01-01T00:00:00Z'),
          status: 'ACTIVE',
          effectiveFrom: new Date('2000-01-01'),
          reason: 'Verified test fixture',
          createdByMembershipId: membershipId,
          updatedByMembershipId: membershipId,
        },
      }),
    );
    return {
      tenant,
      agencyId,
      people: roles(tenant),
      employeeId: employee.id,
      inputIds: [first, second] as const,
      evidence: await evidenceVersion(tenant),
    };
  }

  type Setup = Awaited<ReturnType<typeof agency>>;

  /** March 2872, run through the whole review chain and finalized, consuming both inputs. */
  async function finalizedMarch(setup: Setup) {
    const { people, tenant } = setup;
    const code = `FIN-2872-03-${tenant.agency.id.slice(0, 8)}`;
    const draft = await periods.create(people.preparer, {
      code,
      runType: 'REGULAR',
      periodFrom: '2872-03-01',
      periodTo: '2872-03-31',
      cutoffAt: new Date().toISOString(),
      paymentDate: '2872-03-15',
    });
    const started = await periods.startCalculation(people.preparer, draft.id, {
      rowVersion: draft.rowVersion,
    });
    await expect(
      calculation.run({
        agencyId: tenant.agency.id,
        payrollPeriodId: draft.id,
        calculationVersion: started.calculationVersion,
      }),
    ).resolves.toMatchObject({ outcome: 'FOR_REVIEW' });
    const reviewed = await periods.read(people.certifier, draft.id);
    await certification.certify(people.certifier, draft.id, {
      calculationVersion: reviewed.calculationVersion,
      calculationHash: reviewed.calculationHash,
    });
    const certified = await periods.read(people.certifier, draft.id);
    const exportId = certified.certification!.reviewExportId!;
    await reviews.record(people.budgetOfficer, 'BUDGET', draft.id, exportId, {
      outcome: 'CONFIRMED',
      externalReference: `ORS-${code}`,
      evidenceDocumentVersionId: setup.evidence,
    });
    await reviews.record(people.accountingReviewer, 'ACCOUNTING', draft.id, exportId, {
      outcome: 'CONFIRMED',
      externalReference: `JEV-${code}`,
      evidenceDocumentVersionId: setup.evidence,
    });
    const approved = await approval.approve(people.approver, draft.id, {
      rowVersion: certified.rowVersion,
    });
    const period = await finalization.finalize(people.approver, draft.id, {
      rowVersion: approved.rowVersion,
    });
    const result = await admin.payrollEmployee.findFirstOrThrow({
      where: { payrollPeriodId: period.id, calculationVersion: period.calculationVersion },
      select: { id: true, status: true, netAmount: true },
    });
    return { period, result };
  }

  const withdraw = (setup: Setup, payrollInputId: string, correctionKey: string) =>
    withDatabaseContext({ agencyId: setup.agencyId }, (transaction) =>
      inputs.withdrawInTransaction(transaction, {
        agencyId: setup.agencyId,
        sourceModule: 'LEAVE',
        payrollInputId,
        correctionKey,
      }),
    );

  const inputState = (id: string) =>
    admin.payrollInput.findUniqueOrThrow({
      where: { id },
      select: { status: true, consumedByPayrollPeriodId: true, sourceCorrectionKey: true },
    });

  const causesOf = (payrollAdjustmentId: string) =>
    admin.payrollAdjustmentCause.findMany({
      where: { payrollAdjustmentId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { origin: true, payrollInputId: true, sourceCorrectionKey: true },
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
          verifiedOn: new Date('2026-11-24'),
          verifiedBy: 'LingkodHR test fixture',
          effectiveFrom: new Date('2872-01-01'),
          effectiveTo: new Date('2872-12-31'),
        },
      });
      await transaction.salaryGradeRate.create({
        data: { ruleVersionId: version.id, salaryGrade: 11, salaryStep: 1, monthlyRate: '44000' },
      });
      return version.id;
    });
  });

  afterAll(async () => {
    if (!admin) return;
    await seed(async (transaction) => {
      const where = { agencyId: { in: tenants.map((each) => each.agency.id) } };
      await transaction.disbursementOutcome.deleteMany({ where });
      await transaction.paymentInstruction.deleteMany({ where });
      await transaction.paymentExport.deleteMany({ where });
      await transaction.payrollBankAccount.deleteMany({ where });
      await transaction.payslip.deleteMany({ where });
      await transaction.payrollAdjustmentCause.deleteMany({ where });
      await transaction.outboxEvent.deleteMany({ where });
      await transaction.payrollConsumedAttendanceFact.deleteMany({ where });
      await transaction.payrollLineSource.deleteMany({ where });
      await transaction.payrollLine.deleteMany({ where });
      await transaction.payrollRuleSnapshotItem.deleteMany({ where });
      await transaction.payrollAdjustment.deleteMany({ where });
      await transaction.payrollInput.deleteMany({ where });
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

  it('opens a Payroll Adjustment for the finalized input, leaves the payroll unchanged, and answers a retry with it', async () => {
    const setup = await agency('RETRY');
    const [input, other] = setup.inputIds;
    const { period: march, result } = await finalizedMarch(setup);
    const before = {
      period: await admin.payrollPeriod.findUniqueOrThrow({ where: { id: march.id } }),
      result: await admin.payrollEmployee.findUniqueOrThrow({ where: { id: result.id } }),
      input: await inputState(input),
    };
    expect(before.input).toEqual({
      status: 'CONSUMED',
      consumedByPayrollPeriodId: march.id,
      sourceCorrectionKey: null,
    });
    // The original result rests on the input, through its own lines.
    const lines = await admin.payrollLine.findMany({
      where: { payrollEmployeeId: result.id },
      select: { id: true },
    });
    await expect(
      admin.payrollLineSource.count({
        where: { payrollInputId: input, payrollLineId: { in: lines.map((line) => line.id) } },
      }),
    ).resolves.toBe(1);

    const key = `leave-cancellation:${suffix}:retry`;
    const deferred = await withdraw(setup, input, key);
    expect(deferred).toEqual({
      outcome: 'DEFERRED',
      payrollInputId: input,
      payrollAdjustmentId: expect.any(String),
      originalPayrollPeriodId: march.id,
      adjustmentStatus: 'OPEN',
    });
    const { payrollAdjustmentId } = deferred as { payrollAdjustmentId: string };

    // The adjustment names the original period and the result's Employee, and
    // its cause names the input and the source's key.
    await expect(
      admin.payrollAdjustment.findUniqueOrThrow({ where: { id: payrollAdjustmentId } }),
    ).resolves.toMatchObject({
      agencyId: setup.agencyId,
      originalPayrollPeriodId: march.id,
      employeeId: setup.employeeId,
      status: 'OPEN',
    });
    await expect(causesOf(payrollAdjustmentId)).resolves.toEqual([
      { origin: 'SOURCE_CORRECTION', payrollInputId: input, sourceCorrectionKey: key },
    ]);

    // The finalized payroll and the consumed input are unchanged.
    await expect(
      admin.payrollPeriod.findUniqueOrThrow({ where: { id: march.id } }),
    ).resolves.toEqual(before.period);
    await expect(
      admin.payrollEmployee.findUniqueOrThrow({ where: { id: result.id } }),
    ).resolves.toEqual(before.result);
    await expect(inputState(input)).resolves.toEqual(before.input);

    // A retry, in any case, answers the same adjustment and writes nothing.
    await expect(withdraw(setup, input, key.toUpperCase())).resolves.toEqual({
      ...deferred,
      outcome: 'ALREADY_DEFERRED',
    });
    await expect(causesOf(payrollAdjustmentId)).resolves.toHaveLength(1);
    // Another key cannot withdraw it again, and the key cannot withdraw another input.
    await expect(withdraw(setup, input, `${key}:again`)).resolves.toMatchObject({
      outcome: 'REJECTED',
      code: 'PAYROLL_INPUT_ALREADY_WITHDRAWN',
    });
    await expect(withdraw(setup, other, key)).resolves.toMatchObject({
      outcome: 'REJECTED',
      code: 'PAYROLL_CORRECTION_KEY_CONFLICT',
    });

    // Another Agency sees no such input.
    const stranger = await createPayrollTenant(admin, suffix, 'FIN-STRANGER', 1);
    tenants.push(stranger);
    await expect(
      withDatabaseContext({ agencyId: stranger.agency.id }, (transaction) =>
        inputs.withdrawInTransaction(transaction, {
          agencyId: stranger.agency.id,
          sourceModule: 'LEAVE',
          payrollInputId: input,
          correctionKey: `${key}:stranger`,
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'REJECTED', code: 'PAYROLL_INPUT_NOT_FOUND' });

    // The source may post a replacement for the deferred input at once.
    const replacement = await withDatabaseContext({ agencyId: setup.agencyId }, (transaction) =>
      inputs.acceptInTransaction(transaction, {
        agencyId: setup.agencyId,
        employeeId: setup.employeeId,
        sourceModule: 'LEAVE',
        inputKind: 'LEAVE_WITHOUT_PAY',
        sourceKey: key,
        sourceType: 'LeavePosting',
        sourceId: randomUUID(),
        effectiveDate: '2872-03-05',
        quantity: '0.5',
        replacesPayrollInputId: input,
        payload: {
          unitCode: 'WORKING_DAY',
          workDates: [{ workDate: '2872-03-05', quantity: '0.5000' }],
        },
      }),
    );
    expect(replacement).toMatchObject({ outcome: 'ACCEPTED' });
    await expect(
      admin.payrollInput.findUniqueOrThrow({
        where: { id: (replacement as { payrollInputId: string }).payrollInputId },
        select: { status: true, replacesPayrollInputId: true },
      }),
    ).resolves.toEqual({ status: 'PENDING', replacesPayrollInputId: input });
  });

  it('joins a second correction of the same payroll and Employee to the open adjustment', async () => {
    const setup = await agency('JOIN');
    const [first, second] = setup.inputIds;
    const { period: march } = await finalizedMarch(setup);

    const opened = await withdraw(setup, first, `leave-cancellation:${suffix}:join-1`);
    const joined = await withdraw(setup, second, `leave-cancellation:${suffix}:join-2`);
    expect(opened).toMatchObject({ outcome: 'DEFERRED', adjustmentStatus: 'OPEN' });
    const { payrollAdjustmentId } = opened as { payrollAdjustmentId: string };
    expect(joined).toEqual({
      outcome: 'DEFERRED',
      payrollInputId: second,
      payrollAdjustmentId,
      originalPayrollPeriodId: march.id,
      adjustmentStatus: 'OPEN',
    });
    await expect(
      admin.payrollAdjustment.count({ where: { originalPayrollPeriodId: march.id } }),
    ).resolves.toBe(1);
    await expect(causesOf(payrollAdjustmentId)).resolves.toEqual([
      {
        origin: 'SOURCE_CORRECTION',
        payrollInputId: first,
        sourceCorrectionKey: `leave-cancellation:${suffix}:join-1`,
      },
      {
        origin: 'SOURCE_CORRECTION',
        payrollInputId: second,
        sourceCorrectionKey: `leave-cancellation:${suffix}:join-2`,
      },
    ]);
    for (const id of [first, second]) {
      await expect(inputState(id)).resolves.toMatchObject({ status: 'CONSUMED' });
    }
  });

  it('lets the carrying period recalculate the original without the withdrawn input', async () => {
    const setup = await agency('CARRY');
    const [withdrawn, kept] = setup.inputIds;
    const { period: march, result } = await finalizedMarch(setup);
    // March deducted both days in one line: 2 × 44,000 ÷ 22.
    const marchDeduction = await admin.payrollLine.findFirstOrThrow({
      where: { payrollEmployeeId: result.id, lineType: 'DEDUCTION' },
      select: { id: true, amount: true },
    });
    expect(marchDeduction.amount.toFixed(2)).toBe('4000.00');
    await expect(
      admin.payrollLineSource.findMany({
        where: { payrollLineId: marchDeduction.id },
        orderBy: { payrollInputId: 'asc' },
        select: { payrollInputId: true },
      }),
    ).resolves.toEqual([withdrawn, kept].sort().map((payrollInputId) => ({ payrollInputId })));

    const deferred = await withdraw(setup, withdrawn, `leave-cancellation:${suffix}:carry`);
    const { payrollAdjustmentId } = deferred as { payrollAdjustmentId: string };

    // April carries the adjustment: March recalculated with only the kept day
    // deducts 2,000, so the difference gives back the withdrawn day's 2,000.
    const { people, tenant } = setup;
    const april = await periods.create(people.preparer, {
      code: `FIN-2872-04-${tenant.agency.id.slice(0, 8)}`,
      runType: 'REGULAR',
      periodFrom: '2872-04-01',
      periodTo: '2872-04-30',
      cutoffAt: new Date().toISOString(),
      paymentDate: '2872-04-15',
    });
    const started = await periods.startCalculation(people.preparer, april.id, {
      rowVersion: april.rowVersion,
    });
    await expect(
      calculation.run({
        agencyId: tenant.agency.id,
        payrollPeriodId: april.id,
        calculationVersion: started.calculationVersion,
      }),
    ).resolves.toMatchObject({ outcome: 'FOR_REVIEW' });
    const aprilResult = await admin.payrollEmployee.findFirstOrThrow({
      where: {
        payrollPeriodId: april.id,
        calculationVersion: started.calculationVersion,
        employeeId: setup.employeeId,
      },
      include: { lines: { orderBy: { id: 'asc' } } },
    });
    const carried = aprilResult.lines.filter((line) => line.payrollAdjustmentId !== null);
    expect(
      carried.map((line) => ({
        lineType: line.lineType,
        amount: line.amount.toFixed(2),
        payrollAdjustmentId: line.payrollAdjustmentId,
      })),
    ).toEqual([{ lineType: 'DEDUCTION', amount: '-2000.00', payrollAdjustmentId }]);
    expect(carried[0]!.sourceSnapshot).toMatchObject({
      payrollAdjustment: { payrollAdjustmentId, originalPayrollPeriodId: march.id },
      recalculatedAmount: '2000.0000',
      previousAmount: '4000.0000',
    });
    // April's own pay is its basic salary, plus the day given back.
    expect(aprilResult.netAmount.toFixed(2)).toBe('46000.00');
    // March and the withdrawn input are still as finalized.
    await expect(
      admin.payrollLine.findUniqueOrThrow({ where: { id: marchDeduction.id } }),
    ).resolves.toMatchObject({ amount: marchDeduction.amount });
    await expect(inputState(withdrawn)).resolves.toMatchObject({
      status: 'CONSUMED',
      consumedByPayrollPeriodId: march.id,
    });
  });

  it('withdraws an input a void returned to PENDING, with no adjustment', async () => {
    const setup = await agency('VOID');
    const [input] = setup.inputIds;
    const { period: march } = await finalizedMarch(setup);
    const requested = await voids.request(setup.people.approver, march.id, {
      reason: 'The whole March payroll used the wrong salary schedule.',
      documentVersionId: setup.evidence,
      rowVersion: march.rowVersion,
    });
    await voids.approve(setup.people.secondApprover, march.id, {
      rowVersion: requested.rowVersion,
    });
    await expect(inputState(input)).resolves.toEqual({
      status: 'PENDING',
      consumedByPayrollPeriodId: null,
      sourceCorrectionKey: null,
    });

    const key = `leave-cancellation:${suffix}:void`;
    await expect(withdraw(setup, input, key)).resolves.toEqual({
      outcome: 'WITHDRAWN',
      payrollInputId: input,
    });
    await expect(inputState(input)).resolves.toEqual({
      status: 'CANCELLED',
      consumedByPayrollPeriodId: null,
      sourceCorrectionKey: key,
    });
    await expect(
      admin.payrollAdjustment.count({ where: { originalPayrollPeriodId: march.id } }),
    ).resolves.toBe(0);
    await expect(withdraw(setup, input, key)).resolves.toEqual({
      outcome: 'ALREADY_WITHDRAWN',
      payrollInputId: input,
    });
  });
});
