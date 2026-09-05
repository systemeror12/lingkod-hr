import type {
  PayrollBankAccountHistory,
  PayrollBankAccountHistoryEntry,
  PayrollBankAccountReveal,
  PayrollBankAccountSummary,
} from './payroll-bank-accounts.service';

export class PayrollBankAccountDto {
  declare readonly id: string;
  declare readonly employeeId: string;
  declare readonly bankCode: string;
  declare readonly accountName: string;
  declare readonly maskedAccountNumber: string;
  declare readonly verificationState: string;
  declare readonly verifiedAt: string | null;
  declare readonly status: PayrollBankAccountSummary['status'];
  declare readonly effectiveFrom: string;
  declare readonly effectiveTo: string | null;
  declare readonly reason: string | null;
  declare readonly evidenceDocumentId: string | null;
  declare readonly evidenceDocumentVersionId: string | null;
  declare readonly predecessorAccountId: string | null;
  declare readonly transitionKind: string | null;
  declare readonly createdAt: string;
  declare readonly updatedAt: string;

  constructor(account: PayrollBankAccountSummary) {
    Object.assign(this, account);
  }
}

export class PayrollBankAccountListDto {
  readonly accounts: PayrollBankAccountDto[];

  constructor(accounts: PayrollBankAccountSummary[]) {
    this.accounts = accounts.map((account) => new PayrollBankAccountDto(account));
  }
}

export class PayrollBankAccountRevealDto extends PayrollBankAccountDto {
  readonly accountNumber: string;

  constructor(account: PayrollBankAccountReveal) {
    super(account);
    this.accountNumber = account.accountNumber;
  }
}

export class PayrollBankAccountHistoryEntryDto {
  declare readonly id: string;
  declare readonly accountId: string;
  declare readonly action: string;
  declare readonly previousStatus: string | null;
  declare readonly newStatus: string | null;
  declare readonly bankCode: string | null;
  declare readonly accountName: string | null;
  declare readonly maskedAccountNumber: string | null;
  declare readonly reason: string | null;
  declare readonly actorDisplayName: string | null;
  declare readonly effectiveFrom: string | null;
  declare readonly effectiveTo: string | null;
  declare readonly evidenceDocumentId: string | null;
  declare readonly evidenceDocumentVersionId: string | null;
  declare readonly predecessorAccountId: string | null;
  declare readonly transitionKind: string | null;
  declare readonly actedAt: string;

  constructor(entry: PayrollBankAccountHistoryEntry) {
    Object.assign(this, entry);
  }
}

export class PayrollBankAccountHistoryDto {
  readonly entries: PayrollBankAccountHistoryEntryDto[];

  constructor(history: PayrollBankAccountHistory) {
    this.entries = history.entries.map((entry) => new PayrollBankAccountHistoryEntryDto(entry));
  }
}
