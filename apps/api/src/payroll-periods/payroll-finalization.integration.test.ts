import { randomUUID } from 'node:crypto';
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
import { PayrollInputsService } from '../payroll-inputs/payroll-inputs.service';
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

describe.skipIf(!enabled)('Payroll finalization in PostgreSQL', () => {
  // Test fixtures only: the rate is not from any issuance. 44,000 divides by
  // 22 into whole pesos, and 2874 sits clear of every other test's rule versions.
  const suffix = `${Date.now()}-finalization`;
  const scheduleCode = `${FIXTURE_PREFIX}FINALIZATION-SCHEDULE-${suffix}`;
  const periods = new PayrollPeriodsService();
  const inputs = new PayrollInputsService();
  const certification = new PayrollCertificationService();
  const approval = new PayrollApprovalService();
  const finalization = new PayrollFinalizationService();
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
    const approver = [
      'payroll.periods.read',
      'payroll.periods.approve',
      'payroll.periods.return_approved',
      'payroll.periods.finalize',
    ];
    return {
      preparer: as(0, [
        'payroll.periods.create',
        'payroll.periods.calculate',
        'payroll.periods.read',
        // Held only to show that holding it does not let the preparer act in APPROVAL.
        'payroll.periods.finalize',
      ]),
      certifier: as(1, ['payroll.periods.read', 'payroll.periods.certify']),
      budgetOfficer: as(2, ['payroll.periods.read', 'payroll.periods.review_funding']),
      accountingReviewer: as(3, ['payroll.periods.read', 'payroll.periods.review_accounting']),
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

  /**
   * An Agency whose one SG-11 step-1 Employee took a day of leave without pay
   * in March 2874, and a March 2874 regular period calculated, certified,
   * reviewed, and approved. The day without pay rests on the Payroll Input.
   */
  async function approvedPeriod(label: string) {
    const payrollTenant = await createPayrollTenant(admin, suffix, label, 6);
    tenants.push(payrollTenant);
    const { agency, persons } = payrollTenant;
    const people = roles(payrollTenant);
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
        employeeNumber: `FINALIZATION-${label}-${suffix}`,
        legalName: `Finalization ${label}`,
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `finalization-${label.toLowerCase()}-${suffix}@example.test`,
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
            effectiveFrom: new Date('2874-01-01'),
            effectiveTo: null,
            status: 'ACTIVE',
            createdByMembershipId: membershipId,
          },
        }),
    );
    const accepted = await withDatabaseContext({ agencyId: agency.id }, (transaction) =>
      inputs.acceptInTransaction(transaction, {
        agencyId: agency.id,
        employeeId: employee.id,
        sourceModule: 'LEAVE',
        inputKind: 'LEAVE_WITHOUT_PAY',
        sourceKey: `leave-posting:${randomUUID()}:payroll`,
        sourceType: 'LeavePosting',
        sourceId: randomUUID(),
        effectiveDate: '2874-03-05',
        quantity: '1',
        payload: {
          unitCode: 'WORKING_DAY',
          workDates: [{ workDate: '2874-03-05', quantity: '1.0000' }],
        },
      }),
    );
    if (!('payrollInputId' in accepted)) throw new Error(`Payroll refused: ${accepted.reason}`);

    // The cutoff follows the acceptance, so the calculation takes the input.
    const draft = await periods.create(people.preparer, {
      code: `FIN-2874-03-${label}`,
      runType: 'REGULAR',
      periodFrom: '2874-03-01',
      periodTo: '2874-03-31',
      cutoffAt: new Date().toISOString(),
      paymentDate: '2874-03-15',
    });
    const started = await periods.startCalculation(people.preparer, draft.id, {
      rowVersion: draft.rowVersion,
    });
    await expect(
      calculation.run({
        agencyId: agency.id,
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
    const evidence = await evidenceVersion(payrollTenant);
    await reviews.record(people.budgetOfficer, 'BUDGET', draft.id, exportId, {
      outcome: 'CONFIRMED',
      externalReference: 'ORS-2874-03-0001',
      evidenceDocumentVersionId: evidence,
    });
    await reviews.record(people.accountingReviewer, 'ACCOUNTING', draft.id, exportId, {
      outcome: 'CONFIRMED',
      externalReference: 'JEV-2874-03-0001',
      evidenceDocumentVersionId: evidence,
    });
    const approved = await approval.approve(people.approver, draft.id, {
      rowVersion: certified.rowVersion,
    });
    const result = await admin.payrollEmployee.findFirstOrThrow({
      where: { payrollPeriodId: draft.id, calculationVersion: approved.calculationVersion },
      include: { lines: true },
    });
    return {
      payrollTenant,
      people,
      period: approved,
      certificationId: certified.certification!.id,
      calculationHash: certified.calculationHash!,
      payrollInputId: accepted.payrollInputId,
      result,
    };
  }

  async function evidenceVersion(payrollTenant: PayrollTenant) {
    const { agency, persons } = payrollTenant;
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
        storageKey: `finalization/${agency.id}/evidence`,
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

  /**
   * Test fixture only: an Attendance Payroll Fact behind the day-without-pay
   * line, standing in for an absence the calculation deducted on it.
   */
  async function absenceBehind(setup: Awaited<ReturnType<typeof approvedPeriod>>) {
    const line = setup.result.lines.find((each) => each.lineType === 'DEDUCTION')!;
    return seed(async (transaction) => {
      const fact = await transaction.attendancePayrollFact.create({
        data: {
          agencyId: setup.payrollTenant.agency.id,
          attendancePayrollPublicationId: randomUUID(),
          attendanceDayId: randomUUID(),
          employeeId: setup.result.employeeId,
          workDate: new Date('2874-03-06'),
          factType: 'ABSENCE',
          stableSourceKey: `${setup.result.employeeId}|2874-03-06|ABSENCE|NONE`,
          correctedMinutes: 480,
        },
      });
      await transaction.payrollLineSource.create({
        data: {
          agencyId: setup.payrollTenant.agency.id,
          payrollLineId: line.id,
          attendancePayrollFactId: fact.id,
        },
      });
      return fact.id;
    });
  }

  const eventsOf = (entityId: string) =>
    admin.auditEvent.findMany({ where: { entityId, action: 'PAYROLL_PERIOD_FINALIZED' } });
  const outboxOf = (aggregateId: string) => admin.outboxEvent.findMany({ where: { aggregateId } });

  /** What finalization writes; a refused one leaves all of it as it was. */
  async function finalizedState(setup: Awaited<ReturnType<typeof approvedPeriod>>) {
    const periodId = setup.period.id;
    return {
      period: await admin.payrollPeriod.findUniqueOrThrow({
        where: { id: periodId },
        select: { status: true, rowVersion: true, finalizedAt: true },
      }),
      results: (
        await admin.payrollEmployee.findMany({
          where: { payrollPeriodId: periodId },
          select: { status: true },
        })
      ).map((result) => result.status),
      input: await admin.payrollInput.findUniqueOrThrow({
        where: { id: setup.payrollInputId },
        select: { status: true, consumedByPayrollPeriodId: true },
      }),
      consumedFacts: await admin.payrollConsumedAttendanceFact.count({
        where: { payrollPeriodId: periodId },
      }),
      audit: (await eventsOf(periodId)).length,
      outbox: (await outboxOf(periodId)).length,
      approvers: await admin.payrollPeriodActor.count({
        where: { payrollPeriodId: periodId, payrollFunction: 'APPROVAL' },
      }),
    };
  }

  /** A statement as the migration owner, inside the Agency's context, so RLS admits the row. */
  const asOwner = (
    agencyId: string,
    statement: (transaction: Prisma.TransactionClient) => unknown,
  ) =>
    admin.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT set_config('app.agency_id', ${agencyId}, true)`;
      await statement(transaction);
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
          effectiveFrom: new Date('2874-01-01'),
          effectiveTo: new Date('2874-12-31'),
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
      await transaction.outboxEvent.deleteMany({ where });
      await transaction.payrollConsumedAttendanceFact.deleteMany({ where });
      await transaction.payrollLineSource.deleteMany({ where });
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

  it('finalizes the approved version in one transaction, and a retry changes nothing', async () => {
    const setup = await approvedPeriod('FINALIZE');
    const { people, period, payrollTenant } = setup;
    const factId = await absenceBehind(setup);
    expect(
      setup.result.lines.map((line) => `${line.lineType} ${line.amount.toFixed(2)}`).sort(),
    ).toEqual(['DEDUCTION 2000.00', 'EARNING 44000.00']);

    const finalized = await finalization.finalize(people.approver, period.id, {
      rowVersion: period.rowVersion,
    });
    expect(finalized).toMatchObject({
      status: 'FINALIZED',
      calculationVersion: period.calculationVersion,
      rowVersion: period.rowVersion + 1,
      finalizedAt: expect.any(String),
    });
    await expect(finalizedState(setup)).resolves.toEqual({
      period: {
        status: 'FINALIZED',
        rowVersion: period.rowVersion + 1,
        finalizedAt: expect.any(Date),
      },
      results: ['FINALIZED'],
      input: { status: 'CONSUMED', consumedByPayrollPeriodId: period.id },
      consumedFacts: 1,
      audit: 1,
      outbox: 1,
      approvers: 1,
    });
    await expect(
      admin.payrollConsumedAttendanceFact.findFirstOrThrow({
        where: { payrollPeriodId: period.id },
      }),
    ).resolves.toMatchObject({ attendancePayrollFactId: factId, releasedAt: null });
    const [audit] = await eventsOf(period.id);
    expect(audit).toMatchObject({
      actorMembershipId: people.approver.membershipId,
      previousStatus: 'APPROVED',
      newStatus: 'FINALIZED',
      metadata: {
        payrollCertificationId: setup.certificationId,
        calculationVersion: period.calculationVersion,
        calculationHash: setup.calculationHash,
        finalizedResultCount: 1,
        consumedPayrollInputIds: [setup.payrollInputId],
        consumedAttendancePayrollFactIds: [factId],
      },
    });
    await expect(outboxOf(period.id)).resolves.toEqual([
      expect.objectContaining({
        agencyId: payrollTenant.agency.id,
        eventType: 'PAYROLL_PERIOD_FINALIZED',
        aggregateType: 'PayrollPeriod',
        idempotencyKey: `payroll-period-finalized:${period.id}`,
        status: 'PENDING',
        payload: {
          payrollPeriodId: period.id,
          calculationVersion: period.calculationVersion,
          calculationHash: setup.calculationHash,
          payrollCertificationId: setup.certificationId,
          finalizedAt: finalized.finalizedAt,
        },
      }),
    ]);

    // The finalizer's retry at the same row version returns the same period
    // and writes nothing; anyone else is refused.
    await expect(
      finalization.finalize(people.approver, period.id, { rowVersion: period.rowVersion }),
    ).resolves.toEqual(finalized);
    await expect(
      finalization.finalize(people.secondApprover, period.id, { rowVersion: period.rowVersion }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_PERIOD_NOT_APPROVED' });
    await expect(
      finalization.finalize(people.approver, period.id, { rowVersion: finalized.rowVersion }),
    ).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_APPROVED' });
    await expect(finalizedState(setup)).resolves.toMatchObject({ audit: 1, outbox: 1 });

    // A finalized payroll is never calculated or returned again.
    await expect(
      periods.startCalculation(people.preparer, period.id, { rowVersion: finalized.rowVersion }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/Payroll Adjustment corrects it/) });
    await expect(
      approval.returnBeforeFinalization(people.approver, period.id, {
        reason: 'Too late.',
        rowVersion: finalized.rowVersion,
      }),
    ).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_APPROVED' });
  });

  it('rejects a direct SQL edit or delete of a finalized result, line, or snapshot', async () => {
    const setup = await approvedPeriod('IMMUTABLE');
    const { people, period, payrollTenant, result } = setup;
    await absenceBehind(setup);
    await finalization.finalize(people.approver, period.id, { rowVersion: period.rowVersion });
    const agencyId = payrollTenant.agency.id;
    const lineId = result.lines[0]!.id;
    const snapshot = await admin.payrollRuleSnapshot.findFirstOrThrow({
      where: { payrollPeriodId: period.id, calculationVersion: period.calculationVersion },
    });

    // Even the migration owner, which holds every privilege, is refused by the triggers.
    const refusals: [string, (transaction: Prisma.TransactionClient) => unknown, RegExp][] = [
      [
        'line amount',
        (transaction) =>
          transaction.$executeRaw`UPDATE payroll_lines SET amount = amount + 1 WHERE id = CAST(${lineId} AS uuid)`,
        /payroll_lines rows are immutable/,
      ],
      [
        'line delete',
        (transaction) =>
          transaction.$executeRaw`DELETE FROM payroll_lines WHERE id = CAST(${lineId} AS uuid)`,
        /payroll_lines rows are immutable/,
      ],
      [
        'result status',
        (transaction) =>
          transaction.$executeRaw`UPDATE payroll_employees SET status = 'CALCULATED' WHERE id = CAST(${result.id} AS uuid)`,
        /A FINALIZED Payroll Employee Result is immutable/,
      ],
      [
        'result total',
        (transaction) =>
          transaction.$executeRaw`UPDATE payroll_employees SET net_amount = 0 WHERE id = CAST(${result.id} AS uuid)`,
        /Only the status of a Payroll Employee Result changes/,
      ],
      [
        'result delete',
        (transaction) =>
          transaction.$executeRaw`DELETE FROM payroll_employees WHERE id = CAST(${result.id} AS uuid)`,
        /cannot be deleted/,
      ],
      [
        'snapshot',
        (transaction) =>
          transaction.$executeRaw`UPDATE payroll_rule_snapshots SET cutoff_at = now() WHERE id = CAST(${snapshot.id} AS uuid)`,
        /payroll_rule_snapshots rows are immutable/,
      ],
      [
        'finalization time',
        (transaction) =>
          transaction.$executeRaw`UPDATE payroll_periods SET finalized_at = now() WHERE id = CAST(${period.id} AS uuid)`,
        /finalization time only as it is finalized/,
      ],
      [
        'period status',
        (transaction) =>
          transaction.$executeRaw`UPDATE payroll_periods SET status = 'APPROVED' WHERE id = CAST(${period.id} AS uuid)`,
        /cannot move from FINALIZED to APPROVED/,
      ],
      [
        'consumed fact delete',
        (transaction) =>
          transaction.$executeRaw`DELETE FROM payroll_consumed_attendance_facts WHERE payroll_period_id = CAST(${period.id} AS uuid)`,
        /payroll_consumed_attendance_facts rows are immutable/,
      ],
    ];
    for (const [label, statement, message] of refusals) {
      await expect(asOwner(agencyId, statement), label).rejects.toThrow(message);
    }
    // The application role is refused the same way.
    await expect(
      withDatabaseContext({ agencyId }, (transaction) =>
        transaction.payrollEmployee.updateMany({
          where: { id: result.id },
          data: { status: 'CALCULATED' },
        }),
      ),
    ).rejects.toThrow(/A FINALIZED Payroll Employee Result is immutable/);
    await expect(
      withDatabaseContext(
        { agencyId },
        (transaction) =>
          transaction.$executeRaw`UPDATE payroll_lines SET amount = 0 WHERE id = CAST(${lineId} AS uuid)`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      admin.payrollLine.findUniqueOrThrow({ where: { id: lineId } }),
    ).resolves.toMatchObject({ amount: result.lines[0]!.amount });
  });

  it('marks results FINALIZED and consumes inputs only through finalization', async () => {
    const setup = await approvedPeriod('DIRECT');
    const agencyId = setup.payrollTenant.agency.id;
    await expect(
      withDatabaseContext({ agencyId }, (transaction) =>
        transaction.payrollEmployee.updateMany({
          where: { id: setup.result.id },
          data: { status: 'FINALIZED' },
        }),
      ),
    ).rejects.toThrow(/changes status only as it is finalized with its period/);
    await expect(
      withDatabaseContext({ agencyId }, (transaction) =>
        transaction.payrollInput.updateMany({
          where: { id: setup.payrollInputId },
          data: { status: 'CONSUMED', consumedByPayrollPeriodId: setup.period.id },
        }),
      ),
    ).rejects.toThrow(/consumed only by the finalization of its period/);
    await expect(
      withDatabaseContext({ agencyId }, (transaction) =>
        transaction.payrollConsumedAttendanceFact.create({
          data: {
            agencyId,
            attendancePayrollFactId: randomUUID(),
            payrollPeriodId: setup.period.id,
          },
        }),
      ),
    ).rejects.toThrow(/consumed only by the finalization of its period/);
  });

  it('rolls back with the period APPROVED when another payroll consumed a source first', async () => {
    const setup = await approvedPeriod('ROLLBACK');
    const { people, period } = setup;
    const factId = await absenceBehind(setup);
    const before = await finalizedState(setup);
    expect(before).toMatchObject({
      period: { status: 'APPROVED', finalizedAt: null },
      results: ['CALCULATED'],
      input: { status: 'PENDING', consumedByPayrollPeriodId: null },
    });
    const finalize = () =>
      finalization.finalize(people.approver, period.id, { rowVersion: period.rowVersion });

    // Test fixture only: another payroll's finalization consumed the input.
    const otherPeriodId = randomUUID();
    await seed((transaction) =>
      transaction.payrollInput.update({
        where: { id: setup.payrollInputId },
        data: { status: 'CONSUMED', consumedByPayrollPeriodId: otherPeriodId },
      }),
    );
    await expect(finalize()).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_SOURCE_CONSUMED',
      message: expect.stringMatching(/1 of its Payroll Inputs is no longer pending/),
    });
    await expect(finalizedState(setup)).resolves.toEqual({
      ...before,
      input: { status: 'CONSUMED', consumedByPayrollPeriodId: otherPeriodId },
    });

    // Then the absence instead.
    await seed(async (transaction) => {
      await transaction.payrollInput.update({
        where: { id: setup.payrollInputId },
        data: { status: 'PENDING', consumedByPayrollPeriodId: null },
      });
      await transaction.payrollConsumedAttendanceFact.create({
        data: {
          agencyId: setup.payrollTenant.agency.id,
          attendancePayrollFactId: factId,
          payrollPeriodId: otherPeriodId,
        },
      });
    });
    await expect(finalize()).rejects.toMatchObject({
      code: 'PAYROLL_SOURCE_CONSUMED',
      message: expect.stringMatching(/1 of its Attendance Payroll Facts was consumed/),
    });
    await expect(finalizedState(setup)).resolves.toEqual(before);
  });

  it('refuses totals that differ from the line sums, or results that no longer hash to the approval', async () => {
    const setup = await approvedPeriod('RECONCILE');
    const { people, period, result } = setup;
    const finalize = () =>
      finalization.finalize(people.approver, period.id, { rowVersion: period.rowVersion });
    const before = await finalizedState(setup);
    // Test fixture only: a stored result altered behind the triggers.
    const alter = (data: Prisma.PayrollEmployeeUpdateInput) =>
      seed((transaction) => transaction.payrollEmployee.update({ where: { id: result.id }, data }));

    // The stored net still equals gross less deductions, which a CHECK keeps.
    await alter({ grossAmount: result.grossAmount.add(1), netAmount: result.netAmount.add(1) });
    await expect(finalize()).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_TOTALS_UNRECONCILED',
    });
    await alter({
      grossAmount: result.grossAmount,
      netAmount: result.netAmount,
      calculationHash: 'f'.repeat(64),
    });
    await expect(finalize()).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_CALCULATION_HASH_CHANGED',
    });
    await expect(finalizedState(setup)).resolves.toEqual(before);

    await alter({ calculationHash: result.calculationHash });
    await expect(finalize()).resolves.toMatchObject({ status: 'FINALIZED' });
  });

  it('lets one of two approvers finalizing at once finalize, and refuses the other', async () => {
    const setup = await approvedPeriod('RACE');
    const { people, period } = setup;
    const input = { rowVersion: period.rowVersion };

    const outcomes = await Promise.allSettled([
      finalization.finalize(people.approver, period.id, input),
      finalization.finalize(people.secondApprover, period.id, input),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
      reason: { statusCode: 409, code: 'PAYROLL_PERIOD_NOT_APPROVED' },
    });
    // The approver already holds APPROVAL from approving; the second approver
    // claims it only by winning, and the loser's transaction claims nothing.
    const secondApproverWon = outcomes[1].status === 'fulfilled';
    await expect(finalizedState(setup)).resolves.toMatchObject({
      period: { status: 'FINALIZED', rowVersion: period.rowVersion + 1 },
      results: ['FINALIZED'],
      input: { status: 'CONSUMED', consumedByPayrollPeriodId: period.id },
      audit: 1,
      outbox: 1,
      approvers: secondApproverWon ? 2 : 1,
    });
  });

  it('refuses a stale row version, another payroll function, and an open blocking exception', async () => {
    const setup = await approvedPeriod('REFUSED');
    const { people, period } = setup;
    const before = await finalizedState(setup);

    await expect(
      finalization.finalize(people.approver, period.id, { rowVersion: period.rowVersion - 1 }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_PERIOD_STALE' });
    // The preparer holds payroll.periods.finalize, but prepares this period.
    await expect(
      finalization.finalize(people.preparer, period.id, { rowVersion: period.rowVersion }),
    ).rejects.toMatchObject({
      code: 'PAYROLL_FUNCTION_CONFLICT',
      message: expect.stringMatching(/PREPARATION.*APPROVAL/),
    });
    // Test fixture only: a source withdrawal would write this mark.
    await seed((transaction) =>
      transaction.payrollException.create({
        data: {
          agencyId: setup.payrollTenant.agency.id,
          payrollPeriodId: period.id,
          calculationVersion: period.calculationVersion,
          employeeId: setup.result.employeeId,
          exceptionType: 'PAYROLL_INPUT_WITHDRAWN',
          severity: 'BLOCKING',
          status: 'OPEN',
          details: {},
        },
      }),
    );
    await expect(
      finalization.finalize(people.approver, period.id, { rowVersion: period.rowVersion }),
    ).rejects.toMatchObject({
      code: 'PAYROLL_PERIOD_BLOCKING_EXCEPTION',
      message: expect.stringMatching(/Return the period before finalization/),
    });
    await expect(finalizedState(setup)).resolves.toEqual(before);
  });

  it('seeds payroll.periods.finalize to the Payroll Approver alone', async () => {
    const grants = await admin.rolePermission.findMany({
      where: { role: { agencyId: null }, permission: { code: 'payroll.periods.finalize' } },
      select: { scopePolicy: true, role: { select: { code: true } } },
    });
    expect(grants.map((grant) => `${grant.role.code} ${grant.scopePolicy}`)).toEqual([
      'payroll_approver AGENCY',
    ]);
  });
});
