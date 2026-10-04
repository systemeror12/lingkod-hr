import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { requestDatabaseContext } from '../database-context';
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
    const policies = new LeavePoliciesService(
      leavePolicyAuditWriter,
      documents,
      new MandatoryLeaveAssessmentsService(mandatoryLeaveAssessmentAuditWriter),
    );
    const accounts = new LeaveAccountsService(
      leaveAccountAuditWriter,
      documents,
      new MandatoryLeaveAssessmentsService(mandatoryLeaveAssessmentAuditWriter),
    );
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

      // Activation re-evaluated both Employees inline. Below the 10-credit
      // threshold: NOT_SUBJECT. No account: still INDETERMINATE, new reason.
      expect((await chainFor(employee.id)).map((row) => row.result)).toEqual([
        'INDETERMINATE',
        'NOT_SUBJECT',
      ]);
      const [noAccount] = (await chainFor(noAccountEmployee.id)).slice(-1);
      expect(noAccount?.result).toBe('INDETERMINATE');
      expect(reasonsOf(noAccount?.inputFacts)).toEqual(['MISSING_VACATION_ACCOUNT']);

      // Nothing material changed: no row is written.
      await expect(service.evaluateAgencyYear(adminContext, year)).resolves.toMatchObject({
        recordedCount: 0,
        unchangedCount: 2,
      });

      // Each vacation ledger entry re-evaluates the Employee inline.
      await adjust(5, 'mandatory-leave-credit');
      expect((await chainFor(employee.id)).at(-1)?.result).toBe('SUBJECT');

      // A credit and its reversal both leave the running balance.
      const credit = await admin.leaveLedgerEntry.findFirstOrThrow({
        where: { agencyId: agency.id, leaveAccountId: account.id },
        orderBy: { postedAt: 'desc' },
      });
      await accounts.reverseEntry(
        creditContext,
        account.id,
        credit.id,
        {
          authorityDocumentId: evidenceId,
          evidenceDocumentId: evidenceId,
          reason: 'Reverse the credit for the integration test.',
        },
        'mandatory-leave-reversal',
      );
      const afterReversal = (await chainFor(employee.id)).at(-1);
      expect(afterReversal?.result).toBe('NOT_SUBJECT');
      expect(afterReversal?.inputFacts).toMatchObject({
        thresholdBasis: { reached: false, peakBalance: '5.0000' },
      });
      expect(
        (afterReversal?.inputFacts as { thresholdBasis: { excludedReversalEntryIds: string[] } })
          .thresholdBasis.excludedReversalEntryIds,
      ).toContain(credit.id);

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

      // Concurrent evaluations of the same change produce one successor. The
      // entry is written directly so no inline re-evaluation records it first.
      await admin.leaveLedgerEntry.create({
        data: {
          agencyId: agency.id,
          leaveAccountId: account.id,
          quantity: 5,
          effectiveDate: new Date(`${manilaDate(0)}T00:00:00.000Z`),
          sourceType: 'IntegrationFixture',
          sourceId: randomUUID(),
          sourcePostingKey: 'mandatory-leave-credit-again',
          policyVersionId: vacation.version.id,
        },
      });
      const concurrent = await Promise.all([
        service.evaluateAgencyYear(adminContext, year),
        service.evaluateAgencyYear(adminContext, year),
      ]);
      expect(concurrent.map((summary) => summary.recordedCount).sort()).toEqual([0, 1]);
      const afterConcurrency = await chainFor(employee.id);
      expect(afterConcurrency).toHaveLength(5);
      expect(afterConcurrency[4]?.previousAssessmentId).toBe(afterConcurrency[3]?.id);
      expect(afterConcurrency[4]?.result).toBe('SUBJECT');

      // A reached threshold stays reached: a later debit on the same effective
      // date re-evaluates inline but changes nothing material.
      await adjust(-5, 'mandatory-leave-debit');
      const afterDebit = await chainFor(employee.id);
      expect(afterDebit).toHaveLength(5);
      expect(afterDebit[4]?.inputFacts).toMatchObject({
        thresholdBasis: {
          reached: true,
          reachedOn: manilaDate(0),
          balanceOnReachedDate: '10.0000',
        },
      });

      // A ledger writer re-evaluates under the Employee-year lock before it
      // commits, so an evaluation waits for it instead of reading a torn state.
      let writerCommitted = false;
      let evaluatedAfterWriter!: Promise<boolean>;
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mandatory_leave_assessment:${agency.id}:${employee.id}:${year}`}, 0))`;
        evaluatedAfterWriter = withDatabaseContext(requestDatabaseContext(adminContext), (tx) =>
          service.evaluateEmployeeYear(tx, agency.id, employee.id, year, manilaDate(0)),
        ).then(() => writerCommitted);
        await new Promise((resolve) => setTimeout(resolve, 300));
        writerCommitted = true;
      });
      await expect(evaluatedAfterWriter).resolves.toBe(true);

      // Evaluation never writes the ledger beyond the test's own adjustments.
      await expect(admin.leaveLedgerEntry.count({ where: { agencyId: agency.id } })).resolves.toBe(
        ledgerCountBefore + 4,
      );

      // A past year is assessed as of December 31.
      const pastYear = await service.evaluateAgencyYear(adminContext, year - 1);
      expect(pastYear.assessmentDate).toBe(`${year - 1}-12-31`);
      await expect(service.evaluateAgencyYear(adminContext, year + 1)).rejects.toMatchObject({
        code: 'MANDATORY_LEAVE_ASSESSMENT_YEAR_INVALID',
        statusCode: 400,
      });

      // Reads: Agency scope sees both Employees; OWN sees only the linked Employee.
      const { items: agencyRows } = await service.list(adminContext, { year });
      expect(new Set(agencyRows.map((row) => row.employeeId))).toEqual(
        new Set([employee.id, noAccountEmployee.id]),
      );
      expect(agencyRows.filter((row) => row.isLatest)).toHaveLength(2);
      const { items: ownRows } = await service.list(ownContext, { year });
      expect(ownRows.length).toBeGreaterThan(0);
      expect(ownRows.every((row) => row.employeeId === employee.id)).toBe(true);

      // Pages walk the full list once, in order, without gaps or repeats.
      const everything = await service.list(adminContext, {}, { limit: 50 });
      expect(everything).toMatchObject({ hasMore: false, nextCursor: null });
      expect(everything.items.length).toBeGreaterThan(3);
      const paged: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await service.list(adminContext, {}, { limit: 2, cursor });
        expect(page.items.length).toBeLessThanOrEqual(2);
        paged.push(...page.items.map((row) => row.id));
        expect(page.hasMore).toBe(page.nextCursor !== null);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(paged).toEqual(everything.items.map((row) => row.id));
      await expect(
        service.list(adminContext, {}, { cursor: 'not-a-cursor' }),
      ).rejects.toMatchObject({
        code: 'MANDATORY_LEAVE_ASSESSMENT_CURSOR_INVALID',
        statusCode: 400,
      });
      await expect(
        controller.list(agency.id, undefined, undefined, undefined, '51', undefined, adminContext),
      ).rejects.toMatchObject({ status: 400 });

      await expect(service.findById(ownContext, noAccount!.id)).resolves.toBeNull();
      await expect(service.findById(adminContext, chain[2]!.id)).resolves.toMatchObject({
        result: 'SUBJECT',
        isLatest: false,
      });
      await expect(service.evaluateAgencyYear(ownContext, year)).rejects.toMatchObject({
        code: 'MANDATORY_LEAVE_ASSESSMENT_EVALUATE_FORBIDDEN',
      });

      // Agency isolation: RLS hides the rows and Cross-Agency requests are rejected.
      await expect(service.list(foreignContext, {})).resolves.toMatchObject({ items: [] });
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
        controller.list(
          agency.id,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          foreignContext,
        ),
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
      ).resolves.toBe(5);

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

