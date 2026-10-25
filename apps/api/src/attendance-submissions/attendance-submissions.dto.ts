import type {
  AttendanceSubmissionDaySummary,
  AttendanceSubmissionDetail,
  AttendanceSubmissionEvidenceSummary,
  AttendanceSubmissionSummary,
} from './attendance-submissions.types';

export class AttendanceSubmissionPeriodDto {
  readonly id: string;
  readonly code: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly status: string;

  constructor(period: AttendanceSubmissionSummary['period']) {
    this.id = period.id;
    this.code = period.code;
    this.dateFrom = period.dateFrom;
    this.dateTo = period.dateTo;
    this.status = period.status;
  }
}

export class AttendanceSubmissionEmployeeDto {
  readonly id: string;
  readonly employeeNumber: string;
  readonly legalName: string;

  constructor(employee: AttendanceSubmissionSummary['employee']) {
    this.id = employee.id;
    this.employeeNumber = employee.employeeNumber;
    this.legalName = employee.legalName;
  }
}

export class AttendanceSubmissionDayDto {
  readonly attendanceDayId: string;
  readonly workDate: string;
  readonly status: string;
  readonly calculationVersion: number;
  readonly isCurrent: boolean;
  readonly openExceptionCount: number;

  constructor(day: AttendanceSubmissionDaySummary) {
    this.attendanceDayId = day.attendanceDayId;
    this.workDate = day.workDate;
    this.status = day.status;
    this.calculationVersion = day.calculationVersion;
    this.isCurrent = day.isCurrent;
    this.openExceptionCount = day.openExceptionCount;
  }
}

export class AttendanceSubmissionDto {
  readonly id: string;
  readonly agencyId: string;
  readonly period: AttendanceSubmissionPeriodDto;
  readonly employee: AttendanceSubmissionEmployeeDto;
  readonly versionNo: number;
  readonly status: string;
  readonly submittedByMembershipId: string;
  readonly submittedAt: string | null;
  readonly onBehalfReason: string | null;
  readonly evidence: AttendanceSubmissionEvidenceSummary | null;
  readonly reviewedByMembershipId: string | null;
  readonly reviewedAt: string | null;
  readonly reviewReason: string | null;
  readonly dayCount: number;
  readonly createdAt: string;

  constructor(record: AttendanceSubmissionSummary) {
    this.id = record.id;
    this.agencyId = record.agencyId;
    this.period = new AttendanceSubmissionPeriodDto(record.period);
    this.employee = new AttendanceSubmissionEmployeeDto(record.employee);
    this.versionNo = record.versionNo;
    this.status = record.status;
    this.submittedByMembershipId = record.submittedByMembershipId;
    this.submittedAt = record.submittedAt;
    this.onBehalfReason = record.onBehalfReason;
    this.evidence = record.evidence ? { ...record.evidence } : null;
    this.reviewedByMembershipId = record.reviewedByMembershipId;
    this.reviewedAt = record.reviewedAt;
    this.reviewReason = record.reviewReason;
    this.dayCount = record.dayCount;
    this.createdAt = record.createdAt;
  }
}

export class AttendanceSubmissionDetailDto {
  readonly submission: AttendanceSubmissionDto;
  readonly days: AttendanceSubmissionDayDto[];

  constructor(detail: AttendanceSubmissionDetail) {
    this.submission = new AttendanceSubmissionDto(detail.submission);
    this.days = detail.days.map((day) => new AttendanceSubmissionDayDto(day));
  }
}

export class AttendanceSubmissionListResponseDto {
  readonly submissions: AttendanceSubmissionDto[];

  constructor(submissions: readonly AttendanceSubmissionSummary[]) {
    this.submissions = submissions.map((record) => new AttendanceSubmissionDto(record));
  }
}
