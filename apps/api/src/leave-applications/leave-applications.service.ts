import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import {
  ApprovalCompletionRegistry,
  ApprovalsService,
  type ApprovalCompletionRequest,
} from '../approvals/approval.service';
import { HolidayCalendarsService } from '../attendance-configuration/holiday-calendars.service';
import { WorkArrangementsService } from '../attendance-configuration/work-arrangements.service';
import { WorkSchedulesService } from '../attendance-configuration/work-schedules.service';
import { DocumentsService } from '../documents/documents.service';
import {
  findLeaveCatalogueEntry,
  parseLeaveRuleParameters,
  LEAVE_EVIDENCE_KINDS,
  LEAVE_QUALIFYING_EVENTS,
  type LeaveAuthorityCitation,
  type LeaveCalendarBasis,
  type LeaveEntitlementBasis,
  type LeaveEvaluatorKind,
  type LeaveQualifyingEvent,
  type LeaveRuleParameters,
} from '../leave-policies/leave-catalogue';
import {
  evaluateLeaveEligibility,
  NON_WORKING_HOLIDAY_DAY_TYPES,
  type LeaveEligibilityDateFact,
  type LeaveEligibilityOutcome,
} from './leave-eligibility';
import {
  LEAVE_APPLICATION_SUBMISSION_METHODS,
  type LeaveApplicationCertificationInput,
  type LeaveApplicationDecisionInput,
  type LeaveApplicationDocumentInput,
  type LeaveApplicationDraftInput,
  type LeaveApplicationRecommendationInput,
  type LeaveApplicationReturnInput,
  type LeaveApplicationSubmitInput,
  type LeaveApplicationWithdrawInput,
  type LeaveApprovalAllocationKind,
} from './leave-applications.schemas';

export interface LeaveApplicationPeriodSummary {
  sequenceNo: number;
  dateFrom: string;
  dateTo: string;
}

export interface LeaveApplicationDocumentSummary {
  id: string;
  documentVersionId: string;
  purposeCode: string;
  documentNo: string | null;
  documentType: string | null;
  versionNo: number | null;
}

export interface LeaveApplicationAssessmentSummary {
  id: string;
  assessmentNo: number;
  result: string;
  inputFacts: Prisma.JsonValue;
  ruleResults: Prisma.JsonValue;
  missingFacts: Prisma.JsonValue;
  assessedAt: string;
}

export interface LeaveCalculationSegmentSummary {
  id: string;
  policyVersionId: string;
  scheduleAssignmentId: string | null;
  holidayFacts: Prisma.JsonValue;
  dateFrom: string;
  dateTo: string;
  requestedQuantity: string;
  requestedUnit: string;
  accountQuantity: string | null;
  allocationKinds: LeaveApprovalAllocationKind[];
}

export interface LeaveCreditCertificationLineSummary {
  id: string;
  leaveAccountId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  postedBalance: string;
  activeCommitments: string;
  applicationQuantity: string;
  availableAfterApplication: string;
  leaveCreditCommitmentId: string;
}

export interface LeaveCreditCertificationSummary {
  id: string;
  eligibilityAssessmentId: string;
  approvalDecisionId: string;
  balanceAsOf: string;
  ledgerRecordedThrough: string;
  certifiedByMembershipId: string;
  certifiedByName: string | null;
  certifiedAt: string;
  lines: LeaveCreditCertificationLineSummary[];
}

export interface LeaveRecommendationSummary {
  id: string;
  approvalDecisionId: string;
  outcome: string;
  reason: string | null;
  recommendedAt: string;
}

export interface LeaveApprovalAllocationLineSummary {
  id: string;
  sequenceNo: number;
  dateFrom: string;
  dateTo: string;
  allocationKind: string;
  policyVersionId: string;
  leaveAccountId: string | null;
  quantity: string;
  unitCode: string;
}

export interface LeaveApprovalAllocationSummary {
  id: string;
  approvalDecisionId: string;
  decidedAt: string;
  lines: LeaveApprovalAllocationLineSummary[];
}

export interface LeaveApprovalDecisionSummary {
  id: string;
  decidedByMembershipId: string;
  decidedByName: string | null;
  decision: string;
  comments: string | null;
  decidedAt: string;
}

export interface LeaveApprovalStepSummary {
  id: string;
  stepNo: number;
  status: string;
  requiredPermission: string;
  approvePermission: string;
  returnPermission: string;
  rejectPermission: string;
  assignedRoleCode: string | null;
  assignedMembershipId: string | null;
  requiresSeparateReview: boolean;
  activatedAt: string | null;
  completedAt: string | null;
  decisions: LeaveApprovalDecisionSummary[];
}

const LEAVE_APPROVAL_EFFECT_KIND = 'LEAVE_APPLICATION';

const LEAVE_REVIEW_PERMISSIONS = [
  'leave.credits.certify',
  'leave.applications.recommend',
  'leave.applications.approve',
  'leave.applications.reject',
] as const;

const LEAVE_FINAL_DECISION_PERMISSIONS = [
  'leave.applications.approve',
  'leave.applications.reject',
] as const;

const CERTIFIED_COMMITMENT_KEY = 'CERTIFIED';
const APPROVED_COMMITMENT_KEY = 'APPROVED';
const COMMITMENT_SOURCE_TYPE = 'LeaveApplicationVersion';

interface LeaveSegmentAccountCharge {
  segmentId: string;
  policyVersionId: string;
  dateFrom: Date;
  dateTo: Date;
  requestedQuantity: Prisma.Decimal;
  requestedUnit: string;
  leaveAccountId: string | null;
  accountQuantity: Prisma.Decimal;
  allocationKinds: readonly LeaveApprovalAllocationKind[];
}

interface LeaveAllocationPlanLine {
  sequenceNo: number;
  segmentId: string;
  policyVersionId: string;
  dateFrom: Date;
  dateTo: Date;
  allocationKind: LeaveApprovalAllocationKind;
  leaveAccountId: string | null;
  quantity: Prisma.Decimal;
  unitCode: string;
}

function stepApprovalDecisionId(
  summary: {
    steps: Array<{
      stepNo: number;
      decisions: Array<{ id: string; decidedByMembershipId: string; decision: string }>;
    }>;
  },
  stepNo: number,
  membershipId: string,
): string {
  const step = summary.steps.find((candidate) => candidate.stepNo === stepNo);
  const decision = [...(step?.decisions ?? [])]
    .reverse()
    .find(
      (candidate) =>
        candidate.decidedByMembershipId === membershipId && candidate.decision === 'APPROVE',
    );
  if (!decision) {
    throw new LeaveApplicationServiceError(
      'The Approval Step decision could not be resolved for this Leave Application.',
      409,
      'LEAVE_APPLICATION_APPROVAL_DECISION_REQUIRED',
    );
  }
  return decision.id;
}

export interface LeaveApplicationVersionSummary {
  id: string;
  versionNo: number;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  acceptedAssessmentId: string | null;
  approvalRouteVersionId: string;
  approvalRouteCode: string;
  approvalRequestId: string;
  approvalRequestStatus: string;
  formTemplateDocumentVersionId: string;
  attestationType: string;
  attestationDocumentVersionId: string | null;
  submittedByMembershipId: string;
  submittedByName: string | null;
  employeeAttestedAt: string | null;
  submissionMethod: string;
  receivedAt: string;
  reason: string | null;
  policyDetails: Prisma.JsonValue;
  commutationChoice: string | null;
  submittedAt: string;
  periods: LeaveApplicationPeriodSummary[];
  documents: LeaveApplicationDocumentSummary[];
  assessments: LeaveApplicationAssessmentSummary[];
  calculationSegments: LeaveCalculationSegmentSummary[];
  certification: LeaveCreditCertificationSummary | null;
  recommendation: LeaveRecommendationSummary | null;
  approvalAllocation: LeaveApprovalAllocationSummary | null;
  approvalSteps: LeaveApprovalStepSummary[];
}

export interface LeaveApplicationHistoryEntry {
  id: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  occurredAt: string;
}

export interface LeaveApplicationSummary {
  id: string;
  agencyId: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  status: string;
  currentVersionId: string | null;
  currentVersionNo: number | null;
  reason: string | null;
  policyDetails: Prisma.JsonValue;
  commutationChoice: string | null;
  periods: LeaveApplicationPeriodSummary[];
  submittedAt: string | null;
  createdAt: string;
}

export interface LeaveApplicationDetail {
  application: LeaveApplicationSummary;
  draftPeriods: LeaveApplicationPeriodSummary[];
  draftDocuments: LeaveApplicationDocumentSummary[];
  versions: LeaveApplicationVersionSummary[];
  history: LeaveApplicationHistoryEntry[];
}

export interface LeaveApplicationListFilters {
  employeeId?: string | undefined;
  leaveTypeId?: string | undefined;
  status?: string | undefined;
  limit?: number | undefined;
}

export interface LeaveApplicationAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const LEAVE_APPLICATION_AUDIT_WRITER = Symbol('LEAVE_APPLICATION_AUDIT_WRITER');

export const leaveApplicationAuditWriter: LeaveApplicationAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};

export class LeaveApplicationServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly reasons: string[] = [],
  ) {
    super(message);
    this.name = 'LeaveApplicationServiceError';
  }
}

const WITHDRAWABLE_STATUSES = [
  'SUBMITTED',
  'FOR_CERTIFICATION',
  'FOR_RECOMMENDATION',
  'FOR_APPROVAL',
  'NEEDS_INFORMATION',
] as const;

const LEAVE_REVIEW_STATUSES = ['FOR_CERTIFICATION', 'FOR_RECOMMENDATION', 'FOR_APPROVAL'] as const;

const UNFINISHED_REQUEST_STATUSES = ['PENDING', 'IN_PROGRESS', 'RETURNED'] as const;

const MAXIMUM_PERIOD_DATES = 3660;

const applicationSelect = {
  id: true,
  agencyId: true,
  employeeId: true,
  draftLeaveTypeId: true,
  currentVersionId: true,
  draftReason: true,
  draftPolicyDetails: true,
  draftCommutationChoice: true,
  status: true,
  createdByMembershipId: true,
  createdAt: true,
  employee: {
    select: {
      employeeNumber: true,
      legalName: true,
      memberships: { select: { id: true } },
    },
  },
  draftLeaveType: { select: { code: true, name: true } },
  currentVersion: {
    select: {
      id: true,
      versionNo: true,
      submittedAt: true,
      approvalRequestId: true,
      approvalRequest: { select: { status: true } },
    },
  },
} as const;

const draftPeriodSelect = { sequenceNo: true, dateFrom: true, dateTo: true } as const;

const draftDocumentSelect = {
  id: true,
  documentVersionId: true,
  purposeCode: true,
  documentVersion: {
    select: { versionNo: true, document: { select: { documentNo: true, documentType: true } } },
  },
} as const;

const assessmentSelect = {
  id: true,
  assessmentNo: true,
  result: true,
  inputFacts: true,
  ruleResults: true,
  missingFacts: true,
  assessedAt: true,
} as const;

const segmentSelect = {
  id: true,
  policyVersionId: true,
  scheduleAssignmentId: true,
  holidayFacts: true,
  dateFrom: true,
  dateTo: true,
  requestedQuantity: true,
  requestedUnit: true,
  accountQuantity: true,
  policyVersion: {
    select: {
      entitlementBasis: true,
      chargedLeaveTypeId: true,
      ruleParameters: true,
      leaveType: { select: { code: true } },
    },
  },
} as const;

const certificationLineSelect = {
  id: true,
  leaveAccountId: true,
  postedBalance: true,
  activeCommitments: true,
  applicationQuantity: true,
  availableAfterApplication: true,
  leaveCreditCommitmentId: true,
  leaveAccount: { select: { leaveType: { select: { code: true, name: true } } } },
} satisfies Prisma.LeaveCreditCertificationLineSelect;

const certificationSelect = {
  id: true,
  eligibilityAssessmentId: true,
  approvalDecisionId: true,
  balanceAsOf: true,
  ledgerRecordedThrough: true,
  certifiedByMembershipId: true,
  certifiedAt: true,
  certifiedBy: { select: { employee: { select: { legalName: true } } } },
  lines: { orderBy: [{ id: 'asc' }], select: certificationLineSelect },
} satisfies Prisma.LeaveCreditCertificationSelect;

const allocationLineSelect = {
  id: true,
  sequenceNo: true,
  dateFrom: true,
  dateTo: true,
  allocationKind: true,
  policyVersionId: true,
  leaveAccountId: true,
  quantity: true,
  unitCode: true,
} satisfies Prisma.LeaveApprovalAllocationLineSelect;

const approvalDecisionSelect = {
  id: true,
  decidedByMembershipId: true,
  decision: true,
  comments: true,
  decidedAt: true,
  decidedBy: { select: { employee: { select: { legalName: true } } } },
} satisfies Prisma.ApprovalDecisionSelect;

