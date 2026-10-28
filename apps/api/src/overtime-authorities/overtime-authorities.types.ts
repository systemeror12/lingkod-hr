export const OVERTIME_AUTHORITY_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'FOR_REVIEW',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;
export type OvertimeAuthorityStatus = (typeof OVERTIME_AUTHORITY_STATUSES)[number];

export const COMPENSATION_METHODS = ['COC', 'OVERTIME_PAY'] as const;
export type CompensationMethod = (typeof COMPENSATION_METHODS)[number];

/**
 * Why a covered Employee is refused (hris-controls §5.16). An Employee of
 * another Agency is invisible under RLS, so it reads as `EMPLOYEE_NOT_FOUND`.
 */
export type CoveredEmployeeRefusalCode = 'EMPLOYEE_NOT_FOUND' | 'NOT_APPOINTED_PERSONNEL';

export interface CoveredEmployeeRefusal {
  employeeId: string;
  code: CoveredEmployeeRefusalCode;
  message: string;
}

export interface CoveredEmployeeInput {
  employeeId: string;
  authorizedHours: string;
  taskDescription?: string | null | undefined;
}

/** The whole draft. Create and update both take it, so an edit replaces the draft. */
export interface OvertimeAuthorityDraftInput {
  authorityNo: string;
  requestingUnitId: string;
  purpose: string;
  workDateFrom: string;
  workDateTo: string;
  compensationMethod: CompensationMethod;
  fundingReference?: string | null | undefined;
  employees: CoveredEmployeeInput[];
}

export interface CoveredEmployeeSummary {
  id: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  authorizedHours: string;
  taskDescription: string | null;
}

export interface OvertimeAuthoritySummary {
  id: string;
  agencyId: string;
  authorityNo: string;
  requestingUnitId: string;
  purpose: string;
  workDateFrom: string;
  workDateTo: string;
  compensationMethod: CompensationMethod;
  fundingReference: string | null;
  status: OvertimeAuthorityStatus;
  createdAt: string;
  employees: CoveredEmployeeSummary[];
}

export class OvertimeAuthorityServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly refusals: CoveredEmployeeRefusal[] = [],
  ) {
    super(message);
    this.name = 'OvertimeAuthorityServiceError';
  }
}
