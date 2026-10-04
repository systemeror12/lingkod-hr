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

it.skipIf(!enabled)(
  'isolates Application screening records and protects completed results',
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
            code: `APPLICATION-RLS-${label}-${suffix}`,
            name: `Application RLS ${label}`,
            agencyType: 'NGA',
            status: 'ACTIVE',
          },
        }),
      ),
    );
    const user = await admin.user.create({
      data: {
        emailNormalized: `application-${suffix}@example.test`,
        displayName: 'Application RLS User',
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
      throw new Error('Application RLS fixtures were not created.');
    }

    const publicationIds = [randomUUID(), randomUUID()];
    const qualificationIds = [randomUUID(), randomUUID()];
    const otherQualificationIds = [randomUUID(), randomUUID()];
    const applicantIds = [randomUUID(), randomUUID()];
    const applicationIds = [randomUUID(), randomUUID()];
    const documentIds = [randomUUID(), randomUUID()];
    const linkIds = [randomUUID(), randomUUID()];
    const screeningIds = [randomUUID(), randomUUID()];

    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      for (const [index, agency] of agencies.entries()) {
        const membership = memberships[index];
        const publicationId = publicationIds[index];
        const qualificationId = qualificationIds[index];
        const otherQualificationId = otherQualificationIds[index];
        const applicantId = applicantIds[index];
        const applicationId = applicationIds[index];
        const documentId = documentIds[index];
        const linkId = linkIds[index];
        const screeningId = screeningIds[index];
        if (
          !membership ||
          !publicationId ||
          !qualificationId ||
          !otherQualificationId ||
          !applicantId ||
          !applicationId ||
          !documentId ||
          !linkId ||
          !screeningId
        ) {
          throw new Error('Fixture gap.');
        }
        await transaction.$executeRaw`
          INSERT INTO "vacancy_publications"
            ("id", "agency_id", "publication_no", "request_to_fill_id",
             "qualification_standard_version_id", "form_document_version_id",
             "approval_route_version_id", "opening_date", "closing_date", "channels",
             "position_details", "application_requirements", "contact_details", "status",
             "published_at", "created_by_membership_id", "updated_by_membership_id")
          VALUES
            (${publicationId}::uuid, ${agency.id}::uuid,
             nextval('"vacancy_publications_publication_no_seq"'), ${randomUUID()}::uuid,
             ${qualificationId}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid,
             '2026-01-03'::date, '2026-01-13'::date, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb,
             '{}'::jsonb, 'PUBLISHED', '2026-01-03T00:00:00Z'::timestamptz,
             ${membership.id}::uuid, ${membership.id}::uuid)
        `;
        await transaction.$executeRaw`
          INSERT INTO "applicants"
            ("id", "agency_id", "first_name", "last_name", "privacy_notice_version",
             "consented_at", "deduplication_key", "created_by_membership_id")
          VALUES
            (${applicantId}::uuid, ${agency.id}::uuid, 'Ana', 'Reyes', 'Privacy Notice v1',
             '2026-01-02T00:00:00Z'::timestamptz, ${`dedup-${suffix}-${index}`},
             ${membership.id}::uuid)
        `;
        await transaction.$executeRaw`
          INSERT INTO "applications"
            ("id", "agency_id", "application_no", "vacancy_publication_id", "applicant_id",
             "qualification_standard_version_id", "status", "received_at",
             "received_by_membership_id", "created_by_membership_id", "updated_by_membership_id")
          VALUES
            (${applicationId}::uuid, ${agency.id}::uuid,
             nextval('applications_application_no_seq'), ${publicationId}::uuid,
             ${applicantId}::uuid, ${qualificationId}::uuid, 'RECEIVED',
             '2026-01-04T00:00:00Z'::timestamptz, ${membership.id}::uuid,
             ${membership.id}::uuid, ${membership.id}::uuid)
        `;
        await transaction.$executeRaw`
          INSERT INTO "application_documents"
            ("id", "agency_id", "application_id", "document_id", "document_version_id",
             "purpose", "linked_by_membership_id")
          VALUES
            (${linkId}::uuid, ${agency.id}::uuid, ${applicationId}::uuid, ${documentId}::uuid,
             ${randomUUID()}::uuid, 'EDUCATION', ${membership.id}::uuid)
        `;
        await transaction.$executeRaw`
          INSERT INTO "application_screenings"
            ("id", "agency_id", "application_id", "qualification_standard_version_id",
             "version_no", "result", "reason", "area_results", "screened_by_membership_id")
          VALUES
            (${screeningId}::uuid, ${agency.id}::uuid, ${applicationId}::uuid,
             ${qualificationId}::uuid, 1, 'QUALIFIED', 'Seeded screening result.',
             '[{"area":"EDUCATION","result":"MEETS"}]'::jsonb, ${membership.id}::uuid)
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
            'applicants', 'applications', 'application_documents',
            'application_screenings', 'application_screening_evidence'
          )
      `;
      expect(forcedRls).toHaveLength(5);
      expect(forcedRls.every((table) => table.forced)).toBe(true);

      const contextA = {
        agencyId: agencyA.id,
        userId: user.id,
        membershipId: membershipA.id,
        recruitmentTransition: true,
      };

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.applicant.findMany({ where: { id: applicantIds[1] } }),
        ),
      ).resolves.toHaveLength(0);
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.application.findMany({ where: { id: applicationIds[1] } }),
        ),
      ).resolves.toHaveLength(0);
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.applicationDocument.findMany({ where: { id: linkIds[1] } }),
        ),
      ).resolves.toHaveLength(0);
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.applicationScreening.findMany({ where: { id: screeningIds[1] } }),
        ),
      ).resolves.toHaveLength(0);

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.applicant.create({
            data: {
              agencyId: agencyB.id,
              firstName: 'Bea',
              lastName: 'Cruz',
              privacyNoticeVersion: 'Privacy Notice v1',
              consentedAt: new Date('2026-01-02T00:00:00Z'),
              deduplicationKey: `foreign-${suffix}`,
              createdByMembershipId: membershipB.id,
            },
          }),
        ),
      ).rejects.toThrow(/row-level security/i);

      await expect(
        withContext(app, { ...contextA, recruitmentTransition: false }, (transaction) =>
          transaction.applicationScreening.create({
            data: {
              agencyId: agencyA.id,
              applicationId: applicationIds[0] as string,
              qualificationStandardVersionId: qualificationIds[0] as string,
              versionNo: 1,
              result: 'QUALIFIED',
              reason: 'Capability-free screening attempt.',
              areaResults: [],
              screenedByMembershipId: membershipA.id,
            },
          }),
        ),
      ).rejects.toThrow(/require the Recruitment service|row-level security/i);

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.applicationScreening.update({
            where: { agencyId_id: { agencyId: agencyA.id, id: screeningIds[0] as string } },
            data: { reason: 'Attempted rewrite of a completed screening.' },
          }),
        ),
      ).rejects.toThrow(/permission denied|immutable/i);
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.applicationScreening.delete({
            where: { agencyId_id: { agencyId: agencyA.id, id: screeningIds[0] as string } },
          }),
        ),
      ).rejects.toThrow(/permission denied|immutable/i);

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.application.update({
            where: { agencyId_id: { agencyId: agencyA.id, id: applicationIds[0] as string } },
            data: { receivedAt: new Date('2026-01-05T00:00:00Z') },
          }),
        ),
      ).rejects.toThrow(/Application identity and receipt facts are immutable|immutable/i);
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.application.update({
            where: { agencyId_id: { agencyId: agencyA.id, id: applicationIds[0] as string } },
            data: { status: 'CLOSED', closedAt: new Date(), closureReason: 'Skipped screening.' },
          }),
        ),
      ).rejects.toThrow(/invalid transition|immutable/i);

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.applicationScreening.create({
            data: {
              agencyId: agencyA.id,
              applicationId: applicationIds[0] as string,
              qualificationStandardVersionId: otherQualificationIds[0] as string,
              versionNo: 1,
              result: 'QUALIFIED',
              reason: 'Screening against a substituted standard.',
              areaResults: [],
              screenedByMembershipId: membershipA.id,
            },
          }),
        ),
      ).rejects.toThrow(/Qualification Standard Version bound to the Application|immutable/i);

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.applicationScreeningEvidence.create({
            data: {
              agencyId: agencyA.id,
              screeningId: screeningIds[0] as string,
              applicationDocumentId: linkIds[1] as string,
              area: 'EDUCATION',
            },
          }),
        ),
      ).rejects.toThrow(/document linked to the same Application|immutable/i);

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.application.create({
            data: {
              agencyId: agencyA.id,
              vacancyPublicationId: publicationIds[0] as string,
              applicantId: applicantIds[0] as string,
              qualificationStandardVersionId: otherQualificationIds[0] as string,
              status: 'RECEIVED',
              receivedAt: new Date('2026-01-04T00:00:00Z'),
              receivedByMembershipId: membershipA.id,
              createdByMembershipId: membershipA.id,
              updatedByMembershipId: membershipA.id,
            },
          }),
        ),
      ).rejects.toThrow(/published Vacancy Publication|immutable/i);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.$executeRaw`
          DELETE FROM "application_screening_evidence"
          WHERE "agency_id" IN (${agencyA.id}::uuid, ${agencyB.id}::uuid)
        `;
        await transaction.$executeRaw`
          DELETE FROM "application_screenings"
          WHERE "id" IN (${screeningIds[0]}::uuid, ${screeningIds[1]}::uuid)
        `;
        await transaction.$executeRaw`
          DELETE FROM "application_documents"
          WHERE "id" IN (${linkIds[0]}::uuid, ${linkIds[1]}::uuid)
        `;
        await transaction.$executeRaw`
          DELETE FROM "applications"
          WHERE "id" IN (${applicationIds[0]}::uuid, ${applicationIds[1]}::uuid)
        `;
        await transaction.$executeRaw`
          DELETE FROM "applicants"
          WHERE "id" IN (${applicantIds[0]}::uuid, ${applicantIds[1]}::uuid)
        `;
        await transaction.$executeRaw`
          DELETE FROM "vacancy_publications"
          WHERE "id" IN (${publicationIds[0]}::uuid, ${publicationIds[1]}::uuid)
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
  },
);