const versionSelect = {
  id: true,
  versionNo: true,
  leaveTypeId: true,
  acceptedAssessmentId: true,
  approvalRouteVersionId: true,
  approvalRequestId: true,
  formTemplateDocumentVersionId: true,
  attestationType: true,
  attestationDocumentVersionId: true,
  submittedByMembershipId: true,
  employeeAttestedAt: true,
  submissionMethod: true,
  receivedAt: true,
  reason: true,
  policyDetails: true,
  commutationChoice: true,
  submittedAt: true,
  leaveType: { select: { code: true, name: true } },
  approvalRouteVersion: { select: { routeCode: true } },
  approvalRequest: {
    select: {
      status: true,
      steps: {
        orderBy: { stepNo: 'asc' as const },
        select: {
          id: true,
          stepNo: true,
          status: true,
          requiredPermission: true,
          approvePermission: true,
          returnPermission: true,
          rejectPermission: true,
          assignedRoleCode: true,
          assignedMembershipId: true,
          requiresSeparateReview: true,
          activatedAt: true,
          completedAt: true,
          decisions: { orderBy: { decidedAt: 'asc' as const }, select: approvalDecisionSelect },
        },
      },
    },
  },
  submittedBy: { select: { employee: { select: { legalName: true } } } },
  periods: { orderBy: { sequenceNo: 'asc' as const }, select: draftPeriodSelect },
  documents: {
    orderBy: [{ purposeCode: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      documentVersionId: true,
      purposeCode: true,
      documentVersion: {
        select: {
          versionNo: true,
          document: { select: { documentNo: true, documentType: true } },
        },
      },
    },
  },
  assessments: { orderBy: { assessmentNo: 'asc' as const }, select: assessmentSelect },
  calculationSegments: {
    orderBy: [{ dateFrom: 'asc' as const }, { id: 'asc' as const }],
    select: segmentSelect,
  },
  creditCertification: { select: certificationSelect },
  recommendation: {
    select: {
      id: true,
      approvalDecisionId: true,
      outcome: true,
      reason: true,
      recommendedAt: true,
    },
  },
  approvalAllocation: {
    select: {
      id: true,
      approvalDecisionId: true,
      decidedAt: true,
      lines: {
        orderBy: { sequenceNo: 'asc' as const },
        select: allocationLineSelect,
      },
    },
  },
} satisfies Prisma.LeaveApplicationVersionSelect;

const policyVersionSelect = {
  id: true,
  versionNo: true,
  leaveTypeId: true,
  evaluatorKind: true,
  entitlementBasis: true,
  calendarBasis: true,
  chargedLeaveTypeId: true,
  ruleParameters: true,
  applicabilityRules: true,
  documentRequirements: true,
  approvalRouteCode: true,
  leaveType: { select: { code: true } },
} as const;

type ApplicationRecord = Prisma.LeaveApplicationGetPayload<{ select: typeof applicationSelect }>;
type VersionRecord = Prisma.LeaveApplicationVersionGetPayload<{ select: typeof versionSelect }>;
type PolicyVersionRecord = Prisma.LeavePolicyVersionGetPayload<{
  select: typeof policyVersionSelect;
}>;

const ZERO = new Prisma.Decimal(0);

function chargesLeaveAccount(policy: {
  chargedLeaveTypeId: string | null;
  entitlementBasis: string;
}): boolean {
  return (
    policy.chargedLeaveTypeId !== null ||
    policy.entitlementBasis === 'ACCRUED_ACCOUNT' ||
    policy.entitlementBasis === 'PERIODIC_ALLOWANCE'
  );
}

interface LeaveAllocationPolicy {
  chargedLeaveTypeId: string | null;
  entitlementBasis: string;
  ruleParameters: unknown;
  leaveType: { code: string };
}

/**
 * The bound Leave Policy Version is the allocation authority. A ledger-charging
 * policy approves against its account and classifies the quantity the certified
 * account cannot cover as leave without pay (MC41 s.50). A paid policy outside
 * the ledger is non-credit; an unpaid policy is leave without pay. No approver
 * may choose a different source within a decision.
 */
export function permittedAllocationKinds(
  policy: LeaveAllocationPolicy,
): readonly LeaveApprovalAllocationKind[] {
  if (chargesLeaveAccount(policy)) return ['LEAVE_ACCOUNT', 'LEAVE_WITHOUT_PAY'];
  const entry = findLeaveCatalogueEntry(policy.leaveType.code);
  const parsed = parseLeaveRuleParameters(policy.ruleParameters);
  const parameters: LeaveRuleParameters = parsed.success
    ? parsed.data
    : (entry?.ruleParameters ?? {});
  return parameters.paid === false ? ['LEAVE_WITHOUT_PAY'] : ['NON_CREDIT'];
}

function databaseContext(context: RequestContext, transition = false) {
  return requestDatabaseContext(context, ...(transition ? (['approval-transition'] as const) : []));
}

function toDatabaseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw dateInvalid();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw dateInvalid();
  }
  return date;
}

