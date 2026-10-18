export type VersionState = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED';
export type ScheduleType = 'REGULAR' | 'FLEXIBLE' | 'SHIFT' | 'COMPRESSED';
export type DayRuleType = 'REST' | 'FIXED' | 'FLEXIBLE';
export type EventPattern = 'IN_OUT' | 'WITH_BREAK_EVENTS';
export type ArrangementType = 'ONSITE' | 'WORK_FROM_HOME' | 'HYBRID' | 'FIELD' | 'OTHER';
export type HolidayCalendarScopeType = 'AGENCY' | 'OFFICE' | 'WORKSITE';
export type HolidayDayType =
  | 'REGULAR_HOLIDAY'
  | 'SPECIAL_NON_WORKING'
  | 'SPECIAL_WORKING'
  | 'LOCAL_HOLIDAY'
  | 'WORK_SUSPENSION';

export const holidayCalendarScopeTypes: readonly HolidayCalendarScopeType[] = [
  'AGENCY',
  'OFFICE',
  'WORKSITE',
];
export const holidayDayTypes: readonly HolidayDayType[] = [
  'REGULAR_HOLIDAY',
  'SPECIAL_NON_WORKING',
  'SPECIAL_WORKING',
  'LOCAL_HOLIDAY',
  'WORK_SUSPENSION',
];

export const scheduleTypes: readonly ScheduleType[] = [
  'REGULAR',
  'FLEXIBLE',
  'SHIFT',
  'COMPRESSED',
];
export const arrangementTypes: readonly ArrangementType[] = [
  'ONSITE',
  'WORK_FROM_HOME',
  'HYBRID',
  'FIELD',
  'OTHER',
];
export const ruleTypes: readonly DayRuleType[] = ['FIXED', 'FLEXIBLE', 'REST'];
export const eventPatterns: readonly EventPattern[] = ['IN_OUT', 'WITH_BREAK_EVENTS'];

export const weekdayLabels: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

export interface WorkScheduleBreak {
  id: string;
  sequenceNo: number;
  breakStartTime: string;
  breakEndTime: string;
  endNextCalendarDay: boolean;
}

export interface WorkScheduleDayRule {
  id: string;
  weekday: number;
  ruleType: DayRuleType;
  dutyStartTime: string | null;
  earliestStartTime: string | null;
  latestStartTime: string | null;
  dutyEndTime: string | null;
  endNextCalendarDay: boolean;
  requiredMinutes: number;
  coreStartTime: string | null;
  coreEndTime: string | null;
  eventPattern: EventPattern;
  collectionBeforeMinutes: number;
  collectionAfterMinutes: number;
  breaks: WorkScheduleBreak[];
}

