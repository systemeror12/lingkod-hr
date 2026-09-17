import type {
  WorkScheduleBreakSummary,
  WorkScheduleDayRuleSummary,
  WorkScheduleDetail,
  WorkScheduleHistoryEntry,
  WorkScheduleSuccessor,
  WorkScheduleSummary,
  WorkScheduleVersionSummary,
} from './work-schedules.service';
import type {
  WorkArrangementDetail,
  WorkArrangementHistoryEntry,
  WorkArrangementSummary,
  WorkArrangementVersionSummary,
  HolidayCalendarSummary,
} from './work-arrangements.service';

class WorkScheduleBreakDto {
  readonly id: string;
  readonly sequenceNo: number;
  readonly breakStartTime: string;
  readonly breakEndTime: string;
  readonly endNextCalendarDay: boolean;

  constructor(item: WorkScheduleBreakSummary) {
    this.id = item.id;
    this.sequenceNo = item.sequenceNo;
    this.breakStartTime = item.breakStartTime;
    this.breakEndTime = item.breakEndTime;
    this.endNextCalendarDay = item.endNextCalendarDay;
  }
}

class WorkScheduleDayRuleDto {
  readonly id: string;
  readonly weekday: number;
  readonly ruleType: WorkScheduleDayRuleSummary['ruleType'];
  readonly dutyStartTime: string | null;
  readonly earliestStartTime: string | null;
  readonly latestStartTime: string | null;
  readonly dutyEndTime: string | null;
  readonly endNextCalendarDay: boolean;
  readonly requiredMinutes: number;
  readonly coreStartTime: string | null;
  readonly coreEndTime: string | null;
  readonly eventPattern: WorkScheduleDayRuleSummary['eventPattern'];
  readonly collectionBeforeMinutes: number;
  readonly collectionAfterMinutes: number;
  readonly breaks: WorkScheduleBreakDto[];

  constructor(item: WorkScheduleDayRuleSummary) {
    this.id = item.id;
    this.weekday = item.weekday;
    this.ruleType = item.ruleType;
    this.dutyStartTime = item.dutyStartTime;
    this.earliestStartTime = item.earliestStartTime;
    this.latestStartTime = item.latestStartTime;
    this.dutyEndTime = item.dutyEndTime;
    this.endNextCalendarDay = item.endNextCalendarDay;
    this.requiredMinutes = item.requiredMinutes;
    this.coreStartTime = item.coreStartTime;
    this.coreEndTime = item.coreEndTime;
    this.eventPattern = item.eventPattern;
    this.collectionBeforeMinutes = item.collectionBeforeMinutes;
    this.collectionAfterMinutes = item.collectionAfterMinutes;
    this.breaks = item.breaks.map((entry) => new WorkScheduleBreakDto(entry));
  }
}

export class WorkScheduleVersionDto {
  readonly id: string;
  readonly workScheduleId: string;
  readonly versionNo: number;
  readonly scheduleType: WorkScheduleVersionSummary['scheduleType'];
  readonly timezone: string;
  readonly authorityDocumentVersionId: string | null;
  readonly approvingAuthority: string | null;
  readonly versionState: WorkScheduleVersionSummary['versionState'];
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly activatedAt: string | null;
  readonly dayRules: WorkScheduleDayRuleDto[];
  readonly rowVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;

  constructor(version: WorkScheduleVersionSummary) {
    this.id = version.id;
    this.workScheduleId = version.workScheduleId;
    this.versionNo = version.versionNo;
    this.scheduleType = version.scheduleType;
    this.timezone = version.timezone;
    this.authorityDocumentVersionId = version.authorityDocumentVersionId;
    this.approvingAuthority = version.approvingAuthority;
    this.versionState = version.versionState;
    this.effectiveFrom = version.effectiveFrom;
    this.effectiveTo = version.effectiveTo;
    this.activatedAt = version.activatedAt;
    this.dayRules = version.dayRules.map((rule) => new WorkScheduleDayRuleDto(rule));
    this.rowVersion = version.rowVersion;
    this.createdAt = version.createdAt;
    this.updatedAt = version.updatedAt;
  }
}

export class WorkScheduleDto {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly currentVersion: WorkScheduleVersionDto | null;
  readonly draft: WorkScheduleVersionDto | null;
  readonly createdAt: string;
  readonly updatedAt: string;

  constructor(schedule: WorkScheduleSummary) {
    this.id = schedule.id;
    this.code = schedule.code;
    this.name = schedule.name;
    this.currentVersion = schedule.currentVersion
      ? new WorkScheduleVersionDto(schedule.currentVersion)
      : null;
    this.draft = schedule.draft ? new WorkScheduleVersionDto(schedule.draft) : null;
    this.createdAt = schedule.createdAt;
    this.updatedAt = schedule.updatedAt;
  }
}

export class WorkScheduleListResponseDto {
  readonly items: WorkScheduleDto[];

  constructor(items: WorkScheduleSummary[]) {
    this.items = items.map((item) => new WorkScheduleDto(item));
  }
}

class WorkScheduleHistoryEntryDto {
  readonly id: string;
  readonly action: string;
  readonly previousStatus: string | null;
  readonly newStatus: string | null;
  readonly reason: string | null;
  readonly effectiveDate: string | null;
  readonly occurredAt: string;

  constructor(entry: WorkScheduleHistoryEntry) {
    this.id = entry.id;
    this.action = entry.action;
    this.previousStatus = entry.previousStatus;
    this.newStatus = entry.newStatus;
    this.reason = entry.reason;
    this.effectiveDate = entry.effectiveDate;
    this.occurredAt = entry.occurredAt;
  }
}

