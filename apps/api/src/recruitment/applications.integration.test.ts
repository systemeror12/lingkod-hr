import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import { ApplicationsService } from './applications.service';

const enabled = process.env.DATABASE_E2E === 'true';

const APPLICATION_PERMISSIONS = [
  'recruitment.applications.read',
  'recruitment.applications.create',
  'recruitment.applications.update',
  'recruitment.applications.screen',
  'recruitment.applications.disqualify',
  'recruitment.applications.withdraw',
  'recruitment.applications.close',
];

function context(
  agencyId: string,
  userId: string,
  membershipId: string,
  requestId: string,
): RequestContext {
  return {
    agencyId,
    userId,
    membershipId,
    requestId,
    primaryOrganizationUnitId: null,
    permissions: APPLICATION_PERMISSIONS.map((code) => ({ code, scopePolicy: 'AGENCY' })),
  };
}

it.skipIf(!enabled)(
  'gates intake on the publication period and versions screening results',
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
        code: `APP-SERVICE-${suffix}`,
        name: 'Application Service Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        emailNormalized: `application-service-${suffix}@example.test`,
        displayName: 'Application Service User',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const qualificationId = randomUUID();
    const qualificationStandardId = randomUUID();
    const lateAuthorityDocumentVersionId = randomUUID();
    const lateAuthorityDocumentId = randomUUID();
    const unitId = randomUUID();
    const unitVersionId = randomUUID();
    const positionId = randomUUID();
    const positionVersionId = randomUUID();
    const publicationId = randomUUID();
    const requestId = randomUUID();
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.$executeRaw`
        INSERT INTO "documents"
          ("id", "agency_id", "document_no", "document_type", "classification", "status",
           "created_by_membership_id")
        VALUES
          (${lateAuthorityDocumentId}::uuid, ${agency.id}::uuid,
           ${`E2E-LATE-AUTHORITY-${suffix}`}, 'LATE_ACCEPTANCE_AUTHORITY', 'CONFIDENTIAL',
           'APPROVED', ${membership.id}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "document_versions"
          ("id", "agency_id", "document_id", "version_no", "storage_key", "content_hash",
           "mime_type", "size_bytes", "issued_at", "created_by_membership_id")
        VALUES
          (${lateAuthorityDocumentVersionId}::uuid, ${agency.id}::uuid,
           ${lateAuthorityDocumentId}::uuid, 1, ${`e2e/late-authority-${suffix}`},
           ${'a'.repeat(64)}, 'application/pdf', 1, now(), ${membership.id}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "qualification_standards"
          ("id", "agency_id", "code", "name", "status",
           "created_by_membership_id", "updated_by_membership_id")
        VALUES
          (${qualificationStandardId}::uuid, ${agency.id}::uuid,
           ${`QS-APP-SERVICE-${suffix}`}, 'Application Service Standard', 'ACTIVE',
           ${membership.id}::uuid, ${membership.id}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "qualification_standard_versions"
          ("id", "agency_id", "qualification_standard_id", "version_no",
           "education_requirement", "eligibility_requirement", "effective_from", "status",
           "domain_status", "created_by_membership_id", "updated_by_membership_id")
        VALUES
          (${qualificationId}::uuid, ${agency.id}::uuid, ${qualificationStandardId}::uuid, 1,
           'Bachelor degree', 'Career service', '2000-01-01'::date, 'DRAFT',
           'INACTIVE', ${membership.id}::uuid, ${membership.id}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "organization_units"
          ("id", "agency_id", "code", "unit_type", "status", "current_version_id")
        VALUES
          (${unitId}::uuid, ${agency.id}::uuid, ${`APP-UNIT-${suffix}`}, 'DIVISION',
           'ACTIVE', ${unitVersionId}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "organization_unit_versions"
          ("id", "agency_id", "organization_unit_id", "version_no", "name",
           "effective_from", "status", "domain_status")
        VALUES
          (${unitVersionId}::uuid, ${agency.id}::uuid, ${unitId}::uuid, 1,
           'Application Service Division', '2000-01-01'::date, 'ACTIVE', 'ACTIVE')
      `;
      await transaction.$executeRaw`
        INSERT INTO "plantilla_positions"
          ("id", "agency_id", "item_number", "status", "current_version_id",
           "created_by_membership_id", "updated_by_membership_id")
        VALUES
          (${positionId}::uuid, ${agency.id}::uuid, ${`APP-ITEM-${suffix}`}, 'VACANT',
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
        INSERT INTO "requests_to_fill"
          ("id", "agency_id", "request_no", "position_id", "requesting_unit_id",
           "requested_by_membership_id", "justification",
           "qualification_standard_version_id", "status",
           "created_by_membership_id", "updated_by_membership_id")
        VALUES
          (${requestId}::uuid, ${agency.id}::uuid,
           nextval('"requests_to_fill_request_no_seq"'), ${positionId}::uuid,
           ${unitId}::uuid, ${membership.id}::uuid, 'Application service fixture.',
           ${qualificationId}::uuid, 'APPROVED',
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
    });

    async function setPublicationPeriod(opening: string, closing: string): Promise<void> {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.$executeRaw`
          UPDATE "vacancy_publications"
          SET "opening_date" = ${opening}::date, "closing_date" = ${closing}::date
          WHERE "id" = ${publicationId}::uuid
        `;
      });
    }

    const documents = {
      resolveFinalizedVersionInTransaction: async (
        _transaction: unknown,
        _context: unknown,
        documentVersionId: string,
      ) => ({ id: documentVersionId, documentId: randomUUID() }),
    };
    const service = new ApplicationsService(documents as never);
    const requestContext = context(
      agency.id,
      user.id,
      membership.id,
      `application-service-${suffix}`,
    );
    const applicant = {
      firstName: 'Ana',
      lastName: 'Reyes',
      email: `ana-${suffix}@example.test`,
      privacyNoticeVersion: 'Privacy Notice v1',
      consentedAt: '2026-09-10T01:00:00.000Z',
    };

    try {
      await setPublicationPeriod('2999-01-01', '2999-01-31');
      await expect(
        service.createApplication(requestContext, {
          vacancyPublicationId: publicationId,
          applicant,
          documents: [],
        }),
      ).rejects.toMatchObject({ code: 'RECRUITMENT_PUBLICATION_NOT_YET_OPEN' });

      await setPublicationPeriod('1999-01-01', '2000-01-31');
      await expect(
        service.createApplication(requestContext, {
          vacancyPublicationId: publicationId,
          applicant,
          documents: [],
        }),
      ).rejects.toMatchObject({ code: 'RECRUITMENT_LATE_ACCEPTANCE_EVIDENCE_REQUIRED' });

      const lateApplication = await service.createApplication(requestContext, {
        vacancyPublicationId: publicationId,
        applicant: { ...applicant, email: `late-${suffix}@example.test` },
        lateAcceptanceReason: 'The applicant posted the package before the closing date.',
        lateAcceptanceAuthorityDocumentVersionId: lateAuthorityDocumentVersionId,
        documents: [],
      });
      expect(lateApplication.status).toBe('RECEIVED');
      expect(lateApplication.lateAcceptance).not.toBeNull();

      await setPublicationPeriod('2000-01-01', '2999-01-31');
      const application = await service.createApplication(requestContext, {
        vacancyPublicationId: publicationId,
        applicant,
        documents: [],
      });
      expect(application.status).toBe('RECEIVED');
      expect(application.qualificationStandard.applicableAreas).toEqual([
        'EDUCATION',
        'ELIGIBILITY',
      ]);

      const documentVersionId = lateAuthorityDocumentVersionId;
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.$executeRaw`
          INSERT INTO "application_documents"
            ("id", "agency_id", "application_id", "document_id", "document_version_id",
             "purpose", "linked_by_membership_id")
          VALUES
            (${randomUUID()}::uuid, ${agency.id}::uuid, ${application.id}::uuid,
             ${lateAuthorityDocumentId}::uuid, ${documentVersionId}::uuid, 'EDUCATION',
             ${membership.id}::uuid)
        `;
      });

      await expect(
        service.screenApplication(requestContext, application.id, {
          result: 'QUALIFIED',
          reason: 'Areas claim qualification while evidence is missing.',
          areaResults: [
            { area: 'EDUCATION', result: 'MEETS', evidenceDocumentVersionIds: [documentVersionId] },
            { area: 'ELIGIBILITY', result: 'UNVERIFIED', evidenceDocumentVersionIds: [] },
          ],
        }),
      ).rejects.toMatchObject({ code: 'RECRUITMENT_SCREENING_RESULT_MISMATCH' });

      await expect(
        service.screenApplication(requestContext, application.id, {
          result: 'QUALIFIED',
          reason: 'Qualification claimed without stated evidence.',
          areaResults: [
            { area: 'EDUCATION', result: 'MEETS', evidenceDocumentVersionIds: [] },
            {
              area: 'ELIGIBILITY',
              result: 'MEETS',
              evidenceDocumentVersionIds: [documentVersionId],
            },
          ],
        }),
      ).rejects.toMatchObject({ code: 'RECRUITMENT_SCREENING_EVIDENCE_REQUIRED' });

      const qualified = await service.screenApplication(requestContext, application.id, {
        result: 'QUALIFIED',
        reason: 'Education and eligibility evidence satisfy the bound standard.',
        areaResults: [
          { area: 'EDUCATION', result: 'MEETS', evidenceDocumentVersionIds: [documentVersionId] },
          { area: 'ELIGIBILITY', result: 'MEETS', evidenceDocumentVersionIds: [documentVersionId] },
        ],
      });
      expect(qualified.status).toBe('QUALIFIED');
      expect(qualified.latestScreening?.versionNo).toBe(1);

      const corrected = await service.correctScreening(
        requestContext,
        application.id,
        qualified.latestScreening?.id ?? '',
        {
          result: 'NOT_QUALIFIED',
          reason: 'The eligibility evidence does not satisfy the bound standard.',
          correctionReason: 'The eligibility document was misread in version 1.',
          areaResults: [
            { area: 'EDUCATION', result: 'MEETS', evidenceDocumentVersionIds: [documentVersionId] },
            {
              area: 'ELIGIBILITY',
              result: 'DOES_NOT_MEET',
              evidenceDocumentVersionIds: [documentVersionId],
            },
          ],
        },
      );
      expect(corrected.status).toBe('NOT_QUALIFIED');
      expect(corrected.screenings.map(({ versionNo }) => versionNo)).toEqual([1, 2]);
      expect(corrected.latestScreening?.replacesScreeningId).toBe(qualified.latestScreening?.id);

      await expect(
        service.correctScreening(
          requestContext,
          application.id,
          qualified.latestScreening?.id ?? '',
          {
            result: 'QUALIFIED',
            reason: 'Attempt to replace an already replaced result.',
            correctionReason: 'Invalid source.',
            areaResults: [
              {
                area: 'EDUCATION',
                result: 'MEETS',
                evidenceDocumentVersionIds: [documentVersionId],
              },
              {
                area: 'ELIGIBILITY',
                result: 'MEETS',
                evidenceDocumentVersionIds: [documentVersionId],
              },
            ],
          },
        ),
      ).rejects.toMatchObject({ code: 'RECRUITMENT_SCREENING_SOURCE_INVALID' });

      const closed = await service.closeApplication(
        requestContext,
        application.id,
        'Notice and screening history handled.',
      );
      expect(closed.status).toBe('CLOSED');
      expect(closed.latestScreening?.versionNo).toBe(2);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.$executeRaw`
          DELETE FROM "audit_events" WHERE "agency_id" = ${agency.id}::uuid
        `;
        await transaction.$executeRaw`
          DELETE FROM "application_screening_evidence" WHERE "agency_id" = ${agency.id}::uuid
        `;
        await transaction.$executeRaw`
          DELETE FROM "application_screenings" WHERE "agency_id" = ${agency.id}::uuid
        `;
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
        await transaction.$executeRaw`
          DELETE FROM "document_versions" WHERE "agency_id" = ${agency.id}::uuid
        `;
        await transaction.$executeRaw`
          DELETE FROM "documents" WHERE "agency_id" = ${agency.id}::uuid
        `;
      });
      await admin.agencyMembership.deleteMany({ where: { agencyId: agency.id } });
      await admin.agency.delete({ where: { id: agency.id } });
      await admin.user.delete({ where: { id: user.id } });
      await app.$disconnect();
      await admin.$disconnect();
    }
  },
);