export interface WorkScheduleVersion {
  id: string;
  workScheduleId: string;
  versionNo: number;
  scheduleType: ScheduleType;
  timezone: string;
  authorityDocumentVersionId: string | null;
  approvingAuthority: string | null;
  versionState: VersionState;
  effectiveFrom: string;
  effectiveTo: string | null;
  activatedAt: string | null;
  dayRules: WorkScheduleDayRule[];
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkSchedule {
  id: string;
  code: string;
  name: string;
  currentVersion: WorkScheduleVersion | null;
  draft: WorkScheduleVersion | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkScheduleListResponse {
  items: WorkSchedule[];
}

export interface WorkScheduleDetail {
  schedule: WorkSchedule;
  asOf: string;
  effective: WorkScheduleVersion | null;
  versions: WorkScheduleVersion[];
  history: Array<{
    id: string;
    action: string;
    previousStatus: string | null;
    newStatus: string | null;
    reason: string | null;
    effectiveDate: string | null;
    occurredAt: string;
  }>;
}

export interface WorkArrangementVersion {
  id: string;
  workArrangementId: string;
  versionNo: number;
  arrangementType: ArrangementType;
  permittedScheduleTypes: ScheduleType[];
  holidayCalendarId: string;
  authorityDocumentVersionId: string | null;
  approvingAuthority: string | null;
  versionState: VersionState;
  effectiveFrom: string;
  effectiveTo: string | null;
  activatedAt: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkArrangement {
  id: string;
  code: string;
  name: string;
  currentVersion: WorkArrangementVersion | null;
  draft: WorkArrangementVersion | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkArrangementListResponse {
  items: WorkArrangement[];
}

export interface WorkArrangementDetail {
  arrangement: WorkArrangement;
  asOf: string;
  effective: WorkArrangementVersion | null;
  versions: WorkArrangementVersion[];
  history: Array<{
    id: string;
    action: string;
    previousStatus: string | null;
    newStatus: string | null;
    reason: string | null;
    effectiveDate: string | null;
    occurredAt: string;
  }>;
}

export interface HolidayCalendarEntry {
  id: string;
  holidayDate: string;
  name: string;
  dayType: HolidayDayType;
  sourceReference: string;
  rowVersion: number;
}

export interface HolidayCalendarVersion {
  id: string;
  holidayCalendarId: string;
  versionNo: number;
  authorityDocumentVersionId: string | null;
  approvingAuthority: string | null;
  versionState: VersionState;
  effectiveFrom: string;
  effectiveTo: string | null;
  activatedAt: string | null;
  entries: HolidayCalendarEntry[];
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface HolidayCalendar {
  id: string;
  code: string;
  name: string;
  scopeType: HolidayCalendarScopeType;
  scopeReference: string;
  currentVersion: HolidayCalendarVersion | null;
  draft: HolidayCalendarVersion | null;
  createdAt: string;
  updatedAt: string;
}

export interface HolidayCalendarListResponse {
  items: HolidayCalendar[];
}

export interface HolidayCalendarDetail {
  calendar: HolidayCalendar;
  asOf: string;
  effective: HolidayCalendarVersion | null;
  versions: HolidayCalendarVersion[];
  history: WorkScheduleDetail['history'];
}

export interface ScheduleAssignmentEmployee {
  id: string;
  employeeNumber: string;
  legalName: string;
}

export interface ScheduleAssignment {
  id: string;
  employee: ScheduleAssignmentEmployee;
  workScheduleVersionId: string;
  workScheduleVersionNo: number;
  scheduleType: ScheduleType;
  workScheduleCode: string;
  workScheduleName: string;
  workArrangementVersionId: string;
  workArrangementVersionNo: number;
  arrangementType: ArrangementType;
  workArrangementCode: string;
  workArrangementName: string;
  holidayCalendarId: string;
  authorityDocumentVersionId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  assignedByMembershipId: string;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export interface ScheduleAssignmentListResponse {
  items: ScheduleAssignment[];
}

export interface AttendanceResolution {
  employeeId: string;
  workDate: string;
  assignment: ScheduleAssignment;
  workScheduleVersion: WorkScheduleVersion;
  workArrangementVersion: WorkArrangementVersion;
  holidayCalendarVersion: HolidayCalendarVersion;
  dayRule: WorkScheduleDayRule;
  holidayEntries: HolidayCalendarEntry[];
}

export interface EmployeeOption {
  id: string;
  employeeNumber: string;
  legalName: string;
}

export interface EvidenceOption {
  documentId: string;
  documentNo: string | null;
  documentType: string;
  version: { id: string; versionNo: number };
}

export interface BreakForm {
  breakStartTime: string;
  breakEndTime: string;
  endNextCalendarDay: boolean;
}

export interface DayRuleForm {
  weekday: number;
  ruleType: DayRuleType;
  dutyStartTime: string;
  earliestStartTime: string;
  latestStartTime: string;
  dutyEndTime: string;
  endNextCalendarDay: boolean;
  requiredMinutes: string;
  coreStartTime: string;
  coreEndTime: string;
  eventPattern: EventPattern;
  collectionBeforeMinutes: string;
  collectionAfterMinutes: string;
  breaks: BreakForm[];
}

export interface ScheduleFormValues {
  code: string;
  name: string;
  scheduleType: ScheduleType;
  timezone: string;
  effectiveDate: string;
  dayRules: DayRuleForm[];
  rowVersion?: number;
}

export interface ArrangementFormValues {
  code: string;
  name: string;
  arrangementType: ArrangementType;
  permittedScheduleTypes: ScheduleType[];
  holidayCalendarId: string;
  effectiveDate: string;
  rowVersion?: number;
}

export interface ActivationValues {
  authorityDocumentVersionId: string;
  approvingAuthority: string;
  reason: string;
}

export interface HolidayEntryForm {
  holidayDate: string;
  name: string;
  dayType: HolidayDayType;
  sourceReference: string;
}

export interface HolidayCalendarFormValues {
  code: string;
  name: string;
  scopeType: HolidayCalendarScopeType;
  scopeReference: string;
  effectiveDate: string;
  entries: HolidayEntryForm[];
  rowVersion?: number;
}

export interface AssignmentFormValues {
  employeeId: string;
  workScheduleVersionId: string;
  workArrangementVersionId: string;
  authorityDocumentVersionId: string;
  effectiveFrom: string;
}

export interface AssignmentEndValues {
  effectiveTo: string;
  reason: string;
}

export class AttendanceRequestError extends Error {
  readonly exceptionType: string | null;

  constructor(message: string, exceptionType: string | null) {
    super(message);
    this.exceptionType = exceptionType;
  }
}

/** Lets the workspace header's create button open a tab section's create form. */
export type TabSectionHandle = { openCreate(target: { focus(): void }): void };

export type DialogKind =
  | 'schedule-create'
  | 'schedule-edit'
  | 'schedule-detail'
  | 'schedule-successor'
  | 'schedule-activate'
  | 'arrangement-create'
  | 'arrangement-edit'
  | 'arrangement-detail'
  | 'arrangement-successor'
  | 'arrangement-activate'
  | 'assignment-create'
  | 'assignment-end';