it.skipIf(!enabled)(
  're-evaluates assessed years inline after ledger entries and policy activation',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-mandatory-leave-reevaluation`;
    const year = Number(manilaDate(0).slice(0, 4));
    const agency = await admin.agency.create({
      data: {
        code: `MLR-${suffix}`,
        name: 'Mandatory Leave Re-evaluation Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        emailNormalized: `mandatory-leave-reevaluation-${suffix}@example.test`,
        displayName: 'Mandatory Leave Re-evaluation Administrator',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const employee = await createEmployee(admin, agency.id, membership.id, suffix, 'Ana Reyes');
    const documents = new DocumentsService({} as never, documentAuditWriter);
    const service = new MandatoryLeaveAssessmentsService(mandatoryLeaveAssessmentAuditWriter);
    const policies = new LeavePoliciesService(leavePolicyAuditWriter, documents, service);
    const accounts = new LeaveAccountsService(leaveAccountAuditWriter, documents, service);
    const actor = context(agency.id, user.id, membership.id, [
      { code: 'leave.types.read', scopePolicy: 'AGENCY' },
      { code: 'leave.types.manage', scopePolicy: 'AGENCY' },
      { code: 'leave.accounts.read', scopePolicy: 'AGENCY' },
      { code: 'leave.credits.adjust', scopePolicy: 'AGENCY' },
      { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
      { code: 'leave.mandatory_assessments.read', scopePolicy: 'AGENCY' },
      { code: 'leave.mandatory_assessments.evaluate', scopePolicy: 'AGENCY' },
    ]);
    const chainFor = (assessmentYear: number) =>
      admin.mandatoryLeaveAssessment.findMany({
        where: { agencyId: agency.id, employeeId: employee.id, assessmentYear },
        orderBy: { assessedAt: 'asc' },
      });
    const chainLengths = async () => [
      (await chainFor(year - 1)).length,
      (await chainFor(year)).length,
    ];

    try {
      const evidenceId = await createEvidence(admin, agency.id, membership.id, `${suffix}-1`);
      const configurationId = await createEvidence(admin, agency.id, membership.id, `${suffix}-2`);
      async function adoptVersion(
        leaveTypeId: string,
        effectiveDate: string,
        configurationEvidenceId?: string,
      ) {
        const version = await policies.createPolicyVersion(actor, leaveTypeId, {
          effectiveDate,
          approvalRouteCode: 'LEAVE-ROUTE-1',
          applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
          documentRequirements: {},
          reason: 'Adopt the policy for the re-evaluation test.',
        });
        await policies.linkAuthority(actor, leaveTypeId, version.id, {
          authorityClass: 'NATIONAL_RULE',
          documentId: evidenceId,
          citation: 'Rule XVI',
        });
        if (configurationEvidenceId) {
          await policies.linkAuthority(actor, leaveTypeId, version.id, {
            authorityClass: 'AGENCY_CONFIGURATION',
            documentId: configurationEvidenceId,
            citation: 'Agency mandatory-leave configuration for the re-evaluation test.',
          });
        }
        await policies.activate(actor, leaveTypeId, version.id, 'Activate the policy.');
        return version;
      }
      const vacation = await policies.create(actor, { catalogueCode: 'VACATION_LEAVE' });
      await adoptVersion(vacation.id, `${year - 1}-01-01`);
      const sick = await policies.create(actor, { catalogueCode: 'SICK_LEAVE' });
      await adoptVersion(sick.id, `${year - 1}-01-01`);
      const mandatory = await policies.create(actor, { catalogueCode: 'MANDATORY_LEAVE' });
      const firstMandatory = await adoptVersion(mandatory.id, `${year - 1}-01-01`, configurationId);
      const openAccount = (leaveTypeId: string) =>
        accounts.open(actor, {
          employeeId: employee.id,
          leaveTypeId,
          effectiveDate: `${year - 1}-06-01`,
          openingQuantity: 5,
          evidenceDocumentId: evidenceId,
          reason: 'Opening balance carried from the service record.',
        });
      const account = await openAccount(vacation.id);
      const sickAccount = await openAccount(sick.id);
      const adjust = (accountId: string, quantity: number, effectiveDate: string, key: string) =>
        accounts.recordAdjustment(
          actor,
          accountId,
          {
            quantity,
            effectiveDate,
            authorityDocumentId: evidenceId,
            evidenceDocumentId: evidenceId,
            reason: 'Adjust the balance for the re-evaluation test.',
          },
          key,
        );

      // Years not yet assessed are left to the Agency/year evaluation.
      expect(await chainLengths()).toEqual([0, 0]);
      await service.evaluateAgencyYear(actor, year - 1);
      // A first assessment references the account a paused writer holds, so its
      // foreign-key check must not wait on that writer's account lock.
      let pausedWriter!: ReturnType<typeof adjust>;
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe('LOCK TABLE leave_ledger_adjustments IN SHARE MODE');
        pausedWriter = adjust(account.id, 1, manilaDate(0), 'paused-credit');
        await new Promise((resolve) => setTimeout(resolve, 300));
        await service.evaluateAgencyYear(actor, year);
      });
      await pausedWriter;
      expect((await chainFor(year - 1)).map((row) => row.result)).toEqual(['NOT_SUBJECT']);
      expect((await chainFor(year)).map((row) => row.result)).toEqual(['NOT_SUBJECT']);

      // A backdated vacation entry re-evaluates every year through the current one.
      const backdated = `${year - 1}-07-01`;
      await adjust(account.id, 5, backdated, 'backdated-credit');
      const pastChain = await chainFor(year - 1);
      const currentChain = await chainFor(year);
      expect(pastChain.map((row) => row.result)).toEqual(['NOT_SUBJECT', 'SUBJECT']);
      expect(currentChain.map((row) => row.result)).toEqual(['NOT_SUBJECT', 'SUBJECT']);
      expect(pastChain[1]).toMatchObject({
        previousAssessmentId: pastChain[0]!.id,
        assessmentDate: new Date(`${year - 1}-12-31T00:00:00.000Z`),
      });
      expect(currentChain[1]?.previousAssessmentId).toBe(currentChain[0]!.id);
      await expect(
        admin.auditEvent.count({
          where: { agencyId: agency.id, action: 'leave.mandatory_assessment.recorded' },
        }),
      ).resolves.toBe(4);

      // A retried command, a non-vacation entry, and an unchanged evaluation write no row.
      await adjust(account.id, 5, backdated, 'backdated-credit');
      await adjust(sickAccount.id, 1, manilaDate(0), 'sick-credit');
      await expect(service.evaluateAgencyYear(actor, year)).resolves.toMatchObject({
        recordedCount: 0,
      });
      expect(await chainLengths()).toEqual([2, 2]);

      // Concurrent triggers of one change yield one successor per year. Credits
      // dated before the threshold was reached raise the balance it was reached at.
      const beforeThreshold = `${year - 1}-06-15`;
      await Promise.all([
        adjust(account.id, 1, beforeThreshold, 'concurrent-credit'),
        adjust(account.id, 1, beforeThreshold, 'concurrent-credit'),
        service.evaluateAgencyYear(actor, year),
        service.evaluateAgencyYear(actor, year - 1),
      ]);
      const [pastAfterRace, currentAfterRace] = [await chainFor(year - 1), await chainFor(year)];
      expect([pastAfterRace.length, currentAfterRace.length]).toEqual([3, 3]);
      expect(pastAfterRace[2]?.previousAssessmentId).toBe(pastAfterRace[1]!.id);
      expect(currentAfterRace[2]?.previousAssessmentId).toBe(currentAfterRace[1]!.id);

      // Activating a MANDATORY_LEAVE version re-evaluates from its effective year,
      // including a first assessment an in-flight Agency/year evaluation is
      // writing under the old version. A table lock holds that insert open.
      const newcomer = await createEmployee(
        admin,
        agency.id,
        membership.id,
        `${suffix}-newcomer`,
        'Ben Cruz',
      );
      let evaluation!: Promise<unknown>;
      let activation!: ReturnType<typeof adoptVersion>;
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe('LOCK TABLE mandatory_leave_assessments IN SHARE MODE');
        evaluation = service.evaluateAgencyYear(actor, year);
        await new Promise((resolve) => setTimeout(resolve, 300));
        activation = adoptVersion(mandatory.id, manilaDate(0), configurationId);
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      const [, secondMandatory] = await Promise.all([evaluation, activation]);
      const newcomerChain = await admin.mandatoryLeaveAssessment.findMany({
        where: { agencyId: agency.id, employeeId: newcomer.id, assessmentYear: year },
        orderBy: { assessedAt: 'asc' },
      });
      expect(newcomerChain.map((row) => row.policyVersionId)).toEqual([
        firstMandatory.id,
        secondMandatory.id,
      ]);
      expect(await chainLengths()).toEqual([3, 4]);
      expect((await chainFor(year)).at(-1)?.policyVersionId).toBe(secondMandatory.id);
      expect((await chainFor(year - 1)).at(-1)?.policyVersionId).toBe(firstMandatory.id);

      // A failed re-evaluation rolls back the source command. The credit
      // changes the balance the threshold was reached at.
      const ledgerCount = await admin.leaveLedgerEntry.count({ where: { agencyId: agency.id } });
      const failure = `fail_assessment_${randomUUID().replaceAll('-', '')}`;
      await admin.$executeRawUnsafe(
        `CREATE FUNCTION ${failure}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'intentional assessment failure'; END; $$`,
      );
      await admin.$executeRawUnsafe(
        `CREATE TRIGGER ${failure} BEFORE INSERT ON mandatory_leave_assessments FOR EACH ROW WHEN (NEW.agency_id = '${agency.id}'::uuid) EXECUTE FUNCTION ${failure}()`,
      );
      try {
        await expect(adjust(account.id, 1, beforeThreshold, 'failed-credit')).rejects.toThrow(
          /intentional assessment failure/,
        );
      } finally {
        await admin.$executeRawUnsafe(`DROP TRIGGER ${failure} ON mandatory_leave_assessments`);
        await admin.$executeRawUnsafe(`DROP FUNCTION ${failure}()`);
      }
      await expect(admin.leaveLedgerEntry.count({ where: { agencyId: agency.id } })).resolves.toBe(
        ledgerCount,
      );
      expect(await chainLengths()).toEqual([3, 4]);

      // Re-evaluation never writes the ledger: two openings and four adjustments.
      expect(ledgerCount).toBe(6);
      await expect(
        admin.leaveLedgerEntry.count({
          where: {
            agencyId: agency.id,
            NOT: { sourceType: { in: ['LeaveAccountOpening', 'LeaveLedgerAdjustment'] } },
          },
        }),
      ).resolves.toBe(0);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.auditEvent.deleteMany({ where: { agencyId: agency.id } });
        await transaction.mandatoryLeaveAssessment.deleteMany({ where: { agencyId: agency.id } });
        await transaction.leaveLedgerAdjustment.deleteMany({ where: { agencyId: agency.id } });
        await transaction.leaveLedgerEntry.deleteMany({ where: { agencyId: agency.id } });
        await transaction.leaveCreditCommitment.deleteMany({ where: { agencyId: agency.id } });
        await transaction.leaveAccountOpening.deleteMany({ where: { agencyId: agency.id } });
        await transaction.leaveAccount.deleteMany({ where: { agencyId: agency.id } });
        await transaction.leavePolicyAuthority.deleteMany({ where: { agencyId: agency.id } });
        await transaction.leavePolicyVersion.deleteMany({ where: { agencyId: agency.id } });
        await transaction.leaveType.deleteMany({ where: { agencyId: agency.id } });
        await transaction.documentVersion.deleteMany({ where: { agencyId: agency.id } });
        await transaction.document.deleteMany({ where: { agencyId: agency.id } });
        await transaction.agencyMembership.deleteMany({ where: { agencyId: agency.id } });
        await transaction.employee.deleteMany({ where: { agencyId: agency.id } });
        await transaction.agency.deleteMany({ where: { id: agency.id } });
        await transaction.user.deleteMany({ where: { id: user.id } });
      });
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'lists the latest assessment per Employee for a year, including Employees not yet evaluated',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-mandatory-leave-latest`;
    const year = Number(manilaDate(0).slice(0, 4));
    const agency = await admin.agency.create({
      data: {
        code: `MLL-${suffix}`,
        name: 'Mandatory Leave Latest Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        emailNormalized: `mandatory-leave-latest-${suffix}@example.test`,
        displayName: 'Mandatory Leave Reader',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const service = new MandatoryLeaveAssessmentsService(mandatoryLeaveAssessmentAuditWriter);
    const controller = new MandatoryLeaveAssessmentsController(service);
    const agencyContext = context(agency.id, user.id, membership.id, [
      { code: 'leave.mandatory_assessments.read', scopePolicy: 'AGENCY' },
    ]);
    const ownContext = context(agency.id, user.id, membership.id, [
      { code: 'leave.mandatory_assessments.read', scopePolicy: 'OWN' },
    ]);

    try {
      const ana = await createEmployee(admin, agency.id, membership.id, `${suffix}-1`, 'Ana Reyes');
      const ben = await createEmployee(admin, agency.id, membership.id, `${suffix}-2`, 'Ben Cruz');
      const carla = await createEmployee(
        admin,
        agency.id,
        membership.id,
        `${suffix}-3`,
        'Carla Diaz',
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
            data: { employeeId: ana.id },
          }),
      );
      const record = (employeeId: string, assessmentYear: number, previous: string | null) =>
        admin.mandatoryLeaveAssessment.create({
          data: {
            agencyId: agency.id,
            employeeId,
            assessmentYear,
            assessmentDate: new Date(`${assessmentYear}-06-30T00:00:00.000Z`),
            previousAssessmentId: previous,
            result: 'INDETERMINATE',
            materialFingerprint: `fingerprint-${previous ?? 'first'}`,
            inputFacts: { indeterminateReasons: ['MISSING_POLICY'] },
            ruleResults: [],
          },
        });
      const anaFirst = await record(ana.id, year, null);
      const anaLatest = await record(ana.id, year, anaFirst.id);
      const benLatest = await record(ben.id, year, null);
      // Another year's assessment does not count for this year.
      await record(carla.id, year - 1, null);

      const page = await service.latestByEmployee(agencyContext, year);
      expect(page).toMatchObject({ assessmentYear: year, hasMore: false, nextCursor: null });
      expect(page.items.map((row) => [row.employeeName, row.assessment?.id ?? null])).toEqual([
        ['Ana Reyes', anaLatest.id],
        ['Ben Cruz', benLatest.id],
        ['Carla Diaz', null],
      ]);
      expect(page.items[0]?.assessment).toMatchObject({ isLatest: true, result: 'INDETERMINATE' });

      // Pages walk every Employee once.
      const first = await service.latestByEmployee(agencyContext, year, { limit: 2 });
      expect(first.items.map((row) => row.employeeId)).toEqual([ana.id, ben.id]);
      expect(first.hasMore).toBe(true);
      const second = await service.latestByEmployee(agencyContext, year, {
        limit: 2,
        cursor: first.nextCursor!,
      });
      expect(second).toMatchObject({ hasMore: false, nextCursor: null });
      expect(second.items.map((row) => row.employeeId)).toEqual([carla.id]);

      // OWN scope sees only the linked Employee.
      const own = await service.latestByEmployee(ownContext, year);
      expect(own.items.map((row) => row.employeeId)).toEqual([ana.id]);

      await expect(
        controller.latest(agency.id, undefined, undefined, undefined, agencyContext),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        controller.latest(agency.id, String(year), undefined, undefined, agencyContext),
      ).resolves.toMatchObject({ assessmentYear: year, hasMore: false });
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.mandatoryLeaveAssessment.deleteMany({ where: { agencyId: agency.id } });
        await transaction.agencyMembership.deleteMany({ where: { agencyId: agency.id } });
        await transaction.employee.deleteMany({ where: { agencyId: agency.id } });
        await transaction.agency.deleteMany({ where: { id: agency.id } });
        await transaction.user.deleteMany({ where: { id: user.id } });
      });
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)('shows a Supervisor only the assessments of their direct reports', async () => {
  const admin = await createAdminClient();
  const suffix = `${Date.now()}-mandatory-leave-supervisor`;
  const year = Number(manilaDate(0).slice(0, 4));
  const agency = await admin.agency.create({
    data: {
      code: `MLS-${suffix}`,
      name: 'Mandatory Leave Supervisor Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      emailNormalized: `mandatory-leave-supervisor-${suffix}@example.test`,
      displayName: 'Division Chief',
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const unlinkedUser = await admin.user.create({
    data: {
      emailNormalized: `mandatory-leave-unlinked-${suffix}@example.test`,
      displayName: 'Unlinked Supervisor',
      globalStatus: 'ACTIVE',
    },
  });
  const unlinkedMembership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: unlinkedUser.id, status: 'ACTIVE' },
  });
  try {
    // A record closed on a future date stays in effect until then.
    const unit = async (
      code: string,
      parentUnitId: string | null,
      headPositionId: string,
      effectiveTo: string | null = null,
    ) => {
      const record = await admin.organizationUnit.create({
        data: {
          agencyId: agency.id,
          code: `${code}-${suffix}`,
          unitType: 'DIVISION',
          status: 'ACTIVE',
        },
      });
      const version = await admin.organizationUnitVersion.create({
        data: {
          agencyId: agency.id,
          organizationUnitId: record.id,
          versionNo: 1,
          name: code,
          parentUnitId,
          headPositionId,
          effectiveFrom: new Date('2020-01-01'),
          effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
          status: effectiveTo ? 'SUPERSEDED' : 'ACTIVE',
          domainStatus: 'ACTIVE',
        },
      });
      await admin.organizationUnit.update({
        where: { id: record.id },
        data: { currentVersionId: version.id },
      });
      return record;
    };
    // Plantilla Position projections normally require the application service.
    const position = (itemNumber: string) =>
      admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        return transaction.plantillaPosition.create({
          data: {
            agencyId: agency.id,
            itemNumber: `${itemNumber}-${suffix}`,
            status: 'OCCUPIED',
            createdByMembershipId: membership.id,
            updatedByMembershipId: membership.id,
          },
        });
      });
    const assign = (
      employeeId: string,
      organizationUnitId: string,
      positionId: string | null,
      effectiveTo: string | null = null,
    ) =>
      withDatabaseContext(
        {
          agencyId: agency.id,
          membershipId: membership.id,
          capabilities: ['personnel-baseline-transition'],
        },
        async (transaction) => {
          const segment = await transaction.serviceSegment.create({
            data: {
              agencyId: agency.id,
              employeeId,
              positionId,
              organizationUnitId,
              appointmentStatus: 'PERMANENT',
              effectiveFrom: new Date('2020-01-01'),
              effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
              status: effectiveTo ? 'CLOSED' : 'ACTIVE',
              createdByMembershipId: membership.id,
            },
          });
          if (positionId) {
            await transaction.positionIncumbency.create({
              data: {
                agencyId: agency.id,
                positionId,
                employeeId,
                serviceSegmentId: segment.id,
                effectiveFrom: new Date('2020-01-01'),
                effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
                status: effectiveTo ? 'ENDED' : 'ACTIVE',
                createdByMembershipId: membership.id,
              },
            });
          }
        },
      );

    const chiefPosition = await position('CHIEF');
    const sectionHeadPosition = await position('SECTION-HEAD');
    const otherChiefPosition = await position('OTHER-CHIEF');
    const division = await unit('DIV', null, chiefPosition.id, manilaDate(1));
    const section = await unit('SEC', division.id, sectionHeadPosition.id);
    const otherDivision = await unit('OTHER', null, otherChiefPosition.id);

    const chief = await createEmployee(
      admin,
      agency.id,
      membership.id,
      `${suffix}-1`,
      'Dana Chief',
    );
    const member = await createEmployee(
      admin,
      agency.id,
      membership.id,
      `${suffix}-2`,
      'Eli Member',
    );
    const sectionHead = await createEmployee(
      admin,
      agency.id,
      membership.id,
      `${suffix}-3`,
      'Sam Head',
    );
    const sectionMember = await createEmployee(
      admin,
      agency.id,
      membership.id,
      `${suffix}-4`,
      'Tess Section',
    );
    const outsider = await createEmployee(
      admin,
      agency.id,
      membership.id,
      `${suffix}-5`,
      'Owen Outside',
    );
    const former = await createEmployee(
      admin,
      agency.id,
      membership.id,
      `${suffix}-6`,
      'Fay Former',
    );
    await assign(chief.id, division.id, chiefPosition.id, manilaDate(1));
    await assign(member.id, division.id, null, manilaDate(1));
    await assign(sectionHead.id, section.id, sectionHeadPosition.id);
    await assign(sectionMember.id, section.id, null);
    await assign(outsider.id, otherDivision.id, null);
    await assign(former.id, division.id, null, manilaDate(-1));
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
          data: { employeeId: chief.id },
        }),
    );
    const assessments = new Map<string, string>();
    for (const employee of [chief, member, sectionHead, sectionMember, outsider, former]) {
      const assessment = await admin.mandatoryLeaveAssessment.create({
        data: {
          agencyId: agency.id,
          employeeId: employee.id,
          assessmentYear: year,
          assessmentDate: new Date(`${year}-06-30T00:00:00.000Z`),
          result: 'INDETERMINATE',
          materialFingerprint: `fingerprint-${employee.id}`,
          inputFacts: { indeterminateReasons: ['MISSING_POLICY'] },
          ruleResults: [],
        },
      });
      assessments.set(employee.id, assessment.id);
    }

    const service = new MandatoryLeaveAssessmentsService(mandatoryLeaveAssessmentAuditWriter);
    const directReportsContext = context(agency.id, user.id, membership.id, [
      { code: 'leave.mandatory_assessments.read', scopePolicy: 'DIRECT_REPORTS' },
    ]);
    const supervisorEmployeeContext = context(agency.id, user.id, membership.id, [
      { code: 'leave.mandatory_assessments.read', scopePolicy: 'DIRECT_REPORTS' },
      { code: 'leave.mandatory_assessments.read', scopePolicy: 'OWN' },
    ]);

    // One level: the unit's members and the heads of its child units.
    const latest = await service.latestByEmployee(directReportsContext, year);
    expect(latest.items.map((row) => row.employeeId)).toEqual([member.id, sectionHead.id]);
    const { items } = await service.list(directReportsContext, { year });
    expect(items.map((row) => row.employeeId)).toEqual([member.id, sectionHead.id]);
    await expect(
      service.findById(directReportsContext, assessments.get(member.id)!),
    ).resolves.toMatchObject({ employeeId: member.id });
    for (const hidden of [chief, sectionMember, outsider, former]) {
      await expect(
        service.findById(directReportsContext, assessments.get(hidden.id)!),
      ).resolves.toBeNull();
    }

    // The Supervisor's Employee role adds their own assessment.
    const combined = await service.latestByEmployee(supervisorEmployeeContext, year);
    expect(combined.items.map((row) => row.employeeId)).toEqual([
      chief.id,
      member.id,
      sectionHead.id,
    ]);

    // A Supervisor membership without a linked Employee has no direct reports.
    const unlinked = context(agency.id, unlinkedUser.id, unlinkedMembership.id, [
      { code: 'leave.mandatory_assessments.read', scopePolicy: 'DIRECT_REPORTS' },
    ]);
    await expect(service.latestByEmployee(unlinked, year)).resolves.toMatchObject({ items: [] });
    await expect(service.list(unlinked, { year })).resolves.toMatchObject({ items: [] });

    await expect(service.evaluateAgencyYear(directReportsContext, year)).rejects.toMatchObject({
      statusCode: 403,
    });

    // The Supervisor role carries the direct-report read grant and no evaluate grant.
    const grants = await admin.rolePermission.findMany({
      where: { role: { code: 'supervisor', agencyId: null } },
      select: { scopePolicy: true, permission: { select: { code: true } } },
    });
    expect(grants.map((grant) => [grant.permission.code, grant.scopePolicy])).toEqual([
      ['leave.mandatory_assessments.read', 'DIRECT_REPORTS'],
    ]);
  } finally {
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.mandatoryLeaveAssessment.deleteMany({ where: { agencyId: agency.id } });
      await transaction.agencyMembership.updateMany({
        where: { agencyId: agency.id },
        data: { employeeId: null },
      });
      await transaction.positionIncumbency.deleteMany({ where: { agencyId: agency.id } });
      await transaction.serviceSegment.deleteMany({ where: { agencyId: agency.id } });
      await transaction.organizationUnit.updateMany({
        where: { agencyId: agency.id },
        data: { currentVersionId: null },
      });
      await transaction.organizationUnitVersion.deleteMany({ where: { agencyId: agency.id } });
      await transaction.organizationUnit.deleteMany({ where: { agencyId: agency.id } });
      await transaction.plantillaPosition.deleteMany({ where: { agencyId: agency.id } });
      await transaction.employee.deleteMany({ where: { agencyId: agency.id } });
      await transaction.agencyMembership.deleteMany({ where: { agencyId: agency.id } });
      await transaction.agency.deleteMany({ where: { id: agency.id } });
      await transaction.user.deleteMany({ where: { id: { in: [user.id, unlinkedUser.id] } } });
    });
    await admin.$disconnect();
  }
});
