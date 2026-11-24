import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@lingkod-hr/auth';
import { encryptProtectedValue, getConfig, parseProtectedValueKey } from '@lingkod-hr/config';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import { DocumentsService } from '../documents/documents.service';
import { DisbursementOutcomesService } from '../payment-exports/disbursement-outcomes.service';
import { PaymentExportsService } from '../payment-exports/payment-exports.service';
import { BasicSalaryCalculator } from '../payroll-calculation/basic-salary.calculator';
import { DaysWithoutPayCalculator } from '../payroll-calculation/days-without-pay.calculator';
import { PayrollCalculationService } from '../payroll-calculation/payroll-calculation.service';
import {
  payrollSourcesReader,
  RecordedPayBases,
} from '../payroll-calculation/payroll-calculation.test-fixtures';
import { PayrollInputsService } from '../payroll-inputs/payroll-inputs.service';
import { PayrollAdjustmentsService } from './payroll-adjustments.service';
import { PayrollApprovalService } from './payroll-approval.service';
import { PayrollCertificationService } from './payroll-certification.service';
import { PayrollCheckpointReviewService } from './payroll-checkpoint-review.service';
import { PayrollFinalizationService } from './payroll-finalization.service';
import { lockRegularPeriodSequence, PayrollPeriodsService } from './payroll-periods.service';
import {
  cleanupPayrollTenants,
  createAdminClient,
  createPayrollTenant,
  FIXTURE_PREFIX,
  type PayrollTenant,
} from './payroll-periods.test-fixtures';
import { PAYROLL_PERIOD_VOIDED, PayrollVoidService } from './payroll-void.service';

const enabled = process.env.DATABASE_E2E === 'true';

