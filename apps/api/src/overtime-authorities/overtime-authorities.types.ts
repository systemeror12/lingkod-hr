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
 * Why overtime pay cannot be approved until Payroll accepts its inputs (#347).
 * The one source of what the register states and the approval refusal says.
 */
export const OVERTIME_PAY_UNAVAILABLE_REASON =
  'Overtime pay cannot be approved until Payroll accepts Overtime Pay Inputs.';

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

/**
 * Who holds the authority's next step: the preparer submits a DRAFT, a reviewer
 * reviews a SUBMITTED one, and the Approving Official decides FOR_REVIEW.
 */
export type OvertimeAuthorityPendingRole = 'PREPARER' | 'REVIEWER' | 'APPROVING_OFFICIAL';

export interface OvertimeAuthorityPendingAction {
  role: OvertimeAuthorityPendingRole;
  /** The assignee of the open Approval Request's current step, while FOR_REVIEW. */
  assigneeName: string | null;
}

/** One authority as the register reads it. */
export interface OvertimeAuthorityRecord extends OvertimeAuthoritySummary {
  requestingUnitName: string;
  /** When the authority last changed: its latest Audit Event. */
  updatedAt: string;
  pendingAction: OvertimeAuthorityPendingAction | null;
  /** Why overtime pay is unavailable; `null` once it can be approved. */
  overtimePayUnavailableReason: string | null;
}

export interface OvertimeAuthorityListResponse {
  authorities: OvertimeAuthorityRecord[];
}

/** The review result read back from the review Audit Event (ADR 0010). */
export interface OvertimeAuthorityReviewResult {
  reviewedByName: string | null;
  reviewedAt: string;
  attestations: ReviewerAttestation[];
}

/** The Approving Official's decision on the review's Approval Request. */
export interface OvertimeAuthorityDecision {
  decision: string;
  comments: string | null;
  decidedByName: string | null;
  decidedAt: string;
}

export interface OvertimeAuthorityHistoryEntry {
  id: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  actorName: string | null;
  occurredAt: string;
}

export interface OvertimeAuthorityDetail extends OvertimeAuthorityRecord {
  review: OvertimeAuthorityReviewResult | null;
  decision: OvertimeAuthorityDecision | null;
  history: OvertimeAuthorityHistoryEntry[];
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
