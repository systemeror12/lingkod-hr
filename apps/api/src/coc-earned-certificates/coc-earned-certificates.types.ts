export const COC_EARNED_CERTIFICATE_STATUSES = [
  'DRAFT',
  'FOR_APPROVAL',
  'APPROVED',
  'DISCARDED',
] as const;
export type CocEarnedCertificateStatus = (typeof COC_EARNED_CERTIFICATE_STATUSES)[number];

/** The shared Approval Route a Certificate of COC Earned is approved through. */
export const COC_EARNED_CERTIFICATE_ROUTE_CODE = 'COC_EARNED_CERTIFICATE';
export const COC_EARNED_CERTIFICATE_APPROVAL_SUBJECT_TYPE = 'COC_EARNED_CERTIFICATE';
/** Marks an Approval decision made through the Overtime module, not the generic Approval API. */
export const COC_EARNED_CERTIFICATE_APPROVAL_EFFECT_KIND = 'COC_EARNED_CERTIFICATE_DECISION';

export const PREPARE_PERMISSION = 'overtime.coc_certificates.prepare';
export const APPROVE_PERMISSION = 'overtime.coc_certificates.approve';

export interface CocEarnedCertificatePrepareInput {
  employeeId: string;
  /** The calendar month of the Work Dates, as `YYYY-MM`. */
  earnedMonth: string;
}

export interface CocEarnedCertificateReturnInput {
  reason: string;
}

export interface CocEarnedCertificateListFilter {
  status?: CocEarnedCertificateStatus | undefined;
}

export interface CocEarnedCertificateLineSummary {
  id: string;
  overtimeServiceRecordId: string;
  workDate: string;
  dayClassification: string | null;
  /** Certified Overtime Hours as whole minutes, before the ratio. */
  certifiedMinutes: number;
  /** COC after the ratio, frozen at approval; `null` until then. */
  creditedMinutes: string | null;
  excessMinutes: string | null;
  releasedAt: string | null;
}

export interface CocEarnedCertificateSummary {
  id: string;
  agencyId: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  /** The first day of the earned month, `YYYY-MM-DD`. */
  earnedMonth: string;
  status: CocEarnedCertificateStatus;
  preparedByMembershipId: string;
  approvedByMembershipId: string | null;
  approvedAt: string | null;
  createdAt: string;
  lines: CocEarnedCertificateLineSummary[];
}

export interface CocEarnedCertificateListResponse {
  certificates: CocEarnedCertificateSummary[];
}

export class CocEarnedCertificateServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'CocEarnedCertificateServiceError';
  }
}
