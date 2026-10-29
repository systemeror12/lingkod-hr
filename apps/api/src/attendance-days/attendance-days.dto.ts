import type {
  AttendanceDayCalculationResultSummary,
  AttendanceDayDetail,
  AttendanceDayRuleSnapshot,
  AttendanceDaySegmentSummary,
  AttendanceDaySummary,
  AttendanceDayTotalsSummary,
  AttendanceExceptionSummary,
  AttendancePeriodSummary,
  CalculateAttendanceDaysResult,
} from './attendance-days.types';

export class AttendancePeriodDto {
  readonly id: string;
  readonly code: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly status: AttendancePeriodSummary['status'];
  readonly createdAt: string;

  constructor(record: AttendancePeriodSummary) {
    this.id = record.id;
    this.code = record.code;
    this.dateFrom = record.dateFrom;
    this.dateTo = record.dateTo;
    this.status = record.status;
    this.createdAt = record.createdAt;
  }
}

export class AttendanceDayEmployeeDto {
  readonly id: string;
  readonly employeeNumber: string;
  readonly legalName: string;

  constructor(employee: AttendanceDaySummary['employee']) {
    this.id = employee.id;
    this.employeeNumber = employee.employeeNumber;
    this.legalName = employee.legalName;
  }
}

export class AttendanceDayTotalsDto {
  readonly expectedMinutes: number;
  readonly workedMinutes: number;
  readonly coverageMinutes: number;
  readonly lateMinutes: number;
  readonly undertimeMinutes: number;
  readonly absenceMinutes: number;
  readonly officialBusinessMinutes: number;
  readonly officialTravelMinutes: number;
  readonly trainingMinutes: number;
  readonly approvedAbsenceMinutes: number;
  readonly postedLeaveMinutes: number;
  readonly ctoMinutes: number;
  readonly outsideScheduleMinutes: number;
  readonly statutoryNightWindowMinutes: number;

  constructor(totals: AttendanceDayTotalsSummary) {
    this.expectedMinutes = totals.expectedMinutes;
    this.workedMinutes = totals.workedMinutes;
    this.coverageMinutes = totals.coverageMinutes;
    this.lateMinutes = totals.lateMinutes;
    this.undertimeMinutes = totals.undertimeMinutes;
    this.absenceMinutes = totals.absenceMinutes;
    this.officialBusinessMinutes = totals.officialBusinessMinutes;
    this.officialTravelMinutes = totals.officialTravelMinutes;
    this.trainingMinutes = totals.trainingMinutes;
    this.approvedAbsenceMinutes = totals.approvedAbsenceMinutes;
    this.postedLeaveMinutes = totals.postedLeaveMinutes;
    this.ctoMinutes = totals.ctoMinutes;
    this.outsideScheduleMinutes = totals.outsideScheduleMinutes;
    this.statutoryNightWindowMinutes = totals.statutoryNightWindowMinutes;
  }
}

export class AttendanceDayDto {
  readonly id: string;
  readonly agencyId: string;
  readonly attendancePeriodId: string;
  readonly employee: AttendanceDayEmployeeDto;
  readonly workDate: string;
  readonly dayClassification: AttendanceDaySummary['dayClassification'];
  readonly status: AttendanceDaySummary['status'];
  readonly calculationVersion: number;
  readonly isCurrent: boolean;
  readonly scheduleAssignmentId: string | null;
  readonly workScheduleVersionId: string | null;
  readonly workArrangementVersionId: string | null;
  readonly holidayCalendarVersionId: string | null;
  readonly ruleSnapshot: AttendanceDayRuleSnapshot;
  readonly totals: AttendanceDayTotalsDto;
  readonly openExceptionCount: number;
  readonly calculatedAt: string | null;
  readonly createdAt: string;

  constructor(record: AttendanceDaySummary) {
    this.id = record.id;
    this.agencyId = record.agencyId;
    this.attendancePeriodId = record.attendancePeriodId;
    this.employee = new AttendanceDayEmployeeDto(record.employee);
    this.workDate = record.workDate;
    this.dayClassification = record.dayClassification;
    this.status = record.status;
    this.calculationVersion = record.calculationVersion;
    this.isCurrent = record.isCurrent;
    this.scheduleAssignmentId = record.scheduleAssignmentId;
    this.workScheduleVersionId = record.workScheduleVersionId;
    this.workArrangementVersionId = record.workArrangementVersionId;
    this.holidayCalendarVersionId = record.holidayCalendarVersionId;
    this.ruleSnapshot = record.ruleSnapshot;
    this.totals = new AttendanceDayTotalsDto(record.totals);
    this.openExceptionCount = record.openExceptionCount;
    this.calculatedAt = record.calculatedAt;
    this.createdAt = record.createdAt;
  }
}

