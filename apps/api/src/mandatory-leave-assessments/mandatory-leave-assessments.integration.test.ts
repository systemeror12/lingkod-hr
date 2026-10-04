import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import {
  LeaveAccountsService,
  leaveAccountAuditWriter,
} from '../leave-accounts/leave-accounts.service';
import {
  leavePolicyAuditWriter,
  LeavePoliciesService,
} from '../leave-policies/leave-policies.service';
import { MandatoryLeaveAssessmentsController } from './mandatory-leave-assessments.controller';
import {
  mandatoryLeaveAssessmentAuditWriter,
  MandatoryLeaveAssessmentsService,
} from './mandatory-leave-assessments.service';

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

function context(
  agencyId: string,
  userId: string,
  membershipId: string,
  permissions: RequestContext['permissions'],
): RequestContext {
  return {
    requestId: 'mandatory-leave-assessment-integration-test',
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions,
  };
}

function reasonsOf(inputFacts: unknown): unknown {
  return (inputFacts as { indeterminateReasons?: unknown } | undefined)?.indeterminateReasons;
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
      documentType: 'LEAVE_EVIDENCE',
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
      storageKey: `mandatory-leave-integration/${suffix}`,
      contentHash: 'd'.repeat(64),
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

async function createEmployee(
  admin: PrismaClient,
  agencyId: string,
  membershipId: string,
  suffix: string,
  name: string,
) {
  return admin.employee.create({
    data: {
      agencyId,
      employeeNumber: `EMP-${suffix}`,
      legalName: name,
      birthDate: new Date('1990-01-01'),
      sex: 'FEMALE',
      civilStatus: 'SINGLE',
      contactEmail: `${suffix}@example.test`,
      serviceStatus: 'ACTIVE',
      createdByMembershipId: membershipId,
      updatedByMembershipId: membershipId,
    },
  });
}

it.skipIf(!enabled)(
  'records Mandatory Leave Assessments only on material change under RLS',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-mandatory-leave`;
    const year = Number(manilaDate(0).slice(0, 4));
    const agency = await admin.agency.create({
      data: {
        code: `ML-${suffix}`,
        name: 'Mandatory Leave Integration Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const foreignAgency = await admin.agency.create({
      data: {
        code: `ML-F-${suffix}`,
        name: 'Foreign Mandatory Leave Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        emailNormalized: `mandatory-leave-${suffix}@example.test`,
        displayName: 'Mandatory Leave Administrator',
        globalStatus: 'ACTIVE',
      },
    });
    const foreignUser = await admin.user.create({
      data: {
        emailNormalized: `foreign-mandatory-leave-${suffix}@example.test`,
        displayName: 'Foreign Mandatory Leave Administrator',
        globalStatus: 'ACTIVE',
      },
    });
    const agencyIds = [agency.id, foreignAgency.id];
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const foreignMembership = await admin.agencyMembership.create({
      data: { agencyId: foreignAgency.id, userId: foreignUser.id, status: 'ACTIVE' },
    });
    const employee = await createEmployee(
      admin,
      agency.id,
      membership.id,
      `${suffix}-1`,
      'Ana Reyes',
    );
    const noAccountEmployee = await createEmployee(
      admin,
      agency.id,
      membership.id,
      `${suffix}-2`,
      'Ben Cruz',
    );
    await withDatabaseContext(
      {
        agencyId: agency.id,
        userId: user.id,
        membershipId: membership.id,
        capabilities: ['employee-membership-link'],
      },
      (transaction) =>
        transaction.agencyMembership.update({
          where: { agencyId_id: { agencyId: agency.id, id: membership.id } },
          data: { employeeId: employee.id },
        }),
    );

    const documents = new DocumentsService({} as never, documentAuditWriter);
    const policies = new LeavePoliciesService(leavePolicyAuditWriter, documents);
    const accounts = new LeaveAccountsService(leaveAccountAuditWriter, documents);
    const service = new MandatoryLeaveAssessmentsService(mandatoryLeaveAssessmentAuditWriter);
    const controller = new MandatoryLeaveAssessmentsController(service);

    const policyContext = context(agency.id, user.id, membership.id, [
      { code: 'leave.types.read', scopePolicy: 'AGENCY' },
      { code: 'leave.types.manage', scopePolicy: 'AGENCY' },
      { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
    ]);
    const creditContext = context(agency.id, user.id, membership.id, [
      { code: 'leave.accounts.read', scopePolicy: 'AGENCY' },
      { code: 'leave.credits.adjust', scopePolicy: 'AGENCY' },
      { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
    ]);
    const adminContext = context(agency.id, user.id, membership.id, [
      { code: 'leave.mandatory_assessments.read', scopePolicy: 'AGENCY' },
      { code: 'leave.mandatory_assessments.evaluate', scopePolicy: 'AGENCY' },
    ]);
    const ownContext = context(agency.id, user.id, membership.id, [
      { code: 'leave.mandatory_assessments.read', scopePolicy: 'OWN' },
    ]);
    const foreignContext = context(foreignAgency.id, foreignUser.id, foreignMembership.id, [
      { code: 'leave.mandatory_assessments.read', scopePolicy: 'AGENCY' },
      { code: 'leave.mandatory_assessments.evaluate', scopePolicy: 'AGENCY' },
    ]);

    async function adoptPolicy(
      catalogueCode: string,
      evidenceId: string,
      configurationEvidenceId?: string,
    ) {
      const leaveType = await policies.create(policyContext, { catalogueCode });
      const version = await policies.createPolicyVersion(policyContext, leaveType.id, {
        effectiveDate: manilaDate(-10),
        approvalRouteCode: 'LEAVE-ROUTE-1',
        applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
        documentRequirements: {},
        reason: `Adopt ${catalogueCode} for the integration test.`,
      });
      await policies.linkAuthority(policyContext, leaveType.id, version.id, {
        authorityClass: 'NATIONAL_RULE',
        documentId: evidenceId,
        citation: 'Rule XVI',
      });
      if (configurationEvidenceId) {
        await policies.linkAuthority(policyContext, leaveType.id, version.id, {
          authorityClass: 'AGENCY_CONFIGURATION',
          documentId: configurationEvidenceId,
          citation: 'Agency mandatory-leave configuration for the integration test.',
        });
      }
      await policies.activate(
        policyContext,
        leaveType.id,
        version.id,
        `Activate ${catalogueCode}.`,
      );
      return { leaveType, version };
    }

    function chainFor(employeeId: string) {
      return admin.mandatoryLeaveAssessment.findMany({
        where: { agencyId: agency.id, employeeId, assessmentYear: year },
        orderBy: { assessedAt: 'asc' },
      });
    }

    try {
      const evidenceId = await createEvidence(
        admin,
        agency.id,
        membership.id,
        `${suffix}-evidence`,
      );
      const vacation = await adoptPolicy('VACATION_LEAVE', evidenceId);
      const account = await accounts.open(creditContext, {
        employeeId: employee.id,
        leaveTypeId: vacation.leaveType.id,
        effectiveDate: manilaDate(-5),
        openingQuantity: 5,
        evidenceDocumentId: evidenceId,
        reason: 'Opening balance carried from the service record.',
      });
      const adjust = (quantity: number, key: string) =>
        accounts.recordAdjustment(
          creditContext,
          account.id,
          {
            quantity,
            effectiveDate: manilaDate(0),
            authorityDocumentId: evidenceId,
            evidenceDocumentId: evidenceId,
            reason: 'Adjust the vacation balance for the integration test.',
          },
          key,
        );

      // Without a MANDATORY_LEAVE policy every Employee is INDETERMINATE.
      const missingPolicy = await service.evaluateAgencyYear(adminContext, year);
      expect(missingPolicy).toMatchObject({
        assessmentDate: manilaDate(0),
        employeeCount: 2,
        recordedCount: 2,
        results: { SUBJECT: 0, NOT_SUBJECT: 0, INDETERMINATE: 2 },
      });
      const [indeterminate] = await chainFor(employee.id);
      expect(indeterminate).toMatchObject({
        result: 'INDETERMINATE',
        policyVersionId: null,
        requiredQuantity: null,
        previousAssessmentId: null,
      });
      expect(reasonsOf(indeterminate?.inputFacts)).toEqual(['MISSING_POLICY']);

      const configurationEvidenceId = await createEvidence(
        admin,
        agency.id,
        membership.id,
        `${suffix}-configuration`,
      );
      const mandatory = await adoptPolicy('MANDATORY_LEAVE', evidenceId, configurationEvidenceId);
      const ledgerCountBefore = await admin.leaveLedgerEntry.count({
        where: { agencyId: agency.id },
      });

      // Below the 10-credit threshold: NOT_SUBJECT. No account: still INDETERMINATE, new reason.
      const notSubject = await service.evaluateAgencyYear(adminContext, year);
      expect(notSubject).toMatchObject({
        recordedCount: 2,
        results: { SUBJECT: 0, NOT_SUBJECT: 1, INDETERMINATE: 1 },
      });
      const [noAccount] = (await chainFor(noAccountEmployee.id)).slice(-1);
      expect(noAccount?.result).toBe('INDETERMINATE');
      expect(reasonsOf(noAccount?.inputFacts)).toEqual(['MISSING_VACATION_ACCOUNT']);

      // Nothing material changed: no row is written.
      await expect(service.evaluateAgencyYear(adminContext, year)).resolves.toMatchObject({
        recordedCount: 0,
        unchangedCount: 2,
      });

      await adjust(5, 'mandatory-leave-credit');
      await expect(service.evaluateAgencyYear(adminContext, year)).resolves.toMatchObject({
        recordedCount: 1,
        results: { SUBJECT: 1 },
      });
      await adjust(-5, 'mandatory-leave-debit');
      await expect(service.evaluateAgencyYear(adminContext, year)).resolves.toMatchObject({
        recordedCount: 1,
        results: { NOT_SUBJECT: 1 },
      });

      // A -> B -> A history: the return to A appends rather than reusing the old row.
      const chain = await chainFor(employee.id);
      expect(chain.map((row) => row.result)).toEqual([
        'INDETERMINATE',
        'NOT_SUBJECT',
        'SUBJECT',
        'NOT_SUBJECT',
      ]);
      expect(chain.map((row) => row.previousAssessmentId)).toEqual([
        null,
        chain[0]?.id,
        chain[1]?.id,
        chain[2]?.id,
      ]);
      expect(chain[3]?.materialFingerprint).toBe(chain[1]?.materialFingerprint);
      expect(chain[2]).toMatchObject({
        policyVersionId: mandatory.version.id,
        leaveAccountId: account.id,
      });
      expect(chain[2]?.requiredQuantity?.toFixed(4)).toBe('5.0000');
      expect(chain[2]?.fulfilledQuantity?.toFixed(4)).toBe('0.0000');

      // Concurrent evaluations of the same change produce one successor.
      await adjust(5, 'mandatory-leave-credit-again');
      const concurrent = await Promise.all([
        service.evaluateAgencyYear(adminContext, year),
        service.evaluateAgencyYear(adminContext, year),
      ]);
      expect(concurrent.map((summary) => summary.recordedCount).sort()).toEqual([0, 1]);
      const afterConcurrency = await chainFor(employee.id);
      expect(afterConcurrency).toHaveLength(5);
      expect(afterConcurrency[4]?.previousAssessmentId).toBe(afterConcurrency[3]?.id);

      // Evaluation never writes the ledger beyond the test's own adjustments.
      await expect(admin.leaveLedgerEntry.count({ where: { agencyId: agency.id } })).resolves.toBe(
        ledgerCountBefore + 3,
      );

      // A past year is assessed as of December 31.
      const pastYear = await service.evaluateAgencyYear(adminContext, year - 1);
      expect(pastYear.assessmentDate).toBe(`${year - 1}-12-31`);
      await expect(service.evaluateAgencyYear(adminContext, year + 1)).rejects.toMatchObject({
        code: 'MANDATORY_LEAVE_ASSESSMENT_YEAR_INVALID',
        statusCode: 400,
      });

      // Reads: Agency scope sees both Employees; OWN sees only the linked Employee.
      const agencyRows = await service.list(adminContext, { year });
      expect(new Set(agencyRows.map((row) => row.employeeId))).toEqual(
        new Set([employee.id, noAccountEmployee.id]),
      );
      expect(agencyRows.filter((row) => row.isLatest)).toHaveLength(2);
      const ownRows = await service.list(ownContext, { year });
      expect(ownRows.length).toBeGreaterThan(0);
      expect(ownRows.every((row) => row.employeeId === employee.id)).toBe(true);
      await expect(service.findById(ownContext, noAccount!.id)).resolves.toBeNull();
      await expect(service.findById(adminContext, chain[2]!.id)).resolves.toMatchObject({
        result: 'SUBJECT',
        isLatest: false,
      });
      await expect(service.evaluateAgencyYear(ownContext, year)).rejects.toMatchObject({
        code: 'MANDATORY_LEAVE_ASSESSMENT_EVALUATE_FORBIDDEN',
      });

      // Agency isolation: RLS hides the rows and Cross-Agency requests are rejected.
      await expect(service.list(foreignContext, {})).resolves.toEqual([]);
      await expect(service.findById(foreignContext, chain[0]!.id)).resolves.toBeNull();
      await expect(
        withDatabaseContext(
          {
            agencyId: foreignAgency.id,
            userId: foreignUser.id,
            membershipId: foreignMembership.id,
          },
          (transaction) =>
            transaction.mandatoryLeaveAssessment.count({ where: { agencyId: agency.id } }),
        ),
      ).resolves.toBe(0);
      await expect(controller.evaluate(agency.id, { year }, foreignContext)).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        controller.list(agency.id, undefined, undefined, undefined, foreignContext),
      ).rejects.toMatchObject({ status: 404 });
      await expect(service.evaluateAgencyYear(foreignContext, year)).resolves.toMatchObject({
        employeeCount: 0,
        recordedCount: 0,
      });

      // Audit Events carry identifiers and the result, not the input facts.
      const recordedEvents = await admin.auditEvent.findMany({
        where: { agencyId: agency.id, action: 'leave.mandatory_assessment.recorded' },
      });
      expect(recordedEvents.length).toBe(
        await admin.mandatoryLeaveAssessment.count({ where: { agencyId: agency.id } }),
      );
      expect(Object.keys(recordedEvents[0]?.metadata as object).sort()).toEqual([
        'assessmentDate',
        'assessmentYear',
        'employeeId',
        'result',
      ]);
      await expect(
        admin.auditEvent.count({
          where: { agencyId: agency.id, action: 'leave.mandatory_assessments.evaluated' },
        }),
      ).resolves.toBe(8);

      // Assessments are immutable.
      await expect(
        admin.mandatoryLeaveAssessment.update({
          where: { id: chain[0]!.id },
          data: { result: 'SUBJECT' },
        }),
      ).rejects.toThrow(/immutable/);
      await expect(
        admin.mandatoryLeaveAssessment.delete({ where: { id: chain[0]!.id } }),
      ).rejects.toThrow(/immutable/);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.auditEvent.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.mandatoryLeaveAssessment.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveLedgerAdjustment.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveLedgerEntry.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.leaveCreditCommitment.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveAccountOpening.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveAccount.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.leavePolicyAuthority.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leavePolicyVersion.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveType.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.documentVersion.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.document.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.agencyMembership.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.employee.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.agency.deleteMany({ where: { id: { in: agencyIds } } });
        await transaction.user.deleteMany({ where: { id: { in: [user.id, foreignUser.id] } } });
      });
      await admin.$disconnect();
    }
  },
);
