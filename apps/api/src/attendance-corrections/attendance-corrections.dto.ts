import type {
  AttendanceCorrectionApprovalSummary,
  AttendanceCorrectionDetail,
  AttendanceCorrectionEffectSummary,
  AttendanceCorrectionEvidenceSummary,
  AttendanceCorrectionImpactPreview,
  AttendanceCorrectionImpactPreviewDay,
  AttendanceCorrectionImpactPreviewPeriod,
  AttendanceCorrectionLockedAdjustmentSummary,
  AttendanceCorrectionSummary,
} from './attendance-corrections.types';

export class AttendanceCorrectionEmployeeDto {
  readonly id: string;
  readonly employeeNumber: string;
  readonly legalName: string;

  constructor(employee: AttendanceCorrectionSummary['employee']) {
    this.id = employee.id;
    this.employeeNumber = employee.employeeNumber;
    this.legalName = employee.legalName;
  }
}

export class AttendanceCorrectionDto {
  readonly id: string;
  readonly agencyId: string;
  readonly employee: AttendanceCorrectionEmployeeDto;
  readonly initiatedByMembershipId: string;
  readonly recordedByMembershipId: string;
  readonly targetType: AttendanceCorrectionSummary['targetType'];
  readonly requestedAction: AttendanceCorrectionSummary['requestedAction'];
  readonly targetId: string | null;
  readonly requestedRecord: AttendanceCorrectionSummary['requestedRecord'];
  readonly status: AttendanceCorrectionSummary['status'];
  readonly reason: string;
  readonly approvalRouteVersionId: string;
  readonly submittedAt: string | null;
  readonly decidedByMembershipId: string | null;
  readonly decidedAt: string | null;
  readonly decisionReason: string | null;
  readonly authorizedByMembershipId: string | null;
  readonly authorizedAt: string | null;
  readonly appliedByMembershipId: string | null;
  readonly appliedAt: string | null;
  readonly excludedDeciderMembershipIds: string[];
  readonly blockingReason: string | null;
  readonly blockedByMembershipId: string | null;
  readonly blockedAt: string | null;
  readonly createdAt: string;

  constructor(record: AttendanceCorrectionSummary) {
    this.id = record.id;
    this.agencyId = record.agencyId;
    this.employee = new AttendanceCorrectionEmployeeDto(record.employee);
    this.initiatedByMembershipId = record.initiatedByMembershipId;
    this.recordedByMembershipId = record.recordedByMembershipId;
    this.targetType = record.targetType;
    this.requestedAction = record.requestedAction;
    this.targetId = record.targetId;
    this.requestedRecord = record.requestedRecord;
    this.status = record.status;
    this.reason = record.reason;
    this.approvalRouteVersionId = record.approvalRouteVersionId;
    this.submittedAt = record.submittedAt;
    this.decidedByMembershipId = record.decidedByMembershipId;
    this.decidedAt = record.decidedAt;
    this.decisionReason = record.decisionReason;
    this.authorizedByMembershipId = record.authorizedByMembershipId;
    this.authorizedAt = record.authorizedAt;
    this.appliedByMembershipId = record.appliedByMembershipId;
    this.appliedAt = record.appliedAt;
    this.excludedDeciderMembershipIds = record.excludedDeciderMembershipIds;
    this.blockingReason = record.blockingReason;
    this.blockedByMembershipId = record.blockedByMembershipId;
    this.blockedAt = record.blockedAt;
    this.createdAt = record.createdAt;
  }
}

export class AttendanceCorrectionEffectDto {
  readonly id: string;
  readonly effectAction: AttendanceCorrectionEffectSummary['effectAction'];
  readonly targetType: AttendanceCorrectionEffectSummary['targetType'];
  readonly originalTargetId: string | null;
  readonly replacementRecord: AttendanceCorrectionEffectSummary['replacementRecord'];
  readonly appliedByMembershipId: string;
  readonly appliedAt: string;

  constructor(record: AttendanceCorrectionEffectSummary) {
    this.id = record.id;
    this.effectAction = record.effectAction;
    this.targetType = record.targetType;
    this.originalTargetId = record.originalTargetId;
    this.replacementRecord = record.replacementRecord;
    this.appliedByMembershipId = record.appliedByMembershipId;
    this.appliedAt = record.appliedAt;
  }
}

export class AttendanceCorrectionLockedAdjustmentPeriodDto {
  readonly predecessorPeriodVersionId: string;
  readonly successorPeriodVersionId: string;

  constructor(record: AttendanceCorrectionLockedAdjustmentSummary['periods'][number]) {
    this.predecessorPeriodVersionId = record.predecessorPeriodVersionId;
    this.successorPeriodVersionId = record.successorPeriodVersionId;
  }
}

export class AttendanceCorrectionLockedAdjustmentDto {
  readonly id: string;
  readonly authorizedByMembershipId: string;
  readonly authorizedAt: string;
  readonly periods: AttendanceCorrectionLockedAdjustmentPeriodDto[];

