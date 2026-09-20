import type {
  AttendanceCaptureAssociation,
  AttendanceCaptureException,
  AttendanceClockStateSummary,
  AttendanceEventCaptureResult,
  AttendanceEventPresentation,
  AttendanceEventSummary,
  AttendanceMatchSummary,
  AttendanceWebClockStatusSummary,
  AttendanceWebClockVersionSummary,
  AttendanceWorkDateContext,
} from './attendance.types';

class AttendanceEventEmployeeDto {
  readonly id: string;
  readonly employeeNumber: string;
  readonly legalName: string;

  constructor(item: AttendanceEventSummary['employee']) {
    this.id = item.id;
    this.employeeNumber = item.employeeNumber;
    this.legalName = item.legalName;
  }
}

export class AttendanceEventDto {
  readonly id: string;
  readonly employeeId: string;
  readonly employee: AttendanceEventEmployeeDto;
  readonly eventTime: string;
  readonly eventType: AttendanceEventSummary['eventType'];
  readonly source: AttendanceEventSummary['source'];
  readonly sourceReference: string | null;
  readonly enteredByMembershipId: string | null;
  readonly reason: string | null;
  readonly createdAt: string;
  readonly presentation: AttendanceEventPresentation | null;

  constructor(item: AttendanceEventSummary, presentation: AttendanceEventPresentation | null) {
    this.id = item.id;
    this.employeeId = item.employeeId;
    this.employee = new AttendanceEventEmployeeDto(item.employee);
    this.eventTime = item.eventTime;
    this.eventType = item.eventType;
    this.source = item.source;
    this.sourceReference = item.sourceReference;
    this.enteredByMembershipId = item.enteredByMembershipId;
    this.reason = item.reason;
    this.createdAt = item.createdAt;
    this.presentation = presentation;
  }
}

export class AttendanceEventListResponseDto {
  readonly events: AttendanceEventDto[];

  constructor(events: AttendanceEventSummary[]) {
    this.events = events.map((event) => new AttendanceEventDto(event, null));
  }
}

class AttendanceCaptureAssociationDto {
  readonly workDate: string;
  readonly scheduleAssignmentId: string;
  readonly workScheduleVersionId: string;
  readonly workScheduleVersionNo: number;
  readonly workScheduleCode: string;
  readonly workScheduleName: string;
  readonly scheduleType: AttendanceCaptureAssociation['scheduleType'];
  readonly timezone: string;
  readonly workArrangementVersionId: string;
  readonly workArrangementVersionNo: number;
  readonly workArrangementCode: string;
  readonly workArrangementName: string;
  readonly arrangementType: AttendanceCaptureAssociation['arrangementType'];
  readonly holidayCalendarId: string;
  readonly holidayCalendarVersionId: string;
  readonly holidayEntries: AttendanceCaptureAssociation['holidayEntries'];
  readonly dayRule: AttendanceCaptureAssociation['dayRule'];

  constructor(item: AttendanceCaptureAssociation) {
    this.workDate = item.workDate;
    this.scheduleAssignmentId = item.scheduleAssignmentId;
    this.workScheduleVersionId = item.workScheduleVersionId;
    this.workScheduleVersionNo = item.workScheduleVersionNo;
    this.workScheduleCode = item.workScheduleCode;
    this.workScheduleName = item.workScheduleName;
    this.scheduleType = item.scheduleType;
    this.timezone = item.timezone;
    this.workArrangementVersionId = item.workArrangementVersionId;
    this.workArrangementVersionNo = item.workArrangementVersionNo;
    this.workArrangementCode = item.workArrangementCode;
    this.workArrangementName = item.workArrangementName;
    this.arrangementType = item.arrangementType;
    this.holidayCalendarId = item.holidayCalendarId;
    this.holidayCalendarVersionId = item.holidayCalendarVersionId;
    this.holidayEntries = item.holidayEntries;
    this.dayRule = item.dayRule;
  }
}

