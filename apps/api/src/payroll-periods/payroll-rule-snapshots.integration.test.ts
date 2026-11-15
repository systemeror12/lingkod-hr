import { withDatabaseContext } from '@lingkod-hr/database';
import type { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PayrollPeriodsService } from './payroll-periods.service';
import { freezePayrollRuleSnapshot } from './payroll-rule-snapshots';
import {
  cleanupPayrollTenants,
  cleanupPlatformFixtures,
  createAdminClient,
  createPayComponent,
  createPayrollTenant,
  FIXTURE_PREFIX,
  type PayrollTenant,
} from './payroll-periods.test-fixtures';

const enabled = process.env.DATABASE_E2E === 'true';

describe.skipIf(!enabled)('Payroll rule snapshots in PostgreSQL', () => {
  // The rule versions sit in 2801–2803, clear of the rule-version tests' dates.
  const suffix = `${Date.now()}`;
  const service = new PayrollPeriodsService();
  let admin: PrismaClient;
  let home: PayrollTenant;
  let foreign: PayrollTenant;
  let componentId: string;
  let firstTranche: string;
  let secondTranche: string;
  // Authorized-input fixtures (#346), removed before the tenants are.
  let inputComponentId: string;
  let employeeId: string;
  let authorityId: string;

  const ruleVersion = (
    label: string,
    effectiveFrom: string,
    effectiveTo: string | null,
    supersedesRuleVersionId: string | null = null,
  ) =>
    admin.nationalPayrollRuleVersion.create({
      data: {
        ruleKind: 'SALARY_SCHEDULE',
        code: `${FIXTURE_PREFIX}${label}-${suffix}`,
        name: `Test salary schedule ${label}`,
        issuingAuthority: 'Test authority',
        issuanceReference: 'Test fixture, not an issuance',
        sourceUrl: 'https://example.test/salary-schedule',
        verifiedOn: new Date('2026-11-15'),
        verifiedBy: 'LingkodHR test fixture',
        effectiveFrom: new Date(effectiveFrom),
        effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
        supersedesRuleVersionId,
      },
    });

  const special = (code: string, periodFrom: string, periodTo: string) =>
    service.create(home.persons[0]!.context, {
      code,
      runType: 'SPECIAL',
      periodFrom,
      periodTo,
      cutoffAt: `${periodTo}T17:00:00+08:00`,
      paymentDate: periodTo,
      payComponentIds: [componentId],
    });

  /** Starts the next calculation version and freezes its snapshot in one transaction. */
  const startCalculation = (
    periodId: string,
    afterFreeze: (transaction: Prisma.TransactionClient) => Promise<void> = async () => {},
  ) =>
    withDatabaseContext(home.persons[0]!.scope, async (transaction) => {
      await transaction.payrollPeriod.update({
        where: { id: periodId },
        data: { status: 'CALCULATING', calculationVersion: { increment: 1 } },
      });
      const result = await freezePayrollRuleSnapshot(transaction, {
        agencyId: home.agency.id,
        payrollPeriodId: periodId,
      });
      await afterFreeze(transaction);
      if (result.outcome === 'REFUSED') throw Object.assign(new Error(result.reason), result);
      return result;
    });

  beforeAll(async () => {
    admin = await createAdminClient();
    // Two people: an authorized input's approver is not its recorder.
    home = await createPayrollTenant(admin, suffix, 'SNAPSHOT', 2);
    foreign = await createPayrollTenant(admin, suffix, 'SNAPSHOT-FOREIGN');
    componentId = (await createPayComponent(admin, suffix)).id;
    // A tranche change on 2801-07-01; the second tranche ends with 2801.
    firstTranche = (await ruleVersion('TRANCHE-1', '2801-01-01', null)).id;
    secondTranche = (await ruleVersion('TRANCHE-2', '2801-07-01', '2801-12-31', firstTranche)).id;

    const recorder = home.persons[0]!.membership.id;
    inputComponentId = (
      await admin.payComponent.create({
        data: {
          code: `${FIXTURE_PREFIX}AUTHORIZED-INPUT-${suffix}`,
          name: 'Test component taking an authorized input',
          category: 'EARNING',
          isConditional: true,
          isGaaRevalidated: false,
          acceptsAuthorizedInput: true,
        },
      })
    ).id;
    employeeId = (
      await admin.employee.create({
        data: {
          agencyId: home.agency.id,
          employeeNumber: `EMP-SNAPSHOT-${suffix}`,
          legalName: 'Snapshot Employee',
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `snapshot-employee-${suffix}@example.test`,
          serviceStatus: 'ACTIVE',
          createdByMembershipId: recorder,
          updatedByMembershipId: recorder,
        },
      })
    ).id;
    const document = await admin.document.create({
      data: {
        agencyId: home.agency.id,
        documentType: 'AGENCY_ISSUANCE',
        classification: 'INTERNAL',
        status: 'APPROVED',
        createdByMembershipId: recorder,
      },
    });
    authorityId = (
      await admin.documentVersion.create({
        data: {
          agencyId: home.agency.id,
          documentId: document.id,
          versionNo: 1,
          storageKey: `payroll-snapshot/${suffix}`,
          contentHash: 'b'.repeat(64),
          mimeType: 'application/pdf',
          sizeBytes: 1,
          issuedAt: new Date(),
          createdByMembershipId: recorder,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const where = { agencyId: home.agency.id };
      await transaction.payrollRuleSnapshotItem.deleteMany({ where });
      await transaction.authorizedPayrollComponentInput.deleteMany({ where });
      await transaction.agencyPayrollApplicability.deleteMany({ where });
      await transaction.documentVersion.deleteMany({ where });
      await transaction.document.deleteMany({ where });
      await transaction.employee.deleteMany({ where });
    });
    await cleanupPayrollTenants(admin, [home, foreign]);
    await cleanupPlatformFixtures(admin, suffix);
    await admin.$disconnect();
  });

  it('references every rule version in effect, once per calculation version', async () => {
    const june = await service.create(home.persons[0]!.context, {
      code: 'REG-2801-06',
      runType: 'REGULAR',
      periodFrom: '2801-06-01',
      periodTo: '2801-06-30',
      cutoffAt: '2801-06-20T17:00:00+08:00',
      paymentDate: '2801-06-28',
    });
    await expect(startCalculation(june.id)).resolves.toMatchObject({
      outcome: 'FROZEN',
      calculationVersion: 1,
      nationalPayrollRuleVersionIds: [firstTranche],
    });

    // A period across the tranche change references both versions of the kind.
    const straddle = await special('SP-STRADDLE', '2801-06-15', '2801-07-15');
    const frozen = await startCalculation(straddle.id);
    expect(frozen.nationalPayrollRuleVersionIds).toEqual([firstTranche, secondTranche]);
    const snapshot = await admin.payrollRuleSnapshot.findUniqueOrThrow({
      where: { id: frozen.snapshotId },
      include: { items: true },
    });
    expect(snapshot).toMatchObject({
      agencyId: home.agency.id,
      payrollPeriodId: straddle.id,
      calculationVersion: 1,
      cutoffAt: new Date('2801-07-15T09:00:00Z'),
    });
    expect(snapshot.items.map((item) => item.nationalPayrollRuleVersionId).sort()).toEqual(
      [firstTranche, secondTranche].sort(),
    );

    // A returned calculation starts version 2 with its own snapshot; version 1 stays.
    await admin.payrollPeriod.update({ where: { id: straddle.id }, data: { status: 'DRAFT' } });
    await expect(startCalculation(straddle.id)).resolves.toMatchObject({ calculationVersion: 2 });
    await expect(
      admin.payrollRuleSnapshot.count({ where: { payrollPeriodId: straddle.id } }),
    ).resolves.toBe(2);
    // A second snapshot of one version is refused.
    await expect(
      withDatabaseContext(home.persons[0]!.scope, (transaction) =>
        freezePayrollRuleSnapshot(transaction, {
          agencyId: home.agency.id,
          payrollPeriodId: straddle.id,
        }),
      ),
    ).rejects.toThrow(/Unique constraint/);

    // Snapshots and items are immutable, and a frozen snapshot gains no items.
    await expect(
      admin.payrollRuleSnapshot.update({
        where: { id: frozen.snapshotId },
        data: { cutoffAt: new Date('2801-07-16T09:00:00Z') },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      admin.payrollRuleSnapshot.delete({ where: { id: frozen.snapshotId } }),
    ).rejects.toThrow(/immutable/);
    await expect(
      admin.payrollRuleSnapshotItem.updateMany({
        where: { payrollRuleSnapshotId: frozen.snapshotId },
        data: { nationalPayrollRuleVersionId: firstTranche },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      admin.payrollRuleSnapshotItem.deleteMany({
        where: { payrollRuleSnapshotId: frozen.snapshotId },
      }),
    ).rejects.toThrow(/immutable/);
    const later = await ruleVersion('LATE', '2803-01-01', '2803-01-31');
    await expect(
      admin.payrollRuleSnapshotItem.create({
        data: {
          agencyId: home.agency.id,
          payrollRuleSnapshotId: frozen.snapshotId,
          nationalPayrollRuleVersionId: later.id,
        },
      }),
    ).rejects.toThrow(/only in the transaction that takes it/);
  });

  /** An input as the record and approve services leave it. */
  const authorizedInput = async (
    effectiveFrom: string,
    effectiveTo: string | null,
    { approved = true, employee = false } = {},
  ) => {
    const row = await admin.authorizedPayrollComponentInput.create({
      data: {
        agencyId: home.agency.id,
        payComponentId: inputComponentId,
        scope: employee ? 'EMPLOYEE' : 'AGENCY',
        employeeId: employee ? employeeId : null,
        valueKind: 'AMOUNT',
        value: '100',
        paymentSchedule: 'EACH_REGULAR_PERIOD',
        authorityDocumentVersionId: authorityId,
        sourceReference: 'Test fixture, not an issuance',
        effectiveFrom: new Date(effectiveFrom),
        effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
        status: 'RECORDED',
        recordedByMembershipId: home.persons[0]!.membership.id,
      },
    });
    if (!approved) return row.id;
    await admin.authorizedPayrollComponentInput.update({
      where: { id: row.id },
      data: {
        status: 'APPROVED',
        approvedByMembershipId: home.persons[1]!.membership.id,
        approvedAt: new Date(),
      },
    });
    return row.id;
  };

  it('references every approved authorized input whose period overlaps the payroll period', async () => {
    // Overlapping on the first and on the last day, Agency-wide and Employee-scoped.
    const endsOnFirstDay = await authorizedInput('2801-04-01', '2801-05-01');
    const startsOnLastDay = await authorizedInput('2801-05-31', null, { employee: true });
    // Left out: outside the period, or not approved.
    await authorizedInput('2801-04-01', '2801-04-30');
    await authorizedInput('2801-06-01', null, { employee: true });
    await authorizedInput('2801-05-10', '2801-05-20', { approved: false });

    const may = await special('SP-AUTHORIZED-INPUTS', '2801-05-01', '2801-05-31');
    const frozen = await startCalculation(may.id);
    expect(frozen.nationalPayrollRuleVersionIds).toEqual([firstTranche]);
    expect([...frozen.authorizedPayrollComponentInputIds].sort()).toEqual(
      [endsOnFirstDay, startsOnLastDay].sort(),
    );
    const items = await admin.payrollRuleSnapshotItem.findMany({
      where: { payrollRuleSnapshotId: frozen.snapshotId },
    });
    expect(items).toHaveLength(3);
    expect(
      items
        .filter((item) => item.authorizedPayrollComponentInputId !== null)
        .map((item) => [item.authorizedPayrollComponentInputId, item.nationalPayrollRuleVersionId])
        .sort(),
    ).toEqual(
      [
        [endsOnFirstDay, null],
        [startsOnLastDay, null],
      ].sort(),
    );
  });

  it('references every applicability record whose period overlaps the payroll period', async () => {
    const applicability = async (
      effectiveFrom: string,
      effectiveTo: string | null,
      employee = false,
    ) =>
      (
        await admin.agencyPayrollApplicability.create({
          data: {
            agencyId: home.agency.id,
            payComponentId: inputComponentId,
            scope: employee ? 'EMPLOYEE' : 'AGENCY',
            employeeId: employee ? employeeId : null,
            authorityDocumentVersionId: authorityId,
            fundingReference: 'Test fixture, not an allotment',
            effectiveFrom: new Date(effectiveFrom),
            effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
            recordedByMembershipId: home.persons[0]!.membership.id,
          },
        })
      ).id;
    // Overlapping on the first and on the last day; the others fall outside.
    await applicability('2801-07-02', '2801-07-31');
    const onFirstDay = await applicability('2801-08-01', '2801-08-01');
    await applicability('2801-09-01', '2801-09-30');
    const fromLastDay = await applicability('2801-08-31', null, true);

    const august = await special('SP-APPLICABILITY', '2801-08-01', '2801-08-31');
    const frozen = await startCalculation(august.id);
    expect([...frozen.agencyPayrollApplicabilityIds].sort()).toEqual(
      [onFirstDay, fromLastDay].sort(),
    );
    const items = await admin.payrollRuleSnapshotItem.findMany({
      where: {
        payrollRuleSnapshotId: frozen.snapshotId,
        agencyPayrollApplicabilityId: { not: null },
      },
    });
    expect(items.map((item) => item.agencyPayrollApplicabilityId).sort()).toEqual(
      [onFirstDay, fromLastDay].sort(),
    );
  });

  it('refuses a missing or expired required rule and writes nothing', async () => {
    const expired = await special('SP-EXPIRED', '2801-12-20', '2802-01-10');
    await expect(startCalculation(expired.id)).rejects.toMatchObject({
      outcome: 'REFUSED',
      code: 'PAYROLL_RULE_NOT_IN_EFFECT',
      reason: `SALARY_SCHEDULE ${FIXTURE_PREFIX}TRANCHE-2-${suffix} ended on 2801-12-31, and no version is in effect on 2802-01-01.`,
    });
    const missing = await special('SP-MISSING', '2800-12-01', '2800-12-31');
    await expect(startCalculation(missing.id)).rejects.toMatchObject({
      code: 'PAYROLL_RULE_NOT_IN_EFFECT',
      reason: 'No SALARY_SCHEDULE version is in effect on 2800-12-01.',
    });
    // The refused start rolled back: no snapshot, still DRAFT at version 0.
    for (const { id } of [expired, missing]) {
      await expect(admin.payrollPeriod.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject(
        { status: 'DRAFT', calculationVersion: 0 },
      );
    }
    await expect(
      admin.payrollRuleSnapshot.count({
        where: { payrollPeriodId: { in: [expired.id, missing.id] } },
      }),
    ).resolves.toBe(0);
  });

  it('isolates snapshots by Agency and keeps period components to special drafts', async () => {
    const period = await special('SP-SNAPSHOT-RLS', '2801-03-01', '2801-03-31');
    const { snapshotId } = await startCalculation(period.id);
    const outsider = foreign.persons[0]!;

    await expect(
      withDatabaseContext(outsider.scope, (transaction) =>
        Promise.all([
          transaction.payrollRuleSnapshot.count({ where: { agencyId: home.agency.id } }),
          transaction.payrollRuleSnapshotItem.count({ where: { agencyId: home.agency.id } }),
        ]),
      ),
    ).resolves.toEqual([0, 0]);
    await expect(
      withDatabaseContext(outsider.scope, (transaction) =>
        freezePayrollRuleSnapshot(transaction, {
          agencyId: home.agency.id,
          payrollPeriodId: period.id,
        }),
      ),
    ).rejects.toThrow(/not in this Agency/);
    await expect(
      withDatabaseContext(outsider.scope, (transaction) =>
        transaction.payrollRuleSnapshotItem.create({
          data: {
            agencyId: home.agency.id,
            payrollRuleSnapshotId: snapshotId,
            nationalPayrollRuleVersionId: firstTranche,
          },
        }),
      ),
    ).rejects.toThrow();

    // A component joins only a DRAFT special period, and a special period
    // with no component cannot start calculating.
    await expect(
      admin.payrollPeriodComponent.create({
        data: { agencyId: home.agency.id, payrollPeriodId: period.id, payComponentId: componentId },
      }),
    ).rejects.toThrow(/Only a DRAFT special Payroll Period/);
    const bare = await admin.payrollPeriod.create({
      data: {
        agencyId: home.agency.id,
        code: 'SP-BARE',
        runType: 'SPECIAL',
        periodFrom: new Date('2801-03-01'),
        periodTo: new Date('2801-03-31'),
        cutoffAt: new Date('2801-03-20T09:00:00Z'),
        paymentDate: new Date('2801-03-28'),
        status: 'DRAFT',
      },
    });
    await expect(
      admin.payrollPeriod.update({
        where: { id: bare.id },
        data: { status: 'CALCULATING', calculationVersion: 1 },
      }),
    ).rejects.toThrow(/names a component before calculation/);
  });
});
