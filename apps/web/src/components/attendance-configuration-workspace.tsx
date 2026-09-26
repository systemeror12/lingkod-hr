'use client';

import { Field, inputClass, FormError } from './ui/field';
import { RecordReturn, useRecordNavigation } from './record-navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { Button } from './ui/button';
import { manilaToday } from '../lib/manila-date';

type VersionState = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED';
type ScheduleType = 'REGULAR' | 'FLEXIBLE' | 'SHIFT' | 'COMPRESSED';
type DayRuleType = 'REST' | 'FIXED' | 'FLEXIBLE';
type EventPattern = 'IN_OUT' | 'WITH_BREAK_EVENTS';
type ArrangementType = 'ONSITE' | 'WORK_FROM_HOME' | 'HYBRID' | 'FIELD' | 'OTHER';
type HolidayCalendarScopeType = 'AGENCY' | 'OFFICE' | 'WORKSITE';
type HolidayDayType =
  | 'REGULAR_HOLIDAY'
  | 'SPECIAL_NON_WORKING'
  | 'SPECIAL_WORKING'
  | 'LOCAL_HOLIDAY'
  | 'WORK_SUSPENSION';

const holidayCalendarScopeTypes: readonly HolidayCalendarScopeType[] = [
  'AGENCY',
  'OFFICE',
  'WORKSITE',
];
const holidayDayTypes: readonly HolidayDayType[] = [
  'REGULAR_HOLIDAY',
  'SPECIAL_NON_WORKING',
  'SPECIAL_WORKING',
  'LOCAL_HOLIDAY',
  'WORK_SUSPENSION',
];

const scheduleTypes: readonly ScheduleType[] = ['REGULAR', 'FLEXIBLE', 'SHIFT', 'COMPRESSED'];
const arrangementTypes: readonly ArrangementType[] = [
  'ONSITE',
  'WORK_FROM_HOME',
  'HYBRID',
  'FIELD',
  'OTHER',
];
const ruleTypes: readonly DayRuleType[] = ['FIXED', 'FLEXIBLE', 'REST'];
const eventPatterns: readonly EventPattern[] = ['IN_OUT', 'WITH_BREAK_EVENTS'];

const weekdayLabels: Record<number, string> = {
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

interface WorkScheduleDetail {
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

interface WorkArrangementDetail {
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

interface HolidayCalendarDetail {
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

interface ScheduleAssignmentListResponse {
  items: ScheduleAssignment[];
}

interface AttendanceResolution {
  employeeId: string;
  workDate: string;
  assignment: ScheduleAssignment;
  workScheduleVersion: WorkScheduleVersion;
  workArrangementVersion: WorkArrangementVersion;
  holidayCalendarVersion: HolidayCalendarVersion;
  dayRule: WorkScheduleDayRule;
  holidayEntries: HolidayCalendarEntry[];
}

interface EmployeeOption {
  id: string;
  employeeNumber: string;
  legalName: string;
}

interface EvidenceOption {
  documentId: string;
  documentNo: string | null;
  documentType: string;
  version: { id: string; versionNo: number };
}

interface BreakForm {
  breakStartTime: string;
  breakEndTime: string;
  endNextCalendarDay: boolean;
}

interface DayRuleForm {
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

interface ScheduleFormValues {
  code: string;
  name: string;
  scheduleType: ScheduleType;
  timezone: string;
  effectiveDate: string;
  dayRules: DayRuleForm[];
  rowVersion?: number;
}

interface ArrangementFormValues {
  code: string;
  name: string;
  arrangementType: ArrangementType;
  permittedScheduleTypes: ScheduleType[];
  holidayCalendarId: string;
  effectiveDate: string;
  rowVersion?: number;
}

interface ActivationValues {
  authorityDocumentVersionId: string;
  approvingAuthority: string;
  reason: string;
}

interface HolidayEntryForm {
  holidayDate: string;
  name: string;
  dayType: HolidayDayType;
  sourceReference: string;
}

interface HolidayCalendarFormValues {
  code: string;
  name: string;
  scopeType: HolidayCalendarScopeType;
  scopeReference: string;
  effectiveDate: string;
  entries: HolidayEntryForm[];
  rowVersion?: number;
}

interface AssignmentFormValues {
  employeeId: string;
  workScheduleVersionId: string;
  workArrangementVersionId: string;
  authorityDocumentVersionId: string;
  effectiveFrom: string;
}

interface AssignmentEndValues {
  effectiveTo: string;
  reason: string;
}

class AttendanceRequestError extends Error {
  readonly exceptionType: string | null;

  constructor(message: string, exceptionType: string | null) {
    super(message);
    this.exceptionType = exceptionType;
  }
}

type DialogKind =
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
  | 'calendar-create'
  | 'calendar-edit'
  | 'calendar-detail'
  | 'calendar-successor'
  | 'calendar-activate'
  | 'assignment-create'
  | 'assignment-end';

function emptyActivation(): ActivationValues {
  return { authorityDocumentVersionId: '', approvingAuthority: '', reason: '' };
}

function defaultDayRule(weekday: number, ruleType: DayRuleType): DayRuleForm {
  const base: DayRuleForm = {
    weekday,
    ruleType,
    dutyStartTime: '',
    earliestStartTime: '',
    latestStartTime: '',
    dutyEndTime: '',
    endNextCalendarDay: false,
    requiredMinutes: '0',
    coreStartTime: '',
    coreEndTime: '',
    eventPattern: 'IN_OUT',
    collectionBeforeMinutes: '0',
    collectionAfterMinutes: '0',
    breaks: [],
  };
  if (ruleType === 'FIXED') {
    return {
      ...base,
      dutyStartTime: '08:00',
      dutyEndTime: '17:00',
      requiredMinutes: '480',
      breaks: [{ breakStartTime: '12:00', breakEndTime: '13:00', endNextCalendarDay: false }],
    };
  }
  if (ruleType === 'FLEXIBLE') {
    return {
      ...base,
      earliestStartTime: '07:00',
      latestStartTime: '09:00',
      dutyEndTime: '18:00',
      requiredMinutes: '480',
      breaks: [{ breakStartTime: '12:00', breakEndTime: '13:00', endNextCalendarDay: false }],
    };
  }
  return base;
}

function emptyDayRules(): DayRuleForm[] {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
    defaultDayRule(weekday, weekday <= 5 ? 'FIXED' : 'REST'),
  );
}

function emptyScheduleValues(): ScheduleFormValues {
  return {
    code: '',
    name: '',
    scheduleType: 'REGULAR',
    timezone: 'Asia/Manila',
    effectiveDate: manilaToday(),
    dayRules: emptyDayRules(),
  };
}

function emptyArrangementValues(holidayCalendarId: string): ArrangementFormValues {
  return {
    code: '',
    name: '',
    arrangementType: 'ONSITE',
    permittedScheduleTypes: ['REGULAR'],
    holidayCalendarId,
    effectiveDate: manilaToday(),
  };
}

function emptyHolidayCalendarValues(): HolidayCalendarFormValues {
  return {
    code: '',
    name: '',
    scopeType: 'AGENCY',
    scopeReference: '',
    effectiveDate: manilaToday(),
    entries: [
      { holidayDate: manilaToday(), name: '', dayType: 'REGULAR_HOLIDAY', sourceReference: '' },
    ],
  };
}

function holidayCalendarValuesFrom(
  calendar: HolidayCalendar,
  version: HolidayCalendarVersion,
): HolidayCalendarFormValues {
  return {
    code: calendar.code,
    name: calendar.name,
    scopeType: calendar.scopeType,
    scopeReference: calendar.scopeReference,
    effectiveDate: version.effectiveFrom,
    entries: version.entries.map((entry) => ({
      holidayDate: entry.holidayDate,
      name: entry.name,
      dayType: entry.dayType,
      sourceReference: entry.sourceReference,
    })),
    rowVersion: version.rowVersion,
  };
}

function emptyAssignmentValues(): AssignmentFormValues {
  return {
    employeeId: '',
    workScheduleVersionId: '',
    workArrangementVersionId: '',
    authorityDocumentVersionId: '',
    effectiveFrom: manilaToday(),
  };
}

function scheduleVersionOptions(schedules: WorkSchedule[]): Array<{ id: string; label: string }> {
  return schedules.flatMap((schedule) =>
    schedule.currentVersion
      ? [
          {
            id: schedule.currentVersion.id,
            label:
              schedule.code +
              ' · v' +
              schedule.currentVersion.versionNo +
              ' · ' +
              label(schedule.currentVersion.scheduleType),
          },
        ]
      : [],
  );
}

function arrangementVersionOptions(
  arrangements: WorkArrangement[],
): Array<{ id: string; label: string }> {
  return arrangements.flatMap((arrangement) =>
    arrangement.currentVersion
      ? [
          {
            id: arrangement.currentVersion.id,
            label:
              arrangement.code +
              ' · v' +
              arrangement.currentVersion.versionNo +
              ' · ' +
              label(arrangement.currentVersion.arrangementType),
          },
        ]
      : [],
  );
}

function scheduleValuesFrom(
  schedule: WorkSchedule,
  version: WorkScheduleVersion,
): ScheduleFormValues {
  return {
    code: schedule.code,
    name: schedule.name,
    scheduleType: version.scheduleType,
    timezone: version.timezone,
    effectiveDate: version.effectiveFrom,
    dayRules: [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
      const rule = version.dayRules.find((entry) => entry.weekday === weekday);
      return rule ? dayRuleFrom(rule) : defaultDayRule(weekday, 'REST');
    }),
    rowVersion: version.rowVersion,
  };
}

function dayRuleFrom(rule: WorkScheduleDayRule): DayRuleForm {
  return {
    weekday: rule.weekday,
    ruleType: rule.ruleType,
    dutyStartTime: rule.dutyStartTime ?? '',
    earliestStartTime: rule.earliestStartTime ?? '',
    latestStartTime: rule.latestStartTime ?? '',
    dutyEndTime: rule.dutyEndTime ?? '',
    endNextCalendarDay: rule.endNextCalendarDay,
    requiredMinutes: String(rule.requiredMinutes),
    coreStartTime: rule.coreStartTime ?? '',
    coreEndTime: rule.coreEndTime ?? '',
    eventPattern: rule.eventPattern,
    collectionBeforeMinutes: String(rule.collectionBeforeMinutes),
    collectionAfterMinutes: String(rule.collectionAfterMinutes),
    breaks: rule.breaks.map((entry) => ({
      breakStartTime: entry.breakStartTime,
      breakEndTime: entry.breakEndTime,
      endNextCalendarDay: entry.endNextCalendarDay,
    })),
  };
}

function arrangementValuesFrom(
  arrangement: WorkArrangement,
  version: WorkArrangementVersion,
): ArrangementFormValues {
  return {
    code: arrangement.code,
    name: arrangement.name,
    arrangementType: version.arrangementType,
    permittedScheduleTypes: version.permittedScheduleTypes,
    holidayCalendarId: version.holidayCalendarId,
    effectiveDate: version.effectiveFrom,
    rowVersion: version.rowVersion,
  };
}

function timeOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function breakPayload(item: BreakForm): Record<string, unknown> {
  return {
    breakStartTime: item.breakStartTime,
    breakEndTime: item.breakEndTime,
    endNextCalendarDay: item.endNextCalendarDay,
  };
}

function dayRulePayload(rule: DayRuleForm): Record<string, unknown> {
  const base: Record<string, unknown> = {
    weekday: rule.weekday,
    ruleType: rule.ruleType,
    requiredMinutes: rule.ruleType === 'REST' ? 0 : Number(rule.requiredMinutes || '0'),
    eventPattern: rule.ruleType === 'REST' ? 'IN_OUT' : rule.eventPattern,
    collectionBeforeMinutes:
      rule.ruleType === 'REST' ? 0 : Number(rule.collectionBeforeMinutes || '0'),
    collectionAfterMinutes:
      rule.ruleType === 'REST' ? 0 : Number(rule.collectionAfterMinutes || '0'),
  };
  if (rule.ruleType === 'FIXED') {
    return {
      ...base,
      dutyStartTime: timeOrNull(rule.dutyStartTime),
      dutyEndTime: timeOrNull(rule.dutyEndTime),
      endNextCalendarDay: rule.endNextCalendarDay,
      breaks: rule.breaks.map(breakPayload),
    };
  }
  if (rule.ruleType === 'FLEXIBLE') {
    return {
      ...base,
      earliestStartTime: timeOrNull(rule.earliestStartTime),
      latestStartTime: timeOrNull(rule.latestStartTime),
      dutyEndTime: timeOrNull(rule.dutyEndTime),
      endNextCalendarDay: rule.endNextCalendarDay,
      coreStartTime: timeOrNull(rule.coreStartTime),
      coreEndTime: timeOrNull(rule.coreEndTime),
      breaks: rule.breaks.map(breakPayload),
    };
  }
  return base;
}

function schedulePayload(
  values: ScheduleFormValues,
  includeIdentity: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    scheduleType: values.scheduleType,
    timezone: values.timezone,
    effectiveDate: values.effectiveDate,
    dayRules: values.dayRules.map(dayRulePayload),
  };
  if (includeIdentity) {
    result.code = values.code;
    result.name = values.name;
  } else if (values.rowVersion !== undefined) {
    result.rowVersion = values.rowVersion;
  }
  return result;
}

function arrangementPayload(
  values: ArrangementFormValues,
  includeIdentity: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    arrangementType: values.arrangementType,
    permittedScheduleTypes: values.permittedScheduleTypes,
    holidayCalendarId: values.holidayCalendarId,
    effectiveDate: values.effectiveDate,
  };
  if (includeIdentity) {
    result.code = values.code;
    result.name = values.name;
  } else if (values.rowVersion !== undefined) {
    result.rowVersion = values.rowVersion;
  }
  return result;
}

function holidayCalendarPayload(
  values: HolidayCalendarFormValues,
  includeIdentity: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    effectiveDate: values.effectiveDate,
    entries: values.entries.map((entry) => ({
      holidayDate: entry.holidayDate,
      name: entry.name,
      dayType: entry.dayType,
      sourceReference: entry.sourceReference,
    })),
  };
  if (includeIdentity) {
    result.code = values.code;
    result.name = values.name;
    result.scopeType = values.scopeType;
    result.scopeReference = values.scopeReference;
  } else if (values.rowVersion !== undefined) {
    result.rowVersion = values.rowVersion;
  }
  return result;
}

