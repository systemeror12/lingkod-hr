import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

const planDefinition = {
  stages: [
    {
      stageCode: 'WRITTEN_EXAM',
      stageType: 'ASSESSMENT',
      label: 'Written examination',
      criteria: [
        {
          criterionCode: 'JOB_KNOWLEDGE',
          label: 'Job knowledge',
          criterionType: 'NUMERIC',
          weight: 100,
          minimumScore: 0,
          maximumScore: 100,
          passingScore: 70,
          evidenceRequired: false,
          commentsRequired: false,
          evaluatorRoleCodes: ['hrmo_administrator'],
        },
      ],
      aggregation: {
        method: 'WEIGHTED_AVERAGE',
        evaluatorMethod: 'MEAN',
        rounding: { mode: 'HALF_UP', decimals: 2 },
        passingScore: 70,
        tieBreakers: [],
      },
    },
    {
      stageCode: 'PANEL_INTERVIEW',
      stageType: 'INTERVIEW',
      label: 'Panel interview',
      feedback: {
        minimumScore: 0,
        maximumScore: 100,
        passingScore: 70,
        evidenceRequired: false,
        commentsRequired: false,
        evaluatorRoleCodes: ['hrmo_administrator'],
      },
      aggregation: {
        evaluatorMethod: 'MEAN',
        rounding: { mode: 'HALF_UP', decimals: 2 },
        passingScore: 70,
      },
    },
  ],
};

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
  'isolates assessment and interview records and protects completed evaluations',
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
            code: `ASSESSMENT-RLS-${label}-${suffix}`,
            name: `Assessment RLS ${label}`,
            agencyType: 'NGA',
            status: 'ACTIVE',
          },
        }),
      ),
    );
    const user = await admin.user.create({
      data: {
        identityProvider: 'assessment-rls-e2e',
        externalSubject: `assessment-${suffix}`,
        emailNormalized: `assessment-${suffix}@example.test`,
        displayName: 'Assessment RLS User',
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
      throw new Error('Assessment RLS fixtures were not created.');
    }

    const planIds = [randomUUID(), randomUUID()];
    const criteriaSetIds = [randomUUID(), randomUUID()];
    const requestIds = [randomUUID(), randomUUID()];
    const publicationIds = [randomUUID(), randomUUID()];
    const qualificationIds = [randomUUID(), randomUUID()];
    const applicantIds = [randomUUID(), randomUUID()];
    const applicationIds = [randomUUID(), randomUUID()];
    const assessmentIds = [randomUUID(), randomUUID()];
    const resultIds = [randomUUID(), randomUUID()];
    const interviewIds = [randomUUID(), randomUUID()];
    const feedbackIds = [randomUUID(), randomUUID()];

    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      for (const [index, agency] of agencies.entries()) {
        const membership = memberships[index];
        const planId = planIds[index];
        const criteriaSetId = criteriaSetIds[index];
        const requestId = requestIds[index];
        const publicationId = publicationIds[index];
        const qualificationId = qualificationIds[index];
        const applicantId = applicantIds[index];
        const applicationId = applicationIds[index];
        const assessmentId = assessmentIds[index];
        const resultId = resultIds[index];
        const interviewId = interviewIds[index];
        const feedbackId = feedbackIds[index];
        if (
          !membership ||
          !planId ||
          !criteriaSetId ||
          !requestId ||
          !publicationId ||
          !qualificationId ||
          !applicantId ||
          !applicationId ||
          !assessmentId ||
          !resultId ||
          !interviewId ||
          !feedbackId
        ) {
          throw new Error('Fixture gap.');
        }
        await transaction.$executeRaw`
          INSERT INTO "agency_merit_selection_plan_versions"
            ("id", "agency_id", "plan_code", "version_no", "applicability",
             "effective_from", "status", "created_by_membership_id", "updated_by_membership_id")
          VALUES
            (${planId}::uuid, ${agency.id}::uuid, ${`RLS-MSP-${suffix}-${index}`}, 1,
             '{}'::jsonb, '2026-01-01'::date, 'ACTIVE',
             ${membership.id}::uuid, ${membership.id}::uuid)
        `;
        await transaction.$executeRaw`
          INSERT INTO "merit_selection_criteria_sets"
            ("id", "agency_id", "plan_version_id", "criteria_code", "applicability",
             "criteria_definition", "status", "created_by_membership_id", "updated_by_membership_id")
          VALUES
            (${criteriaSetId}::uuid, ${agency.id}::uuid, ${planId}::uuid,
             ${`RLS-CRITERIA-${suffix}-${index}`}, '{}'::jsonb,
             ${JSON.stringify(planDefinition)}::jsonb, 'ACTIVE',
             ${membership.id}::uuid, ${membership.id}::uuid)
        `;
        await transaction.$executeRaw`
          INSERT INTO "requests_to_fill"
            ("id", "agency_id", "request_no", "position_id", "requesting_unit_id",
             "requested_by_membership_id", "justification",
             "qualification_standard_version_id", "criteria_set_id", "status",
             "created_by_membership_id", "updated_by_membership_id")
          VALUES
            (${requestId}::uuid, ${agency.id}::uuid,
             nextval('"requests_to_fill_request_no_seq"'), ${randomUUID()}::uuid,
             ${randomUUID()}::uuid, ${membership.id}::uuid, 'Assessment RLS fixture.',
             ${qualificationId}::uuid, ${criteriaSetId}::uuid, 'APPROVED',
             ${membership.id}::uuid, ${membership.id}::uuid)
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
             '2026-01-02T00:00:00Z'::timestamptz, ${`rls-dedup-${suffix}-${index}`},
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
             ${applicantId}::uuid, ${qualificationId}::uuid, 'QUALIFIED',
             '2026-01-04T00:00:00Z'::timestamptz, ${membership.id}::uuid,
             ${membership.id}::uuid, ${membership.id}::uuid)
        `;
        await transaction.$executeRaw`
          INSERT INTO "assessments"
            ("id", "agency_id", "application_id", "criteria_set_id", "stage_code", "stage_type",
             "status", "created_by_membership_id", "updated_by_membership_id")
          VALUES
            (${assessmentId}::uuid, ${agency.id}::uuid, ${applicationId}::uuid,
             ${criteriaSetId}::uuid, 'WRITTEN_EXAM', 'ASSESSMENT', 'SCHEDULED',
             ${membership.id}::uuid, ${membership.id}::uuid)
        `;
        await transaction.$executeRaw`
          INSERT INTO "assessment_result_versions"
            ("id", "agency_id", "assessment_id", "criterion_code",
             "evaluated_by_membership_id", "version_no", "score")
          VALUES
            (${resultId}::uuid, ${agency.id}::uuid, ${assessmentId}::uuid, 'JOB_KNOWLEDGE',
             ${membership.id}::uuid, 1, 85)
        `;
        await transaction.$executeRaw`
          INSERT INTO "interviews"
            ("id", "agency_id", "application_id", "criteria_set_id", "stage_code",
             "scheduled_at", "status", "created_by_membership_id", "updated_by_membership_id")
          VALUES
            (${interviewId}::uuid, ${agency.id}::uuid, ${applicationId}::uuid,
             ${criteriaSetId}::uuid, 'PANEL_INTERVIEW', '2026-01-20T01:00:00Z'::timestamptz,
             'SCHEDULED', ${membership.id}::uuid, ${membership.id}::uuid)
        `;
        await transaction.$executeRaw`
          INSERT INTO "interview_feedback_versions"
            ("id", "agency_id", "interview_id", "interviewer_membership_id", "version_no",
             "score", "recommendation")
          VALUES
            (${feedbackId}::uuid, ${agency.id}::uuid, ${interviewId}::uuid,
             ${membership.id}::uuid, 1, 80, 'PROCEED')
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
            'assessments', 'assessment_result_versions',
            'interviews', 'interview_feedback_versions'
          )
      `;
      expect(forcedRls).toHaveLength(4);
      expect(forcedRls.every((table) => table.forced)).toBe(true);

      const contextA = {
        agencyId: agencyA.id,
        userId: user.id,
        membershipId: membershipA.id,
        recruitmentTransition: true,
      };

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.assessment.findMany({ where: { id: assessmentIds[1] } }),
        ),
      ).resolves.toHaveLength(0);
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.assessmentResultVersion.findMany({ where: { id: resultIds[1] } }),
        ),
      ).resolves.toHaveLength(0);
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.interview.findMany({ where: { id: interviewIds[1] } }),
        ),
      ).resolves.toHaveLength(0);
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.interviewFeedbackVersion.findMany({ where: { id: feedbackIds[1] } }),
        ),
      ).resolves.toHaveLength(0);

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.assessment.create({
            data: {
              agencyId: agencyB.id,
              applicationId: applicationIds[1] as string,
              criteriaSetId: criteriaSetIds[1] as string,
              stageCode: 'WRITTEN_EXAM',
              stageType: 'ASSESSMENT',
              status: 'SCHEDULED',
              createdByMembershipId: membershipB.id,
              updatedByMembershipId: membershipB.id,
            },
          }),
        ),
      ).rejects.toThrow(/row-level security|does not exist/i);

      await expect(
        withContext(app, { ...contextA, recruitmentTransition: false }, (transaction) =>
          transaction.interview.create({
            data: {
              agencyId: agencyA.id,
              applicationId: applicationIds[0] as string,
              criteriaSetId: criteriaSetIds[0] as string,
              stageCode: 'PANEL_INTERVIEW',
              scheduledAt: new Date('2026-01-21T01:00:00Z'),
              status: 'SCHEDULED',
              createdByMembershipId: membershipA.id,
              updatedByMembershipId: membershipA.id,
            },
          }),
        ),
      ).rejects.toThrow(/require the Recruitment service|row-level security/i);

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.assessmentResultVersion.update({
            where: { agencyId_id: { agencyId: agencyA.id, id: resultIds[0] as string } },
            data: { score: 99 },
          }),
        ),
      ).rejects.toThrow(/permission denied|immutable/i);
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.assessmentResultVersion.delete({
            where: { agencyId_id: { agencyId: agencyA.id, id: resultIds[0] as string } },
          }),
        ),
      ).rejects.toThrow(/permission denied|immutable/i);
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.interviewFeedbackVersion.update({
            where: { agencyId_id: { agencyId: agencyA.id, id: feedbackIds[0] as string } },
            data: { recommendation: 'HOLD' },
          }),
        ),
      ).rejects.toThrow(/permission denied|immutable/i);

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.assessment.update({
            where: { agencyId_id: { agencyId: agencyA.id, id: assessmentIds[0] as string } },
            data: { stageCode: 'SUBSTITUTED' },
          }),
        ),
      ).rejects.toThrow(/Assessment identity is immutable/i);

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.assessment.update({
            where: { agencyId_id: { agencyId: agencyA.id, id: assessmentIds[0] as string } },
            data: {
              status: 'COMPLETED',
              completedAt: new Date('2026-01-20T00:00:00Z'),
              updatedByMembershipId: membershipA.id,
            },
          }),
        ),
      ).resolves.toBeDefined();
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.assessment.update({
            where: { agencyId_id: { agencyId: agencyA.id, id: assessmentIds[0] as string } },
            data: {
              status: 'CANCELLED',
              outcomeAt: new Date('2026-01-20T00:00:00Z'),
              outcomeReason: 'Late cancellation.',
              updatedByMembershipId: membershipA.id,
            },
          }),
        ),
      ).rejects.toThrow(/immutable/i);

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.assessmentResultVersion.create({
            data: {
              agencyId: agencyA.id,
              assessmentId: assessmentIds[0] as string,
              criterionCode: 'JOB_KNOWLEDGE',
              evaluatedByMembershipId: membershipA.id,
              versionNo: 3,
              score: 90,
            },
          }),
        ),
      ).rejects.toThrow(/advance exactly once/i);

      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.$executeRaw`
          UPDATE "applications"
          SET "status" = 'WITHDRAWN',
              "withdrawn_at" = now(),
              "withdrawal_reason" = 'Assessment RLS freeze fixture.'
          WHERE "id" = ${applicationIds[0]}::uuid
        `;
      });
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.assessmentResultVersion.create({
            data: {
              agencyId: agencyA.id,
              assessmentId: assessmentIds[0] as string,
              criterionCode: 'JOB_KNOWLEDGE',
              evaluatedByMembershipId: membershipA.id,
              versionNo: 2,
              score: 90,
              replacesResultId: resultIds[0] as string,
              correctionReason: 'Attempted after the evaluation closed.',
            },
          }),
        ),
      ).rejects.toThrow(/frozen/i);
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.interviewFeedbackVersion.create({
            data: {
              agencyId: agencyA.id,
              interviewId: interviewIds[0] as string,
              interviewerMembershipId: membershipA.id,
              versionNo: 2,
              score: 70,
              recommendation: 'HOLD',
              replacesFeedbackId: feedbackIds[0] as string,
              correctionReason: 'Attempted after the evaluation closed.',
            },
          }),
        ),
      ).rejects.toThrow(/frozen/i);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.$executeRaw`
          DELETE FROM "assessment_result_versions"
          WHERE "id" IN (${resultIds[0]}::uuid, ${resultIds[1]}::uuid)
        `;
        await transaction.$executeRaw`
          DELETE FROM "assessments" WHERE "id" IN (${assessmentIds[0]}::uuid, ${assessmentIds[1]}::uuid)
        `;
        await transaction.$executeRaw`
          DELETE FROM "interview_feedback_versions"
          WHERE "id" IN (${feedbackIds[0]}::uuid, ${feedbackIds[1]}::uuid)
        `;
        await transaction.$executeRaw`
          DELETE FROM "interviews" WHERE "id" IN (${interviewIds[0]}::uuid, ${interviewIds[1]}::uuid)
        `;
        await transaction.$executeRaw`
          DELETE FROM "applications"
          WHERE "id" IN (${applicationIds[0]}::uuid, ${applicationIds[1]}::uuid)
        `;
        await transaction.$executeRaw`
          DELETE FROM "applicants" WHERE "id" IN (${applicantIds[0]}::uuid, ${applicantIds[1]}::uuid)
        `;
        await transaction.$executeRaw`
          DELETE FROM "vacancy_publications"
          WHERE "id" IN (${publicationIds[0]}::uuid, ${publicationIds[1]}::uuid)
        `;
        await transaction.$executeRaw`
          DELETE FROM "requests_to_fill"
          WHERE "id" IN (${requestIds[0]}::uuid, ${requestIds[1]}::uuid)
        `;
        await transaction.$executeRaw`
          DELETE FROM "merit_selection_criteria_sets"
          WHERE "id" IN (${criteriaSetIds[0]}::uuid, ${criteriaSetIds[1]}::uuid)
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
  },
);