describe.skipIf(!enabled)('Payroll void and replace in PostgreSQL', () => {
  // Test fixtures only: the rate is not from any issuance, and 2871 sits
  // clear of every other test's rule versions.
  const suffix = `${Date.now()}-void`;
  const scheduleCode = `${FIXTURE_PREFIX}VOID-SCHEDULE-${suffix}`;
  const documents = new DocumentsService({} as never, {} as never);
  const periods = new PayrollPeriodsService();
  const inputs = new PayrollInputsService();
  const certification = new PayrollCertificationService();
  const approval = new PayrollApprovalService();
  const finalization = new PayrollFinalizationService();
  const reviews = new PayrollCheckpointReviewService(documents);
  const voids = new PayrollVoidService(documents);
  const adjustments = new PayrollAdjustmentsService();
  const exports = new PaymentExportsService();
  const outcomes = new DisbursementOutcomesService(documents);
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
      accountingReviewer: as(3, [
        'payroll.periods.review_accounting',
        'payroll.payment_exports.generate',
      ]),
      approver: as(4, approver),
      secondApprover: as(5, approver),
      cashier: as(6, ['payroll.disbursement.update']),
      adjuster: as(7, ['payroll.inputs.adjust']),
    };
  }

  /** Fixture rows written with triggers off, standing in for what another command would write. */
  const seed = <T>(run: (transaction: Prisma.TransactionClient) => Promise<T>) =>
    admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      return run(transaction);
    });

  /** A statement as `hris_app` inside the Agency's context, as a service would run it. */
  const asApp = <T>(
    tenant: PayrollTenant,
    statement: (transaction: Prisma.TransactionClient) => Promise<T>,
  ) => withDatabaseContext(tenant.persons[0]!.scope, statement);

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
        storageKey: `void/${agency.id}/${document.id}`,
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
    return version.id;
  }

  /**
   * An Agency whose one SG-11 step-1 Employee took a day of leave without
   * pay in March 2871, posted as a Payroll Input, with a verified account.
   */
  async function agency(label: string) {
    const tenant = await createPayrollTenant(admin, suffix, `VOID-${label}`, 8);
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
        employeeNumber: `VOID-${label}-${suffix}`,
        legalName: `Void ${label}`,
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `void-${label.toLowerCase()}-${suffix}@example.test`,
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
            effectiveFrom: new Date('2871-01-01'),
            effectiveTo: null,
            status: 'ACTIVE',
            createdByMembershipId: membershipId,
          },
        }),
    );
    const accepted = await withDatabaseContext({ agencyId }, (transaction) =>
      inputs.acceptInTransaction(transaction, {
        agencyId,
        employeeId: employee.id,
        sourceModule: 'LEAVE',
        inputKind: 'LEAVE_WITHOUT_PAY',
        sourceKey: `leave-posting:${randomUUID()}:payroll`,
        sourceType: 'LeavePosting',
        sourceId: randomUUID(),
        effectiveDate: '2871-03-05',
        quantity: '1',
        payload: {
          unitCode: 'WORKING_DAY',
          workDates: [{ workDate: '2871-03-05', quantity: '1.0000' }],
        },
      }),
    );
    if (!('payrollInputId' in accepted)) throw new Error(`Payroll refused: ${accepted.reason}`);
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
    // Test fixture only: an Attendance Payroll Fact standing in for an absence.
    const factId = await seed(async (transaction) => {
      const fact = await transaction.attendancePayrollFact.create({
        data: {
          agencyId,
          attendancePayrollPublicationId: randomUUID(),
          attendanceDayId: randomUUID(),
          employeeId: employee.id,
          workDate: new Date('2871-03-06'),
          factType: 'ABSENCE',
          stableSourceKey: `${employee.id}|2871-03-06|ABSENCE|NONE`,
          correctedMinutes: 480,
        },
      });
      return fact.id;
    });
    return {
      tenant,
      people: roles(tenant),
      employeeId: employee.id,
      payrollInputId: accepted.payrollInputId,
      factId,
      evidence: await evidenceVersion(tenant),
    };
  }

  type Setup = Awaited<ReturnType<typeof agency>>;

  /**
   * Run a regular period of `month` through the whole review chain and
   * finalize it. The absence fact is put behind its deduction line first,
   * as the calculation would have, so finalization consumes it too.
   */
  async function finalizedPeriod(setup: Setup, code: string, month = '2871-03') {
    const { people, tenant } = setup;
    const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0))
      .toISOString()
      .slice(0, 10);
    const draft = await periods.create(people.preparer, {
      code,
      runType: 'REGULAR',
      periodFrom: `${month}-01`,
      periodTo: lastDay,
      cutoffAt: new Date().toISOString(),
      paymentDate: `${month}-15`,
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
    const result = await admin.payrollEmployee.findFirstOrThrow({
      where: { payrollPeriodId: draft.id, calculationVersion: approved.calculationVersion },
      include: { lines: true },
    });
    const deduction = result.lines.find((line) => line.lineType === 'DEDUCTION')!;
    const sources = await admin.payrollLineSource.findMany({
      where: { payrollLineId: deduction.id },
    });
    expect(sources.map((source) => source.payrollInputId)).toContain(setup.payrollInputId);
    await seed((transaction) =>
      transaction.payrollLineSource.create({
        data: {
          agencyId: tenant.agency.id,
          payrollLineId: deduction.id,
          attendancePayrollFactId: setup.factId,
        },
      }),
    );
    const finalized = await finalization.finalize(people.approver, draft.id, {
      rowVersion: approved.rowVersion,
    });
    return { period: finalized, resultId: result.id };
  }

  const request = (
    setup: Setup,
    periodId: string,
    rowVersion: number,
    who = setup.people.approver,
  ) =>
    voids.request(who, periodId, {
      reason: 'The whole March payroll used the wrong salary schedule.',
      documentVersionId: setup.evidence,
      rowVersion,
    });

  const stateOf = async (setup: Setup, periodId: string) => ({
    period: await admin.payrollPeriod.findUniqueOrThrow({
      where: { id: periodId },
      select: {
        status: true,
        rowVersion: true,
        voidRequestedByMembershipId: true,
        voidedByMembershipId: true,
      },
    }),
    results: (
      await admin.payrollEmployee.findMany({
        where: { payrollPeriodId: periodId, status: { in: ['FINALIZED', 'VOIDED'] } },
        select: { status: true },
      })
    ).map((row) => row.status),
    input: await admin.payrollInput.findUniqueOrThrow({
      where: { id: setup.payrollInputId },
      select: { status: true, consumedByPayrollPeriodId: true, sourceCorrectionKey: true },
    }),
    consumptions: await admin.payrollConsumedAttendanceFact.findMany({
      where: { attendancePayrollFactId: setup.factId },
      orderBy: { consumedAt: 'asc' },
      select: { payrollPeriodId: true, releasedAt: true },
    }),
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
          verifiedOn: new Date('2026-11-22'),
          verifiedBy: 'LingkodHR test fixture',
          effectiveFrom: new Date('2871-01-01'),
          effectiveTo: new Date('2871-12-31'),
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
      await transaction.attendancePayrollFact.deleteMany({ where });
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

  it('voids in two steps by two people, and a replacement for the same month consumes its sources', async () => {
    const setup = await agency('REPLACE');
    const { people, tenant } = setup;
    const { period: march, resultId } = await finalizedPeriod(setup, 'VOID-2871-03-A');
    await asApp(tenant, (transaction) =>
      transaction.payslip.create({
        data: { agencyId: tenant.agency.id, payrollEmployeeId: resultId, status: 'GENERATING' },
      }),
    );
    const recalculation = await adjustments.openRecalculation(people.adjuster, march.id, {
      reason: 'A step increment was recorded late.',
    });
    expect((await stateOf(setup, march.id)).input).toMatchObject({
      status: 'CONSUMED',
      consumedByPayrollPeriodId: march.id,
    });

    // The request needs payroll.periods.void, and claims no payroll function.
    await expect(request(setup, march.id, march.rowVersion, people.cashier)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      voids.request(people.approver, march.id, {
        reason: 'Wrong schedule.',
        documentVersionId: randomUUID(),
        rowVersion: march.rowVersion,
      }),
    ).rejects.toMatchObject({ code: 'PAYROLL_VOID_DOCUMENT_INVALID' });
    const requested = await request(setup, march.id, march.rowVersion, people.secondApprover);
    expect(requested).toMatchObject({
      status: 'FINALIZED',
      voidRequestedByMembershipId: people.secondApprover.membershipId,
      voidDocumentVersionId: setup.evidence,
      voidReason: 'The whole March payroll used the wrong salary schedule.',
      voidedAt: null,
    });
    await expect(
      admin.payrollPeriodActor.count({
        where: { payrollPeriodId: march.id, membershipId: people.secondApprover.membershipId },
      }),
    ).resolves.toBe(0);
    await expect(
      request(setup, march.id, requested.rowVersion, people.approver),
    ).rejects.toMatchObject({ code: 'PAYROLL_VOID_ALREADY_REQUESTED' });

    // The requester can neither approve nor decline their own request.
    await expect(
      voids.approve(people.secondApprover, march.id, { rowVersion: requested.rowVersion }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_VOID_REQUESTER_DECIDES' });
    await expect(
      voids.decline(people.secondApprover, march.id, {
        reason: 'Never mind.',
        rowVersion: requested.rowVersion,
      }),
    ).rejects.toMatchObject({ code: 'PAYROLL_VOID_REQUESTER_DECIDES' });
    // The database holds the same rule.
    await expect(
      asApp(tenant, (transaction) =>
        transaction.payrollPeriod.update({
          where: { agencyId_id: { agencyId: tenant.agency.id, id: march.id } },
          data: {
            status: 'VOIDED',
            voidedByMembershipId: people.secondApprover.membershipId,
            voidedAt: new Date(),
          },
        }),
      ),
    ).rejects.toThrow(/void_separation_check/);
    // Approving needs payroll.periods.approve_void, and another function refuses.
    await expect(
      voids.approve(people.cashier, march.id, { rowVersion: requested.rowVersion }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      voids.approve(
        {
          ...people.certifier,
          permissions: [{ code: 'payroll.periods.approve_void', scopePolicy: 'AGENCY' }],
        },
        march.id,
        { rowVersion: requested.rowVersion },
      ),
    ).rejects.toMatchObject({ code: 'PAYROLL_FUNCTION_CONFLICT' });
    await expect(
      voids.approve(people.approver, march.id, { rowVersion: march.rowVersion }),
    ).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_STALE' });
    expect((await stateOf(setup, march.id)).period.status).toBe('FINALIZED');

    const voided = await voids.approve(people.approver, march.id, {
      rowVersion: requested.rowVersion,
    });
    expect(voided).toMatchObject({
      status: 'VOIDED',
      finalizedAt: march.finalizedAt,
      voidRequestedByMembershipId: people.secondApprover.membershipId,
      voidedByMembershipId: people.approver.membershipId,
    });
    const after = await stateOf(setup, march.id);
    expect(after.results).toEqual(['VOIDED']);
    expect(after.input).toEqual({
      status: 'PENDING',
      consumedByPayrollPeriodId: null,
      sourceCorrectionKey: null,
    });
    expect(after.consumptions).toEqual([
      { payrollPeriodId: march.id, releasedAt: expect.any(Date) },
    ]);
    await expect(
      admin.payslip.findUniqueOrThrow({ where: { payrollEmployeeId: resultId } }),
    ).resolves.toMatchObject({ status: 'SUPERSEDED' });
    const adjustmentId = recalculation.adjustments[0]!.payrollAdjustmentId;
    await expect(
      admin.payrollAdjustment.findUniqueOrThrow({ where: { id: adjustmentId } }),
    ).resolves.toMatchObject({ status: 'CANCELLED', cancelledAt: expect.any(Date) });
    const [event] = await admin.auditEvent.findMany({
      where: { entityId: march.id, action: PAYROLL_PERIOD_VOIDED },
    });
    expect(event).toMatchObject({
      actorMembershipId: people.approver.membershipId,
      previousStatus: 'FINALIZED',
      newStatus: 'VOIDED',
      metadata: expect.objectContaining({
        voidedResultCount: 1,
        returnedPayrollInputIds: [setup.payrollInputId],
        releasedAttendancePayrollFactIds: [setup.factId],
        cancelledPayrollAdjustmentIds: [adjustmentId],
      }),
    });

    // A retry by the approver changes nothing; a second void is refused.
    await expect(
      voids.approve(people.approver, march.id, { rowVersion: requested.rowVersion }),
    ).resolves.toEqual(voided);
    await expect(
      request(setup, march.id, voided.rowVersion, people.secondApprover),
    ).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_FINALIZED' });
    await expect(
      voids.approve(people.secondApprover, march.id, { rowVersion: voided.rowVersion }),
    ).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_FINALIZED' });
    expect(
      await admin.auditEvent.count({
        where: { entityId: march.id, action: PAYROLL_PERIOD_VOIDED },
      }),
    ).toBe(1);
    // A voided payroll produces no Payment Export, and stays readable.
    await expect(exports.generate(people.accountingReviewer, march.id)).rejects.toMatchObject({
      code: 'PAYMENT_EXPORT_PAYROLL_NOT_FINALIZED',
    });

    // The replacement is a new regular period for the same month.
    const { period: replacement } = await finalizedPeriod(setup, 'VOID-2871-03-B');
    const replaced = await stateOf(setup, march.id);
    expect(replaced.input).toMatchObject({
      status: 'CONSUMED',
      consumedByPayrollPeriodId: replacement.id,
    });
    expect(replaced.consumptions).toEqual([
      { payrollPeriodId: march.id, releasedAt: expect.any(Date) },
      { payrollPeriodId: replacement.id, releasedAt: null },
    ]);
    await expect(periods.read(people.certifier, march.id)).resolves.toMatchObject({
      status: 'VOIDED',
      replacedByPeriodId: replacement.id,
      replacesPeriodIds: [],
    });
    await expect(periods.read(people.certifier, replacement.id)).resolves.toMatchObject({
      status: 'FINALIZED',
      replacedByPeriodId: null,
      replacesPeriodIds: [march.id],
    });

    // The replacement is voided in its turn, releasing the same sources again.
    const second = await request(setup, replacement.id, replacement.rowVersion);
    await voids.approve(people.secondApprover, replacement.id, { rowVersion: second.rowVersion });
    const twice = await stateOf(setup, replacement.id);
    expect(twice.input).toMatchObject({ status: 'PENDING', consumedByPayrollPeriodId: null });
    expect(twice.consumptions.map((row) => row.releasedAt)).toEqual([
      expect.any(Date),
      expect.any(Date),
    ]);
  });

  it('refuses a void after a SUBMITTED instruction, at request and again at approval', async () => {
    const setup = await agency('SUBMITTED');
    const { people } = setup;
    const { period } = await finalizedPeriod(setup, 'VOID-2871-03-S');
    const generated = await exports.generate(people.accountingReviewer, period.id);
    const requested = await request(setup, period.id, period.rowVersion);

    await outcomes.record(
      people.cashier,
      {
        periodId: period.id,
        exportId: generated.id,
        instructionId: generated.instructions[0]!.id,
      },
      { outcome: 'SUBMITTED', sequence: 1, externalReference: 'LBP-BATCH-2871-03' },
    );
    await expect(
      voids.approve(people.secondApprover, period.id, { rowVersion: requested.rowVersion }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_VOID_PAYMENT_HANDED_OFF' });
    const refused = await stateOf(setup, period.id);
    expect(refused.period).toMatchObject({
      status: 'FINALIZED',
      rowVersion: requested.rowVersion,
      voidRequestedByMembershipId: people.approver.membershipId,
    });
    expect(refused.input.status).toBe('CONSUMED');

    // A declined request clears the request and stays in its Audit Events.
    const declined = await voids.decline(people.secondApprover, period.id, {
      reason: 'Payment was already submitted to the bank.',
      rowVersion: requested.rowVersion,
    });
    expect(declined).toMatchObject({
      status: 'FINALIZED',
      voidRequestedByMembershipId: null,
      voidRequestedAt: null,
      voidReason: null,
      voidDocumentVersionId: null,
    });
    await expect(
      admin.auditEvent.findMany({
        where: { entityId: period.id, action: { startsWith: 'PAYROLL_PERIOD_VOID' } },
        orderBy: { occurredAt: 'asc' },
        select: { action: true, reason: true },
      }),
    ).resolves.toEqual([
      {
        action: 'PAYROLL_PERIOD_VOID_REQUESTED',
        reason: 'The whole March payroll used the wrong salary schedule.',
      },
      {
        action: 'PAYROLL_PERIOD_VOID_DECLINED',
        reason: 'Payment was already submitted to the bank.',
      },
    ]);
    await expect(request(setup, period.id, declined.rowVersion)).rejects.toMatchObject({
      code: 'PAYROLL_VOID_PAYMENT_HANDED_OFF',
    });
  });

  it('refuses a void while a later regular period is not VOIDED, at request and at approval', async () => {
    const setup = await agency('LATER');
    const { people } = setup;
    const { period: march } = await finalizedPeriod(setup, 'VOID-2871-03-L');
    const april = {
      runType: 'REGULAR',
      periodFrom: '2871-04-01',
      periodTo: '2871-04-30',
      cutoffAt: new Date().toISOString(),
      paymentDate: '2871-04-15',
    };
    const draft = await periods.create(people.preparer, { ...april, code: 'VOID-2871-04-A' });
    await expect(request(setup, march.id, march.rowVersion)).rejects.toMatchObject({
      code: 'PAYROLL_VOID_LATER_PERIOD',
      message: expect.stringMatching(/cancel that draft first/),
    });
    await periods.cancelDraft(people.preparer, draft.id, {
      reason: 'Opened too early.',
      rowVersion: draft.rowVersion,
    });
    const requested = await request(setup, march.id, march.rowVersion);
    await periods.create(people.preparer, { ...april, code: 'VOID-2871-04-B' });
    await expect(
      voids.approve(people.secondApprover, march.id, { rowVersion: requested.rowVersion }),
    ).rejects.toMatchObject({ code: 'PAYROLL_VOID_LATER_PERIOD' });
    expect((await stateOf(setup, march.id)).period.status).toBe('FINALIZED');
  });

  /**
   * Hold the Agency's regular period sequence lock in a transaction of its
   * own, as the migration owner in the Agency's context, after running
   * `work` under it, until `release` is called.
   */
  async function holdSequenceLock(
    agencyId: string,
    work: (transaction: Prisma.TransactionClient) => Promise<unknown> = async () => undefined,
  ) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held!: (pid: number) => void;
    const pid = new Promise<number>((resolve) => (held = resolve));
    const done = admin.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SELECT set_config('app.agency_id', ${agencyId}, true)`;
        await lockRegularPeriodSequence(transaction, agencyId);
        await work(transaction);
        const [row] = await transaction.$queryRaw<[{ pid: number }]>`
          SELECT pg_backend_pid() AS "pid"
        `;
        held(row.pid);
        await gate;
      },
      { timeout: 20_000 },
    );
    const holder = await pid;
    return {
      /** Resolves once another session waits on the holder's lock. */
      waitedOn: async () => {
        for (let attempt = 0; attempt < 200; attempt += 1) {
          const [row] = await admin.$queryRaw<[{ waiting: number }]>`
            SELECT count(*)::int AS "waiting" FROM pg_stat_activity
            WHERE ${holder}::int = ANY(pg_blocking_pids(pid))
          `;
          if (row.waiting > 0) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error('Nothing waited on the regular period sequence lock.');
      },
      release: async () => {
        release();
        await done;
      },
    };
  }

  it('serializes a void with a regular period created at the same time, through the Agency lock', async () => {
    const setup = await agency('RACE');
    const { people, tenant } = setup;
    const agencyId = tenant.agency.id;
    const { period: march } = await finalizedPeriod(setup, 'VOID-2871-03-R');
    const requested = await request(setup, march.id, march.rowVersion);

    // An April period being created, under the lock, and not yet committed:
    // the approval waits for it, then finds it and is refused.
    const creating = await holdSequenceLock(agencyId, (transaction) =>
      transaction.payrollPeriod.create({
        data: {
          agencyId,
          code: 'VOID-2871-04-R',
          runType: 'REGULAR',
          periodFrom: new Date('2871-04-01'),
          periodTo: new Date('2871-04-30'),
          cutoffAt: new Date(),
          paymentDate: new Date('2871-04-15'),
          status: 'DRAFT',
        },
      }),
    );
    const approving = voids
      .approve(people.secondApprover, march.id, { rowVersion: requested.rowVersion })
      .then(
        () => null,
        (error: unknown) => error,
      );
    await creating.waitedOn();
    await creating.release();
    await expect(approving).resolves.toMatchObject({ code: 'PAYROLL_VOID_LATER_PERIOD' });
    expect((await stateOf(setup, march.id)).period.status).toBe('FINALIZED');

    // A regular period's creation and a void request wait on a void in progress the same way.
    const april = await admin.payrollPeriod.findFirstOrThrow({
      where: { agencyId, code: 'VOID-2871-04-R' },
    });
    await periods.cancelDraft(people.preparer, april.id, {
      reason: 'Opened while March was being voided.',
      rowVersion: april.rowVersion,
    });
    const voiding = await holdSequenceLock(agencyId);
    const created = periods.create(people.preparer, {
      code: 'VOID-2871-04-S',
      runType: 'REGULAR',
      periodFrom: '2871-04-01',
      periodTo: '2871-04-30',
      cutoffAt: new Date().toISOString(),
      paymentDate: '2871-04-15',
    });
    await voiding.waitedOn();
    await voiding.release();
    await expect(created).resolves.toMatchObject({ code: 'VOID-2871-04-S', status: 'DRAFT' });
  });

  it('reopens an adjustment it carried, cancels a waiting source correction’s input, and lets only the void write them', async () => {
    const setup = await agency('ADJUST');
    const { people, tenant, employeeId } = setup;
    const agencyId = tenant.agency.id;
    const { period: march, resultId } = await finalizedPeriod(setup, 'VOID-2871-03-J');

    // Only the void changes what it changes.
    const refusals: [RegExp, (transaction: Prisma.TransactionClient) => Promise<unknown>][] = [
      [
        /only by approving its open void request/,
        (transaction) =>
          transaction.payrollPeriod.update({
            where: { agencyId_id: { agencyId, id: march.id } },
            data: {
              status: 'VOIDED',
              voidReason: 'x',
              voidedByMembershipId: people.approver.membershipId,
              voidedAt: new Date(),
            },
          }),
      ],
      [
        /with a reason and a Document Version/,
        (transaction) =>
          transaction.payrollPeriod.update({
            where: { agencyId_id: { agencyId, id: march.id } },
            data: {
              voidReason: 'x',
              voidRequestedByMembershipId: people.approver.membershipId,
              voidRequestedAt: new Date(),
            },
          }),
      ],
      [
        /voided only with its period/,
        (transaction) =>
          transaction.payrollEmployee.update({
            where: { id: resultId },
            data: { status: 'VOIDED' },
          }),
      ],
      [
        /released only by the void of the payroll that consumed it/,
        (transaction) =>
          transaction.payrollInput.update({
            where: { agencyId_id: { agencyId, id: setup.payrollInputId } },
            data: { status: 'PENDING', consumedByPayrollPeriodId: null },
          }),
      ],
      [
        /released once, only by the void of its payroll/,
        (transaction) =>
          transaction.payrollConsumedAttendanceFact.updateMany({
            where: { agencyId, payrollPeriodId: march.id },
            data: { releasedAt: new Date() },
          }),
      ],
      [
        /permission denied/,
        (transaction) =>
          transaction.$executeRaw`DELETE FROM payroll_consumed_attendance_facts WHERE payroll_period_id = CAST(${march.id} AS uuid)`,
      ],
    ];
    for (const [message, statement] of refusals) {
      await expect(asApp(tenant, statement)).rejects.toThrow(message);
    }

    // Test fixtures: February was finalized, and March carried and posted
    // the Employee's adjustment against it; another of February's Employees'
    // adjustments is now OPEN again beside a posted one. A source correction
    // then joined an adjustment against March, naming its consumed input.
    const february = await seed(async (transaction) => {
      const row = await transaction.payrollPeriod.create({
        data: {
          agencyId,
          code: 'VOID-2871-02',
          runType: 'REGULAR',
          periodFrom: new Date('2871-02-01'),
          periodTo: new Date('2871-02-28'),
          cutoffAt: new Date('2871-02-20T00:00:00Z'),
          paymentDate: new Date('2871-02-15'),
          status: 'FINALIZED',
          calculationVersion: 1,
          finalizedAt: new Date(),
        },
      });
      return row.id;
    });
    const other = await admin.employee.create({
      data: {
        agencyId,
        employeeNumber: `VOID-ADJUST-OTHER-${suffix}`,
        legalName: 'Void Adjust Other',
        birthDate: new Date('1990-01-01'),
        sex: 'MALE',
        civilStatus: 'SINGLE',
        contactEmail: `void-adjust-other-${suffix}@example.test`,
        serviceStatus: 'ACTIVE',
        createdByMembershipId: people.preparer.membershipId,
        updatedByMembershipId: people.preparer.membershipId,
      },
    });
    const posted = (forEmployee: string) =>
      seed((transaction) =>
        transaction.payrollAdjustment.create({
          data: {
            agencyId,
            originalPayrollPeriodId: february,
            employeeId: forEmployee,
            status: 'POSTED',
            postedByPayrollPeriodId: march.id,
            postedAt: new Date(),
          },
        }),
      );
    const carried = await posted(employeeId);
    const coveredOne = await posted(other.id);
    const stillOpen = await adjustments.openRecalculation(people.adjuster, february, {
      employeeId: other.id,
      reason: 'A step increment was recorded late.',
    });
    const [againstMarch] = (
      await adjustments.openRecalculation(people.adjuster, march.id, {
        employeeId,
        reason: 'The leave was cancelled after payroll.',
      })
    ).adjustments;
    await expect(
      withDatabaseContext({ agencyId }, (transaction) =>
        inputs.withdrawInTransaction(transaction, {
          agencyId,
          sourceModule: 'LEAVE',
          payrollInputId: setup.payrollInputId,
          correctionKey: `leave-cancellation:${suffix}`,
        }),
      ),
    ).resolves.toMatchObject({
      outcome: 'DEFERRED',
      payrollAdjustmentId: againstMarch!.payrollAdjustmentId,
    });
    await expect(
      asApp(tenant, (transaction) =>
        transaction.payrollAdjustment.update({
          where: { id: carried.id },
          data: { status: 'OPEN', postedByPayrollPeriodId: null, postedAt: null },
        }),
      ),
    ).rejects.toThrow(/void of the period that posted it/);

    const requested = await request(setup, march.id, march.rowVersion);
    await voids.approve(people.secondApprover, march.id, { rowVersion: requested.rowVersion });

    const statusOf = (id: string) =>
      admin.payrollAdjustment.findUniqueOrThrow({
        where: { id },
        select: { status: true, postedByPayrollPeriodId: true, postedAt: true },
      });
    await expect(statusOf(carried.id)).resolves.toEqual({
      status: 'OPEN',
      postedByPayrollPeriodId: null,
      postedAt: null,
    });
    await expect(statusOf(coveredOne.id)).resolves.toMatchObject({ status: 'CANCELLED' });
    await expect(statusOf(stillOpen.adjustments[0]!.payrollAdjustmentId)).resolves.toMatchObject({
      status: 'OPEN',
    });
    await expect(statusOf(againstMarch!.payrollAdjustmentId)).resolves.toMatchObject({
      status: 'CANCELLED',
    });
    expect((await stateOf(setup, march.id)).input).toEqual({
      status: 'CANCELLED',
      consumedByPayrollPeriodId: null,
      sourceCorrectionKey: `leave-cancellation:${suffix}`,
    });
    // The source's retry of its withdrawal finds it withdrawn.
    await expect(
      withDatabaseContext({ agencyId }, (transaction) =>
        inputs.withdrawInTransaction(transaction, {
          agencyId,
          sourceModule: 'LEAVE',
          payrollInputId: setup.payrollInputId,
          correctionKey: `leave-cancellation:${suffix}`,
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'ALREADY_WITHDRAWN' });
  });

  it('seeds both void permissions to the Payroll Approver alone', async () => {
    const holders = await admin.$queryRaw<{ code: string; role: string; scope_policy: string }[]>`
      SELECT p.code, r.code AS role, rp.scope_policy
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id AND r.agency_id IS NULL
      JOIN permissions p ON p.id = rp.permission_id
      WHERE p.code IN ('payroll.periods.void', 'payroll.periods.approve_void')
      ORDER BY p.code
    `;
    expect(holders).toEqual([
      { code: 'payroll.periods.approve_void', role: 'payroll_approver', scope_policy: 'AGENCY' },
      { code: 'payroll.periods.void', role: 'payroll_approver', scope_policy: 'AGENCY' },
    ]);
  });
});