function assignmentPayload(values: AssignmentFormValues): Record<string, unknown> {
  return {
    employeeId: values.employeeId,
    workScheduleVersionId: values.workScheduleVersionId,
    workArrangementVersionId: values.workArrangementVersionId,
    authorityDocumentVersionId: values.authorityDocumentVersionId,
    effectiveFrom: values.effectiveFrom,
  };
}

function dateLabel(value: string): string {
  const date = new Date(value.includes('T') ? value : value.slice(0, 10) + 'T00:00:00.000Z');
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const error = (value as { error?: { message?: unknown } }).error;
  return typeof error?.message === 'string' ? error.message : fallback;
}

function describeRequestError(error: unknown, fallback: string): string {
  if (error instanceof AttendanceRequestError && error.exceptionType) {
    return error.message + ' · Cause: ' + label(error.exceptionType);
  }
  return error instanceof Error ? error.message : fallback;
}

function statusClass(status: VersionState): string {
  if (status === 'ACTIVE') return 'bg-[#e8f3ed] text-[#316647]';
  if (status === 'SUPERSEDED') return 'bg-[#f0f2f5] text-muted';
  return 'bg-[#fff3d6] text-[#79531c]';
}

function ruleWindow(rule: WorkScheduleDayRule): string {
  if (rule.ruleType === 'REST') return 'No duty';
  if (rule.ruleType === 'FIXED') {
    return (
      (rule.dutyStartTime ?? '—') +
      '–' +
      (rule.dutyEndTime ?? '—') +
      (rule.endNextCalendarDay ? ' (+1 day)' : '')
    );
  }
  return (
    (rule.earliestStartTime ?? '—') +
    '–' +
    (rule.latestStartTime ?? '—') +
    ' start · ends ' +
    (rule.dutyEndTime ?? '—') +
    (rule.endNextCalendarDay ? ' (+1 day)' : '')
  );
}

function breaksLabel(rule: WorkScheduleDayRule): string {
  if (!rule.breaks.length) return '—';
  return rule.breaks
    .map(
      (entry) =>
        entry.breakStartTime +
        '–' +
        entry.breakEndTime +
        (entry.endNextCalendarDay ? ' (+1 day)' : ''),
    )
    .join(', ');
}

function label(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function parseEvidenceOptions(value: unknown): EvidenceOption[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as { documents?: unknown }).documents)
  ) {
    throw new Error('The Agency Document response was invalid.');
  }
  return (value as { documents: EvidenceOption[] }).documents;
}

function parseEmployeeOptions(value: unknown): EmployeeOption[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as { employees?: unknown }).employees)
  ) {
    throw new Error('The Employee list response was invalid.');
  }
  return (value as { employees: EmployeeOption[] }).employees;
}

function parseAssignments(value: unknown): ScheduleAssignment[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { items?: unknown }).items)) {
    throw new Error('The Schedule Assignment list response was invalid.');
  }
  return (value as ScheduleAssignmentListResponse).items;
}

function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function targetChecked(event: { currentTarget: EventTarget }): boolean {
  return (event.currentTarget as unknown as { checked: boolean }).checked;
}

function validForm(event: FormEvent<HTMLFormElement>): boolean {
  return (event.currentTarget as unknown as { reportValidity(): boolean }).reportValidity();
}

function StatusBadge({ status }: { status: VersionState }) {
  return (
    <span
      className={
        'inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.07em] uppercase ' +
        statusClass(status)
      }
    >
      {status}
    </span>
  );
}

function VersionMeta({ children, label: name }: { children: ReactNode; label: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{name}</dt>
      <dd className="m-0 text-ink">{children}</dd>
    </div>
  );
}

