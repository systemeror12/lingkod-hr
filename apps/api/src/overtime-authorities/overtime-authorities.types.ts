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

/** The shared Approval Route an Overtime Authority is approved through. */
export const OVERTIME_AUTHORITY_ROUTE_CODE = 'OVERTIME_AUTHORITY';
export const OVERTIME_AUTHORITY_APPROVAL_SUBJECT_TYPE = 'OVERTIME_AUTHORITY';
/** Marks an Approval decision made through the Overtime module, not the generic Approval API. */
export const OVERTIME_AUTHORITY_APPROVAL_EFFECT_KIND = 'OVERTIME_AUTHORITY_DECISION';

/**
 * The reviewer's position attestation (JC 2, s. 2015 items 6.1–7.0): the
 * Employee is at division-chief level or below, or is such an incumbent
 * designated Officer-in-Charge of a higher position.
 */
export const POSITION_LEVEL_ATTESTATIONS = [
  'DIVISION_CHIEF_OR_BELOW',
  'OIC_OF_HIGHER_POSITION',
] as const;
export type PositionLevelAttestation = (typeof POSITION_LEVEL_ATTESTATIONS)[number];

/** What the reviewer attests for one covered Employee, the facts the system does not hold. */
export interface ReviewerAttestation {
  employeeId: string;
  positionLevel: PositionLevelAttestation;
  noOtherBeyondHoursAllowance: true;
}

export interface OvertimeAuthorityReviewInput {
  attestations: ReviewerAttestation[];
}

export interface OvertimeAuthorityApproveInput {
  compensationMethod: CompensationMethod;
  comments?: string | undefined;
}

export interface OvertimeAuthorityRejectInput {
  reason: string;
}

/** One Service Segment over the Work Dates, with its position as it then stood. */
export interface EligibilityServiceFact {
  serviceSegmentId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  appointmentStatus: string;
  salaryGrade: number | null;
  positionId: string | null;
  positionItemNumber: string | null;
  positionTitle: string | null;
  /** The position's employment category: PLANTILLA, CASUAL, CONTRACTUAL, or OTHER. */
  personnelCategory: string | null;
}

/** One Schedule Assignment's Work Arrangement Version over the Work Dates. */
export interface EligibilityWorkArrangementFact {
  workArrangementVersionId: string;
  arrangementType: string;
  versionNo: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/** Written once per covered Employee at approval (hris-controls §5.16). */
export interface EligibilitySnapshot {
  capturedAt: string;
  workDateFrom: string;
  workDateTo: string;
  service: EligibilityServiceFact[];
  workArrangements: EligibilityWorkArrangementFact[];
  attestation: {
    positionLevel: PositionLevelAttestation;
    noOtherBeyondHoursAllowance: true;
    reviewedByMembershipId: string;
    reviewedAt: string;
  };
}

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
  eligibilitySnapshot: EligibilitySnapshot | null;
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
  approvedByMembershipId: string | null;
  approvedAt: string | null;
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
