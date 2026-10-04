import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import {
  ApprovalCompletionRegistry,
  ApprovalsService,
  approvalAuditWriter,
} from '../approvals/approval.service';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import {
  leaveAccountAuditWriter,
  LeaveAccountsService,
} from '../leave-accounts/leave-accounts.service';
import {
  leavePolicyAuditWriter,
  LeavePoliciesService,
} from '../leave-policies/leave-policies.service';
import { FailClosedPayrollMonetizationProvider } from './payroll-monetization.fail-closed';
import {
  LocalPayrollMonetizationAdapter,
  type MonetizationSalarySource,
} from './payroll-monetization.local-adapter';
import {
  LEAVE_MONETIZATION_ADJUSTMENT_ROUTE_CODE,
  LEAVE_MONETIZATION_ROUTE_CODE,
  LeaveMonetizationService,
} from './leave-monetization.service';
import {
  mandatoryLeaveAssessmentAuditWriter,
  MandatoryLeaveAssessmentsService,
} from '../mandatory-leave-assessments/mandatory-leave-assessments.service';

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
    requestId: 'leave-monetization-integration-test',
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions,
  };
}

async function createAdminClient(): Promise<PrismaClient> {
  const databaseUrl =
    process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!databaseUrl) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
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

async function createDocumentVersion(
  admin: PrismaClient,
  agencyId: string,
  membershipId: string,
  suffix: string,
): Promise<{ documentId: string; versionId: string }> {
  const document = await admin.document.create({
    data: {
      agencyId,
      documentType: 'LEAVE_EVIDENCE',
      classification: 'INTERNAL',
      status: 'ISSUED',
      createdByMembershipId: membershipId,
    },
  });
  const version = await admin.documentVersion.create({
    data: {
      agencyId,
      documentId: document.id,
      versionNo: 1,
      storageKey: `leave-monetization-integration/${suffix}`,
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
  return { documentId: document.id, versionId: version.id };
}

const salarySource: MonetizationSalarySource = {
  async resolve() {
    return {
      monthlySalary: '30000.00',
      sourceReference: 'INTEGRATION-SALARY-001',
      salarySourceSnapshot: { source: 'integration-test', monthlySalary: '30000.00' },
      rounding: { kind: 'HALF_UP_2DP', snapshot: { kind: 'HALF_UP_2DP' } },
    };
  },
};

it.skipIf(!enabled)(
  'runs the Leave Monetization lifecycle through Payroll posting and adjustments',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-monetization`;
    const agency = await admin.agency.create({
      data: {
        code: `LM-${suffix}`,
        name: 'Leave Monetization Integration Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const foreignAgency = await admin.agency.create({
      data: {
        code: `LM-F-${suffix}`,
        name: 'Foreign Leave Monetization Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const createUser = (label: string) =>
      admin.user.create({
        data: {
          emailNormalized: `${label}-${suffix}@example.test`,
          displayName: `Leave Monetization ${label}`,
          globalStatus: 'ACTIVE',
        },
      });
    const subjectUser = await createUser('subject');
    const custodianUser = await createUser('custodian');
    const certifierUser = await createUser('certifier');
    const fundingUser = await createUser('funding');
    const approverUser = await createUser('approver');
    const posterUser = await createUser('poster');
    const foreignUser = await createUser('foreign');
    const createMembership = (userId: string, targetAgencyId = agency.id) =>
      admin.agencyMembership.create({
        data: { agencyId: targetAgencyId, userId, status: 'ACTIVE' },
      });
    const subjectMembership = await createMembership(subjectUser.id);
    const custodianMembership = await createMembership(custodianUser.id);
    const certifierMembership = await createMembership(certifierUser.id);
    const fundingMembership = await createMembership(fundingUser.id);
    const approverMembership = await createMembership(approverUser.id);
    const posterMembership = await createMembership(posterUser.id);
    const foreignMembership = await createMembership(foreignUser.id, foreignAgency.id);
    const employee = await createEmployee(
      admin,
      agency.id,
      subjectMembership.id,
      `${suffix}-1`,
      'Nena Santos',
    );
    await withDatabaseContext(
      {
        agencyId: agency.id,
        userId: subjectUser.id,
        membershipId: subjectMembership.id,
        capabilities: ['employee-membership-link'],
      },
      (transaction) =>
        transaction.agencyMembership.update({
          where: { agencyId_id: { agencyId: agency.id, id: subjectMembership.id } },
          data: { employeeId: employee.id },
        }),
    );

    const policies = new LeavePoliciesService(
      leavePolicyAuditWriter,
      new DocumentsService({} as never, documentAuditWriter),
      new MandatoryLeaveAssessmentsService(mandatoryLeaveAssessmentAuditWriter),
    );
    const accounts = new LeaveAccountsService(
      leaveAccountAuditWriter,
      new DocumentsService({} as never, documentAuditWriter),
      new MandatoryLeaveAssessmentsService(mandatoryLeaveAssessmentAuditWriter),
    );
    const registry = new ApprovalCompletionRegistry();
    const approvals = new ApprovalsService(approvalAuditWriter, registry);
    const service = new LeaveMonetizationService(
      approvals,
      registry,
      new LocalPayrollMonetizationAdapter(salarySource),
      new DocumentsService({} as never, documentAuditWriter),
      new MandatoryLeaveAssessmentsService(mandatoryLeaveAssessmentAuditWriter),
    );
    service.onModuleInit();

    const adminContext = context(agency.id, custodianUser.id, custodianMembership.id, [
      { code: 'leave.monetization.create', scopePolicy: 'AGENCY' },
      { code: 'leave.monetization.submit', scopePolicy: 'AGENCY' },
      { code: 'leave.monetization.withdraw', scopePolicy: 'AGENCY' },
      { code: 'leave.monetization.cancel', scopePolicy: 'AGENCY' },
      { code: 'approvals.routes.create', scopePolicy: 'AGENCY' },
      { code: 'approvals.routes.activate', scopePolicy: 'AGENCY' },
      { code: 'approvals.requests.create', scopePolicy: 'AGENCY' },
      { code: 'leave.types.read', scopePolicy: 'AGENCY' },
      { code: 'leave.types.manage', scopePolicy: 'AGENCY' },
      { code: 'leave.accounts.read', scopePolicy: 'AGENCY' },
      { code: 'leave.credits.adjust', scopePolicy: 'AGENCY' },
      { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
    ]);
    const subjectContext = context(agency.id, subjectUser.id, subjectMembership.id, [
      { code: 'leave.monetization.create', scopePolicy: 'OWN' },
      { code: 'leave.monetization.submit', scopePolicy: 'OWN' },
      { code: 'leave.monetization.certify', scopePolicy: 'AGENCY' },
      { code: 'approvals.requests.create', scopePolicy: 'OWN' },
      { code: 'leave.accounts.read', scopePolicy: 'OWN' },
    ]);
    const certifierContext = context(agency.id, certifierUser.id, certifierMembership.id, [
      { code: 'leave.monetization.certify', scopePolicy: 'AGENCY' },
      { code: 'leave.monetization.return', scopePolicy: 'AGENCY' },
      { code: 'leave.monetization.review_funding', scopePolicy: 'AGENCY' },
      { code: 'leave.accounts.read', scopePolicy: 'AGENCY' },
    ]);
    const fundingContext = context(agency.id, fundingUser.id, fundingMembership.id, [
      { code: 'leave.monetization.review_funding', scopePolicy: 'AGENCY' },
      { code: 'leave.accounts.read', scopePolicy: 'AGENCY' },
    ]);
    const approverContext = context(agency.id, approverUser.id, approverMembership.id, [
      { code: 'approvals.requests.approve', scopePolicy: 'AGENCY' },
      { code: 'leave.monetization.approve', scopePolicy: 'AGENCY' },
      { code: 'leave.monetization.reject', scopePolicy: 'AGENCY' },
      { code: 'leave.monetization.adjust', scopePolicy: 'AGENCY' },
      { code: 'leave.accounts.read', scopePolicy: 'AGENCY' },
    ]);
    const posterContext = context(agency.id, posterUser.id, posterMembership.id, [
      { code: 'leave.monetization.post', scopePolicy: 'AGENCY' },
      { code: 'leave.monetization.adjust', scopePolicy: 'AGENCY' },
      { code: 'approvals.requests.create', scopePolicy: 'AGENCY' },
      { code: 'leave.accounts.read', scopePolicy: 'AGENCY' },
    ]);
    const foreignContext = context(foreignAgency.id, foreignUser.id, foreignMembership.id, [
      { code: 'leave.accounts.read', scopePolicy: 'AGENCY' },
      { code: 'leave.monetization.certify', scopePolicy: 'AGENCY' },
    ]);

    try {
      const hrmoRole = await admin.role.findFirstOrThrow({
        where: { code: 'hrmo_administrator', agencyId: null },
      });
      await admin.membershipRole.create({
        data: {
          agencyId: agency.id,
          membershipId: approverMembership.id,
          roleId: hrmoRole.id,
          effectiveFrom: new Date(`${manilaDate(-30)}T00:00:00.000Z`),
        },
      });

      const routeReason = 'Adopt the Leave Monetization routes for the integration test.';
      const requestRoute = await approvals.createRoute(adminContext, {
        routeCode: LEAVE_MONETIZATION_ROUTE_CODE,
        domain: 'LEAVE',
        versionNo: 1,
        effectiveFrom: manilaDate(-30),
        stepDefinition: {
          steps: [
            {
              stepNo: 1,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'approvals.requests.approve',
              assignment: { kind: 'MEMBERSHIP', membershipId: approverMembership.id },
              requiresSeparateReview: true,
            },
          ],
        },
      });
      await approvals.activateRoute(adminContext, requestRoute.id, routeReason);
      const adjustmentRoute = await approvals.createRoute(adminContext, {
        routeCode: LEAVE_MONETIZATION_ADJUSTMENT_ROUTE_CODE,
        domain: 'LEAVE',
        versionNo: 1,
        effectiveFrom: manilaDate(-30),
        stepDefinition: {
          steps: [
            {
              stepNo: 1,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'approvals.requests.approve',
              assignment: { kind: 'MEMBERSHIP', membershipId: approverMembership.id },
              requiresSeparateReview: true,
            },
          ],
        },
      });
      await approvals.activateRoute(adminContext, adjustmentRoute.id, routeReason);

      const nationalEvidence = await createDocumentVersion(
        admin,
        agency.id,
        custodianMembership.id,
        `${suffix}-national`,
      );
      const accountEvidence = await createDocumentVersion(
        admin,
        agency.id,
        custodianMembership.id,
        `${suffix}-account`,
      );
      const secondAccountEvidence = await createDocumentVersion(
        admin,
        agency.id,
        custodianMembership.id,
        `${suffix}-account-2`,
      );
      const formTemplate = await createDocumentVersion(
        admin,
        agency.id,
        custodianMembership.id,
        `${suffix}-form`,
      );
      const fiscalAuthority = await createDocumentVersion(
        admin,
        agency.id,
        custodianMembership.id,
        `${suffix}-fiscal`,
      );

      const vacation = await policies.create(adminContext, { catalogueCode: 'VACATION_LEAVE' });
      const vacationVersion = await policies.createPolicyVersion(adminContext, vacation.id, {
        effectiveDate: manilaDate(-10),
        approvalRouteCode: 'LEAVE-ROUTE-1',
        applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
        documentRequirements: {},
        reason: 'Adopt the vacation leave policy for the monetization integration test.',
      });
      await policies.linkAuthority(adminContext, vacation.id, vacationVersion.id, {
        authorityClass: 'NATIONAL_RULE',
        documentId: nationalEvidence.documentId,
        citation: 'Rule XVI, sections 1-3',
      });
      await policies.activate(
        adminContext,
        vacation.id,
        vacationVersion.id,
        'Activate vacation leave.',
      );
      const sickness = await policies.create(adminContext, { catalogueCode: 'SICK_LEAVE' });
      const sicknessVersion = await policies.createPolicyVersion(adminContext, sickness.id, {
        effectiveDate: manilaDate(-10),
        approvalRouteCode: 'LEAVE-ROUTE-1',
        applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
        documentRequirements: {},
        reason: 'Adopt the sick leave policy for the monetization integration test.',
      });
      await policies.linkAuthority(adminContext, sickness.id, sicknessVersion.id, {
        authorityClass: 'NATIONAL_RULE',
        documentId: nationalEvidence.documentId,
        citation: 'Rule XVI, sections 1-3',
      });
      await policies.linkAuthority(adminContext, sickness.id, sicknessVersion.id, {
        authorityClass: 'AGENCY_CONFIGURATION',
        documentId: secondAccountEvidence.documentId,
        citation: 'Agency sick-leave configuration for the integration test.',
      });
      await policies.activate(
        adminContext,
        sickness.id,
        sicknessVersion.id,
        'Activate sick leave.',
      );

      const vacationAccount = await accounts.open(
        adminContext,
        {
          employeeId: employee.id,
          leaveTypeId: vacation.id,
          effectiveDate: manilaDate(-5),
          openingQuantity: 20,
          evidenceDocumentId: accountEvidence.documentId,
          reason: 'Opening vacation-leave balance.',
        },
        'monetization-open-vacation',
      );
      const sicknessAccount = await accounts.open(
        adminContext,
        {
          employeeId: employee.id,
          leaveTypeId: sickness.id,
          effectiveDate: manilaDate(-5),
          openingQuantity: 20,
          evidenceDocumentId: secondAccountEvidence.documentId,
          reason: 'Opening sick-leave balance.',
        },
        'monetization-open-sickness',
      );

      const created = await service.create(subjectContext, {}, 'monetization-create-1');
      expect(created).toMatchObject({
        employeeId: employee.id,
        status: 'DRAFT',
        requestedQuantity: '0.0000',
      });
      const replayedCreate = await service.create(subjectContext, {}, 'monetization-create-1');
      expect(replayedCreate.id).toBe(created.id);
      const cancelledDraft = await service.create(adminContext, { employeeId: employee.id });
      const cancelled = await service.cancel(adminContext, cancelledDraft.id, {
        reason: 'No longer needed.',
      });
      expect(cancelled.request.status).toBe('CANCELLED');

      const submitInput = {
        kind: 'REGULAR' as const,
        formTemplateDocumentVersionId: formTemplate.versionId,
        attestationType: 'AUTHENTICATED_SUBMISSION' as const,
        authoritySnapshot: {
          citations: ['DBM BC No. 2016-2'],
          valuationDate: manilaDate(),
          fiscalPeriod: 'FY 2026',
        },
        allocations: [{ leaveAccountId: vacationAccount.id, requestedQuantity: '10' }],
      };
      const submitted = await service.submit(
        subjectContext,
        created.id,
        submitInput,
        'monetization-submit-1',
      );
      expect(submitted.request.status).toBe('SUBMITTED');
      await expect(
        service.assess(subjectContext, created.id, {}, 'monetization-assess-subject'),
      ).rejects.toMatchObject({ code: 'MONETIZATION_ACTOR_SEPARATION', statusCode: 403 });

      const assessed = await service.assess(certifierContext, created.id, {});
      expect(assessed.assessment).toMatchObject({ result: 'ELIGIBLE' });
      const allocationId = assessed.allocations[0]!.id;
      const certified = await service.certify(certifierContext, created.id, {
        allocations: [{ allocationId, certifiedQuantity: '10' }],
      });
      expect(certified.request.status).toBe('CREDIT_CERTIFIED');
      expect(certified.certification?.lines[0]).toMatchObject({ certifiedQuantity: '10.0000' });

      await expect(
        service.determineFunding(certifierContext, created.id, {
          result: 'SUPPORTED',
          fiscalAuthorityDocumentVersionId: fiscalAuthority.versionId,
          fundingSourceSnapshot: { source: 'GAA 2026', availability: 'SUPPORTED' },
          evidenceSnapshot: { reference: 'FUND-2026-01' },
        }),
      ).rejects.toMatchObject({ code: 'MONETIZATION_ACTOR_SEPARATION', statusCode: 403 });

      const fundedByReviewer = await service.determineFunding(fundingContext, created.id, {
        result: 'SUPPORTED',
        fiscalAuthorityDocumentVersionId: fiscalAuthority.versionId,
        fundingSourceSnapshot: { source: 'GAA 2026', availability: 'SUPPORTED' },
        evidenceSnapshot: { reference: 'FUND-2026-01' },
      });
      expect(fundedByReviewer.request.status).toBe('FOR_APPROVAL');

      const decided = await service.decide(approverContext, created.id, {
        decision: 'APPROVE',
        comments: 'Approved within the annual limit.',
      });
      expect(decided.request.status).toBe('APPROVED');

      const posted = await service.post(posterContext, created.id);
      expect(posted.outcome).toBe('POSTED');
      expect(posted.posting).toMatchObject({ payrollInputId: expect.any(String) });
      const postingId = posted.posting!.id;
      const replay = await service.post(posterContext, created.id);
      expect(replay).toMatchObject({ outcome: 'ALREADY_POSTED', posting: { id: postingId } });

      const payrollInput = await admin.payrollMonetizationEarningInput.findFirstOrThrow({
        where: { agencyId: agency.id, id: posted.posting!.payrollInputId },
      });
      expect(payrollInput.status).toBe('PENDING');
      expect(payrollInput.quantity.toFixed(4)).toBe('10.0000');
      expect(payrollInput.amount.toFixed(2)).toBe('14457.81');

      const postingEntry = await admin.leaveLedgerEntry.findFirstOrThrow({
        where: {
          agencyId: agency.id,
          sourceType: 'MONETIZATION_POSTING',
          sourceId: certified.request.currentVersionId!,
        },
      });
      expect(postingEntry.quantity.toFixed(4)).toBe('-10.0000');

      const adjustment = await service.createAdjustment(posterContext, postingId, {
        scope: 'PARTIAL',
        reason: 'The employee retains four days and monetizes the rest.',
        lines: [{ originalLedgerEntryId: postingEntry.id, retainedQuantity: '4' }],
      });
      expect(adjustment.status).toBe('DRAFT');
      const adjustmentForApproval = await service.submitAdjustment(posterContext, adjustment.id);
      expect(adjustmentForApproval.status).toBe('FOR_APPROVAL');
      const decidedAdjustment = await service.decideAdjustment(approverContext, adjustment.id, {
        decision: 'APPROVE',
        comments: 'Adjustment approved.',
      });
      expect(decidedAdjustment.adjustment.status).toBe('APPLIED');
      expect(decidedAdjustment.adjustment.lines[0]).toMatchObject({
        retainedQuantity: '4.0000',
        reversalLedgerEntryId: expect.any(String),
        replacementLedgerEntryId: expect.any(String),
      });

      const reversal = await admin.leaveLedgerEntry.findFirstOrThrow({
        where: {
          agencyId: agency.id,
          id: decidedAdjustment.adjustment.lines[0]!.reversalLedgerEntryId!,
        },
      });
      expect(reversal).toMatchObject({ reversesEntryId: postingEntry.id });
      expect(reversal.quantity.toFixed(4)).toBe('10.0000');
      const replacement = await admin.leaveLedgerEntry.findFirstOrThrow({
        where: {
          agencyId: agency.id,
          id: decidedAdjustment.adjustment.lines[0]!.replacementLedgerEntryId!,
        },
      });
      expect(replacement.quantity.toFixed(4)).toBe('-4.0000');
      const settledPayrollInput = await admin.payrollMonetizationEarningInput.findFirstOrThrow({
        where: { agencyId: agency.id, id: posted.posting!.payrollInputId },
      });
      expect(settledPayrollInput.status).toBe('SUPERSEDED');
      const linkedPayrollInput = await admin.payrollMonetizationEarningInput.findFirstOrThrow({
        where: {
          agencyId: agency.id,
          sourceType: 'MONETIZATION_ADJUSTMENT',
          sourceId: adjustment.id,
        },
      });
      expect(linkedPayrollInput.quantity.toFixed(4)).toBe('4.0000');
      expect(linkedPayrollInput.amount.toFixed(2)).toBe('5783.12');

      const ledgerBalance = await admin.leaveLedgerEntry.aggregate({
        where: { agencyId: agency.id, leaveAccountId: vacationAccount.id },
        _sum: { quantity: true },
      });
      expect(ledgerBalance._sum.quantity?.toFixed(4)).toBe('16.0000');
      const commitments = await admin.leaveCreditCommitment.findMany({
        where: { agencyId: agency.id, leaveAccountId: vacationAccount.id },
        orderBy: { id: 'asc' },
      });
      expect(commitments.map(({ status }) => status)).toEqual(['CONSUMED']);

      const subjectList = await service.list(subjectContext);
      expect(subjectList.items.map(({ id }) => id)).toContain(created.id);
      const foreignList = await service.list(
        context(foreignAgency.id, foreignUser.id, foreignMembership.id, [
          { code: 'leave.accounts.read', scopePolicy: 'AGENCY' },
        ]),
      );
      expect(foreignList.items).toEqual([]);
      await expect(service.findById(foreignContext, created.id)).resolves.toBeNull();
      await expect(
        service.certify(foreignContext, created.id, { allocations: [{ allocationId }] }),
      ).rejects.toMatchObject({ code: 'MONETIZATION_REQUEST_NOT_FOUND', statusCode: 404 });

      const withdrawRequest = await service.create(adminContext, { employeeId: employee.id });
      await service.submit(adminContext, withdrawRequest.id, submitInput);
      const withdrawn = await service.withdraw(adminContext, withdrawRequest.id, {
        reason: 'The employee withdrew the request.',
      });
      expect(withdrawn.request.status).toBe('WITHDRAWN');

      const blockedRequest = await service.create(adminContext, { employeeId: employee.id });
      const blockedSubmitted = await service.submit(adminContext, blockedRequest.id, submitInput);
      expect(blockedSubmitted.request.status).toBe('SUBMITTED');
      const blockedAssessed = await service.assess(certifierContext, blockedRequest.id, {});
      expect(blockedAssessed.assessment).toMatchObject({ result: 'ELIGIBLE' });
      await service.certify(certifierContext, blockedRequest.id, {
        allocations: [
          { allocationId: blockedAssessed.allocations[0]!.id, certifiedQuantity: '10' },
        ],
      });
      const heldCommitments = await admin.leaveCreditCommitment.findMany({
        where: { agencyId: agency.id, leaveAccountId: vacationAccount.id },
        orderBy: { id: 'asc' },
      });
      expect(heldCommitments.map(({ status }) => status).sort()).toEqual(['ACTIVE', 'CONSUMED']);
      const blockedFunding = await service.determineFunding(fundingContext, blockedRequest.id, {
        result: 'INDETERMINATE',
        fiscalAuthorityDocumentVersionId: fiscalAuthority.versionId,
        fundingSourceSnapshot: {},
        evidenceSnapshot: {},
      });
      expect(blockedFunding.request.status).toBe('NEEDS_INFORMATION');
      const releasedCommitments = await admin.leaveCreditCommitment.findMany({
        where: { agencyId: agency.id, leaveAccountId: vacationAccount.id },
        orderBy: { id: 'asc' },
      });
      expect(releasedCommitments.map(({ status }) => status).sort()).toEqual([
        'CONSUMED',
        'RELEASED',
      ]);

      const failClosedService = new LeaveMonetizationService(
        approvals,
        registry,
        new FailClosedPayrollMonetizationProvider(),
        new DocumentsService({} as never, documentAuditWriter),
        new MandatoryLeaveAssessmentsService(mandatoryLeaveAssessmentAuditWriter),
      );
      failClosedService.onModuleInit();
      const specialRequest = await failClosedService.create(adminContext, {
        employeeId: employee.id,
      });
      await failClosedService.submit(adminContext, specialRequest.id, {
        kind: 'SPECIAL',
        reason: 'Medical hardship grounded on the cited authority.',
        formTemplateDocumentVersionId: formTemplate.versionId,
        attestationType: 'AUTHENTICATED_SUBMISSION',
        authoritySnapshot: {
          citations: ['CSC MC No. 5, s. 2021'],
          valuationDate: manilaDate(),
          specialPercentageBasis: 'PER_ACCOUNT',
          fractionalCreditRounding: 'DOWN',
        },
        allocations: [{ leaveAccountId: sicknessAccount.id, requestedQuantity: '10' }],
      });
      const specialAssessed = await failClosedService.assess(
        certifierContext,
        specialRequest.id,
        {},
      );
      expect(specialAssessed.assessment).toMatchObject({ result: 'ELIGIBLE' });
      await failClosedService.certify(certifierContext, specialRequest.id, {
        allocations: [
          { allocationId: specialAssessed.allocations[0]!.id, certifiedQuantity: '10' },
        ],
      });
      await failClosedService.determineFunding(fundingContext, specialRequest.id, {
        result: 'SUPPORTED',
        fiscalAuthorityDocumentVersionId: fiscalAuthority.versionId,
        fundingSourceSnapshot: { source: 'GAA 2026', availability: 'SUPPORTED' },
        evidenceSnapshot: { reference: 'FUND-2026-02' },
      });
      await failClosedService.decide(approverContext, specialRequest.id, {
        decision: 'APPROVE',
        comments: 'Approved for the special authority basis.',
      });
      await expect(failClosedService.post(posterContext, specialRequest.id)).rejects.toMatchObject({
        statusCode: 503,
        code: 'PAYROLL_MONETIZATION_AUTHORITY_MISSING',
      });
      expect(
        (await failClosedService.findById(adminContext, specialRequest.id))?.request.status,
      ).toBe('APPROVED');
      expect(
        await admin.payrollMonetizationEarningInput.count({
          where: {
            agencyId: agency.id,
            sourceType: 'MONETIZATION_POSTING',
            sourceId: specialAssessed.request.currentVersionId!,
          },
        }),
      ).toBe(0);
    } finally {
      await admin.$disconnect();
    }
  },
  180_000,
);