function ScheduleDayRuleTable({ rules }: { rules: WorkScheduleDayRule[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-xs">
        <thead className="bg-canvas text-[10px] tracking-[0.07em] text-muted uppercase">
          <tr>
            <th className="px-3 py-2 font-bold" scope="col">
              Day
            </th>
            <th className="px-3 py-2 font-bold" scope="col">
              Rule
            </th>
            <th className="px-3 py-2 font-bold" scope="col">
              Window
            </th>
            <th className="px-3 py-2 font-bold" scope="col">
              Required
            </th>
            <th className="px-3 py-2 font-bold" scope="col">
              Unpaid breaks
            </th>
            <th className="px-3 py-2 font-bold" scope="col">
              Collection window
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rules.map((rule) => (
            <tr key={rule.id}>
              <td className="px-3 py-2 font-[650] text-ink">{weekdayLabels[rule.weekday]}</td>
              <td className="px-3 py-2 text-ink">{label(rule.ruleType)}</td>
              <td className="px-3 py-2 text-ink">{ruleWindow(rule)}</td>
              <td className="px-3 py-2 text-ink">
                {rule.requiredMinutes} min
                {rule.ruleType === 'FLEXIBLE' && rule.coreStartTime && rule.coreEndTime
                  ? ' · core ' + rule.coreStartTime + '–' + rule.coreEndTime
                  : ''}
              </td>
              <td className="px-3 py-2 text-ink">{breaksLabel(rule)}</td>
              <td className="px-3 py-2 text-ink">
                {rule.collectionBeforeMinutes || rule.collectionAfterMinutes
                  ? '+' +
                    rule.collectionBeforeMinutes +
                    ' before · +' +
                    rule.collectionAfterMinutes +
                    ' after'
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TransitionHistory({
  history,
  id,
}: {
  history: WorkScheduleDetail['history'];
  id: string;
}) {
  return (
    <section className="grid gap-3" aria-labelledby={id}>
      <h3 className="m-0 text-sm font-[670] text-midnight" id={id}>
        Transition history
      </h3>
      {history.length ? (
        <ol className="m-0 grid gap-2 pl-5 text-xs text-muted">
          {history.map((entry) => (
            <li key={entry.id}>
              {entry.action} · {entry.reason ?? 'No reason recorded'} ·{' '}
              {dateLabel(entry.occurredAt)}
            </li>
          ))}
        </ol>
      ) : (
        <p className="m-0 text-xs text-muted">No transitions recorded.</p>
      )}
    </section>
  );
}

function ScheduleDetailBody({
  detail,
  detailLoading,
  error,
}: {
  detail: WorkScheduleDetail | null;
  detailLoading: boolean;
  error: string;
}) {
  return (
    <DialogBody>
      {detailLoading ? <p className="m-0 text-sm text-muted">Loading schedule history…</p> : null}
      {error ? <FormError message={error} /> : null}
      {detail ? (
        <div className="grid gap-7">
          <dl className="grid gap-4 text-sm min-[621px]:grid-cols-2">
            <VersionMeta label="Code">{detail.schedule.code}</VersionMeta>
            <VersionMeta label="Name">{detail.schedule.name}</VersionMeta>
            <VersionMeta label="Effective on">{dateLabel(detail.asOf)}</VersionMeta>
            <VersionMeta label="Effective version">
              {detail.effective
                ? 'v' +
                  detail.effective.versionNo +
                  ' · ' +
                  label(detail.effective.scheduleType) +
                  ' · ' +
                  detail.effective.timezone
                : 'No effective version'}
            </VersionMeta>
          </dl>
          <section className="grid gap-3" aria-labelledby="work-schedule-version-history-title">
            <h3
              className="m-0 text-sm font-[670] text-midnight"
              id="work-schedule-version-history-title"
            >
              Version history
            </h3>
            <div className="grid gap-3">
              {detail.versions.map((version) => (
                <article
                  className="grid gap-3 rounded-[3px] border border-line bg-canvas px-4 py-3 text-sm"
                  key={version.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-ink">Version {version.versionNo}</strong>
                    <StatusBadge status={version.versionState} />
                  </div>
                  <dl className="grid gap-2 text-xs min-[621px]:grid-cols-2">
                    <VersionMeta label="Effectivity">
                      {dateLabel(version.effectiveFrom)}
                      {version.effectiveTo
                        ? ' – ' + dateLabel(version.effectiveTo)
                        : ' – open-ended'}
                    </VersionMeta>
                    <VersionMeta label="Schedule type">{label(version.scheduleType)}</VersionMeta>
                    <VersionMeta label="Approving authority">
                      {version.approvingAuthority ?? 'Not recorded'}
                    </VersionMeta>
                    <VersionMeta label="Activated">
                      {version.activatedAt ? dateLabel(version.activatedAt) : 'Not activated'}
                    </VersionMeta>
                  </dl>
                  <ScheduleDayRuleTable rules={version.dayRules} />
                </article>
              ))}
            </div>
          </section>
          <TransitionHistory history={detail.history} id="work-schedule-audit-history-title" />
        </div>
      ) : null}
      <DialogFooter className="-mx-6 mt-6 border-t-0 px-0 pb-0 min-[621px]:-mx-8 min-[621px]:px-0">
        <DialogClose asChild>
          <Button size="default" type="button" variant="secondary">
            Close
          </Button>
        </DialogClose>
      </DialogFooter>
    </DialogBody>
  );
}

function ArrangementDetailBody({
  calendars,
  detail,
  detailLoading,
  error,
}: {
  calendars: HolidayCalendar[];
  detail: WorkArrangementDetail | null;
  detailLoading: boolean;
  error: string;
}) {
  function calendarName(id: string): string {
    const calendar = calendars.find((entry) => entry.id === id);
    return calendar ? calendar.code + ' · ' + calendar.name : id;
  }
  return (
    <DialogBody>
      {detailLoading ? (
        <p className="m-0 text-sm text-muted">Loading arrangement history…</p>
      ) : null}
      {error ? <FormError message={error} /> : null}
      {detail ? (
        <div className="grid gap-7">
          <dl className="grid gap-4 text-sm min-[621px]:grid-cols-2">
            <VersionMeta label="Code">{detail.arrangement.code}</VersionMeta>
            <VersionMeta label="Name">{detail.arrangement.name}</VersionMeta>
            <VersionMeta label="Effective on">{dateLabel(detail.asOf)}</VersionMeta>
            <VersionMeta label="Effective version">
              {detail.effective
                ? 'v' + detail.effective.versionNo + ' · ' + label(detail.effective.arrangementType)
                : 'No effective version'}
            </VersionMeta>
          </dl>
          <section className="grid gap-3" aria-labelledby="work-arrangement-version-history-title">
            <h3
              className="m-0 text-sm font-[670] text-midnight"
              id="work-arrangement-version-history-title"
            >
              Version history
            </h3>
            <div className="grid gap-3">
              {detail.versions.map((version) => (
                <article
                  className="grid gap-3 rounded-[3px] border border-line bg-canvas px-4 py-3 text-sm"
                  key={version.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-ink">Version {version.versionNo}</strong>
                    <StatusBadge status={version.versionState} />
                  </div>
                  <dl className="grid gap-2 text-xs min-[621px]:grid-cols-2">
                    <VersionMeta label="Effectivity">
                      {dateLabel(version.effectiveFrom)}
                      {version.effectiveTo
                        ? ' – ' + dateLabel(version.effectiveTo)
                        : ' – open-ended'}
                    </VersionMeta>
                    <VersionMeta label="Arrangement type">
                      {label(version.arrangementType)}
                    </VersionMeta>
                    <VersionMeta label="Permitted schedule types">
                      {version.permittedScheduleTypes.map((entry) => label(entry)).join(', ')}
                    </VersionMeta>
                    <VersionMeta label="Holiday Calendar">
                      {calendarName(version.holidayCalendarId)}
                    </VersionMeta>
                    <VersionMeta label="Approving authority">
                      {version.approvingAuthority ?? 'Not recorded'}
                    </VersionMeta>
                    <VersionMeta label="Activated">
                      {version.activatedAt ? dateLabel(version.activatedAt) : 'Not activated'}
                    </VersionMeta>
                  </dl>
                </article>
              ))}
            </div>
          </section>
          <TransitionHistory history={detail.history} id="work-arrangement-audit-history-title" />
        </div>
      ) : null}
      <DialogFooter className="-mx-6 mt-6 border-t-0 px-0 pb-0 min-[621px]:-mx-8 min-[621px]:px-0">
        <DialogClose asChild>
          <Button size="default" type="button" variant="secondary">
            Close
          </Button>
        </DialogClose>
      </DialogFooter>
    </DialogBody>
  );
}

function HolidayCalendarDetailBody({
  detail,
  detailLoading,
  error,
}: {
  detail: HolidayCalendarDetail | null;
  detailLoading: boolean;
  error: string;
}) {
  return (
    <DialogBody>
      {detailLoading ? (
        <p className="m-0 text-sm text-muted">Loading Holiday Calendar history…</p>
      ) : null}
      {error ? <FormError message={error} /> : null}
      {detail ? (
        <div className="grid gap-7">
          <dl className="grid gap-4 text-sm min-[621px]:grid-cols-2">
            <VersionMeta label="Code">{detail.calendar.code}</VersionMeta>
            <VersionMeta label="Name">{detail.calendar.name}</VersionMeta>
            <VersionMeta label="Scope">
              {label(detail.calendar.scopeType)} · {detail.calendar.scopeReference}
            </VersionMeta>
            <VersionMeta label="Effective on">{dateLabel(detail.asOf)}</VersionMeta>
            <VersionMeta label="Effective version">
              {detail.effective
                ? 'v' +
                  detail.effective.versionNo +
                  ' · ' +
                  detail.effective.entries.length +
                  (detail.effective.entries.length === 1 ? ' entry' : ' entries')
                : 'No effective version'}
            </VersionMeta>
          </dl>
          <section className="grid gap-3" aria-labelledby="holiday-calendar-version-history-title">
            <h3
              className="m-0 text-sm font-[670] text-midnight"
              id="holiday-calendar-version-history-title"
            >
              Version history
            </h3>
            <div className="grid gap-3">
              {detail.versions.map((version) => (
                <article
                  className="grid gap-3 rounded-[3px] border border-line bg-canvas px-4 py-3 text-sm"
                  key={version.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-ink">Version {version.versionNo}</strong>
                    <StatusBadge status={version.versionState} />
                  </div>
                  <dl className="grid gap-2 text-xs min-[621px]:grid-cols-2">
                    <VersionMeta label="Effectivity">
                      {dateLabel(version.effectiveFrom)}
                      {version.effectiveTo
                        ? ' – ' + dateLabel(version.effectiveTo)
                        : ' – open-ended'}
                    </VersionMeta>
                    <VersionMeta label="Approving authority">
                      {version.approvingAuthority ?? 'Not recorded'}
                    </VersionMeta>
                    <VersionMeta label="Activated">
                      {version.activatedAt ? dateLabel(version.activatedAt) : 'Not activated'}
                    </VersionMeta>
                    <VersionMeta label="Entries">{version.entries.length.toString()}</VersionMeta>
                  </dl>
                  {version.entries.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[560px] border-collapse text-left text-xs">
                        <thead className="bg-paper text-[10px] tracking-[0.07em] text-muted uppercase">
                          <tr>
                            <th className="px-3 py-2 font-bold" scope="col">
                              Date
                            </th>
                            <th className="px-3 py-2 font-bold" scope="col">
                              Holiday
                            </th>
                            <th className="px-3 py-2 font-bold" scope="col">
                              Day type
                            </th>
                            <th className="px-3 py-2 font-bold" scope="col">
                              Source
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {version.entries.map((entry) => (
                            <tr key={entry.id}>
                              <td className="px-3 py-2 text-ink">{dateLabel(entry.holidayDate)}</td>
                              <td className="px-3 py-2 text-ink">{entry.name}</td>
                              <td className="px-3 py-2 text-ink">{label(entry.dayType)}</td>
                              <td className="px-3 py-2 text-muted">{entry.sourceReference}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="m-0 text-xs text-muted">No holiday entries in this version.</p>
                  )}
                </article>
              ))}
            </div>
          </section>
          <TransitionHistory history={detail.history} id="holiday-calendar-audit-history-title" />
        </div>
      ) : null}
      <DialogFooter className="-mx-6 mt-6 border-t-0 px-0 pb-0 min-[621px]:-mx-8 min-[621px]:px-0">
        <DialogClose asChild>
          <Button size="default" type="button" variant="secondary">
            Close
          </Button>
        </DialogClose>
      </DialogFooter>
    </DialogBody>
  );
}

function HolidayCalendarDefinitionFields({
  dialog,
  setValue,
  values,
}: {
  dialog: DialogKind;
  setValue: <K extends keyof HolidayCalendarFormValues>(
    field: K,
    value: HolidayCalendarFormValues[K],
  ) => void;
  values: HolidayCalendarFormValues;
}) {
  const creating = dialog === 'calendar-create';
  function setEntry(index: number, patch: Partial<HolidayEntryForm>): void {
    setValue(
      'entries',
      values.entries.map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry,
      ),
    );
  }
  return (
    <>
      <fieldset className="grid gap-4">
        <legend className="mb-1 text-sm font-[670] text-midnight">Calendar definition</legend>
        {creating ? (
          <div className="grid gap-4 min-[621px]:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
            <Field htmlFor="holiday-calendar-code" label="Holiday Calendar code">
              <input
                autoFocus
                className={inputClass}
                data-autofocus=""
                id="holiday-calendar-code"
                maxLength={80}
                onChange={(event) => setValue('code', targetValue(event))}
                required
                value={values.code}
              />
            </Field>
            <Field htmlFor="holiday-calendar-name" label="Holiday Calendar name">
              <input
                className={inputClass}
                id="holiday-calendar-name"
                maxLength={200}
                onChange={(event) => setValue('name', targetValue(event))}
                required
                value={values.name}
              />
            </Field>
          </div>
        ) : null}
        <div className="grid gap-4 min-[621px]:grid-cols-3">
          <Field htmlFor="holiday-calendar-scope-type" label="Calendar scope">
            <select
              className={inputClass}
              disabled={!creating}
              id="holiday-calendar-scope-type"
              onChange={(event) =>
                setValue('scopeType', targetValue(event) as HolidayCalendarScopeType)
              }
              value={values.scopeType}
            >
              {holidayCalendarScopeTypes.map((entry) => (
                <option key={entry} value={entry}>
                  {label(entry)}
                </option>
              ))}
            </select>
          </Field>
          <Field htmlFor="holiday-calendar-scope-reference" label="Scope reference">
            <input
              className={inputClass}
              disabled={!creating}
              id="holiday-calendar-scope-reference"
              maxLength={300}
              onChange={(event) => setValue('scopeReference', targetValue(event))}
              required
              value={values.scopeReference}
            />
          </Field>
          <Field htmlFor="holiday-calendar-effective-date" label="Effective date">
            <input
              className={inputClass}
              id="holiday-calendar-effective-date"
              onChange={(event) => setValue('effectiveDate', targetValue(event))}
              required
              type="date"
              value={values.effectiveDate}
            />
          </Field>
        </div>
      </fieldset>
      <section className="grid gap-4" aria-labelledby="holiday-calendar-entries-title">
        <div className="border-b-2 border-midnight pb-3">
          <p className="m-0 text-[10px] font-bold tracking-[0.09em] text-cobalt uppercase">
            Holiday entries
          </p>
          <h3
            className="m-0 mt-1 text-base font-[700] text-midnight"
            id="holiday-calendar-entries-title"
          >
            One row per holiday date and day type
          </h3>
        </div>
        {values.entries.length === 0 ? (
          <p className="m-0 text-xs text-muted">
            A version needs at least one entry before it can be activated.
          </p>
        ) : null}
        {values.entries.map((entry, index) => (
          <div
            className="grid items-end gap-3 rounded-[3px] border border-line bg-canvas px-4 py-3 min-[900px]:grid-cols-[150px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
            key={index}
          >
            <label className="grid gap-1 text-xs font-[650] text-ink">
              <span>Holiday date</span>
              <input
                aria-label={'Holiday date ' + (index + 1)}
                className={inputClass + ' min-h-9'}
                onChange={(event) => setEntry(index, { holidayDate: targetValue(event) })}
                required
                type="date"
                value={entry.holidayDate}
              />
            </label>
            <label className="grid gap-1 text-xs font-[650] text-ink">
              <span>Holiday</span>
              <input
                aria-label={'Holiday name ' + (index + 1)}
                className={inputClass + ' min-h-9'}
                maxLength={200}
                onChange={(event) => setEntry(index, { name: targetValue(event) })}
                required
                value={entry.name}
              />
            </label>
            <label className="grid gap-1 text-xs font-[650] text-ink">
              <span>Day type</span>
              <select
                aria-label={'Holiday day type ' + (index + 1)}
                className={inputClass + ' min-h-9'}
                onChange={(event) =>
                  setEntry(index, { dayType: targetValue(event) as HolidayDayType })
                }
                value={entry.dayType}
              >
                {holidayDayTypes.map((value) => (
                  <option key={value} value={value}>
                    {label(value)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-[650] text-ink">
              <span>Source</span>
              <input
                aria-label={'Holiday source ' + (index + 1)}
                className={inputClass + ' min-h-9'}
                maxLength={300}
                onChange={(event) => setEntry(index, { sourceReference: targetValue(event) })}
                required
                value={entry.sourceReference}
              />
            </label>
            <Button
              className="min-h-9 px-3 text-xs"
              onClick={() =>
                setValue(
                  'entries',
                  values.entries.filter((_, position) => position !== index),
                )
              }
              size="default"
              type="button"
              variant="secondary"
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          className="min-h-9 w-fit px-3 text-xs"
          disabled={values.entries.length >= 400}
          onClick={() =>
            setValue('entries', [
              ...values.entries,
              {
                holidayDate: values.effectiveDate,
                name: '',
                dayType: 'REGULAR_HOLIDAY',
                sourceReference: '',
              },
            ])
          }
          size="default"
          type="button"
          variant="secondary"
        >
          Add holiday entry
        </Button>
      </section>
    </>
  );
}

function AssignmentDefinitionFields({
  arrangements,
  employees,
  employeesError,
  evidenceLoading,
  evidenceOptions,
  schedules,
  setValue,
  values,
}: {
  arrangements: WorkArrangement[];
  employees: EmployeeOption[];
  employeesError: string;
  evidenceLoading: boolean;
  evidenceOptions: EvidenceOption[];
  schedules: WorkSchedule[];
  setValue: <K extends keyof AssignmentFormValues>(
    field: K,
    value: AssignmentFormValues[K],
  ) => void;
  values: AssignmentFormValues;
}) {
  const scheduleOptions = scheduleVersionOptions(schedules);
  const arrangementOptions = arrangementVersionOptions(arrangements);
  return (
    <fieldset className="grid gap-4">
      <legend className="mb-1 text-sm font-[670] text-midnight">Assignment definition</legend>
      <Field htmlFor="assignment-employee" label="Employee">
        <select
          autoFocus
          className={inputClass}
          data-autofocus=""
          disabled={employees.length === 0}
          id="assignment-employee"
          onChange={(event) => setValue('employeeId', targetValue(event))}
          required
          value={values.employeeId}
        >
          <option value="">
            {employeesError
              ? employeesError
              : employees.length === 0
                ? 'No Employees are available'
                : 'Select an Employee'}
          </option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.employeeNumber + ' · ' + employee.legalName}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid gap-4 min-[621px]:grid-cols-2">
        <Field htmlFor="assignment-schedule-version" label="Work Schedule Version">
          <select
            className={inputClass}
            disabled={scheduleOptions.length === 0}
            id="assignment-schedule-version"
            onChange={(event) => setValue('workScheduleVersionId', targetValue(event))}
            required
            value={values.workScheduleVersionId}
          >
            <option value="">
              {scheduleOptions.length === 0
                ? 'No active Work Schedule Versions'
                : 'Select a Work Schedule Version'}
            </option>
            {scheduleOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field htmlFor="assignment-arrangement-version" label="Work Arrangement Version">
          <select
            className={inputClass}
            disabled={arrangementOptions.length === 0}
            id="assignment-arrangement-version"
            onChange={(event) => setValue('workArrangementVersionId', targetValue(event))}
            required
            value={values.workArrangementVersionId}
          >
            <option value="">
              {arrangementOptions.length === 0
                ? 'No active Work Arrangement Versions'
                : 'Select a Work Arrangement Version'}
            </option>
            {arrangementOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid gap-4 min-[621px]:grid-cols-2">
        <Field htmlFor="assignment-effective-from" label="Effective from">
          <input
            className={inputClass}
            id="assignment-effective-from"
            onChange={(event) => setValue('effectiveFrom', targetValue(event))}
            required
            type="date"
            value={values.effectiveFrom}
          />
        </Field>
        <Field htmlFor="assignment-evidence" label="Authority Document Version">
          <select
            className={inputClass}
            disabled={evidenceLoading}
            id="assignment-evidence"
            onChange={(event) => setValue('authorityDocumentVersionId', targetValue(event))}
            required
            value={values.authorityDocumentVersionId}
          >
            <option value="">
              {evidenceLoading ? 'Loading Document Versions…' : 'Select a finalized Document'}
            </option>
            {evidenceOptions.map((option) => (
              <option key={option.version.id} value={option.version.id}>
                {(option.documentNo ?? option.documentType) +
                  ' · version ' +
                  option.version.versionNo}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </fieldset>
  );
}

function AssignmentEndFields({
  assignment,
  setValue,
  values,
}: {
  assignment: ScheduleAssignment | null;
  setValue: <K extends keyof AssignmentEndValues>(field: K, value: AssignmentEndValues[K]) => void;
  values: AssignmentEndValues;
}) {
  const minimum = assignment ? assignment.effectiveFrom : manilaToday();
  const floor = minimum > manilaToday() ? minimum : manilaToday();
  return (
    <fieldset className="grid gap-4">
      <legend className="mb-1 text-sm font-[670] text-midnight">End Assignment</legend>
      {assignment ? (
        <p className="m-0 rounded-[3px] bg-canvas px-4 py-3 text-sm leading-[1.6] text-muted">
          {assignment.employee.employeeNumber +
            ' · ' +
            assignment.employee.legalName +
            ' · ' +
            assignment.workScheduleCode +
            ' v' +
            assignment.workScheduleVersionNo +
            ' with ' +
            assignment.workArrangementCode +
            ' v' +
            assignment.workArrangementVersionNo +
            ' since ' +
            dateLabel(assignment.effectiveFrom) +
            '. Ending sets the last covered date; the record stays immutable afterwards.'}
        </p>
      ) : null}
      <div className="grid gap-4 min-[621px]:grid-cols-2">
        <Field htmlFor="assignment-end-date" label="Effective to">
          <input
            className={inputClass}
            id="assignment-end-date"
            min={floor}
            onChange={(event) => setValue('effectiveTo', targetValue(event))}
            required
            type="date"
            value={values.effectiveTo}
          />
        </Field>
      </div>
      <Field htmlFor="assignment-end-reason" label="End reason">
        <textarea
          className={inputClass}
          id="assignment-end-reason"
          maxLength={500}
          onChange={(event) => setValue('reason', targetValue(event))}
          required
          rows={3}
          value={values.reason}
        />
      </Field>
    </fieldset>
  );
}

function ResolutionResult({ resolution }: { resolution: AttendanceResolution }) {
  const day = resolution.dayRule;
  return (
    <dl
      className="grid gap-4 rounded-[3px] border border-line bg-canvas px-4 py-4 text-sm min-[621px]:grid-cols-2"
      aria-label="Resolved configuration"
    >
      <VersionMeta label="Employee">
        {resolution.assignment.employee.employeeNumber +
          ' · ' +
          resolution.assignment.employee.legalName}
      </VersionMeta>
      <VersionMeta label="Work date">{dateLabel(resolution.workDate)}</VersionMeta>
      <VersionMeta label="Work Schedule">
        {resolution.assignment.workScheduleCode +
          ' v' +
          resolution.workScheduleVersion.versionNo +
          ' · ' +
          label(resolution.workScheduleVersion.scheduleType)}
      </VersionMeta>
      <VersionMeta label="Work Arrangement">
        {resolution.assignment.workArrangementCode +
          ' v' +
          resolution.workArrangementVersion.versionNo +
          ' · ' +
          label(resolution.workArrangementVersion.arrangementType)}
      </VersionMeta>
      <VersionMeta label="Holiday Calendar">
        {'v' + resolution.holidayCalendarVersion.versionNo}
      </VersionMeta>
      <VersionMeta label="Day rule">
        {weekdayLabels[day.weekday] + ' · ' + label(day.ruleType) + ' · ' + ruleWindow(day)}
      </VersionMeta>
      <VersionMeta label="Holiday entries">
        {resolution.holidayEntries.length
          ? resolution.holidayEntries
              .map((entry) => entry.name + ' (' + label(entry.dayType) + ')')
              .join(', ')
          : 'No holiday entry on this date'}
      </VersionMeta>
    </dl>
  );
}

function DayRuleEditor({
  onChange,
  rule,
}: {
  onChange: (rule: DayRuleForm) => void;
  rule: DayRuleForm;
}) {
  const id = 'day-rule-' + rule.weekday;
  function update(patch: Partial<DayRuleForm>): void {
    onChange({ ...rule, ...patch });
  }
  function setBreak(index: number, patch: Partial<BreakForm>): void {
    update({
      breaks: rule.breaks.map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry,
      ),
    });
  }
  return (
    <section
      aria-labelledby={id + '-title'}
      className="grid gap-4 rounded-[3px] border border-line bg-canvas px-4 py-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="m-0 text-sm font-[690] text-midnight" id={id + '-title'}>
          {weekdayLabels[rule.weekday]}
        </h4>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs font-[650] text-ink">
            <span>Day rule</span>
            <select
              className={inputClass + ' min-h-9 w-auto'}
              id={id + '-type'}
              onChange={(event) =>
                onChange(defaultDayRule(rule.weekday, targetValue(event) as DayRuleType))
              }
              value={rule.ruleType}
            >
              {ruleTypes.map((entry) => (
                <option key={entry} value={entry}>
                  {label(entry)}
                </option>
              ))}
            </select>
          </label>
          {rule.ruleType !== 'REST' ? (
            <label className="grid gap-1 text-xs font-[650] text-ink">
              <span>Required minutes</span>
              <input
                className={inputClass + ' min-h-9 w-[130px]'}
                min="1"
                onChange={(event) => update({ requiredMinutes: targetValue(event) })}
                required
                type="number"
                value={rule.requiredMinutes}
              />
            </label>
          ) : null}
        </div>
      </header>
      {rule.ruleType === 'FIXED' ? (
        <div className="grid gap-3 min-[700px]:grid-cols-3">
          <Field htmlFor={id + '-duty-start'} label="Duty start">
            <input
              className={inputClass + ' min-h-9'}
              id={id + '-duty-start'}
              onChange={(event) => update({ dutyStartTime: targetValue(event) })}
              required
              type="time"
              value={rule.dutyStartTime}
            />
          </Field>
          <Field htmlFor={id + '-duty-end'} label="Duty end">
            <input
              className={inputClass + ' min-h-9'}
              id={id + '-duty-end'}
              onChange={(event) => update({ dutyEndTime: targetValue(event) })}
              required
              type="time"
              value={rule.dutyEndTime}
            />
          </Field>
          <label className="flex min-h-9 items-center gap-2 self-end text-xs font-[650] text-ink">
            <input
              checked={rule.endNextCalendarDay}
              onChange={(event) => update({ endNextCalendarDay: targetChecked(event) })}
              type="checkbox"
            />
            Duty ends on the next calendar day
          </label>
        </div>
      ) : null}
      {rule.ruleType === 'FLEXIBLE' ? (
        <div className="grid gap-3 min-[700px]:grid-cols-3">
          <Field htmlFor={id + '-earliest-start'} label="Earliest start">
            <input
              className={inputClass + ' min-h-9'}
              id={id + '-earliest-start'}
              onChange={(event) => update({ earliestStartTime: targetValue(event) })}
              required
              type="time"
              value={rule.earliestStartTime}
            />
          </Field>
          <Field htmlFor={id + '-latest-start'} label="Latest start">
            <input
              className={inputClass + ' min-h-9'}
              id={id + '-latest-start'}
              onChange={(event) => update({ latestStartTime: targetValue(event) })}
              required
              type="time"
              value={rule.latestStartTime}
            />
          </Field>
          <Field htmlFor={id + '-duty-end'} label="Duty end">
            <input
              className={inputClass + ' min-h-9'}
              id={id + '-duty-end'}
              onChange={(event) => update({ dutyEndTime: targetValue(event) })}
              required
              type="time"
              value={rule.dutyEndTime}
            />
          </Field>
          <Field htmlFor={id + '-core-start'} label="Core start (optional)">
            <input
              className={inputClass + ' min-h-9'}
              id={id + '-core-start'}
              onChange={(event) => update({ coreStartTime: targetValue(event) })}
              type="time"
              value={rule.coreStartTime}
            />
          </Field>
          <Field htmlFor={id + '-core-end'} label="Core end (optional)">
            <input
              className={inputClass + ' min-h-9'}
              id={id + '-core-end'}
              onChange={(event) => update({ coreEndTime: targetValue(event) })}
              type="time"
              value={rule.coreEndTime}
            />
          </Field>
          <label className="flex min-h-9 items-center gap-2 self-end text-xs font-[650] text-ink">
            <input
              checked={rule.endNextCalendarDay}
              onChange={(event) => update({ endNextCalendarDay: targetChecked(event) })}
              type="checkbox"
            />
            Duty ends on the next calendar day
          </label>
        </div>
      ) : null}
      {rule.ruleType !== 'REST' ? (
        <>
          <div className="grid gap-3 min-[700px]:grid-cols-3">
            <Field htmlFor={id + '-event-pattern'} label="Break events">
              <select
                className={inputClass + ' min-h-9'}
                id={id + '-event-pattern'}
                onChange={(event) => update({ eventPattern: targetValue(event) as EventPattern })}
                value={rule.eventPattern}
              >
                {eventPatterns.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry === 'IN_OUT' ? 'Clock in and out only' : 'Explicit break events'}
                  </option>
                ))}
              </select>
            </Field>
            <Field htmlFor={id + '-collection-before'} label="Collection opens before (minutes)">
              <input
                className={inputClass + ' min-h-9'}
                id={id + '-collection-before'}
                min="0"
                onChange={(event) => update({ collectionBeforeMinutes: targetValue(event) })}
                type="number"
                value={rule.collectionBeforeMinutes}
              />
            </Field>
            <Field htmlFor={id + '-collection-after'} label="Collection closes after (minutes)">
              <input
                className={inputClass + ' min-h-9'}
                id={id + '-collection-after'}
                min="0"
                onChange={(event) => update({ collectionAfterMinutes: targetValue(event) })}
                type="number"
                value={rule.collectionAfterMinutes}
              />
            </Field>
          </div>
          <div className="grid gap-2">
            <span className="text-xs font-[650] text-ink">Unpaid break intervals</span>
            {rule.breaks.length === 0 ? (
              <span className="text-xs text-muted">No unpaid breaks.</span>
            ) : null}
            {rule.breaks.map((entry, index) => (
              <div className="flex flex-wrap items-end gap-3" key={index}>
                <label className="grid gap-1 text-xs text-muted">
                  <span>Break start</span>
                  <input
                    aria-label={weekdayLabels[rule.weekday] + ' break start ' + (index + 1)}
                    className={inputClass + ' min-h-9 w-auto'}
                    onChange={(event) => setBreak(index, { breakStartTime: targetValue(event) })}
                    required
                    type="time"
                    value={entry.breakStartTime}
                  />
                </label>
                <label className="grid gap-1 text-xs text-muted">
                  <span>Break end</span>
                  <input
                    aria-label={weekdayLabels[rule.weekday] + ' break end ' + (index + 1)}
                    className={inputClass + ' min-h-9 w-auto'}
                    onChange={(event) => setBreak(index, { breakEndTime: targetValue(event) })}
                    required
                    type="time"
                    value={entry.breakEndTime}
                  />
                </label>
                <label className="flex min-h-9 items-center gap-2 text-xs text-ink">
                  <input
                    checked={entry.endNextCalendarDay}
                    onChange={(event) =>
                      setBreak(index, { endNextCalendarDay: targetChecked(event) })
                    }
                    type="checkbox"
                  />
                  Ends next calendar day
                </label>
                <Button
                  className="min-h-9 px-3 text-xs"
                  onClick={() =>
                    update({ breaks: rule.breaks.filter((_, position) => position !== index) })
                  }
                  size="default"
                  type="button"
                  variant="secondary"
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              className="min-h-9 w-fit px-3 text-xs"
              disabled={rule.breaks.length >= 12}
              onClick={() =>
                update({
                  breaks: [
                    ...rule.breaks,
                    { breakStartTime: '12:00', breakEndTime: '13:00', endNextCalendarDay: false },
                  ],
                })
              }
              size="default"
              type="button"
              variant="secondary"
            >
              Add unpaid break
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function ScheduleDefinitionFields({
  dialog,
  setValue,
  values,
}: {
  dialog: DialogKind;
  setValue: <K extends keyof ScheduleFormValues>(field: K, value: ScheduleFormValues[K]) => void;
  values: ScheduleFormValues;
}) {
  const creating = dialog === 'schedule-create';
  return (
    <>
      <section className="grid gap-4" aria-labelledby="work-schedule-definition-title">
        <div className="border-b-2 border-midnight pb-3">
          <p className="m-0 text-[10px] font-bold tracking-[0.09em] text-cobalt uppercase">
            Work Schedule record
          </p>
          <h3
            className="m-0 mt-1 text-base font-[700] text-midnight"
            id="work-schedule-definition-title"
          >
            Schedule definition
          </h3>
        </div>
        {creating ? (
          <div className="grid gap-4 min-[621px]:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
            <Field htmlFor="work-schedule-code" label="Work Schedule code">
              <input
                autoFocus
                className={inputClass}
                data-autofocus=""
                id="work-schedule-code"
                maxLength={80}
                onChange={(event) => setValue('code', targetValue(event))}
                required
                value={values.code}
              />
            </Field>
            <Field htmlFor="work-schedule-name" label="Work Schedule name">
              <input
                className={inputClass}
                id="work-schedule-name"
                maxLength={200}
                onChange={(event) => setValue('name', targetValue(event))}
                required
                value={values.name}
              />
            </Field>
          </div>
        ) : null}
        <div className="grid gap-4 min-[621px]:grid-cols-3">
          <Field htmlFor="work-schedule-type" label="Schedule type">
            <select
              className={inputClass}
              id="work-schedule-type"
              onChange={(event) => setValue('scheduleType', targetValue(event) as ScheduleType)}
              value={values.scheduleType}
            >
              {scheduleTypes.map((entry) => (
                <option key={entry} value={entry}>
                  {label(entry)}
                </option>
              ))}
            </select>
          </Field>
          <Field htmlFor="work-schedule-timezone" label="Time zone">
            <input
              className={inputClass}
              id="work-schedule-timezone"
              maxLength={100}
              onChange={(event) => setValue('timezone', targetValue(event))}
              required
              value={values.timezone}
            />
          </Field>
          <Field htmlFor="work-schedule-effective-date" label="Effective date">
            <input
              className={inputClass}
              id="work-schedule-effective-date"
              onChange={(event) => setValue('effectiveDate', targetValue(event))}
              required
              type="date"
              value={values.effectiveDate}
            />
          </Field>
        </div>
      </section>
      <section className="grid gap-4" aria-labelledby="work-schedule-rules-title">
        <div className="border-b-2 border-midnight pb-3">
          <p className="m-0 text-[10px] font-bold tracking-[0.09em] text-cobalt uppercase">
            Seven-day rule matrix
          </p>
          <h3
            className="m-0 mt-1 text-base font-[700] text-midnight"
            id="work-schedule-rules-title"
          >
            One rule per weekday
          </h3>
        </div>
        {values.dayRules.map((rule) => (
          <DayRuleEditor
            key={rule.weekday}
            onChange={(next) =>
              setValue(
                'dayRules',
                values.dayRules.map((entry) => (entry.weekday === rule.weekday ? next : entry)),
              )
            }
            rule={rule}
          />
        ))}
      </section>
    </>
  );
}

function ArrangementDefinitionFields({
  calendars,
  dialog,
  setValue,
  values,
}: {
  calendars: HolidayCalendar[];
  dialog: DialogKind | null;
  setValue: <K extends keyof ArrangementFormValues>(
    field: K,
    value: ArrangementFormValues[K],
  ) => void;
  values: ArrangementFormValues;
}) {
  const creating = dialog === 'arrangement-create';
  return (
    <fieldset className="grid gap-4">
      <legend className="mb-1 text-sm font-[670] text-midnight">Arrangement definition</legend>
      {creating ? (
        <div className="grid gap-4 min-[621px]:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
          <Field htmlFor="work-arrangement-code" label="Work Arrangement code">
            <input
              autoFocus
              className={inputClass}
              data-autofocus=""
              id="work-arrangement-code"
              maxLength={80}
              onChange={(event) => setValue('code', targetValue(event))}
              required
              value={values.code}
            />
          </Field>
          <Field htmlFor="work-arrangement-name" label="Work Arrangement name">
            <input
              className={inputClass}
              id="work-arrangement-name"
              maxLength={200}
              onChange={(event) => setValue('name', targetValue(event))}
              required
              value={values.name}
            />
          </Field>
        </div>
      ) : null}
      <div className="grid gap-4 min-[621px]:grid-cols-3">
        <Field htmlFor="work-arrangement-type" label="Arrangement type">
          <select
            className={inputClass}
            id="work-arrangement-type"
            onChange={(event) => setValue('arrangementType', targetValue(event) as ArrangementType)}
            value={values.arrangementType}
          >
            {arrangementTypes.map((entry) => (
              <option key={entry} value={entry}>
                {label(entry)}
              </option>
            ))}
          </select>
        </Field>
        <Field htmlFor="work-arrangement-calendar" label="Holiday Calendar">
          <select
            className={inputClass}
            id="work-arrangement-calendar"
            onChange={(event) => setValue('holidayCalendarId', targetValue(event))}
            required
            value={values.holidayCalendarId}
          >
            <option value="">Select a Holiday Calendar</option>
            {calendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.code} · {calendar.name}
              </option>
            ))}
          </select>
        </Field>
        <Field htmlFor="work-arrangement-effective-date" label="Effective date">
          <input
            className={inputClass}
            id="work-arrangement-effective-date"
            onChange={(event) => setValue('effectiveDate', targetValue(event))}
            required
            type="date"
            value={values.effectiveDate}
          />
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-xs font-[650] text-ink">Permitted schedule types</legend>
        <div className="flex flex-wrap gap-3">
          {scheduleTypes.map((entry) => (
            <label
              className="flex min-h-11 items-center gap-2 rounded-[3px] border border-line px-3 text-sm text-ink"
              key={entry}
            >
              <input
                checked={values.permittedScheduleTypes.includes(entry)}
                onChange={(event) =>
                  setValue(
                    'permittedScheduleTypes',
                    targetChecked(event)
                      ? [...values.permittedScheduleTypes, entry]
                      : values.permittedScheduleTypes.filter((value) => value !== entry),
                  )
                }
                type="checkbox"
              />
              {label(entry)}
            </label>
          ))}
        </div>
      </fieldset>
    </fieldset>
  );
}

function ActivationForm({
  error,
  evidenceLoading,
  evidenceOptions,
  onSubmit,
  setActivation,
  activation,
}: {
  activation: ActivationValues;
  error: string;
  evidenceLoading: boolean;
  evidenceOptions: EvidenceOption[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  setActivation: (values: ActivationValues) => void;
}) {
  return (
    <form onSubmit={(event) => void onSubmit(event)}>
      <DialogBody className="grid gap-5">
        {error ? <FormError message={error} /> : null}
        <Field htmlFor="attendance-activation-evidence" label="Authority Document Version">
          <select
            className={inputClass}
            disabled={evidenceLoading}
            id="attendance-activation-evidence"
            onChange={(event) =>
              setActivation({
                ...activation,
                authorityDocumentVersionId: targetValue(event),
              })
            }
            required
            value={activation.authorityDocumentVersionId}
          >
            <option value="">
              {evidenceLoading ? 'Loading Document Versions…' : 'Select a finalized Document'}
            </option>
            {evidenceOptions.map((option) => (
              <option key={option.version.id} value={option.version.id}>
                {(option.documentNo ?? option.documentType) +
                  ' · version ' +
                  option.version.versionNo}
              </option>
            ))}
          </select>
        </Field>
        <Field htmlFor="attendance-activation-authority" label="Approving authority">
          <input
            className={inputClass}
            id="attendance-activation-authority"
            maxLength={300}
            onChange={(event) =>
              setActivation({ ...activation, approvingAuthority: targetValue(event) })
            }
            required
            value={activation.approvingAuthority}
          />
        </Field>
        <Field htmlFor="attendance-activation-reason" label="Activation reason">
          <textarea
            className={inputClass}
            id="attendance-activation-reason"
            maxLength={500}
            onChange={(event) => setActivation({ ...activation, reason: targetValue(event) })}
            required
            rows={3}
            value={activation.reason}
          />
        </Field>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button disabled={false} size="default" type="button" variant="secondary">
            Cancel
          </Button>
        </DialogClose>
        <Button disabled={evidenceLoading} size="default" type="submit" variant="primary">
          Activate Version
        </Button>
      </DialogFooter>
    </form>
  );
}

export function AttendanceConfigurationWorkspace({
  agencyId,
  arrangements: initialArrangements,
  canActivate,
  canAssign,
  canManage,
  calendars: initialCalendars,
  schedules: initialSchedules,
}: {
  agencyId: string;
  arrangements: WorkArrangement[];
  canActivate: boolean;
  canAssign: boolean;
  canManage: boolean;
  calendars: HolidayCalendar[];
  schedules: WorkSchedule[];
}) {
  const [tab, setTab] = useState<'schedules' | 'arrangements' | 'calendars' | 'assignments'>(
    'schedules',
  );
  const [schedules, setSchedules] = useState(initialSchedules);
  const [arrangements, setArrangements] = useState(initialArrangements);
  const [calendars, setCalendars] = useState(initialCalendars);
  const [assignments, setAssignments] = useState<ScheduleAssignment[] | null>(null);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignmentsError, setAssignmentsError] = useState('');
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeesError, setEmployeesError] = useState('');
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [selectedSchedule, setSelectedSchedule] = useState<WorkSchedule | null>(null);
  const [selectedArrangement, setSelectedArrangement] = useState<WorkArrangement | null>(null);
  const [selectedCalendar, setSelectedCalendar] = useState<HolidayCalendar | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<ScheduleAssignment | null>(null);
  const [scheduleDetail, setScheduleDetail] = useState<WorkScheduleDetail | null>(null);
  const [arrangementDetail, setArrangementDetail] = useState<WorkArrangementDetail | null>(null);
  const [calendarDetail, setCalendarDetail] = useState<HolidayCalendarDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [scheduleValues, setScheduleValues] = useState(emptyScheduleValues);
  const [arrangementValues, setArrangementValues] = useState(() =>
    emptyArrangementValues(initialCalendars[0]?.id ?? ''),
  );
  const [calendarValues, setCalendarValues] = useState(emptyHolidayCalendarValues);
  const [assignmentValues, setAssignmentValues] = useState(emptyAssignmentValues);
  const [assignmentEndValues, setAssignmentEndValues] = useState<AssignmentEndValues>(() => ({
    effectiveTo: manilaToday(),
    reason: '',
  }));
  const [activation, setActivation] = useState(emptyActivation);
  const [evidenceOptions, setEvidenceOptions] = useState<EvidenceOption[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [resolutionEmployeeId, setResolutionEmployeeId] = useState('');
  const [resolutionDate, setResolutionDate] = useState(() => manilaToday());
  const [resolution, setResolution] = useState<AttendanceResolution | null>(null);
  const [resolutionError, setResolutionError] = useState('');
  const [resolutionBusy, setResolutionBusy] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');
  const returnFocusRef = useRef<{ focus(): void } | null>(null);
  const navigation = useRecordNavigation();
  const recordId = navigation.search.get('record');
  const recordKind =
    navigation.search.get('kind') === 'work-arrangement' ? 'work-arrangement' : 'work-schedule';

  useEffect(() => {
    let active = true;
    if (!recordId) {
      if (dialog === 'schedule-detail' || dialog === 'arrangement-detail') {
        setDialog(null);
        setSelectedSchedule(null);
        setSelectedArrangement(null);
        setScheduleDetail(null);
        setArrangementDetail(null);
      }
      return;
    }
    setSelectedSchedule(null);
    setSelectedArrangement(null);
    setScheduleDetail(null);
    setArrangementDetail(null);
    setError('');
    setDialog(recordKind === 'work-arrangement' ? 'arrangement-detail' : 'schedule-detail');
    setDetailLoading(true);
    const path =
      recordKind === 'work-arrangement'
        ? '/work-arrangements/' + encodeURIComponent(recordId)
        : '/work-schedules/' + encodeURIComponent(recordId);
    void request(path)
      .then((value) => {
        if (!active) return;
        if (recordKind === 'work-arrangement') {
          const next = value as WorkArrangementDetail;
          setArrangementDetail(next);
          setSelectedArrangement(next.arrangement);
        } else {
          const next = value as WorkScheduleDetail;
          setScheduleDetail(next);
          setSelectedSchedule(next.schedule);
        }
      })
      .catch((caught: unknown) => {
        if (active)
          setError(caught instanceof Error ? caught.message : 'This record is unavailable.');
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [recordId, recordKind]);

  useEffect(() => {
    if (
      dialog !== 'schedule-activate' &&
      dialog !== 'arrangement-activate' &&
      dialog !== 'calendar-activate' &&
      dialog !== 'assignment-create'
    ) {
      return;
    }
    let active = true;
    setEvidenceLoading(true);
    void fetch('/api/v1/agencies/' + agencyId + '/documents/versions', {
      credentials: 'include',
    })
      .then(async (response) => {
        const value: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error('Agency Document Versions could not be loaded.');
        if (active) setEvidenceOptions(parseEvidenceOptions(value));
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Agency Document Versions could not be loaded.',
          );
        }
      })
      .finally(() => {
        if (active) setEvidenceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [agencyId, dialog]);

  useEffect(() => {
    if (tab !== 'assignments' || employees.length > 0 || employeesError) return;
    let active = true;
    void fetch('/api/v1/agencies/' + agencyId + '/employees', { credentials: 'include' })
      .then(async (response) => {
        const value: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(errorMessage(value, 'The Employee list could not be loaded.'));
        }
        if (active) setEmployees(parseEmployeeOptions(value));
      })
      .catch((caught: unknown) => {
        if (active) {
          setEmployeesError(
            caught instanceof Error ? caught.message : 'The Employee list could not be loaded.',
          );
        }
      });
    return () => {
      active = false;
    };
  }, [agencyId, employees.length, employeesError, tab]);

  useEffect(() => {
    if (tab !== 'assignments' || assignments !== null || assignmentsError) {
      return;
    }
    let active = true;
    setAssignmentsLoading(true);
    void request('/schedule-assignments')
      .then((value) => {
        if (active) setAssignments(parseAssignments(value));
      })
      .catch((caught: unknown) => {
        if (active) {
          setAssignmentsError(
            caught instanceof Error
              ? caught.message
              : 'The Schedule Assignment list could not be loaded.',
          );
        }
      })
      .finally(() => {
        if (active) setAssignmentsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [assignments, assignmentsError, tab]);

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch('/api/v1/agencies/' + agencyId + path, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const exceptionType = (value as { error?: { exceptionType?: unknown } } | null)?.error
        ?.exceptionType;
      throw new AttendanceRequestError(
        errorMessage(value, 'The Attendance Configuration action failed.'),
        typeof exceptionType === 'string' ? exceptionType : null,
      );
    }
    return value;
  }

  async function refreshSchedules(): Promise<void> {
    const value = await request('/work-schedules');
    if (
      typeof value !== 'object' ||
      value === null ||
      !Array.isArray((value as { items?: unknown }).items)
    ) {
      throw new Error('The Work Schedule list response was invalid.');
    }
    setSchedules((value as WorkScheduleListResponse).items);
  }

  async function refreshArrangements(): Promise<void> {
    const value = await request('/work-arrangements');
    if (
      typeof value !== 'object' ||
      value === null ||
      !Array.isArray((value as { items?: unknown }).items)
    ) {
      throw new Error('The Work Arrangement list response was invalid.');
    }
    setArrangements((value as WorkArrangementListResponse).items);
  }

  async function refreshCalendars(): Promise<void> {
    const value = await request('/holiday-calendars');
    if (
      typeof value !== 'object' ||
      value === null ||
      !Array.isArray((value as { items?: unknown }).items)
    ) {
      throw new Error('The Holiday Calendar list response was invalid.');
    }
    setCalendars((value as HolidayCalendarListResponse).items);
  }

  async function refreshAssignments(): Promise<void> {
    const value = await request('/schedule-assignments');
    setAssignments(parseAssignments(value));
  }

  function resetAction(): void {
    setError('');
    setActivation(emptyActivation());
  }

  function openDialog(
    kind: DialogKind,
    target: { focus(): void },
    entity: WorkSchedule | WorkArrangement | HolidayCalendar | ScheduleAssignment | null,
  ): void {
    returnFocusRef.current = target;
    resetAction();
    if (kind.startsWith('schedule')) setSelectedSchedule(entity as WorkSchedule | null);
    else if (kind.startsWith('arrangement'))
      setSelectedArrangement(entity as WorkArrangement | null);
    else if (kind.startsWith('calendar')) setSelectedCalendar(entity as HolidayCalendar | null);
    else setSelectedAssignment(entity as ScheduleAssignment | null);
    setDialog(kind);
  }

  function closeDialog(force = false): void {
    if (busy && !force) return;
    const focusTarget = returnFocusRef.current;
    navigation.navigate({ record: null, view: null, kind: null });
    setDialog(null);
    setSelectedSchedule(null);
    setSelectedArrangement(null);
    setSelectedCalendar(null);
    setSelectedAssignment(null);
    setScheduleDetail(null);
    setArrangementDetail(null);
    setCalendarDetail(null);
    setTimeout(() => {
      focusTarget?.focus();
      setTimeout(() => focusTarget?.focus(), 0);
    }, 0);
  }

  function openDetail(
    kind: 'work-schedule' | 'work-arrangement',
    entity: WorkSchedule | WorkArrangement,
    target: { focus(): void },
  ): void {
    returnFocusRef.current = target;
    navigation.navigate({ record: entity.id, view: 'form', kind });
  }

  function openCalendarDetail(calendar: HolidayCalendar, target: { focus(): void }): void {
    returnFocusRef.current = target;
    resetAction();
    setSelectedCalendar(calendar);
    setCalendarDetail(null);
    setDialog('calendar-detail');
    setDetailLoading(true);
    void request('/holiday-calendars/' + encodeURIComponent(calendar.id))
      .then((value) => {
        setCalendarDetail(value as HolidayCalendarDetail);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'This record is unavailable.');
      })
      .finally(() => {
        setDetailLoading(false);
      });
  }

  async function submitSchedule(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !validForm(event)) return;
    setBusy(true);
    setError('');
    try {
      const creating = dialog === 'schedule-create';
      await request(
        creating
          ? '/work-schedules'
          : '/work-schedules/' + selectedSchedule?.id + '/drafts/' + selectedSchedule?.draft?.id,
        {
          method: creating ? 'POST' : 'PATCH',
          body: JSON.stringify(schedulePayload(scheduleValues, creating)),
        },
      );
      await refreshSchedules();
      setSuccess(
        creating
          ? 'Draft Work Schedule “' + scheduleValues.code + '” was created.'
          : 'Draft Work Schedule “' + scheduleValues.code + '” was updated.',
      );
      closeDialog(true);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : 'The Draft could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitArrangement(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !validForm(event)) return;
    setBusy(true);
    setError('');
    try {
      const creating = dialog === 'arrangement-create';
      await request(
        creating
          ? '/work-arrangements'
          : '/work-arrangements/' +
              selectedArrangement?.id +
              '/drafts/' +
              selectedArrangement?.draft?.id,
        {
          method: creating ? 'POST' : 'PATCH',
          body: JSON.stringify(arrangementPayload(arrangementValues, creating)),
        },
      );
      await refreshArrangements();
      setSuccess(
        creating
          ? 'Draft Work Arrangement “' + arrangementValues.code + '” was created.'
          : 'Draft Work Arrangement “' + arrangementValues.code + '” was updated.',
      );
      closeDialog(true);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : 'The Draft could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitHolidayCalendar(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !validForm(event)) return;
    setBusy(true);
    setError('');
    try {
      const creating = dialog === 'calendar-create';
      await request(
        creating
          ? '/holiday-calendars'
          : '/holiday-calendars/' + selectedCalendar?.id + '/drafts/' + selectedCalendar?.draft?.id,
        {
          method: creating ? 'POST' : 'PATCH',
          body: JSON.stringify(holidayCalendarPayload(calendarValues, creating)),
        },
      );
      await refreshCalendars();
      setSuccess(
        creating
          ? 'Draft Holiday Calendar “' + calendarValues.code + '” was created.'
          : 'Draft Holiday Calendar “' + calendarValues.code + '” was updated.',
      );
      closeDialog(true);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : 'The Draft could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitSuccessor(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      if (dialog === 'schedule-successor' && selectedSchedule) {
        await request('/work-schedules/' + selectedSchedule.id + '/successor', { method: 'POST' });
        await refreshSchedules();
        setSuccess('A Draft successor for “' + selectedSchedule.code + '” was created.');
      } else if (dialog === 'arrangement-successor' && selectedArrangement) {
        await request('/work-arrangements/' + selectedArrangement.id + '/successor', {
          method: 'POST',
        });
        await refreshArrangements();
        setSuccess('A Draft successor for “' + selectedArrangement.code + '” was created.');
      } else if (dialog === 'calendar-successor' && selectedCalendar) {
        await request('/holiday-calendars/' + selectedCalendar.id + '/successor', {
          method: 'POST',
        });
        await refreshCalendars();
        setSuccess('A Draft successor for “' + selectedCalendar.code + '” was created.');
      } else {
        return;
      }
      closeDialog(true);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The successor could not be created.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitActivation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !validForm(event)) return;
    setBusy(true);
    setError('');
    try {
      if (dialog === 'schedule-activate' && selectedSchedule?.draft) {
        await request(
          '/work-schedules/' +
            selectedSchedule.id +
            '/drafts/' +
            selectedSchedule.draft.id +
            '/activate',
          {
            method: 'POST',
            headers: { 'Idempotency-Key': crypto.randomUUID() },
            body: JSON.stringify(activation),
          },
        );
        await refreshSchedules();
        setSuccess('Work Schedule “' + selectedSchedule.code + '” was activated.');
      } else if (dialog === 'arrangement-activate' && selectedArrangement?.draft) {
        await request(
          '/work-arrangements/' +
            selectedArrangement.id +
            '/drafts/' +
            selectedArrangement.draft.id +
            '/activate',
          {
            method: 'POST',
            headers: { 'Idempotency-Key': crypto.randomUUID() },
            body: JSON.stringify(activation),
          },
        );
        await refreshArrangements();
        setSuccess('Work Arrangement “' + selectedArrangement.code + '” was activated.');
      } else if (dialog === 'calendar-activate' && selectedCalendar?.draft) {
        await request(
          '/holiday-calendars/' +
            selectedCalendar.id +
            '/drafts/' +
            selectedCalendar.draft.id +
            '/activate',
          {
            method: 'POST',
            headers: { 'Idempotency-Key': crypto.randomUUID() },
            body: JSON.stringify(activation),
          },
        );
        await refreshCalendars();
        setSuccess('Holiday Calendar “' + selectedCalendar.code + '” was activated.');
      } else {
        return;
      }
      closeDialog(true);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The version could not be activated.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitAssignment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !validForm(event)) return;
    setBusy(true);
    setError('');
    try {
      await request('/schedule-assignments', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(assignmentPayload(assignmentValues)),
      });
      await refreshAssignments();
      const employee = employees.find((option) => option.id === assignmentValues.employeeId);
      setSuccess(
        'Schedule Assignment for ' +
          (employee ? employee.employeeNumber + ' · ' + employee.legalName : 'the Employee') +
          ' was created.',
      );
      closeDialog(true);
    } catch (requestError: unknown) {
      setError(describeRequestError(requestError, 'The Schedule Assignment could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitAssignmentEnd(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !selectedAssignment || !validForm(event)) return;
    setBusy(true);
    setError('');
    try {
      await request('/schedule-assignments/' + selectedAssignment.id + '/end', {
        method: 'POST',
        body: JSON.stringify(assignmentEndValues),
      });
      await refreshAssignments();
      setSuccess(
        'Schedule Assignment for ' +
          selectedAssignment.employee.employeeNumber +
          ' ended on ' +
          dateLabel(assignmentEndValues.effectiveTo) +
          '.',
      );
      closeDialog(true);
    } catch (requestError: unknown) {
      setError(describeRequestError(requestError, 'The Schedule Assignment could not be ended.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitResolution(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (resolutionBusy || !validForm(event)) return;
    setResolutionBusy(true);
    setResolutionError('');
    setResolution(null);
    try {
      const value = await request(
        '/schedule-assignments/resolve?employeeId=' +
          encodeURIComponent(resolutionEmployeeId) +
          '&workDate=' +
          encodeURIComponent(resolutionDate),
      );
      setResolution(value as AttendanceResolution);
    } catch (requestError: unknown) {
      setResolutionError(
        describeRequestError(requestError, 'The Work date could not be resolved.'),
      );
    } finally {
      setResolutionBusy(false);
    }
  }

  function scheduleActions(schedule: WorkSchedule) {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="default"
          type="button"
          variant="secondary"
          onClick={(event) =>
            openDetail(
              'work-schedule',
              schedule,
              event.currentTarget as unknown as { focus(): void },
            )
          }
        >
          Details
        </Button>
        {schedule.draft && canManage ? (
          <Button
            size="default"
            type="button"
            variant="secondary"
            onClick={(event) => {
              setScheduleValues(
                scheduleValuesFrom(schedule, schedule.draft as WorkScheduleVersion),
              );
              openDialog(
                'schedule-edit',
                event.currentTarget as unknown as { focus(): void },
                schedule,
              );
            }}
          >
            Edit Draft
          </Button>
        ) : null}
        {schedule.draft && canActivate ? (
          <Button
            className="min-h-9 px-3 text-xs"
            size="default"
            type="button"
            variant="primary"
            onClick={(event) =>
              openDialog(
                'schedule-activate',
                event.currentTarget as unknown as { focus(): void },
                schedule,
              )
            }
          >
            Activate
          </Button>
        ) : null}
        {schedule.currentVersion && !schedule.draft && canManage ? (
          <Button
            size="default"
            type="button"
            variant="secondary"
            onClick={(event) =>
              openDialog(
                'schedule-successor',
                event.currentTarget as unknown as { focus(): void },
                schedule,
              )
            }
          >
            Create Successor
          </Button>
        ) : null}
      </div>
    );
  }

  function arrangementActions(arrangement: WorkArrangement) {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="default"
          type="button"
          variant="secondary"
          onClick={(event) =>
            openDetail(
              'work-arrangement',
              arrangement,
              event.currentTarget as unknown as { focus(): void },
            )
          }
        >
          Details
        </Button>
        {arrangement.draft && canManage ? (
          <Button
            size="default"
            type="button"
            variant="secondary"
            onClick={(event) => {
              setArrangementValues(
                arrangementValuesFrom(arrangement, arrangement.draft as WorkArrangementVersion),
              );
              openDialog(
                'arrangement-edit',
                event.currentTarget as unknown as { focus(): void },
                arrangement,
              );
            }}
          >
            Edit Draft
          </Button>
        ) : null}
        {arrangement.draft && canActivate ? (
          <Button
            className="min-h-9 px-3 text-xs"
            size="default"
            type="button"
            variant="primary"
            onClick={(event) =>
              openDialog(
                'arrangement-activate',
                event.currentTarget as unknown as { focus(): void },
                arrangement,
              )
            }
          >
            Activate
          </Button>
        ) : null}
        {arrangement.currentVersion && !arrangement.draft && canManage ? (
          <Button
            size="default"
            type="button"
            variant="secondary"
            onClick={(event) =>
              openDialog(
                'arrangement-successor',
                event.currentTarget as unknown as { focus(): void },
                arrangement,
              )
            }
          >
            Create Successor
          </Button>
        ) : null}
      </div>
    );
  }

  function calendarActions(calendar: HolidayCalendar) {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="default"
          type="button"
          variant="secondary"
          onClick={(event) =>
            openCalendarDetail(calendar, event.currentTarget as unknown as { focus(): void })
          }
        >
          Details
        </Button>
        {calendar.draft && canManage ? (
          <Button
            size="default"
            type="button"
            variant="secondary"
            onClick={(event) => {
              setCalendarValues(
                holidayCalendarValuesFrom(calendar, calendar.draft as HolidayCalendarVersion),
              );
              openDialog(
                'calendar-edit',
                event.currentTarget as unknown as { focus(): void },
                calendar,
              );
            }}
          >
            Edit Draft
          </Button>
        ) : null}
        {calendar.draft && canActivate ? (
          <Button
            className="min-h-9 px-3 text-xs"
            size="default"
            type="button"
            variant="primary"
            onClick={(event) =>
              openDialog(
                'calendar-activate',
                event.currentTarget as unknown as { focus(): void },
                calendar,
              )
            }
          >
            Activate
          </Button>
        ) : null}
        {calendar.currentVersion && !calendar.draft && canManage ? (
          <Button
            size="default"
            type="button"
            variant="secondary"
            onClick={(event) =>
              openDialog(
                'calendar-successor',
                event.currentTarget as unknown as { focus(): void },
                calendar,
              )
            }
          >
            Create Successor
          </Button>
        ) : null}
      </div>
    );
  }

  function assignmentActions(assignment: ScheduleAssignment) {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        {!assignment.effectiveTo && canAssign ? (
          <Button
            size="default"
            type="button"
            variant="secondary"
            onClick={(event) => {
              const floor =
                assignment.effectiveFrom > manilaToday() ? assignment.effectiveFrom : manilaToday();
              setAssignmentEndValues({ effectiveTo: floor, reason: '' });
              openDialog(
                'assignment-end',
                event.currentTarget as unknown as { focus(): void },
                assignment,
              );
            }}
          >
            End
          </Button>
        ) : null}
      </div>
    );
  }

  const editingSchedule = dialog === 'schedule-create' || dialog === 'schedule-edit';
  const editingArrangement = dialog === 'arrangement-create' || dialog === 'arrangement-edit';
  const editingCalendar = dialog === 'calendar-create' || dialog === 'calendar-edit';
  const showingForm =
    editingSchedule ||
    editingArrangement ||
    editingCalendar ||
    dialog === 'schedule-detail' ||
    dialog === 'arrangement-detail' ||
    dialog === 'calendar-detail' ||
    dialog === 'assignment-create' ||
    dialog === 'assignment-end';
  const selectedLabel =
    dialog?.startsWith('schedule') && selectedSchedule
      ? selectedSchedule.code
      : dialog?.startsWith('arrangement') && selectedArrangement
        ? selectedArrangement.code
        : dialog?.startsWith('calendar') && selectedCalendar
          ? selectedCalendar.code
          : dialog === 'assignment-end' && selectedAssignment
            ? selectedAssignment.employee.legalName
            : 'Attendance Configuration';
  const dialogDescriptionId = 'attendance-configuration-dialog-description';

  return (
    <Dialog
      presentation={showingForm ? 'form' : 'dialog'}
      open={dialog !== null}
      onOpenChange={(open) => !open && closeDialog()}
    >
      <div hidden={showingForm} className="min-w-0 space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div className="grid max-w-[760px] gap-2">
            <p className="m-0 text-[11px] font-bold tracking-[0.09em] text-cobalt uppercase">
              Attendance configuration
            </p>
            <h1 className="m-0 text-[clamp(28px,3vw,38px)] leading-[1.08] font-[680] tracking-[-0.035em] text-midnight">
              Attendance Configuration
            </h1>
            <p className="m-0 text-sm leading-[1.65] text-muted">
              Maintain effective-dated Work Schedule and Work Arrangement Versions, the Holiday
              Calendars that bind their scope, and the Schedule Assignments that resolve personnel
              to a duty roster on any Work date. Published versions are immutable.
            </p>
          </div>
          {tab === 'schedules' && canManage ? (
            <DialogTrigger asChild>
              <Button
                size="default"
                type="button"
                variant="primary"
                onClick={(event) => {
                  resetAction();
                  setScheduleValues(emptyScheduleValues());
                  openDialog(
                    'schedule-create',
                    event.currentTarget as unknown as { focus(): void },
                    null,
                  );
                }}
              >
                Create Work Schedule
              </Button>
            </DialogTrigger>
          ) : null}
          {tab === 'arrangements' && canManage ? (
            <DialogTrigger asChild>
              <Button
                size="default"
                type="button"
                variant="primary"
                onClick={(event) => {
                  resetAction();
                  setArrangementValues(emptyArrangementValues(calendars[0]?.id ?? ''));
                  openDialog(
                    'arrangement-create',
                    event.currentTarget as unknown as { focus(): void },
                    null,
                  );
                }}
              >
                Create Work Arrangement
              </Button>
            </DialogTrigger>
          ) : null}
          {tab === 'calendars' && canManage ? (
            <DialogTrigger asChild>
              <Button
                size="default"
                type="button"
                variant="primary"
                onClick={(event) => {
                  resetAction();
                  setCalendarValues(emptyHolidayCalendarValues());
                  openDialog(
                    'calendar-create',
                    event.currentTarget as unknown as { focus(): void },
                    null,
                  );
                }}
              >
                Create Holiday Calendar
              </Button>
            </DialogTrigger>
          ) : null}
          {tab === 'assignments' && canAssign ? (
            <DialogTrigger asChild>
              <Button
                size="default"
                type="button"
                variant="primary"
                onClick={(event) => {
                  resetAction();
                  setAssignmentValues(emptyAssignmentValues());
                  openDialog(
                    'assignment-create',
                    event.currentTarget as unknown as { focus(): void },
                    null,
                  );
                }}
              >
                Create Schedule Assignment
              </Button>
            </DialogTrigger>
          ) : null}
        </header>

        {success ? (
          <p
            className="m-0 rounded-[3px] border border-[#b9d8c3] bg-[#f2faf4] px-4 py-3 text-sm text-[#316647]"
            role="status"
          >
            {success}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Attendance configuration">
          {(
            [
              ['schedules', 'Work Schedules'],
              ['arrangements', 'Work Arrangements'],
              ['calendars', 'Holiday Calendars'],
              ['assignments', 'Schedule Assignments'],
            ] as const
          ).map(([value, name]) => (
            <Button
              aria-selected={tab === value}
              className={
                'min-h-9 border px-3 ' +
                (tab === value
                  ? 'border-cobalt bg-[#edf2f9] text-cobalt'
                  : 'border-line bg-paper text-muted')
              }
              key={value}
              onClick={() => setTab(value)}
              role="tab"
              size="default"
              type="button"
            >
              {name}
            </Button>
          ))}
        </div>

        {tab === 'schedules' ? (
          <section
            aria-labelledby="work-schedule-register-heading"
            className="overflow-hidden rounded-[5px] border border-line bg-paper"
          >
            <header className="flex min-h-[60px] flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
              <div className="grid gap-1">
                <h2
                  className="m-0 text-sm font-[670] text-midnight"
                  id="work-schedule-register-heading"
                >
                  Work Schedule register
                </h2>
                <span className="text-xs text-muted">
                  {schedules.length === 1 ? '1 schedule' : schedules.length + ' schedules'}
                </span>
              </div>
              <span className="rounded-full bg-pale-blue px-2.5 py-1 text-xs font-[650] text-cobalt">
                Agency scoped · Evidence required
              </span>
            </header>
            {schedules.length === 0 ? (
              <div className="grid min-h-[260px] place-content-center gap-2 px-6 py-12">
                <strong className="text-[15px] font-[650] text-midnight">
                  No Work Schedules yet.
                </strong>
                <p className="m-0 max-w-[560px] text-[13px] leading-[1.6] text-muted">
                  Create a Draft with one rule per weekday, then pin the authority Document Version
                  and activate it. Activation retires the superseded version in history.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                  <thead className="bg-canvas text-[11px] tracking-[0.07em] text-muted uppercase">
                    <tr>
                      <th className="px-5 py-3 font-bold" scope="col">
                        Schedule
                      </th>
                      <th className="px-5 py-3 font-bold" scope="col">
                        Current version
                      </th>
                      <th className="px-5 py-3 font-bold" scope="col">
                        Draft
                      </th>
                      <th className="px-5 py-3 font-bold" scope="col">
                        Time zone
                      </th>
                      <th className="px-5 py-3 font-bold" scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {schedules.map((schedule) => (
                      <tr key={schedule.id}>
                        <td className="px-5 py-4 align-top">
                          <div className="grid gap-1">
                            <button
                              className="w-fit cursor-pointer text-left font-[670] text-cobalt underline-offset-2 hover:underline"
                              onClick={(event) =>
                                openDetail(
                                  'work-schedule',
                                  schedule,
                                  event.currentTarget as unknown as { focus(): void },
                                )
                              }
                              type="button"
                            >
                              {schedule.code}
                            </button>
                            <span className="text-xs text-muted">{schedule.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-top text-xs text-ink">
                          {schedule.currentVersion
                            ? 'v' +
                              schedule.currentVersion.versionNo +
                              ' · ' +
                              label(schedule.currentVersion.scheduleType) +
                              ' · ' +
                              dateLabel(schedule.currentVersion.effectiveFrom)
                            : 'No active version'}
                        </td>
                        <td className="px-5 py-4 align-top text-xs text-muted">
                          {schedule.draft
                            ? 'v' +
                              schedule.draft.versionNo +
                              ' · ' +
                              dateLabel(schedule.draft.effectiveFrom)
                            : 'None'}
                        </td>
                        <td className="px-5 py-4 align-top text-xs text-muted">
                          {(schedule.currentVersion ?? schedule.draft)?.timezone ?? '—'}
                        </td>
                        <td className="px-5 py-4 align-top">{scheduleActions(schedule)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : tab === 'arrangements' ? (
          <section
            aria-labelledby="work-arrangement-register-heading"
            className="overflow-hidden rounded-[5px] border border-line bg-paper"
          >
            <header className="flex min-h-[60px] flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
              <div className="grid gap-1">
                <h2
                  className="m-0 text-sm font-[670] text-midnight"
                  id="work-arrangement-register-heading"
                >
                  Work Arrangement register
                </h2>
                <span className="text-xs text-muted">
                  {arrangements.length === 1
                    ? '1 arrangement'
                    : arrangements.length + ' arrangements'}
                </span>
              </div>
              <span className="rounded-full bg-pale-blue px-2.5 py-1 text-xs font-[650] text-cobalt">
                Agency scoped · Holiday Calendar pinned
              </span>
            </header>
            {arrangements.length === 0 ? (
              <div className="grid min-h-[260px] place-content-center gap-2 px-6 py-12">
                <strong className="text-[15px] font-[650] text-midnight">
                  No Work Arrangements yet.
                </strong>
                <p className="m-0 max-w-[560px] text-[13px] leading-[1.6] text-muted">
                  Each Work Arrangement Version pins one Holiday Calendar scope and the schedule
                  types it permits for an operating mode.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                  <thead className="bg-canvas text-[11px] tracking-[0.07em] text-muted uppercase">
                    <tr>
                      <th className="px-5 py-3 font-bold" scope="col">
                        Arrangement
                      </th>
                      <th className="px-5 py-3 font-bold" scope="col">
                        Current version
                      </th>
                      <th className="px-5 py-3 font-bold" scope="col">
                        Permitted schedule types
                      </th>
                      <th className="px-5 py-3 font-bold" scope="col">
                        Draft
                      </th>
                      <th className="px-5 py-3 font-bold" scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {arrangements.map((arrangement) => (
                      <tr key={arrangement.id}>
                        <td className="px-5 py-4 align-top">
                          <div className="grid gap-1">
                            <button
                              className="w-fit cursor-pointer text-left font-[670] text-cobalt underline-offset-2 hover:underline"
                              onClick={(event) =>
                                openDetail(
                                  'work-arrangement',
                                  arrangement,
                                  event.currentTarget as unknown as { focus(): void },
                                )
                              }
                              type="button"
                            >
                              {arrangement.code}
                            </button>
                            <span className="text-xs text-muted">{arrangement.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-top text-xs text-ink">
                          {arrangement.currentVersion
                            ? 'v' +
                              arrangement.currentVersion.versionNo +
                              ' · ' +
                              label(arrangement.currentVersion.arrangementType) +
                              ' · ' +
                              dateLabel(arrangement.currentVersion.effectiveFrom)
                            : 'No active version'}
                        </td>
                        <td className="px-5 py-4 align-top text-xs text-muted">
                          {arrangement.currentVersion
                            ? arrangement.currentVersion.permittedScheduleTypes
                                .map((entry) => label(entry))
                                .join(', ')
                            : '—'}
                        </td>
                        <td className="px-5 py-4 align-top text-xs text-muted">
                          {arrangement.draft
                            ? 'v' +
                              arrangement.draft.versionNo +
                              ' · ' +
                              dateLabel(arrangement.draft.effectiveFrom)
                            : 'None'}
                        </td>
                        <td className="px-5 py-4 align-top">{arrangementActions(arrangement)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : tab === 'calendars' ? (
          <section
            aria-labelledby="holiday-calendar-register-heading"
            className="overflow-hidden rounded-[5px] border border-line bg-paper"
          >
            <header className="flex min-h-[60px] flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
              <div className="grid gap-1">
                <h2
                  className="m-0 text-sm font-[670] text-midnight"
                  id="holiday-calendar-register-heading"
                >
                  Holiday Calendar register
                </h2>
                <span className="text-xs text-muted">
                  {calendars.length === 1 ? '1 calendar' : calendars.length + ' calendars'}
                </span>
              </div>
              <span className="rounded-full bg-pale-blue px-2.5 py-1 text-xs font-[650] text-cobalt">
                Agency scoped · Published per version
              </span>
            </header>
            {calendars.length === 0 ? (
              <div className="grid min-h-[260px] place-content-center gap-2 px-6 py-12">
                <strong className="text-[15px] font-[650] text-midnight">
                  No Holiday Calendars yet.
                </strong>
                <p className="m-0 max-w-[560px] text-[13px] leading-[1.6] text-muted">
                  A Holiday Calendar fixes the day types that Work Arrangement Versions pin for
                  their scope. Each activated version is immutable and superseded in turn.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                  <thead className="bg-canvas text-[11px] tracking-[0.07em] text-muted uppercase">
                    <tr>
                      <th className="px-5 py-3 font-bold" scope="col">
                        Holiday Calendar
                      </th>
                      <th className="px-5 py-3 font-bold" scope="col">
                        Scope
                      </th>
                      <th className="px-5 py-3 font-bold" scope="col">
                        Current version
                      </th>
                      <th className="px-5 py-3 font-bold" scope="col">
                        Draft
                      </th>
                      <th className="px-5 py-3 font-bold" scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {calendars.map((calendar) => (
                      <tr key={calendar.id}>
                        <td className="px-5 py-4 align-top">
                          <div className="grid gap-1">
                            <button
                              className="w-fit cursor-pointer text-left font-[670] text-cobalt underline-offset-2 hover:underline"
                              onClick={(event) =>
                                openCalendarDetail(
                                  calendar,
                                  event.currentTarget as unknown as { focus(): void },
                                )
                              }
                              type="button"
                            >
                              {calendar.code}
                            </button>
                            <span className="text-xs text-muted">{calendar.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-top text-xs text-muted">
                          {label(calendar.scopeType) + ' · ' + calendar.scopeReference}
                        </td>
                        <td className="px-5 py-4 align-top text-xs text-ink">
                          {calendar.currentVersion
                            ? 'v' +
                              calendar.currentVersion.versionNo +
                              ' · ' +
                              calendar.currentVersion.entries.length +
                              (calendar.currentVersion.entries.length === 1
                                ? ' entry · '
                                : ' entries · ') +
                              dateLabel(calendar.currentVersion.effectiveFrom)
                            : 'No active version'}
                        </td>
                        <td className="px-5 py-4 align-top text-xs text-muted">
                          {calendar.draft
                            ? 'v' +
                              calendar.draft.versionNo +
                              ' · ' +
                              dateLabel(calendar.draft.effectiveFrom)
                            : 'None'}
                        </td>
                        <td className="px-5 py-4 align-top">{calendarActions(calendar)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : (
          <div className="grid gap-5">
            <section
              aria-labelledby="schedule-assignment-register-heading"
              className="overflow-hidden rounded-[5px] border border-line bg-paper"
            >
              <header className="flex min-h-[60px] flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
                <div className="grid gap-1">
                  <h2
                    className="m-0 text-sm font-[670] text-midnight"
                    id="schedule-assignment-register-heading"
                  >
                    Schedule Assignment register
                  </h2>
                  <span className="text-xs text-muted">
                    {assignments
                      ? assignments.length === 1
                        ? '1 assignment'
                        : assignments.length + ' assignments'
                      : assignmentsLoading
                        ? 'Loading assignments…'
                        : 'Assignments unavailable'}
                  </span>
                </div>
                <span className="rounded-full bg-pale-blue px-2.5 py-1 text-xs font-[650] text-cobalt">
                  One open Assignment per Employee
                </span>
              </header>
              {assignmentsError ? (
                <div className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <FormError message={assignmentsError} />
                  <Button
                    size="default"
                    type="button"
                    variant="secondary"
                    onClick={() => setAssignmentsError('')}
                  >
                    Retry
                  </Button>
                </div>
              ) : null}
              {assignments && assignments.length === 0 ? (
                <div className="grid min-h-[220px] place-content-center gap-2 px-6 py-12">
                  <strong className="text-[15px] font-[650] text-midnight">
                    No Schedule Assignments yet.
                  </strong>
                  <p className="m-0 max-w-[560px] text-[13px] leading-[1.6] text-muted">
                    An Assignment binds one Employee to one active Work Schedule Version and Work
                    Arrangement Version for a date range. Gaps fail closed as Attendance Exceptions.
                  </p>
                </div>
              ) : null}
              {assignments && assignments.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[960px] border-collapse text-left text-sm">
                    <thead className="bg-canvas text-[11px] tracking-[0.07em] text-muted uppercase">
                      <tr>
                        <th className="px-5 py-3 font-bold" scope="col">
                          Employee
                        </th>
                        <th className="px-5 py-3 font-bold" scope="col">
                          Work Schedule
                        </th>
                        <th className="px-5 py-3 font-bold" scope="col">
                          Work Arrangement
                        </th>
                        <th className="px-5 py-3 font-bold" scope="col">
                          Effectivity
                        </th>
                        <th className="px-5 py-3 font-bold" scope="col">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {assignments.map((assignment) => (
                        <tr key={assignment.id}>
                          <td className="px-5 py-4 align-top">
                            <div className="grid gap-1">
                              <span className="font-[670] text-ink">
                                {assignment.employee.employeeNumber}
                              </span>
                              <span className="text-xs text-muted">
                                {assignment.employee.legalName}
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-4 align-top text-xs text-ink">
                            {assignment.workScheduleCode +
                              ' v' +
                              assignment.workScheduleVersionNo +
                              ' · ' +
                              label(assignment.scheduleType)}
                          </td>
                          <td className="px-5 py-4 align-top text-xs text-ink">
                            {assignment.workArrangementCode +
                              ' v' +
                              assignment.workArrangementVersionNo +
                              ' · ' +
                              label(assignment.arrangementType)}
                          </td>
                          <td className="px-5 py-4 align-top text-xs text-muted">
                            {dateLabel(assignment.effectiveFrom) +
                              (assignment.effectiveTo
                                ? ' – ' + dateLabel(assignment.effectiveTo)
                                : ' – open-ended')}
                          </td>
                          <td className="px-5 py-4 align-top">{assignmentActions(assignment)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>

            <section
              aria-labelledby="work-date-resolution-heading"
              className="overflow-hidden rounded-[5px] border border-line bg-paper"
            >
              <header className="flex min-h-[60px] flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
                <div className="grid gap-1">
                  <h2
                    className="m-0 text-sm font-[670] text-midnight"
                    id="work-date-resolution-heading"
                  >
                    Work date resolution
                  </h2>
                  <span className="text-xs text-muted">
                    Resolve the duty roster for one Employee and Work date
                  </span>
                </div>
              </header>
              <form
                className="grid gap-4 px-5 py-5"
                onSubmit={(event) => void submitResolution(event)}
              >
                {employeesError ? <FormError message={employeesError} /> : null}
                {resolutionError ? <FormError message={resolutionError} /> : null}
                <div className="grid items-end gap-4 min-[621px]:grid-cols-3">
                  <Field htmlFor="resolution-employee" label="Employee">
                    <select
                      className={inputClass}
                      disabled={employees.length === 0}
                      id="resolution-employee"
                      onChange={(event) => setResolutionEmployeeId(targetValue(event))}
                      required
                      value={resolutionEmployeeId}
                    >
                      <option value="">
                        {employees.length === 0
                          ? 'No Employees are available'
                          : 'Select an Employee'}
                      </option>
                      {employees.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.employeeNumber + ' · ' + employee.legalName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field htmlFor="resolution-work-date" label="Work date">
                    <input
                      className={inputClass}
                      id="resolution-work-date"
                      onChange={(event) => setResolutionDate(targetValue(event))}
                      required
                      type="date"
                      value={resolutionDate}
                    />
                  </Field>
                  <Button disabled={resolutionBusy} size="default" type="submit" variant="primary">
                    {resolutionBusy ? 'Resolving…' : 'Resolve Work date'}
                  </Button>
                </div>
                {resolution ? <ResolutionResult resolution={resolution} /> : null}
              </form>
            </section>
          </div>
        )}
      </div>

      {dialog === 'schedule-detail' || dialog === 'arrangement-detail' ? (
        <div className="mb-4">
          <RecordReturn href={navigation.href({ record: null, view: null, kind: null })}>
            ← Attendance Configuration
          </RecordReturn>
        </div>
      ) : null}
      <DialogContent
        aria-describedby={dialogDescriptionId}
        className={
          editingSchedule || editingArrangement || editingCalendar ? 'max-w-[980px]' : undefined
        }
      >
        <DialogHeader>
          <div className="grid min-w-0 gap-1.5">
            <p className="m-0 text-[11px] font-bold tracking-[0.08em] text-cobalt uppercase">
              Attendance configuration
            </p>
            <DialogTitle>
              {dialog === 'schedule-create'
                ? 'Create Work Schedule'
                : dialog === 'schedule-edit'
                  ? 'Edit Draft Work Schedule'
                  : dialog === 'schedule-successor'
                    ? 'Create Successor · ' + selectedLabel
                    : dialog === 'schedule-activate'
                      ? 'Activate ' + selectedLabel
                      : dialog === 'schedule-detail'
                        ? 'Work Schedule · ' + selectedLabel
                        : dialog === 'arrangement-create'
                          ? 'Create Work Arrangement'
                          : dialog === 'arrangement-edit'
                            ? 'Edit Draft Work Arrangement'
                            : dialog === 'arrangement-successor'
                              ? 'Create Successor · ' + selectedLabel
                              : dialog === 'arrangement-activate'
                                ? 'Activate ' + selectedLabel
                                : dialog === 'arrangement-detail'
                                  ? 'Work Arrangement · ' + selectedLabel
                                  : dialog === 'calendar-create'
                                    ? 'Create Holiday Calendar'
                                    : dialog === 'calendar-edit'
                                      ? 'Edit Draft Holiday Calendar'
                                      : dialog === 'calendar-successor'
                                        ? 'Create Successor · ' + selectedLabel
                                        : dialog === 'calendar-activate'
                                          ? 'Activate ' + selectedLabel
                                          : dialog === 'calendar-detail'
                                            ? 'Holiday Calendar · ' + selectedLabel
                                            : dialog === 'assignment-create'
                                              ? 'Create Schedule Assignment'
                                              : 'End Schedule Assignment · ' + selectedLabel}
            </DialogTitle>
            <DialogDescription id={dialogDescriptionId}>
              {dialog === 'schedule-create' || dialog === 'schedule-edit'
                ? 'Declare the schedule type, time zone, effective date, and exactly one Day Rule per weekday. Required minutes exclude unpaid breaks.'
                : dialog === 'schedule-activate' ||
                    dialog === 'arrangement-activate' ||
                    dialog === 'calendar-activate'
                  ? 'Activation pins the authority Document Version, validates the Draft, and retires any predecessor by supersession.'
                  : dialog === 'schedule-successor' ||
                      dialog === 'arrangement-successor' ||
                      dialog === 'calendar-successor'
                    ? 'The successor copies the current published definition and receives a later effective date. It remains Draft until reviewed.'
                    : dialog === 'schedule-detail'
                      ? 'Inspect effective-dated versions, the seven-day rule matrix, and the immutable transition history.'
                      : dialog === 'arrangement-create' || dialog === 'arrangement-edit'
                        ? 'Declare the operating mode, its permitted schedule types, the pinned Holiday Calendar, and the effective date.'
                        : dialog === 'arrangement-detail'
                          ? 'Inspect effective-dated versions, the pinned Holiday Calendar, and the immutable transition history.'
                          : dialog === 'calendar-create' || dialog === 'calendar-edit'
                            ? 'Declare the calendar scope, effective date, and one row per holiday date and day type.'
                            : dialog === 'calendar-detail'
                              ? 'Inspect effective-dated versions, their holiday entries, and the immutable transition history.'
                              : dialog === 'assignment-create'
                                ? 'Bind one Employee to an active Work Schedule Version and Work Arrangement Version for a non-overlapping period, with the authority Document Version.'
                                : 'Ending records the last covered date and the reason. The Assignment then remains immutable.'}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button
              aria-label="Close Attendance Configuration dialog"
              className="border border-line bg-paper text-muted hover:bg-canvas"
              disabled={busy}
              type="button"
            >
              <span aria-hidden="true" className="text-xl leading-none">
                ×
              </span>
            </Button>
          </DialogClose>
        </DialogHeader>

        {dialog === 'schedule-detail' ? (
          <ScheduleDetailBody detail={scheduleDetail} detailLoading={detailLoading} error={error} />
        ) : dialog === 'arrangement-detail' ? (
          <ArrangementDetailBody
            calendars={calendars}
            detail={arrangementDetail}
            detailLoading={detailLoading}
            error={error}
          />
        ) : dialog === 'calendar-detail' ? (
          <HolidayCalendarDetailBody
            detail={calendarDetail}
            detailLoading={detailLoading}
            error={error}
          />
        ) : dialog === 'schedule-activate' ||
          dialog === 'arrangement-activate' ||
          dialog === 'calendar-activate' ? (
          <ActivationForm
            activation={activation}
            error={error}
            evidenceLoading={evidenceLoading}
            evidenceOptions={evidenceOptions}
            onSubmit={submitActivation}
            setActivation={setActivation}
          />
        ) : dialog === 'schedule-successor' ||
          dialog === 'arrangement-successor' ||
          dialog === 'calendar-successor' ? (
          <DialogBody className="grid gap-5">
            {error ? <FormError message={error} /> : null}
            <p className="m-0 rounded-[3px] bg-canvas px-4 py-3 text-sm leading-[1.6] text-muted">
              The successor copies the current published definition and receives a later effective
              date. It remains Draft until reviewed and activated.
            </p>
            <DialogFooter className="-mx-6 border-t-0 px-0 pb-0 min-[621px]:-mx-8 min-[621px]:px-0">
              <DialogClose asChild>
                <Button disabled={busy} size="default" type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                disabled={busy}
                onClick={() => void submitSuccessor()}
                size="default"
                type="button"
                variant="primary"
              >
                {busy ? 'Creating…' : 'Create Successor'}
              </Button>
            </DialogFooter>
          </DialogBody>
        ) : dialog === 'schedule-create' || dialog === 'schedule-edit' ? (
          <form
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            onSubmit={(event) => void submitSchedule(event)}
          >
            <DialogBody className="grid auto-rows-max content-start gap-6">
              {error ? <FormError message={error} /> : null}
              <ScheduleDefinitionFields
                dialog={dialog}
                setValue={(field, value) =>
                  setScheduleValues((current) => ({ ...current, [field]: value }))
                }
                values={scheduleValues}
              />
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} size="default" type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={busy} size="default" type="submit" variant="primary">
                {busy ? 'Saving…' : dialog === 'schedule-create' ? 'Create Draft' : 'Save Draft'}
              </Button>
            </DialogFooter>
          </form>
        ) : dialog === 'calendar-create' || dialog === 'calendar-edit' ? (
          <form
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            onSubmit={(event) => void submitHolidayCalendar(event)}
          >
            <DialogBody className="grid auto-rows-max content-start gap-6">
              {error ? <FormError message={error} /> : null}
              <HolidayCalendarDefinitionFields
                dialog={dialog}
                setValue={(field, value) =>
                  setCalendarValues((current) => ({ ...current, [field]: value }))
                }
                values={calendarValues}
              />
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} size="default" type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={busy} size="default" type="submit" variant="primary">
                {busy ? 'Saving…' : dialog === 'calendar-create' ? 'Create Draft' : 'Save Draft'}
              </Button>
            </DialogFooter>
          </form>
        ) : dialog === 'assignment-create' ? (
          <form
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            onSubmit={(event) => void submitAssignment(event)}
          >
            <DialogBody className="grid auto-rows-max content-start gap-6">
              {error ? <FormError message={error} /> : null}
              <AssignmentDefinitionFields
                arrangements={arrangements}
                employees={employees}
                employeesError={employeesError}
                evidenceLoading={evidenceLoading}
                evidenceOptions={evidenceOptions}
                schedules={schedules}
                setValue={(field, value) =>
                  setAssignmentValues((current) => ({ ...current, [field]: value }))
                }
                values={assignmentValues}
              />
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} size="default" type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={busy} size="default" type="submit" variant="primary">
                {busy ? 'Saving…' : 'Create Assignment'}
              </Button>
            </DialogFooter>
          </form>
        ) : dialog === 'assignment-end' ? (
          <form
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            onSubmit={(event) => void submitAssignmentEnd(event)}
          >
            <DialogBody className="grid auto-rows-max content-start gap-6">
              {error ? <FormError message={error} /> : null}
              <AssignmentEndFields
                assignment={selectedAssignment}
                setValue={(field, value) =>
                  setAssignmentEndValues((current) => ({ ...current, [field]: value }))
                }
                values={assignmentEndValues}
              />
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} size="default" type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={busy} size="default" type="submit" variant="primary">
                {busy ? 'Ending…' : 'End Assignment'}
              </Button>
            </DialogFooter>
          </form>
        ) : dialog === 'arrangement-create' || dialog === 'arrangement-edit' ? (
          <form
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            onSubmit={(event) => void submitArrangement(event)}
          >
            <DialogBody className="grid auto-rows-max content-start gap-6">
              {error ? <FormError message={error} /> : null}
              <ArrangementDefinitionFields
                calendars={calendars}
                dialog={dialog}
                setValue={(field, value) =>
                  setArrangementValues((current) => ({ ...current, [field]: value }))
                }
                values={arrangementValues}
              />
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} size="default" type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={busy} size="default" type="submit" variant="primary">
                {busy ? 'Saving…' : dialog === 'arrangement-create' ? 'Create Draft' : 'Save Draft'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