  constructor(record: AttendanceCorrectionLockedAdjustmentSummary) {
    this.id = record.id;
    this.authorizedByMembershipId = record.authorizedByMembershipId;
    this.authorizedAt = record.authorizedAt;
    this.periods = record.periods.map(
      (period) => new AttendanceCorrectionLockedAdjustmentPeriodDto(period),
    );
  }
}

export class AttendanceCorrectionApprovalDto {
  readonly approvalRequestId: string;
  readonly routeVersionId: string;
  readonly status: string;
  readonly currentStepNo: number | null;

  constructor(record: AttendanceCorrectionApprovalSummary) {
    this.approvalRequestId = record.approvalRequestId;
    this.routeVersionId = record.routeVersionId;
    this.status = record.status;
    this.currentStepNo = record.currentStepNo;
  }
}

export class AttendanceCorrectionImpactPreviewDayDto {
  readonly employeeId: string;
  readonly workDate: string;
  readonly attendanceDayId: string | null;
  readonly calculationVersion: number | null;
  readonly status: string | null;
  readonly attendancePeriodId: string;
  readonly periodCode: string;
  readonly periodStatus: string;
  readonly lockedPeriodVersionId: string | null;

  constructor(record: AttendanceCorrectionImpactPreviewDay) {
    this.employeeId = record.employeeId;
    this.workDate = record.workDate;
    this.attendanceDayId = record.attendanceDayId;
    this.calculationVersion = record.calculationVersion;
    this.status = record.status;
    this.attendancePeriodId = record.attendancePeriodId;
    this.periodCode = record.periodCode;
    this.periodStatus = record.periodStatus;
    this.lockedPeriodVersionId = record.lockedPeriodVersionId;
  }
}

export class AttendanceCorrectionImpactPreviewPeriodDto {
  readonly id: string;
  readonly code: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly status: string;

  constructor(record: AttendanceCorrectionImpactPreviewPeriod) {
    this.id = record.id;
    this.code = record.code;
    this.dateFrom = record.dateFrom;
    this.dateTo = record.dateTo;
    this.status = record.status;
  }
}

export class AttendanceCorrectionImpactPreviewDto {
  readonly computedAt: string;
  readonly targetType: AttendanceCorrectionImpactPreview['targetType'];
  readonly requestedAction: AttendanceCorrectionImpactPreview['requestedAction'];
  readonly targetWorkDates: string[];
  readonly proposedWorkDates: string[];
  readonly days: AttendanceCorrectionImpactPreviewDayDto[];
  readonly periods: AttendanceCorrectionImpactPreviewPeriodDto[];
  readonly lockedPeriodVersionIds: string[];
  readonly fingerprint: string;

  constructor(record: AttendanceCorrectionImpactPreview) {
    this.computedAt = record.computedAt;
    this.targetType = record.targetType;
    this.requestedAction = record.requestedAction;
    this.targetWorkDates = record.targetWorkDates;
    this.proposedWorkDates = record.proposedWorkDates;
    this.days = record.days.map((day) => new AttendanceCorrectionImpactPreviewDayDto(day));
    this.periods = record.periods.map(
      (period) => new AttendanceCorrectionImpactPreviewPeriodDto(period),
    );
    this.lockedPeriodVersionIds = record.lockedPeriodVersionIds;
    this.fingerprint = record.fingerprint;
  }
}

export class AttendanceCorrectionDetailDto {
  readonly correction: AttendanceCorrectionDto;
  readonly impactPreview: AttendanceCorrectionImpactPreviewDto;
  readonly evidence: AttendanceCorrectionEvidenceSummary[];
  readonly effect: AttendanceCorrectionEffectDto | null;
  readonly lockedAdjustment: AttendanceCorrectionLockedAdjustmentDto | null;
  readonly approval: AttendanceCorrectionApprovalDto | null;

  constructor(record: AttendanceCorrectionDetail) {
    this.correction = new AttendanceCorrectionDto(record.correction);
    this.impactPreview = new AttendanceCorrectionImpactPreviewDto(record.impactPreview);
    this.evidence = record.evidence.map((row) => ({ ...row }));
    this.effect = record.effect ? new AttendanceCorrectionEffectDto(record.effect) : null;
    this.lockedAdjustment = record.lockedAdjustment
      ? new AttendanceCorrectionLockedAdjustmentDto(record.lockedAdjustment)
      : null;
    this.approval = record.approval ? new AttendanceCorrectionApprovalDto(record.approval) : null;
  }
}

export class AttendanceCorrectionListResponseDto {
  readonly corrections: AttendanceCorrectionDto[];

  constructor(records: AttendanceCorrectionSummary[]) {
    this.corrections = records.map((record) => new AttendanceCorrectionDto(record));
  }
}
