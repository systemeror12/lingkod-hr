import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import {
  leavePolicyAuditWriter,
  LeavePoliciesService,
} from '../leave-policies/leave-policies.service';
import { LeaveAccountsService, leaveAccountAuditWriter } from './leave-accounts.service';

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
    requestId: 'leave-account-integration-test',
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
      storageKey: `leave-account-integration/${suffix}`,
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

it.skipIf(!enabled)(
  'posts, freezes, reconciles, and reverses Leave Account credits under RLS',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-leave-account`;
    const agency = await admin.agency.create({
      data: {
        code: `LA-${suffix}`,
        name: 'Leave Account Integration Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const foreignAgency = await admin.agency.create({
      data: {
        code: `LA-F-${suffix}`,
        name: 'Foreign Leave Account Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        emailNormalized: `leave-account-${suffix}@example.test`,
        displayName: 'Leave Account Custodian',
        globalStatus: 'ACTIVE',
      },
    });
    const foreignUser = await admin.user.create({
      data: {
        emailNormalized: `foreign-leave-account-${suffix}@example.test`,
        displayName: 'Foreign Leave Account Custodian',
        globalStatus: 'ACTIVE',
      },
    });
    const agencyIds = [agency.id, foreignAgency.id];
    const foreignMembership = await admin.agencyMembership.create({
      data: { agencyId: foreignAgency.id, userId: foreignUser.id, status: 'ACTIVE' },
    });
    const membership = await admin.agencyMembership.create({
      data: {
        agencyId: agency.id,
        userId: user.id,
        status: 'ACTIVE',
      },
    });
    const employee = await createEmployee(
      admin,
      agency.id,
      membership.id,
      `${suffix}-1`,
      'Ana Reyes',
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
    const secondEmployee = await createEmployee(
      admin,
      agency.id,
      membership.id,
      `${suffix}-2`,
      'Ben Cruz',
    );
    const thirdEmployee = await createEmployee(
      admin,
      agency.id,
      membership.id,
      `${suffix}-3`,
      'Cara Diaz',
    );
    const fourthEmployee = await createEmployee(
      admin,
      agency.id,
      membership.id,
      `${suffix}-4`,
      'Dino Eliz',
    );

    const policies = new LeavePoliciesService(
      leavePolicyAuditWriter,
      new DocumentsService({} as never, documentAuditWriter),
    );
    const service = new LeaveAccountsService(
      leaveAccountAuditWriter,
      new DocumentsService({} as never, documentAuditWriter),
    );

    try {
      const policyContext = context(agency.id, user.id, membership.id, [
        { code: 'leave.types.read', scopePolicy: 'AGENCY' },
        { code: 'leave.types.manage', scopePolicy: 'AGENCY' },
        { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
      ]);
      const nationalEvidenceId = await createEvidence(
        admin,
        agency.id,
        membership.id,
        `${suffix}-national`,
      );
      const accountEvidenceId = await createEvidence(
        admin,
        agency.id,
        membership.id,
        `${suffix}-account`,
      );
      const authorityEvidenceId = await createEvidence(
        admin,
        agency.id,
        membership.id,
        `${suffix}-authority`,
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

      const vacation = await policies.create(policyContext, { catalogueCode: 'VACATION_LEAVE' });
      const version = await policies.createPolicyVersion(policyContext, vacation.id, {
        effectiveDate: manilaDate(-10),
        approvalRouteCode: 'LEAVE-ROUTE-1',
        applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
        documentRequirements: {},
        reason: 'Adopt the vacation leave policy for the integration test.',
      });
      await policies.linkAuthority(policyContext, vacation.id, version.id, {
        authorityClass: 'NATIONAL_RULE',
        documentId: nationalEvidenceId,
        citation: 'Rule XVI, sections 1-3',
      });
      await policies.activate(policyContext, vacation.id, version.id, 'Activate vacation leave.');

      const mandatory = await admin.leaveType.create({
        data: {
          agencyId: agency.id,
          code: 'MANDATORY_LEAVE',
          name: 'Mandatory Leave',
          status: 'ACTIVE',
          createdByMembershipId: membership.id,
          updatedByMembershipId: membership.id,
        },
      });
      const inactiveSick = await policies.create(policyContext, { catalogueCode: 'SICK_LEAVE' });
      await policies.update(policyContext, inactiveSick.id, { status: 'INACTIVE' });

      const contextAgency = context(agency.id, user.id, membership.id, [
        { code: 'leave.accounts.read', scopePolicy: 'AGENCY' },
        { code: 'leave.credits.adjust', scopePolicy: 'AGENCY' },
        { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
      ]);
      const contextOwn = context(agency.id, user.id, membership.id, [
        { code: 'leave.accounts.read', scopePolicy: 'OWN' },
      ]);
      const foreignContext = context(foreignAgency.id, foreignUser.id, foreignMembership.id, [
        { code: 'leave.accounts.read', scopePolicy: 'AGENCY' },
        { code: 'leave.credits.adjust', scopePolicy: 'AGENCY' },
        { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
      ]);

      const accountA = await service.open(
        contextAgency,
        {
          employeeId: employee.id,
          leaveTypeId: vacation.id,
          effectiveDate: manilaDate(-5),
          openingQuantity: 10,
          evidenceDocumentId: accountEvidenceId,
          reason: 'Opening balance carried from the service record.',
        },
        'open-account-a',
      );
      expect(accountA.status).toBe('ACTIVE');
      expect(accountA.balances.postedQuantity).toBe('10.0000');
      expect(accountA.balances.availableQuantity).toBe('10.0000');

      await expect(
        service.open(contextAgency, {
          employeeId: employee.id,
          leaveTypeId: vacation.id,
          effectiveDate: manilaDate(-4),
          openingQuantity: 8,
          evidenceDocumentId: accountEvidenceId,
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_ALREADY_OPEN', statusCode: 409 });

      const replayed = await service.open(
        contextAgency,
        {
          employeeId: employee.id,
          leaveTypeId: vacation.id,
          effectiveDate: manilaDate(-5),
          openingQuantity: 10,
          evidenceDocumentId: accountEvidenceId,
          reason: 'Opening balance carried from the service record.',
        },
        'open-account-a',
      );
      expect(replayed.id).toBe(accountA.id);
      await expect(
        service.open(
          contextAgency,
          {
            employeeId: employee.id,
            leaveTypeId: vacation.id,
            effectiveDate: manilaDate(-5),
            openingQuantity: 9,
            evidenceDocumentId: accountEvidenceId,
          },
          'open-account-a',
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', statusCode: 409 });
      await expect(
        admin.auditEvent.count({
          where: {
            agencyId: agency.id,
            action: 'LEAVE_ACCOUNT_OPENED',
            entityId: accountA.id,
          },
        }),
      ).resolves.toBe(1);

      await expect(
        service.open(contextAgency, {
          employeeId: randomUUID(),
          leaveTypeId: vacation.id,
          effectiveDate: manilaDate(-5),
          openingQuantity: 1,
          evidenceDocumentId: accountEvidenceId,
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_EMPLOYEE_NOT_FOUND', statusCode: 404 });
      await expect(
        service.open(contextAgency, {
          employeeId: fourthEmployee.id,
          leaveTypeId: randomUUID(),
          effectiveDate: manilaDate(-5),
          openingQuantity: 1,
          evidenceDocumentId: accountEvidenceId,
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_LEAVE_TYPE_NOT_FOUND', statusCode: 404 });
      await expect(
        service.open(contextAgency, {
          employeeId: fourthEmployee.id,
          leaveTypeId: mandatory.id,
          effectiveDate: manilaDate(-5),
          openingQuantity: 1,
          evidenceDocumentId: accountEvidenceId,
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_LEAVE_TYPE_NOT_CREDIT_BEARING' });
      await expect(
        service.open(contextAgency, {
          employeeId: fourthEmployee.id,
          leaveTypeId: inactiveSick.id,
          effectiveDate: manilaDate(-5),
          openingQuantity: 1,
          evidenceDocumentId: accountEvidenceId,
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_LEAVE_TYPE_INACTIVE' });
      await expect(
        service.open(contextAgency, {
          employeeId: thirdEmployee.id,
          leaveTypeId: vacation.id,
          effectiveDate: manilaDate(-30),
          openingQuantity: 1,
          evidenceDocumentId: accountEvidenceId,
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_POLICY_VERSION_NOT_EFFECTIVE' });
      await expect(
        service.open(contextAgency, {
          employeeId: fourthEmployee.id,
          leaveTypeId: vacation.id,
          effectiveDate: manilaDate(-5),
          openingQuantity: 1,
          evidenceDocumentId: unfinalizedEvidenceId,
        }),
      ).rejects.toMatchObject({
        code: 'LEAVE_ACCOUNT_EVIDENCE_INELIGIBLE',
        reasons: ['STATUS_INELIGIBLE'],
      });
      await expect(
        service.open(contextAgency, {
          employeeId: fourthEmployee.id,
          leaveTypeId: vacation.id,
          effectiveDate: manilaDate(-5),
          openingQuantity: 1,
          evidenceDocumentId: foreignEvidenceId,
        }),
      ).rejects.toMatchObject({
        code: 'LEAVE_ACCOUNT_EVIDENCE_INELIGIBLE',
        reasons: ['DOCUMENT_NOT_FOUND'],
      });

      const accountB = await service.open(contextAgency, {
        employeeId: secondEmployee.id,
        leaveTypeId: vacation.id,
        effectiveDate: manilaDate(-5),
        openingQuantity: 5,
        evidenceDocumentId: accountEvidenceId,
      });

      const agencyList = await service.list(contextAgency, { asOf: manilaDate(0) });
      expect(agencyList.map((account) => account.id)).toEqual(
        expect.arrayContaining([accountA.id, accountB.id]),
      );
      const ownList = await service.list(contextOwn, { asOf: manilaDate(0) });
      expect(ownList.map((account) => account.id)).toEqual([accountA.id]);
      await expect(service.findById(contextOwn, accountB.id)).resolves.toBeNull();
      await expect(service.findById(contextOwn, accountA.id)).resolves.not.toBeNull();
      await expect(service.list(foreignContext)).resolves.toEqual([]);
      await expect(service.findById(foreignContext, accountB.id)).resolves.toBeNull();
      await expect(
        service.freeze(foreignContext, accountB.id, { reason: 'Cross-Agency attempt.' }),
      ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_NOT_FOUND', statusCode: 404 });

      const accrual = await service.recordAdjustment(contextAgency, accountA.id, {
        quantity: 4,
        effectiveDate: manilaDate(3),
        authorityDocumentId: authorityEvidenceId,
        evidenceDocumentId: accountEvidenceId,
        reason: 'Record the accrual for the next quarter.',
      });
      expect(accrual.balances.postedQuantity).toBe('14.0000');

      const asOfToday = await service.findById(contextAgency, accountA.id, {
        asOf: manilaDate(0),
      });
      expect(asOfToday?.account.balances.postedQuantity).toBe('10.0000');
      const asOfFuture = await service.findById(contextAgency, accountA.id, {
        asOf: manilaDate(4),
      });
      expect(asOfFuture?.account.balances.postedQuantity).toBe('14.0000');
      const recordedBefore = await service.findById(contextAgency, accountA.id, {
        asOf: manilaDate(4),
        recordedThrough: new Date(Date.now() - 86_400_000).toISOString(),
      });
      expect(recordedBefore?.account.balances.postedQuantity).toBe('0.0000');

      await expect(
        service.recordAdjustment(contextAgency, accountA.id, {
          quantity: -11,
          effectiveDate: manilaDate(0),
          authorityDocumentId: authorityEvidenceId,
          evidenceDocumentId: accountEvidenceId,
          reason: 'Deduct an amount larger than the posted balance.',
        }),
      ).rejects.toMatchObject({
        code: 'LEAVE_ACCOUNT_INSUFFICIENT_BALANCE',
        statusCode: 409,
        reasons: expect.arrayContaining(['POSTED:10.0000', 'REQUESTED:-11.0000']),
      });

      const accrualEntry = asOfFuture?.ledgerEntries.find((entry) => entry.quantity === '4.0000');
      if (!accrualEntry) throw new Error('The accrual entry was not posted.');
      const reversal = await service.reverseEntry(
        contextAgency,
        accountA.id,
        accrualEntry.id,
        {
          authorityDocumentId: authorityEvidenceId,
          evidenceDocumentId: accountEvidenceId,
          reason: 'The quarterly accrual was posted in error.',
        },
        'reverse-accrual',
      );
      expect(reversal.balances.postedQuantity).toBe('10.0000');
      const replayedReversal = await service.reverseEntry(
        contextAgency,
        accountA.id,
        accrualEntry.id,
        {
          authorityDocumentId: authorityEvidenceId,
          evidenceDocumentId: accountEvidenceId,
          reason: 'The quarterly accrual was posted in error.',
        },
        'reverse-accrual',
      );
      expect(replayedReversal.id).toBe(accountA.id);
      await expect(
        service.reverseEntry(contextAgency, accountA.id, accrualEntry.id, {
          authorityDocumentId: authorityEvidenceId,
          evidenceDocumentId: accountEvidenceId,
          reason: 'Reverse the accrual twice.',
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_LEDGER_ENTRY_REVERSAL_EXISTS', statusCode: 409 });

      const frozen = await service.freeze(contextAgency, accountA.id, {
        reason: 'The opening balance is under dispute.',
      });
      expect(frozen.status).toBe('FROZEN');
      await expect(
        service.recordAdjustment(contextAgency, accountA.id, {
          quantity: 1,
          effectiveDate: manilaDate(0),
          authorityDocumentId: authorityEvidenceId,
          evidenceDocumentId: accountEvidenceId,
          reason: 'Post while frozen.',
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_STATUS_INVALID', statusCode: 409 });
      await expect(
        service.freeze(contextAgency, accountA.id, { reason: 'Freeze twice.' }),
      ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_STATUS_INVALID' });
      const unfrozen = await service.unfreeze(contextAgency, accountA.id, {
        reason: 'The dispute is resolved.',
      });
      expect(unfrozen.status).toBe('ACTIVE');
      await expect(
        service.close(contextAgency, accountA.id, {
          closedAt: manilaDate(-30),
          reason: 'Close before the account opened.',
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_CLOSE_DATE_INVALID', statusCode: 400 });
      const closed = await service.close(contextAgency, accountA.id, {
        closedAt: manilaDate(0),
        reason: 'The Employee separated from service.',
      });
      expect(closed.status).toBe('CLOSED');
      await expect(
        service.unfreeze(contextAgency, accountA.id, { reason: 'Reopen a closed account.' }),
      ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_STATUS_INVALID' });
      await expect(
        service.recordAdjustment(contextAgency, accountA.id, {
          quantity: 1,
          effectiveDate: manilaDate(0),
          authorityDocumentId: authorityEvidenceId,
          evidenceDocumentId: accountEvidenceId,
          reason: 'Post to a closed account.',
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_ACCOUNT_STATUS_INVALID' });

      const detailA = await service.findById(contextAgency, accountA.id, { asOf: manilaDate(4) });
      expect(detailA?.opening?.quantity).toBe('10.0000');
      expect(detailA?.opening?.evidenceDocumentId).toBe(accountEvidenceId);
      expect(detailA?.ledgerEntries.map((entry) => entry.sourcePostingKey)).toEqual(
        expect.arrayContaining(['OPENING', 'ADJUSTMENT', 'REVERSAL']),
      );
      const reversalEntry = detailA?.ledgerEntries.find(
        (entry) => entry.sourcePostingKey === 'REVERSAL',
      );
      expect(reversalEntry?.quantity).toBe('-4.0000');
      expect(reversalEntry?.reversesEntryId).toBe(accrualEntry.id);
      expect(reversalEntry?.effectiveDate).toBe(manilaDate(3));
      expect(detailA?.history.map((entry) => entry.action)).toEqual(
        expect.arrayContaining([
          'LEAVE_ACCOUNT_OPENED',
          'LEAVE_LEDGER_ADJUSTMENT_RECORDED',
          'LEAVE_LEDGER_ENTRY_REVERSED',
          'LEAVE_ACCOUNT_FROZEN',
          'LEAVE_ACCOUNT_UNFROZEN',
          'LEAVE_ACCOUNT_CLOSED',
        ]),
      );

      const commitment = await admin.leaveCreditCommitment.create({
        data: {
          agencyId: agency.id,
          leaveAccountId: accountB.id,
          quantity: 1,
          sourceType: 'LeaveApplicationVersion',
          sourceId: randomUUID(),
          sourceCommitmentKey: 'CERTIFIED',
          status: 'ACTIVE',
          effectiveFrom: new Date(),
        },
      });
      const withCommitment = await service.findById(contextAgency, accountB.id, {
        asOf: manilaDate(0),
      });
      expect(withCommitment?.account.balances.postedQuantity).toBe('5.0000');
      expect(withCommitment?.account.balances.committedQuantity).toBe('1.0000');
      expect(withCommitment?.account.balances.availableQuantity).toBe('4.0000');

      const deduction = await service.recordAdjustment(contextAgency, accountB.id, {
        quantity: -5,
        effectiveDate: manilaDate(0),
        authorityDocumentId: authorityEvidenceId,
        evidenceDocumentId: accountEvidenceId,
        reason: 'The opening balance was overstated.',
      });
      expect(deduction.balances.postedQuantity).toBe('0.0000');

      const openingEntry = await admin.leaveLedgerEntry.findFirst({
        where: { agencyId: agency.id, leaveAccountId: accountB.id, sourcePostingKey: 'OPENING' },
        select: { id: true, quantity: true },
      });
      if (!openingEntry) throw new Error('The opening entry was not posted.');
      const exemptReversal = await service.reverseEntry(
        contextAgency,
        accountB.id,
        openingEntry.id,
        {
          authorityDocumentId: authorityEvidenceId,
          evidenceDocumentId: accountEvidenceId,
          reason: 'Reversing the overstated opening must always be possible.',
        },
      );
      expect(exemptReversal.balances.postedQuantity).toBe('0.0000');
      const afterExemptReversal = await service.findById(contextAgency, accountB.id, {
        asOf: manilaDate(0),
      });
      expect(afterExemptReversal?.account.balances.postedQuantity).toBe('-5.0000');

      const accountC = await service.open(contextAgency, {
        employeeId: thirdEmployee.id,
        leaveTypeId: vacation.id,
        effectiveDate: manilaDate(-5),
        openingQuantity: 10,
        evidenceDocumentId: accountEvidenceId,
      });
      const concurrent = await Promise.allSettled([
        service.recordAdjustment(
          contextAgency,
          accountC.id,
          {
            quantity: -7,
            effectiveDate: manilaDate(0),
            authorityDocumentId: authorityEvidenceId,
            evidenceDocumentId: accountEvidenceId,
            reason: 'Deduct the first carried balance.',
          },
          'concurrent-deduction-1',
        ),
        service.recordAdjustment(
          contextAgency,
          accountC.id,
          {
            quantity: -7,
            effectiveDate: manilaDate(0),
            authorityDocumentId: authorityEvidenceId,
            evidenceDocumentId: accountEvidenceId,
            reason: 'Deduct the second carried balance.',
          },
          'concurrent-deduction-2',
        ),
      ]);
      const fulfilled = concurrent.filter((result) => result.status === 'fulfilled');
      const rejected = concurrent.filter((result) => result.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        reason: expect.objectContaining({ code: 'LEAVE_ACCOUNT_INSUFFICIENT_BALANCE' }),
      });
      const detailC = await service.findById(contextAgency, accountC.id, { asOf: manilaDate(0) });
      expect(detailC?.account.balances.postedQuantity).toBe('3.0000');

      await expect(
        admin.leaveLedgerEntry.update({
          where: { id: accrualEntry.id },
          data: { quantity: 9 },
        }),
      ).rejects.toThrow(/immutable/);
      await expect(
        admin.leaveLedgerEntry.delete({ where: { id: accrualEntry.id } }),
      ).rejects.toThrow(/cannot be deleted/);
      await expect(
        admin.leaveAccount.update({
          where: { id: accountB.id },
          data: { employeeId: fourthEmployee.id },
        }),
      ).rejects.toThrow(/identity is immutable/);
      await expect(admin.leaveAccount.delete({ where: { id: accountB.id } })).rejects.toThrow(
        /cannot be deleted/,
      );
      await expect(
        admin.leaveLedgerEntry.create({
          data: {
            agencyId: agency.id,
            leaveAccountId: accountB.id,
            quantity: -1,
            effectiveDate: new Date(`${manilaDate(-5)}T00:00:00.000Z`),
            sourceType: 'LeaveLedgerAdjustment',
            sourceId: randomUUID(),
            sourcePostingKey: 'BAD-REVERSAL',
            policyVersionId: version.id,
            reversesEntryId: openingEntry.id,
            postedByMembershipId: membership.id,
          },
        }),
      ).rejects.toThrow(/exactly negate/);
      await admin.leaveCreditCommitment.update({
        where: { id: commitment.id },
        data: { status: 'CONSUMED', endedAt: new Date() },
      });
      await expect(
        admin.leaveCreditCommitment.update({
          where: { id: commitment.id },
          data: { quantity: 9 },
        }),
      ).rejects.toThrow(/immutable/);
      await expect(
        admin.leaveCreditCommitment.delete({ where: { id: commitment.id } }),
      ).rejects.toThrow(/cannot be deleted/);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.auditEvent.deleteMany({ where: { agencyId: { in: agencyIds } } });
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
