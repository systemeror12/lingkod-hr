import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';

/** Test fixtures only: codes carry this prefix so cleanup removes exactly them. */
export const FIXTURE_PREFIX = 'TEST-333-';

export async function createAdminClient(): Promise<PrismaClient> {
  const databaseUrl =
    process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!databaseUrl) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

/** An Agency of its own with `people` active memberships, so parallel tests never share rows. */
export async function createPayrollTenant(
  admin: PrismaClient,
  suffix: string,
  label: string,
  people = 1,
) {
  const agency = await admin.agency.create({
    data: {
      code: `${FIXTURE_PREFIX}${label}-${suffix}`,
      name: `Payroll Period ${label} Agency`,
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const persons = [];
  for (let index = 0; index < people; index += 1) {
    const user = await admin.user.create({
      data: {
        emailNormalized: `payroll-period-${label}-${index}-${suffix}@example.test`.toLowerCase(),
        displayName: `Payroll Period ${label} User ${index}`,
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const scope = { agencyId: agency.id, userId: user.id, membershipId: membership.id };
    const context: RequestContext = {
      requestId: `payroll-periods-${label}-${index}`,
      ...scope,
      primaryOrganizationUnitId: null,
      permissions: [{ code: 'payroll.periods.create', scopePolicy: 'AGENCY' }],
    };
    persons.push({ user, membership, scope, context });
  }
  return { agency, persons };
}

export type PayrollTenant = Awaited<ReturnType<typeof createPayrollTenant>>;

export async function cleanupPayrollTenants(admin: PrismaClient, tenants: PayrollTenant[]) {
  await admin.$transaction(async (transaction) => {
    // The immutability triggers are the point of the tables; only the test lifts them.
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    for (const { agency, persons } of tenants) {
      const where = { agencyId: agency.id };
      await transaction.payrollLineSource.deleteMany({ where });
      await transaction.payrollLine.deleteMany({ where });
      await transaction.contributionLine.deleteMany({ where });
      await transaction.payrollException.deleteMany({ where });
      await transaction.payrollEmployee.deleteMany({ where });
      await transaction.contributionBilling.deleteMany({ where });
      await transaction.payrollRuleSnapshotItem.deleteMany({ where });
      await transaction.payrollRuleSnapshot.deleteMany({ where });
      await transaction.payrollCertification.deleteMany({ where });
      await transaction.payrollPeriodActor.deleteMany({ where });
      await transaction.payrollPeriodComponent.deleteMany({ where });
      await transaction.payrollPeriod.deleteMany({ where });
      await transaction.auditEvent.deleteMany({ where });
      await transaction.agencyMembership.deleteMany({ where });
      await transaction.agency.delete({ where: { id: agency.id } });
      await transaction.user.deleteMany({
        where: { id: { in: persons.map((person) => person.user.id) } },
      });
    }
  });
}

/** A platform-wide pay component fixture; the cleanup removes it by its code. */
export function createPayComponent(admin: PrismaClient, suffix: string) {
  return admin.payComponent.create({
    data: {
      code: `${FIXTURE_PREFIX}COMPONENT-${suffix}`,
      name: 'Test component, not a catalogue entry',
      category: 'EARNING',
      isConditional: true,
      isGaaRevalidated: false,
      acceptsAuthorizedInput: false,
    },
  });
}

/** Removes the platform-wide fixtures whose codes end in this run's suffix. */
export async function cleanupPlatformFixtures(admin: PrismaClient, suffix: string) {
  const pattern = `${FIXTURE_PREFIX}%-${suffix}`;
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.$executeRaw`DELETE FROM pay_components WHERE code LIKE ${pattern}`;
    await transaction.$executeRaw`DELETE FROM national_payroll_rule_versions WHERE code LIKE ${pattern}`;
  });
}