export class WorkScheduleDetailDto {
  readonly schedule: WorkScheduleDto;
  readonly asOf: string;
  readonly effective: WorkScheduleVersionDto | null;
  readonly versions: WorkScheduleVersionDto[];
  readonly history: WorkScheduleHistoryEntryDto[];

  constructor(detail: WorkScheduleDetail) {
    this.schedule = new WorkScheduleDto(detail.schedule);
    this.asOf = detail.asOf;
    this.effective = detail.effective ? new WorkScheduleVersionDto(detail.effective) : null;
    this.versions = detail.versions.map((version) => new WorkScheduleVersionDto(version));
    this.history = detail.history.map((entry) => new WorkScheduleHistoryEntryDto(entry));
  }
}

export class WorkScheduleSuccessorDto {
  readonly current: WorkScheduleVersionDto;
  readonly draft: WorkScheduleVersionDto;

  constructor(successor: WorkScheduleSuccessor) {
    this.current = new WorkScheduleVersionDto(successor.current);
    this.draft = new WorkScheduleVersionDto(successor.draft);
  }
}

export class WorkArrangementVersionDto {
  readonly id: string;
  readonly workArrangementId: string;
  readonly versionNo: number;
  readonly arrangementType: WorkArrangementVersionSummary['arrangementType'];
  readonly permittedScheduleTypes: WorkArrangementVersionSummary['permittedScheduleTypes'];
  readonly holidayCalendarId: string;
  readonly authorityDocumentVersionId: string | null;
  readonly approvingAuthority: string | null;
  readonly versionState: WorkArrangementVersionSummary['versionState'];
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly activatedAt: string | null;
  readonly rowVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;

  constructor(version: WorkArrangementVersionSummary) {
    this.id = version.id;
    this.workArrangementId = version.workArrangementId;
    this.versionNo = version.versionNo;
    this.arrangementType = version.arrangementType;
    this.permittedScheduleTypes = version.permittedScheduleTypes;
    this.holidayCalendarId = version.holidayCalendarId;
    this.authorityDocumentVersionId = version.authorityDocumentVersionId;
    this.approvingAuthority = version.approvingAuthority;
    this.versionState = version.versionState;
    this.effectiveFrom = version.effectiveFrom;
    this.effectiveTo = version.effectiveTo;
    this.activatedAt = version.activatedAt;
    this.rowVersion = version.rowVersion;
    this.createdAt = version.createdAt;
    this.updatedAt = version.updatedAt;
  }
}

export class WorkArrangementDto {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly currentVersion: WorkArrangementVersionDto | null;
  readonly draft: WorkArrangementVersionDto | null;
  readonly createdAt: string;
  readonly updatedAt: string;

  constructor(arrangement: WorkArrangementSummary) {
    this.id = arrangement.id;
    this.code = arrangement.code;
    this.name = arrangement.name;
    this.currentVersion = arrangement.currentVersion
      ? new WorkArrangementVersionDto(arrangement.currentVersion)
      : null;
    this.draft = arrangement.draft ? new WorkArrangementVersionDto(arrangement.draft) : null;
    this.createdAt = arrangement.createdAt;
    this.updatedAt = arrangement.updatedAt;
  }
}

export class WorkArrangementListResponseDto {
  readonly items: WorkArrangementDto[];

  constructor(items: WorkArrangementSummary[]) {
    this.items = items.map((item) => new WorkArrangementDto(item));
  }
}

class WorkArrangementHistoryEntryDto {
  readonly id: string;
  readonly action: string;
  readonly previousStatus: string | null;
  readonly newStatus: string | null;
  readonly reason: string | null;
  readonly effectiveDate: string | null;
  readonly occurredAt: string;

  constructor(entry: WorkArrangementHistoryEntry) {
    this.id = entry.id;
    this.action = entry.action;
    this.previousStatus = entry.previousStatus;
    this.newStatus = entry.newStatus;
    this.reason = entry.reason;
    this.effectiveDate = entry.effectiveDate;
    this.occurredAt = entry.occurredAt;
  }
}

export class WorkArrangementDetailDto {
  readonly arrangement: WorkArrangementDto;
  readonly asOf: string;
  readonly effective: WorkArrangementVersionDto | null;
  readonly versions: WorkArrangementVersionDto[];
  readonly history: WorkArrangementHistoryEntryDto[];

  constructor(detail: WorkArrangementDetail) {
    this.arrangement = new WorkArrangementDto(detail.arrangement);
    this.asOf = detail.asOf;
    this.effective = detail.effective ? new WorkArrangementVersionDto(detail.effective) : null;
    this.versions = detail.versions.map((version) => new WorkArrangementVersionDto(version));
    this.history = detail.history.map((entry) => new WorkArrangementHistoryEntryDto(entry));
  }
}

export class HolidayCalendarDto {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly scopeType: HolidayCalendarSummary['scopeType'];
  readonly scopeReference: string;
  readonly currentVersionId: string | null;

  constructor(calendar: HolidayCalendarSummary) {
    this.id = calendar.id;
    this.code = calendar.code;
    this.name = calendar.name;
    this.scopeType = calendar.scopeType;
    this.scopeReference = calendar.scopeReference;
    this.currentVersionId = calendar.currentVersionId;
  }
}

export class HolidayCalendarListResponseDto {
  readonly items: HolidayCalendarDto[];

  constructor(items: HolidayCalendarSummary[]) {
    this.items = items.map((item) => new HolidayCalendarDto(item));
  }
}
