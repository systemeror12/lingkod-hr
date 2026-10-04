import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import {
  agencyProfileAuditWriter,
  AgencyProfileService,
  type AgencyProfileCorrectionInput,
  type AgencyProfileDraftInput,
} from './agency-profile.service';

const enabled = process.env.DATABASE_E2E === 'true';

function manilaDate(offsetDays = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

// Activation is prospective, so the identity change takes effect after today.
const activationDate = manilaDate(30);
const supersededThrough = manilaDate(29);

const draftInput: AgencyProfileDraftInput = {
  officialName: 'Department of Public Service and Digital Innovation',
  acronym: 'DPSDI',
  agencyType: 'NGA',
  parentOrganization: 'Office of the President',
  reportingIdentifiers: 'UACS 240010000 · CSC 04-118 · DBM 26-041',
  appointingAuthorityTitle: 'Secretary',
  defaultTimezone: 'Asia/Manila',
  defaultCurrency: 'PHP',
  effectiveFrom: activationDate,
};

function context(
  agencyId: string,
  userId: string,
  membershipId: string,
  permissions: RequestContext['permissions'] = [
    { code: 'organization.agency.read', scopePolicy: 'AGENCY' },
    { code: 'organization.agency.update', scopePolicy: 'AGENCY' },
  ],
): RequestContext {
  return {
    requestId: `agency-profile-${Date.now()}`,
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions,
  };
}

async function createAdminClient(): Promise<PrismaClient> {
  const databaseUrl = process.env.DATABASE_E2E_ADMIN_URL;
  if (!databaseUrl) throw new Error('DATABASE_E2E_ADMIN_URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

async function cleanup(admin: PrismaClient, agencyId: string, userId: string): Promise<void> {
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.agency.update({
      where: { id: agencyId },
      data: { currentProfileVersionId: null },
    });
    await transaction.auditEvent.deleteMany({ where: { agencyId } });
    await transaction.agencyProfileVersion.deleteMany({ where: { agencyId } });
  });
  await admin.agencyMembership.deleteMany({ where: { agencyId } });
  await admin.agency.delete({ where: { id: agencyId } });
  await admin.user.delete({ where: { id: userId } });
}

async function seedProfile(admin: PrismaClient, agencyId: string, name: string) {
  const profile = await admin.agencyProfileVersion.create({
    data: {
      agencyId,
      versionNo: 1,
      officialName: name,
      acronym: 'DPSI',
      agencyType: 'NGA',
      parentOrganization: 'Office of the President',
      reportingIdentifiers: 'UACS 240010000',
      appointingAuthorityTitle: 'Secretary',
      defaultTimezone: 'Asia/Manila',
      defaultCurrency: 'PHP',
      deploymentProfile: 'SHARED_SAAS',
      effectiveFrom: new Date('2024-01-01T00:00:00.000Z'),
      status: 'ACTIVE',
      domainStatus: 'ACTIVE',
    },
  });
  await admin.agency.update({
    where: { id: agencyId },
    data: {
      currentProfileVersionId: profile.id,
      name,
      acronym: 'DPSI',
      defaultTimezone: 'Asia/Manila',
      defaultCurrency: 'PHP',
    },
  });
  return profile;
}

it('rechecks Agency Profile permissions at the service boundary', async () => {
  const service = new AgencyProfileService(agencyProfileAuditWriter);
  const denied = context(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    [],
  );

  await expect(service.list(denied)).rejects.toMatchObject({
    code: 'AGENCY_PROFILE_READ_FORBIDDEN',
    statusCode: 403,
  });
  await expect(service.createDraft(denied)).rejects.toMatchObject({
    code: 'AGENCY_PROFILE_UPDATE_FORBIDDEN',
    statusCode: 403,
  });
});

it.skipIf(!enabled)(
  'edits one Draft, activates it atomically, and resolves as-of history',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}`;
    const agency = await admin.agency.create({
      data: {
        code: `PROFILE-E2E-${suffix}`,
        name: 'Department of Public Service Innovation',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        emailNormalized: `profile-user-${suffix}@example.test`,
        displayName: 'Agency Profile User',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const initial = await seedProfile(admin, agency.id, agency.name);
    const requestContext = context(agency.id, user.id, membership.id);
    const service = new AgencyProfileService(agencyProfileAuditWriter);
    const expectedDraftEffectiveFrom = manilaDate(1);

    try {
      const draft = await service.createDraft(requestContext);
      expect(draft).toMatchObject({
        versionNo: 2,
        versionState: 'DRAFT',
        officialName: initial.officialName,
        effectiveFrom: expectedDraftEffectiveFrom,
      });
      await expect(service.createDraft(requestContext)).resolves.toMatchObject({ id: draft.id });

      const updated = await service.updateDraft(requestContext, draft.id, draftInput);
      expect(updated).toMatchObject({
        id: draft.id,
        versionState: 'DRAFT',
        officialName: draftInput.officialName,
        acronym: draftInput.acronym,
        effectiveFrom: draftInput.effectiveFrom,
      });

      await expect(
        service.activate(
          requestContext,
          draft.id,
          '2024-01-01',
          'This effectivity overlaps the existing profile.',
        ),
      ).rejects.toMatchObject({
        code: 'AGENCY_PROFILE_EFFECTIVE_DATE_INVALID',
        statusCode: 409,
      });

      const activated = await service.activate(
        requestContext,
        draft.id,
        draftInput.effectiveFrom,
        'Approved prospective identity change.',
      );
      expect(activated).toMatchObject({
        id: draft.id,
        versionState: 'ACTIVE',
        officialName: draftInput.officialName,
        effectiveFrom: draftInput.effectiveFrom,
      });

      await expect(
        admin.agencyProfileVersion.update({
          where: { id: initial.id },
          data: { officialName: 'Illicit rewrite' },
        }),
      ).rejects.toThrow(/immutable/i);
      await expect(
        admin.agencyProfileVersion.findUniqueOrThrow({ where: { id: initial.id } }),
      ).resolves.toMatchObject({
        status: 'SUPERSEDED',
        effectiveTo: new Date(`${supersededThrough}T00:00:00.000Z`),
      });
      await expect(
        admin.agency.findUniqueOrThrow({ where: { id: agency.id } }),
      ).resolves.toMatchObject({
        currentProfileVersionId: initial.id,
        name: initial.officialName,
        defaultCurrency: draftInput.defaultCurrency,
      });

      await expect(service.list(requestContext, supersededThrough)).resolves.toMatchObject({
        current: { id: initial.id, versionState: 'SUPERSEDED' },
        draft: null,
      });
      await expect(service.list(requestContext, activationDate)).resolves.toMatchObject({
        current: { id: draft.id, versionState: 'ACTIVE' },
      });

      const audit = await admin.auditEvent.findFirstOrThrow({
        where: { agencyId: agency.id, action: 'AGENCY_PROFILE_ACTIVATED' },
      });
      expect(audit).toMatchObject({
        entityId: draft.id,
        previousStatus: 'DRAFT',
        newStatus: 'ACTIVE',
        reason: 'Approved prospective identity change.',
        actorUserId: user.id,
        actorMembershipId: membership.id,
      });
    } finally {
      await cleanup(admin, agency.id, user.id);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)('voids an active version and creates a reasoned replacement', async () => {
  const admin = await createAdminClient();
  const suffix = `${Date.now()}-correction`;
  const agency = await admin.agency.create({
    data: {
      code: `PROFILE-CORRECTION-${suffix}`,
      name: 'Public Service Innovation Office',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      emailNormalized: `correction-user-${suffix}@example.test`,
      displayName: 'Correction User',
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const initial = await seedProfile(admin, agency.id, agency.name);
  const requestContext = context(agency.id, user.id, membership.id);
  const correction: AgencyProfileCorrectionInput = {
    ...draftInput,
    officialName: 'Public Service Innovation Office',
    acronym: 'PSIO',
    reason: 'Corrected the official name entered during provisioning.',
  };
  const service = new AgencyProfileService(agencyProfileAuditWriter);

  try {
    const replacement = await service.correct(requestContext, initial.id, correction);
    expect(replacement).toMatchObject({
      versionNo: 2,
      versionState: 'ACTIVE',
      officialName: correction.officialName,
      effectiveFrom: '2024-01-01',
    });
    await expect(
      admin.agencyProfileVersion.findUniqueOrThrow({ where: { id: initial.id } }),
    ).resolves.toMatchObject({ status: 'VOIDED' });
    await expect(
      admin.auditEvent.findFirstOrThrow({
        where: { agencyId: agency.id, action: 'AGENCY_PROFILE_CORRECTED' },
      }),
    ).resolves.toMatchObject({
      entityId: replacement.id,
      reason: correction.reason,
    });
  } finally {
    await cleanup(admin, agency.id, user.id);
    await admin.$disconnect();
  }
});

it.skipIf(!enabled)('voids and replaces a superseded historical version', async () => {
  const admin = await createAdminClient();
  const suffix = `${Date.now()}-historical-correction`;
  const agency = await admin.agency.create({
    data: {
      code: `PROFILE-HISTORICAL-${suffix}`,
      name: 'Historical Public Service Office',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      emailNormalized: `historical-user-${suffix}@example.test`,
      displayName: 'Historical Correction User',
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const initial = await seedProfile(admin, agency.id, agency.name);
  const requestContext = context(agency.id, user.id, membership.id);
  const service = new AgencyProfileService(agencyProfileAuditWriter);

  try {
    const draft = await service.createDraft(requestContext);
    await service.updateDraft(requestContext, draft.id, draftInput);
    await service.activate(
      requestContext,
      draft.id,
      draftInput.effectiveFrom,
      'Approved prospective identity change.',
    );

    const replacement = await service.correct(requestContext, initial.id, {
      ...draftInput,
      officialName: 'Corrected Historical Public Service Office',
      reason: 'Corrected the historical official name after activation.',
    });

    expect(replacement).toMatchObject({
      versionNo: 3,
      versionState: 'SUPERSEDED',
      effectiveFrom: '2024-01-01',
      effectiveTo: supersededThrough,
    });
    await expect(
      admin.agencyProfileVersion.findUniqueOrThrow({ where: { id: initial.id } }),
    ).resolves.toMatchObject({ status: 'VOIDED' });
    await expect(
      admin.agency.findUniqueOrThrow({ where: { id: agency.id } }),
    ).resolves.toMatchObject({ currentProfileVersionId: replacement.id });
  } finally {
    await cleanup(admin, agency.id, user.id);
    await admin.$disconnect();
  }
});
