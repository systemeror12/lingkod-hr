import { PrismaClient } from '@prisma/client';

const issuer = process.env.OIDC_ISSUER ?? 'http://127.0.0.1:4100';
const databaseUrl =
  process.env.DATABASE_E2E_ADMIN_URL ??
  process.env.DATABASE_MIGRATION_OWNER_URL ??
  'postgresql://hris_local:local_only@localhost:55432/hris';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const foreignAgencyId = '11111111-1111-4111-8111-111111111111';
const foreignUnitId = '22222222-2222-4222-8222-222222222222';
const foreignUnitVersionId = '33333333-3333-4333-8333-333333333333';
const foreignAuditEventId = '44444444-4444-4444-8444-444444444444';

async function seed(): Promise<void> {
  const agency = await prisma.agency.upsert({
    where: { code: 'E2E-WORK-QUEUE' },
    update: {
      name: 'National Archives Coordination Office',
      acronym: 'NACO',
      status: 'ACTIVE',
    },
    create: {
      code: 'E2E-WORK-QUEUE',
      name: 'National Archives Coordination Office',
      acronym: 'NACO',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  await prisma.invitation.deleteMany({
    where: { agencyId: agency.id, status: 'PENDING' },
  });
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.auditEvent.deleteMany({
      where: { agencyId: agency.id, action: 'ORGANIZATION_UNIT_CREATED' },
    });
    await transaction.organizationUnitVersion.deleteMany({ where: { agencyId: agency.id } });
    await transaction.organizationUnit.deleteMany({ where: { agencyId: agency.id } });
  });
  const user = await prisma.user.upsert({
    where: { emailNormalized: 'marisol.santos@example.test' },
    update: {
      identityProvider: issuer,
      externalSubject: 'local-work-queue-user',
      displayName: 'Marisol Santos',
      globalStatus: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
    create: {
      identityProvider: issuer,
      externalSubject: 'local-work-queue-user',
      emailNormalized: 'marisol.santos@example.test',
      displayName: 'Marisol Santos',
      globalStatus: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const membership =
    (await prisma.agencyMembership.findFirst({
      where: { agencyId: agency.id, userId: user.id },
    })) ??
    (await prisma.agencyMembership.create({
      data: {
        agencyId: agency.id,
        userId: user.id,
        status: 'ACTIVE',
        activatedAt: new Date(),
      },
    }));
  if (membership.status !== 'ACTIVE') {
    await prisma.agencyMembership.update({
      where: { id: membership.id },
      data: { status: 'ACTIVE', activatedAt: new Date(), deactivatedAt: null },
    });
  }
  const role = await prisma.role.findFirstOrThrow({
    where: { agencyId: null, code: 'agency_administrator', status: 'ACTIVE' },
  });
  const assignment = await prisma.membershipRole.findFirst({
    where: { agencyId: agency.id, membershipId: membership.id, roleId: role.id },
  });
  if (!assignment) {
    await prisma.membershipRole.create({
      data: {
        agencyId: agency.id,
        membershipId: membership.id,
        roleId: role.id,
        effectiveFrom: new Date(),
        assignedByMembershipId: membership.id,
        reason: 'Protected shell E2E fixture',
      },
    });
  }

  const foreignAgency = await prisma.agency.upsert({
    where: { id: foreignAgencyId },
    update: {
      code: 'E2E-FOREIGN-RECORDS',
      name: 'Synthetic Foreign Records Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
    create: {
      id: foreignAgencyId,
      code: 'E2E-FOREIGN-RECORDS',
      name: 'Synthetic Foreign Records Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.auditEvent.deleteMany({ where: { agencyId: foreignAgency.id } });
    await transaction.organizationUnitVersion.deleteMany({ where: { agencyId: foreignAgency.id } });
    await transaction.organizationUnit.deleteMany({ where: { agencyId: foreignAgency.id } });
    await transaction.organizationUnit.create({
      data: {
        id: foreignUnitId,
        agencyId: foreignAgency.id,
        code: 'FOREIGN-RECORD',
        unitType: 'OFFICE',
        status: 'DRAFT',
      },
    });
    await transaction.organizationUnitVersion.create({
      data: {
        id: foreignUnitVersionId,
        agencyId: foreignAgency.id,
        organizationUnitId: foreignUnitId,
        versionNo: 1,
        name: 'Synthetic Foreign Records Office',
        effectiveFrom: new Date('2026-08-16'),
        status: 'DRAFT',
      },
    });
    await transaction.organizationUnit.update({
      where: { id: foreignUnitId },
      data: { currentVersionId: foreignUnitVersionId },
    });
    await transaction.auditEvent.create({
      data: {
        id: foreignAuditEventId,
        agencyId: foreignAgency.id,
        actorType: 'SYSTEM',
        action: 'ORGANIZATION_UNIT_CREATED',
        entityType: 'OrganizationUnit',
        entityId: foreignUnitId,
        previousStatus: 'None',
        newStatus: 'DRAFT',
        metadata: {
          officialName: 'Synthetic Foreign Records Office',
          code: 'FOREIGN-RECORD',
          unitType: 'OFFICE',
          effectiveDate: '2026-08-16',
        },
      },
    });
  });
}

seed()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
