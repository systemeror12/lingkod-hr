import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import {
  payrollBankAccountAuditWriter,
  PayrollBankAccountsService,
} from './payroll-bank-accounts.service';

const enabled = process.env.DATABASE_E2E === 'true';
process.env.DATA_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('hex');

function adminUrl(): string {
  const value = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!value) throw new Error('An administrative database URL is required.');
  return value;
}

it.skipIf(!enabled)(
  'preserves the protected effective-dated payroll bank account journey',
  async () => {
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl() } } });
    const suffix = String(Date.now());
    const agency = await admin.agency.create({
      data: {
        code: `BANK-SERVICE-${suffix}`,
        name: 'Bank Service Test',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        emailNormalized: `bank-service-${suffix}@example.test`,
        displayName: 'Bank Service User',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const employee = await admin.employee.create({
      data: {
        agencyId: agency.id,
        employeeNumber: `BANK-${suffix}`,
        legalName: 'Bank Service Employee',
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `bank-service-employee-${suffix}@example.test`,
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const evidenceDocument = await admin.document.create({
      data: {
        agencyId: agency.id,
        documentNo: `BANK-EVIDENCE-${suffix}`,
        documentType: 'BANK_CERTIFICATION',
        classification: 'CONFIDENTIAL',
        status: 'DRAFT',
        createdByMembershipId: membership.id,
      },
    });
    const evidenceVersion = await admin.documentVersion.create({
      data: {
        agencyId: agency.id,
        documentId: evidenceDocument.id,
        versionNo: 1,
        storageKey: `bank-account/${suffix}`,
        contentHash: 'a'.repeat(64),
        mimeType: 'application/pdf',
        sizeBytes: 1,
        createdByMembershipId: membership.id,
      },
    });
    await admin.document.update({
      where: { id: evidenceDocument.id },
      data: { currentVersionId: evidenceVersion.id, status: 'APPROVED' },
    });
    const context: RequestContext = {
      requestId: `bank-service-${suffix}`,
      userId: user.id,
      agencyId: agency.id,
      membershipId: membership.id,
      primaryOrganizationUnitId: null,
      permissions: [
        { code: 'payroll.bank_accounts.read', scopePolicy: 'AGENCY' },
        { code: 'payroll.bank_accounts.manage', scopePolicy: 'AGENCY' },
        { code: 'payroll.bank_accounts.reveal', scopePolicy: 'AGENCY' },
        { code: 'payroll.bank_accounts.history.read', scopePolicy: 'AGENCY' },
      ],
    };
    const firstNumber = `00112233${suffix.slice(-4)}`;
    const replacementNumber = `99887766${suffix.slice(-4)}`;
    const correctedNumber = `77889900${suffix.slice(-4)}`;
    const service = new PayrollBankAccountsService(
      payrollBankAccountAuditWriter,
      new DocumentsService({} as never, documentAuditWriter),
    );

    try {
      const pending = await service.create(context, employee.id, {
        bankCode: 'LBP',
        accountName: employee.legalName,
        accountNumber: firstNumber,
        effectiveFrom: '2026-01-01',
        evidenceDocumentId: evidenceDocument.id,
        evidenceDocumentVersionId: evidenceVersion.id,
      });
      expect(pending).toMatchObject({
        status: 'PENDING_VERIFICATION',
        maskedAccountNumber: expect.not.stringContaining(firstNumber),
      });
      expect(JSON.stringify(await service.list(context, employee.id))).not.toContain(firstNumber);

      await service.activate(context, employee.id, pending.id, {
        verificationState: 'VERIFIED',
        verifiedAt: '2025-12-15T08:00:00.000+08:00',
        reason: 'Matched retained bank evidence.',
      });
      const replacement = await service.replace(context, employee.id, pending.id, {
        bankCode: 'DBP',
        accountName: employee.legalName,
        accountNumber: replacementNumber,
        effectiveFrom: '2026-07-01',
        reason: 'Employee submitted a new payroll destination.',
      });
      const correctedReplacement = await service.correct(context, employee.id, replacement.id, {
        bankCode: 'DBP',
        accountName: employee.legalName,
        accountNumber: correctedNumber,
        reason: 'Correct a transcription error before activation.',
      });
      const activeReplacement = await service.activate(
        context,
        employee.id,
        correctedReplacement.id,
        {
          verificationState: 'VERIFIED',
          verifiedAt: '2026-06-15T08:00:00.000+08:00',
          reason: 'Matched retained bank evidence.',
        },
      );
      expect(activeReplacement.status).toBe('ACTIVE');
      await expect(
        service.reveal(context, employee.id, activeReplacement.id, {
          reason: 'Confirm payroll destination.',
        }),
      ).resolves.toMatchObject({ accountNumber: correctedNumber });

      const corrected = await service.correct(context, employee.id, activeReplacement.id, {
        bankCode: 'DBP',
        accountName: employee.legalName,
        accountNumber: replacementNumber,
        reason: 'Correct a transcription error.',
      });
      expect(corrected).toMatchObject({
        status: 'ACTIVE',
        effectiveFrom: '2026-07-01',
        transitionKind: 'CORRECTION',
      });
      const inactive = await service.inactivate(context, employee.id, corrected.id, {
        effectiveTo: '2026-12-31',
        reason: 'Employee closed the payroll account.',
      });
      expect(inactive).toMatchObject({ status: 'INACTIVE', effectiveTo: '2026-12-31' });

      const records = await admin.payrollBankAccount.findMany({
        where: { agencyId: agency.id },
        orderBy: { effectiveFrom: 'asc' },
      });
      expect(records.map(({ status }) => status)).toEqual([
        'REPLACED',
        'CORRECTED',
        'CORRECTED',
        'INACTIVE',
      ]);
      const events = await admin.auditEvent.findMany({
        where: { agencyId: agency.id, entityType: 'PayrollBankAccount' },
      });
      expect(events.map(({ action }) => action)).toEqual(
        expect.arrayContaining([
          'PAYROLL_BANK_ACCOUNT_CREATED',
          'PAYROLL_BANK_ACCOUNT_ACTIVATED',
          'PAYROLL_BANK_ACCOUNT_REPLACEMENT_PREPARED',
          'PAYROLL_BANK_ACCOUNT_CORRECTED',
          'PAYROLL_BANK_ACCOUNT_INACTIVATED',
          'PAYROLL_BANK_ACCOUNT_REVEAL_ATTEMPTED',
        ]),
      );
      const auditJson = JSON.stringify(events);
      expect(auditJson).not.toContain(firstNumber);
      expect(auditJson).not.toContain(replacementNumber);
      expect(auditJson).not.toContain(correctedNumber);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.auditEvent.deleteMany({ where: { agencyId: agency.id } });
        await transaction.payrollBankAccount.deleteMany({ where: { agencyId: agency.id } });
        await transaction.documentVersion.deleteMany({ where: { agencyId: agency.id } });
        await transaction.document.deleteMany({ where: { agencyId: agency.id } });
        await transaction.employee.deleteMany({ where: { agencyId: agency.id } });
        await transaction.agencyMembership.deleteMany({ where: { agencyId: agency.id } });
        await transaction.agency.delete({ where: { id: agency.id } });
        await transaction.user.delete({ where: { id: user.id } });
      });
      await admin.$disconnect();
    }
  },
);
