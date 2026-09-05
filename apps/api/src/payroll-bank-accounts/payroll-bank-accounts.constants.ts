export const PAYROLL_BANK_ACCOUNT_STATUSES = [
  'PENDING_VERIFICATION',
  'ACTIVE',
  'INACTIVE',
  'REPLACED',
  'CORRECTED',
] as const;

export type PayrollBankAccountStatus = (typeof PAYROLL_BANK_ACCOUNT_STATUSES)[number];
