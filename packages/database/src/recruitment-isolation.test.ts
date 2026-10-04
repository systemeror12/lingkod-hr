import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

async function withContext<T>(
  client: PrismaClient,
  values: {
    agencyId: string;
    userId: string;
    membershipId: string;
    recruitmentTransition?: boolean;
  },
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT
        set_config('app.agency_id', ${values.agencyId}, true),
        set_config('app.user_id', ${values.userId}, true),
        set_config('app.membership_id', ${values.membershipId}, true),
        set_config(
          'app.recruitment_transition',
          ${values.recruitmentTransition ? 'on' : ''},
          true
        )
    `;
    return work(transaction);
  });
}

it.skipIf(!enabled)('isolates Phase 6 records and protects frozen recruitment facts', async () => {
  const runtimeUrl = process.env.DATABASE_URL;
  const adminUrl = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!runtimeUrl || !adminUrl)
    throw new Error('Runtime and administrative database URLs are required.');

  const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const agencies = await Promise.all(
    ['A', 'B'].map((label) =>
      admin.agency.create({
        data: {
          code: `RECRUITMENT-RLS-${label}-${suffix}`,
          name: `Recruitment RLS ${label}`,
          agencyType: 'NGA',
          status: 'ACTIVE',
        },
      }),
    ),
  );
  const user = await admin.user.create({
    data: {
      emailNormalized: `recruitment-${suffix}@example.test`,
      displayName: 'Recruitment RLS User',
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
    throw new Error('Recruitment RLS fixtures were not created.');
  }

  const planIds = [randomUUID(), randomUUID()];
  const requestIds = [randomUUID(), randomUUID()];
  const publicationIds = [randomUUID(), randomUUID()];
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    for (const [index, agency] of agencies.entries()) {
      const membership = memberships[index];
      const planId = planIds[index];
      const requestId = requestIds[index];
      const publicationId = publicationIds[index];
      if (!membership || !planId || !requestId || !publicationId) throw new Error('Fixture gap.');
      await transaction.$executeRaw`
        INSERT INTO "agency_merit_selection_plan_versions"
          ("id", "agency_id", "plan_code", "version_no", "applicability", "effective_from",
           "status", "created_by_membership_id", "updated_by_membership_id")
        VALUES
          (${planId}::uuid, ${agency.id}::uuid, ${`MSP-${suffix}-${index}`}, 1, '{}'::jsonb,
           '2026-01-01'::date, 'ACTIVE', ${membership.id}::uuid, ${membership.id}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "requests_to_fill"
          ("id", "agency_id", "request_no", "position_id", "requesting_unit_id",
           "requested_by_membership_id", "justification", "qualification_standard_version_id",
           "binding_set_no", "binding_frozen_at", "status", "created_by_membership_id",
           "updated_by_membership_id")
        VALUES
          (${requestId}::uuid, ${agency.id}::uuid,
           nextval('"requests_to_fill_request_no_seq"'), ${randomUUID()}::uuid, ${randomUUID()}::uuid,
           ${membership.id}::uuid, 'Frozen recruitment fixture', ${randomUUID()}::uuid,
           1, '2026-01-02T00:00:00Z'::timestamptz, 'DRAFT', ${membership.id}::uuid,
           ${membership.id}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "vacancy_publications"
          ("id", "agency_id", "publication_no", "request_to_fill_id",
           "qualification_standard_version_id", "form_document_version_id",
           "approval_route_version_id", "opening_date", "closing_date", "channels",
           "position_details", "application_requirements", "contact_details", "status",
           "published_at", "created_by_membership_id", "updated_by_membership_id")
        VALUES
          (${publicationId}::uuid, ${agency.id}::uuid,
           nextval('"vacancy_publications_publication_no_seq"'), ${requestId}::uuid,
           ${randomUUID()}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid,
           '2026-01-03'::date, '2026-01-13'::date, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb,
           '{}'::jsonb, 'PUBLISHED', '2026-01-03T00:00:00Z'::timestamptz,
           ${membership.id}::uuid, ${membership.id}::uuid)
      `;
    }
  });

  try {
    const forcedRls = await admin.$queryRaw<Array<{ tableName: string; forced: boolean }>>`
      SELECT c.relname AS "tableName", c.relforcerowsecurity AS "forced"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN (
          'agency_merit_selection_plan_versions', 'merit_selection_criteria_sets',
          'board_definitions', 'board_appointments', 'requests_to_fill',
          'request_approval_route_bindings', 'request_msp_rebaselines',
          'vacancy_publications', 'vacancy_publication_evidence'
        )
    `;
    expect(forcedRls).toHaveLength(9);
    expect(forcedRls.every((table) => table.forced)).toBe(true);

    const contextA = {
      agencyId: agencyA.id,
      userId: user.id,
      membershipId: membershipA.id,
      recruitmentTransition: true,
    };
    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.agencyMeritSelectionPlanVersion.findMany({ where: { id: planIds[1] } }),
      ),
    ).resolves.toHaveLength(0);
    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.requestToFill.findMany({ where: { id: requestIds[1] } }),
      ),
    ).resolves.toHaveLength(0);
    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.vacancyPublication.findMany({ where: { id: publicationIds[1] } }),
      ),
    ).resolves.toHaveLength(0);

    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.agencyMeritSelectionPlanVersion.create({
          data: {
            agencyId: agencyB.id,
            planCode: `FOREIGN-${suffix}`,
            versionNo: 1,
            effectiveFrom: new Date('2026-02-01'),
            status: 'DRAFT',
            createdByMembershipId: membershipB.id,
            updatedByMembershipId: membershipB.id,
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.requestToFill.update({
          where: { agencyId_id: { agencyId: agencyA.id, id: requestIds[0] } },
          data: { justification: 'Attempted mutation after binding freeze' },
        }),
      ),
    ).rejects.toThrow(/Frozen Request to Fill facts are immutable|immutable/i);
    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.vacancyPublication.update({
          where: { agencyId_id: { agencyId: agencyA.id, id: publicationIds[0] } },
          data: { publishedAt: null },
        }),
      ),
    ).rejects.toThrow(
      /Published Vacancy Publication timing and lineage facts are immutable|immutable/i,
    );
  } finally {
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.$executeRaw`
        DELETE FROM "vacancy_publications"
        WHERE "id" IN (${publicationIds[0]}::uuid, ${publicationIds[1]}::uuid)
      `;
      await transaction.$executeRaw`
        DELETE FROM "requests_to_fill"
        WHERE "id" IN (${requestIds[0]}::uuid, ${requestIds[1]}::uuid)
      `;
      await transaction.$executeRaw`
        DELETE FROM "agency_merit_selection_plan_versions"
        WHERE "id" IN (${planIds[0]}::uuid, ${planIds[1]}::uuid)
      `;
    });
    await admin.agencyMembership.deleteMany({
      where: { id: { in: memberships.map(({ id }) => id) } },
    });
    await admin.agency.deleteMany({ where: { id: { in: agencies.map(({ id }) => id) } } });
    await admin.user.delete({ where: { id: user.id } });
    await app.$disconnect();
    await admin.$disconnect();
  }
});