function toDatabaseInstant(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw dateInvalid();
  return date;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatDateTime(value: Date): string {
  return value.toISOString();
}

function formatQuantity(value: Prisma.Decimal): string {
  return value.toFixed(4);
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

function isoWeekday(value: Date): number {
  const day = value.getUTCDay();
  return day === 0 ? 7 : day;
}

function manilaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function metadataString(metadata: Prisma.JsonValue, key: string): string | null {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

function readStringArray(value: unknown, key: string): string[] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = (value as Record<string, unknown>)[key];
  if (entry === undefined || entry === null) return [];
  if (!Array.isArray(entry) || entry.some((item) => typeof item !== 'string')) return null;
  return entry as string[];
}

function periodSummary(record: { sequenceNo: number; dateFrom: Date; dateTo: Date }) {
  return {
    sequenceNo: record.sequenceNo,
    dateFrom: formatDate(record.dateFrom),
    dateTo: formatDate(record.dateTo),
  };
}

function documentSummary(record: {
  id: string;
  documentVersionId: string;
  purposeCode: string;
  documentVersion: {
    versionNo: number;
    document: { documentNo: string | null; documentType: string };
  };
}): LeaveApplicationDocumentSummary {
  return {
    id: record.id,
    documentVersionId: record.documentVersionId,
    purposeCode: record.purposeCode,
    documentNo: record.documentVersion.document.documentNo,
    documentType: record.documentVersion.document.documentType,
    versionNo: record.documentVersion.versionNo,
  };
}

function assessmentSummary(record: {
  id: string;
  assessmentNo: number;
  result: string;
  inputFacts: Prisma.JsonValue;
  ruleResults: Prisma.JsonValue;
  missingFacts: Prisma.JsonValue;
  assessedAt: Date;
}): LeaveApplicationAssessmentSummary {
  return {
    id: record.id,
    assessmentNo: record.assessmentNo,
    result: record.result,
    inputFacts: record.inputFacts,
    ruleResults: record.ruleResults,
    missingFacts: record.missingFacts,
    assessedAt: formatDateTime(record.assessedAt),
  };
}

function segmentSummary(record: {
  id: string;
  policyVersionId: string;
  scheduleAssignmentId: string | null;
  holidayFacts: Prisma.JsonValue;
  dateFrom: Date;
  dateTo: Date;
  requestedQuantity: Prisma.Decimal;
  requestedUnit: string;
  accountQuantity: Prisma.Decimal | null;
  policyVersion: LeaveAllocationPolicy;
}): LeaveCalculationSegmentSummary {
  return {
    id: record.id,
    policyVersionId: record.policyVersionId,
    scheduleAssignmentId: record.scheduleAssignmentId,
    holidayFacts: record.holidayFacts,
    dateFrom: formatDate(record.dateFrom),
    dateTo: formatDate(record.dateTo),
    requestedQuantity: formatQuantity(record.requestedQuantity),
    requestedUnit: record.requestedUnit,
    accountQuantity:
      record.accountQuantity === null ? null : formatQuantity(record.accountQuantity),
    allocationKinds: [...permittedAllocationKinds(record.policyVersion)],
  };
}

function applicationSummary(record: ApplicationRecord): LeaveApplicationSummary {
  return {
    id: record.id,
    agencyId: record.agencyId,
    employeeId: record.employeeId,
    employeeNumber: record.employee.employeeNumber,
    employeeName: record.employee.legalName,
    leaveTypeId: record.draftLeaveTypeId,
    leaveTypeCode: record.draftLeaveType.code,
    leaveTypeName: record.draftLeaveType.name,
    status: record.status,
    currentVersionId: record.currentVersionId,
    currentVersionNo: record.currentVersion?.versionNo ?? null,
    reason: record.draftReason,
    policyDetails: record.draftPolicyDetails,
    commutationChoice: record.draftCommutationChoice,
    periods: [],
    submittedAt: record.currentVersion ? formatDateTime(record.currentVersion.submittedAt) : null,
    createdAt: formatDateTime(record.createdAt),
  };
}

function certificationLineSummary(record: {
  id: string;
  leaveAccountId: string;
  postedBalance: Prisma.Decimal;
  activeCommitments: Prisma.Decimal;
  applicationQuantity: Prisma.Decimal;
  availableAfterApplication: Prisma.Decimal;
  leaveCreditCommitmentId: string;
  leaveAccount: { leaveType: { code: string; name: string } };
}): LeaveCreditCertificationLineSummary {
  return {
    id: record.id,
    leaveAccountId: record.leaveAccountId,
    leaveTypeCode: record.leaveAccount.leaveType.code,
    leaveTypeName: record.leaveAccount.leaveType.name,
    postedBalance: formatQuantity(record.postedBalance),
    activeCommitments: formatQuantity(record.activeCommitments),
    applicationQuantity: formatQuantity(record.applicationQuantity),
    availableAfterApplication: formatQuantity(record.availableAfterApplication),
    leaveCreditCommitmentId: record.leaveCreditCommitmentId,
  };
}

function certificationSummary(record: {
  id: string;
  eligibilityAssessmentId: string;
  approvalDecisionId: string;
  balanceAsOf: Date;
  ledgerRecordedThrough: Date;
  certifiedByMembershipId: string;
  certifiedAt: Date;
  certifiedBy: { employee: { legalName: string } | null };
  lines: Parameters<typeof certificationLineSummary>[0][];
}): LeaveCreditCertificationSummary {
  return {
    id: record.id,
    eligibilityAssessmentId: record.eligibilityAssessmentId,
    approvalDecisionId: record.approvalDecisionId,
    balanceAsOf: formatDate(record.balanceAsOf),
    ledgerRecordedThrough: formatDateTime(record.ledgerRecordedThrough),
    certifiedByMembershipId: record.certifiedByMembershipId,
    certifiedByName: record.certifiedBy.employee?.legalName ?? null,
    certifiedAt: formatDateTime(record.certifiedAt),
    lines: record.lines.map(certificationLineSummary),
  };
}

function allocationLineSummary(record: {
  id: string;
  sequenceNo: number;
  dateFrom: Date;
  dateTo: Date;
  allocationKind: string;
  policyVersionId: string;
  leaveAccountId: string | null;
  quantity: Prisma.Decimal;
  unitCode: string;
}): LeaveApprovalAllocationLineSummary {
  return {
    id: record.id,
    sequenceNo: record.sequenceNo,
    dateFrom: formatDate(record.dateFrom),
    dateTo: formatDate(record.dateTo),
    allocationKind: record.allocationKind,
    policyVersionId: record.policyVersionId,
    leaveAccountId: record.leaveAccountId,
    quantity: formatQuantity(record.quantity),
    unitCode: record.unitCode,
  };
}

function versionSummary(record: VersionRecord): LeaveApplicationVersionSummary {
  return {
    id: record.id,
    versionNo: record.versionNo,
    leaveTypeId: record.leaveTypeId,
    leaveTypeCode: record.leaveType.code,
    leaveTypeName: record.leaveType.name,
    acceptedAssessmentId: record.acceptedAssessmentId,
    approvalRouteVersionId: record.approvalRouteVersionId,
    approvalRouteCode: record.approvalRouteVersion.routeCode,
    approvalRequestId: record.approvalRequestId,
    approvalRequestStatus: record.approvalRequest.status,
    formTemplateDocumentVersionId: record.formTemplateDocumentVersionId,
    attestationType: record.attestationType,
    attestationDocumentVersionId: record.attestationDocumentVersionId,
    submittedByMembershipId: record.submittedByMembershipId,
    submittedByName: record.submittedBy.employee?.legalName ?? null,
    employeeAttestedAt: record.employeeAttestedAt
      ? formatDateTime(record.employeeAttestedAt)
      : null,
    submissionMethod: record.submissionMethod,
    receivedAt: formatDateTime(record.receivedAt),
    reason: record.reason,
    policyDetails: record.policyDetails,
    commutationChoice: record.commutationChoice,
    submittedAt: formatDateTime(record.submittedAt),
    periods: record.periods.map(periodSummary),
    documents: record.documents.map(documentSummary),
    assessments: record.assessments.map(assessmentSummary),
    calculationSegments: record.calculationSegments.map(segmentSummary),
    certification: record.creditCertification
      ? certificationSummary(record.creditCertification)
      : null,
    recommendation: record.recommendation
      ? {
          id: record.recommendation.id,
          approvalDecisionId: record.recommendation.approvalDecisionId,
          outcome: record.recommendation.outcome,
          reason: record.recommendation.reason,
          recommendedAt: formatDateTime(record.recommendation.recommendedAt),
        }
      : null,
    approvalAllocation: record.approvalAllocation
      ? {
          id: record.approvalAllocation.id,
          approvalDecisionId: record.approvalAllocation.approvalDecisionId,
          decidedAt: formatDateTime(record.approvalAllocation.decidedAt),
          lines: record.approvalAllocation.lines.map(allocationLineSummary),
        }
      : null,
    approvalSteps: record.approvalRequest.steps.map((step) => ({
      id: step.id,
      stepNo: step.stepNo,
      status: step.status,
      requiredPermission: step.requiredPermission,
      approvePermission: step.approvePermission,
      returnPermission: step.returnPermission,
      rejectPermission: step.rejectPermission,
      assignedRoleCode: step.assignedRoleCode,
      assignedMembershipId: step.assignedMembershipId,
      requiresSeparateReview: step.requiresSeparateReview,
      activatedAt: step.activatedAt ? formatDateTime(step.activatedAt) : null,
      completedAt: step.completedAt ? formatDateTime(step.completedAt) : null,
      decisions: step.decisions.map((decision) => ({
        id: decision.id,
        decidedByMembershipId: decision.decidedByMembershipId,
        decidedByName: decision.decidedBy.employee?.legalName ?? null,
        decision: decision.decision,
        comments: decision.comments,
        decidedAt: formatDateTime(decision.decidedAt),
      })),
    })),
  };
}

function leaveTypeNotFound(): LeaveApplicationServiceError {
  return new LeaveApplicationServiceError(
    'The Leave Type could not be found in this Agency.',
    404,
    'LEAVE_APPLICATION_LEAVE_TYPE_NOT_FOUND',
  );
}

function applicationNotFound(): LeaveApplicationServiceError {
  return new LeaveApplicationServiceError(
    'The Leave Application could not be found.',
    404,
    'LEAVE_APPLICATION_NOT_FOUND',
  );
}

function employeeNotFound(): LeaveApplicationServiceError {
  return new LeaveApplicationServiceError(
    'The Employee could not be found in this Agency.',
    404,
    'LEAVE_APPLICATION_EMPLOYEE_NOT_FOUND',
  );
}

function workflowError(action: string, status: string): LeaveApplicationServiceError {
  return new LeaveApplicationServiceError(
    `The Leave Application cannot ${action} while it is ${status}.`,
    409,
    'LEAVE_APPLICATION_WORKFLOW_INVALID',
    [status],
  );
}

function deficiency(code: string, message: string, reasons: string[] = []) {
  return new LeaveApplicationServiceError(message, 400, code, reasons);
}

function dateInvalid(): LeaveApplicationServiceError {
  return new LeaveApplicationServiceError(
    'Enter a valid date.',
    400,
    'LEAVE_APPLICATION_DATE_INVALID',
  );
}

function idempotencyConflict(): LeaveApplicationServiceError {
  return new LeaveApplicationServiceError(
    'That Idempotency-Key was already used for a different request.',
    409,
    'LEAVE_APPLICATION_IDEMPOTENCY_CONFLICT',
  );
}

function routeInvalid(): LeaveApplicationServiceError {
  return new LeaveApplicationServiceError(
    'The bound Approval Route cannot perform that decision for this Leave Application.',
    409,
    'LEAVE_APPLICATION_ROUTE_INVALID',
  );
}

function recertificationRequired(): LeaveApplicationServiceError {
  return new LeaveApplicationServiceError(
    'The Leave Credit Certification no longer matches the Leave Account facts; certify the Leave Application again.',
    409,
    'LEAVE_APPLICATION_RECERTIFICATION_REQUIRED',
  );
}

function assessmentRequired(): LeaveApplicationServiceError {
  return new LeaveApplicationServiceError(
    'The Leave Application has no accepted Leave Eligibility Assessment to certify.',
    409,
    'LEAVE_APPLICATION_ASSESSMENT_REQUIRED',
  );
}

function recommendationRequired(): LeaveApplicationServiceError {
  return new LeaveApplicationServiceError(
    'The Leave Application has no Supervisor recommendation yet.',
    409,
    'LEAVE_APPLICATION_RECOMMENDATION_REQUIRED',
  );
}

function allocationInvalid(message: string): LeaveApplicationServiceError {
  return new LeaveApplicationServiceError(message, 400, 'LEAVE_APPLICATION_ALLOCATION_INVALID');
}

function parseQuantity(value: string): Prisma.Decimal {
  try {
    return new Prisma.Decimal(value);
  } catch {
    throw allocationInvalid('Enter a valid quantity.');
  }
}

/**
 * Leave Applications own the employee's case. Draft facts stay mutable until
 * submission; each submission or material resubmission freezes an immutable
 * Leave Application Version with the exact form template, evidence, accepted
 * Leave Eligibility Assessment, calculation segments, and Approval Route
 * Version it relied on. Eligibility fails closed: unresolved policy, schedule,
 * holiday, evidence, account, or route input blocks submission instead of
 * defaulting in the employee's favor.
 */
@Injectable()
export class LeaveApplicationsService implements OnModuleInit {
  constructor(
    @Inject(LEAVE_APPLICATION_AUDIT_WRITER)
    private readonly auditWriter: LeaveApplicationAuditWriter,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
    @Inject(ApprovalsService) private readonly approvalsService: ApprovalsService,
    @Inject(ApprovalCompletionRegistry)
    private readonly completionRegistry: ApprovalCompletionRegistry,
    @Inject(WorkSchedulesService) private readonly workSchedules: WorkSchedulesService,
    @Inject(WorkArrangementsService) private readonly workArrangements: WorkArrangementsService,
    @Inject(HolidayCalendarsService) private readonly holidayCalendars: HolidayCalendarsService,
  ) {}

  onModuleInit(): void {
    this.completionRegistry.register('LEAVE_APPLICATION', (transaction, _context, request) =>
      this.assertApprovalEffect(transaction, request, ['FOR_APPROVAL']),
    );
    this.completionRegistry.registerDecision(
      'LEAVE_APPLICATION',
      (transaction, _context, request, outcome) =>
        this.assertApprovalEffect(
          transaction,
          request,
          outcome === 'REJECTED' ? ['FOR_APPROVAL'] : [...LEAVE_REVIEW_STATUSES],
        ),
    );
  }

  async list(
    context: RequestContext,
    filters: LeaveApplicationListFilters = {},
  ): Promise<LeaveApplicationSummary[]> {
    const scope = this.requireScope(context, 'leave.applications.create');
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const records = await transaction.leaveApplication.findMany({
        where: {
          agencyId: context.agencyId,
          ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
          ...(filters.leaveTypeId ? { draftLeaveTypeId: filters.leaveTypeId } : {}),
          ...(filters.status ? { status: filters.status } : {}),
          ...(scope === 'OWN'
            ? { employee: { memberships: { some: { id: context.membershipId } } } }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: filters.limit ?? 50,
        select: applicationSelect,
      });
      return records.map(applicationSummary);
    });
  }

  async findById(
    context: RequestContext,
    applicationId: string,
  ): Promise<LeaveApplicationDetail | null> {
    const scope = this.requireScope(context, 'leave.applications.create');
    return withDatabaseContext(databaseContext(context), (transaction) =>
      this.detailInTransaction(transaction, context, applicationId, scope),
    );
  }

  async create(
    context: RequestContext,
    input: { employeeId?: string | undefined; leaveTypeId: string },
    rawIdempotencyKey?: string,
  ): Promise<LeaveApplicationDetail> {
    this.assertPermission(
      context,
      'leave.applications.create',
      'LEAVE_APPLICATION_CREATE_FORBIDDEN',
    );
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const fingerprint = canonicalJson({
      command: 'LEAVE_APPLICATION_CREATED',
      employeeId: input.employeeId ?? null,
      leaveTypeId: input.leaveTypeId,
    });
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      if (idempotencyKey) {
        const completed = await this.completedWrite(transaction, context, {
          action: 'LEAVE_APPLICATION_CREATED',
          idempotencyKey,
          fingerprint,
        });
        if (completed) {
          const existingId = metadataString(completed.metadata, 'applicationId');
          const detail = existingId
            ? await this.detailInTransaction(transaction, context, existingId)
            : null;
          if (!detail) throw idempotencyConflict();
          return detail;
        }
      }
      const employee = await this.resolveEmployee(
        transaction,
        context,
        input.employeeId,
        'leave.applications.create',
      );
      const leaveType = await transaction.leaveType.findFirst({
        where: { agencyId: context.agencyId, id: input.leaveTypeId },
        select: { id: true },
      });
      if (!leaveType) throw leaveTypeNotFound();
      const application = await transaction.leaveApplication.create({
        data: {
          agencyId: context.agencyId,
          employeeId: employee.id,
          draftLeaveTypeId: leaveType.id,
          status: 'DRAFT',
          createdByMembershipId: context.membershipId,
        },
        select: { id: true },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'LEAVE_APPLICATION_CREATED',
        entityType: 'LeaveApplication',
        entityId: application.id,
        newStatus: 'DRAFT',
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          fingerprint,
          applicationId: application.id,
          employeeId: employee.id,
          leaveTypeId: leaveType.id,
        },
      });
      return (await this.detailInTransaction(transaction, context, application.id))!;
    });
  }

  async update(
    context: RequestContext,
    applicationId: string,
    input: LeaveApplicationDraftInput,
  ): Promise<LeaveApplicationDetail> {
    this.assertPermission(
      context,
      'leave.applications.create',
      'LEAVE_APPLICATION_CREATE_FORBIDDEN',
    );
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const application = await this.lockApplication(transaction, context.agencyId, applicationId);
      if (!application) throw applicationNotFound();
      this.assertAccess(context, application, 'leave.applications.create');
      if (!['DRAFT', 'NEEDS_INFORMATION'].includes(application.status)) {
        throw workflowError('change draft facts', application.status);
      }
      if (input.leaveTypeId !== undefined) {
        const leaveType = await transaction.leaveType.findFirst({
          where: { agencyId: context.agencyId, id: input.leaveTypeId },
          select: { id: true },
        });
        if (!leaveType) throw leaveTypeNotFound();
      }
      const data: Prisma.LeaveApplicationUncheckedUpdateInput = {};
      if (input.leaveTypeId !== undefined) data.draftLeaveTypeId = input.leaveTypeId;
      if (input.reason !== undefined) data.draftReason = input.reason;
      if (input.policyDetails !== undefined) {
        data.draftPolicyDetails = input.policyDetails as Prisma.InputJsonValue;
      }
      if (input.commutationChoice !== undefined) {
        data.draftCommutationChoice = input.commutationChoice;
      }
      if (input.periods !== undefined) {
        await transaction.leaveApplicationDraftPeriod.deleteMany({
          where: { agencyId: context.agencyId, leaveApplicationId: applicationId },
        });
        await transaction.leaveApplicationDraftPeriod.createMany({
          data: input.periods.map((period, index) => ({
            agencyId: context.agencyId,
            leaveApplicationId: applicationId,
            sequenceNo: index + 1,
            dateFrom: toDatabaseDate(period.dateFrom),
            dateTo: toDatabaseDate(period.dateTo),
          })),
        });
      }
      if (input.documents !== undefined) {
        const resolved = new Map<string, { versionId: string; purposeCode: string }>();
        for (const document of input.documents) {
          const evidence = await this.resolveEvidenceVersion(
            transaction,
            context,
            document.documentId,
          );
          resolved.set(`${evidence.versionId}|${document.purposeCode}`, {
            versionId: evidence.versionId,
            purposeCode: document.purposeCode,
          });
        }
        await transaction.leaveApplicationDraftDocument.deleteMany({
          where: { agencyId: context.agencyId, leaveApplicationId: applicationId },
        });
        if (resolved.size > 0) {
          await transaction.leaveApplicationDraftDocument.createMany({
            data: [...resolved.values()].map((document) => ({
              agencyId: context.agencyId,
              leaveApplicationId: applicationId,
              documentVersionId: document.versionId,
              purposeCode: document.purposeCode,
            })),
            skipDuplicates: true,
          });
        }
      }
      if (Object.keys(data).length > 0) {
        await transaction.leaveApplication.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: applicationId } },
          data,
        });
      }
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'LEAVE_APPLICATION_DRAFT_UPDATED',
        entityType: 'LeaveApplication',
        entityId: applicationId,
        previousStatus: application.status,
        newStatus: application.status,
        requestId: context.requestId,
        metadata: {
          leaveTypeId: input.leaveTypeId ?? null,
          periodCount: input.periods?.length ?? null,
          documentCount: input.documents?.length ?? null,
        },
      });
      return (await this.detailInTransaction(transaction, context, applicationId))!;
    });
  }

  async preview(context: RequestContext, applicationId: string): Promise<LeaveEligibilityOutcome> {
    const scope = this.requireScope(context, 'leave.applications.create');
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const application = await transaction.leaveApplication.findFirst({
        where: { agencyId: context.agencyId, id: applicationId },
        select: applicationSelect,
      });
      if (!application) throw applicationNotFound();
      if (
        scope === 'OWN' &&
        !application.employee.memberships.some(
          (membership) => membership.id === context.membershipId,
        )
      ) {
        throw applicationNotFound();
      }
      return this.evaluateApplication(transaction, context, application);
    });
  }

  async submit(
    context: RequestContext,
    applicationId: string,
    input: LeaveApplicationSubmitInput,
    rawIdempotencyKey?: string,
  ): Promise<LeaveApplicationDetail> {
    this.assertPermission(
      context,
      'leave.applications.submit',
      'LEAVE_APPLICATION_SUBMIT_FORBIDDEN',
    );
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const fingerprint = canonicalJson({
      command: 'LEAVE_APPLICATION_SUBMITTED',
      applicationId,
      ...input,
    });
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      if (idempotencyKey) {
        const completed = await this.completedWrite(transaction, context, {
          action: 'LEAVE_APPLICATION_SUBMITTED',
          entityId: applicationId,
          idempotencyKey,
          fingerprint,
        });
        if (completed) {
          const detail = await this.detailInTransaction(transaction, context, applicationId);
          if (!detail) throw idempotencyConflict();
          return detail;
        }
      }
      const application = await this.lockApplication(transaction, context.agencyId, applicationId);
      if (!application) throw applicationNotFound();
      this.assertAccess(context, application, 'leave.applications.submit');
      if (!['DRAFT', 'NEEDS_INFORMATION'].includes(application.status)) {
        throw workflowError('submit', application.status);
      }

      const periods = await transaction.leaveApplicationDraftPeriod.findMany({
        where: { agencyId: context.agencyId, leaveApplicationId: applicationId },
        orderBy: { sequenceNo: 'asc' },
        select: { sequenceNo: true, dateFrom: true, dateTo: true },
      });
      if (periods.length === 0) {
        throw deficiency(
          'LEAVE_APPLICATION_PERIOD_REQUIRED',
          'Add at least one leave period before submitting.',
        );
      }

      const leaveType = await transaction.leaveType.findFirst({
        where: { agencyId: context.agencyId, id: application.draftLeaveTypeId },
        select: { code: true },
      });
      if (!leaveType) throw leaveTypeNotFound();
      const entry = findLeaveCatalogueEntry(leaveType.code);
      if (!entry) {
        throw deficiency(
          'LEAVE_APPLICATION_LEAVE_TYPE_UNSUPPORTED',
          'The Leave Type has no accepted national catalogue entry.',
        );
      }

      const submissionDate = toDatabaseDate(manilaToday());
      const governingPolicy = await this.effectivePolicyVersion(
        transaction,
        context.agencyId,
        application.draftLeaveTypeId,
        submissionDate,
      );
      if (!governingPolicy) {
        throw deficiency(
          'LEAVE_APPLICATION_POLICY_VERSION_REQUIRED',
          'No effective Leave Policy Version covers the submission date.',
        );
      }

      const draftDocuments = await transaction.leaveApplicationDraftDocument.findMany({
        where: { agencyId: context.agencyId, leaveApplicationId: applicationId },
        select: { documentVersionId: true, purposeCode: true },
      });
      const providedEvidenceKinds = [
        ...new Set(
          draftDocuments
            .map((document) => document.purposeCode.toUpperCase())
            .filter((code) => (LEAVE_EVIDENCE_KINDS as readonly string[]).includes(code)),
        ),
      ];

      const formTemplate = await this.documentsService.resolveFinalizedVersionInTransaction(
        transaction,
        context,
        input.formTemplateDocumentVersionId,
      );
      if (!formTemplate) {
        throw deficiency(
          'LEAVE_APPLICATION_FORM_TEMPLATE_INELIGIBLE',
          'The form template must be an exact finalized Document Version in this Agency.',
        );
      }

      let attestationDocumentVersionId: string | null = null;
      let employeeAttestedAt: Date | null = null;
      let receivedAt = new Date();
      if (input.attestation.type === 'AUTHENTICATED_SUBMISSION') {
        if (
          !application.employee.memberships.some(
            (membership) => membership.id === context.membershipId,
          )
        ) {
          throw new LeaveApplicationServiceError(
            'An authenticated submission must be made by the Employee themself.',
            403,
            'LEAVE_APPLICATION_ATTESTATION_FORBIDDEN',
          );
        }
        employeeAttestedAt = new Date();
      } else {
        if (!this.hasScope(context, 'leave.applications.submit', 'AGENCY')) {
          throw new LeaveApplicationServiceError(
            'Only an Agency recorder may attach an employee signed form.',
            403,
            'LEAVE_APPLICATION_SIGNED_RECORDING_FORBIDDEN',
          );
        }
        const evidence = await this.resolveEvidenceVersion(
          transaction,
          context,
          input.attestation.documentId,
        );
        attestationDocumentVersionId = evidence.versionId;
        receivedAt = toDatabaseInstant(input.attestation.receivedAt);
      }

      const dateFacts = await this.resolveDateFacts(
        transaction,
        context,
        application.employeeId,
        application.draftLeaveTypeId,
        periods,
      );
      const accountAvailableQuantity = await this.accountAvailable(
        transaction,
        context.agencyId,
        application.employeeId,
        governingPolicy,
        submissionDate,
      );
      const outcome = this.evaluateFacts({
        entry,
        policy: governingPolicy,
        policyDetails: application.draftPolicyDetails,
        commutationChoice: application.draftCommutationChoice,
        periods: periods.map(periodSummary),
        dateFacts,
        providedEvidenceKinds,
        accountAvailableQuantity,
      });
      if (
        outcome.result !== 'ELIGIBLE' ||
        outcome.requestedQuantity === null ||
        outcome.segments.length === 0
      ) {
        throw deficiency(
          'LEAVE_APPLICATION_NOT_ELIGIBLE',
          'The Leave Application cannot be submitted until every eligibility input is resolved.',
          outcome.missingFacts.length > 0
            ? outcome.missingFacts.map(({ fact }) => fact)
            : outcome.ruleResults
                .filter(({ outcome: ruleOutcome }) => ruleOutcome === 'FAIL')
                .map(({ rule: ruleName }) => ruleName),
        );
      }

      const routeCodes = [
        ...new Set(
          dateFacts
            .map((fact) => fact.approvalRouteCode)
            .filter((code): code is string => code !== null && code.length > 0),
        ),
      ];
      const routeCode = routeCodes[0]!;
      const route = await this.approvalsService.resolveActiveRouteInTransaction(
        transaction,
        context,
        routeCode,
        formatDate(submissionDate),
      );

      if (
        application.currentVersion &&
        (UNFINISHED_REQUEST_STATUSES as readonly string[]).includes(
          application.currentVersion.approvalRequest.status,
        )
      ) {
        await this.approvalsService.cancelInTransaction(
          transaction,
          context,
          application.currentVersion.approvalRequestId,
          'Superseded by a Leave Application resubmission.',
          idempotencyKey ?? undefined,
        );
      }

      const request = await this.approvalsService.createRequestInTransaction(
        transaction,
        context,
        {
          routeCode,
          subjectType: 'LEAVE_APPLICATION',
          subjectId: applicationId,
          effectiveDate: formatDate(submissionDate),
        },
        idempotencyKey ?? undefined,
        route.id,
      );

      const latest = await transaction.leaveApplicationVersion.findFirst({
        where: { agencyId: context.agencyId, leaveApplicationId: applicationId },
        orderBy: { versionNo: 'desc' },
        select: { versionNo: true },
      });
      const versionNo = (latest?.versionNo ?? 0) + 1;

      const version = await transaction.leaveApplicationVersion.create({
        data: {
          agencyId: context.agencyId,
          leaveApplicationId: applicationId,
          versionNo,
          leaveTypeId: application.draftLeaveTypeId,
          approvalRouteVersionId: route.id,
          approvalRequestId: request.id,
          formTemplateDocumentVersionId: input.formTemplateDocumentVersionId,
          attestationType: input.attestation.type,
          attestationDocumentVersionId,
          submittedByMembershipId: context.membershipId,
          employeeAttestedAt,
          submissionMethod: LEAVE_APPLICATION_SUBMISSION_METHODS[input.attestation.type],
          receivedAt,
          reason: application.draftReason,
          policyDetails: application.draftPolicyDetails as Prisma.InputJsonValue,
          commutationChoice: application.draftCommutationChoice,
        },
        select: { id: true },
      });

      await transaction.leaveApplicationPeriod.createMany({
        data: periods.map((period, index) => ({
          agencyId: context.agencyId,
          leaveApplicationVersionId: version.id,
          sequenceNo: index + 1,
          dateFrom: period.dateFrom,
          dateTo: period.dateTo,
        })),
      });

      const versionDocuments = new Map<
        string,
        { documentVersionId: string; purposeCode: string }
      >();
      for (const document of draftDocuments) {
        versionDocuments.set(`${document.documentVersionId}|${document.purposeCode}`, document);
      }
      versionDocuments.set(`${input.formTemplateDocumentVersionId}|RENDERED_FORM`, {
        documentVersionId: input.formTemplateDocumentVersionId,
        purposeCode: 'RENDERED_FORM',
      });
      if (attestationDocumentVersionId) {
        versionDocuments.set(`${attestationDocumentVersionId}|SIGNED_FORM`, {
          documentVersionId: attestationDocumentVersionId,
          purposeCode: 'SIGNED_FORM',
        });
      }
      await transaction.leaveApplicationVersionDocument.createMany({
        data: [...versionDocuments.values()].map((document) => ({
          agencyId: context.agencyId,
          leaveApplicationVersionId: version.id,
          documentVersionId: document.documentVersionId,
          purposeCode: document.purposeCode,
        })),
        skipDuplicates: true,
      });

      const assessment = await transaction.leaveEligibilityAssessment.create({
        data: {
          agencyId: context.agencyId,
          leaveApplicationVersionId: version.id,
          assessmentNo: 1,
          result: outcome.result,
          inputFacts: outcome.inputFacts as Prisma.InputJsonValue,
          ruleResults: outcome.ruleResults as unknown as Prisma.InputJsonValue,
          missingFacts: outcome.missingFacts as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });

      await transaction.leaveCalculationSegment.createMany({
        data: outcome.segments.map((segment) => ({
          agencyId: context.agencyId,
          leaveApplicationVersionId: version.id,
          eligibilityAssessmentId: assessment.id,
          policyVersionId: segment.policyVersionId,
          scheduleAssignmentId: segment.scheduleAssignmentId,
          holidayFacts: segmentHolidayFacts(segment, dateFacts) as Prisma.InputJsonValue,
          dateFrom: toDatabaseDate(segment.dateFrom),
          dateTo: toDatabaseDate(segment.dateTo),
          requestedQuantity: new Prisma.Decimal(segment.requestedQuantity),
          requestedUnit: segment.requestedUnit,
          accountQuantity:
            segment.accountQuantity === null ? null : new Prisma.Decimal(segment.accountQuantity),
        })),
      });

      await transaction.leaveApplicationVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: version.id } },
        data: { acceptedAssessmentId: assessment.id },
      });
      await transaction.leaveApplication.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: applicationId } },
        data: { currentVersionId: version.id, status: 'SUBMITTED' },
      });

      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'LEAVE_APPLICATION_SUBMITTED',
        entityType: 'LeaveApplication',
        entityId: applicationId,
        previousStatus: application.status,
        newStatus: 'SUBMITTED',
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          fingerprint,
          applicationId,
          versionId: version.id,
          versionNo,
          approvalRequestId: request.id,
          approvalRouteVersionId: route.id,
          approvalRouteCode: routeCode,
          assessmentId: assessment.id,
          result: outcome.result,
          requestedQuantity: outcome.requestedQuantity,
          requestedUnit: outcome.requestedUnit,
        },
      });
      return (await this.detailInTransaction(transaction, context, applicationId))!;
    });
  }

  async withdraw(
    context: RequestContext,
    applicationId: string,
    input: LeaveApplicationWithdrawInput,
    rawIdempotencyKey?: string,
  ): Promise<LeaveApplicationDetail> {
    this.assertPermission(
      context,
      'leave.applications.withdraw',
      'LEAVE_APPLICATION_WITHDRAW_FORBIDDEN',
    );
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const fingerprint = canonicalJson({
      command: 'LEAVE_APPLICATION_WITHDRAWN',
      applicationId,
      ...input,
    });
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      if (idempotencyKey) {
        const completed = await this.completedWrite(transaction, context, {
          action: 'LEAVE_APPLICATION_WITHDRAWN',
          entityId: applicationId,
          idempotencyKey,
          fingerprint,
        });
        if (completed) {
          const detail = await this.detailInTransaction(transaction, context, applicationId);
          if (!detail) throw idempotencyConflict();
          return detail;
        }
      }
      const application = await this.lockApplication(transaction, context.agencyId, applicationId);
      if (!application) throw applicationNotFound();
      this.assertAccess(context, application, 'leave.applications.withdraw');
      if (!(WITHDRAWABLE_STATUSES as readonly string[]).includes(application.status)) {
        throw workflowError('withdraw', application.status);
      }
      const isEmployee = application.employee.memberships.some(
        (membership) => membership.id === context.membershipId,
      );
      let evidenceVersionId: string | null = null;
      if (input.evidenceDocumentId) {
        const evidence = await this.resolveEvidenceVersion(
          transaction,
          context,
          input.evidenceDocumentId,
        );
        evidenceVersionId = evidence.versionId;
      } else if (!isEmployee) {
        throw deficiency(
          'LEAVE_APPLICATION_WITHDRAWAL_EVIDENCE_REQUIRED',
          'An Agency recorder must attach the exact withdrawal evidence.',
        );
      }
      if (application.currentVersionId) {
        if (evidenceVersionId) {
          await transaction.leaveApplicationVersionDocument.createMany({
            data: [
              {
                agencyId: context.agencyId,
                leaveApplicationVersionId: application.currentVersionId,
                documentVersionId: evidenceVersionId,
                purposeCode: 'WITHDRAWAL_EVIDENCE',
              },
            ],
            skipDuplicates: true,
          });
        }
        if (
          application.currentVersion &&
          (UNFINISHED_REQUEST_STATUSES as readonly string[]).includes(
            application.currentVersion.approvalRequest.status,
          )
        ) {
          await this.approvalsService.cancelInTransaction(
            transaction,
            context,
            application.currentVersion.approvalRequestId,
            input.reason,
            idempotencyKey ?? undefined,
          );
        }
        await this.releaseVersionCommitments(
          transaction,
          context.agencyId,
          application.currentVersionId,
        );
      }
      await transaction.leaveApplication.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: applicationId } },
        data: { status: 'WITHDRAWN' },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'LEAVE_APPLICATION_WITHDRAWN',
        entityType: 'LeaveApplication',
        entityId: applicationId,
        previousStatus: application.status,
        newStatus: 'WITHDRAWN',
        reason: input.reason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          fingerprint,
          applicationId,
          versionId: application.currentVersionId,
          evidenceDocumentVersionId: evidenceVersionId,
        },
      });
      return (await this.detailInTransaction(transaction, context, applicationId))!;
    });
  }

  /**
   * The Employee submits the case; the Agency routes it into credit
   * certification by activating the first bound Approval Step. Routing is a
   * separate command so a successful submission never depends on route
   * activation, and a route that does not start with certification fails closed.
   */
  async route(
    context: RequestContext,
    applicationId: string,
    rawIdempotencyKey?: string,
  ): Promise<LeaveApplicationDetail> {
    this.assertPermission(context, 'leave.applications.route', 'LEAVE_APPLICATION_ROUTE_FORBIDDEN');
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const fingerprint = canonicalJson({ command: 'LEAVE_APPLICATION_ROUTED', applicationId });
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      if (idempotencyKey) {
        const completed = await this.completedWrite(transaction, context, {
          action: 'LEAVE_APPLICATION_ROUTED',
          entityId: applicationId,
          idempotencyKey,
          fingerprint,
        });
        if (completed) {
          const detail = await this.detailInTransaction(transaction, context, applicationId);
          if (!detail) throw idempotencyConflict();
          return detail;
        }
      }
      const application = await this.lockApplication(transaction, context.agencyId, applicationId);
      if (!application) throw applicationNotFound();
      if (application.status !== 'SUBMITTED') {
        throw workflowError('send for credit certification', application.status);
      }
      const version = await this.requireVersion(transaction, context.agencyId, application);
      const request = await transaction.approvalRequest.findFirst({
        where: { agencyId: context.agencyId, id: version.approvalRequestId },
        select: {
          id: true,
          status: true,
          currentStepNo: true,
          steps: { orderBy: { stepNo: 'asc' }, select: { stepNo: true, requiredPermission: true } },
        },
      });
      const firstStep = request?.steps.find(({ stepNo }) => stepNo === 1);
      if (
        !request ||
        request.status !== 'PENDING' ||
        firstStep?.requiredPermission !== 'leave.credits.certify'
      ) {
        throw routeInvalid();
      }
      const summary = await this.approvalsService.submitInTransaction(
        transaction,
        context,
        version.approvalRequestId,
        idempotencyKey ?? undefined,
        { requireDrafter: false },
      );
      await transaction.leaveApplication.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: applicationId } },
        data: { status: 'FOR_CERTIFICATION' },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'LEAVE_APPLICATION_ROUTED',
        entityType: 'LeaveApplication',
        entityId: applicationId,
        previousStatus: application.status,
        newStatus: 'FOR_CERTIFICATION',
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          fingerprint,
          applicationId,
          versionId: version.id,
          approvalRequestId: version.approvalRequestId,
          currentStepNo: summary.currentStepNo,
        },
      });
      return (await this.detailInTransaction(transaction, context, applicationId))!;
    });
  }

  /**
   * Certification freezes the account facts the certifier reviewed and raises
   * the Leave Credit Commitments the later approval may narrow. Quantities come
   * from the accepted Leave Eligibility Assessment; balances may be negative and
   * are recorded as facts instead of blocking the flow.
   */
  async certify(
    context: RequestContext,
    applicationId: string,
    input: LeaveApplicationCertificationInput,
    rawIdempotencyKey?: string,
  ): Promise<LeaveApplicationDetail> {
    this.assertPermission(context, 'leave.credits.certify', 'LEAVE_APPLICATION_CERTIFY_FORBIDDEN');
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const fingerprint = canonicalJson({
      command: 'LEAVE_APPLICATION_CERTIFIED',
      applicationId,
      ...input,
    });
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      if (idempotencyKey) {
        const completed = await this.completedWrite(transaction, context, {
          action: 'LEAVE_APPLICATION_CERTIFIED',
          entityId: applicationId,
          idempotencyKey,
          fingerprint,
        });
        if (completed) {
          const detail = await this.detailInTransaction(transaction, context, applicationId);
          if (!detail) throw idempotencyConflict();
          return detail;
        }
      }
      const application = await this.lockApplication(transaction, context.agencyId, applicationId);
      if (!application) throw applicationNotFound();
      if (application.status !== 'FOR_CERTIFICATION') {
        throw workflowError('certify leave credits', application.status);
      }
      const version = await this.requireVersion(transaction, context.agencyId, application);
      this.assertActorSeparation(context, application, version, { prohibitSubject: true });
      const step = await this.requireActiveStep(
        transaction,
        context.agencyId,
        version.approvalRequestId,
        ['leave.credits.certify'],
      );
      if (!version.acceptedAssessmentId) throw assessmentRequired();
      const balanceAsOf = toDatabaseDate(input.balanceAsOf ?? manilaToday());
      const recordedThrough = new Date();
      const charges = await this.segmentAccountCharges(transaction, context, application, version);
      const applicationByAccount = new Map<string, Prisma.Decimal>();
      for (const charge of charges) {
        if (!charge.leaveAccountId) continue;
        applicationByAccount.set(
          charge.leaveAccountId,
          (applicationByAccount.get(charge.leaveAccountId) ?? ZERO).plus(charge.accountQuantity),
        );
      }
      const summary = await this.approvalsService.decideInTransaction(
        transaction,
        context,
        version.approvalRequestId,
        'APPROVE',
        undefined,
        idempotencyKey ?? undefined,
        { kind: LEAVE_APPROVAL_EFFECT_KIND, payload: { command: 'CERTIFY' } },
      );
      const decisionId = stepApprovalDecisionId(summary, step.stepNo, context.membershipId);
      const certification = await transaction.leaveCreditCertification.create({
        data: {
          agencyId: context.agencyId,
          leaveApplicationVersionId: version.id,
          eligibilityAssessmentId: version.acceptedAssessmentId,
          approvalDecisionId: decisionId,
          balanceAsOf,
          ledgerRecordedThrough: recordedThrough,
          certifiedByMembershipId: context.membershipId,
          certifiedAt: recordedThrough,
        },
        select: { id: true },
      });
      for (const [leaveAccountId, applicationQuantity] of applicationByAccount) {
        await this.lockAccount(transaction, context.agencyId, leaveAccountId);
        const balances = await this.accountBalance(
          transaction,
          context.agencyId,
          leaveAccountId,
          balanceAsOf,
          recordedThrough,
        );
        const commitment = await transaction.leaveCreditCommitment.create({
          data: {
            agencyId: context.agencyId,
            leaveAccountId,
            quantity: applicationQuantity,
            sourceType: COMMITMENT_SOURCE_TYPE,
            sourceId: version.id,
            sourceCommitmentKey: CERTIFIED_COMMITMENT_KEY,
            status: 'ACTIVE',
            effectiveFrom: recordedThrough,
          },
          select: { id: true },
        });
        await transaction.leaveCreditCertificationLine.create({
          data: {
            agencyId: context.agencyId,
            leaveCreditCertificationId: certification.id,
            leaveAccountId,
            postedBalance: balances.posted,
            activeCommitments: balances.committed,
            applicationQuantity,
            availableAfterApplication: balances.posted
              .minus(balances.committed)
              .minus(applicationQuantity),
            leaveCreditCommitmentId: commitment.id,
          },
        });
      }
      await transaction.leaveApplication.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: applicationId } },
        data: { status: 'FOR_RECOMMENDATION' },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'LEAVE_APPLICATION_CERTIFIED',
        entityType: 'LeaveApplication',
        entityId: applicationId,
        previousStatus: application.status,
        newStatus: 'FOR_RECOMMENDATION',
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          fingerprint,
          applicationId,
          versionId: version.id,
          assessmentId: version.acceptedAssessmentId,
          decisionId,
          balanceAsOf: formatDate(balanceAsOf),
          ledgerRecordedThrough: formatDateTime(recordedThrough),
          accounts: [...applicationByAccount].map(([leaveAccountId, quantity]) => ({
            leaveAccountId,
            applicationQuantity: formatQuantity(quantity),
          })),
        },
      });
      return (await this.detailInTransaction(transaction, context, applicationId))!;
    });
  }

  async recommend(
    context: RequestContext,
    applicationId: string,
    input: LeaveApplicationRecommendationInput,
    rawIdempotencyKey?: string,
  ): Promise<LeaveApplicationDetail> {
    this.assertPermission(
      context,
      'leave.applications.recommend',
      'LEAVE_APPLICATION_RECOMMEND_FORBIDDEN',
    );
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const fingerprint = canonicalJson({
      command: 'LEAVE_APPLICATION_RECOMMENDED',
      applicationId,
      ...input,
    });
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      if (idempotencyKey) {
        const completed = await this.completedWrite(transaction, context, {
          action: 'LEAVE_APPLICATION_RECOMMENDED',
          entityId: applicationId,
          idempotencyKey,
          fingerprint,
        });
        if (completed) {
          const detail = await this.detailInTransaction(transaction, context, applicationId);
          if (!detail) throw idempotencyConflict();
          return detail;
        }
      }
      const application = await this.lockApplication(transaction, context.agencyId, applicationId);
      if (!application) throw applicationNotFound();
      if (application.status !== 'FOR_RECOMMENDATION') {
        throw workflowError('recommend a decision', application.status);
      }
      const version = await this.requireVersion(transaction, context.agencyId, application);
      this.assertActorSeparation(context, application, version, { prohibitSubject: true });
      await this.requireCertification(transaction, context.agencyId, version);
      const step = await this.requireActiveStep(
        transaction,
        context.agencyId,
        version.approvalRequestId,
        ['leave.applications.recommend'],
      );
      const summary = await this.approvalsService.decideInTransaction(
        transaction,
        context,
        version.approvalRequestId,
        'APPROVE',
        input.comments ?? input.reason,
        idempotencyKey ?? undefined,
        { kind: LEAVE_APPROVAL_EFFECT_KIND, payload: { command: 'RECOMMEND' } },
      );
      const decisionId = stepApprovalDecisionId(summary, step.stepNo, context.membershipId);
      await transaction.leaveRecommendation.create({
        data: {
          agencyId: context.agencyId,
          leaveApplicationVersionId: version.id,
          approvalDecisionId: decisionId,
          outcome: input.outcome,
          reason: input.reason ?? null,
        },
      });
      await transaction.leaveApplication.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: applicationId } },
        data: { status: 'FOR_APPROVAL' },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'LEAVE_APPLICATION_RECOMMENDED',
        entityType: 'LeaveApplication',
        entityId: applicationId,
        previousStatus: application.status,
        newStatus: 'FOR_APPROVAL',
        reason: input.reason ?? null,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          fingerprint,
          applicationId,
          versionId: version.id,
          decisionId,
          outcome: input.outcome,
        },
      });
      return (await this.detailInTransaction(transaction, context, applicationId))!;
    });
  }

  async decide(
    context: RequestContext,
    applicationId: string,
    input: LeaveApplicationDecisionInput,
    rawIdempotencyKey?: string,
  ): Promise<LeaveApplicationDetail> {
    const action = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    this.assertPermission(
      context,
      input.decision === 'APPROVE' ? 'leave.applications.approve' : 'leave.applications.reject',
      `LEAVE_APPLICATION_${action}_FORBIDDEN`,
    );
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const fingerprint = canonicalJson({
      command: `LEAVE_APPLICATION_${action}`,
      applicationId,
      ...input,
    });
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      if (idempotencyKey) {
        const completed = await this.completedWrite(transaction, context, {
          action: `LEAVE_APPLICATION_${action}`,
          entityId: applicationId,
          idempotencyKey,
          fingerprint,
        });
        if (completed) {
          const detail = await this.detailInTransaction(transaction, context, applicationId);
          if (!detail) throw idempotencyConflict();
          return detail;
        }
      }
      const application = await this.lockApplication(transaction, context.agencyId, applicationId);
      if (!application) throw applicationNotFound();
      if (application.status !== 'FOR_APPROVAL') {
        throw workflowError(
          input.decision === 'APPROVE' ? 'approve' : 'reject',
          application.status,
        );
      }
      const version = await this.requireVersion(transaction, context.agencyId, application);
      const certification = await this.requireCertification(transaction, context.agencyId, version);
      this.assertActorSeparation(context, application, version, {
        prohibitSubject: true,
        prohibitSubmitter: true,
        prohibitCertifier: certification.certifiedByMembershipId,
      });
      const recommendation = await transaction.leaveRecommendation.findFirst({
        where: { agencyId: context.agencyId, leaveApplicationVersionId: version.id },
        select: { id: true },
      });
      if (!recommendation) throw recommendationRequired();
      const step = await this.requireActiveStep(
        transaction,
        context.agencyId,
        version.approvalRequestId,
        LEAVE_FINAL_DECISION_PERMISSIONS,
      );
      const charges =
        input.decision === 'APPROVE'
          ? await this.segmentAccountCharges(transaction, context, application, version)
          : [];
      const availableByAccount = new Map(
        certification.lines.map((line) => [
          line.leaveAccountId,
          line.postedBalance.minus(line.activeCommitments),
        ]),
      );
      const plan =
        input.decision === 'APPROVE'
          ? this.buildAllocationPlan(charges, input.allocations, availableByAccount)
          : [];
      const summary = await this.approvalsService.decideInTransaction(
        transaction,
        context,
        version.approvalRequestId,
        input.decision,
        input.comments,
        idempotencyKey ?? undefined,
        { kind: LEAVE_APPROVAL_EFFECT_KIND, payload: { command: input.decision } },
      );
      if (summary.status !== (input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED')) {
        throw routeInvalid();
      }
      const decisionId = stepApprovalDecisionId(summary, step.stepNo, context.membershipId);
      if (input.decision === 'APPROVE') {
        await this.applyApprovedAllocation(transaction, context, version, plan, decisionId);
      } else {
        await this.releaseVersionCommitments(transaction, context.agencyId, version.id);
      }
      await transaction.leaveApplication.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: applicationId } },
        data: { status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED' },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: `LEAVE_APPLICATION_${action}`,
        entityType: 'LeaveApplication',
        entityId: applicationId,
        previousStatus: application.status,
        newStatus: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        reason: input.comments ?? null,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          fingerprint,
          applicationId,
          versionId: version.id,
          decisionId,
          allocationLines:
            input.decision === 'APPROVE'
              ? plan.map((line) => ({
                  segmentId: line.segmentId,
                  allocationKind: line.allocationKind,
                  policyVersionId: line.policyVersionId,
                  leaveAccountId: line.leaveAccountId,
                  quantity: formatQuantity(line.quantity),
                  unitCode: line.unitCode,
                }))
              : [],
        },
      });
      return (await this.detailInTransaction(transaction, context, applicationId))!;
    });
  }

  async returnToApplicant(
    context: RequestContext,
    applicationId: string,
    input: LeaveApplicationReturnInput,
    rawIdempotencyKey?: string,
  ): Promise<LeaveApplicationDetail> {
    this.assertPermission(
      context,
      'leave.applications.return',
      'LEAVE_APPLICATION_RETURN_FORBIDDEN',
    );
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const fingerprint = canonicalJson({
      command: 'LEAVE_APPLICATION_RETURNED',
      applicationId,
      ...input,
    });
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      if (idempotencyKey) {
        const completed = await this.completedWrite(transaction, context, {
          action: 'LEAVE_APPLICATION_RETURNED',
          entityId: applicationId,
          idempotencyKey,
          fingerprint,
        });
        if (completed) {
          const detail = await this.detailInTransaction(transaction, context, applicationId);
          if (!detail) throw idempotencyConflict();
          return detail;
        }
      }
      const application = await this.lockApplication(transaction, context.agencyId, applicationId);
      if (!application) throw applicationNotFound();
      if (!(LEAVE_REVIEW_STATUSES as readonly string[]).includes(application.status)) {
        throw workflowError('return for information', application.status);
      }
      const version = await this.requireVersion(transaction, context.agencyId, application);
      await this.requireActiveStep(
        transaction,
        context.agencyId,
        version.approvalRequestId,
        LEAVE_REVIEW_PERMISSIONS,
      );
      const summary = await this.approvalsService.decideInTransaction(
        transaction,
        context,
        version.approvalRequestId,
        'RETURN',
        input.reason,
        idempotencyKey ?? undefined,
        { kind: LEAVE_APPROVAL_EFFECT_KIND, payload: { command: 'RETURN' } },
      );
      if (summary.status !== 'RETURNED') throw routeInvalid();
      await this.releaseVersionCommitments(transaction, context.agencyId, version.id);
      await transaction.leaveApplication.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: applicationId } },
        data: { status: 'NEEDS_INFORMATION' },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'LEAVE_APPLICATION_RETURNED',
        entityType: 'LeaveApplication',
        entityId: applicationId,
        previousStatus: application.status,
        newStatus: 'NEEDS_INFORMATION',
        reason: input.reason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          fingerprint,
          applicationId,
          versionId: version.id,
        },
      });
      return (await this.detailInTransaction(transaction, context, applicationId))!;
    });
  }

  async appendDocument(
    context: RequestContext,
    applicationId: string,
    input: LeaveApplicationDocumentInput,
  ): Promise<LeaveApplicationDetail> {
    this.assertPermission(
      context,
      'leave.applications.create',
      'LEAVE_APPLICATION_CREATE_FORBIDDEN',
    );
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const application = await this.lockApplication(transaction, context.agencyId, applicationId);
      if (!application) throw applicationNotFound();
      this.assertAccess(context, application, 'leave.applications.create');
      if (!application.currentVersionId) {
        throw workflowError('attach a submitted document', application.status);
      }
      const evidence = await this.resolveEvidenceVersion(transaction, context, input.documentId);
      await transaction.leaveApplicationVersionDocument.createMany({
        data: [
          {
            agencyId: context.agencyId,
            leaveApplicationVersionId: application.currentVersionId,
            documentVersionId: evidence.versionId,
            purposeCode: input.purposeCode,
          },
        ],
        skipDuplicates: true,
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'LEAVE_APPLICATION_DOCUMENT_APPENDED',
        entityType: 'LeaveApplication',
        entityId: applicationId,
        previousStatus: application.status,
        newStatus: application.status,
        requestId: context.requestId,
        metadata: {
          applicationId,
          versionId: application.currentVersionId,
          documentVersionId: evidence.versionId,
          purposeCode: input.purposeCode,
        },
      });
      return (await this.detailInTransaction(transaction, context, applicationId))!;
    });
  }

  private async detailInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    applicationId: string,
    scope?: 'AGENCY' | 'OWN',
  ): Promise<LeaveApplicationDetail | null> {
    const record = await transaction.leaveApplication.findFirst({
      where: { agencyId: context.agencyId, id: applicationId },
      select: applicationSelect,
    });
    if (!record) return null;
    if (
      scope === 'OWN' &&
      !record.employee.memberships.some((membership) => membership.id === context.membershipId)
    ) {
      return null;
    }
    const [draftPeriods, draftDocuments, versions, events] = await Promise.all([
      transaction.leaveApplicationDraftPeriod.findMany({
        where: { agencyId: context.agencyId, leaveApplicationId: applicationId },
        orderBy: { sequenceNo: 'asc' },
        select: draftPeriodSelect,
      }),
      transaction.leaveApplicationDraftDocument.findMany({
        where: { agencyId: context.agencyId, leaveApplicationId: applicationId },
        orderBy: [{ purposeCode: 'asc' }, { id: 'asc' }],
        select: draftDocumentSelect,
      }),
      transaction.leaveApplicationVersion.findMany({
        where: { agencyId: context.agencyId, leaveApplicationId: applicationId },
        orderBy: { versionNo: 'asc' },
        select: versionSelect,
      }),
      transaction.auditEvent.findMany({
        where: {
          agencyId: context.agencyId,
          entityType: 'LeaveApplication',
          entityId: applicationId,
          action: { startsWith: 'LEAVE_APPLICATION_' },
        },
        orderBy: { occurredAt: 'asc' },
        select: {
          id: true,
          action: true,
          previousStatus: true,
          newStatus: true,
          reason: true,
          occurredAt: true,
        },
      }),
    ]);
    const application = applicationSummary(record);
    application.periods = draftPeriods.map(periodSummary);
    return {
      application,
      draftPeriods: draftPeriods.map(periodSummary),
      draftDocuments: draftDocuments.map(documentSummary),
      versions: versions.map(versionSummary),
      history: events.map((event) => ({
        id: event.id,
        action: event.action,
        previousStatus: event.previousStatus,
        newStatus: event.newStatus,
        reason: event.reason,
        occurredAt: formatDateTime(event.occurredAt),
      })),
    };
  }

  private async evaluateApplication(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    application: ApplicationRecord,
  ): Promise<LeaveEligibilityOutcome> {
    const leaveType = await transaction.leaveType.findFirst({
      where: { agencyId: context.agencyId, id: application.draftLeaveTypeId },
      select: { code: true },
    });
    if (!leaveType) throw leaveTypeNotFound();
    const entry = findLeaveCatalogueEntry(leaveType.code);
    if (!entry) {
      throw deficiency(
        'LEAVE_APPLICATION_LEAVE_TYPE_UNSUPPORTED',
        'The Leave Type has no accepted national catalogue entry.',
      );
    }
    const submissionDate = toDatabaseDate(manilaToday());
    const policy = await this.effectivePolicyVersion(
      transaction,
      context.agencyId,
      application.draftLeaveTypeId,
      submissionDate,
    );
    if (!policy) {
      throw deficiency(
        'LEAVE_APPLICATION_POLICY_VERSION_REQUIRED',
        'No effective Leave Policy Version covers the submission date.',
      );
    }
    const periods = await transaction.leaveApplicationDraftPeriod.findMany({
      where: { agencyId: context.agencyId, leaveApplicationId: application.id },
      orderBy: { sequenceNo: 'asc' },
      select: { sequenceNo: true, dateFrom: true, dateTo: true },
    });
    if (periods.length === 0) {
      throw deficiency(
        'LEAVE_APPLICATION_PERIOD_REQUIRED',
        'Add at least one leave period before evaluating eligibility.',
      );
    }
    const draftDocuments = await transaction.leaveApplicationDraftDocument.findMany({
      where: { agencyId: context.agencyId, leaveApplicationId: application.id },
      select: { purposeCode: true },
    });
    const providedEvidenceKinds = [
      ...new Set(
        draftDocuments
          .map((document) => document.purposeCode.toUpperCase())
          .filter((code) => (LEAVE_EVIDENCE_KINDS as readonly string[]).includes(code)),
      ),
    ];
    const dateFacts = await this.resolveDateFacts(
      transaction,
      context,
      application.employeeId,
      application.draftLeaveTypeId,
      periods,
    );
    const accountAvailableQuantity = await this.accountAvailable(
      transaction,
      context.agencyId,
      application.employeeId,
      policy,
      submissionDate,
    );
    return this.evaluateFacts({
      entry,
      policy,
      policyDetails: application.draftPolicyDetails,
      commutationChoice: application.draftCommutationChoice,
      periods: periods.map(periodSummary),
      dateFacts,
      providedEvidenceKinds,
      accountAvailableQuantity,
    });
  }

  private evaluateFacts(input: {
    entry: NonNullable<ReturnType<typeof findLeaveCatalogueEntry>>;
    policy: PolicyVersionRecord;
    policyDetails: Prisma.JsonValue;
    commutationChoice: string | null;
    periods: LeaveApplicationPeriodSummary[];
    dateFacts: LeaveEligibilityDateFact[];
    providedEvidenceKinds: string[];
    accountAvailableQuantity: number | null;
  }): LeaveEligibilityOutcome {
    const parsedParameters = parseLeaveRuleParameters(input.policy.ruleParameters);
    const ruleParameters: LeaveRuleParameters = parsedParameters.success
      ? parsedParameters.data
      : input.entry.ruleParameters;
    const required = readStringArray(input.policy.documentRequirements, 'required') ?? [
      ...input.entry.requiredEvidenceKinds,
    ];
    const additional = readStringArray(input.policy.documentRequirements, 'additional') ?? [];
    const profiles = readStringArray(input.policy.applicabilityRules, 'profiles') ?? [
      ...input.entry.personnelProfiles,
    ];
    const excludedProfiles =
      readStringArray(input.policy.applicabilityRules, 'excludedProfiles') ?? [];
    const policyDetails: { qualifyingEvent?: unknown } =
      input.policyDetails !== null &&
      typeof input.policyDetails === 'object' &&
      !Array.isArray(input.policyDetails)
        ? input.policyDetails
        : {};
    const qualifyingEvent =
      typeof policyDetails.qualifyingEvent === 'string' &&
      (LEAVE_QUALIFYING_EVENTS as readonly string[]).includes(policyDetails.qualifyingEvent)
        ? (policyDetails.qualifyingEvent as LeaveQualifyingEvent)
        : undefined;
    const commutationChoice =
      input.commutationChoice === 'REQUESTED' || input.commutationChoice === 'NOT_REQUESTED'
        ? input.commutationChoice
        : null;
    const authorityCitations: readonly LeaveAuthorityCitation[] = input.entry.authorityCitations;
    const chargesAccount = chargesLeaveAccount(input.policy);
    return evaluateLeaveEligibility({
      leaveTypeCode: input.entry.code,
      evaluatorKind: input.policy.evaluatorKind as LeaveEvaluatorKind,
      entitlementBasis: input.policy.entitlementBasis as LeaveEntitlementBasis,
      calendarBasis: input.policy.calendarBasis as LeaveCalendarBasis,
      ruleParameters,
      applicability: { profiles, excludedProfiles },
      requiredEvidenceKinds: [...new Set([...required, ...additional])],
      providedEvidenceKinds: input.providedEvidenceKinds,
      policyDetails: qualifyingEvent ? { qualifyingEvent } : {},
      commutationChoice,
      periods: input.periods,
      dateFacts: input.dateFacts,
      accountAvailableQuantity: input.accountAvailableQuantity,
      chargesAccount,
      authorityCitations,
    });
  }

  private async resolveDateFacts(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    employeeId: string,
    leaveTypeId: string,
    periods: readonly { dateFrom: Date; dateTo: Date }[],
  ): Promise<LeaveEligibilityDateFact[]> {
    const facts: LeaveEligibilityDateFact[] = [];
    let total = 0;
    for (const period of periods) {
      let date = new Date(period.dateFrom.getTime());
      const end = period.dateTo;
      while (date.getTime() <= end.getTime()) {
        total += 1;
        if (total > MAXIMUM_PERIOD_DATES) {
          throw deficiency(
            'LEAVE_APPLICATION_PERIOD_TOO_LONG',
            'The requested period is longer than this system supports.',
          );
        }
        facts.push(await this.resolveDateFact(transaction, context, employeeId, leaveTypeId, date));
        date = addDays(date, 1);
      }
    }
    return facts;
  }

  private async resolveDateFact(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    employeeId: string,
    leaveTypeId: string,
    date: Date,
  ): Promise<LeaveEligibilityDateFact> {
    const dateString = formatDate(date);
    const policy = await this.effectivePolicyVersion(
      transaction,
      context.agencyId,
      leaveTypeId,
      date,
    );
    if (!policy) {
      return {
        date: dateString,
        policyVersionId: null,
        policyVersionNo: null,
        calendarBasis: null,
        approvalRouteCode: null,
        scheduleAssignmentId: null,
        holidayCalendarVersionId: null,
        ruleType: null,
        requiredMinutes: null,
        nonWorkingHoliday: null,
        holidayEntries: [],
        missing: ['MISSING_POLICY_VERSION'],
      };
    }
    const basis = policy.calendarBasis as LeaveCalendarBasis;
    if (basis === 'CALENDAR_DAY' || basis === 'SOURCE_DEFINED') {
      return {
        date: dateString,
        policyVersionId: policy.id,
        policyVersionNo: policy.versionNo,
        calendarBasis: basis,
        approvalRouteCode: policy.approvalRouteCode,
        scheduleAssignmentId: null,
        holidayCalendarVersionId: null,
        ruleType: null,
        requiredMinutes: null,
        nonWorkingHoliday: null,
        holidayEntries: [],
        missing: [],
      };
    }
    const missing: string[] = [];
    const segment = await transaction.serviceSegment.findFirst({
      where: {
        agencyId: context.agencyId,
        employeeId,
        status: { in: ['ACTIVE', 'CLOSED', 'ENDED'] },
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
      },
      select: { id: true },
    });
    if (!segment) missing.push('MISSING_SERVICE');
    const assignments = await transaction.scheduleAssignment.findMany({
      where: {
        agencyId: context.agencyId,
        employeeId,
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, workScheduleVersionId: true, workArrangementVersionId: true },
    });
    if (assignments.length === 0) missing.push('MISSING_SCHEDULE_ASSIGNMENT');
    if (assignments.length > 1) missing.push('AMBIGUOUS_SCHEDULE_ASSIGNMENT');
    const assignment = assignments[0] ?? null;
    if (!assignment) {
      return {
        date: dateString,
        policyVersionId: policy.id,
        policyVersionNo: policy.versionNo,
        calendarBasis: basis,
        approvalRouteCode: policy.approvalRouteCode,
        scheduleAssignmentId: null,
        holidayCalendarVersionId: null,
        ruleType: null,
        requiredMinutes: null,
        nonWorkingHoliday: null,
        holidayEntries: [],
        missing,
      };
    }
    const workScheduleVersion = await this.workSchedules.findVersionInTransaction(
      transaction,
      context.agencyId,
      assignment.workScheduleVersionId,
      date,
    );
    if (!workScheduleVersion) missing.push('MISSING_WORK_SCHEDULE_VERSION');
    const workArrangementVersion = await this.workArrangements.findVersionInTransaction(
      transaction,
      context.agencyId,
      assignment.workArrangementVersionId,
      date,
    );
    if (!workArrangementVersion) missing.push('MISSING_WORK_ARRANGEMENT_VERSION');
    let holidayCalendarVersionId: string | null = null;
    let holidayEntries: { holidayDate: string; dayType: string }[] = [];
    let nonWorkingHoliday: boolean | null = null;
    let dayRule: { ruleType: string; requiredMinutes: number } | null = null;
    if (workScheduleVersion && workArrangementVersion) {
      if (
        !workArrangementVersion.permittedScheduleTypes.includes(workScheduleVersion.scheduleType)
      ) {
        missing.push('INCOMPATIBLE_SCHEDULE_ARRANGEMENT');
      }
      const candidates = await this.holidayCalendars.findPublishedCandidates(
        transaction,
        context.agencyId,
        workArrangementVersion.holidayCalendarId,
        date,
      );
      if (candidates.length === 0) missing.push('MISSING_HOLIDAY_CALENDAR_VERSION');
      if (candidates.length > 1) missing.push('AMBIGUOUS_HOLIDAY_CALENDAR_VERSION');
      const calendar = candidates[0] ?? null;
      if (calendar) {
        holidayCalendarVersionId = calendar.id;
        holidayEntries = calendar.entries
          .filter((entry) => entry.holidayDate === dateString)
          .map((entry) => ({ holidayDate: entry.holidayDate, dayType: entry.dayType }));
        nonWorkingHoliday = holidayEntries.some((entry) =>
          (NON_WORKING_HOLIDAY_DAY_TYPES as readonly string[]).includes(entry.dayType),
        );
      }
      const matched = workScheduleVersion.dayRules.find(
        (candidate) => candidate.weekday === isoWeekday(date),
      );
      if (matched) {
        dayRule = { ruleType: matched.ruleType, requiredMinutes: matched.requiredMinutes };
      } else {
        missing.push('MISSING_WORK_SCHEDULE_VERSION');
      }
    }
    return {
      date: dateString,
      policyVersionId: policy.id,
      policyVersionNo: policy.versionNo,
      calendarBasis: basis,
      approvalRouteCode: policy.approvalRouteCode,
      scheduleAssignmentId: assignment.id,
      holidayCalendarVersionId,
      ruleType: dayRule ? (dayRule.ruleType as LeaveEligibilityDateFact['ruleType']) : null,
      requiredMinutes: dayRule ? dayRule.requiredMinutes : null,
      nonWorkingHoliday,
      holidayEntries,
      missing,
    };
  }

  private async effectivePolicyVersion(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    leaveTypeId: string,
    effectiveDate: Date,
  ): Promise<PolicyVersionRecord | null> {
    return transaction.leavePolicyVersion.findFirst({
      where: {
        agencyId,
        leaveTypeId,
        status: { in: ['ACTIVE', 'SUPERSEDED'] },
        effectiveFrom: { lte: effectiveDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveDate } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: policyVersionSelect,
    });
  }

  private async accountAvailable(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    policy: PolicyVersionRecord,
    asOf: Date,
  ): Promise<number | null> {
    if (!chargesLeaveAccount(policy)) return null;
    const leaveTypeId = policy.chargedLeaveTypeId ?? policy.leaveTypeId;
    const account = await transaction.leaveAccount.findFirst({
      where: { agencyId, employeeId, leaveTypeId },
      select: { id: true },
    });
    if (!account) return null;
    const [ledger, commitments] = await Promise.all([
      transaction.leaveLedgerEntry.aggregate({
        where: { agencyId, leaveAccountId: account.id, effectiveDate: { lte: asOf } },
        _sum: { quantity: true },
      }),
      transaction.leaveCreditCommitment.aggregate({
        where: {
          agencyId,
          leaveAccountId: account.id,
          effectiveFrom: { lte: asOf },
          OR: [{ endedAt: null }, { endedAt: { gt: asOf } }],
        },
        _sum: { quantity: true },
      }),
    ]);
    const posted = ledger._sum.quantity ?? ZERO;
    const committed = commitments._sum.quantity ?? ZERO;
    return Number(posted.minus(committed));
  }

  private async resolveEmployee(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    employeeId: string | undefined,
    permission: string,
  ) {
    if (employeeId) {
      if (!this.hasScope(context, permission, 'AGENCY')) {
        throw new LeaveApplicationServiceError(
          'Only an Agency recorder may prepare a Leave Application for another Employee.',
          403,
          'LEAVE_APPLICATION_EMPLOYEE_SCOPE_FORBIDDEN',
        );
      }
      const employee = await transaction.employee.findFirst({
        where: { agencyId: context.agencyId, id: employeeId },
        select: { id: true },
      });
      if (!employee) throw employeeNotFound();
      return employee;
    }
    const employee = await transaction.employee.findFirst({
      where: {
        agencyId: context.agencyId,
        memberships: { some: { id: context.membershipId } },
      },
      select: { id: true },
    });
    if (!employee) {
      throw new LeaveApplicationServiceError(
        'The active membership has no Employee record to file leave for.',
        403,
        'LEAVE_APPLICATION_EMPLOYEE_REQUIRED',
      );
    }
    return employee;
  }

  private async resolveEvidenceVersion(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    documentId: string,
  ): Promise<{ documentId: string; versionId: string }> {
    const evidence = await this.documentsService.resolveExternalEvidenceInTransaction(
      transaction,
      context,
      { documentId, allowSensitive: false, requirement: 'FINALIZED_VERSION' },
    );
    if (!evidence.ok) {
      throw new LeaveApplicationServiceError(
        'The evidence must be an exact finalized Document Version in this Agency.',
        400,
        'LEAVE_APPLICATION_EVIDENCE_INELIGIBLE',
        [evidence.reason],
      );
    }
    const versionId = evidence.document.currentVersion!.id;
    if (!hasPermission(context, 'documents.evidence.read')) {
      const owned = await this.documentsService.isVersionCreatedByMembershipInTransaction(
        transaction,
        context,
        evidence.document.id,
        versionId,
        context.membershipId,
      );
      if (!owned) {
        throw new LeaveApplicationServiceError(
          'Link a document version you uploaded, or ask an administrator to attach it.',
          403,
          'LEAVE_APPLICATION_EVIDENCE_SCOPE_FORBIDDEN',
        );
      }
    }
    return { documentId: evidence.document.id, versionId };
  }

  /**
   * Domain decisions always run through the Leave Application service. When the
   * generic approvals API reaches a Leave Application step it must fail closed:
   * the service forwards its own `effectContext`, and a decision without it
   * never changes the case.
   */
  private async assertApprovalEffect(
    transaction: Prisma.TransactionClient,
    request: ApprovalCompletionRequest,
    allowedStatuses: readonly string[],
  ): Promise<void> {
    if (request.effectContext?.kind !== LEAVE_APPROVAL_EFFECT_KIND) {
      throw new LeaveApplicationServiceError(
        'Leave Application decisions must be recorded through the Leave Application authority.',
        409,
        'LEAVE_APPLICATION_APPROVAL_EFFECT_REQUIRED',
      );
    }
    const application = await transaction.leaveApplication.findFirst({
      where: { agencyId: request.agencyId, id: request.subjectId },
      select: {
        status: true,
        currentVersion: { select: { approvalRequestId: true } },
      },
    });
    if (
      !application ||
      !allowedStatuses.includes(application.status) ||
      application.currentVersion?.approvalRequestId !== request.approvalRequestId
    ) {
      throw routeInvalid();
    }
  }

  private async requireVersion(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    application: ApplicationRecord,
  ): Promise<VersionRecord> {
    if (!application.currentVersionId) {
      throw deficiency(
        'LEAVE_APPLICATION_VERSION_REQUIRED',
        'The Leave Application has no submitted version to review.',
      );
    }
    const version = await transaction.leaveApplicationVersion.findFirst({
      where: { agencyId, id: application.currentVersionId },
      select: versionSelect,
    });
    if (!version) throw applicationNotFound();
    return version;
  }

  private assertActorSeparation(
    context: RequestContext,
    application: ApplicationRecord,
    version: VersionRecord,
    options: {
      prohibitSubject?: boolean;
      prohibitSubmitter?: boolean;
      prohibitCertifier?: string | null;
    },
  ): void {
    const separationError = () =>
      new LeaveApplicationServiceError(
        'A person may not review their own Leave Application; route it to another authorized reviewer.',
        403,
        'LEAVE_APPLICATION_SEPARATION_REQUIRED',
      );
    if (
      options.prohibitSubject &&
      application.employee.memberships.some((membership) => membership.id === context.membershipId)
    ) {
      throw separationError();
    }
    if (options.prohibitSubmitter && version.submittedByMembershipId === context.membershipId) {
      throw separationError();
    }
    if (options.prohibitCertifier && options.prohibitCertifier === context.membershipId) {
      throw separationError();
    }
  }

  /**
   * The bound Approval Route decides who may act. A step whose permission set
   * does not match the command fails closed instead of adapting.
   */
  private async requireActiveStep(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    approvalRequestId: string,
    expectedPermissions: readonly string[],
  ): Promise<{ stepNo: number }> {
    const request = await transaction.approvalRequest.findFirst({
      where: { agencyId, id: approvalRequestId },
      select: {
        status: true,
        steps: {
          where: { status: 'ACTIVE' },
          orderBy: { stepNo: 'asc' },
          select: { stepNo: true, requiredPermission: true },
        },
      },
    });
    const step = request?.steps[0];
    if (
      !request ||
      request.status !== 'IN_PROGRESS' ||
      !step ||
      !expectedPermissions.includes(step.requiredPermission)
    ) {
      throw routeInvalid();
    }
    return { stepNo: step.stepNo };
  }

  /**
   * Quantities are frozen in the accepted assessment. Certification and
   * approval only read them back and map each segment to the Leave Account its
   * policy charges, failing closed when a charged account is missing or closed.
   */
  private async segmentAccountCharges(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    application: ApplicationRecord,
    version: VersionRecord,
  ): Promise<LeaveSegmentAccountCharge[]> {
    const policyIds = [
      ...new Set(version.calculationSegments.map(({ policyVersionId }) => policyVersionId)),
    ];
    const policies = await transaction.leavePolicyVersion.findMany({
      where: { agencyId: context.agencyId, id: { in: policyIds } },
      select: policyVersionSelect,
    });
    const policyById = new Map(policies.map((policy) => [policy.id, policy]));
    const chargedTypeIds = new Set<string>();
    for (const segment of version.calculationSegments) {
      const policy = policyById.get(segment.policyVersionId);
      if (!policy) {
        throw deficiency(
          'LEAVE_APPLICATION_POLICY_VERSION_REQUIRED',
          'A calculation segment has no Leave Policy Version to charge.',
        );
      }
      if (segment.accountQuantity !== null && chargesLeaveAccount(policy)) {
        chargedTypeIds.add(policy.chargedLeaveTypeId ?? policy.leaveTypeId);
      }
    }
    const accounts =
      chargedTypeIds.size === 0
        ? []
        : await transaction.leaveAccount.findMany({
            where: {
              agencyId: context.agencyId,
              employeeId: application.employeeId,
              leaveTypeId: { in: [...chargedTypeIds] },
            },
            select: { id: true, leaveTypeId: true, status: true },
          });
    const accountByType = new Map(accounts.map((account) => [account.leaveTypeId, account]));
    return version.calculationSegments.map((segment) => {
      const policy = policyById.get(segment.policyVersionId)!;
      const base = {
        segmentId: segment.id,
        policyVersionId: policy.id,
        dateFrom: segment.dateFrom,
        dateTo: segment.dateTo,
        requestedQuantity: segment.requestedQuantity,
        requestedUnit: segment.requestedUnit,
        allocationKinds: permittedAllocationKinds(policy),
      };
      if (segment.accountQuantity === null || !chargesLeaveAccount(policy)) {
        return { ...base, leaveAccountId: null, accountQuantity: ZERO };
      }
      const account = accountByType.get(policy.chargedLeaveTypeId ?? policy.leaveTypeId);
      if (!account) {
        throw deficiency(
          'LEAVE_APPLICATION_ACCOUNT_REQUIRED',
          'The Employee has no Leave Account for a leave type charged by this application.',
        );
      }
      if (account.status !== 'ACTIVE') {
        throw deficiency(
          'LEAVE_APPLICATION_ACCOUNT_INACTIVE',
          `The charged Leave Account is ${account.status}.`,
        );
      }
      return { ...base, leaveAccountId: account.id, accountQuantity: segment.accountQuantity };
    });
  }

  private async requireCertification(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    version: VersionRecord,
  ) {
    const certification = await transaction.leaveCreditCertification.findFirst({
      where: { agencyId, leaveApplicationVersionId: version.id },
      select: {
        id: true,
        eligibilityAssessmentId: true,
        certifiedByMembershipId: true,
        lines: {
          orderBy: { id: 'asc' },
          select: {
            leaveAccountId: true,
            postedBalance: true,
            activeCommitments: true,
            applicationQuantity: true,
            leaveCreditCommitmentId: true,
          },
        },
      },
    });
    if (!certification || certification.eligibilityAssessmentId !== version.acceptedAssessmentId) {
      throw recertificationRequired();
    }
    for (const line of certification.lines) {
      const account = await transaction.leaveAccount.findFirst({
        where: { agencyId, id: line.leaveAccountId },
        select: { status: true },
      });
      if (!account || account.status !== 'ACTIVE') throw recertificationRequired();
      let commitmentId: string | null = line.leaveCreditCommitmentId;
      let commitment: { id: string; status: string } | null = null;
      for (let hops = 0; commitmentId && hops < 20; hops += 1) {
        commitment = await transaction.leaveCreditCommitment.findFirst({
          where: { agencyId, id: commitmentId },
          select: { id: true, status: true },
        });
        if (!commitment || commitment.status !== 'RELEASED') break;
        commitmentId =
          (
            await transaction.leaveCreditCommitment.findFirst({
              where: { agencyId, succeedsCommitmentId: commitmentId },
              select: { id: true },
            })
          )?.id ?? null;
      }
      if (!commitment || commitment.status !== 'ACTIVE') throw recertificationRequired();
    }
    return certification;
  }

  /**
   * The bound Leave Policy Version decides every allocation kind, so a decision
   * only chooses how much of each segment to approve. A charging policy keeps
   * the approved quantity its certified account can cover and classifies the
   * uncovered excess as leave without pay (MC41 s.50); a paid policy outside
   * the ledger approves non-credit leave, and an unpaid policy approves leave
   * without pay. Charging a different account than the bound policy does, or
   * converting covered credits to unpaid leave, would rewrite the request and
   * requires a successor version and recertification instead.
   */
  private buildAllocationPlan(
    charges: LeaveSegmentAccountCharge[],
    allocations: LeaveApplicationDecisionInput['allocations'],
    availableByAccount: Map<string, Prisma.Decimal>,
  ): LeaveAllocationPlanLine[] {
    const approvedBySegment = new Map<string, Prisma.Decimal>();
    if (allocations === undefined) {
      for (const charge of charges) {
        approvedBySegment.set(charge.segmentId, charge.requestedQuantity);
      }
    } else {
      const chargeBySegment = new Map(charges.map((charge) => [charge.segmentId, charge]));
      for (const input of allocations) {
        const charge = chargeBySegment.get(input.segmentId);
        if (!charge || approvedBySegment.has(input.segmentId)) {
          throw allocationInvalid(
            'A decision line references a segment outside the submitted version.',
          );
        }
        const quantity =
          input.quantity === undefined ? charge.requestedQuantity : parseQuantity(input.quantity);
        if (quantity.lessThanOrEqualTo(0) || quantity.greaterThan(charge.requestedQuantity)) {
          throw allocationInvalid('An approved quantity must fit within the segment requested.');
        }
        approvedBySegment.set(input.segmentId, quantity);
      }
    }
    const accountGroups = new Map<string, LeaveSegmentAccountCharge[]>();
    for (const charge of charges) {
      if (charge.leaveAccountId === null) continue;
      const group = accountGroups.get(charge.leaveAccountId) ?? [];
      group.push(charge);
      accountGroups.set(charge.leaveAccountId, group);
    }
    const chargedBudgetByAccount = new Map<string, Prisma.Decimal>();
    for (const [leaveAccountId, group] of accountGroups) {
      const available = availableByAccount.get(leaveAccountId);
      if (!available) throw recertificationRequired();
      const coverable = available.lessThan(0) ? ZERO : available;
      let approvedTotal = ZERO;
      for (const charge of group) {
        approvedTotal = approvedTotal.plus(approvedBySegment.get(charge.segmentId) ?? ZERO);
      }
      chargedBudgetByAccount.set(
        leaveAccountId,
        approvedTotal.lessThan(coverable) ? approvedTotal : coverable,
      );
    }
    const lines: LeaveAllocationPlanLine[] = [];
    const emit = (
      charge: LeaveSegmentAccountCharge,
      allocationKind: LeaveApprovalAllocationKind,
      leaveAccountId: string | null,
      quantity: Prisma.Decimal,
    ): void => {
      lines.push({
        sequenceNo: lines.length + 1,
        segmentId: charge.segmentId,
        policyVersionId: charge.policyVersionId,
        dateFrom: charge.dateFrom,
        dateTo: charge.dateTo,
        allocationKind,
        leaveAccountId,
        quantity,
        unitCode: charge.requestedUnit,
      });
    };
    for (const charge of charges) {
      const approved = approvedBySegment.get(charge.segmentId) ?? ZERO;
      if (approved.lessThanOrEqualTo(0)) continue;
      if (charge.leaveAccountId === null) {
        emit(charge, charge.allocationKinds[0]!, null, approved);
        continue;
      }
      const budget = chargedBudgetByAccount.get(charge.leaveAccountId)!;
      const charged = approved.lessThan(budget) ? approved : budget;
      chargedBudgetByAccount.set(charge.leaveAccountId, budget.minus(charged));
      if (charged.greaterThan(0)) {
        emit(charge, 'LEAVE_ACCOUNT', charge.leaveAccountId, charged);
      }
      const uncovered = approved.minus(charged);
      if (uncovered.greaterThan(0)) {
        emit(charge, 'LEAVE_WITHOUT_PAY', null, uncovered);
      }
    }
    if (lines.length === 0) throw allocationInvalid('An approval must allocate at least one line.');
    return lines;
  }

  private async applyApprovedAllocation(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    version: VersionRecord,
    plan: LeaveAllocationPlanLine[],
    decisionId: string,
  ): Promise<void> {
    const certification = await transaction.leaveCreditCertification.findFirst({
      where: { agencyId: context.agencyId, leaveApplicationVersionId: version.id },
      select: {
        id: true,
        lines: {
          orderBy: { id: 'asc' },
          select: {
            leaveAccountId: true,
            applicationQuantity: true,
            leaveCreditCommitmentId: true,
          },
        },
      },
    });
    if (!certification) throw recertificationRequired();
    const now = new Date();
    const allocation = await transaction.leaveApprovalAllocation.create({
      data: {
        agencyId: context.agencyId,
        leaveApplicationVersionId: version.id,
        approvalDecisionId: decisionId,
        decidedAt: now,
      },
      select: { id: true },
    });
    await transaction.leaveApprovalAllocationLine.createMany({
      data: plan.map((line) => ({
        agencyId: context.agencyId,
        leaveApprovalAllocationId: allocation.id,
        sequenceNo: line.sequenceNo,
        dateFrom: line.dateFrom,
        dateTo: line.dateTo,
        allocationKind: line.allocationKind,
        policyVersionId: line.policyVersionId,
        leaveAccountId: line.leaveAccountId,
        quantity: line.quantity,
        unitCode: line.unitCode,
      })),
    });
    const approvedByAccount = new Map<string, Prisma.Decimal>();
    for (const line of plan) {
      if (line.allocationKind !== 'LEAVE_ACCOUNT' || !line.leaveAccountId) continue;
      approvedByAccount.set(
        line.leaveAccountId,
        (approvedByAccount.get(line.leaveAccountId) ?? ZERO).plus(line.quantity),
      );
    }
    for (const line of certification.lines) {
      const approved = approvedByAccount.get(line.leaveAccountId) ?? ZERO;
      if (approved.greaterThan(line.applicationQuantity)) throw recertificationRequired();
      if (approved.equals(line.applicationQuantity)) continue;
      await transaction.leaveCreditCommitment.update({
        where: {
          agencyId_id: {
            agencyId: context.agencyId,
            id: line.leaveCreditCommitmentId,
          },
        },
        data: { status: 'RELEASED', endedAt: now },
      });
      if (approved.greaterThan(0)) {
        await transaction.leaveCreditCommitment.create({
          data: {
            agencyId: context.agencyId,
            leaveAccountId: line.leaveAccountId,
            quantity: approved,
            sourceType: COMMITMENT_SOURCE_TYPE,
            sourceId: version.id,
            sourceCommitmentKey: APPROVED_COMMITMENT_KEY,
            succeedsCommitmentId: line.leaveCreditCommitmentId,
            status: 'ACTIVE',
            effectiveFrom: now,
          },
        });
      }
    }
  }

  private async releaseVersionCommitments(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    versionId: string,
  ): Promise<void> {
    await transaction.leaveCreditCommitment.updateMany({
      where: {
        agencyId,
        sourceType: COMMITMENT_SOURCE_TYPE,
        sourceId: versionId,
        status: 'ACTIVE',
      },
      data: { status: 'RELEASED', endedAt: new Date() },
    });
  }

  private async lockAccount(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    leaveAccountId: string,
  ): Promise<void> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "leave_accounts" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${leaveAccountId} AS uuid) FOR UPDATE`,
    );
  }

  /**
   * The posted balance is an effective-dated fact, so it is read as of the
   * requested balance date and the ledger knowledge cutoff. Commitments are
   * reservations made at an instant, so "other active commitments" are read as
   * of the same knowledge cutoff; a commitment raised earlier the same day
   * still counts. The caller reads before creating this certification's own
   * commitment, which is therefore never part of the sum.
   */
  private async accountBalance(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    leaveAccountId: string,
    balanceAsOf: Date,
    recordedThrough: Date,
  ): Promise<{ posted: Prisma.Decimal; committed: Prisma.Decimal }> {
    const [ledger, commitments] = await Promise.all([
      transaction.leaveLedgerEntry.aggregate({
        where: {
          agencyId,
          leaveAccountId,
          effectiveDate: { lte: balanceAsOf },
          postedAt: { lte: recordedThrough },
        },
        _sum: { quantity: true },
      }),
      transaction.leaveCreditCommitment.aggregate({
        where: {
          agencyId,
          leaveAccountId,
          status: 'ACTIVE',
          effectiveFrom: { lte: recordedThrough },
          OR: [{ endedAt: null }, { endedAt: { gt: recordedThrough } }],
        },
        _sum: { quantity: true },
      }),
    ]);
    return {
      posted: ledger._sum.quantity ?? ZERO,
      committed: commitments._sum.quantity ?? ZERO,
    };
  }

  private async lockApplication(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    applicationId: string,
  ): Promise<ApplicationRecord | null> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "leave_applications" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${applicationId} AS uuid) FOR UPDATE`,
    );
    return transaction.leaveApplication.findFirst({
      where: { agencyId, id: applicationId },
      select: applicationSelect,
    });
  }

  private async completedWrite(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: {
      action: string;
      entityId?: string | undefined;
      idempotencyKey: string;
      fingerprint: string;
    },
  ): Promise<{ metadata: Prisma.JsonValue } | null> {
    const completed = await transaction.auditEvent.findFirst({
      where: {
        agencyId: context.agencyId,
        action: input.action,
        ...(input.entityId ? { entityId: input.entityId } : {}),
        idempotencyKey: input.idempotencyKey,
      },
      select: { metadata: true },
    });
    if (!completed) return null;
    if (metadataString(completed.metadata, 'fingerprint') !== input.fingerprint) {
      throw idempotencyConflict();
    }
    return completed;
  }

  private requireScope(context: RequestContext, permission: string): 'AGENCY' | 'OWN' {
    if (this.hasScope(context, permission, 'AGENCY')) return 'AGENCY';
    if (this.hasScope(context, permission, 'OWN')) return 'OWN';
    throw new LeaveApplicationServiceError(
      `The ${permission} permission is required.`,
      403,
      'LEAVE_APPLICATION_FORBIDDEN',
    );
  }

  private hasScope(context: RequestContext, permission: string, scope: 'AGENCY' | 'OWN'): boolean {
    return context.permissions.some(
      (grant) => grant.code === permission && grant.scopePolicy === scope,
    );
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (!hasPermission(context, permission)) {
      throw new LeaveApplicationServiceError(
        `The ${permission} permission is required.`,
        403,
        code,
      );
    }
  }

  private assertAccess(
    context: RequestContext,
    record: ApplicationRecord,
    permission: string,
  ): void {
    if (this.hasScope(context, permission, 'AGENCY')) return;
    if (
      this.hasScope(context, permission, 'OWN') &&
      record.employee.memberships.some((membership) => membership.id === context.membershipId)
    ) {
      return;
    }
    throw new LeaveApplicationServiceError(
      `The ${permission} permission is required for this Leave Application.`,
      403,
      'LEAVE_APPLICATION_FORBIDDEN',
    );
  }
}

function segmentHolidayFacts(
  segment: { holidayCalendarVersionId: string | null; dateFrom: string; dateTo: string },
  dateFacts: readonly LeaveEligibilityDateFact[],
): {
  holidayCalendarVersionId: string | null;
  entries: { holidayDate: string; dayType: string }[];
} {
  const entries = dateFacts
    .filter(
      (fact) =>
        fact.date >= segment.dateFrom &&
        fact.date <= segment.dateTo &&
        fact.holidayCalendarVersionId === segment.holidayCalendarVersionId,
    )
    .flatMap((fact) => fact.holidayEntries);
  const unique = [
    ...new Map(entries.map((entry) => [`${entry.holidayDate}:${entry.dayType}`, entry])).values(),
  ];
  return { holidayCalendarVersionId: segment.holidayCalendarVersionId, entries: unique };
}