export class AttendanceDaySegmentDto {
  readonly id: string;
  readonly sequenceNo: number;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly dutyRelation: string;
  readonly coverageType: string;
  readonly deficitType: string | null;
  readonly holidayClassification: string | null;
  readonly sourceReferences: AttendanceDaySegmentSummary['sourceReferences'];

  constructor(record: AttendanceDaySegmentSummary) {
    this.id = record.id;
    this.sequenceNo = record.sequenceNo;
    this.startsAt = record.startsAt;
    this.endsAt = record.endsAt;
    this.dutyRelation = record.dutyRelation;
    this.coverageType = record.coverageType;
    this.deficitType = record.deficitType;
    this.holidayClassification = record.holidayClassification;
    this.sourceReferences = record.sourceReferences;
  }
}

export class AttendanceExceptionDto {
  readonly id: string;
  readonly exceptionType: string;
  readonly status: AttendanceExceptionSummary['status'];
  readonly message: string | null;
  readonly details: AttendanceExceptionSummary['details'];
  readonly resolvedAt: string | null;
  readonly resolvedByMembershipId: string | null;
  readonly createdAt: string;

  constructor(record: AttendanceExceptionSummary) {
    this.id = record.id;
    this.exceptionType = record.exceptionType;
    this.status = record.status;
    this.message = record.message;
    this.details = record.details;
    this.resolvedAt = record.resolvedAt;
    this.resolvedByMembershipId = record.resolvedByMembershipId;
    this.createdAt = record.createdAt;
  }
}

export class AttendanceDayDetailDto {
  readonly day: AttendanceDayDto;
  readonly segments: AttendanceDaySegmentDto[];
  readonly exceptions: AttendanceExceptionDto[];

  constructor(record: AttendanceDayDetail) {
    this.day = new AttendanceDayDto(record.day);
    this.segments = record.segments.map((segment) => new AttendanceDaySegmentDto(segment));
    this.exceptions = record.exceptions.map((exception) => new AttendanceExceptionDto(exception));
  }
}

export class AttendanceDayListResponseDto {
  readonly days: AttendanceDayDto[];

  constructor(days: AttendanceDaySummary[]) {
    this.days = days.map((record) => new AttendanceDayDto(record));
  }
}

export class AttendancePeriodListResponseDto {
  readonly periods: AttendancePeriodDto[];

  constructor(periods: AttendancePeriodSummary[]) {
    this.periods = periods.map((record) => new AttendancePeriodDto(record));
  }
}

export class AttendanceDayCalculationResultDto {
  readonly employeeId: string;
  readonly workDate: string;
  readonly attendanceDayId: string | null;
  readonly status: AttendanceDayCalculationResultSummary['status'];
  readonly outcome: AttendanceDayCalculationResultSummary['outcome'];
  readonly exceptionTypes: string[];

  constructor(record: AttendanceDayCalculationResultSummary) {
    this.employeeId = record.employeeId;
    this.workDate = record.workDate;
    this.attendanceDayId = record.attendanceDayId;
    this.status = record.status;
    this.outcome = record.outcome;
    this.exceptionTypes = record.exceptionTypes;
  }
}

export class CalculateAttendanceDaysResponseDto {
  readonly period: AttendancePeriodDto;
  readonly days: AttendanceDayCalculationResultDto[];
  readonly createdCount: number;
  readonly recalculatedCount: number;
  readonly unchangedCount: number;

  constructor(result: CalculateAttendanceDaysResult) {
    this.period = new AttendancePeriodDto(result.period);
    this.days = result.days.map((day) => new AttendanceDayCalculationResultDto(day));
    this.createdCount = result.createdCount;
    this.recalculatedCount = result.recalculatedCount;
    this.unchangedCount = result.unchangedCount;
  }
}
