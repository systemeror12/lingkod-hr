import type {
  LeaveApplicationAssessmentSummary,
  LeaveApplicationDetail,
  LeaveApplicationDocumentSummary,
  LeaveApplicationHistoryEntry,
  LeaveApplicationPeriodSummary,
  LeaveApplicationSummary,
  LeaveApplicationVersionSummary,
  LeaveApprovalAllocationLineSummary,
  LeaveApprovalAllocationSummary,
  LeaveApprovalDecisionSummary,
  LeaveApprovalStepSummary,
  LeaveCalculationSegmentSummary,
  LeaveCreditCertificationLineSummary,
  LeaveCreditCertificationSummary,
  LeaveRecommendationSummary,
} from './leave-applications.service';
import type { LeaveEligibilityOutcome } from './leave-eligibility';

export class LeaveApplicationPeriodDto {
  readonly sequenceNo: number;
  readonly dateFrom: string;
  readonly dateTo: string;

  constructor(period: LeaveApplicationPeriodSummary) {
    this.sequenceNo = period.sequenceNo;
    this.dateFrom = period.dateFrom;
    this.dateTo = period.dateTo;
  }
}

export class LeaveApplicationDocumentDto {
  readonly id: string;
  readonly documentVersionId: string;
  readonly purposeCode: string;
  readonly documentNo: string | null;
  readonly documentType: string | null;
  readonly versionNo: number | null;

  constructor(document: LeaveApplicationDocumentSummary) {
    this.id = document.id;
    this.documentVersionId = document.documentVersionId;
    this.purposeCode = document.purposeCode;
    this.documentNo = document.documentNo;
    this.documentType = document.documentType;
    this.versionNo = document.versionNo;
  }
}

export class LeaveApplicationAssessmentDto {
  readonly id: string;
  readonly assessmentNo: number;
  readonly result: string;
  readonly inputFacts: unknown;
  readonly ruleResults: unknown;
  readonly missingFacts: unknown;
  readonly assessedAt: string;

  constructor(assessment: LeaveApplicationAssessmentSummary) {
    this.id = assessment.id;
    this.assessmentNo = assessment.assessmentNo;
    this.result = assessment.result;
    this.inputFacts = assessment.inputFacts;
    this.ruleResults = assessment.ruleResults;
    this.missingFacts = assessment.missingFacts;
    this.assessedAt = assessment.assessedAt;
  }
}

export class LeaveCalculationSegmentDto {
  readonly id: string;
  readonly policyVersionId: string;
  readonly scheduleAssignmentId: string | null;
  readonly holidayFacts: unknown;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly requestedQuantity: string;
  readonly requestedUnit: string;
  readonly accountQuantity: string | null;
  readonly allocationKinds: string[];

  constructor(segment: LeaveCalculationSegmentSummary) {
    this.id = segment.id;
    this.policyVersionId = segment.policyVersionId;
    this.scheduleAssignmentId = segment.scheduleAssignmentId;
    this.holidayFacts = segment.holidayFacts;
    this.dateFrom = segment.dateFrom;
    this.dateTo = segment.dateTo;
    this.requestedQuantity = segment.requestedQuantity;
    this.requestedUnit = segment.requestedUnit;
    this.accountQuantity = segment.accountQuantity;
    this.allocationKinds = segment.allocationKinds;
  }
}

export class LeaveCreditCertificationLineDto {
  readonly id: string;
  readonly leaveAccountId: string;
  readonly leaveTypeCode: string;
  readonly leaveTypeName: string;
  readonly postedBalance: string;
  readonly activeCommitments: string;
  readonly applicationQuantity: string;
  readonly availableAfterApplication: string;
  readonly leaveCreditCommitmentId: string;

  constructor(line: LeaveCreditCertificationLineSummary) {
    this.id = line.id;
    this.leaveAccountId = line.leaveAccountId;
    this.leaveTypeCode = line.leaveTypeCode;
    this.leaveTypeName = line.leaveTypeName;
    this.postedBalance = line.postedBalance;
    this.activeCommitments = line.activeCommitments;
    this.applicationQuantity = line.applicationQuantity;
    this.availableAfterApplication = line.availableAfterApplication;
    this.leaveCreditCommitmentId = line.leaveCreditCommitmentId;
  }
}

