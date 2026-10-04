import type { Prisma } from '@prisma/client';
import type {
  TerminalLeaveInputAssessmentDetail,
  TerminalLeaveInputAssessmentSummary,
  TerminalLeaveInputCandidate,
  TerminalLeaveInputFactFinding,
  TerminalLeaveInputHandoffOutcomeSummary,
  TerminalLeaveInputSnapshotDetail,
  TerminalLeaveInputSnapshotLineSummary,
} from './terminal-leave-inputs.service';

export class TerminalLeaveInputFactFindingDto {
  readonly code: string;
  readonly sourceType: string;
  readonly sourceId: string | null;
  readonly detail: string | null;

  constructor(finding: TerminalLeaveInputFactFinding) {
    this.code = finding.code;
    this.sourceType = finding.sourceType;
    this.sourceId = finding.sourceId;
    this.detail = finding.detail;
  }
}

export class TerminalLeaveInputAssessmentDto {
  readonly id: string;
  readonly agencyId: string;
  readonly employeeId: string;
  readonly employeeNumber: string;
  readonly employeeName: string;
  readonly separationSourceType: string;
  readonly separationSourceId: string;
  readonly separationSourceVersionKey: string;
  readonly separationClassification: string;
  readonly separationEffectiveDate: string;
  readonly ledgerCutoff: string;
  readonly result: TerminalLeaveInputAssessmentSummary['result'];
  readonly inputFacts: Prisma.JsonValue;
  readonly missingOrConflictingFacts: TerminalLeaveInputFactFindingDto[];
  readonly assessedByMembershipId: string;
  readonly assessedByName: string | null;
  readonly assessedAt: string;
  readonly snapshotId: string | null;
  readonly snapshotKey: string | null;
  readonly supersedesSnapshotId: string | null;

  constructor(assessment: TerminalLeaveInputAssessmentSummary) {
    this.id = assessment.id;
    this.agencyId = assessment.agencyId;
    this.employeeId = assessment.employeeId;
    this.employeeNumber = assessment.employeeNumber;
    this.employeeName = assessment.employeeName;
    this.separationSourceType = assessment.separationSourceType;
    this.separationSourceId = assessment.separationSourceId;
    this.separationSourceVersionKey = assessment.separationSourceVersionKey;
    this.separationClassification = assessment.separationClassification;
    this.separationEffectiveDate = assessment.separationEffectiveDate;
    this.ledgerCutoff = assessment.ledgerCutoff;
    this.result = assessment.result;
    this.inputFacts = assessment.inputFacts;
    this.missingOrConflictingFacts = assessment.missingOrConflictingFacts.map(
      (finding) => new TerminalLeaveInputFactFindingDto(finding),
    );
    this.assessedByMembershipId = assessment.assessedByMembershipId;
    this.assessedByName = assessment.assessedByName;
    this.assessedAt = assessment.assessedAt;
    this.snapshotId = assessment.snapshotId;
    this.snapshotKey = assessment.snapshotKey;
    this.supersedesSnapshotId = assessment.supersedesSnapshotId;
  }
}

export class TerminalLeaveInputAssessmentListResponseDto {
  readonly assessments: TerminalLeaveInputAssessmentDto[];

  constructor(assessments: TerminalLeaveInputAssessmentSummary[]) {
    this.assessments = assessments.map(
      (assessment) => new TerminalLeaveInputAssessmentDto(assessment),
    );
  }
}

export class TerminalLeaveInputSnapshotLineDto {
  readonly leaveAccountId: string;
  readonly leaveTypeId: string;
  readonly leaveTypeCode: string;
  readonly leaveTypeName: string;
  readonly policyVersionId: string;
  readonly policyVersionNo: number;
  readonly balanceEffectiveDate: string;
  readonly ledgerCutoff: string;
  readonly postedBalance: string;

  constructor(line: TerminalLeaveInputSnapshotLineSummary) {
    this.leaveAccountId = line.leaveAccountId;
    this.leaveTypeId = line.leaveTypeId;
    this.leaveTypeCode = line.leaveTypeCode;
    this.leaveTypeName = line.leaveTypeName;
    this.policyVersionId = line.policyVersionId;
    this.policyVersionNo = line.policyVersionNo;
    this.balanceEffectiveDate = line.balanceEffectiveDate;
    this.ledgerCutoff = line.ledgerCutoff;
    this.postedBalance = line.postedBalance;
  }
}

