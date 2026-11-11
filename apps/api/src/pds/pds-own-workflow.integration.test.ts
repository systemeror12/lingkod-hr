import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import { pdsAuditWriter, PdsService } from './pds.service';

const enabled = process.env.DATABASE_E2E === 'true';

function context(
  agencyId: string,
  userId: string,
  membershipId: string,
  permissions: RequestContext['permissions'],
): RequestContext {
  return {
    requestId: `pds-own-${Date.now()}`,
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions,
  };
}

const ownGrants: RequestContext['permissions'] = [
  { code: 'personnel.pds.read', scopePolicy: 'OWN' },
  { code: 'personnel.pds.update', scopePolicy: 'OWN' },
  { code: 'personnel.pds.certify', scopePolicy: 'OWN' },
];
const agencyGrants: RequestContext['permissions'] = [
  { code: 'personnel.pds.read', scopePolicy: 'AGENCY' },
  { code: 'personnel.pds.update', scopePolicy: 'AGENCY' },
  { code: 'personnel.pds.certify', scopePolicy: 'AGENCY' },
];

it.skipIf(!enabled)(
  'matches the own PDS by the acting membership Employee for submit and certify',
  async () => {
    const url = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
    if (!url) throw new Error('A database owner URL is required for the integration test.');
    const admin = new PrismaClient({ datasources: { db: { url } } });
    const suffix = `${Date.now()}-pds-own`;
    const agency = await admin.agency.create({
      data: { code: `PDSO-${suffix}`, name: 'PDS Own Agency', agencyType: 'NGA', status: 'ACTIVE' },
    });
    const [user, otherUser] = await Promise.all(
      ['owner', 'other'].map((name) =>
        admin.user.create({
          data: {
            emailNormalized: `pds-own-${name}-${suffix}@example.test`,
            displayName: `PDS Own ${name}`,
            globalStatus: 'ACTIVE',
          },
        }),
      ),
    );
    if (!user || !otherUser) throw new Error('Users were not created.');
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const otherMembership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: otherUser.id, status: 'ACTIVE' },
    });
    const employee = await admin.employee.create({
      data: {
        agencyId: agency.id,
        employeeNumber: `PDSO-${suffix}`,
        legalName: 'PDS Own Employee',
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: user.emailNormalized,
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT set_config('app.employee_membership_link', 'on', true)
      `;
      await transaction.agencyMembership.update({
        where: { id: membership.id },
        data: { employeeId: employee.id },
      });
    });

    const pds = new PdsService(pdsAuditWriter, undefined as never);
    const owner = context(agency.id, user.id, membership.id, ownGrants);
    const ownerWithAgencyGrants = context(agency.id, user.id, membership.id, agencyGrants);
    const other = context(agency.id, otherUser.id, otherMembership.id, ownGrants);
    const otherWithAgencyGrants = context(
      agency.id,
      otherUser.id,
      otherMembership.id,
      agencyGrants,
    );
    try {
      const draft = await pds.create(owner, {});
      expect(draft.employeeId).toBe(employee.id);
      expect(await pds.listOwn(owner)).toMatchObject({ employeeId: employee.id });

      // Own PDS with OWN grants passes the submit and certify rule.
      await expect(pds.submit(owner, draft.id)).rejects.toMatchObject({
        code: 'PDS_COMPLETENESS_FAILED',
      });
      await expect(
        pds.certify(owner, draft.id, { employeeCertificationAccepted: true }),
      ).rejects.toMatchObject({ code: 'PDS_TRANSITION_INVALID' });

      // Outside the OWN update scope, the PDS is not found.
      await expect(pds.submit(other, draft.id)).rejects.toMatchObject({
        code: 'PDS_NOT_FOUND',
        statusCode: 404,
      });
      expect(await pds.findById(other, draft.id)).toBeNull();

      // Agency-wide grants reach the PDS but do not submit or certify it.
      await expect(pds.submit(ownerWithAgencyGrants, draft.id)).rejects.toMatchObject({
        code: 'PDS_SUBMIT_FORBIDDEN',
        statusCode: 403,
      });
      await expect(pds.submit(otherWithAgencyGrants, draft.id)).rejects.toMatchObject({
        code: 'PDS_SUBMIT_FORBIDDEN',
        statusCode: 403,
      });
      await expect(
        pds.certify(ownerWithAgencyGrants, draft.id, { employeeCertificationAccepted: true }),
      ).rejects.toMatchObject({ code: 'PDS_CERTIFY_FORBIDDEN', statusCode: 403 });
      await expect(
        pds.certify(other, draft.id, { employeeCertificationAccepted: true }),
      ).rejects.toMatchObject({ code: 'PDS_CERTIFY_FORBIDDEN', statusCode: 403 });
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.pdsPersonalDetails.deleteMany({ where: { agencyId: agency.id } });
        await transaction.pdsVersion.deleteMany({ where: { agencyId: agency.id } });
        await transaction.auditEvent.deleteMany({ where: { agencyId: agency.id } });
        await transaction.employee.deleteMany({ where: { agencyId: agency.id } });
        await transaction.agencyMembership.deleteMany({ where: { agencyId: agency.id } });
        await transaction.agency.delete({ where: { id: agency.id } });
        await transaction.user.deleteMany({ where: { id: { in: [user.id, otherUser.id] } } });
      });
      await admin.$disconnect();
    }
  },
);
