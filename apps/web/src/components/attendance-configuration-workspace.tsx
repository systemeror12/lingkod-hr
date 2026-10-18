'use client';

import { Field, inputClass, labelClass, FormError } from './ui/field';
import { useRecordNavigation } from './record-navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { PageHeader, type Breadcrumb } from './ui/page-header';
import { Panel } from './ui/panel';
import { SectionTabList, SectionTabPanel, SectionTabs } from './ui/section-tabs';
import { RowHeader, Table, Td, Th, Tr } from './ui/table';
import { StateSurface } from './state-surface';
import { manilaToday } from '../lib/manila-date';
import {
  ActivationForm,
  DetailFooter,
  DetailLoading,
  TransitionHistory,
  VersionCard,
  VersionEffectivity,
  VersionMeta,
} from './attendance-configuration/shared';
import {
  countLabel,
  dateLabel,
  describeRequestError,
  emptyActivation,
  errorMessage,
  label,
  noteClass,
  parseEvidenceOptions,
  recordLinkClass,
  rowBoxClass,
  sectionTitleClass,
  targetChecked,
  targetValue,
  validForm,
} from './attendance-configuration/helpers';
import {
  type ScheduleType,
  type DayRuleType,
  type EventPattern,
  type ArrangementType,
  scheduleTypes,
  arrangementTypes,
  ruleTypes,
  eventPatterns,
  weekdayLabels,
  type WorkScheduleDayRule,
  type WorkScheduleVersion,
  type WorkSchedule,
  type WorkScheduleListResponse,
  type WorkScheduleDetail,
  type WorkArrangementVersion,
  type WorkArrangement,
  type WorkArrangementListResponse,
  type WorkArrangementDetail,
  type HolidayCalendar,
  type HolidayCalendarListResponse,
  type ScheduleAssignment,
  type ScheduleAssignmentListResponse,
  type AttendanceResolution,
  type EmployeeOption,
  type EvidenceOption,
  type BreakForm,
  type DayRuleForm,
  type ScheduleFormValues,
  type ArrangementFormValues,
  type AssignmentFormValues,
  type AssignmentEndValues,
  AttendanceRequestError,
  type DialogKind,
  type TabSectionHandle,
} from './attendance-configuration/types';
import { HolidayCalendarsSection } from './attendance-configuration/holiday-calendars-section';

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

