import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { PayrollBankAccountsController } from './payroll-bank-accounts.controller';

const agencyId = '00000000-0000-4000-8000-000000000001';
const employeeId = '00000000-0000-4000-8000-000000000002';
const accountId = '00000000-0000-4000-8000-000000000003';
const context: RequestContext = {
  requestId: 'payroll-bank-account-api-test',
  userId: '00000000-0000-4000-8000-000000000004',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000005',
  primaryOrganizationUnitId: null,
  permissions: [],
};
const account = {
  id: accountId,
  employeeId,
  bankCode: 'LBP',
  accountName: 'Juan Dela Cruz',
  maskedAccountNumber: '******6789',
  verificationState: 'PENDING',
  verifiedAt: null,
  status: 'PENDING_VERIFICATION' as const,
  effectiveFrom: '2026-09-15',
  effectiveTo: null,
  reason: null,
  evidenceDocumentId: null,
  evidenceDocumentVersionId: null,
  predecessorAccountId: null,
  transitionKind: null,
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
};

function serviceMock() {
  return {
    list: vi.fn().mockResolvedValue([account]),
    create: vi.fn().mockResolvedValue(account),
    replace: vi.fn(),
    activate: vi.fn(),
    inactivate: vi.fn(),
    correct: vi.fn(),
    reveal: vi.fn().mockResolvedValue({ ...account, accountNumber: '0123456789' }),
    history: vi.fn().mockResolvedValue({ entries: [] }),
  };
}

it('keeps ordinary API responses masked and reveal separate', async () => {
  const service = serviceMock();
  const controller = new PayrollBankAccountsController(service as never);

  await expect(controller.list(agencyId, employeeId, context)).resolves.toEqual({
    accounts: [expect.objectContaining({ maskedAccountNumber: '******6789' })],
  });
  expect(JSON.stringify(await controller.list(agencyId, employeeId, context))).not.toContain(
    '0123456789',
  );
  await expect(
    controller.reveal(
      agencyId,
      employeeId,
      accountId,
      { reason: 'Confirm payroll destination.' },
      context,
    ),
  ).resolves.toMatchObject({ accountNumber: '0123456789' });
});

it('rejects foreign Agency routes and unsupported activation states before the service', async () => {
  const service = serviceMock();
  const controller = new PayrollBankAccountsController(service as never);

  await expect(
    controller.list('00000000-0000-4000-8000-000000000099', employeeId, context),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    controller.activate(
      agencyId,
      employeeId,
      accountId,
      {
        verificationState: 'BANK_ACCEPTED',
        verifiedAt: '2026-09-05T08:00:00.000+08:00',
        reason: 'Provider response.',
      },
      context,
    ),
  ).rejects.toMatchObject({ status: 400 });
  expect(service.activate).not.toHaveBeenCalled();
});