export class LeaveCreditCertificationDto {
  readonly id: string;
  readonly eligibilityAssessmentId: string;
  readonly approvalDecisionId: string;
  readonly balanceAsOf: string;
  readonly ledgerRecordedThrough: string;
  readonly certifiedByMembershipId: string;
  readonly certifiedByName: string | null;
  readonly certifiedAt: string;
  readonly lines: LeaveCreditCertificationLineDto[];

  constructor(certification: LeaveCreditCertificationSummary) {
    this.id = certification.id;
    this.eligibilityAssessmentId = certification.eligibilityAssessmentId;
    this.approvalDecisionId = certification.approvalDecisionId;
    this.balanceAsOf = certification.balanceAsOf;
    this.ledgerRecordedThrough = certification.ledgerRecordedThrough;
    this.certifiedByMembershipId = certification.certifiedByMembershipId;
    this.certifiedByName = certification.certifiedByName;
    this.certifiedAt = certification.certifiedAt;
    this.lines = certification.lines.map((line) => new LeaveCreditCertificationLineDto(line));
  }
}

export class LeaveRecommendationDto {
  readonly id: string;
  readonly approvalDecisionId: string;
  readonly outcome: string;
  readonly reason: string | null;
  readonly recommendedAt: string;

  constructor(recommendation: LeaveRecommendationSummary) {
    this.id = recommendation.id;
    this.approvalDecisionId = recommendation.approvalDecisionId;
    this.outcome = recommendation.outcome;
    this.reason = recommendation.reason;
    this.recommendedAt = recommendation.recommendedAt;
  }
}

export class LeaveApprovalAllocationLineDto {
  readonly id: string;
  readonly sequenceNo: number;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly allocationKind: string;
  readonly policyVersionId: string;
  readonly leaveAccountId: string | null;
  readonly quantity: string;
  readonly unitCode: string;

  constructor(line: LeaveApprovalAllocationLineSummary) {
    this.id = line.id;
    this.sequenceNo = line.sequenceNo;
    this.dateFrom = line.dateFrom;
    this.dateTo = line.dateTo;
    this.allocationKind = line.allocationKind;
    this.policyVersionId = line.policyVersionId;
    this.leaveAccountId = line.leaveAccountId;
    this.quantity = line.quantity;
    this.unitCode = line.unitCode;
  }
}

export class LeaveApprovalAllocationDto {
  readonly id: string;
  readonly approvalDecisionId: string;
  readonly decidedAt: string;
  readonly lines: LeaveApprovalAllocationLineDto[];

  constructor(allocation: LeaveApprovalAllocationSummary) {
    this.id = allocation.id;
    this.approvalDecisionId = allocation.approvalDecisionId;
    this.decidedAt = allocation.decidedAt;
    this.lines = allocation.lines.map((line) => new LeaveApprovalAllocationLineDto(line));
  }
}

export class LeaveApprovalDecisionDto {
  readonly id: string;
  readonly decidedByMembershipId: string;
  readonly decidedByName: string | null;
  readonly decision: string;
  readonly comments: string | null;
  readonly decidedAt: string;

  constructor(decision: LeaveApprovalDecisionSummary) {
    this.id = decision.id;
    this.decidedByMembershipId = decision.decidedByMembershipId;
    this.decidedByName = decision.decidedByName;
    this.decision = decision.decision;
    this.comments = decision.comments;
    this.decidedAt = decision.decidedAt;
  }
}

export class LeaveApprovalStepDto {
  readonly id: string;
  readonly stepNo: number;
  readonly status: string;
  readonly requiredPermission: string;
  readonly approvePermission: string;
  readonly returnPermission: string;
  readonly rejectPermission: string;
  readonly assignedRoleCode: string | null;
  readonly assignedMembershipId: string | null;
  readonly requiresSeparateReview: boolean;
  readonly activatedAt: string | null;
  readonly completedAt: string | null;
  readonly decisions: LeaveApprovalDecisionDto[];