function assignmentPayload(values: AssignmentFormValues): Record<string, unknown> {
  return {
    employeeId: values.employeeId,
    workScheduleVersionId: values.workScheduleVersionId,
    workArrangementVersionId: values.workArrangementVersionId,
    authorityDocumentVersionId: values.authorityDocumentVersionId,
    effectiveFrom: values.effectiveFrom,
  };
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

function ScheduleDayRuleTable({
  caption,
  rules,
}: {
  caption: string;
  rules: WorkScheduleDayRule[];
}) {
  return (
    <Table aria-label={caption} className="min-w-[640px]">
      <thead>
        <tr>
          <Th>Day</Th>
          <Th>Rule</Th>
          <Th>Window</Th>
          <Th>Required</Th>
          <Th>Unpaid breaks</Th>
          <Th>Collection window</Th>
        </tr>
      </thead>
      <tbody>
        {rules.map((rule) => (
          <Tr key={rule.id}>
            <RowHeader>{weekdayLabels[rule.weekday]}</RowHeader>
            <Td>{label(rule.ruleType)}</Td>
            <Td>{ruleWindow(rule)}</Td>
            <Td>
              {rule.requiredMinutes} min
              {rule.ruleType === 'FLEXIBLE' && rule.coreStartTime && rule.coreEndTime
                ? ' · core ' + rule.coreStartTime + '–' + rule.coreEndTime
                : ''}
            </Td>
            <Td>{breaksLabel(rule)}</Td>
            <Td>
              {rule.collectionBeforeMinutes || rule.collectionAfterMinutes
                ? '+' +
                  rule.collectionBeforeMinutes +
                  ' before · +' +
                  rule.collectionAfterMinutes +
                  ' after'
                : '—'}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
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
    <>
      <DialogBody className="grid gap-6">
        {detailLoading ? (
          <DetailLoading name="Work Schedule history">Loading schedule history…</DetailLoading>
        ) : null}
        <FormError message={error} />
        {detail ? (
          <>
            <dl className="m-0 grid gap-4 text-small min-[621px]:grid-cols-2">
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
              <h3 className={sectionTitleClass} id="work-schedule-version-history-title">
                Version history
              </h3>
              {detail.versions.map((version) => (
                <VersionCard
                  key={version.id}
                  meta={
                    <>
                      <VersionEffectivity from={version.effectiveFrom} to={version.effectiveTo} />
                      <VersionMeta label="Schedule type">{label(version.scheduleType)}</VersionMeta>
                      <VersionMeta label="Approving authority">
                        {version.approvingAuthority ?? 'Not recorded'}
                      </VersionMeta>
                      <VersionMeta label="Activated">
                        {version.activatedAt ? dateLabel(version.activatedAt) : 'Not activated'}
                      </VersionMeta>
                    </>
                  }
                  state={version.versionState}
                  versionNo={version.versionNo}
                >
                  <ScheduleDayRuleTable
                    caption={'Version ' + version.versionNo + ' day rules'}
                    rules={version.dayRules}
                  />
                </VersionCard>
              ))}
            </section>
            <TransitionHistory history={detail.history} id="work-schedule-audit-history-title" />
          </>
        ) : null}
      </DialogBody>
      <DetailFooter />
    </>
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
    <>
      <DialogBody className="grid gap-6">
        {detailLoading ? (
          <DetailLoading name="Work Arrangement history">
            Loading arrangement history…
          </DetailLoading>
        ) : null}
        <FormError message={error} />
        {detail ? (
          <>
            <dl className="m-0 grid gap-4 text-small min-[621px]:grid-cols-2">
              <VersionMeta label="Code">{detail.arrangement.code}</VersionMeta>
              <VersionMeta label="Name">{detail.arrangement.name}</VersionMeta>
              <VersionMeta label="Effective on">{dateLabel(detail.asOf)}</VersionMeta>
              <VersionMeta label="Effective version">
                {detail.effective
                  ? 'v' +
                    detail.effective.versionNo +
                    ' · ' +
                    label(detail.effective.arrangementType)
                  : 'No effective version'}
              </VersionMeta>
            </dl>
            <section
              className="grid gap-3"
              aria-labelledby="work-arrangement-version-history-title"
            >
              <h3 className={sectionTitleClass} id="work-arrangement-version-history-title">
                Version history
              </h3>
              {detail.versions.map((version) => (
                <VersionCard
                  key={version.id}
                  meta={
                    <>
                      <VersionEffectivity from={version.effectiveFrom} to={version.effectiveTo} />
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
                    </>
                  }
                  state={version.versionState}
                  versionNo={version.versionNo}
                />
              ))}
            </section>
            <TransitionHistory history={detail.history} id="work-arrangement-audit-history-title" />
          </>
        ) : null}
      </DialogBody>
      <DetailFooter />
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
      <legend className="mb-1 text-panel-title text-ink">Assignment definition</legend>
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
      <legend className="mb-1 text-panel-title text-ink">End Assignment</legend>
      {assignment ? (
        <p className={noteClass}>
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
      className="grid gap-4 rounded-control border border-border bg-canvas p-3 text-small min-[621px]:grid-cols-2"
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
    <section aria-labelledby={id + '-title'} className={'grid gap-4 ' + rowBoxClass}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h4 className={sectionTitleClass} id={id + '-title'}>
          {weekdayLabels[rule.weekday]}
        </h4>
        <div className="flex flex-wrap items-end gap-3">
          <label className={labelClass}>
            <span>Day rule</span>
            <select
              className={inputClass + ' w-auto'}
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
            <label className={labelClass}>
              <span>Required minutes</span>
              <input
                className={inputClass + ' w-[130px]'}
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
              className={inputClass}
              id={id + '-duty-start'}
              onChange={(event) => update({ dutyStartTime: targetValue(event) })}
              required
              type="time"
              value={rule.dutyStartTime}
            />
          </Field>
          <Field htmlFor={id + '-duty-end'} label="Duty end">
            <input
              className={inputClass}
              id={id + '-duty-end'}
              onChange={(event) => update({ dutyEndTime: targetValue(event) })}
              required
              type="time"
              value={rule.dutyEndTime}
            />
          </Field>
          <label className="flex min-h-9 items-center gap-2 self-end text-caption font-[650] text-ink">
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
              className={inputClass}
              id={id + '-earliest-start'}
              onChange={(event) => update({ earliestStartTime: targetValue(event) })}
              required
              type="time"
              value={rule.earliestStartTime}
            />
          </Field>
          <Field htmlFor={id + '-latest-start'} label="Latest start">
            <input
              className={inputClass}
              id={id + '-latest-start'}
              onChange={(event) => update({ latestStartTime: targetValue(event) })}
              required
              type="time"
              value={rule.latestStartTime}
            />
          </Field>
          <Field htmlFor={id + '-duty-end'} label="Duty end">
            <input
              className={inputClass}
              id={id + '-duty-end'}
              onChange={(event) => update({ dutyEndTime: targetValue(event) })}
              required
              type="time"
              value={rule.dutyEndTime}
            />
          </Field>
          <Field htmlFor={id + '-core-start'} label="Core start (optional)">
            <input
              className={inputClass}
              id={id + '-core-start'}
              onChange={(event) => update({ coreStartTime: targetValue(event) })}
              type="time"
              value={rule.coreStartTime}
            />
          </Field>
          <Field htmlFor={id + '-core-end'} label="Core end (optional)">
            <input
              className={inputClass}
              id={id + '-core-end'}
              onChange={(event) => update({ coreEndTime: targetValue(event) })}
              type="time"
              value={rule.coreEndTime}
            />
          </Field>
          <label className="flex min-h-9 items-center gap-2 self-end text-caption font-[650] text-ink">
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
                className={inputClass}
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
                className={inputClass}
                id={id + '-collection-before'}
                min="0"
                onChange={(event) => update({ collectionBeforeMinutes: targetValue(event) })}
                type="number"
                value={rule.collectionBeforeMinutes}
              />
            </Field>
            <Field htmlFor={id + '-collection-after'} label="Collection closes after (minutes)">
              <input
                className={inputClass}
                id={id + '-collection-after'}
                min="0"
                onChange={(event) => update({ collectionAfterMinutes: targetValue(event) })}
                type="number"
                value={rule.collectionAfterMinutes}
              />
            </Field>
          </div>
          <div className="grid gap-2">
            <span className="text-caption font-[650] text-ink">Unpaid break intervals</span>
            {rule.breaks.length === 0 ? (
              <span className="text-small text-ink-muted">No unpaid breaks.</span>
            ) : null}
            {rule.breaks.map((entry, index) => (
              <div className="flex flex-wrap items-end gap-3" key={index}>
                <label className={labelClass}>
                  <span>Break start</span>
                  <input
                    aria-label={weekdayLabels[rule.weekday] + ' break start ' + (index + 1)}
                    className={inputClass + ' w-auto'}
                    onChange={(event) => setBreak(index, { breakStartTime: targetValue(event) })}
                    required
                    type="time"
                    value={entry.breakStartTime}
                  />
                </label>
                <label className={labelClass}>
                  <span>Break end</span>
                  <input
                    aria-label={weekdayLabels[rule.weekday] + ' break end ' + (index + 1)}
                    className={inputClass + ' w-auto'}
                    onChange={(event) => setBreak(index, { breakEndTime: targetValue(event) })}
                    required
                    type="time"
                    value={entry.breakEndTime}
                  />
                </label>
                <label className="flex min-h-9 items-center gap-2 text-caption text-ink">
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
                  onClick={() =>
                    update({ breaks: rule.breaks.filter((_, position) => position !== index) })
                  }
                  type="button"
                  variant="secondary"
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              className="w-fit"
              disabled={rule.breaks.length >= 12}
              onClick={() =>
                update({
                  breaks: [
                    ...rule.breaks,
                    { breakStartTime: '12:00', breakEndTime: '13:00', endNextCalendarDay: false },
                  ],
                })
              }
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
        <h3 className={sectionTitleClass} id="work-schedule-definition-title">
          Schedule definition
        </h3>
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
        <div className="grid gap-1">
          <h3 className={sectionTitleClass} id="work-schedule-rules-title">
            Seven-day rule matrix
          </h3>
          <p className="m-0 text-small text-ink-muted">One rule per weekday</p>
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
      <legend className="mb-1 text-panel-title text-ink">Arrangement definition</legend>
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
        <legend className="text-caption font-[650] text-ink">Permitted schedule types</legend>
        <div className="flex flex-wrap gap-3">
          {scheduleTypes.map((entry) => (
            <label
              className="flex min-h-11 items-center gap-2 rounded-control border border-border px-3 text-small text-ink"
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
  const [selectedAssignment, setSelectedAssignment] = useState<ScheduleAssignment | null>(null);
  const [scheduleDetail, setScheduleDetail] = useState<WorkScheduleDetail | null>(null);
  const [arrangementDetail, setArrangementDetail] = useState<WorkArrangementDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [scheduleValues, setScheduleValues] = useState(emptyScheduleValues);
  const [arrangementValues, setArrangementValues] = useState(() =>
    emptyArrangementValues(initialCalendars[0]?.id ?? ''),
  );
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
  const [sectionFormOpen, setSectionFormOpen] = useState(false);
  const calendarsSectionRef = useRef<TabSectionHandle>(null);
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
    entity: WorkSchedule | WorkArrangement | ScheduleAssignment | null,
  ): void {
    returnFocusRef.current = target;
    resetAction();
    if (kind.startsWith('schedule')) setSelectedSchedule(entity as WorkSchedule | null);
    else if (kind.startsWith('arrangement'))
      setSelectedArrangement(entity as WorkArrangement | null);
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
    setSelectedAssignment(null);
    setScheduleDetail(null);
    setArrangementDetail(null);
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

  function assignmentActions(assignment: ScheduleAssignment) {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        {!assignment.effectiveTo && canAssign ? (
          <Button
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
  const showingForm =
    sectionFormOpen ||
    editingSchedule ||
    editingArrangement ||
    dialog === 'schedule-detail' ||
    dialog === 'arrangement-detail' ||
    dialog === 'assignment-create' ||
    dialog === 'assignment-end';
  const selectedLabel =
    dialog?.startsWith('schedule') && selectedSchedule
      ? selectedSchedule.code
      : dialog?.startsWith('arrangement') && selectedArrangement
        ? selectedArrangement.code
        : dialog === 'assignment-end' && selectedAssignment
          ? selectedAssignment.employee.legalName
          : 'Attendance Configuration';
  const dialogDescriptionId = 'attendance-configuration-dialog-description';

  const recordCode =
    recordKind === 'work-arrangement' ? selectedArrangement?.code : selectedSchedule?.code;
  const breadcrumbs: Breadcrumb[] = [{ label: 'Time & attendance' }];
  // Only record views change the URL, so only they can link back to the register.
  if (recordId) {
    breadcrumbs.push({
      label: 'Attendance Configuration',
      href: navigation.href({ record: null, view: null, kind: null }),
    });
    if (recordCode) breadcrumbs.push({ label: recordCode });
  }
  const creator: { name: string; open: (target: { focus(): void }) => void } | null =
    tab === 'schedules' && canManage
      ? {
          name: 'Create Work Schedule',
          open: (target) => {
            resetAction();
            setScheduleValues(emptyScheduleValues());
            openDialog('schedule-create', target, null);
          },
        }
      : tab === 'arrangements' && canManage
        ? {
            name: 'Create Work Arrangement',
            open: (target) => {
              resetAction();
              setArrangementValues(emptyArrangementValues(calendars[0]?.id ?? ''));
              openDialog('arrangement-create', target, null);
            },
          }
        : tab === 'calendars' && canManage
          ? {
              name: 'Create Holiday Calendar',
              open: (target) => calendarsSectionRef.current?.openCreate(target),
            }
          : tab === 'assignments' && canAssign
            ? {
                name: 'Create Schedule Assignment',
                open: (target) => {
                  resetAction();
                  setAssignmentValues(emptyAssignmentValues());
                  openDialog('assignment-create', target, null);
                },
              }
            : null;

  return (
    <Dialog
      presentation={showingForm ? 'form' : 'dialog'}
      open={dialog !== null}
      onOpenChange={(open) => !open && closeDialog()}
    >
      <SectionTabs
        className="grid min-w-0 gap-5"
        onValueChange={(value) => setTab(value as typeof tab)}
        value={tab}
      >
        <PageHeader
          actions={
            creator ? (
              <Button
                // Hidden rather than unmounted, so focus can return here when the form closes.
                hidden={showingForm}
                onClick={(event) =>
                  creator.open(event.currentTarget as unknown as { focus(): void })
                }
                type="button"
                variant="primary"
              >
                {creator.name}
              </Button>
            ) : null
          }
          breadcrumbs={breadcrumbs}
          tabs={
            <div hidden={showingForm}>
              <SectionTabList
                label="Attendance configuration sections"
                tabs={[
                  { value: 'schedules', label: 'Work Schedules' },
                  { value: 'arrangements', label: 'Work Arrangements' },
                  { value: 'calendars', label: 'Holiday Calendars' },
                  { value: 'assignments', label: 'Schedule Assignments' },
                ]}
              />
            </div>
          }
          title="Attendance Configuration"
        />

        <div hidden={showingForm} className="grid min-w-0 gap-5">
          <p className="m-0 max-w-[760px] text-small text-ink-muted">
            Maintain effective-dated Work Schedule and Work Arrangement Versions, the Holiday
            Calendars that bind their scope, and the Schedule Assignments that resolve personnel to
            a duty roster on any Work date. Published versions are immutable.
          </p>

          {success ? (
            <p
              className="m-0 rounded-control border border-success/40 bg-success/5 px-3 py-2.5 text-small text-success"
              role="status"
            >
              {success}
            </p>
          ) : null}

          <SectionTabPanel value="schedules">
            <Panel
              title="Work Schedule register"
              flush
              actions={
                <span className="text-caption text-ink-muted">
                  {countLabel(schedules.length, 'schedule')} · Agency scoped · Evidence required
                </span>
              }
            >
              {schedules.length === 0 ? (
                <StateSurface compact label="Work Schedules">
                  <strong className="text-body font-[650] text-ink">No Work Schedules yet.</strong>
                  <p className="m-0 max-w-[560px]">
                    Create a Draft with one rule per weekday, then pin the authority Document
                    Version and activate it. Activation retires the superseded version in history.
                  </p>
                </StateSurface>
              ) : (
                <Table aria-label="Work Schedules" className="min-w-[860px]">
                  <thead>
                    <tr>
                      <Th>Schedule</Th>
                      <Th>Current version</Th>
                      <Th>Draft</Th>
                      <Th>Time zone</Th>
                      <Th>
                        <span className="sr-only">Actions</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((schedule) => (
                      <Tr key={schedule.id}>
                        <RowHeader>
                          <div className="grid gap-1">
                            <button
                              className={recordLinkClass}
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
                            <span className="text-caption font-normal text-ink-muted">
                              {schedule.name}
                            </span>
                          </div>
                        </RowHeader>
                        <Td>
                          {schedule.currentVersion
                            ? 'v' +
                              schedule.currentVersion.versionNo +
                              ' · ' +
                              label(schedule.currentVersion.scheduleType) +
                              ' · ' +
                              dateLabel(schedule.currentVersion.effectiveFrom)
                            : 'No active version'}
                        </Td>
                        <Td className="text-ink-muted">
                          {schedule.draft
                            ? 'v' +
                              schedule.draft.versionNo +
                              ' · ' +
                              dateLabel(schedule.draft.effectiveFrom)
                            : 'None'}
                        </Td>
                        <Td className="text-ink-muted">
                          {(schedule.currentVersion ?? schedule.draft)?.timezone ?? '—'}
                        </Td>
                        <Td>{scheduleActions(schedule)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Panel>
          </SectionTabPanel>

          <SectionTabPanel value="arrangements">
            <Panel
              title="Work Arrangement register"
              flush
              actions={
                <span className="text-caption text-ink-muted">
                  {countLabel(arrangements.length, 'arrangement')} · Agency scoped · Holiday
                  Calendar pinned
                </span>
              }
            >
              {arrangements.length === 0 ? (
                <StateSurface compact label="Work Arrangements">
                  <strong className="text-body font-[650] text-ink">
                    No Work Arrangements yet.
                  </strong>
                  <p className="m-0 max-w-[560px]">
                    Each Work Arrangement Version pins one Holiday Calendar scope and the schedule
                    types it permits for an operating mode.
                  </p>
                </StateSurface>
              ) : (
                <Table aria-label="Work Arrangements" className="min-w-[860px]">
                  <thead>
                    <tr>
                      <Th>Arrangement</Th>
                      <Th>Current version</Th>
                      <Th>Permitted schedule types</Th>
                      <Th>Draft</Th>
                      <Th>
                        <span className="sr-only">Actions</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {arrangements.map((arrangement) => (
                      <Tr key={arrangement.id}>
                        <RowHeader>
                          <div className="grid gap-1">
                            <button
                              className={recordLinkClass}
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
                            <span className="text-caption font-normal text-ink-muted">
                              {arrangement.name}
                            </span>
                          </div>
                        </RowHeader>
                        <Td>
                          {arrangement.currentVersion
                            ? 'v' +
                              arrangement.currentVersion.versionNo +
                              ' · ' +
                              label(arrangement.currentVersion.arrangementType) +
                              ' · ' +
                              dateLabel(arrangement.currentVersion.effectiveFrom)
                            : 'No active version'}
                        </Td>
                        <Td className="text-ink-muted">
                          {arrangement.currentVersion
                            ? arrangement.currentVersion.permittedScheduleTypes
                                .map((entry) => label(entry))
                                .join(', ')
                            : '—'}
                        </Td>
                        <Td className="text-ink-muted">
                          {arrangement.draft
                            ? 'v' +
                              arrangement.draft.versionNo +
                              ' · ' +
                              dateLabel(arrangement.draft.effectiveFrom)
                            : 'None'}
                        </Td>
                        <Td>{arrangementActions(arrangement)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Panel>
          </SectionTabPanel>

          <SectionTabPanel className="grid gap-5" value="assignments">
            <Panel
              title="Schedule Assignment register"
              flush
              actions={
                <span className="text-caption text-ink-muted">
                  {assignments ? countLabel(assignments.length, 'assignment') + ' · ' : ''}One open
                  Assignment per Employee
                </span>
              }
            >
              {assignmentsError ? (
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <FormError message={assignmentsError} />
                  <Button type="button" variant="secondary" onClick={() => setAssignmentsError('')}>
                    Retry
                  </Button>
                </div>
              ) : null}
              {!assignments && assignmentsLoading ? (
                <StateSurface compact busy label="Schedule Assignments">
                  <p className="m-0">Loading assignments…</p>
                </StateSurface>
              ) : null}
              {assignments && assignments.length === 0 ? (
                <StateSurface compact label="Schedule Assignments">
                  <strong className="text-body font-[650] text-ink">
                    No Schedule Assignments yet.
                  </strong>
                  <p className="m-0 max-w-[560px]">
                    An Assignment binds one Employee to one active Work Schedule Version and Work
                    Arrangement Version for a date range. Gaps fail closed as Attendance Exceptions.
                  </p>
                </StateSurface>
              ) : null}
              {assignments && assignments.length > 0 ? (
                <Table aria-label="Schedule Assignments" className="min-w-[960px]">
                  <thead>
                    <tr>
                      <Th>Employee</Th>
                      <Th>Work Schedule</Th>
                      <Th>Work Arrangement</Th>
                      <Th>Effectivity</Th>
                      <Th>
                        <span className="sr-only">Actions</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((assignment) => (
                      <Tr key={assignment.id}>
                        <RowHeader>
                          <div className="grid gap-1">
                            <span>{assignment.employee.employeeNumber}</span>
                            <span className="text-caption font-normal text-ink-muted">
                              {assignment.employee.legalName}
                            </span>
                          </div>
                        </RowHeader>
                        <Td>
                          {assignment.workScheduleCode +
                            ' v' +
                            assignment.workScheduleVersionNo +
                            ' · ' +
                            label(assignment.scheduleType)}
                        </Td>
                        <Td>
                          {assignment.workArrangementCode +
                            ' v' +
                            assignment.workArrangementVersionNo +
                            ' · ' +
                            label(assignment.arrangementType)}
                        </Td>
                        <Td className="text-ink-muted">
                          {dateLabel(assignment.effectiveFrom) +
                            (assignment.effectiveTo
                              ? ' – ' + dateLabel(assignment.effectiveTo)
                              : ' – open-ended')}
                        </Td>
                        <Td>{assignmentActions(assignment)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              ) : null}
            </Panel>

            <Panel
              title="Work date resolution"
              actions={
                <span className="text-caption text-ink-muted">
                  Resolve the duty roster for one Employee and Work date
                </span>
              }
            >
              <form className="grid gap-4" onSubmit={(event) => void submitResolution(event)}>
                <FormError message={employeesError} />
                <FormError message={resolutionError} />
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
                  <Button disabled={resolutionBusy} type="submit" variant="primary">
                    {resolutionBusy ? 'Resolving…' : 'Resolve Work date'}
                  </Button>
                </div>
                {resolution ? <ResolutionResult resolution={resolution} /> : null}
              </form>
            </Panel>
          </SectionTabPanel>
        </div>

        {/* Outside the hidden wrapper: the section shows its own forms inline in this panel. */}
        <SectionTabPanel value="calendars">
          <HolidayCalendarsSection
            ref={calendarsSectionRef}
            agencyId={agencyId}
            request={request}
            canManage={canManage}
            canActivate={canActivate}
            calendars={calendars}
            onRefresh={refreshCalendars}
            onFormChange={setSectionFormOpen}
          />
        </SectionTabPanel>

        <DialogContent
          aria-describedby={dialogDescriptionId}
          className={editingSchedule || editingArrangement ? 'max-w-[980px]' : undefined}
        >
          <DialogHeader>
            <div className="grid min-w-0 gap-1.5">
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
                                    : dialog === 'assignment-create'
                                      ? 'Create Schedule Assignment'
                                      : 'End Schedule Assignment · ' + selectedLabel}
              </DialogTitle>
              <DialogDescription id={dialogDescriptionId}>
                {dialog === 'schedule-create' || dialog === 'schedule-edit'
                  ? 'Declare the schedule type, time zone, effective date, and exactly one Day Rule per weekday. Required minutes exclude unpaid breaks.'
                  : dialog === 'schedule-activate' || dialog === 'arrangement-activate'
                    ? 'Activation pins the authority Document Version, validates the Draft, and retires any predecessor by supersession.'
                    : dialog === 'schedule-successor' || dialog === 'arrangement-successor'
                      ? 'The successor copies the current published definition and receives a later effective date. It remains Draft until reviewed.'
                      : dialog === 'schedule-detail'
                        ? 'Inspect effective-dated versions, the seven-day rule matrix, and the immutable transition history.'
                        : dialog === 'arrangement-create' || dialog === 'arrangement-edit'
                          ? 'Declare the operating mode, its permitted schedule types, the pinned Holiday Calendar, and the effective date.'
                          : dialog === 'arrangement-detail'
                            ? 'Inspect effective-dated versions, the pinned Holiday Calendar, and the immutable transition history.'
                            : dialog === 'assignment-create'
                              ? 'Bind one Employee to an active Work Schedule Version and Work Arrangement Version for a non-overlapping period, with the authority Document Version.'
                              : 'Ending records the last covered date and the reason. The Assignment then remains immutable.'}
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button
                aria-label="Close Attendance Configuration dialog"
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
            <ScheduleDetailBody
              detail={scheduleDetail}
              detailLoading={detailLoading}
              error={error}
            />
          ) : dialog === 'arrangement-detail' ? (
            <ArrangementDetailBody
              calendars={calendars}
              detail={arrangementDetail}
              detailLoading={detailLoading}
              error={error}
            />
          ) : dialog === 'schedule-activate' || dialog === 'arrangement-activate' ? (
            <ActivationForm
              activation={activation}
              error={error}
              evidenceLoading={evidenceLoading}
              evidenceOptions={evidenceOptions}
              onSubmit={submitActivation}
              setActivation={setActivation}
            />
          ) : dialog === 'schedule-successor' || dialog === 'arrangement-successor' ? (
            <>
              <DialogBody className="grid gap-5">
                <FormError message={error} />
                <p className={noteClass}>
                  The successor copies the current published definition and receives a later
                  effective date. It remains Draft until reviewed and activated.
                </p>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  disabled={busy}
                  onClick={() => void submitSuccessor()}
                  type="button"
                  variant="primary"
                >
                  {busy ? 'Creating…' : 'Create Successor'}
                </Button>
              </DialogFooter>
            </>
          ) : dialog === 'schedule-create' || dialog === 'schedule-edit' ? (
            <form
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              onSubmit={(event) => void submitSchedule(event)}
            >
              <DialogBody className="grid auto-rows-max content-start gap-6">
                <FormError message={error} />
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
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} type="submit" variant="primary">
                  {busy ? 'Saving…' : dialog === 'schedule-create' ? 'Create Draft' : 'Save Draft'}
                </Button>
              </DialogFooter>
            </form>
          ) : dialog === 'assignment-create' ? (
            <form
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              onSubmit={(event) => void submitAssignment(event)}
            >
              <DialogBody className="grid auto-rows-max content-start gap-6">
                <FormError message={error} />
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
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} type="submit" variant="primary">
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
                <FormError message={error} />
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
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} type="submit" variant="primary">
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
                <FormError message={error} />
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
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} type="submit" variant="primary">
                  {busy
                    ? 'Saving…'
                    : dialog === 'arrangement-create'
                      ? 'Create Draft'
                      : 'Save Draft'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </SectionTabs>
    </Dialog>
  );
}
