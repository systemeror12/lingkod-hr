import type { Prisma } from '@prisma/client';
import type {
  MandatoryLeaveAgencyEvaluation,
  MandatoryLeaveAssessmentDetail,
  MandatoryLeaveAssessmentPage,
  MandatoryLeaveAssessmentSummary,
  MandatoryLeaveEmployeeLatestPage,
} from './mandatory-leave-assessments.service';

export class MandatoryLeaveAssessmentDto {
  readonly id: string;
  readonly agencyId: string;
  readonly employeeId: string;
  readonly employeeNumber: string;
  readonly employeeName: string;
  readonly assessmentYear: number;
  readonly assessmentDate: string;
  readonly result: MandatoryLeaveAssessmentSummary['result'];
  readonly requiredQuantity: string | null;
  readonly fulfilledQuantity: string | null;
  readonly policyVersionId: string | null;
  readonly leaveAccountId: string | null;
  readonly previousAssessmentId: string | null;
  readonly isLatest: boolean;
  readonly assessedAt: string;

  constructor(assessment: MandatoryLeaveAssessmentSummary) {
    this.id = assessment.id;
    this.agencyId = assessment.agencyId;
    this.employeeId = assessment.employeeId;
    this.employeeNumber = assessment.employeeNumber;
    this.employeeName = assessment.employeeName;
    this.assessmentYear = assessment.assessmentYear;
    this.assessmentDate = assessment.assessmentDate;
    this.result = assessment.result;
    this.requiredQuantity = assessment.requiredQuantity;
    this.fulfilledQuantity = assessment.fulfilledQuantity;
    this.policyVersionId = assessment.policyVersionId;
    this.leaveAccountId = assessment.leaveAccountId;
    this.previousAssessmentId = assessment.previousAssessmentId;
    this.isLatest = assessment.isLatest;
    this.assessedAt = assessment.assessedAt;
  }
}

export class MandatoryLeaveAssessmentDetailDto extends MandatoryLeaveAssessmentDto {
  readonly materialFingerprint: string;
  readonly inputFacts: Prisma.JsonValue;
  readonly ruleResults: Prisma.JsonValue;

  constructor(assessment: MandatoryLeaveAssessmentDetail) {
    super(assessment);
    this.materialFingerprint = assessment.materialFingerprint;
    this.inputFacts = assessment.inputFacts;
    this.ruleResults = assessment.ruleResults;
  }
}

export class MandatoryLeaveAssessmentListResponseDto {
  readonly assessments: MandatoryLeaveAssessmentDto[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;

  constructor(page: MandatoryLeaveAssessmentPage) {
    this.assessments = page.items.map((assessment) => new MandatoryLeaveAssessmentDto(assessment));
    this.nextCursor = page.nextCursor;
    this.hasMore = page.hasMore;
  }
}

export class MandatoryLeaveEmployeeLatestDto {
  readonly employeeId: string;
  readonly employeeNumber: string;
  readonly employeeName: string;
  readonly assessment: MandatoryLeaveAssessmentDto | null;

  constructor(row: MandatoryLeaveEmployeeLatestPage['items'][number]) {
    this.employeeId = row.employeeId;
    this.employeeNumber = row.employeeNumber;
    this.employeeName = row.employeeName;
    this.assessment = row.assessment ? new MandatoryLeaveAssessmentDto(row.assessment) : null;
  }
}

export class MandatoryLeaveEmployeeLatestResponseDto {
  readonly assessmentYear: number;
  readonly employees: MandatoryLeaveEmployeeLatestDto[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;

  constructor(page: MandatoryLeaveEmployeeLatestPage) {
    this.assessmentYear = page.assessmentYear;
    this.employees = page.items.map((row) => new MandatoryLeaveEmployeeLatestDto(row));
    this.nextCursor = page.nextCursor;
    this.hasMore = page.hasMore;
  }
}

export class MandatoryLeaveAgencyEvaluationDto {
  readonly assessmentYear: number;
  readonly assessmentDate: string;
  readonly employeeCount: number;
  readonly recordedCount: number;
  readonly unchangedCount: number;
  readonly results: MandatoryLeaveAgencyEvaluation['results'];

  constructor(evaluation: MandatoryLeaveAgencyEvaluation) {
    this.assessmentYear = evaluation.assessmentYear;
    this.assessmentDate = evaluation.assessmentDate;
    this.employeeCount = evaluation.employeeCount;
    this.recordedCount = evaluation.recordedCount;
    this.unchangedCount = evaluation.unchangedCount;
    this.results = { ...evaluation.results };
  }
}