  constructor(step: LeaveApprovalStepSummary) {
    this.id = step.id;
    this.stepNo = step.stepNo;
    this.status = step.status;
    this.requiredPermission = step.requiredPermission;
    this.approvePermission = step.approvePermission;
    this.returnPermission = step.returnPermission;
    this.rejectPermission = step.rejectPermission;
    this.assignedRoleCode = step.assignedRoleCode;
    this.assignedMembershipId = step.assignedMembershipId;
    this.requiresSeparateReview = step.requiresSeparateReview;
    this.activatedAt = step.activatedAt;
    this.completedAt = step.completedAt;
    this.decisions = step.decisions.map((decision) => new LeaveApprovalDecisionDto(decision));
  }
}

export class LeaveApplicationVersionDto {
  readonly id: string;
  readonly versionNo: number;
  readonly leaveTypeId: string;
  readonly leaveTypeCode: string;
  readonly leaveTypeName: string;
  readonly acceptedAssessmentId: string | null;
  readonly approvalRouteVersionId: string;
  readonly approvalRouteCode: string;
  readonly approvalRequestId: string;
  readonly approvalRequestStatus: string;
  readonly formTemplateDocumentVersionId: string;
  readonly attestationType: string;
  readonly attestationDocumentVersionId: string | null;
  readonly submittedByMembershipId: string;
  readonly submittedByName: string | null;
  readonly employeeAttestedAt: string | null;
  readonly submissionMethod: string;
  readonly receivedAt: string;
  readonly reason: string | null;
  readonly policyDetails: unknown;
  readonly commutationChoice: string | null;
  readonly submittedAt: string;
  readonly periods: LeaveApplicationPeriodDto[];
  readonly documents: LeaveApplicationDocumentDto[];
  readonly assessments: LeaveApplicationAssessmentDto[];
  readonly calculationSegments: LeaveCalculationSegmentDto[];
  readonly certification: LeaveCreditCertificationDto | null;
  readonly recommendation: LeaveRecommendationDto | null;
  readonly approvalAllocation: LeaveApprovalAllocationDto | null;
  readonly approvalSteps: LeaveApprovalStepDto[];

  constructor(version: LeaveApplicationVersionSummary) {
    this.id = version.id;
    this.versionNo = version.versionNo;
    this.leaveTypeId = version.leaveTypeId;
    this.leaveTypeCode = version.leaveTypeCode;
    this.leaveTypeName = version.leaveTypeName;
    this.acceptedAssessmentId = version.acceptedAssessmentId;
    this.approvalRouteVersionId = version.approvalRouteVersionId;
    this.approvalRouteCode = version.approvalRouteCode;
    this.approvalRequestId = version.approvalRequestId;
    this.approvalRequestStatus = version.approvalRequestStatus;
    this.formTemplateDocumentVersionId = version.formTemplateDocumentVersionId;
    this.attestationType = version.attestationType;
    this.attestationDocumentVersionId = version.attestationDocumentVersionId;
    this.submittedByMembershipId = version.submittedByMembershipId;
    this.submittedByName = version.submittedByName;
    this.employeeAttestedAt = version.employeeAttestedAt;
    this.submissionMethod = version.submissionMethod;
    this.receivedAt = version.receivedAt;
    this.reason = version.reason;
    this.policyDetails = version.policyDetails;
    this.commutationChoice = version.commutationChoice;
    this.submittedAt = version.submittedAt;
    this.periods = version.periods.map((period) => new LeaveApplicationPeriodDto(period));
    this.documents = version.documents.map((document) => new LeaveApplicationDocumentDto(document));
    this.assessments = version.assessments.map(
      (assessment) => new LeaveApplicationAssessmentDto(assessment),
    );
    this.calculationSegments = version.calculationSegments.map(
      (segment) => new LeaveCalculationSegmentDto(segment),
    );
    this.certification = version.certification
      ? new LeaveCreditCertificationDto(version.certification)
      : null;
    this.recommendation = version.recommendation
      ? new LeaveRecommendationDto(version.recommendation)
      : null;
    this.approvalAllocation = version.approvalAllocation
      ? new LeaveApprovalAllocationDto(version.approvalAllocation)
      : null;
    this.approvalSteps = version.approvalSteps.map((step) => new LeaveApprovalStepDto(step));
  }
}