class AttendanceMatchDto {
  readonly status: 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS';
  readonly workDate: string | null;
  readonly unscheduled: boolean;
  readonly association: AttendanceCaptureAssociationDto | null;
  readonly matches: Array<{ workDate: string }>;

  constructor(item: AttendanceMatchSummary) {
    this.status = item.status;
    this.workDate = item.workDate;
    this.unscheduled = item.unscheduled;
    this.association = item.association
      ? new AttendanceCaptureAssociationDto(item.association)
      : null;
    this.matches = item.matches;
  }
}

export class AttendanceEventCaptureResultDto {
  readonly event: AttendanceEventDto;
  readonly match: AttendanceMatchDto;
  readonly exceptions: AttendanceCaptureException[];
  readonly presentation: AttendanceEventPresentation | null;

  constructor(item: AttendanceEventCaptureResult) {
    this.event = new AttendanceEventDto(item.event, item.presentation);
    this.match = new AttendanceMatchDto(item.match);
    this.exceptions = item.exceptions;
    this.presentation = item.presentation;
  }
}

export class AttendanceWorkDateContextDto {
  readonly workDate: string;
  readonly association: AttendanceCaptureAssociationDto | null;
  readonly exceptions: AttendanceCaptureException[];
  readonly events: AttendanceEventDto[];

  constructor(item: AttendanceWorkDateContext) {
    this.workDate = item.workDate;
    this.association = item.association
      ? new AttendanceCaptureAssociationDto(item.association)
      : null;
    this.exceptions = item.exceptions;
    this.events = item.events.map((event) => new AttendanceEventDto(event, event.presentation));
  }
}

export class AttendanceWebClockVersionDto {
  readonly id: string;
  readonly versionNo: number;
  readonly enabled: boolean;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: AttendanceWebClockVersionSummary['status'];
  readonly reason: string;
  readonly activatedByMembershipId: string;
  readonly activatedAt: string;
  readonly createdAt: string;

  constructor(item: AttendanceWebClockVersionSummary) {
    this.id = item.id;
    this.versionNo = item.versionNo;
    this.enabled = item.enabled;
    this.effectiveFrom = item.effectiveFrom;
    this.effectiveTo = item.effectiveTo;
    this.status = item.status;
    this.reason = item.reason;
    this.activatedByMembershipId = item.activatedByMembershipId;
    this.activatedAt = item.activatedAt;
    this.createdAt = item.createdAt;
  }
}

export class AttendanceWebClockStatusDto {
  readonly asOf: string;
  readonly enabled: boolean;
  readonly version: AttendanceWebClockVersionDto | null;
  readonly history: AttendanceWebClockVersionDto[];

  constructor(item: AttendanceWebClockStatusSummary) {
    this.asOf = item.asOf;
    this.enabled = item.enabled;
    this.version = item.version ? new AttendanceWebClockVersionDto(item.version) : null;
    this.history = item.history.map((version) => new AttendanceWebClockVersionDto(version));
  }
}

export class AttendanceClockStateDto {
  readonly asOf: string;
  readonly enabled: boolean;
  readonly employee: AttendanceEventEmployeeDto;
  readonly nextEventType: AttendanceClockStateSummary['nextEventType'];
  readonly association: AttendanceCaptureAssociationDto | null;
  readonly exceptions: AttendanceCaptureException[];
  readonly events: AttendanceEventDto[];

  constructor(item: AttendanceClockStateSummary) {
    this.asOf = item.asOf;
    this.enabled = item.enabled;
    this.employee = new AttendanceEventEmployeeDto(item.employee);
    this.nextEventType = item.nextEventType;
    this.association = item.association
      ? new AttendanceCaptureAssociationDto(item.association)
      : null;
    this.exceptions = item.exceptions;
    this.events = item.events.map((event) => new AttendanceEventDto(event, event.presentation));
  }
}
