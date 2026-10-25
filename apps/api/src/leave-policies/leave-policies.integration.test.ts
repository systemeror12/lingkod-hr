import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import { leavePolicyAuditWriter, LeavePoliciesService } from './leave-policies.service';
import {
  mandatoryLeaveAssessmentAuditWriter,
  MandatoryLeaveAssessmentsService,
} from '../mandatory-leave-assessments/mandatory-leave-assessments.service';

const enabled = process.env.DATABASE_E2E === 'true';

function createContext(agencyId: string, userId: string, membershipId: string): RequestContext {
  return {
    requestId: 'leave-policy-integration-test',
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions: [
      { code: 'leave.types.read', scopePolicy: 'AGENCY' },
      { code: 'leave.types.manage', scopePolicy: 'AGENCY' },
      { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
    ],
  };
}

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

async function createAdminClient(): Promise<PrismaClient> {
  const databaseUrl =
    process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!databaseUrl) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

async function createEvidence(
  admin: PrismaClient,
  agencyId: string,
  membershipId: string,
  suffix: string,
) {
  const document = await admin.document.create({
    data: {
      agencyId,
      documentType: 'LEAVE_POLICY',
      classification: 'INTERNAL',
      status: 'DRAFT',
      createdByMembershipId: membershipId,
    },
  });
  const version = await admin.documentVersion.create({
    data: {
      agencyId,
      documentId: document.id,
      versionNo: 1,
      storageKey: `leave-policy-integration/${suffix}`,
      contentHash: 'c'.repeat(64),
      mimeType: 'application/pdf',
      sizeBytes: 1,
      issuedAt: new Date(`${manilaDate(-30)}T00:00:00.000Z`),
      createdByMembershipId: membershipId,
    },
  });
  await admin.document.update({
    where: { id: document.id },
    data: { currentVersionId: version.id },
  });
  return document.id;
}

it.skipIf(!enabled)(
  'activates, supersedes, and protects Leave Policy Version history',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-leave-policy-service`;
    const agency = await admin.agency.create({
      data: {
        code: `LV-${suffix}`,
        name: 'Leave Policy Integration Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const foreignAgency = await admin.agency.create({
      data: {
        code: `LV-F-${suffix}`,
        name: 'Leave Policy Foreign Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        emailNormalized: `leave-policy-${suffix}@example.test`,
        displayName: 'Leave Policy Integration User',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const foreignMembership = await admin.agencyMembership.create({
      data: { agencyId: foreignAgency.id, userId: user.id, status: 'ACTIVE' },
    });
    const context = createContext(agency.id, user.id, membership.id);
    const foreignContext = createContext(foreignAgency.id, user.id, foreignMembership.id);
    const service = new LeavePoliciesService(
      leavePolicyAuditWriter,
      new DocumentsService({} as never, documentAuditWriter),
      new MandatoryLeaveAssessmentsService(mandatoryLeaveAssessmentAuditWriter),
    );
    const nationalEvidenceId = await createEvidence(
      admin,
      agency.id,
      membership.id,
      `${suffix}-national`,
    );
    const agencyEvidenceId = await createEvidence(
      admin,
      agency.id,
      membership.id,
      `${suffix}-agency`,
    );
    const foreignEvidenceId = await createEvidence(
      admin,
      foreignAgency.id,
      foreignMembership.id,
      `${suffix}-foreign`,
    );
    const agencyIds = [agency.id, foreignAgency.id];

    try {
      expect(service.listCatalogue(context)).toHaveLength(16);

      const mandatory = await service.create(context, { catalogueCode: 'MANDATORY_LEAVE' });
      await expect(
        service.createPolicyVersion(context, mandatory.id, {
          effectiveDate: manilaDate(-9),
          approvalRouteCode: 'LEAVE-ROUTE-1',
          applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
          documentRequirements: {},
          reason: 'Mandatory leave requires a charged account.',
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_POLICY_CHARGED_TYPE_REQUIRED' });

      const vacation = await service.create(context, { catalogueCode: 'VACATION_LEAVE' });
      await expect(
        service.create(context, { catalogueCode: 'VACATION_LEAVE' }),
      ).rejects.toMatchObject({ code: 'LEAVE_TYPE_EXISTS' });

      const draft = await service.createPolicyVersion(context, vacation.id, {
        effectiveDate: manilaDate(-9),
        approvalRouteCode: 'LEAVE-ROUTE-1',
        applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
        documentRequirements: { additional: ['MEDICAL_CERTIFICATE'] },
        reason: 'Adopt the standard vacation leave policy.',
      });
      expect(draft.status).toBe('DRAFT');
      expect(draft.documentRequirements.required).toEqual(['SIGNED_LEAVE_APPLICATION_FORM']);
      expect(draft.documentRequirements.additional).toEqual(['MEDICAL_CERTIFICATE']);

      const mandatoryDraft = await service.createPolicyVersion(context, mandatory.id, {
        effectiveDate: manilaDate(-9),
        approvalRouteCode: 'LEAVE-ROUTE-1',
        applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
        documentRequirements: {},
        reason: 'Mandatory leave charges the vacation account.',
      });
      await service.linkAuthority(context, mandatory.id, mandatoryDraft.id, {
        authorityClass: 'NATIONAL_RULE',
        documentId: nationalEvidenceId,
        citation: 'Rule XVI, section 4',
      });
      await service.linkAuthority(context, mandatory.id, mandatoryDraft.id, {
        authorityClass: 'AGENCY_CONFIGURATION',
        documentId: agencyEvidenceId,
        citation: 'Agency mandatory leave schedule',
        validationReason: 'Approved by the agency head.',
      });
      await service.update(context, vacation.id, { status: 'INACTIVE' });
      await expect(
        service.activate(context, mandatory.id, mandatoryDraft.id, 'Activate mandatory leave.'),
      ).rejects.toMatchObject({
        code: 'LEAVE_POLICY_INDETERMINATE',
        reasons: expect.arrayContaining(['MISSING_CHARGED_LEAVE_TYPE']),
      });
      await service.update(context, vacation.id, { status: 'ACTIVE' });
      await service.activate(context, mandatory.id, mandatoryDraft.id, 'Activate mandatory leave.');

      await expect(
        service.createPolicyVersion(context, vacation.id, {
          effectiveDate: manilaDate(1),
          approvalRouteCode: 'LEAVE-ROUTE-1',
          applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
          documentRequirements: {},
          reason: 'A second draft is not allowed.',
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_POLICY_DRAFT_EXISTS' });

      await expect(
        service.activate(context, vacation.id, draft.id, 'Activate the initial policy.'),
      ).rejects.toMatchObject({
        code: 'LEAVE_POLICY_INDETERMINATE',
        reasons: expect.arrayContaining(['MISSING_NATIONAL_RULE_AUTHORITY']),
      });

      await expect(
        service.linkAuthority(context, vacation.id, draft.id, {
          authorityClass: 'NATIONAL_RULE',
          documentId: foreignEvidenceId,
          citation: 'Foreign instrument',
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_POLICY_AUTHORITY_INELIGIBLE' });

      await service.linkAuthority(context, vacation.id, draft.id, {
        authorityClass: 'NATIONAL_RULE',
        documentId: nationalEvidenceId,
        citation: 'Rule XVI, sections 1-3',
        validationReason: 'Reviewed the Omnibus Rules on Leave.',
      });

      await service.linkAuthority(context, vacation.id, draft.id, {
        authorityClass: 'NATIONAL_RULE',
        documentId: nationalEvidenceId,
        citation: 'Rule XVI, section 5',
      });
      await expect(
        service.linkAuthority(context, vacation.id, draft.id, {
          authorityClass: 'NATIONAL_RULE',
          documentId: nationalEvidenceId,
          citation: '  Rule XVI, section 5  ',
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_POLICY_AUTHORITY_EXISTS' });

      const activated = await service.activate(
        context,
        vacation.id,
        draft.id,
        'Activate the initial policy.',
        'activate-v1',
      );
      expect(activated.currentVersion?.id).toBe(draft.id);

      const activatedAgain = await service.activate(
        context,
        vacation.id,
        draft.id,
        'Activate the initial policy.',
        'activate-v1',
      );
      expect(activatedAgain.currentVersion?.id).toBe(draft.id);
      await expect(
        service.activate(context, vacation.id, draft.id, 'Different reason.', 'activate-v1'),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      await expect(
        admin.auditEvent.count({
          where: {
            agencyId: agency.id,
            action: 'LEAVE_POLICY_VERSION_ACTIVATED',
            entityId: vacation.id,
          },
        }),
      ).resolves.toBe(1);

      const resolved = await service.findById(context, vacation.id, manilaDate(-9));
      expect(resolved?.effective?.id).toBe(draft.id);
      expect(resolved?.configuration).toEqual({ result: 'RESOLVED', reasons: [] });

      const beforeEffective = await service.findById(context, vacation.id, manilaDate(-40));
      expect(beforeEffective?.effective).toBeNull();
      expect(beforeEffective?.configuration).toEqual({
        result: 'INDETERMINATE',
        reasons: ['NO_EFFECTIVE_POLICY_VERSION'],
      });

      const successor = await service.createPolicyVersion(context, vacation.id, {
        effectiveDate: manilaDate(1),
        approvalRouteCode: 'LEAVE-ROUTE-1',
        applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
        documentRequirements: {},
        reason: 'Refresh the policy for the next year.',
      });
      await service.linkAuthority(context, vacation.id, successor.id, {
        authorityClass: 'NATIONAL_RULE',
        documentId: nationalEvidenceId,
        citation: 'Rule XVI, sections 1-3',
      });
      const successorActivated = await service.activate(
        context,
        vacation.id,
        successor.id,
        'The later version takes effect tomorrow.',
        'activate-v2',
      );
      expect(successorActivated.currentVersion?.id).toBe(draft.id);

      const today = await service.findById(context, vacation.id, manilaDate(0));
      expect(today?.effective?.id).toBe(draft.id);
      expect(today?.effective?.effectiveTo).toBe(manilaDate(0));
      expect(today?.configuration.result).toBe('RESOLVED');

      const tomorrow = await service.findById(context, vacation.id, manilaDate(1));
      expect(tomorrow?.effective?.id).toBe(successor.id);

      const detail = await service.findById(context, vacation.id);
      expect(detail?.history.map(({ action }) => action)).toEqual(
        expect.arrayContaining([
          'LEAVE_TYPE_CREATED',
          'LEAVE_POLICY_VERSION_CREATED',
          'LEAVE_POLICY_AUTHORITY_LINKED',
          'LEAVE_POLICY_VERSION_ACTIVATED',
        ]),
      );
      expect(detail?.versions.map(({ status }) => status)).toEqual(
        expect.arrayContaining(['SUPERSEDED', 'ACTIVE']),
      );

      const wellness = await service.create(context, { catalogueCode: 'WELLNESS_LEAVE' });
      const wellnessDraft = await service.createPolicyVersion(context, wellness.id, {
        effectiveDate: manilaDate(-5),
        approvalRouteCode: 'LEAVE-ROUTE-1',
        applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
        documentRequirements: {},
        reason: 'Agency discretionary wellness leave.',
      });
      await service.linkAuthority(context, wellness.id, wellnessDraft.id, {
        authorityClass: 'NATIONAL_RULE',
        documentId: nationalEvidenceId,
        citation: 'CSC MC No. 1, s. 2026',
      });
      await expect(
        service.activate(context, wellness.id, wellnessDraft.id, 'Activate wellness leave.'),
      ).rejects.toMatchObject({
        code: 'LEAVE_POLICY_INDETERMINATE',
        reasons: expect.arrayContaining(['MISSING_AGENCY_CONFIGURATION_AUTHORITY']),
      });
      await service.linkAuthority(context, wellness.id, wellnessDraft.id, {
        authorityClass: 'AGENCY_CONFIGURATION',
        documentId: agencyEvidenceId,
        citation: 'Agency Wellness Leave policy',
        validationReason: 'Approved by the agency head.',
      });
      const wellnessActivated = await service.activate(
        context,
        wellness.id,
        wellnessDraft.id,
        'Activate wellness leave with agency configuration.',
      );
      expect(wellnessActivated.currentVersion?.id).toBe(wellnessDraft.id);

      const sick = await service.create(context, { catalogueCode: 'SICK_LEAVE' });
      const sickDraft = await service.createPolicyVersion(context, sick.id, {
        effectiveDate: manilaDate(-5),
        approvalRouteCode: 'LEAVE-ROUTE-1',
        applicability: { profiles: ['TEACHER'] },
        documentRequirements: {},
        reason: 'Attempt to cover teaching personnel.',
      });
      await service.linkAuthority(context, sick.id, sickDraft.id, {
        authorityClass: 'NATIONAL_RULE',
        documentId: nationalEvidenceId,
        citation: 'Rule XVI, sections 1-3',
      });
      await expect(
        service.activate(context, sick.id, sickDraft.id, 'Activate sick leave for teachers.'),
      ).rejects.toMatchObject({
        code: 'LEAVE_POLICY_INDETERMINATE',
        reasons: expect.arrayContaining(['UNSUPPORTED_PERSONNEL_PROFILE:TEACHER']),
      });

      const placeholder = await service.create(context, { catalogueCode: 'OTHER_LEAVE_UNDER_LAW' });
      const placeholderDraft = await service.createPolicyVersion(context, placeholder.id, {
        effectiveDate: manilaDate(-5),
        approvalRouteCode: 'LEAVE-ROUTE-1',
        applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
        documentRequirements: {},
        reason: 'Attempt to activate a placeholder.',
      });
      await service.linkAuthority(context, placeholder.id, placeholderDraft.id, {
        authorityClass: 'NATIONAL_RULE',
        documentId: nationalEvidenceId,
        citation: 'Unsettled source',
      });
      await service.linkAuthority(context, placeholder.id, placeholderDraft.id, {
        authorityClass: 'AGENCY_CONFIGURATION',
        documentId: agencyEvidenceId,
        citation: 'Agency placeholder configuration',
      });
      await expect(
        service.activate(context, placeholder.id, placeholderDraft.id, 'Activate placeholder.'),
      ).rejects.toMatchObject({
        code: 'LEAVE_POLICY_INDETERMINATE',
        reasons: expect.arrayContaining(['FAIL_CLOSED_PLACEHOLDER']),
      });

      await expect(service.list(foreignContext)).resolves.toEqual([]);
      await expect(service.findById(foreignContext, vacation.id)).resolves.toBeNull();
      await expect(
        service.createPolicyVersion(foreignContext, vacation.id, {
          effectiveDate: manilaDate(2),
          approvalRouteCode: 'LEAVE-ROUTE-1',
          applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
          documentRequirements: {},
          reason: 'Cross-Agency write attempt.',
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_TYPE_NOT_FOUND' });
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.auditEvent.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.leavePolicyAuthority.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leavePolicyVersion.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.leaveType.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.documentVersion.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.document.deleteMany({ where: { agencyId: { in: agencyIds } } });
      });
      await admin.agencyMembership.deleteMany({ where: { agencyId: { in: agencyIds } } });
      await admin.agency.deleteMany({ where: { id: { in: agencyIds } } });
      await admin.user.delete({ where: { id: user.id } });
      await admin.$disconnect();
    }
  },
);
