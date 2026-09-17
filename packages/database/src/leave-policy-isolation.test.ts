import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

interface ContextValues {
  agencyId: string;
  userId: string;
  membershipId: string;
  transition?: boolean;
}

async function withContext<T>(
  client: PrismaClient,
  values: ContextValues,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      "SELECT set_config('app.agency_id', '" +
        values.agencyId +
        "', true), set_config('app.user_id', '" +
        values.userId +
        "', true), set_config('app.membership_id', '" +
        values.membershipId +
        "', true), set_config('app.leave_policy_transition', '" +
        (values.transition ? 'on' : 'off') +
        "', true)",
    );
    return work(transaction);
  });
}

async function adminClient(): Promise<PrismaClient> {
  const url = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!url) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url } } });
}

it.skipIf(!enabled)('isolates Leave Types and guards Leave Policy Version state', async () => {
  const runtimeUrl = process.env.DATABASE_URL;
  if (!runtimeUrl) throw new Error('DATABASE_URL is required for the integration test.');
  const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
  const admin = await adminClient();
  const suffix = String(Date.now()) + '-leave-policy';
  const agencies = await Promise.all(
    ['A', 'B'].map((label) =>
      admin.agency.create({
        data: {
          code: 'LV-RLS-' + label + '-' + suffix,
          name: 'Leave Policy RLS ' + label,
          agencyType: 'NGA',
          status: 'ACTIVE',
        },
      }),
    ),
  );
  const user = await admin.user.create({
    data: {
      identityProvider: 'leave-policy-rls-e2e',
      externalSubject: 'leave-policy-' + suffix,
      emailNormalized: 'leave-policy-' + suffix + '@example.test',
      displayName: 'Leave Policy RLS User',
      globalStatus: 'ACTIVE',
    },
  });
  const memberships = await Promise.all(
    agencies.map(({ id }) =>
      admin.agencyMembership.create({
        data: { agencyId: id, userId: user.id, status: 'ACTIVE' },
      }),
    ),
  );
  const agencyA = agencies[0];
  const agencyB = agencies[1];
  const membershipA = memberships[0];
  const membershipB = memberships[1];
  if (!agencyA || !agencyB || !membershipA || !membershipB) {
    throw new Error('Leave Policy fixtures were not created.');
  }
  const agencyIds = [agencyA.id, agencyB.id];
  const contextA = { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id };
  const capabilitiesA = { ...contextA, transition: true };

  const leaveTypeB = await admin.leaveType.create({
    data: {
      agencyId: agencyB.id,
      code: 'VACATION_LEAVE',
      name: 'Foreign Vacation Leave',
      status: 'ACTIVE',
      createdByMembershipId: membershipB.id,
      updatedByMembershipId: membershipB.id,
    },
  });

  try {
    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.leaveType.findMany({ where: { id: leaveTypeB.id } }),
      ),
    ).resolves.toHaveLength(0);

    const leaveTypeA = await withContext(app, contextA, (transaction) =>
      transaction.leaveType.create({
        data: {
          agencyId: agencyA.id,
          code: 'VACATION_LEAVE',
          name: 'Vacation Leave',
          status: 'ACTIVE',
          createdByMembershipId: membershipA.id,
          updatedByMembershipId: membershipA.id,
        },
      }),
    );

    const renamed = await withContext(app, contextA, (transaction) =>
      transaction.leaveType.update({
        where: { agencyId_id: { agencyId: agencyA.id, id: leaveTypeA.id } },
        data: { name: 'Vacation Leave (Agency)', updatedByMembershipId: membershipA.id },
      }),
    );
    expect(renamed.name).toBe('Vacation Leave (Agency)');

    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.leaveType.update({
          where: { agencyId_id: { agencyId: agencyA.id, id: leaveTypeA.id } },
          data: { status: 'INACTIVE', updatedByMembershipId: membershipA.id },
        }),
      ),
    ).rejects.toThrow(/application service/i);

    const deactivated = await withContext(app, capabilitiesA, (transaction) =>
      transaction.leaveType.update({
        where: { agencyId_id: { agencyId: agencyA.id, id: leaveTypeA.id } },
        data: { status: 'INACTIVE', updatedByMembershipId: membershipA.id },
      }),
    );
    expect(deactivated.status).toBe('INACTIVE');

    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.leaveType.delete({
          where: { agencyId_id: { agencyId: agencyA.id, id: leaveTypeA.id } },
        }),
      ),
    ).rejects.toThrow(/permission denied|retained/i);

    const draft = await withContext(app, contextA, (transaction) =>
      transaction.leavePolicyVersion.create({
        data: {
          agencyId: agencyA.id,
          leaveTypeId: leaveTypeA.id,
          versionNo: 1,
          entitlementBasis: 'ACCRUED_ACCOUNT',
          calendarBasis: 'WORKING_DAY',
          approvalRouteCode: 'LEAVE-ROUTE-1',
          evaluatorKind: 'SERVICE_ACCRUAL',
          ruleParameters: { earnDays: 1, perServiceDays: 24, annualCreditDays: 15 },
          applicabilityRules: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
          documentRequirements: { required: ['SIGNED_LEAVE_APPLICATION_FORM'], additional: [] },
          effectiveFrom: new Date('2026-01-01'),
          status: 'DRAFT',
          createdByMembershipId: membershipA.id,
          updatedByMembershipId: membershipA.id,
        },
      }),
    );
    expect(draft.status).toBe('DRAFT');

    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.leavePolicyVersion.create({
          data: {
            agencyId: agencyA.id,
            leaveTypeId: leaveTypeA.id,
            versionNo: 2,
            entitlementBasis: 'ACCRUED_ACCOUNT',
            calendarBasis: 'WORKING_DAY',
            approvalRouteCode: 'LEAVE-ROUTE-1',
            evaluatorKind: 'SERVICE_ACCRUAL',
            ruleParameters: { earnDays: 1, perServiceDays: 24, annualCreditDays: 15 },
            applicabilityRules: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
            documentRequirements: { required: ['SIGNED_LEAVE_APPLICATION_FORM'], additional: [] },
            effectiveFrom: new Date('2026-02-01'),
            status: 'DRAFT',
            createdByMembershipId: membershipA.id,
            updatedByMembershipId: membershipA.id,
          },
        }),
      ),
    ).rejects.toThrow(/unique|draft/i);

    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.leavePolicyVersion.update({
          where: { agencyId_id: { agencyId: agencyA.id, id: draft.id } },
          data: { status: 'ACTIVE', updatedByMembershipId: membershipA.id },
        }),
      ),
    ).rejects.toThrow(/application service/i);

    await expect(
      withContext(app, capabilitiesA, (transaction) =>
        transaction.leavePolicyVersion.update({
          where: { agencyId_id: { agencyId: agencyA.id, id: draft.id } },
          data: { status: 'ACTIVE', updatedByMembershipId: membershipA.id },
        }),
      ),
    ).rejects.toThrow(/national rule authority/i);

    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.leavePolicyVersion.update({
          where: { agencyId_id: { agencyId: agencyA.id, id: draft.id } },
          data: { ruleParameters: { earnDays: 2 }, updatedByMembershipId: membershipA.id },
        }),
      ),
    ).rejects.toThrow(/immutable/i);

    const documents = await Promise.all(
      [1, 2].map(() =>
        admin.document.create({
          data: {
            agencyId: agencyA.id,
            documentType: 'LEAVE_POLICY',
            classification: 'INTERNAL',
            status: 'DRAFT',
            createdByMembershipId: membershipA.id,
          },
        }),
      ),
    );
    const documentVersions = await Promise.all(
      documents.map((document, index) =>
        admin.documentVersion.create({
          data: {
            agencyId: agencyA.id,
            documentId: document.id,
            versionNo: 1,
            storageKey: 'leave-policy-rls/' + suffix + '-' + (index + 1),
            contentHash: 'b'.repeat(64),
            mimeType: 'application/pdf',
            sizeBytes: 1,
            createdByMembershipId: membershipA.id,
          },
        }),
      ),
    );
    const [primaryDocument, overlapDocument] = documents;
    const [primaryVersion, overlapVersion] = documentVersions;
    if (!primaryDocument || !overlapDocument || !primaryVersion || !overlapVersion) {
      throw new Error('Leave Policy evidence fixtures were not created.');
    }
    await Promise.all(
      documents.map((document, index) =>
        admin.document.update({
          where: { id: document.id },
          data: { currentVersionId: documentVersions[index]?.id },
        }),
      ),
    );

    const authority = await withContext(app, contextA, (transaction) =>
      transaction.leavePolicyAuthority.create({
        data: {
          agencyId: agencyA.id,
          leavePolicyVersionId: draft.id,
          authorityClass: 'NATIONAL_RULE',
          documentId: primaryDocument.id,
          documentVersionId: primaryVersion.id,
          citation: 'Rule XVI, sections 1-3',
          createdByMembershipId: membershipA.id,
        },
      }),
    );

    const activated = await withContext(app, capabilitiesA, (transaction) =>
      transaction.leavePolicyVersion.update({
        where: { agencyId_id: { agencyId: agencyA.id, id: draft.id } },
        data: { status: 'ACTIVE', updatedByMembershipId: membershipA.id },
      }),
    );
    expect(activated.status).toBe('ACTIVE');

    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.leavePolicyAuthority.create({
          data: {
            agencyId: agencyA.id,
            leavePolicyVersionId: draft.id,
            authorityClass: 'AGENCY_CONFIGURATION',
            documentId: overlapDocument.id,
            documentVersionId: overlapVersion.id,
            citation: 'Agency leave policy',
            createdByMembershipId: membershipA.id,
          },
        }),
      ),
    ).rejects.toThrow(/frozen/i);

    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.leavePolicyAuthority.delete({
          where: { agencyId_id: { agencyId: agencyA.id, id: authority.id } },
        }),
      ),
    ).rejects.toThrow(/frozen/i);

    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.leavePolicyVersion.update({
          where: { agencyId_id: { agencyId: agencyA.id, id: draft.id } },
          data: { effectiveTo: new Date('2026-06-30'), updatedByMembershipId: membershipA.id },
        }),
      ),
    ).rejects.toThrow(/application service/i);

    await expect(
      withContext(app, capabilitiesA, (transaction) =>
        transaction.leavePolicyVersion.update({
          where: { agencyId_id: { agencyId: agencyA.id, id: draft.id } },
          data: { status: 'SUPERSEDED', updatedByMembershipId: membershipA.id },
        }),
      ),
    ).rejects.toThrow(/end date/i);

    const superseded = await withContext(app, capabilitiesA, (transaction) =>
      transaction.leavePolicyVersion.update({
        where: { agencyId_id: { agencyId: agencyA.id, id: draft.id } },
        data: {
          status: 'SUPERSEDED',
          effectiveTo: new Date('2026-05-31'),
          updatedByMembershipId: membershipA.id,
        },
      }),
    );
    expect(superseded.effectiveTo?.toISOString().slice(0, 10)).toBe('2026-05-31');

    const successor = await withContext(app, capabilitiesA, (transaction) =>
      transaction.leavePolicyVersion.create({
        data: {
          agencyId: agencyA.id,
          leaveTypeId: leaveTypeA.id,
          versionNo: 2,
          entitlementBasis: 'ACCRUED_ACCOUNT',
          calendarBasis: 'WORKING_DAY',
          approvalRouteCode: 'LEAVE-ROUTE-1',
          evaluatorKind: 'SERVICE_ACCRUAL',
          ruleParameters: { earnDays: 1, perServiceDays: 24, annualCreditDays: 15 },
          applicabilityRules: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
          documentRequirements: { required: ['SIGNED_LEAVE_APPLICATION_FORM'], additional: [] },
          effectiveFrom: new Date('2026-06-01'),
          status: 'ACTIVE',
          createdByMembershipId: membershipA.id,
          updatedByMembershipId: membershipA.id,
        },
      }),
    );
    expect(successor.status).toBe('ACTIVE');

    await expect(
      withContext(app, capabilitiesA, (transaction) =>
        transaction.leavePolicyVersion.create({
          data: {
            agencyId: agencyA.id,
            leaveTypeId: leaveTypeA.id,
            versionNo: 3,
            entitlementBasis: 'ACCRUED_ACCOUNT',
            calendarBasis: 'WORKING_DAY',
            approvalRouteCode: 'LEAVE-ROUTE-1',
            evaluatorKind: 'SERVICE_ACCRUAL',
            ruleParameters: { earnDays: 1, perServiceDays: 24, annualCreditDays: 15 },
            applicabilityRules: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
            documentRequirements: { required: ['SIGNED_LEAVE_APPLICATION_FORM'], additional: [] },
            effectiveFrom: new Date('2026-05-15'),
            status: 'ACTIVE',
            createdByMembershipId: membershipA.id,
            updatedByMembershipId: membershipA.id,
          },
        }),
      ),
    ).rejects.toThrow(/exclusion|conflicting|overlap/i);

    await expect(
      withContext(
        app,
        { agencyId: agencyB.id, userId: user.id, membershipId: membershipB.id },
        (transaction) => transaction.leavePolicyVersion.findMany({ where: { id: successor.id } }),
      ),
    ).resolves.toHaveLength(0);
  } finally {
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.leavePolicyAuthority.deleteMany({ where: { agencyId: { in: agencyIds } } });
      await transaction.leavePolicyVersion.deleteMany({ where: { agencyId: { in: agencyIds } } });
      await transaction.leaveType.deleteMany({ where: { agencyId: { in: agencyIds } } });
      await transaction.documentVersion.deleteMany({ where: { agencyId: { in: agencyIds } } });
      await transaction.document.deleteMany({ where: { agencyId: { in: agencyIds } } });
    });
    await admin.agencyMembership.deleteMany({ where: { agencyId: { in: agencyIds } } });
    await admin.agency.deleteMany({ where: { id: { in: agencyIds } } });
    await admin.user.delete({ where: { id: user.id } });
    await app.$disconnect();
    await admin.$disconnect();
  }
});
