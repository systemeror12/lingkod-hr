import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import { ApplicationsService } from './applications.service';
import { EvaluationsService } from './evaluations.service';

const enabled = process.env.DATABASE_E2E === 'true';

const PERMISSIONS = [
  'recruitment.applications.read',
  'recruitment.applications.screen',
  'recruitment.applications.withdraw',
  'recruitment.assessments.manage',
  'recruitment.interviews.manage',
];

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
          weight: 70,
          minimumScore: 0,
          maximumScore: 100,
          passingScore: 70,
          evidenceRequired: false,
          commentsRequired: false,
          evaluatorRoleCodes: ['hrmo_administrator'],
        },
        {
          criterionCode: 'DOCUMENTATION',
          label: 'Documentation quality',
          criterionType: 'RATING_SCALE',
          weight: 30,
          ratingScale: [
            { code: 'LOW', label: 'Low', value: 0 },
            { code: 'SATISFACTORY', label: 'Satisfactory', value: 50 },
            { code: 'HIGH', label: 'High', value: 100 },
          ],
          passingScore: 50,
          evidenceRequired: true,
          commentsRequired: false,
          evaluatorRoleCodes: ['hrmo_administrator'],
        },
      ],
      aggregation: {
        method: 'WEIGHTED_AVERAGE',
        evaluatorMethod: 'MEAN',
        rounding: { mode: 'HALF_UP', decimals: 2 },
        passingScore: 70,
        tieBreakers: ['JOB_KNOWLEDGE'],
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
        commentsRequired: true,
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

function context(
  agencyId: string,
  userId: string,
  membershipId: string,
  requestId: string,
  permissions: string[],
): RequestContext {
  return {
    agencyId,
    userId,
    membershipId,
    requestId,
    primaryOrganizationUnitId: null,
    permissions: permissions.map((code) => ({ code, scopePolicy: 'AGENCY' })),
  };
}

it.skipIf(!enabled)(
  'runs configured assessment and interview stages from the bound criteria set',
  async () => {
    const runtimeUrl = process.env.DATABASE_URL;
    const adminUrl = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
    if (!runtimeUrl || !adminUrl)
      throw new Error('Runtime and administrative database URLs are required.');
    const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const agency = await admin.agency.create({
      data: {
        code: `EVAL-SERVICE-${suffix}`,
        name: 'Evaluation Service Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        identityProvider: 'evaluation-service-e2e',
        externalSubject: `evaluation-service-${suffix}`,
        emailNormalized: `evaluation-service-${suffix}@example.test`,
        displayName: 'Evaluation Service User',
        globalStatus: 'ACTIVE',
      },
    });
    const ineligibleUser = await admin.user.create({
      data: {
        identityProvider: 'evaluation-service-e2e',
        externalSubject: `evaluation-ineligible-${suffix}`,
        emailNormalized: `evaluation-ineligible-${suffix}@example.test`,
        displayName: 'Ineligible Evaluator',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const ineligibleMembership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: ineligibleUser.id, status: 'ACTIVE' },
    });
    const evaluatorRole = await admin.role.findFirstOrThrow({
      where: { agencyId: null, code: 'hrmo_administrator' },
    });
    await admin.membershipRole.create({
      data: {
        agencyId: agency.id,
        membershipId: membership.id,
        roleId: evaluatorRole.id,
        effectiveFrom: new Date('2020-01-01'),
      },
    });

    const qualificationId = randomUUID();
    const qualificationStandardId = randomUUID();
    const unitId = randomUUID();
    const unitVersionId = randomUUID();
    const positionId = randomUUID();
    const positionVersionId = randomUUID();
    const publicationId = randomUUID();
    const requestId = randomUUID();
    const planId = randomUUID();
    const criteriaSetId = randomUUID();
    const applicantId = randomUUID();
    const applicationId = randomUUID();
    const documentId = randomUUID();
    const documentVersionId = randomUUID();
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.$executeRaw`
        INSERT INTO "documents"
          ("id", "agency_id", "document_no", "document_type", "classification", "status",
           "created_by_membership_id")
        VALUES
          (${documentId}::uuid, ${agency.id}::uuid, ${`E2E-EVALUATION-${suffix}`},
           'ASSESSMENT_EVIDENCE', 'CONFIDENTIAL', 'APPROVED', ${membership.id}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "document_versions"
          ("id", "agency_id", "document_id", "version_no", "storage_key", "content_hash",
           "mime_type", "size_bytes", "issued_at", "created_by_membership_id")
        VALUES
          (${documentVersionId}::uuid, ${agency.id}::uuid, ${documentId}::uuid, 1,
           ${`e2e/evaluation-${suffix}`}, ${'a'.repeat(64)}, 'application/pdf', 1, now(),
           ${membership.id}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "qualification_standards"
          ("id", "agency_id", "code", "name", "status",
           "created_by_membership_id", "updated_by_membership_id")
        VALUES
          (${qualificationStandardId}::uuid, ${agency.id}::uuid,
           ${`QS-EVAL-${suffix}`}, 'Evaluation Standard', 'ACTIVE',
           ${membership.id}::uuid, ${membership.id}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "qualification_standard_versions"
          ("id", "agency_id", "qualification_standard_id", "version_no",
           "education_requirement", "effective_from", "status", "domain_status",
           "created_by_membership_id", "updated_by_membership_id")
        VALUES
          (${qualificationId}::uuid, ${agency.id}::uuid, ${qualificationStandardId}::uuid, 1,
           'Bachelor degree', '2000-01-01'::date, 'DRAFT', 'INACTIVE',
           ${membership.id}::uuid, ${membership.id}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "organization_units"
          ("id", "agency_id", "code", "unit_type", "status", "current_version_id")
        VALUES
          (${unitId}::uuid, ${agency.id}::uuid, ${`EVAL-UNIT-${suffix}`}, 'DIVISION',
           'ACTIVE', ${unitVersionId}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "organization_unit_versions"
          ("id", "agency_id", "organization_unit_id", "version_no", "name",
           "effective_from", "status", "domain_status")
        VALUES
          (${unitVersionId}::uuid, ${agency.id}::uuid, ${unitId}::uuid, 1,
           'Evaluation Division', '2000-01-01'::date, 'ACTIVE', 'ACTIVE')
      `;
      await transaction.$executeRaw`
        INSERT INTO "plantilla_positions"
          ("id", "agency_id", "item_number", "status", "current_version_id",
           "created_by_membership_id", "updated_by_membership_id")
        VALUES
          (${positionId}::uuid, ${agency.id}::uuid, ${`EVAL-ITEM-${suffix}`}, 'VACANT',
           ${positionVersionId}::uuid, ${membership.id}::uuid, ${membership.id}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "plantilla_position_versions"
          ("id", "agency_id", "position_id", "organization_unit_id",
           "qualification_standard_version_id", "staffing_authority_id", "version_no",
           "position_title", "salary_grade", "funding_source", "employment_category",
           "effective_from", "status", "domain_status",
           "created_by_membership_id", "updated_by_membership_id")
        VALUES
          (${positionVersionId}::uuid, ${agency.id}::uuid, ${positionId}::uuid,
           ${unitId}::uuid, ${qualificationId}::uuid, ${randomUUID()}::uuid, 1,
           'Human Resource Management Officer III', 18, 'General Appropriations Act',
           'PLANTILLA', '2000-01-01'::date, 'ACTIVE', 'VACANT',
           ${membership.id}::uuid, ${membership.id}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "agency_merit_selection_plan_versions"
          ("id", "agency_id", "plan_code", "version_no", "applicability",
           "effective_from", "status", "created_by_membership_id", "updated_by_membership_id")
        VALUES
          (${planId}::uuid, ${agency.id}::uuid, ${`EVAL-MSP-${suffix}`}, 1, '{}'::jsonb,
           '2000-01-01'::date, 'ACTIVE', ${membership.id}::uuid, ${membership.id}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "merit_selection_criteria_sets"
          ("id", "agency_id", "plan_version_id", "criteria_code", "applicability",
           "criteria_definition", "status", "created_by_membership_id", "updated_by_membership_id")
        VALUES
          (${criteriaSetId}::uuid, ${agency.id}::uuid, ${planId}::uuid,
           ${`EVAL-CRITERIA-${suffix}`}, '{}'::jsonb,
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
           nextval('"requests_to_fill_request_no_seq"'), ${positionId}::uuid,
           ${unitId}::uuid, ${membership.id}::uuid, 'Evaluation service fixture.',
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
           '2000-01-01'::date, '2999-01-31'::date, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb,
           '{}'::jsonb, 'PUBLISHED', now(), ${membership.id}::uuid, ${membership.id}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "applicants"
          ("id", "agency_id", "first_name", "last_name", "privacy_notice_version",
           "consented_at", "deduplication_key", "created_by_membership_id")
        VALUES
          (${applicantId}::uuid, ${agency.id}::uuid, 'Ana', 'Reyes', 'Privacy Notice v1',
           '2026-01-02T00:00:00Z'::timestamptz, ${`eval-dedup-${suffix}`},
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
    });

    const documents = {
      resolveFinalizedVersionInTransaction: async (
        _transaction: unknown,
        _context: unknown,
        requestedDocumentVersionId: string,
      ) => ({ id: requestedDocumentVersionId, documentId }),
    };
    const service = new EvaluationsService(documents as never);
    const requestContext = context(
      agency.id,
      user.id,
      membership.id,
      `evaluation-service-${suffix}`,
      PERMISSIONS,
    );
    const ineligibleContext = context(
      agency.id,
      ineligibleUser.id,
      ineligibleMembership.id,
      `evaluation-ineligible-${suffix}`,
      PERMISSIONS,
    );

    try {
      const scheduled = await service.scheduleAssessment(
        requestContext,
        applicationId,
        { stageCode: 'WRITTEN_EXAM' },
        `schedule-${suffix}`,
      );
      expect(scheduled.status).toBe('FOR_ASSESSMENT');
      let assessmentId = scheduled.assessments[0]?.id as string;
      expect(assessmentId).toBeTruthy();
      expect(scheduled.assessments[0]?.status).toBe('SCHEDULED');
      expect(scheduled.selectionPlan?.stages.map(({ status }) => status)).toEqual([
        'CURRENT',
        'PENDING',
      ]);

      const replayedSchedule = await service.scheduleAssessment(
        requestContext,
        applicationId,
        { stageCode: 'WRITTEN_EXAM' },
        `schedule-${suffix}`,
      );
      expect(replayedSchedule.assessments).toHaveLength(1);
      await expect(
        service.scheduleAssessment(
          requestContext,
          applicationId,
          { stageCode: 'PANEL_INTERVIEW' },
          `schedule-${suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'RECRUITMENT_IDEMPOTENCY_CONFLICT' });

      await expect(
        service.scheduleInterview(
          requestContext,
          applicationId,
          { stageCode: 'PANEL_INTERVIEW', scheduledAt: '2026-09-20T01:00:00.000Z' },
          `interview-early-${suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'RECRUITMENT_STAGE_OUT_OF_ORDER' });

      const cancelled = await service.cancelAssessment(
        requestContext,
        applicationId,
        assessmentId,
        'The assigned examiner was reassigned.',
        `cancel-assessment-${suffix}`,
      );
      expect(cancelled.assessments.find(({ id }) => id === assessmentId)?.status).toBe('CANCELLED');

      const rescheduled = await service.scheduleAssessment(
        requestContext,
        applicationId,
        { stageCode: 'WRITTEN_EXAM' },
        `reschedule-${suffix}`,
      );
      assessmentId = rescheduled.assessments.find(({ status }) => status === 'SCHEDULED')
        ?.id as string;
      const noShow = await service.recordAssessmentNoShow(
        requestContext,
        applicationId,
        assessmentId,
        'The applicant did not appear for the scheduled assessment.',
        `noshow-assessment-${suffix}`,
      );
      expect(noShow.assessments.find(({ id }) => id === assessmentId)?.status).toBe('NO_SHOW');

      const activeSchedule = await service.scheduleAssessment(
        requestContext,
        applicationId,
        { stageCode: 'WRITTEN_EXAM' },
        `schedule-active-${suffix}`,
      );
      assessmentId = activeSchedule.assessments.find(({ status }) => status === 'SCHEDULED')
        ?.id as string;

      await expect(
        service.recordAssessmentResult(
          ineligibleContext,
          applicationId,
          assessmentId,
          { criterionCode: 'JOB_KNOWLEDGE', score: 85 },
          `ineligible-${suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'RECRUITMENT_EVALUATOR_NOT_ELIGIBLE' });

      const partial = await service.recordAssessmentResult(
        requestContext,
        applicationId,
        assessmentId,
        { criterionCode: 'JOB_KNOWLEDGE', score: 85 },
        `result-job-${suffix}`,
      );
      expect(partial.assessments.find(({ id }) => id === assessmentId)?.aggregate).toBeNull();

      const replayedResult = await service.recordAssessmentResult(
        requestContext,
        applicationId,
        assessmentId,
        { criterionCode: 'JOB_KNOWLEDGE', score: 85 },
        `result-job-${suffix}`,
      );
      expect(
        replayedResult.assessments
          .find(({ id }) => id === assessmentId)
          ?.results.filter(({ criterionCode }) => criterionCode === 'JOB_KNOWLEDGE'),
      ).toHaveLength(1);

      await expect(
        service.recordAssessmentResult(
          requestContext,
          applicationId,
          assessmentId,
          { criterionCode: 'DOCUMENTATION', score: 50, rating: 'SATISFACTORY' },
          `result-missing-evidence-${suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'RECRUITMENT_ASSESSMENT_RESULT_INVALID' });

      await expect(
        service.recordAssessmentResult(
          requestContext,
          applicationId,
          assessmentId,
          { criterionCode: 'DOCUMENTATION', score: 50, rating: 'HIGH' },
          `result-mismatch-${suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'RECRUITMENT_ASSESSMENT_RESULT_INVALID' });

      const recorded = await service.recordAssessmentResult(
        requestContext,
        applicationId,
        assessmentId,
        {
          criterionCode: 'DOCUMENTATION',
          score: 50,
          rating: 'SATISFACTORY',
          evidenceDocumentVersionId: documentVersionId,
        },
        `result-documentation-${suffix}`,
      );
      expect(recorded.assessments.find(({ id }) => id === assessmentId)?.aggregate?.value).toBe(
        '74.50',
      );
      expect(recorded.assessments.find(({ id }) => id === assessmentId)?.aggregate?.passed).toBe(
        true,
      );
      expect(
        recorded.assessments.find(({ id }) => id === assessmentId)?.aggregate?.ruleVersionId,
      ).toBe(criteriaSetId);
      expect(
        recorded.assessments.find(({ id }) => id === assessmentId)?.aggregate?.rounding,
      ).toEqual({
        mode: 'HALF_UP',
        decimals: 2,
      });

      const completed = await service.completeAssessment(
        requestContext,
        applicationId,
        assessmentId,
        `complete-assessment-${suffix}`,
      );
      expect(completed.assessments.find(({ id }) => id === assessmentId)?.status).toBe('COMPLETED');
      expect(completed.selectionPlan?.stages.map(({ status }) => status)).toEqual([
        'COMPLETE',
        'CURRENT',
      ]);

      const sourceResultId = completed.assessments
        .find(({ id }) => id === assessmentId)
        ?.results.find(({ criterionCode }) => criterionCode === 'JOB_KNOWLEDGE')?.id as string;
      const corrected = await service.correctAssessmentResult(
        requestContext,
        applicationId,
        assessmentId,
        sourceResultId,
        {
          criterionCode: 'JOB_KNOWLEDGE',
          score: 90,
          correctionReason: 'The answer sheet was scored against the wrong key.',
        },
        `correct-result-${suffix}`,
      );
      expect(corrected.assessments.find(({ id }) => id === assessmentId)?.results).toHaveLength(3);
      expect(corrected.assessments.find(({ id }) => id === assessmentId)?.results[0]?.score).toBe(
        '85',
      );
      expect(corrected.assessments.find(({ id }) => id === assessmentId)?.aggregate?.value).toBe(
        '78.00',
      );
      expect(corrected.assessments.find(({ id }) => id === assessmentId)?.aggregate?.passed).toBe(
        true,
      );

      const interviewScheduled = await service.scheduleInterview(
        requestContext,
        applicationId,
        { stageCode: 'PANEL_INTERVIEW', scheduledAt: '2026-09-20T01:00:00.000Z' },
        `schedule-interview-${suffix}`,
      );
      expect(interviewScheduled.status).toBe('FOR_INTERVIEW');
      let interviewId = interviewScheduled.interviews[0]?.id as string;

      const interviewNoShow = await service.recordInterviewNoShow(
        requestContext,
        applicationId,
        interviewId,
        'The panel did not convene at the scheduled time.',
        `noshow-interview-${suffix}`,
      );
      expect(interviewNoShow.interviews.find(({ id }) => id === interviewId)?.status).toBe(
        'NO_SHOW',
      );

      const interviewRescheduled = await service.scheduleInterview(
        requestContext,
        applicationId,
        { stageCode: 'PANEL_INTERVIEW', scheduledAt: '2026-09-21T01:00:00.000Z' },
        `reschedule-interview-${suffix}`,
      );
      interviewId = interviewRescheduled.interviews.find(({ status }) => status === 'SCHEDULED')
        ?.id as string;

      await expect(
        service.completeInterview(
          requestContext,
          applicationId,
          interviewId,
          `complete-early-interview-${suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'RECRUITMENT_INTERVIEW_FEEDBACK_REQUIRED' });

      const feedback = await service.recordInterviewFeedback(
        requestContext,
        applicationId,
        interviewId,
        {
          score: 80,
          recommendation: 'PROCEED',
          comments: 'The panel recommends the applicant for the vacancy.',
        },
        `feedback-${suffix}`,
      );
      expect(feedback.interviews.find(({ id }) => id === interviewId)?.aggregate?.value).toBe(
        '80.00',
      );

      const interviewCompleted = await service.completeInterview(
        requestContext,
        applicationId,
        interviewId,
        `complete-interview-${suffix}`,
      );
      expect(interviewCompleted.interviews.find(({ id }) => id === interviewId)?.status).toBe(
        'COMPLETED',
      );
      expect(interviewCompleted.selectionPlan?.stages.map(({ status }) => status)).toEqual([
        'COMPLETE',
        'COMPLETE',
      ]);

      const applications = new ApplicationsService(documents as never);
      const withdrawn = await applications.withdrawApplication(
        requestContext,
        applicationId,
        {
          reason: 'The applicant withdrew after the configured evaluation stages.',
          evidenceDocumentVersionId: documentVersionId,
        },
        `withdraw-${suffix}`,
      );
      expect(withdrawn.status).toBe('WITHDRAWN');
      await expect(
        service.recordAssessmentResult(
          requestContext,
          applicationId,
          assessmentId,
          { criterionCode: 'JOB_KNOWLEDGE', score: 95 },
          `frozen-${suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'RECRUITMENT_INVALID_TRANSITION' });
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.$executeRaw`DELETE FROM "audit_events" WHERE "agency_id" = ${agency.id}::uuid`;
        await transaction.$executeRaw`
          DELETE FROM "assessment_result_versions" WHERE "agency_id" = ${agency.id}::uuid
        `;
        await transaction.$executeRaw`DELETE FROM "assessments" WHERE "agency_id" = ${agency.id}::uuid`;
        await transaction.$executeRaw`
          DELETE FROM "interview_feedback_versions" WHERE "agency_id" = ${agency.id}::uuid
        `;
        await transaction.$executeRaw`DELETE FROM "interviews" WHERE "agency_id" = ${agency.id}::uuid`;
        await transaction.$executeRaw`
          DELETE FROM "application_documents" WHERE "agency_id" = ${agency.id}::uuid
        `;
        await transaction.$executeRaw`DELETE FROM "applications" WHERE "agency_id" = ${agency.id}::uuid`;
        await transaction.$executeRaw`DELETE FROM "applicants" WHERE "agency_id" = ${agency.id}::uuid`;
        await transaction.$executeRaw`
          DELETE FROM "vacancy_publications" WHERE "agency_id" = ${agency.id}::uuid
        `;
        await transaction.$executeRaw`
          DELETE FROM "requests_to_fill" WHERE "agency_id" = ${agency.id}::uuid
        `;
        await transaction.$executeRaw`
          DELETE FROM "merit_selection_criteria_sets" WHERE "agency_id" = ${agency.id}::uuid
        `;
        await transaction.$executeRaw`
          DELETE FROM "agency_merit_selection_plan_versions" WHERE "agency_id" = ${agency.id}::uuid
        `;
        await transaction.$executeRaw`
          DELETE FROM "plantilla_position_versions" WHERE "agency_id" = ${agency.id}::uuid
        `;
        await transaction.$executeRaw`
          DELETE FROM "plantilla_positions" WHERE "agency_id" = ${agency.id}::uuid
        `;
        await transaction.$executeRaw`
          DELETE FROM "organization_unit_versions" WHERE "agency_id" = ${agency.id}::uuid
        `;
        await transaction.$executeRaw`
          DELETE FROM "organization_units" WHERE "agency_id" = ${agency.id}::uuid
        `;
        await transaction.$executeRaw`
          DELETE FROM "qualification_standard_versions" WHERE "agency_id" = ${agency.id}::uuid
        `;
        await transaction.$executeRaw`
          DELETE FROM "qualification_standards" WHERE "agency_id" = ${agency.id}::uuid
        `;
        await transaction.$executeRaw`DELETE FROM "document_versions" WHERE "agency_id" = ${agency.id}::uuid`;
        await transaction.$executeRaw`DELETE FROM "documents" WHERE "agency_id" = ${agency.id}::uuid`;
      });
      await admin.membershipRole.deleteMany({ where: { agencyId: agency.id } });
      await admin.agencyMembership.deleteMany({ where: { agencyId: agency.id } });
      await admin.agency.delete({ where: { id: agency.id } });
      await admin.user.deleteMany({ where: { id: { in: [user.id, ineligibleUser.id] } } });
      await app.$disconnect();
      await admin.$disconnect();
    }
  },
);
