import type {
  PersonnelBaselineHistory,
  PersonnelBaselineHistoryEntry,
  PersonnelBaselinePositionIncumbency,
  PersonnelBaselineServiceSegment,
  PersonnelBaselineSummary,
} from './personnel-baselines.service';

export class PersonnelBaselineDto {
  readonly id: string;
  readonly employee: PersonnelBaselineSummary['employee'];
  readonly authorityEvidence: PersonnelBaselineSummary['authorityEvidence'];
  readonly firstGovernmentServiceDate: string;
  readonly agencyServiceStartDate: string;
  readonly organizationUnit: PersonnelBaselineSummary['organizationUnit'];
  readonly appointmentStatus: string;
  readonly salaryGrade: number | null;
  readonly salaryStep: number | null;
  readonly position: PersonnelBaselineSummary['position'];
  readonly status: PersonnelBaselineSummary['status'];
  readonly reason: string;
  readonly reviewedAt: string | null;
  readonly effectuatedAt: string | null;
  readonly serviceSegment: PersonnelBaselineServiceSegment | null;
  readonly positionIncumbency: PersonnelBaselinePositionIncumbency | null;
  readonly supersedesBaselineId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;

  constructor(baseline: PersonnelBaselineSummary) {
    this.id = baseline.id;
    this.employee = baseline.employee;
    this.authorityEvidence = baseline.authorityEvidence;
    this.firstGovernmentServiceDate = baseline.firstGovernmentServiceDate;
    this.agencyServiceStartDate = baseline.agencyServiceStartDate;
    this.organizationUnit = baseline.organizationUnit;
    this.appointmentStatus = baseline.appointmentStatus;
    this.salaryGrade = baseline.salaryGrade;
    this.salaryStep = baseline.salaryStep;
    this.position = baseline.position;
    this.status = baseline.status;
    this.reason = baseline.reason;
    this.reviewedAt = baseline.reviewedAt;
    this.effectuatedAt = baseline.effectuatedAt;
    this.serviceSegment = baseline.serviceSegment;
    this.positionIncumbency = baseline.positionIncumbency;
    this.supersedesBaselineId = baseline.supersedesBaselineId;
    this.createdAt = baseline.createdAt;
    this.updatedAt = baseline.updatedAt;
  }
}

export class PersonnelBaselineListResponseDto {
  readonly baselines: PersonnelBaselineDto[];

  constructor(baselines: PersonnelBaselineSummary[]) {
    this.baselines = baselines.map((baseline) => new PersonnelBaselineDto(baseline));
  }
}

export class PersonnelBaselineHistoryEntryDto {
  readonly id: string;
  readonly action: string;
  readonly previousStatus: string | null;
  readonly newStatus: string | null;
  readonly reason: string | null;
  readonly idempotencyKey: string | null;
  readonly metadata: PersonnelBaselineHistoryEntry['metadata'];
  readonly occurredAt: string;

  constructor(entry: PersonnelBaselineHistoryEntry) {
    this.id = entry.id;
    this.action = entry.action;
    this.previousStatus = entry.previousStatus;
    this.newStatus = entry.newStatus;
    this.reason = entry.reason;
    this.idempotencyKey = entry.idempotencyKey;
    this.metadata = entry.metadata;
    this.occurredAt = entry.occurredAt;
  }
}

export class PersonnelBaselineHistoryResponseDto {
  readonly baseline: PersonnelBaselineDto;
  readonly entries: PersonnelBaselineHistoryEntryDto[];

  constructor(history: PersonnelBaselineHistory) {
    this.baseline = new PersonnelBaselineDto(history.baseline);
    this.entries = history.entries.map((entry) => new PersonnelBaselineHistoryEntryDto(entry));
  }
}
