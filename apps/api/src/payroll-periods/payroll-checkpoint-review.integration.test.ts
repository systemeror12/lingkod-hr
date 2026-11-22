import type { RequestContext } from '@lingkod-hr/auth';
import type { Prisma, PrismaClient } from '@prisma/client';
import { withDatabaseContext } from '@lingkod-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import { BasicSalaryCalculator } from '../payroll-calculation/basic-salary.calculator';
import { PayrollCalculationService } from '../payroll-calculation/payroll-calculation.service';
import { payrollSourcesReader } from '../payroll-calculation/payroll-calculation.test-fixtures';
import { PersonnelSalaryFactsService } from '../personnel-salary-facts/personnel-salary-facts.service';
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

describe.skipIf(!enabled)('Payroll Export Checkpoint Reviews in PostgreSQL', () => {
  // Test fixtures only: the rate is not from any issuance, and 2879 sits
  // clear of every other test's rule versions.
  const suffix = `${Date.now()}-checkpoint-review`;
  const scheduleCode = `${FIXTURE_PREFIX}CHECKPOINT-SCHEDULE-${suffix}`;
  const periods = new PayrollPeriodsService();
  const certification = new PayrollCertificationService();
  const reviewExport = new PayrollReviewExportService();
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
        // Held only to show that holding it does not let the certifier act in a second function.
        'payroll.periods.review_funding',
      ]),
      budgetOfficer: as(2, [
        'payroll.periods.read',
        'payroll.periods.review_funding',
        // Held only to show the one-function rule refuses the second checkpoint.
        'payroll.periods.review_accounting',
      ]),
      accountingReviewer: as(3, ['payroll.periods.read', 'payroll.periods.review_accounting']),
    };
  }

  /** An Agency with one SG-11 step-1 Employee in service all year, and two evidence documents. */
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
    const employee = await admin.employee.create({
      data: {
        agencyId: agency.id,
        employeeNumber: `CHECKPOINT-${label}-${suffix}`,
        legalName: `Checkpoint ${label}`,
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `checkpoint-${label.toLowerCase()}-${suffix}@example.test`,
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
            effectiveFrom: new Date('2879-01-01'),
            effectiveTo: null,
            status: 'ACTIVE',
            createdByMembershipId: membershipId,
          },
        }),
    );
    return {
      ...created,
      evidence: await evidenceVersion(created, 'issued', true),
      draftEvidence: await evidenceVersion(created, 'draft', false),
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
        storageKey: `checkpoint/${agency.id}/${label}`,
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

  /** A March 2879 regular period, calculated and certified, with its current export. */
  async function certifiedPeriod(payrollTenant: PayrollTenant) {
    const people = roles(payrollTenant);
    const draft = await periods.create(people.preparer, {
      code: `CHECKPOINT-2879-03-${suffix}`,
      runType: 'REGULAR',
      periodFrom: '2879-03-01',
      periodTo: '2879-03-31',
      cutoffAt: '2026-01-01T00:00:00+08:00',
      paymentDate: '2879-03-15',
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

  const reviewCount = (payrollPeriodId: string) =>
    admin.payrollExportCheckpointReview.count({ where: { payrollPeriodId } });

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
          effectiveFrom: new Date('2879-01-01'),
          effectiveTo: new Date('2879-12-31'),
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

  it('records both confirmations against the exact export, in either order, and keeps the period CERTIFIED', async () => {
    const payrollTenant = await tenant('CONFIRM');
    const people = roles(payrollTenant);
    const { period, exportId } = await certifiedPeriod(payrollTenant);

    // Accounting first, then Budget: the order is free.
    const accounting = await reviews.record(
      people.accountingReviewer,
      'ACCOUNTING',
      period.id,
      exportId,
      confirmation(payrollTenant.evidence, 'JEV-2879-03-0001'),
    );
    expect(accounting).toMatchObject({
      review: {
        reviewExportId: exportId,
        checkpoint: 'ACCOUNTING',
        outcome: 'CONFIRMED',
        externalReference: 'JEV-2879-03-0001',
        evidenceDocumentVersionId: payrollTenant.evidence,
        reason: null,
        reviewedByMembershipId: people.accountingReviewer.membershipId,
      },
      period: { status: 'CERTIFIED', rowVersion: period.rowVersion },
    });
    const budget = await reviews.record(
      people.budgetOfficer,
      'BUDGET',
      period.id,
      exportId,
      confirmation(payrollTenant.evidence, 'ORS-2879-03-0001'),
    );
    expect(budget.review).toMatchObject({ checkpoint: 'BUDGET', outcome: 'CONFIRMED' });

    // The period detail lists the reviews in force on its current export, naming each reviewer.
    const read = await periods.read(people.budgetOfficer, period.id);
    expect(read).toMatchObject({ status: 'CERTIFIED', rowVersion: period.rowVersion });
    expect(read.certification?.checkpointReviews).toEqual([
      { ...accounting.review, reviewedByName: 'Payroll Period CONFIRM User 3' },
      { ...budget.review, reviewedByName: 'Payroll Period CONFIRM User 2' },
    ]);

    // One review of each checkpoint per export.
    await expect(
      reviews.record(people.accountingReviewer, 'ACCOUNTING', period.id, exportId, {
        outcome: 'RETURNED',
        reason: 'Second thoughts.',
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_CHECKPOINT_REVIEW_RECORDED' });

    await expect(eventsOf(period.id, 'PAYROLL_CHECKPOINT_REVIEW_CONFIRMED')).resolves.toEqual([
      expect.objectContaining({
        actorMembershipId: people.accountingReviewer.membershipId,
        previousStatus: 'CERTIFIED',
        newStatus: 'CERTIFIED',
        metadata: {
          payrollExportCheckpointReviewId: accounting.review.id,
          checkpoint: 'ACCOUNTING',
          reviewExportId: exportId,
          externalReference: 'JEV-2879-03-0001',
          evidenceDocumentVersionId: payrollTenant.evidence,
        },
      }),
      expect.objectContaining({ actorMembershipId: people.budgetOfficer.membershipId }),
    ]);
    await expect(functionsOn(period.id)).resolves.toEqual(
      [
        `${people.preparer.membershipId} PREPARATION`,
        `${people.certifier.membershipId} HR_CERTIFICATION`,
        `${people.budgetOfficer.membershipId} BUDGET_REVIEW`,
        `${people.accountingReviewer.membershipId} ACCOUNTING_REVIEW`,
      ].sort(),
    );
  });

  it('returns with a reason: FOR_REVIEW, the certification and export revoked, and the other review with them', async () => {
    const payrollTenant = await tenant('RETURN');
    const people = roles(payrollTenant);
    const { period, exportId } = await certifiedPeriod(payrollTenant);
    const accounting = await reviews.record(
      people.accountingReviewer,
      'ACCOUNTING',
      period.id,
      exportId,
      confirmation(payrollTenant.evidence, 'JEV-2879-03-0002'),
    );

    await expect(
      reviews.record(people.budgetOfficer, 'BUDGET', period.id, exportId, { outcome: 'RETURNED' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' });
    const returned = await reviews.record(people.budgetOfficer, 'BUDGET', period.id, exportId, {
      outcome: 'RETURNED',
      reason: 'The allotment for Personnel Services does not cover the payroll.',
    });
    expect(returned).toMatchObject({
      review: { outcome: 'RETURNED', reason: expect.stringMatching(/allotment/) },
      period: { status: 'FOR_REVIEW', rowVersion: period.rowVersion + 1 },
    });

    const revokedCertification = await admin.payrollCertification.findFirstOrThrow({
      where: { payrollPeriodId: period.id },
    });
    expect(revokedCertification).toMatchObject({
      revokedByMembershipId: people.budgetOfficer.membershipId,
      revocationReason: 'The allotment for Personnel Services does not cover the payroll.',
      revokedAt: expect.any(Date),
    });
    await expect(
      reviewExport.read(people.budgetOfficer, period.id, exportId),
    ).resolves.toMatchObject({ supersededAt: expect.any(String) });
    await expect(periods.read(people.budgetOfficer, period.id)).resolves.toMatchObject({
      status: 'FOR_REVIEW',
      certification: null,
    });
    await expect(eventsOf(period.id, 'PAYROLL_CHECKPOINT_REVIEW_RETURNED')).resolves.toEqual([
      expect.objectContaining({
        actorMembershipId: people.budgetOfficer.membershipId,
        previousStatus: 'CERTIFIED',
        newStatus: 'FOR_REVIEW',
        reason: 'The allotment for Personnel Services does not cover the payroll.',
        metadata: expect.objectContaining({
          payrollExportCheckpointReviewId: returned.review.id,
          checkpoint: 'BUDGET',
          payrollCertificationId: revokedCertification.id,
          supersededReviewExportId: exportId,
          revokedCheckpointReviewIds: [accounting.review.id],
        }),
      }),
    ]);

    // Certified again, the new export starts with no review in force; both old reviews stay.
    const recertified = await certify(payrollTenant, period.id);
    expect(recertified.exportId).not.toBe(exportId);
    expect(recertified.period.certification?.checkpointReviews).toEqual([]);
    await expect(reviewCount(period.id)).resolves.toBe(2);
  });

  it('refuses a review against a superseded export, in the service and in the database', async () => {
    const payrollTenant = await tenant('SUPERSEDED');
    const people = roles(payrollTenant);
    const { period, exportId: first } = await certifiedPeriod(payrollTenant);
    await reviews.record(
      people.budgetOfficer,
      'BUDGET',
      period.id,
      first,
      confirmation(payrollTenant.evidence, 'ORS-2879-03-0003'),
    );

    const revoked = await certification.revokeCertification(people.certifier, period.id, {
      reason: 'Personnel corrected the salary step.',
      rowVersion: period.rowVersion,
    });
    // Revoking the certification revokes the export's review with it.
    await expect(eventsOf(period.id, 'PAYROLL_PERIOD_CERTIFICATION_REVOKED')).resolves.toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          supersededReviewExportId: first,
          revokedCheckpointReviewIds: [expect.any(String)],
        }),
      }),
    ]);
    // While FOR_REVIEW there is no current export to review.
    await expect(
      reviews.record(
        people.accountingReviewer,
        'ACCOUNTING',
        period.id,
        first,
        confirmation(payrollTenant.evidence, 'JEV-1'),
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_PERIOD_NOT_CERTIFIED' });
    expect(revoked.status).toBe('FOR_REVIEW');

    const { exportId: second } = await certify(payrollTenant, period.id);
    await expect(
      reviews.record(
        people.accountingReviewer,
        'ACCOUNTING',
        period.id,
        first,
        confirmation(payrollTenant.evidence, 'JEV-1'),
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_REVIEW_EXPORT_SUPERSEDED' });
    await expect(
      reviews.record(people.accountingReviewer, 'ACCOUNTING', period.id, first, {
        outcome: 'RETURNED',
        reason: 'Returning the old snapshot.',
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_REVIEW_EXPORT_SUPERSEDED' });
    await expect(periods.read(people.certifier, period.id)).resolves.toMatchObject({
      status: 'CERTIFIED',
    });

    // The guard holds without the service, too.
    const row = {
      agencyId: payrollTenant.agency.id,
      payrollPeriodId: period.id,
      certifiedPayrollReviewExportId: first,
      checkpoint: 'ACCOUNTING',
      outcome: 'CONFIRMED',
      externalReference: 'JEV-1',
      evidenceDocumentVersionId: payrollTenant.evidence,
      reviewedByMembershipId: people.accountingReviewer.membershipId,
    };
    await expect(admin.payrollExportCheckpointReview.create({ data: row })).rejects.toThrow(
      /only against the current export of a CERTIFIED Payroll Period/,
    );
    await expect(
      admin.payrollExportCheckpointReview.create({
        data: { ...row, certifiedPayrollReviewExportId: second, evidenceDocumentVersionId: null },
      }),
    ).rejects.toThrow(/confirmed_check/);

    // The current export is reviewed as usual; the Budget Officer's function holds across versions.
    await expect(
      reviews.record(
        people.accountingReviewer,
        'ACCOUNTING',
        period.id,
        second,
        confirmation(payrollTenant.evidence, 'JEV-1'),
      ),
    ).resolves.toMatchObject({ review: { reviewExportId: second } });
    await expect(reviewCount(period.id)).resolves.toBe(2);
  });

  it('keeps each reviewer to one payroll function on the period', async () => {
    const payrollTenant = await tenant('FUNCTION');
    const people = roles(payrollTenant);
    const { period, exportId } = await certifiedPeriod(payrollTenant);

    // The HR Certifier holds review_funding here, but already acts in HR_CERTIFICATION.
    await expect(
      reviews.record(
        people.certifier,
        'BUDGET',
        period.id,
        exportId,
        confirmation(payrollTenant.evidence, 'ORS-1'),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_FUNCTION_CONFLICT',
      message: expect.stringMatching(/HR_CERTIFICATION.*BUDGET_REVIEW/),
    });
    await reviews.record(
      people.budgetOfficer,
      'BUDGET',
      period.id,
      exportId,
      confirmation(payrollTenant.evidence, 'ORS-1'),
    );
    // The Budget Officer holds review_accounting here, but already acts in BUDGET_REVIEW.
    await expect(
      reviews.record(people.budgetOfficer, 'ACCOUNTING', period.id, exportId, {
        outcome: 'RETURNED',
        reason: 'Trying the other checkpoint.',
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_FUNCTION_CONFLICT' });

    await expect(reviewCount(period.id)).resolves.toBe(1);
    await expect(periods.read(people.certifier, period.id)).resolves.toMatchObject({
      status: 'CERTIFIED',
      rowVersion: period.rowVersion,
    });
  });

  it('refuses evidence that is not a finalized Document Version of the Agency', async () => {
    const payrollTenant = await tenant('EVIDENCE');
    const other = await tenant('EVIDENCE-OTHER');
    const people = roles(payrollTenant);
    const { period, exportId } = await certifiedPeriod(payrollTenant);

    for (const evidence of [payrollTenant.draftEvidence, other.evidence]) {
      await expect(
        reviews.record(
          people.budgetOfficer,
          'BUDGET',
          period.id,
          exportId,
          confirmation(evidence, 'ORS-1'),
        ),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'PAYROLL_CHECKPOINT_REVIEW_EVIDENCE_INVALID',
      });
    }
    await expect(reviewCount(period.id)).resolves.toBe(0);
    // A refused review claims no function.
    await expect(functionsOn(period.id)).resolves.not.toContain(
      `${people.budgetOfficer.membershipId} BUDGET_REVIEW`,
    );
  });

  it('keeps another Agency from reviewing or reading the reviews', async () => {
    const payrollTenant = await tenant('OWNER');
    const outsider = roles(await tenant('OUTSIDER')).budgetOfficer;
    const people = roles(payrollTenant);
    const { period, exportId } = await certifiedPeriod(payrollTenant);
    await reviews.record(
      people.accountingReviewer,
      'ACCOUNTING',
      period.id,
      exportId,
      confirmation(payrollTenant.evidence, 'JEV-1'),
    );

    await expect(
      reviews.record(outsider, 'BUDGET', period.id, exportId, {
        outcome: 'RETURNED',
        reason: 'Not my Agency.',
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'PAYROLL_PERIOD_NOT_FOUND' });
    // Row-level security hides the reviews from the other Agency's context.
    await expect(
      withDatabaseContext(requestDatabaseContext(outsider), (transaction) =>
        transaction.payrollExportCheckpointReview.count({ where: { payrollPeriodId: period.id } }),
      ),
    ).resolves.toBe(0);
    await expect(periods.read(people.certifier, period.id)).resolves.toMatchObject({
      status: 'CERTIFIED',
    });
    await expect(reviewCount(period.id)).resolves.toBe(1);
  });

  it('keeps reviews immutable in the database and seeds each permission to its §6.10 role', async () => {
    const payrollTenant = await tenant('GUARD');
    const people = roles(payrollTenant);
    const { period, exportId } = await certifiedPeriod(payrollTenant);
    const { review } = await reviews.record(
      people.budgetOfficer,
      'BUDGET',
      period.id,
      exportId,
      confirmation(payrollTenant.evidence, 'ORS-1'),
    );
    const where = { id: review.id };
    await expect(
      admin.payrollExportCheckpointReview.update({ where, data: { externalReference: 'ORS-2' } }),
    ).rejects.toThrow(/immutable/);
    await expect(admin.payrollExportCheckpointReview.delete({ where })).rejects.toThrow(
      /immutable/,
    );

    const grants = await admin.rolePermission.findMany({
      where: {
        role: { agencyId: null },
        permission: {
          code: { in: ['payroll.periods.review_funding', 'payroll.periods.review_accounting'] },
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
      'accounting_reviewer payroll.periods.review_accounting AGENCY',
      'budget_officer payroll.periods.review_funding AGENCY',
    ]);
  });
});
