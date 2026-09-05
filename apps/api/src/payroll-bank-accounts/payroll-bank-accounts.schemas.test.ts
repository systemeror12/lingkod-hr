import { expect, it } from 'vitest';
import {
  payrollBankAccountActivateSchema,
  payrollBankAccountCorrectSchema,
  payrollBankAccountCreateSchema,
  payrollBankAccountInactivateSchema,
  payrollBankAccountReplaceSchema,
  payrollBankAccountRevealSchema,
} from './payroll-bank-accounts.schemas';

const account = {
  bankCode: 'LBP',
  accountName: 'Juan Dela Cruz',
  accountNumber: '0123456789',
  effectiveFrom: '2026-09-15',
};

it('accepts a pending payroll bank account with an optional exact evidence version', () => {
  expect(
    payrollBankAccountCreateSchema.parse({
      ...account,
      evidenceDocumentId: '00000000-0000-4000-8000-000000000001',
      evidenceDocumentVersionId: '00000000-0000-4000-8000-000000000002',
    }),
  ).toEqual({
    ...account,
    evidenceDocumentId: '00000000-0000-4000-8000-000000000001',
    evidenceDocumentVersionId: '00000000-0000-4000-8000-000000000002',
  });

  expect(payrollBankAccountCreateSchema.safeParse({ ...account, status: 'ACTIVE' }).success).toBe(
    false,
  );
  expect(
    payrollBankAccountCreateSchema.safeParse({
      ...account,
      evidenceDocumentId: '00000000-0000-4000-8000-000000000001',
    }).success,
  ).toBe(false);
});

it('accepts only the supported verified activation state', () => {
  expect(
    payrollBankAccountActivateSchema.safeParse({
      verificationState: 'VERIFIED',
      verifiedAt: '2026-09-05T08:00:00.000+08:00',
      reason: 'Matched the submitted bank certification.',
    }).success,
  ).toBe(true);
  expect(
    payrollBankAccountActivateSchema.safeParse({
      verificationState: 'BANK_ACCEPTED',
      verifiedAt: '2026-09-05T08:00:00.000+08:00',
      reason: 'Provider accepted it.',
    }).success,
  ).toBe(false);
});

it('requires a reason for replacement, inactivation, correction, and reveal', () => {
  const correctedAccount = {
    bankCode: account.bankCode,
    accountName: account.accountName,
    accountNumber: account.accountNumber,
  };
  expect(
    payrollBankAccountReplaceSchema.safeParse({ ...account, reason: 'New payroll destination.' })
      .success,
  ).toBe(true);
  expect(
    payrollBankAccountCorrectSchema.safeParse({
      ...correctedAccount,
      reason: 'Correct transcription.',
    }).success,
  ).toBe(true);
  expect(
    payrollBankAccountInactivateSchema.safeParse({
      effectiveTo: '2026-09-30',
      reason: 'Employee closed the account.',
    }).success,
  ).toBe(true);
  expect(
    payrollBankAccountRevealSchema.safeParse({ reason: 'Confirm payroll destination.' }).success,
  ).toBe(true);

  for (const schema of [
    payrollBankAccountReplaceSchema,
    payrollBankAccountCorrectSchema,
    payrollBankAccountInactivateSchema,
    payrollBankAccountRevealSchema,
  ]) {
    expect(schema.safeParse({ ...account, reason: '' }).success).toBe(false);
  }
});

it('rejects unsafe or unsupported protected account input', () => {
  expect(
    payrollBankAccountCreateSchema.safeParse({ ...account, accountNumber: '0123\u0000' }).success,
  ).toBe(false);
  expect(
    payrollBankAccountCreateSchema.safeParse({ ...account, bankCode: 'not a bank code' }).success,
  ).toBe(false);
  expect(payrollBankAccountCreateSchema.safeParse({ ...account, accountName: ' ' }).success).toBe(
    false,
  );
});
