import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import { employeeAuditWriter, EmployeesService } from './employees.service';

const enabled = process.env.DATABASE_E2E === 'true';

function createContext(agencyId: string, userId: string, membershipId: string): RequestContext {
  return {
    requestId: 'employee-integration-test',
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions: [
      { code: 'personnel.employees.read', scopePolicy: 'AGENCY' },
      { code: 'personnel.employees.create', scopePolicy: 'AGENCY' },
      { code: 'personnel.employees.update', scopePolicy: 'AGENCY' },
    ],
  };
}

async function createAdminClient(): Promise<PrismaClient> {
  const databaseUrl =
    process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!databaseUrl) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

it.skipIf(!enabled)(
  'creates Employees, enforces Agency identity, and controls Membership links atomically',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-employee-integration`;
    const agency = await admin.agency.create({
      data: {
        code: `EMP-${suffix}`,
        name: 'Employee Integration Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const foreignAgency = await admin.agency.create({
      data: {
        code: `EMP-F-${suffix}`,
        name: 'Employee Integration Foreign Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        identityProvider: 'employee-integration',
        externalSubject: `employee-${suffix}`,
        emailNormalized: `employee-${suffix}@example.test`,
        displayName: 'Employee Integration User',
        globalStatus: 'ACTIVE',
      },
    });
    const linkUser = await admin.user.create({
      data: {
        identityProvider: 'employee-integration',
        externalSubject: `employee-link-${suffix}`,
        emailNormalized: `employee-link-${suffix}@example.test`,
        displayName: 'Employee Integration Link User',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const linkMembership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: linkUser.id, status: 'ACTIVE' },
    });
    const foreignMembership = await admin.agencyMembership.create({
      data: { agencyId: foreignAgency.id, userId: user.id, status: 'ACTIVE' },
    });
    const context = createContext(agency.id, user.id, membership.id);
    const service = new EmployeesService(employeeAuditWriter);

    const foreign = await admin.employee.create({
      data: {
        agencyId: foreignAgency.id,
        employeeNumber: `FOREIGN-${suffix}`,
        legalName: 'Foreign Employee',
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: 'foreign@example.test',
        createdByMembershipId: foreignMembership.id,
        updatedByMembershipId: foreignMembership.id,
      },
    });

    const input = {
      employeeNumber: `EMP-${suffix}`,
      legalName: 'Mara Villanueva Santos',
      birthDate: '1994-05-12',
      sex: 'FEMALE',
      civilStatus: 'SINGLE',
      contactEmail: 'mara.santos@example.test',
    };

    try {
      const created = await service.create(context, input);
      expect(created).toMatchObject({
        employeeNumber: `EMP-${suffix}`,
        serviceStatus: 'PREBOARDING',
        membershipId: null,
      });

      await expect(service.create(context, input)).rejects.toMatchObject({
        code: 'EMPLOYEE_NUMBER_CONFLICT',
      });
      await expect(
        service.create(context, { ...input, employeeNumber: `OTHER-${suffix}` }),
      ).rejects.toMatchObject({ code: 'EMPLOYEE_IDENTITY_CONFLICT' });

      const list = await service.list(context);
      expect(list).toHaveLength(1);

      const detail = await service.findById(context, created.id);
      expect(detail?.linkableMemberships.map(({ id }) => id)).toContain(linkMembership.id);

      const linked = await service.linkMembership(context, created.id, linkMembership.id);
      expect(linked.membershipId).toBe(linkMembership.id);
      await expect(
        service.findOwn({
          ...context,
          userId: linkUser.id,
          membershipId: linkMembership.id,
          permissions: [{ code: 'personnel.documents.read', scopePolicy: 'OWN' }],
        }),
      ).resolves.toMatchObject({ id: created.id });
      await expect(
        admin.auditEvent.findFirst({
          where: {
            agencyId: agency.id,
            entityId: created.id,
            action: 'EMPLOYEE_MEMBERSHIP_LINKED',
          },
          select: { metadata: true },
        }),
      ).resolves.toMatchObject({ metadata: { membershipId: linkMembership.id } });

      await expect(
        service.linkMembership(context, created.id, membership.id),
      ).rejects.toMatchObject({ code: 'EMPLOYEE_MEMBERSHIP_CONFLICT' });

      const unlinked = await service.unlinkMembership(context, created.id);
      expect(unlinked.membershipId).toBeNull();
      await expect(
        admin.auditEvent.findFirst({
          where: {
            agencyId: agency.id,
            entityId: created.id,
            action: 'EMPLOYEE_MEMBERSHIP_UNLINKED',
          },
          select: { metadata: true },
        }),
      ).resolves.toMatchObject({ metadata: { membershipId: linkMembership.id } });

      await expect(service.unlinkMembership(context, created.id)).rejects.toMatchObject({
        code: 'EMPLOYEE_MEMBERSHIP_NOT_LINKED',
      });

      await expect(service.findById(context, foreign.id)).resolves.toBeNull();
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.auditEvent.deleteMany({
          where: { agencyId: { in: [agency.id, foreignAgency.id] } },
        });
        await transaction.agencyMembership.deleteMany({
          where: { agencyId: { in: [agency.id, foreignAgency.id] } },
        });
        await transaction.employee.deleteMany({
          where: { agencyId: { in: [agency.id, foreignAgency.id] } },
        });
      });
      await admin.agency.deleteMany({ where: { id: { in: [agency.id, foreignAgency.id] } } });
      await admin.user.delete({ where: { id: user.id } });
      await admin.user.delete({ where: { id: linkUser.id } });
      await admin.$disconnect();
    }
  },
);
