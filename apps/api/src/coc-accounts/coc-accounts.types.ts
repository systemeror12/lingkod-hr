import type { CocDayClassification, CocEarningRefusalCode } from './coc-earning-rule';

/** The ledger source of a certificate entry; its posting key is the certificate line. */
export const COC_CERTIFICATE_SOURCE_TYPE = 'COC_EARNED_CERTIFICATE';

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

export interface CocEarnedCertificateCredit {
  cocAccountId: string;
  validUntil: string;
  /** True when the certificate was already awarded and its entries are returned. */
  replayed: boolean;
  /** In Work Date order. */
  lines: CocEarnedCertificateLineCredit[];
}

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
  | 'COC_SERVICE_IN_CLOSED_ACCOUNT';

export class CocServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: CocRefusalCode,
    /** Lines refused by the earning rule, when `code` is a suspension. */
    readonly lineIds: string[] = [],
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
