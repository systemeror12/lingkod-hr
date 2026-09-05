import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { encryptProtectedValue } from '@lingkod-hr/config';
import {
  payrollBankAccountAuditWriter,
  PayrollBankAccountsService,
} from './payroll-bank-accounts.service';

const databaseMock = vi.hoisted(() => ({ withDatabaseContext: vi.fn() }));
vi.mock('@lingkod-hr/database', () => databaseMock);

const agencyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const membershipId = '00000000-0000-4000-8000-000000000003';
const employeeId = '00000000-0000-4000-8000-000000000004';
const accountId = '00000000-0000-4000-8000-000000000005';
const key = Buffer.alloc(32, 8);
const plaintext = '012345678901';

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'payroll-bank-account-reveal-test',
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions,
  };
}

function setup() {
  const sealed = encryptProtectedValue(plaintext, key, {
    metadata: JSON.stringify({ purpose: 'PAYROLL_BANK_ACCOUNT', employeeId, bankCode: 'LBP' }),
  });
  const account = {
    id: accountId,
    agencyId,
    employeeId,
    bankCode: 'LBP',
    accountName: 'Juan Dela Cruz',
    encryptedAccountNumber: new Uint8Array(sealed.envelope),
    encryptionVersion: 1,
    maskedAccountNumber: '********8901',
    verificationState: 'VERIFIED',
    verifiedAt: new Date('2026-09-05T00:00:00.000Z'),
    status: 'ACTIVE',
    effectiveFrom: new Date('2026-09-15T00:00:00.000Z'),
    effectiveTo: null,
    reason: 'Verified account.',
    evidenceDocumentId: null,
    evidenceDocumentVersionId: null,
    predecessorAccountId: null,
    transitionKind: null,
    createdByMembershipId: membershipId,
    createdAt: new Date('2026-09-05T00:00:00.000Z'),
    updatedByMembershipId: membershipId,
    updatedAt: new Date('2026-09-05T00:00:00.000Z'),
  };
  const auditEvents: Array<Record<string, unknown>> = [];
  const transaction = {
    payrollBankAccount: { findFirst: vi.fn().mockResolvedValue(account) },
    employee: {
      findUnique: vi.fn().mockResolvedValue({
        id: employeeId,
        memberships: [{ userId }],
        currentServiceSegment: null,
      }),
    },
    auditEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditEvents.push(data);
        return data;
      }),
    },
  };
  databaseMock.withDatabaseContext.mockImplementationOnce(
    async (_context: unknown, work: (value: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  );
  process.env.DATA_ENCRYPTION_KEY = key.toString('hex');
  return { auditEvents };
}

it('audits a bank-account reveal denied to a general Personnel caller', async () => {
  const { auditEvents } = setup();
  const service = new PayrollBankAccountsService(payrollBankAccountAuditWriter, {} as never);

  await expect(
    service.reveal(
      context([{ code: 'personnel.identifiers.reveal', scopePolicy: 'AGENCY' }]),
      employeeId,
      accountId,
      { reason: 'Confirm payroll destination.' },
    ),
  ).rejects.toMatchObject({ code: 'PAYROLL_BANK_ACCOUNT_NOT_FOUND', statusCode: 404 });

  expect(auditEvents).toHaveLength(1);
  expect(auditEvents[0]).toMatchObject({
    action: 'PAYROLL_BANK_ACCOUNT_REVEAL_ATTEMPTED',
    newStatus: 'DENIED',
  });
  expect(JSON.stringify(auditEvents[0])).not.toContain(plaintext);
});

it('returns the full number only to the exact permission and never writes it to Audit', async () => {
  const { auditEvents } = setup();
  const service = new PayrollBankAccountsService(payrollBankAccountAuditWriter, {} as never);

  await expect(
    service.reveal(
      context([{ code: 'payroll.bank_accounts.reveal', scopePolicy: 'AGENCY' }]),
      employeeId,
      accountId,
      { reason: plaintext },
    ),
  ).resolves.toMatchObject({ accountNumber: plaintext, maskedAccountNumber: '********8901' });

  expect(auditEvents[0]).toMatchObject({
    action: 'PAYROLL_BANK_ACCOUNT_REVEAL_ATTEMPTED',
    newStatus: 'REVEALED',
    reason: null,
  });
  expect(JSON.stringify(auditEvents[0])).not.toContain(plaintext);
});
