import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

const PROTECTED_TABLES = [
  'selection_board_sessions',
  'board_roster_snapshot_members',
  'board_member_participations',
  'conflict_declarations',
  'applicant_quorum_snapshots',
  'board_recommendations',
  'candidate_evaluation_report_versions',
  'selection_decisions',
  'recruitment_appointment_handoffs',
];

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

it.skipIf(!enabled)(
  'isolates HRMPSB deliberation records and protects frozen board facts',
  async () => {
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
            code: `DELIB-RLS-${label}-${suffix}`,
            name: `Deliberation RLS ${label}`,
            agencyType: 'NGA',
            status: 'ACTIVE',
          },
        }),
      ),
    );
    const user = await admin.user.create({
      data: {
        emailNormalized: `deliberation-rls-${suffix}@example.test`,
        displayName: 'Deliberation RLS User',
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
      throw new Error('Deliberation RLS fixtures were not created.');
    }

    const sessionIds = [randomUUID(), randomUUID()];
    const publicationIds = [randomUUID(), randomUUID()];
    const requestIds = [randomUUID(), randomUUID()];
    const boardIds = [randomUUID(), randomUUID()];
    const appointmentIds = [randomUUID(), randomUUID()];
    const rosterIds = [randomUUID(), randomUUID()];
    const participationIds = [randomUUID(), randomUUID()];
    const documentIds = [randomUUID(), randomUUID()];
    const documentVersionIds = [randomUUID(), randomUUID()];

    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      for (const [index, agency] of agencies.entries()) {
        const membership = memberships[index];
        const sessionId = sessionIds[index];
        const publicationId = publicationIds[index];
        const requestId = requestIds[index];
        const boardId = boardIds[index];
        const appointmentId = appointmentIds[index];
        const rosterId = rosterIds[index];
        const participationId = participationIds[index];
        const documentId = documentIds[index];
        const documentVersionId = documentVersionIds[index];
        if (
          !membership ||
          !sessionId ||
          !publicationId ||
          !requestId ||
          !boardId ||
          !appointmentId ||
          !rosterId ||
          !participationId ||
          !documentId ||
          !documentVersionId
        ) {
          throw new Error('Deliberation RLS fixture identifiers are missing.');
        }
        await transaction.$executeRaw`
          INSERT INTO "documents"
            ("id", "agency_id", "document_no", "document_type", "classification", "status",
             "created_by_membership_id")
          VALUES
            (${documentId}::uuid, ${agency.id}::uuid, ${`RLS-${index}-${suffix}`},
             'BOARD_AUTHORITY', 'CONFIDENTIAL', 'APPROVED', ${membership.id}::uuid)
        `;
        await transaction.$executeRaw`
          INSERT INTO "document_versions"
            ("id", "agency_id", "document_id", "version_no", "storage_key", "content_hash",
             "mime_type", "size_bytes", "issued_at", "created_by_membership_id")
          VALUES
            (${documentVersionId}::uuid, ${agency.id}::uuid, ${documentId}::uuid, 1,
             ${`e2e/rls-${index}-${suffix}`}, ${'a'.repeat(64)}, 'application/pdf', 1, now(),
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
             ${randomUUID()}::uuid, ${documentVersionId}::uuid, ${randomUUID()}::uuid,
             '2000-01-01'::date, '2000-01-31'::date, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb,
             '{}'::jsonb, 'PUBLISHED', now(), ${membership.id}::uuid, ${membership.id}::uuid)
        `;
        await transaction.$executeRaw`
          INSERT INTO "board_definitions"
            ("id", "agency_id", "plan_version_id", "board_code", "version_no", "applicability",
             "seat_definition", "quorum_definition", "status",
             "created_by_membership_id", "updated_by_membership_id")
          VALUES
            (${boardId}::uuid, ${agency.id}::uuid, ${randomUUID()}::uuid,
             ${`RLS-BOARD-${index}-${suffix}`}, 1, '{}'::jsonb,
             '{"seats":[{"seatCode":"CHAIR","required":true}]}'::jsonb,
             '{"minimum":1}'::jsonb, 'ACTIVE', ${membership.id}::uuid, ${membership.id}::uuid)
        `;
        await transaction.$executeRaw`
          INSERT INTO "requests_to_fill"
            ("id", "agency_id", "request_no", "position_id", "requesting_unit_id",
             "requested_by_membership_id", "justification", "qualification_standard_version_id",
             "board_definition_id", "status", "created_by_membership_id",
             "updated_by_membership_id")
          VALUES
            (${requestId}::uuid, ${agency.id}::uuid,
             nextval('"requests_to_fill_request_no_seq"'), ${randomUUID()}::uuid,
             ${randomUUID()}::uuid, ${membership.id}::uuid, 'Deliberation RLS fixture.',
             ${documentVersionId}::uuid, ${boardId}::uuid, 'APPROVED',
             ${membership.id}::uuid, ${membership.id}::uuid)
        `;
        await transaction.$executeRaw`
          INSERT INTO "selection_board_sessions"
            ("id", "agency_id", "vacancy_publication_id", "board_definition_id", "session_date",
             "status", "created_by_membership_id", "updated_by_membership_id")
          VALUES
            (${sessionId}::uuid, ${agency.id}::uuid, ${publicationId}::uuid, ${boardId}::uuid,
             '2026-09-10'::date, 'DRAFT', ${membership.id}::uuid, ${membership.id}::uuid)
        `;
        await transaction.$executeRaw`
          INSERT INTO "board_appointments"
            ("id", "agency_id", "board_definition_id", "seat_code", "membership_id",
             "appointment_kind", "effective_from", "authority_document_version_id", "status",
             "created_by_membership_id")
          VALUES
            (${appointmentId}::uuid, ${agency.id}::uuid, ${boardId}::uuid, 'CHAIR',
             ${membership.id}::uuid, 'PRINCIPAL', '2000-01-01'::date, ${documentVersionId}::uuid,
             'ACTIVE', ${membership.id}::uuid)
        `;
        await transaction.$executeRaw`
          INSERT INTO "board_roster_snapshot_members"
            ("id", "agency_id", "session_id", "board_appointment_id", "membership_id",
             "seat_code", "board_role", "appointment_kind", "is_voting")
          VALUES
            (${rosterId}::uuid, ${agency.id}::uuid, ${sessionId}::uuid, ${appointmentId}::uuid,
             ${membership.id}::uuid, 'CHAIR', 'CHAIR', 'PRINCIPAL', true)
        `;
        await transaction.$executeRaw`
          INSERT INTO "board_member_participations"
            ("id", "agency_id", "session_id", "roster_snapshot_member_id", "membership_id",
             "board_role", "attendance_status", "recorded_by_membership_id")
          VALUES
            (${participationId}::uuid, ${agency.id}::uuid, ${sessionId}::uuid, ${rosterId}::uuid,
             ${membership.id}::uuid, 'CHAIR', 'PRESENT', ${membership.id}::uuid)
        `;
      }
    });

    try {
      const forced = await admin.$queryRaw<Array<{ table_name: string }>>`
        SELECT relname AS table_name
        FROM pg_class
        WHERE relnamespace = 'public'::regnamespace
          AND relname = ANY(${PROTECTED_TABLES})
          AND relforcerowsecurity = true
      `;
      expect(forced.map(({ table_name }) => table_name).sort()).toEqual(
        [...PROTECTED_TABLES].sort(),
      );

      const policies = await admin.$queryRaw<Array<{ tablename: string; count: bigint }>>`
        SELECT tablename, COUNT(*)::bigint AS count
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = ANY(${PROTECTED_TABLES})
        GROUP BY tablename
      `;
      for (const { count } of policies) expect(Number(count)).toBeGreaterThanOrEqual(2);

      const visibleToA = await withContext(
        app,
        {
          agencyId: agencyA.id,
          userId: user.id,
          membershipId: membershipA.id,
        },
        (transaction) => transaction.selectionBoardSession.findMany(),
      );
      expect(visibleToA.map(({ id }) => id)).toEqual([sessionIds[0]]);

      const visibleRosterToB = await withContext(
        app,
        {
          agencyId: agencyB.id,
          userId: user.id,
          membershipId: membershipB.id,
        },
        (transaction) => transaction.boardRosterSnapshotMember.findMany(),
      );
      expect(visibleRosterToB.map(({ id }) => id)).toEqual([rosterIds[1]]);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            recruitmentTransition: true,
          },
          (transaction) =>
            transaction.selectionBoardSession.create({
              data: {
                agencyId: agencyB.id,
                vacancyPublicationId: publicationIds[1] as string,
                boardDefinitionId: boardIds[1] as string,
                sessionDate: new Date('2026-09-10'),
                status: 'DRAFT',
                createdByMembershipId: membershipA.id,
                updatedByMembershipId: membershipA.id,
              },
            }),
        ),
      ).rejects.toThrow(/row-level security|must bind a published Vacancy Publication/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
          },
          (transaction) =>
            transaction.boardMemberParticipation.create({
              data: {
                agencyId: agencyA.id,
                sessionId: sessionIds[0] as string,
                rosterSnapshotMemberId: rosterIds[0] as string,
                membershipId: membershipA.id,
                boardRole: 'SECRETARIAT',
                attendanceStatus: 'PRESENT',
                recordedByMembershipId: membershipA.id,
              },
            }),
        ),
      ).rejects.toThrow(/requires? the Recruitment service|row-level security/i);

      const withRecruitmentCapability = async (
        work: (transaction: Prisma.TransactionClient) => Promise<unknown>,
      ): Promise<void> => {
        await admin.$transaction(async (transaction) => {
          await transaction.$executeRawUnsafe(
            "SELECT set_config('app.recruitment_transition', 'on', true)",
          );
          await work(transaction);
        });
      };

      await expect(
        withRecruitmentCapability(
          (transaction) =>
            transaction.$executeRaw`
            UPDATE "board_member_participations"
            SET "attendance_status" = 'ABSENT'
            WHERE "id" = ${participationIds[0]}::uuid
          `,
        ),
      ).rejects.toThrow(/immutable/i);

      await expect(
        withRecruitmentCapability(
          (transaction) =>
            transaction.$executeRaw`
            UPDATE "board_roster_snapshot_members"
            SET "seat_code" = 'MEMBER'
            WHERE "id" = ${rosterIds[0]}::uuid
          `,
        ),
      ).rejects.toThrow(/immutable/i);

      await expect(
        withRecruitmentCapability(
          (transaction) =>
            transaction.$executeRaw`
            DELETE FROM "selection_board_sessions"
            WHERE "id" = ${sessionIds[0]}::uuid
          `,
        ),
      ).rejects.toThrow(/retained and cannot be deleted/i);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        for (const table of [
          'recruitment_appointment_handoffs',
          'selection_decisions',
          'candidate_evaluation_report_versions',
          'board_recommendations',
          'applicant_quorum_snapshots',
          'conflict_declarations',
          'board_member_participations',
          'board_roster_snapshot_members',
          'selection_board_sessions',
          'board_appointments',
          'board_definitions',
          'vacancy_publications',
          'requests_to_fill',
          'document_versions',
          'documents',
        ]) {
          await transaction.$executeRawUnsafe(
            `DELETE FROM "${table}" WHERE "agency_id" IN ('${agencyA.id}'::uuid, '${agencyB.id}'::uuid)`,
          );
        }
      });
      await admin.agencyMembership.deleteMany({
        where: { agencyId: { in: [agencyA.id, agencyB.id] } },
      });
      await admin.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
      await admin.user.delete({ where: { id: user.id } });
      await app.$disconnect();
      await admin.$disconnect();
    }
  },
);
