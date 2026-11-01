import type { CocDayClassification, CocEarningRefusalCode } from './coc-earning-rule';

/** The ledger source of a certificate entry; its posting key is the certificate line. */
export const COC_CERTIFICATE_SOURCE_TYPE = 'COC_EARNED_CERTIFICATE';

/**
 * The ledger source of an expiry entry; its source is the account. The first
 * expiry's posting key is the Valid Until, and each later one appends its ordinal.
 */
export const COC_EXPIRY_SOURCE_TYPE = 'COC_EXPIRY';

/** The national rule an expiry entry applies: JC 2-A, s. 2005 item 2.0. */
export const COC_EXPIRY_RULE_CODE = 'JC2A_2005_COC_VALIDITY';

/** The ledger source of an adjustment; its source is the adjustment itself. */
export const COC_ADJUSTMENT_SOURCE_TYPE = 'COC_ADJUSTMENT';

/** The ledger source of a reversal; its source and posting key are the original entry. */
export const COC_REVERSAL_SOURCE_TYPE = 'COC_REVERSAL';

/**
 * `rule_code` is required, but a user's correction applies no national rule. It
 * rests on its reason and supporting Document Version, so this names the control.
 */
export const COC_CORRECTION_RULE_CODE = 'HRIS_CONTROL_COC_CORRECTION';

export interface CocAdjustmentInput {
  /** Negative, at one decimal place. */
  minutes: string;
  /** The earliest-expiring COC when omitted. */
  validUntil?: string | undefined;
  reason: string;
  supportingDocumentVersionId: string;
}

export interface CocReversalInput {
  reason: string;
  supportingDocumentVersionId: string;
}

export interface CocCorrectionEntry {
  id: string;
  cocAccountId: string;
  minutes: string;
  effectiveDate: string;
  validUntil: string;
}

export interface CocReversalResult {
  entry: CocCorrectionEntry;
  /** The expiry that followed in the same transaction, when the Valid Until has passed. */
  expiryEntryId: string | null;
}

/** One certified Overtime Service Record on a Certificate of COC Earned. */
export interface CocEarnedCertificateLine {
  certificateLineId: string;
  /** The service record's Work Date, inside the earned month. */
  workDate: string;
  /** Certified Overtime Hours as whole minutes. */
  certifiedMinutes: number;
  dayClassification: CocDayClassification;
}

/** What approving a Certificate of COC Earned passes to the COC module. */
export interface CocEarnedCertificate {
  certificateId: string;
  employeeId: string;
  /** First day of the earned month, `YYYY-MM-01`. */
  earnedMonth: string;
  /** The approval's local date; its entries take effect on it. */
  approvalDate: string;
  approvedByMembershipId: string;
  lines: CocEarnedCertificateLine[];
}

/** COC after the ratio, at one decimal place, as the certificate line stores it. */
export interface CocEarnedCertificateLineCredit {
  certificateLineId: string;
  workDate: string;
  cocMinutes: string;
  creditedMinutes: string;
  excessMinutes: string;
  /** The entry for a credited line; `null` when the caps left nothing to credit. */
  ledgerEntryId: string | null;
}

/** A stored entry of an earlier award, as the ledger holds it. */
export interface CocAwardedEntry {
  certificateLineId: string;
  creditedMinutes: string;
  ledgerEntryId: string;
}

/**
 * A first award reports every line; a replay reports only the entries the
 * first award stored, since the ledger keeps neither excess nor uncredited lines.
 */
export type CocEarnedCertificateCredit =
  | {
      replayed: false;
      cocAccountId: string;
      validUntil: string;
      /** In Work Date order. */
      lines: CocEarnedCertificateLineCredit[];
    }
  | {
      replayed: true;
      cocAccountId: string;
      validUntil: string;
      /** By certificate line id. */
      entries: CocAwardedEntry[];
    };

/**
 * A balance as of a date counts entries effective on or before it whose Valid
 * Until has not passed, so COC past its Valid Until never counts, even before
 * an expiry entry exists.
 */
export interface CocBalance {
  cocAccountId: string | null;
  asOf: string;
  byValidUntil: { validUntil: string; minutes: string }[];
  totalMinutes: string;
}

export type CocRefusalCode =
  | CocEarningRefusalCode
  | 'COC_AWARD_INVALID'
  | 'COC_VALIDITY_PASSED'
  | 'COC_EMPLOYEE_NOT_FOUND'
  | 'COC_AWARD_REPLAY_MISMATCH'
  | 'COC_CERTIFICATE_OF_ANOTHER_EMPLOYEE'
  | 'COC_APPROVAL_BEFORE_LATEST_CERTIFICATE'
  | 'COC_SERVICE_IN_CLOSED_ACCOUNT'
  | 'COC_CORRECTION_FORBIDDEN'
  | 'COC_ACCOUNT_NOT_FOUND'
  | 'COC_ACCOUNT_CLOSED'
  | 'COC_OWN_ACCOUNT_FORBIDDEN'
  | 'COC_ENTRY_NOT_FOUND'
  | 'COC_REVERSAL_NOT_NEGATIVE'
  | 'COC_REVERSAL_SOURCE_NOT_ALLOWED'
  | 'COC_ENTRY_ALREADY_REVERSED'
  | 'COC_INSUFFICIENT_BALANCE'
  | 'COC_EVIDENCE_FORBIDDEN'
  | 'COC_EVIDENCE_INVALID'
  | 'COC_IDEMPOTENCY_CONFLICT';

export class CocServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: CocRefusalCode,
    /** Each line the earning rule refused, with its own reason, when `code` is a suspension. */
    readonly refusals: { certificateLineId: string; code: CocEarningRefusalCode }[] = [],
  ) {
    super(message);
    this.name = 'CocServiceError';
  }
}

/** Parse a `YYYY-MM-DD` date, refusing anything that is not a calendar date. */
export function toCocDate(value: string, label: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new CocServiceError(
      `${label} ${value} is not a calendar date.`,
      400,
      'COC_AWARD_INVALID',
    );
  }
  return date;
}

export function fromCocDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
