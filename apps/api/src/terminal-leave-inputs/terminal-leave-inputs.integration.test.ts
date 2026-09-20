import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import { separationAuditWriter, SeparationsService } from '../separations/separations.service';
import {
  leaveAccountAuditWriter,
  LeaveAccountsService,
} from '../leave-accounts/leave-accounts.service';
import {
  TerminalLeaveInputsService,
  terminalLeaveInputAuditWriter,
  type SeparationQualification,
} from './terminal-leave-inputs.service';

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
    requestId: 'terminal-leave-input-integration-test',
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

async function createEvidence(
  admin: PrismaClient,
  agencyId: string,
  membershipId: string,
  suffix: string,
  finalized = true,
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
      storageKey: `terminal-leave-input-integration/${suffix}`,
      contentHash: 'c'.repeat(64),
      mimeType: 'application/pdf',
      sizeBytes: 1,
      ...(finalized ? { issuedAt: new Date(`${manilaDate(-30)}T00:00:00.000Z`) } : {}),
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

async function createLeaveType(
  admin: PrismaClient,
  agencyId: string,
  membershipId: string,
  code: string,
  name: string,
) {
  const leaveType = await admin.leaveType.create({
    data: {
      agencyId,
      code,
      name,
      status: 'ACTIVE',
      createdByMembershipId: membershipId,
      updatedByMembershipId: membershipId,
    },
  });
  const version = await withDatabaseContext(
    {
      agencyId,
      membershipId,
      capabilities: ['leave-policy-transition'],
    },
    (transaction) =>
      transaction.leavePolicyVersion.create({
        data: {
          agencyId,
          leaveTypeId: leaveType.id,
          versionNo: 1,
          entitlementBasis: 'ACCRUED_ACCOUNT',
          calendarBasis: 'WORKING_DAY',
          evaluatorKind: 'SERVICE_ACCRUAL',
          approvalRouteCode: 'LEAVE-ROUTE-1',
          effectiveFrom: new Date(`${manilaDate(-60)}T00:00:00.000Z`),
          status: 'ACTIVE',
          createdByMembershipId: membershipId,
          updatedByMembershipId: membershipId,
        },
      }),
  );
  return { leaveType, version };
}

it.skipIf(!enabled)(
  'preserves immutable terminal leave inputs under RLS',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-terminal`;
    const agency = await admin.agency.create({
      data: {
        code: `TLI-${suffix}`,
        name: 'Terminal Leave Input Integration Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const foreignAgency = await admin.agency.create({
      data: {
        code: `TLI-F-${suffix}`,
        name: 'Foreign Terminal Leave Input Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        identityProvider: 'terminal-leave-input-integration',
        externalSubject: `terminal-${suffix}`,
        emailNormalized: `terminal-${suffix}@example.test`,
        displayName: 'Terminal Leave Custodian',
        globalStatus: 'ACTIVE',
      },
    });
    const foreignUser = await admin.user.create({
      data: {
        identityProvider: 'terminal-leave-input-integration',
        externalSubject: `foreign-terminal-${suffix}`,
        emailNormalized: `foreign-terminal-${suffix}@example.test`,
        displayName: 'Foreign Terminal Leave Custodian',
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
    const unit = await admin.organizationUnit.create({
      data: { agencyId: agency.id, code: `TLI-${suffix}`, unitType: 'DIVISION', status: 'ACTIVE' },
    });
    const employee = await createEmployee(
      admin,
      agency.id,
      membership.id,
      `${suffix}-1`,
      'Elena Santos',
    );
    const incompleteEmployee = await createEmployee(
      admin,
      agency.id,
      membership.id,
      `${suffix}-2`,
      'Fidel Ramos',
    );
    const pendingEmployee = await createEmployee(
      admin,
      agency.id,
      membership.id,
      `${suffix}-3`,
      'Gina Lim',
    );
    const createSegment = (
      employeeId: string,
      salaryGrade: number | null,
      salaryStep: number | null,
    ) =>
      withDatabaseContext(
        {
          agencyId: agency.id,
          userId: user.id,
          membershipId: membership.id,
          capabilities: ['personnel-baseline-transition'],
        },
        (transaction) =>
          transaction.serviceSegment.create({
            data: {
              agencyId: agency.id,
              employeeId,
              organizationUnitId: unit.id,
              appointmentStatus: 'PERMANENT',
              ...(salaryGrade === null ? {} : { salaryGrade }),
              ...(salaryStep === null ? {} : { salaryStep }),
              effectiveFrom: new Date(`${manilaDate(-60)}T00:00:00.000Z`),
              status: 'ACTIVE',
              createdByMembershipId: membership.id,
            },
          }),
      );
    const segment = await createSegment(employee.id, 18, 3);
    const incompleteSegment = await createSegment(incompleteEmployee.id, null, null);
    const pendingSegment = await createSegment(pendingEmployee.id, 12, 2);
    const effectuatedAt = new Date(`${manilaDate(-5)}T02:00:00.000Z`);
    const separationCase = await admin.separationCase.create({
      data: {
        agencyId: agency.id,
        employeeId: employee.id,
        separationType: 'RESIGNATION',
        proposedEffectiveDate: new Date(`${manilaDate(-5)}T00:00:00.000Z`),
        approvedEffectiveDate: new Date(`${manilaDate(-5)}T00:00:00.000Z`),
        status: 'EFFECTIVE',
        reason: 'The employee resigned for personal reasons.',
        initiatedByMembershipId: membership.id,
        approvedByMembershipId: membership.id,
        serviceSegmentId: segment.id,
        effectuatedAt,
      },
    });
    const incompleteCase = await admin.separationCase.create({
      data: {
        agencyId: agency.id,
        employeeId: incompleteEmployee.id,
        separationType: 'RESIGNATION',
        proposedEffectiveDate: new Date(`${manilaDate(-5)}T00:00:00.000Z`),
        approvedEffectiveDate: new Date(`${manilaDate(-5)}T00:00:00.000Z`),
        status: 'EFFECTIVE',
        reason: 'The employee resigned for personal reasons.',
        initiatedByMembershipId: membership.id,
        approvedByMembershipId: membership.id,
        serviceSegmentId: incompleteSegment.id,
        effectuatedAt,
      },
    });
    const pendingCase = await admin.separationCase.create({
      data: {
        agencyId: agency.id,
        employeeId: pendingEmployee.id,
        separationType: 'RESIGNATION',
        proposedEffectiveDate: new Date(`${manilaDate(-5)}T00:00:00.000Z`),
        approvedEffectiveDate: new Date(`${manilaDate(-5)}T00:00:00.000Z`),
        status: 'EFFECTIVE',
        reason: 'The employee resigned for personal reasons.',
        initiatedByMembershipId: membership.id,
        approvedByMembershipId: membership.id,
        serviceSegmentId: pendingSegment.id,
        effectuatedAt,
      },
    });
    const dismissalCase = await admin.separationCase.create({
      data: {
        agencyId: agency.id,
        employeeId: incompleteEmployee.id,
        separationType: 'DISMISSAL',
        proposedEffectiveDate: new Date(`${manilaDate(-5)}T00:00:00.000Z`),
        approvedEffectiveDate: new Date(`${manilaDate(-5)}T00:00:00.000Z`),
        status: 'EFFECTIVE',
        reason: 'The employee was dismissed.',
        initiatedByMembershipId: membership.id,
        approvedByMembershipId: membership.id,
        serviceSegmentId: incompleteSegment.id,
        effectuatedAt,
      },
    });
    const terminationCase = await admin.separationCase.create({
      data: {
        agencyId: agency.id,
        employeeId: incompleteEmployee.id,
        separationType: 'TERMINATION',
        proposedEffectiveDate: new Date(`${manilaDate(-5)}T00:00:00.000Z`),
        approvedEffectiveDate: new Date(`${manilaDate(-5)}T00:00:00.000Z`),
        status: 'EFFECTIVE',
        reason: 'The appointment was terminated.',
        initiatedByMembershipId: membership.id,
        approvedByMembershipId: membership.id,
        serviceSegmentId: incompleteSegment.id,
        effectuatedAt,
      },
    });
    const clearedCase = await admin.separationCase.create({
      data: {
        agencyId: agency.id,
        employeeId: incompleteEmployee.id,
        separationType: 'RESIGNATION',
        proposedEffectiveDate: new Date(`${manilaDate(-5)}T00:00:00.000Z`),
        approvedEffectiveDate: new Date(`${manilaDate(-5)}T00:00:00.000Z`),
        status: 'CLEARED',
        reason: 'The employee resigned for personal reasons.',
        initiatedByMembershipId: membership.id,
        approvedByMembershipId: membership.id,
        serviceSegmentId: incompleteSegment.id,
      },
    });

    const documents = new DocumentsService({} as never, documentAuditWriter);
    const separationsService = new SeparationsService(separationAuditWriter);
    const accountsService = new LeaveAccountsService(leaveAccountAuditWriter, documents);
    const service = new TerminalLeaveInputsService(
      terminalLeaveInputAuditWriter,
      documents,
      separationsService,
    );

    try {
      const vacation = await createLeaveType(
        admin,
        agency.id,
        membership.id,
        'VACATION_LEAVE',
        'Vacation Leave',
      );
      const sick = await createLeaveType(
        admin,
        agency.id,
        membership.id,
        'SICK_LEAVE',
        'Sick Leave',
      );
      const accountEvidenceId = await createEvidence(
        admin,
        agency.id,
        membership.id,
        `${suffix}-account`,
      );
      const clearanceEvidenceId = await createEvidence(
        admin,
        agency.id,
        membership.id,
        `${suffix}-clearance`,
      );
      const supportingEvidenceId = await createEvidence(
        admin,
        agency.id,
        membership.id,
        `${suffix}-supporting`,
      );
      const salaryEvidenceId = await createEvidence(
        admin,
        agency.id,
        membership.id,
        `${suffix}-salary`,
      );
      const unfinalizedEvidenceId = await createEvidence(
        admin,
        agency.id,
        membership.id,
        `${suffix}-unfinalized`,
        false,
      );
      const foreignEvidenceId = await createEvidence(
        admin,
        foreignAgency.id,
        foreignMembership.id,
        `${suffix}-foreign`,
      );

      const accountContext = context(agency.id, user.id, membership.id, [
        { code: 'leave.accounts.read', scopePolicy: 'AGENCY' },
        { code: 'leave.credits.adjust', scopePolicy: 'AGENCY' },
        { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
      ]);
      const terminalContext = context(agency.id, user.id, membership.id, [
        { code: 'leave.terminal_inputs.read', scopePolicy: 'AGENCY' },
        { code: 'leave.terminal_inputs.preserve', scopePolicy: 'AGENCY' },
        { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
      ]);
      const foreignContext = context(foreignAgency.id, foreignUser.id, foreignMembership.id, [
        { code: 'leave.terminal_inputs.read', scopePolicy: 'AGENCY' },
        { code: 'leave.terminal_inputs.preserve', scopePolicy: 'AGENCY' },
        { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
      ]);

      await accountsService.open(accountContext, {
        employeeId: employee.id,
        leaveTypeId: vacation.leaveType.id,
        effectiveDate: manilaDate(-10),
        openingQuantity: 10,
        evidenceDocumentId: accountEvidenceId,
      });
      await accountsService.open(accountContext, {
        employeeId: employee.id,
        leaveTypeId: sick.leaveType.id,
        effectiveDate: manilaDate(-10),
        openingQuantity: 5,
        evidenceDocumentId: accountEvidenceId,
      });
      const pendingAccount = await accountsService.open(accountContext, {
        employeeId: pendingEmployee.id,
        leaveTypeId: vacation.leaveType.id,
        effectiveDate: manilaDate(-10),
        openingQuantity: 10,
        evidenceDocumentId: accountEvidenceId,
      });
      await accountsService.open(accountContext, {
        employeeId: pendingEmployee.id,
        leaveTypeId: sick.leaveType.id,
        effectiveDate: manilaDate(-10),
        openingQuantity: 5,
        evidenceDocumentId: accountEvidenceId,
      });

      const candidates = await service.listCandidates(terminalContext);
      const candidateIds = candidates.map((candidate) => candidate.separationCaseId);
      expect(candidateIds).toEqual(
        expect.arrayContaining([
          separationCase.id,
          incompleteCase.id,
          pendingCase.id,
          dismissalCase.id,
        ]),
      );
      expect(candidateIds).not.toContain(terminationCase.id);
      expect(candidateIds).not.toContain(clearedCase.id);
      expect(
        candidates.find((candidate) => candidate.separationCaseId === separationCase.id)
          ?.hasReadySnapshot,
      ).toBe(false);

      await expect(
        service.preserve(terminalContext, {
          separationCaseId: separationCase.id,
          clearanceDocumentId: unfinalizedEvidenceId,
        }),
      ).rejects.toMatchObject({
        code: 'TERMINAL_LEAVE_INPUT_DOCUMENT_INELIGIBLE',
        statusCode: 400,
        reasons: ['STATUS_INELIGIBLE'],
      });
      await expect(
        service.preserve(terminalContext, {
          separationCaseId: separationCase.id,
          clearanceDocumentId: foreignEvidenceId,
        }),
      ).rejects.toMatchObject({
        code: 'TERMINAL_LEAVE_INPUT_DOCUMENT_INELIGIBLE',
        reasons: ['DOCUMENT_NOT_FOUND'],
      });

      const preserved = await service.preserve(
        terminalContext,
        {
          separationCaseId: separationCase.id,
          clearanceDocumentId: clearanceEvidenceId,
          supportingDocumentIds: [supportingEvidenceId],
          salarySourceDocumentId: salaryEvidenceId,
        },
        'preserve-terminal-1',
      );
      expect(preserved.assessment.result).toBe('READY');
      expect(preserved.assessment.separationSourceVersionKey).toBe(effectuatedAt.toISOString());
      expect(preserved.assessment.missingOrConflictingFacts).toEqual([]);
      const snapshot = preserved.snapshot;
      if (!snapshot) throw new Error('A READY assessment must freeze a snapshot.');
      expect(snapshot.snapshotKey).toBe(preserved.assessment.id);
      expect(snapshot.lines.map((line) => line.leaveTypeCode).sort()).toEqual([
        'SICK_LEAVE',
        'VACATION_LEAVE',
      ]);
      expect(snapshot.lines.map((line) => line.postedBalance).sort()).toEqual([
        '10.0000',
        '5.0000',
      ]);
      expect((snapshot.salarySourceReference as { valueResolution: string }).valueResolution).toBe(
        'DEFERRED_TO_PAYROLL',
      );
      expect(
        (snapshot.clearanceDocumentSnapshot as { clearanceDocument: { documentId: string } })
          .clearanceDocument.documentId,
      ).toBe(clearanceEvidenceId);
      expect(
        (
          snapshot.serviceSourceSnapshot as {
            separation: { separationCaseId: string; qualification: string };
          }
        ).separation.qualification,
      ).toBe('QUALIFYING');

      const replayedAgain = await service.preserve(
        terminalContext,
        {
          separationCaseId: separationCase.id,
          clearanceDocumentId: clearanceEvidenceId,
          supportingDocumentIds: [supportingEvidenceId],
          salarySourceDocumentId: salaryEvidenceId,
        },
        'preserve-terminal-1',
      );
      expect(replayedAgain.assessment.id).toBe(preserved.assessment.id);
      await expect(
        service.preserve(
          terminalContext,
          {
            separationCaseId: separationCase.id,
            clearanceDocumentId: clearanceEvidenceId,
            salarySourceDocumentId: salaryEvidenceId,
          },
          'preserve-terminal-1',
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', statusCode: 409 });
      await expect(
        admin.auditEvent.count({
          where: { agencyId: agency.id, action: 'TERMINAL_LEAVE_INPUT_PRESERVED' },
        }),
      ).resolves.toBe(1);

      await expect(
        service.preserve(terminalContext, { separationCaseId: separationCase.id }),
      ).rejects.toMatchObject({
        code: 'TERMINAL_LEAVE_INPUT_SUPERSEDES_REQUIRED',
        statusCode: 409,
      });
      const successor = await service.preserve(terminalContext, {
        separationCaseId: separationCase.id,
        clearanceDocumentId: clearanceEvidenceId,
        salarySourceDocumentId: salaryEvidenceId,
        supersedesSnapshotId: snapshot.id,
        reason: 'The clearance document was reissued with a corrected date.',
      });
      expect(successor.snapshot?.supersedesSnapshotId).toBe(snapshot.id);
      await expect(
        service.preserve(terminalContext, {
          separationCaseId: separationCase.id,
          clearanceDocumentId: clearanceEvidenceId,
          salarySourceDocumentId: salaryEvidenceId,
          supersedesSnapshotId: snapshot.id,
          reason: 'A second successor must not fork the chain.',
        }),
      ).rejects.toMatchObject({ code: 'TERMINAL_LEAVE_INPUT_SUPERSEDES_REQUIRED' });
      const candidatesAfter = await service.listCandidates(terminalContext);
      expect(
        candidatesAfter.find((candidate) => candidate.separationCaseId === separationCase.id)
          ?.hasReadySnapshot,
      ).toBe(true);

      const indeterminate = await service.preserve(terminalContext, {
        separationCaseId: incompleteCase.id,
      });
      expect(indeterminate.assessment.result).toBe('INDETERMINATE');
      expect(indeterminate.snapshot).toBeNull();
      expect(
        indeterminate.assessment.missingOrConflictingFacts.map((finding) => finding.code),
      ).toEqual(
        expect.arrayContaining([
          'CLEARANCE_EVIDENCE_MISSING',
          'SALARY_SOURCE_INCOMPLETE',
          'LEAVE_ACCOUNT_MISSING',
        ]),
      );

      const dismissed = await service.preserve(terminalContext, {
        separationCaseId: dismissalCase.id,
      });
      expect(dismissed.assessment.result).toBe('INDETERMINATE');
      expect(dismissed.snapshot).toBeNull();
      expect(
        (
          dismissed.assessment.inputFacts as {
            separation: { qualification: SeparationQualification };
          }
        ).separation.qualification,
      ).toBe('QUALIFYING');
      await expect(
        service.preserve(terminalContext, { separationCaseId: terminationCase.id }),
      ).rejects.toMatchObject({
        code: 'TERMINAL_LEAVE_INPUT_SEPARATION_CLASSIFICATION_UNRESOLVED',
        statusCode: 409,
      });
      await expect(
        service.preserve(terminalContext, { separationCaseId: clearedCase.id }),
      ).rejects.toMatchObject({
        code: 'TERMINAL_LEAVE_INPUT_SEPARATION_NOT_EFFECTIVE',
        statusCode: 409,
      });
      await expect(
        service.preserve(terminalContext, { separationCaseId: randomUUID() }),
      ).rejects.toMatchObject({
        code: 'TERMINAL_LEAVE_INPUT_SEPARATION_NOT_FOUND',
        statusCode: 404,
      });
      const commitment = await admin.leaveCreditCommitment.create({
        data: {
          agencyId: agency.id,
          leaveAccountId: pendingAccount.id,
          quantity: 1,
          sourceType: 'LeaveApplicationVersion',
          sourceId: randomUUID(),
          sourceCommitmentKey: 'CERTIFIED',
          status: 'ACTIVE',
          effectiveFrom: new Date(`${manilaDate(-10)}T00:00:00.000Z`),
        },
      });
      const futureCommitment = await admin.leaveCreditCommitment.create({
        data: {
          agencyId: agency.id,
          leaveAccountId: pendingAccount.id,
          quantity: 1,
          sourceType: 'LeaveApplicationVersion',
          sourceId: randomUUID(),
          sourceCommitmentKey: 'CERTIFIED',
          status: 'ACTIVE',
          effectiveFrom: new Date(`${manilaDate(30)}T00:00:00.000Z`),
        },
      });
      await expect(
        service.preserve(terminalContext, { separationCaseId: pendingCase.id }),
      ).rejects.toMatchObject({
        code: 'TERMINAL_LEAVE_INPUT_POSTINGS_INCOMPLETE',
        statusCode: 409,
        reasons: [`LeaveApplicationVersion:${commitment.sourceId}`],
      });
      await admin.leaveCreditCommitment.update({
        where: { id: commitment.id },
        data: { status: 'CONSUMED', endedAt: new Date() },
      });
      const settled = await service.preserve(terminalContext, {
        separationCaseId: pendingCase.id,
        clearanceDocumentId: clearanceEvidenceId,
      });
      expect(settled.assessment.result).toBe('READY');
      expect(futureCommitment.status).toBe('ACTIVE');

      const successorSnapshotId = successor.snapshot?.id;
      if (!successorSnapshotId) throw new Error('The successor must freeze a snapshot.');
      const accepted = await service.recordHandoffOutcome(terminalContext, {
        snapshotId: successorSnapshotId,
        attemptKey: 'handoff-1',
        result: 'ACCEPTED',
        separationReference: { terminalLeaveClaimId: randomUUID() },
      });
      expect(accepted.result).toBe('ACCEPTED');
      const acceptedReplay = await service.recordHandoffOutcome(terminalContext, {
        snapshotId: successorSnapshotId,
        attemptKey: 'handoff-1',
        result: 'ACCEPTED',
        separationReference: accepted.separationReference as Record<string, unknown>,
      });
      expect(acceptedReplay.id).toBe(accepted.id);
      await expect(
        service.recordHandoffOutcome(terminalContext, {
          snapshotId: successorSnapshotId,
          attemptKey: 'handoff-1',
          result: 'REJECTED',
          reason: 'A different outcome must not reuse the attempt key.',
        }),
      ).rejects.toMatchObject({
        code: 'TERMINAL_LEAVE_INPUT_HANDOFF_ATTEMPT_CONFLICT',
        statusCode: 409,
      });
      await service.recordHandoffOutcome(terminalContext, {
        snapshotId: successorSnapshotId,
        attemptKey: 'handoff-2',
        result: 'RETRYABLE_FAILURE',
        reason: 'The owning service was unavailable.',
      });
      const detail = await service.findById(terminalContext, successor.assessment.id);
      expect(detail?.snapshot?.outcomes.map((outcome) => outcome.attemptKey)).toEqual([
        'handoff-1',
        'handoff-2',
      ]);
      await expect(
        admin.auditEvent.count({
          where: { agencyId: agency.id, action: 'TERMINAL_LEAVE_INPUT_HANDOFF_RECORDED' },
        }),
      ).resolves.toBe(2);

      const employeeAssessments = await service.list(terminalContext, {
        employeeId: employee.id,
        result: 'READY',
      });
      expect(employeeAssessments.map((assessment) => assessment.id)).toEqual(
        expect.arrayContaining([preserved.assessment.id]),
      );
      expect(employeeAssessments.every((assessment) => assessment.employeeId === employee.id)).toBe(
        true,
      );
      await expect(service.list(foreignContext)).resolves.toEqual([]);
      await expect(service.findById(foreignContext, preserved.assessment.id)).resolves.toBeNull();
      await expect(
        service.preserve(foreignContext, { separationCaseId: separationCase.id }),
      ).rejects.toMatchObject({
        code: 'TERMINAL_LEAVE_INPUT_SEPARATION_NOT_FOUND',
        statusCode: 404,
      });

      const snapshotId = snapshot.id;
      const assessmentId = preserved.assessment.id;
      await expect(
        admin.terminalLeaveInputAssessment.update({
          where: { id: assessmentId },
          data: { result: 'READY' },
        }),
      ).rejects.toThrow(/immutable/);
      await expect(
        admin.terminalLeaveInputAssessment.delete({ where: { id: assessmentId } }),
      ).rejects.toThrow(/cannot be delete/);
      await expect(
        admin.terminalLeaveInputSnapshot.update({
          where: { id: snapshotId },
          data: { snapshotKey: randomUUID() },
        }),
      ).rejects.toThrow(/immutable/);
      await expect(
        admin.terminalLeaveInputSnapshot.delete({ where: { id: snapshotId } }),
      ).rejects.toThrow(/cannot be delete/);
      await expect(
        admin.terminalLeaveInputSnapshotLine.deleteMany({
          where: { terminalLeaveInputSnapshotId: snapshotId },
        }),
      ).rejects.toThrow(/cannot be delete/);
      await expect(
        admin.terminalLeaveInputHandoffOutcome.delete({ where: { id: accepted.id } }),
      ).rejects.toThrow(/cannot be delete/);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.auditEvent.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.terminalLeaveInputHandoffOutcome.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.terminalLeaveInputSnapshotLine.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.terminalLeaveInputSnapshot.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.terminalLeaveInputAssessment.deleteMany({
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
        await transaction.leavePolicyVersion.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveType.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.separationEffect.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.separationCase.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.serviceSegment.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.documentVersion.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.document.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.agencyMembership.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.employee.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.organizationUnit.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.agency.deleteMany({ where: { id: { in: agencyIds } } });
        await transaction.user.deleteMany({ where: { id: { in: [user.id, foreignUser.id] } } });
      });
      await admin.$disconnect();
    }
  },
  120_000,
);
