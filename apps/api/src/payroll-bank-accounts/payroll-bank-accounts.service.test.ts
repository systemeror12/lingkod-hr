import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import {
  payrollBankAccountAuditWriter,
  PayrollBankAccountsService,
  PayrollBankAccountsServiceError,
} from './payroll-bank-accounts.service';

vi.mock('@lingkod-hr/config', async (importOriginal) => {
  const original = await importOriginal<typeof import('@lingkod-hr/config')>();
  return {
    ...original,
    getConfig: () => ({ ...original.getConfig(), DATA_ENCRYPTION_KEY: undefined }),
  };
});

const context: RequestContext = {
  requestId: 'payroll-bank-account-service-test',
  userId: '00000000-0000-4000-8000-000000000001',
  agencyId: '00000000-0000-4000-8000-000000000002',
  membershipId: '00000000-0000-4000-8000-000000000003',
  primaryOrganizationUnitId: null,
  permissions: [],
};

it('keeps payroll bank account permissions separate from general Personnel permissions', async () => {
  const service = new PayrollBankAccountsService(payrollBankAccountAuditWriter, {} as never);
  const employeeId = '00000000-0000-4000-8000-000000000004';
  const personnelContext = {
    ...context,
    permissions: [{ code: 'personnel.employees.read', scopePolicy: 'AGENCY' as const }],
  };

  await expect(service.list(personnelContext, employeeId)).rejects.toMatchObject({
    code: 'PAYROLL_BANK_ACCOUNT_READ_FORBIDDEN',
    statusCode: 403,
  });
  await expect(
    service.create(personnelContext, employeeId, {
      bankCode: 'LBP',
      accountName: 'Juan Dela Cruz',
      accountNumber: '0123456789',
      effectiveFrom: '2026-09-15',
    }),
  ).rejects.toMatchObject({
    code: 'PAYROLL_BANK_ACCOUNT_MANAGE_FORBIDDEN',
    statusCode: 403,
  });
});

it('fails safely when protected-value encryption is unavailable', async () => {
  const service = new PayrollBankAccountsService(payrollBankAccountAuditWriter, {} as never);
  const manageContext = {
    ...context,
    permissions: [{ code: 'payroll.bank_accounts.manage', scopePolicy: 'AGENCY' as const }],
  };

  await expect(
    service.create(manageContext, '00000000-0000-4000-8000-000000000004', {
      bankCode: 'LBP',
      accountName: 'Juan Dela Cruz',
      accountNumber: '0123456789',
      effectiveFrom: '2026-09-15',
    }),
  ).rejects.toMatchObject({
    code: 'PAYROLL_BANK_ACCOUNT_ENCRYPTION_UNAVAILABLE',
    statusCode: 503,
  });
});

it('uses a typed error for payroll bank account workflow failures', () => {
  expect(new PayrollBankAccountsServiceError('message', 409, 'CODE')).toBeInstanceOf(Error);
});