export class LeaveApplicationDto {
  readonly id: string;
  readonly agencyId: string;
  readonly employeeId: string;
  readonly employeeNumber: string;
  readonly employeeName: string;
  readonly leaveTypeId: string;
  readonly leaveTypeCode: string;
  readonly leaveTypeName: string;
  readonly status: string;
  readonly currentVersionId: string | null;
  readonly currentVersionNo: number | null;
  readonly reason: string | null;
  readonly policyDetails: unknown;
  readonly commutationChoice: string | null;
  readonly periods: LeaveApplicationPeriodDto[];
  readonly submittedAt: string | null;
  readonly createdAt: string;

  constructor(application: LeaveApplicationSummary) {
    this.id = application.id;
    this.agencyId = application.agencyId;
    this.employeeId = application.employeeId;
    this.employeeNumber = application.employeeNumber;
    this.employeeName = application.employeeName;
    this.leaveTypeId = application.leaveTypeId;
    this.leaveTypeCode = application.leaveTypeCode;
    this.leaveTypeName = application.leaveTypeName;
    this.status = application.status;
    this.currentVersionId = application.currentVersionId;
    this.currentVersionNo = application.currentVersionNo;
    this.reason = application.reason;
    this.policyDetails = application.policyDetails;
    this.commutationChoice = application.commutationChoice;
    this.periods = application.periods.map((period) => new LeaveApplicationPeriodDto(period));
    this.submittedAt = application.submittedAt;
    this.createdAt = application.createdAt;
  }
}

export class LeaveApplicationHistoryDto {
  readonly id: string;
  readonly action: string;
  readonly previousStatus: string | null;
  readonly newStatus: string | null;
  readonly reason: string | null;
  readonly occurredAt: string;

  constructor(entry: LeaveApplicationHistoryEntry) {
    this.id = entry.id;
    this.action = entry.action;
    this.previousStatus = entry.previousStatus;
    this.newStatus = entry.newStatus;
    this.reason = entry.reason;
    this.occurredAt = entry.occurredAt;
  }
}

export class LeaveApplicationDetailDto {
  readonly application: LeaveApplicationDto;
  readonly draftPeriods: LeaveApplicationPeriodDto[];
  readonly draftDocuments: LeaveApplicationDocumentDto[];
  readonly versions: LeaveApplicationVersionDto[];
  readonly history: LeaveApplicationHistoryDto[];

  constructor(detail: LeaveApplicationDetail) {
    this.application = new LeaveApplicationDto(detail.application);
    this.draftPeriods = detail.draftPeriods.map((period) => new LeaveApplicationPeriodDto(period));
    this.draftDocuments = detail.draftDocuments.map(
      (document) => new LeaveApplicationDocumentDto(document),
    );
    this.versions = detail.versions.map((version) => new LeaveApplicationVersionDto(version));
    this.history = detail.history.map((entry) => new LeaveApplicationHistoryDto(entry));
  }
}

export class LeaveApplicationListResponseDto {
  readonly applications: LeaveApplicationDto[];

  constructor(applications: LeaveApplicationSummary[]) {
    this.applications = applications.map((application) => new LeaveApplicationDto(application));
  }
}

export class LeaveEligibilityOutcomeDto {
  readonly result: LeaveEligibilityOutcome['result'];
  readonly ruleResults: LeaveEligibilityOutcome['ruleResults'];
  readonly missingFacts: LeaveEligibilityOutcome['missingFacts'];
  readonly inputFacts: unknown;
  readonly segments: LeaveEligibilityOutcome['segments'];
  readonly requestedQuantity: number | null;
  readonly requestedUnit: string;

  constructor(outcome: LeaveEligibilityOutcome) {
    this.result = outcome.result;
    this.ruleResults = outcome.ruleResults;
    this.missingFacts = outcome.missingFacts;
    this.inputFacts = outcome.inputFacts;
    this.segments = outcome.segments;
    this.requestedQuantity = outcome.requestedQuantity;
    this.requestedUnit = outcome.requestedUnit;
  }
}