export class TerminalLeaveInputHandoffOutcomeDto {
  readonly id: string;
  readonly attemptKey: string;
  readonly result: TerminalLeaveInputHandoffOutcomeSummary['result'];
  readonly separationReference: Prisma.JsonValue;
  readonly reason: Prisma.JsonValue;
  readonly recordedAt: string;

  constructor(outcome: TerminalLeaveInputHandoffOutcomeSummary) {
    this.id = outcome.id;
    this.attemptKey = outcome.attemptKey;
    this.result = outcome.result;
    this.separationReference = outcome.separationReference;
    this.reason = outcome.reason;
    this.recordedAt = outcome.recordedAt;
  }
}

export class TerminalLeaveInputSnapshotDto {
  readonly id: string;
  readonly snapshotKey: string;
  readonly supersedesSnapshotId: string | null;
  readonly createdAt: string;
  readonly serviceSourceSnapshot: Prisma.JsonValue;
  readonly authoritySnapshot: Prisma.JsonValue;
  readonly clearanceDocumentSnapshot: Prisma.JsonValue;
  readonly salarySourceReference: Prisma.JsonValue;
  readonly lines: TerminalLeaveInputSnapshotLineDto[];
  readonly outcomes: TerminalLeaveInputHandoffOutcomeDto[];

  constructor(snapshot: TerminalLeaveInputSnapshotDetail) {
    this.id = snapshot.id;
    this.snapshotKey = snapshot.snapshotKey;
    this.supersedesSnapshotId = snapshot.supersedesSnapshotId;
    this.createdAt = snapshot.createdAt;
    this.serviceSourceSnapshot = snapshot.serviceSourceSnapshot;
    this.authoritySnapshot = snapshot.authoritySnapshot;
    this.clearanceDocumentSnapshot = snapshot.clearanceDocumentSnapshot;
    this.salarySourceReference = snapshot.salarySourceReference;
    this.lines = snapshot.lines.map((line) => new TerminalLeaveInputSnapshotLineDto(line));
    this.outcomes = snapshot.outcomes.map(
      (outcome) => new TerminalLeaveInputHandoffOutcomeDto(outcome),
    );
  }
}

export class TerminalLeaveInputAssessmentDetailDto {
  readonly assessment: TerminalLeaveInputAssessmentDto;
  readonly snapshot: TerminalLeaveInputSnapshotDto | null;

  constructor(detail: TerminalLeaveInputAssessmentDetail) {
    this.assessment = new TerminalLeaveInputAssessmentDto(detail.assessment);
    this.snapshot = detail.snapshot ? new TerminalLeaveInputSnapshotDto(detail.snapshot) : null;
  }
}

export class TerminalLeaveInputCandidateDto {
  readonly separationCaseId: string;
  readonly employeeId: string;
  readonly employeeNumber: string;
  readonly employeeName: string;
  readonly separationType: string;
  readonly separationEffectiveDate: string;
  readonly effectuatedAt: string;
  readonly hasReadySnapshot: boolean;

  constructor(candidate: TerminalLeaveInputCandidate) {
    this.separationCaseId = candidate.separationCaseId;
    this.employeeId = candidate.employeeId;
    this.employeeNumber = candidate.employeeNumber;
    this.employeeName = candidate.employeeName;
    this.separationType = candidate.separationType;
    this.separationEffectiveDate = candidate.separationEffectiveDate;
    this.effectuatedAt = candidate.effectuatedAt;
    this.hasReadySnapshot = candidate.hasReadySnapshot;
  }
}

export class TerminalLeaveInputCandidateListResponseDto {
  readonly candidates: TerminalLeaveInputCandidateDto[];

  constructor(candidates: TerminalLeaveInputCandidate[]) {
    this.candidates = candidates.map((candidate) => new TerminalLeaveInputCandidateDto(candidate));
  }
}
