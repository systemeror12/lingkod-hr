import type {
  LeaveAccountBalances,
  LeaveAccountDetail,
  LeaveAccountHistoryEntry,
  LeaveAccountOpeningSummary,
  LeaveAccountSummary,
  LeaveCreditCommitmentSummary,
  LeaveLedgerEntrySummary,
} from './leave-accounts.service';

export class LeaveAccountBalancesDto {
  readonly asOf: string;
  readonly recordedThrough: string;
  readonly postedQuantity: string;
  readonly committedQuantity: string;
  readonly availableQuantity: string;

  constructor(balances: LeaveAccountBalances) {
    this.asOf = balances.asOf;
    this.recordedThrough = balances.recordedThrough;
    this.postedQuantity = balances.postedQuantity;
    this.committedQuantity = balances.committedQuantity;
    this.availableQuantity = balances.availableQuantity;
  }
}

export class LeaveAccountDto {
  readonly id: string;
  readonly agencyId: string;
  readonly employeeId: string;
  readonly employeeNumber: string;
  readonly employeeName: string;
  readonly leaveTypeId: string;
  readonly leaveTypeCode: string;
  readonly leaveTypeName: string;
  readonly unitCode: string;
  readonly status: LeaveAccountSummary['status'];
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly balances: LeaveAccountBalancesDto;

  constructor(account: LeaveAccountSummary) {
    this.id = account.id;
    this.agencyId = account.agencyId;
    this.employeeId = account.employeeId;
    this.employeeNumber = account.employeeNumber;
    this.employeeName = account.employeeName;
    this.leaveTypeId = account.leaveTypeId;
    this.leaveTypeCode = account.leaveTypeCode;
    this.leaveTypeName = account.leaveTypeName;
    this.unitCode = account.unitCode;
    this.status = account.status;
    this.openedAt = account.openedAt;
    this.closedAt = account.closedAt;
    this.balances = new LeaveAccountBalancesDto(account.balances);
  }
}

export class LeaveAccountListResponseDto {
  readonly accounts: LeaveAccountDto[];

  constructor(accounts: LeaveAccountSummary[]) {
    this.accounts = accounts.map((account) => new LeaveAccountDto(account));
  }
}

export class LeaveLedgerEntryDto {
  readonly id: string;
  readonly quantity: string;
  readonly effectiveDate: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourcePostingKey: string;
  readonly policyVersionId: string;
  readonly policyVersionNo: number;
  readonly reversesEntryId: string | null;
  readonly postedAt: string;
  readonly postedByMembershipId: string | null;
  readonly postedByName: string | null;

  constructor(entry: LeaveLedgerEntrySummary) {
    this.id = entry.id;
    this.quantity = entry.quantity;
    this.effectiveDate = entry.effectiveDate;
    this.sourceType = entry.sourceType;
    this.sourceId = entry.sourceId;
    this.sourcePostingKey = entry.sourcePostingKey;
    this.policyVersionId = entry.policyVersionId;
    this.policyVersionNo = entry.policyVersionNo;
    this.reversesEntryId = entry.reversesEntryId;
    this.postedAt = entry.postedAt;
    this.postedByMembershipId = entry.postedByMembershipId;
    this.postedByName = entry.postedByName;
  }
}

export class LeaveCreditCommitmentDto {
  readonly id: string;
  readonly quantity: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceCommitmentKey: string;
  readonly succeedsCommitmentId: string | null;
  readonly status: string;
  readonly effectiveFrom: string;
  readonly endedAt: string | null;

  constructor(commitment: LeaveCreditCommitmentSummary) {
    this.id = commitment.id;
    this.quantity = commitment.quantity;
    this.sourceType = commitment.sourceType;
    this.sourceId = commitment.sourceId;
    this.sourceCommitmentKey = commitment.sourceCommitmentKey;
    this.succeedsCommitmentId = commitment.succeedsCommitmentId;
    this.status = commitment.status;
    this.effectiveFrom = commitment.effectiveFrom;
    this.endedAt = commitment.endedAt;
  }
}

export class LeaveAccountOpeningDto {
  readonly id: string;
  readonly quantity: string;
  readonly effectiveDate: string;
  readonly policyVersionId: string;
  readonly policyVersionNo: number;
  readonly evidenceDocumentId: string;
  readonly evidenceDocumentVersionId: string;
  readonly evidenceDocumentNo: string | null;
  readonly evidenceDocumentType: string;
  readonly evidenceDocumentVersionNo: number;
  readonly reason: string | null;
  readonly openedByMembershipId: string;
  readonly openedByName: string | null;
  readonly openedAt: string;

  constructor(opening: LeaveAccountOpeningSummary) {
    this.id = opening.id;
    this.quantity = opening.quantity;
    this.effectiveDate = opening.effectiveDate;
    this.policyVersionId = opening.policyVersionId;
    this.policyVersionNo = opening.policyVersionNo;
    this.evidenceDocumentId = opening.evidenceDocumentId;
    this.evidenceDocumentVersionId = opening.evidenceDocumentVersionId;
    this.evidenceDocumentNo = opening.evidenceDocumentNo;
    this.evidenceDocumentType = opening.evidenceDocumentType;
    this.evidenceDocumentVersionNo = opening.evidenceDocumentVersionNo;
    this.reason = opening.reason;
    this.openedByMembershipId = opening.openedByMembershipId;
    this.openedByName = opening.openedByName;
    this.openedAt = opening.openedAt;
  }
}

export class LeaveAccountHistoryDto {
  readonly id: string;
  readonly action: string;
  readonly previousStatus: string | null;
  readonly newStatus: string | null;
  readonly reason: string | null;
  readonly effectiveDate: string | null;
  readonly occurredAt: string;

  constructor(entry: LeaveAccountHistoryEntry) {
    this.id = entry.id;
    this.action = entry.action;
    this.previousStatus = entry.previousStatus;
    this.newStatus = entry.newStatus;
    this.reason = entry.reason;
    this.effectiveDate = entry.effectiveDate;
    this.occurredAt = entry.occurredAt;
  }
}

export class LeaveAccountDetailDto {
  readonly account: LeaveAccountDto;
  readonly opening: LeaveAccountOpeningDto | null;
  readonly ledgerEntries: LeaveLedgerEntryDto[];
  readonly commitments: LeaveCreditCommitmentDto[];
  readonly history: LeaveAccountHistoryDto[];

  constructor(detail: LeaveAccountDetail) {
    this.account = new LeaveAccountDto(detail.account);
    this.opening = detail.opening ? new LeaveAccountOpeningDto(detail.opening) : null;
    this.ledgerEntries = detail.ledgerEntries.map((entry) => new LeaveLedgerEntryDto(entry));
    this.commitments = detail.commitments.map(
      (commitment) => new LeaveCreditCommitmentDto(commitment),
    );
    this.history = detail.history.map((entry) => new LeaveAccountHistoryDto(entry));
  }
}
