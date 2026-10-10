import type {
  AttendanceContextCoverageMode,
  AttendanceContextEvidenceSummary,
  AttendanceContextSummary,
  AttendanceContextType,
} from './attendance-contexts.types';

export class AttendanceContextEmployeeDto {
  readonly id: string;
  readonly employeeNumber: string;
  readonly legalName: string;

  constructor(employee: AttendanceContextSummary['employee']) {
    this.id = employee.id;
    this.employeeNumber = employee.employeeNumber;
    this.legalName = employee.legalName;
  }
}

export class AttendanceContextRecorderDto {
  readonly membershipId: string;
  readonly legalName: string | null;

  constructor(recorder: AttendanceContextSummary['recordedBy']) {
    this.membershipId = recorder.membershipId;
    this.legalName = recorder.legalName;
  }
}

export class AttendanceContextDto {
  readonly id: string;
  readonly agencyId: string;
  readonly employee: AttendanceContextEmployeeDto;
  readonly contextType: AttendanceContextType;
  readonly coverageMode: AttendanceContextCoverageMode;
  readonly workDate: string | null;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly reason: string;
  readonly sourceType: string | null;
  readonly sourceId: string | null;
  readonly evidence: AttendanceContextEvidenceSummary | null;
  readonly recordedBy: AttendanceContextRecorderDto;
  readonly recordedAt: string;

  constructor(record: AttendanceContextSummary) {
    this.id = record.id;
    this.agencyId = record.agencyId;
    this.employee = new AttendanceContextEmployeeDto(record.employee);
    this.contextType = record.contextType;
    this.coverageMode = record.coverageMode;
    this.workDate = record.workDate;
    this.startsAt = record.startsAt;
    this.endsAt = record.endsAt;
    this.reason = record.reason;
    this.sourceType = record.sourceType;
    this.sourceId = record.sourceId;
    this.evidence = record.evidence ? { ...record.evidence } : null;
    this.recordedBy = new AttendanceContextRecorderDto(record.recordedBy);
    this.recordedAt = record.recordedAt;
  }
}

export class AttendanceContextListResponseDto {
  readonly contexts: AttendanceContextDto[];

  constructor(contexts: AttendanceContextSummary[]) {
    this.contexts = contexts.map((record) => new AttendanceContextDto(record));
  }
}
