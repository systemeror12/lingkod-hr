import type { RequestContext } from '@lingkod-hr/auth';
import type { Prisma, PrismaClient } from '@prisma/client';
import { withDatabaseContext } from '@lingkod-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import { DocumentsService } from '../documents/documents.service';
import { BasicSalaryCalculator } from '../payroll-calculation/basic-salary.calculator';
import { PayrollCalculationService } from '../payroll-calculation/payroll-calculation.service';
import { payrollSourcesReader } from '../payroll-calculation/payroll-calculation.test-fixtures';
import { PersonnelSalaryFactsService } from '../personnel-salary-facts/personnel-salary-facts.service';
import { PayrollApprovalService } from './payroll-approval.service';
import { PayrollCertificationService } from './payroll-certification.service';
import { PayrollCheckpointReviewService } from './payroll-checkpoint-review.service';
import { PayrollPeriodsService } from './payroll-periods.service';
import { PayrollReviewExportService } from './payroll-review-export.service';
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

describe.skipIf(!enabled)('Payroll approval and return before finalization in PostgreSQL', () => {
  // Test fixtures only: the rate is not from any issuance, and 2890 sits
  // clear of every other test's rule versions.
  const suffix = `${Date.now()}-approval`;
  const scheduleCode = `${FIXTURE_PREFIX}APPROVAL-SCHEDULE-${suffix}`;
  const periods = new PayrollPeriodsService();
  const certification = new PayrollCertificationService();
  const reviewExport = new PayrollReviewExportService();
  const approval = new PayrollApprovalService();
  const reviews = new PayrollCheckpointReviewService(
    new DocumentsService({} as never, {} as never),
  );
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
    const approver = [
      'payroll.periods.read',
      'payroll.periods.approve',
      'payroll.periods.return_approved',
      'payroll.periods.revoke_certification',
      'payroll.periods.return',
    ];
    return {
      preparer: as(0, [
        'payroll.periods.create',
        'payroll.periods.calculate',
        'payroll.periods.read',
        // Held only to show that holding them does not let the preparer act in APPROVAL.
        'payroll.periods.approve',
        'payroll.periods.return_approved',
      ]),
      certifier: as(1, [
        'payroll.periods.read',
        'payroll.periods.certify',
        'payroll.periods.revoke_certification',
        'payroll.periods.return',
      ]),
      budgetOfficer: as(2, ['payroll.periods.read', 'payroll.periods.review_funding']),
      accountingReviewer: as(3, [
        'payroll.periods.read',
        'payroll.periods.review_accounting',
        // §6.10 marks approve C for the Accounting Reviewer; the one-function rule still holds.
        'payroll.periods.approve',
      ]),
      approver: as(4, approver),
      secondApprover: as(5, approver),
    };
  }

  /** An Agency with one SG-11 step-1 Employee in service all year, and two evidence documents. */
  async function tenant(label: string) {
    const created = await createPayrollTenant(admin, suffix, label, 6);
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
        employeeNumber: `APPROVAL-${label}-${suffix}`,
        legalName: `Approval ${label}`,
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `approval-${label.toLowerCase()}-${suffix}@example.test`,
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
            effectiveFrom: new Date('2890-01-01'),
            effectiveTo: null,
            status: 'ACTIVE',
            createdByMembershipId: membershipId,
          },
        }),
    );
    return {
      ...created,
      evidence: await evidenceVersion(created, 'issued', true),
    };
  }

  /** A Document Version standing for External Evidence such as an ORS or a JEV reference. */
  async function evidenceVersion(payrollTenant: PayrollTenant, label: string, issued: boolean) {
    const { agency, persons } = payrollTenant;
    const document = await admin.document.create({
      data: {
        agencyId: agency.id,
        documentType: 'EXTERNAL_EVIDENCE',
        classification: 'INTERNAL',
        status: issued ? 'APPROVED' : 'DRAFT',
        createdByMembershipId: persons[0]!.membership.id,
      },
    });
    const version = await admin.documentVersion.create({
      data: {
        agencyId: agency.id,
        documentId: document.id,
        versionNo: 1,
        storageKey: `approval/${agency.id}/${label}`,
        contentHash: 'c'.repeat(64),
        mimeType: 'application/pdf',
        sizeBytes: 1,
        issuedAt: issued ? new Date() : null,
        createdByMembershipId: persons[0]!.membership.id,
      },
    });
    await admin.document.update({
      where: { id: document.id },
      data: { currentVersionId: version.id },
    });
    return version.id;
  }

  /** A March 2890 regular period, calculated and certified, with its current export. */
  async function certifiedPeriod(payrollTenant: PayrollTenant) {
    const people = roles(payrollTenant);
    const draft = await periods.create(people.preparer, {
      code: `APPROVAL-2890-03-${suffix}`,
      runType: 'REGULAR',
      periodFrom: '2890-03-01',
      periodTo: '2890-03-31',
      cutoffAt: '2026-01-01T00:00:00+08:00',
      paymentDate: '2890-03-15',
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
    return certify(payrollTenant, draft.id);
  }

  /** Certify the period's current version; returns the period and its current export id. */
  async function certify(payrollTenant: PayrollTenant, periodId: string) {
    const { certifier } = roles(payrollTenant);
    const period = await periods.read(certifier, periodId);
    await certification.certify(certifier, periodId, {
      calculationVersion: period.calculationVersion,
      calculationHash: period.calculationHash,
    });
    const certified = await periods.read(certifier, periodId);
    return { period: certified, exportId: certified.certification!.reviewExportId! };
  }

  const confirmation = (evidenceDocumentVersionId: string, externalReference: string) => ({
    outcome: 'CONFIRMED',
    externalReference,
    evidenceDocumentVersionId,
  });

  const eventsOf = (entityId: string, action: string) =>
    admin.auditEvent.findMany({ where: { entityId, action }, orderBy: { occurredAt: 'asc' } });

  const functionsOn = async (payrollPeriodId: string) =>
    (
      await admin.payrollPeriodActor.findMany({
        where: { payrollPeriodId },
        select: { membershipId: true, payrollFunction: true },
      })
    )
      .map((actor) => `${actor.membershipId} ${actor.payrollFunction}`)
      .sort();

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
          verifiedOn: new Date('2026-11-19'),
          verifiedBy: 'LingkodHR test fixture',
          effectiveFrom: new Date('2890-01-01'),
          effectiveTo: new Date('2890-12-31'),
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

  /** Both checkpoint reviews confirmed on the period's current export. */
  async function reviewed(payrollTenant: Awaited<ReturnType<typeof tenant>>) {
    const people = roles(payrollTenant);
    const { period, exportId } = await certifiedPeriod(payrollTenant);
    const budget = await reviews.record(
      people.budgetOfficer,
      'BUDGET',
      period.id,
      exportId,
      confirmation(payrollTenant.evidence, 'ORS-2890-03-0001'),
    );
    const accounting = await reviews.record(
      people.accountingReviewer,
      'ACCOUNTING',
      period.id,
      exportId,
      confirmation(payrollTenant.evidence, 'JEV-2890-03-0001'),
    );
    return { period, exportId, reviewIds: [budget.review.id, accounting.review.id] };
  }

  it('approves once both checkpoint reviews are confirmed on the current export, and locks the approved version', async () => {
    const payrollTenant = await tenant('APPROVE');
    const people = roles(payrollTenant);
    const { period, exportId } = await certifiedPeriod(payrollTenant);
    const approve = () =>
      approval.approve(people.approver, period.id, { rowVersion: period.rowVersion });

    // No review yet, then only the Budget review: refused, and nothing is claimed.
    await expect(approve()).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_CHECKPOINT_REVIEWS_UNCONFIRMED',
      message: expect.stringMatching(/BUDGET and ACCOUNTING/),
    });
    const budget = await reviews.record(
      people.budgetOfficer,
      'BUDGET',
      period.id,
      exportId,
      confirmation(payrollTenant.evidence, 'ORS-2890-03-0002'),
    );
    await expect(approve()).rejects.toMatchObject({
      code: 'PAYROLL_CHECKPOINT_REVIEWS_UNCONFIRMED',
      message: expect.stringMatching(/; ACCOUNTING is not confirmed/),
    });
    await expect(functionsOn(period.id)).resolves.not.toContain(
      `${people.approver.membershipId} APPROVAL`,
    );
    const accounting = await reviews.record(
      people.accountingReviewer,
      'ACCOUNTING',
      period.id,
      exportId,
      confirmation(payrollTenant.evidence, 'JEV-2890-03-0002'),
    );

    await expect(
      approval.approve(people.approver, period.id, { rowVersion: period.rowVersion - 1 }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_PERIOD_STALE' });
    await expect(approve()).resolves.toMatchObject({
      status: 'APPROVED',
      calculationVersion: period.calculationVersion,
      rowVersion: period.rowVersion + 1,
    });

    // The certification, export, and reviews it approved stay in force.
    // The read names each actor and when they acted.
    const approved = await periods.read(people.approver, period.id);
    expect(approved).toMatchObject({
      status: 'APPROVED',
      calculationHash: period.calculationHash,
      certification: {
        id: period.certification!.id,
        calculationVersion: period.calculationVersion,
        calculationHash: period.calculationHash,
        certifiedByMembershipId: people.certifier.membershipId,
        certifiedByName: 'Payroll Period APPROVE User 1',
        approvedByMembershipId: people.approver.membershipId,
        approvedByName: 'Payroll Period APPROVE User 4',
        approvedAt: expect.any(String),
        reviewExportId: exportId,
        checkpointReviews: [
          { ...budget.review, reviewedByName: 'Payroll Period APPROVE User 2' },
          { ...accounting.review, reviewedByName: 'Payroll Period APPROVE User 3' },
        ],
      },
      finalizedByMembershipId: null,
      finalizedByName: null,
    });
    // The approval is recorded once; a direct edit is refused.
    await expect(
      admin.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT set_config('app.agency_id', ${payrollTenant.agency.id}, true)`;
        await transaction.$executeRaw`UPDATE payroll_certifications SET approved_at = now() WHERE id = CAST(${period.certification!.id} AS uuid)`;
      }),
    ).rejects.toThrow(/records its approval once/);
    await expect(eventsOf(period.id, 'PAYROLL_PERIOD_APPROVED')).resolves.toEqual([
      expect.objectContaining({
        actorMembershipId: people.approver.membershipId,
        previousStatus: 'CERTIFIED',
        newStatus: 'APPROVED',
        reason: null,
        metadata: {
          payrollCertificationId: period.certification!.id,
          calculationVersion: period.calculationVersion,
          calculationHash: period.calculationHash,
          certifiedPayrollReviewExportId: exportId,
          reviewExportChecksum: expect.stringMatching(/^[0-9a-f]{64}$/),
          checkpointReviewIds: [budget.review.id, accounting.review.id],
        },
      }),
    ]);

    // Nothing changes the approved version: no second approval, revocation,
    // checkpoint review, or recalculation.
    await expect(
      approval.approve(people.secondApprover, period.id, { rowVersion: approved.rowVersion }),
    ).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_CERTIFIED' });
    await expect(
      certification.revokeCertification(people.certifier, period.id, {
        reason: 'Too late.',
        rowVersion: approved.rowVersion,
      }),
    ).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_CERTIFIED' });
    await expect(
      reviews.record(people.budgetOfficer, 'BUDGET', period.id, exportId, {
        outcome: 'RETURNED',
        reason: 'Too late.',
      }),
    ).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_CERTIFIED' });
    await expect(
      periods.startCalculation(people.preparer, period.id, { rowVersion: approved.rowVersion }),
    ).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_DRAFT' });
    await expect(functionsOn(period.id)).resolves.toEqual(
      [
        `${people.preparer.membershipId} PREPARATION`,
        `${people.certifier.membershipId} HR_CERTIFICATION`,
        `${people.budgetOfficer.membershipId} BUDGET_REVIEW`,
        `${people.accountingReviewer.membershipId} ACCOUNTING_REVIEW`,
        `${people.approver.membershipId} APPROVAL`,
      ].sort(),
    );
  });

  it('refuses approval while the version has an open blocking exception', async () => {
    const payrollTenant = await tenant('BLOCKED');
    const people = roles(payrollTenant);
    const { period } = await reviewed(payrollTenant);
    // Test fixture only: a source withdrawal would write this mark; the
    // trigger that requires a cancelled input is lifted for the insert.
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.payrollException.create({
        data: {
          agencyId: payrollTenant.agency.id,
          payrollPeriodId: period.id,
          calculationVersion: period.calculationVersion,
          exceptionType: 'PAYROLL_INPUT_WITHDRAWN',
          severity: 'BLOCKING',
          status: 'OPEN',
          details: {},
        },
      });
    });

    await expect(
      approval.approve(people.approver, period.id, { rowVersion: period.rowVersion }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_PERIOD_BLOCKING_EXCEPTION',
      message: expect.stringMatching(/Revoke the certification/),
    });
    await expect(periods.read(people.approver, period.id)).resolves.toMatchObject({
      status: 'CERTIFIED',
      rowVersion: period.rowVersion,
    });
  });

  it('refuses the preparer, or a reviewer, who holds the approve permission', async () => {
    const payrollTenant = await tenant('PREPARER');
    const people = roles(payrollTenant);
    const { period } = await reviewed(payrollTenant);

    // The preparer holds payroll.periods.approve, but prepares this period.
    await expect(
      approval.approve(people.preparer, period.id, { rowVersion: period.rowVersion }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_FUNCTION_CONFLICT',
      message: expect.stringMatching(/PREPARATION.*APPROVAL/),
    });
    // So does the Accounting Reviewer, who already reviewed it.
    await expect(
      approval.approve(people.accountingReviewer, period.id, { rowVersion: period.rowVersion }),
    ).rejects.toMatchObject({
      code: 'PAYROLL_FUNCTION_CONFLICT',
      message: expect.stringMatching(/ACCOUNTING_REVIEW.*APPROVAL/),
    });
    await expect(periods.read(people.approver, period.id)).resolves.toMatchObject({
      status: 'CERTIFIED',
      rowVersion: period.rowVersion,
    });
    await expect(eventsOf(period.id, 'PAYROLL_PERIOD_APPROVED')).resolves.toEqual([]);

    // A Payroll Approver approves it as usual.
    await expect(
      approval.approve(people.approver, period.id, { rowVersion: period.rowVersion }),
    ).resolves.toMatchObject({ status: 'APPROVED' });
    // Approved, the preparer still cannot return it.
    await expect(
      approval.returnBeforeFinalization(people.preparer, period.id, {
        reason: 'Trying the approver function.',
        rowVersion: period.rowVersion + 1,
      }),
    ).rejects.toMatchObject({ code: 'PAYROLL_FUNCTION_CONFLICT' });
  });

  it('lets one of two approvers acting at once approve, and refuses the other', async () => {
    const payrollTenant = await tenant('RACE');
    const people = roles(payrollTenant);
    const { period } = await reviewed(payrollTenant);
    const input = { rowVersion: period.rowVersion };

    const outcomes = await Promise.allSettled([
      approval.approve(people.approver, period.id, input),
      approval.approve(people.secondApprover, period.id, input),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const [refused] = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(refused).toMatchObject({
      reason: { statusCode: 409, code: 'PAYROLL_PERIOD_NOT_CERTIFIED' },
    });
    await expect(periods.read(people.approver, period.id)).resolves.toMatchObject({
      status: 'APPROVED',
      rowVersion: period.rowVersion + 1,
    });
    await expect(eventsOf(period.id, 'PAYROLL_PERIOD_APPROVED')).resolves.toHaveLength(1);
    // Only the winner holds APPROVAL; the refused approval rolled its claim back.
    const approvers = (await functionsOn(period.id)).filter((actor) => actor.endsWith(' APPROVAL'));
    expect(approvers).toHaveLength(1);
  });

  it('returns an approved period before finalization, with a reason, revoking the certification, export, and reviews', async () => {
    const payrollTenant = await tenant('RETURN');
    const people = roles(payrollTenant);
    const { period, exportId, reviewIds } = await reviewed(payrollTenant);
    const approved = await approval.approve(people.approver, period.id, {
      rowVersion: period.rowVersion,
    });

    await expect(
      approval.returnBeforeFinalization(people.approver, period.id, {
        rowVersion: approved.rowVersion,
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' });
    await expect(
      approval.returnBeforeFinalization(people.approver, period.id, {
        reason: 'Stale.',
        rowVersion: period.rowVersion,
      }),
    ).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_STALE' });
    const reason = 'The Budget Officer reports the allotment was reduced.';
    const returned = await approval.returnBeforeFinalization(people.approver, period.id, {
      reason,
      rowVersion: approved.rowVersion,
    });
    expect(returned).toMatchObject({ status: 'FOR_REVIEW', rowVersion: approved.rowVersion + 1 });

    await expect(
      admin.payrollCertification.findFirstOrThrow({ where: { payrollPeriodId: period.id } }),
    ).resolves.toMatchObject({
      id: period.certification!.id,
      revokedByMembershipId: people.approver.membershipId,
      revocationReason: reason,
      revokedAt: expect.any(Date),
      // The revoked certification keeps its approval as history.
      approvedByMembershipId: people.approver.membershipId,
      approvedAt: expect.any(Date),
    });
    await expect(reviewExport.read(people.approver, period.id, exportId)).resolves.toMatchObject({
      supersededAt: expect.any(String),
    });
    await expect(periods.read(people.approver, period.id)).resolves.toMatchObject({
      status: 'FOR_REVIEW',
      certification: null,
    });
    await expect(
      eventsOf(period.id, 'PAYROLL_PERIOD_RETURNED_BEFORE_FINALIZATION'),
    ).resolves.toEqual([
      expect.objectContaining({
        actorMembershipId: people.approver.membershipId,
        previousStatus: 'APPROVED',
        newStatus: 'FOR_REVIEW',
        reason,
        metadata: {
          payrollCertificationId: period.certification!.id,
          calculationVersion: period.calculationVersion,
          calculationHash: period.calculationHash,
          supersededReviewExportId: exportId,
          revokedCheckpointReviewIds: reviewIds,
        },
      }),
    ]);

    // Returned for correction, it is calculated again as a new version.
    const draft = await certification.returnForCorrection(people.approver, period.id, {
      reason,
      rowVersion: returned.rowVersion,
    });
    await expect(
      periods.startCalculation(people.preparer, period.id, { rowVersion: draft.rowVersion }),
    ).resolves.toMatchObject({
      status: 'CALCULATING',
      calculationVersion: period.calculationVersion + 1,
    });
    // The approver kept one function throughout.
    await expect(functionsOn(period.id)).resolves.toContain(
      `${people.approver.membershipId} APPROVAL`,
    );
  });

  it('refuses a return before finalization while the period is only CERTIFIED', async () => {
    const payrollTenant = await tenant('NOT-APPROVED');
    const people = roles(payrollTenant);
    const { period } = await reviewed(payrollTenant);
    await expect(
      approval.returnBeforeFinalization(people.approver, period.id, {
        reason: 'Not approved yet.',
        rowVersion: period.rowVersion,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_PERIOD_NOT_APPROVED' });
  });

  it('keeps another Agency from approving', async () => {
    const payrollTenant = await tenant('OWNER');
    const outsider = roles(await tenant('OUTSIDER')).approver;
    const people = roles(payrollTenant);
    const { period } = await reviewed(payrollTenant);
    await expect(
      approval.approve(outsider, period.id, { rowVersion: period.rowVersion }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'PAYROLL_PERIOD_NOT_FOUND' });
    await expect(periods.read(people.approver, period.id)).resolves.toMatchObject({
      status: 'CERTIFIED',
    });
  });

  it('seeds both permissions to the Payroll Approver alone', async () => {
    const grants = await admin.rolePermission.findMany({
      where: {
        role: { agencyId: null },
        permission: {
          code: { in: ['payroll.periods.approve', 'payroll.periods.return_approved'] },
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
      'payroll_approver payroll.periods.approve AGENCY',
      'payroll_approver payroll.periods.return_approved AGENCY',
    ]);
  });
});
