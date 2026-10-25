import type {
  AttendancePayrollFactSummary,
  AttendancePayrollPublicationDetail,
  AttendancePayrollPublicationSummary,
  AttendancePeriodLockResult,
  AttendancePeriodReconciliation,
  AttendancePeriodVersionDetail,
  AttendancePeriodVersionSummary,
} from './attendance-periods.types';

export class AttendancePeriodDto {
  readonly id: string;
  readonly code: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly status: string;

  constructor(period: AttendancePeriodVersionSummary['period']) {
    this.id = period.id;
    this.code = period.code;
    this.dateFrom = period.dateFrom;
    this.dateTo = period.dateTo;
    this.status = period.status;
  }
}

export class AttendancePayrollPublicationDto {
  readonly id: string;
  readonly attendancePeriodVersionId: string;
  readonly predecessorPublicationId: string | null;
  readonly publicationType: string;
  readonly idempotencyKey: string;
  readonly publishedAt: string;
  readonly factCount: number;
  readonly factMinutes: number;

  constructor(publication: AttendancePayrollPublicationSummary) {
    this.id = publication.id;
    this.attendancePeriodVersionId = publication.attendancePeriodVersionId;
    this.predecessorPublicationId = publication.predecessorPublicationId;
    this.publicationType = publication.publicationType;
    this.idempotencyKey = publication.idempotencyKey;
    this.publishedAt = publication.publishedAt;
    this.factCount = publication.factCount;
    this.factMinutes = publication.factMinutes;
  }
}

export class AttendancePeriodVersionDto {
  readonly id: string;
  readonly attendancePeriodId: string;
  readonly period: AttendancePeriodDto;
  readonly versionNo: number;
  readonly status: string;
  readonly predecessorVersionId: string | null;
  readonly approvalRouteVersionId: string;
  readonly submittedByMembershipId: string;
  readonly submittedAt: string;
  readonly reviewedByMembershipId: string | null;
  readonly reviewedAt: string | null;
  readonly reviewReason: string | null;
  readonly lockedByMembershipId: string | null;
  readonly lockedAt: string | null;
  readonly coveredEmployeeCount: number;
  readonly coveredWorkDateCount: number;
  readonly dtrCount: number;
  readonly supersededDayCount: number;
  readonly publication: AttendancePayrollPublicationDto | null;

  constructor(version: AttendancePeriodVersionSummary) {
    this.id = version.id;
    this.attendancePeriodId = version.attendancePeriodId;
    this.period = new AttendancePeriodDto(version.period);
    this.versionNo = version.versionNo;
    this.status = version.status;
    this.predecessorVersionId = version.predecessorVersionId;
    this.approvalRouteVersionId = version.approvalRouteVersionId;
    this.submittedByMembershipId = version.submittedByMembershipId;
    this.submittedAt = version.submittedAt;
    this.reviewedByMembershipId = version.reviewedByMembershipId;
    this.reviewedAt = version.reviewedAt;
    this.reviewReason = version.reviewReason;
    this.lockedByMembershipId = version.lockedByMembershipId;
    this.lockedAt = version.lockedAt;
    this.coveredEmployeeCount = version.coveredEmployeeCount;
    this.coveredWorkDateCount = version.coveredWorkDateCount;
    this.dtrCount = version.dtrCount;
    this.supersededDayCount = version.supersededDayCount;
    this.publication = version.publication
      ? new AttendancePayrollPublicationDto(version.publication)
      : null;
  }
}

export class AttendancePeriodVersionListResponseDto {
  readonly versions: AttendancePeriodVersionDto[];

  constructor(versions: readonly AttendancePeriodVersionSummary[]) {
    this.versions = versions.map((version) => new AttendancePeriodVersionDto(version));
  }
}

export class AttendancePeriodVersionDetailDto {
  readonly version: AttendancePeriodVersionDto;
  readonly reconciliation: AttendancePeriodReconciliation | null;

  constructor(detail: AttendancePeriodVersionDetail) {
    this.version = new AttendancePeriodVersionDto(detail.version);
    this.reconciliation = detail.reconciliation;
  }
}

export class AttendancePeriodReconciliationDto {
  readonly reconciliation: AttendancePeriodReconciliation;

  constructor(reconciliation: AttendancePeriodReconciliation) {
    this.reconciliation = reconciliation;
  }
}

export class AttendancePayrollFactDto {
  readonly id: string;
  readonly employeeId: string;
  readonly workDate: string;
  readonly attendanceDayId: string;
  readonly factType: string;
  readonly holidayClassification: string | null;
  readonly stableSourceKey: string;
  readonly correctedMinutes: number;
  readonly priorMinutes: number | null;
  readonly differenceDirection: string | null;
  readonly differenceMinutes: number | null;

  constructor(fact: AttendancePayrollFactSummary) {
    this.id = fact.id;
    this.employeeId = fact.employeeId;
    this.workDate = fact.workDate;
    this.attendanceDayId = fact.attendanceDayId;
    this.factType = fact.factType;
    this.holidayClassification = fact.holidayClassification;
    this.stableSourceKey = fact.stableSourceKey;
    this.correctedMinutes = fact.correctedMinutes;
    this.priorMinutes = fact.priorMinutes;
    this.differenceDirection = fact.differenceDirection;
    this.differenceMinutes = fact.differenceMinutes;
  }
}

export class AttendancePayrollPublicationDetailDto {
  readonly publication: AttendancePayrollPublicationDto;
  readonly facts: AttendancePayrollFactDto[];

  constructor(detail: AttendancePayrollPublicationDetail) {
    this.publication = new AttendancePayrollPublicationDto(detail.publication);
    this.facts = detail.facts.map((fact) => new AttendancePayrollFactDto(fact));
  }
}

export class AttendancePeriodLockResponseDto {
  readonly version: AttendancePeriodVersionDto;
  readonly dtrDocumentIds: string[];
  readonly existingDtrDocumentIds: string[];
  readonly publication: AttendancePayrollPublicationDto;
  readonly replay: boolean;

  constructor(result: AttendancePeriodLockResult) {
    this.version = new AttendancePeriodVersionDto(result.version);
    this.dtrDocumentIds = result.dtrDocumentIds;
    this.existingDtrDocumentIds = result.existingDtrDocumentIds;
    this.publication = new AttendancePayrollPublicationDto(result.publication);
    this.replay = result.replay;
  }
}
