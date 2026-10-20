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
  targetValue,
  validForm,
} from './attendance-configuration/helpers';
import {
  type HolidayCalendarScopeType,
  type HolidayDayType,
  holidayCalendarScopeTypes,
  holidayDayTypes,
  weekdayLabels,
  type WorkSchedule,
  type WorkScheduleListResponse,
  type WorkArrangement,
  type WorkArrangementListResponse,
  type HolidayCalendarVersion,
  type HolidayCalendar,
  type HolidayCalendarListResponse,
  type HolidayCalendarDetail,
  type ScheduleAssignment,
  type ScheduleAssignmentListResponse,
  type AttendanceResolution,
  type EmployeeOption,
  type EvidenceOption,
  type HolidayEntryForm,
  type HolidayCalendarFormValues,
  type AssignmentFormValues,
  type AssignmentEndValues,
  AttendanceRequestError,
  type DialogKind,
  type TabSectionHandle,
} from './attendance-configuration/types';
import { WorkArrangementsSection } from './attendance-configuration/work-arrangements-section';
import {
  ruleWindow,
  WorkSchedulesSection,
} from './attendance-configuration/work-schedules-section';

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
    <>
      <DialogBody className="grid gap-6">
        {detailLoading ? (
          <DetailLoading name="Holiday Calendar history">
            Loading Holiday Calendar history…
          </DetailLoading>
        ) : null}
        <FormError message={error} />
        {detail ? (
          <>
            <dl className="m-0 grid gap-4 text-small min-[621px]:grid-cols-2">
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
            <section
              className="grid gap-3"
              aria-labelledby="holiday-calendar-version-history-title"
            >
              <h3 className={sectionTitleClass} id="holiday-calendar-version-history-title">
                Version history
              </h3>
              {detail.versions.map((version) => (
                <VersionCard
                  key={version.id}
                  meta={
                    <>
                      <VersionEffectivity from={version.effectiveFrom} to={version.effectiveTo} />
                      <VersionMeta label="Approving authority">
                        {version.approvingAuthority ?? 'Not recorded'}
                      </VersionMeta>
                      <VersionMeta label="Activated">
                        {version.activatedAt ? dateLabel(version.activatedAt) : 'Not activated'}
                      </VersionMeta>
                      <VersionMeta label="Entries">{version.entries.length.toString()}</VersionMeta>
                    </>
                  }
                  state={version.versionState}
                  versionNo={version.versionNo}
                >
                  {version.entries.length ? (
                    <Table
                      aria-label={'Version ' + version.versionNo + ' holiday entries'}
                      className="min-w-[560px]"
                    >
                      <thead>
                        <tr>
                          <Th kind="date">Date</Th>
                          <Th>Holiday</Th>
                          <Th>Day type</Th>
                          <Th>Source</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {version.entries.map((entry) => (
                          <Tr key={entry.id}>
                            <Td kind="date">{dateLabel(entry.holidayDate)}</Td>
                            <RowHeader>{entry.name}</RowHeader>
                            <Td>{label(entry.dayType)}</Td>
                            <Td className="text-ink-muted">{entry.sourceReference}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  ) : (
                    <p className="m-0 text-small text-ink-muted">
                      No holiday entries in this version.
                    </p>
                  )}
                </VersionCard>
              ))}
            </section>
            <TransitionHistory history={detail.history} id="holiday-calendar-audit-history-title" />
          </>
        ) : null}
      </DialogBody>
      <DetailFooter />
    </>
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
        <legend className="mb-1 text-panel-title text-ink">Calendar definition</legend>
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
        <div className="grid gap-1">
          <h3 className={sectionTitleClass} id="holiday-calendar-entries-title">
            Holiday entries
          </h3>
          <p className="m-0 text-small text-ink-muted">One row per holiday date and day type</p>
        </div>
        {values.entries.length === 0 ? (
          <p className="m-0 text-small text-ink-muted">
            A version needs at least one entry before it can be activated.
          </p>
        ) : null}
        {values.entries.map((entry, index) => (
          <div
            className={
              'grid items-end gap-3 ' +
              rowBoxClass +
              ' min-[900px]:grid-cols-[150px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]'
            }
            key={index}
          >
            <label className={labelClass}>
              <span>Holiday date</span>
              <input
                aria-label={'Holiday date ' + (index + 1)}
                className={inputClass}
                onChange={(event) => setEntry(index, { holidayDate: targetValue(event) })}
                required
                type="date"
                value={entry.holidayDate}
              />
            </label>
            <label className={labelClass}>
              <span>Holiday</span>
              <input
                aria-label={'Holiday name ' + (index + 1)}
                className={inputClass}
                maxLength={200}
                onChange={(event) => setEntry(index, { name: targetValue(event) })}
                required
                value={entry.name}
              />
            </label>
            <label className={labelClass}>
              <span>Day type</span>
              <select
                aria-label={'Holiday day type ' + (index + 1)}
                className={inputClass}
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
            <label className={labelClass}>
              <span>Source</span>
              <input
                aria-label={'Holiday source ' + (index + 1)}
                className={inputClass}
                maxLength={300}
                onChange={(event) => setEntry(index, { sourceReference: targetValue(event) })}
                required
                value={entry.sourceReference}
              />
            </label>
            <Button
              onClick={() =>
                setValue(
                  'entries',
                  values.entries.filter((_, position) => position !== index),
                )
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
  const [selectedCalendar, setSelectedCalendar] = useState<HolidayCalendar | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<ScheduleAssignment | null>(null);
  const [calendarDetail, setCalendarDetail] = useState<HolidayCalendarDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
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
  const [sectionFormOpen, setSectionFormOpen] = useState(false);
  const returnFocusRef = useRef<{ focus(): void } | null>(null);
  const schedulesRef = useRef<TabSectionHandle>(null);
  const arrangementsRef = useRef<TabSectionHandle>(null);
  const navigation = useRecordNavigation();
  const recordId = navigation.search.get('record');
  const recordKind =
    navigation.search.get('kind') === 'work-arrangement' ? 'work-arrangement' : 'work-schedule';

  useEffect(() => {
    if (recordId) setTab(recordKind === 'work-arrangement' ? 'arrangements' : 'schedules');
  }, [recordId, recordKind]);

  useEffect(() => {
    if (dialog !== 'calendar-activate' && dialog !== 'assignment-create') {
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
    entity: HolidayCalendar | ScheduleAssignment | null,
  ): void {
    returnFocusRef.current = target;
    resetAction();
    if (kind.startsWith('calendar')) setSelectedCalendar(entity as HolidayCalendar | null);
    else setSelectedAssignment(entity as ScheduleAssignment | null);
    setDialog(kind);
  }

  function closeDialog(force = false): void {
    if (busy && !force) return;
    const focusTarget = returnFocusRef.current;
    navigation.navigate({ record: null, view: null, kind: null });
    setDialog(null);
    setSelectedCalendar(null);
    setSelectedAssignment(null);
    setCalendarDetail(null);
    setTimeout(() => {
      focusTarget?.focus();
      setTimeout(() => focusTarget?.focus(), 0);
    }, 0);
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
      if (dialog === 'calendar-successor' && selectedCalendar) {
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
      if (dialog === 'calendar-activate' && selectedCalendar?.draft) {
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

  function calendarActions(calendar: HolidayCalendar) {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Button
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

  const editingCalendar = dialog === 'calendar-create' || dialog === 'calendar-edit';
  const showingForm =
    sectionFormOpen ||
    editingCalendar ||
    dialog === 'calendar-detail' ||
    dialog === 'assignment-create' ||
    dialog === 'assignment-end';
  const selectedLabel =
    dialog?.startsWith('calendar') && selectedCalendar
      ? selectedCalendar.code
      : dialog === 'assignment-end' && selectedAssignment
        ? selectedAssignment.employee.legalName
        : 'Attendance Configuration';
  const dialogDescriptionId = 'attendance-configuration-dialog-description';

  const recordCode =
    recordKind === 'work-arrangement'
      ? arrangements.find((item) => item.id === recordId)?.code
      : schedules.find((item) => item.id === recordId)?.code;
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
          open: (target) => schedulesRef.current?.openCreate(target),
        }
      : tab === 'arrangements' && canManage
        ? {
            name: 'Create Work Arrangement',
            open: (target) => arrangementsRef.current?.openCreate(target),
          }
        : tab === 'calendars' && canManage
          ? {
              name: 'Create Holiday Calendar',
              open: (target) => {
                resetAction();
                setCalendarValues(emptyHolidayCalendarValues());
                openDialog('calendar-create', target, null);
              },
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

          <SectionTabPanel value="calendars">
            <Panel
              title="Holiday Calendar register"
              flush
              actions={
                <span className="text-caption text-ink-muted">
                  {countLabel(calendars.length, 'calendar')} · Agency scoped · Published per version
                </span>
              }
            >
              {calendars.length === 0 ? (
                <StateSurface compact label="Holiday Calendars">
                  <strong className="text-body font-[650] text-ink">
                    No Holiday Calendars yet.
                  </strong>
                  <p className="m-0 max-w-[560px]">
                    A Holiday Calendar fixes the day types that Work Arrangement Versions pin for
                    their scope. Each activated version is immutable and superseded in turn.
                  </p>
                </StateSurface>
              ) : (
                <Table aria-label="Holiday Calendars" className="min-w-[860px]">
                  <thead>
                    <tr>
                      <Th>Holiday Calendar</Th>
                      <Th>Scope</Th>
                      <Th>Current version</Th>
                      <Th>Draft</Th>
                      <Th>
                        <span className="sr-only">Actions</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {calendars.map((calendar) => (
                      <Tr key={calendar.id}>
                        <RowHeader>
                          <div className="grid gap-1">
                            <button
                              className={recordLinkClass}
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
                            <span className="text-caption font-normal text-ink-muted">
                              {calendar.name}
                            </span>
                          </div>
                        </RowHeader>
                        <Td className="text-ink-muted">
                          {label(calendar.scopeType) + ' · ' + calendar.scopeReference}
                        </Td>
                        <Td>
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
                        </Td>
                        <Td className="text-ink-muted">
                          {calendar.draft
                            ? 'v' +
                              calendar.draft.versionNo +
                              ' · ' +
                              dateLabel(calendar.draft.effectiveFrom)
                            : 'None'}
                        </Td>
                        <Td>{calendarActions(calendar)}</Td>
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

        {/* Outside the hidden wrapper: the sections show their own forms inline in these panels. */}
        <SectionTabPanel value="schedules">
          <WorkSchedulesSection
            ref={schedulesRef}
            agencyId={agencyId}
            request={request}
            canManage={canManage}
            canActivate={canActivate}
            schedules={schedules}
            onRefresh={refreshSchedules}
            onFormChange={setSectionFormOpen}
            recordId={recordKind === 'work-schedule' ? recordId : null}
          />
        </SectionTabPanel>

        <SectionTabPanel value="arrangements">
          <WorkArrangementsSection
            agencyId={agencyId}
            arrangements={arrangements}
            calendars={calendars}
            canActivate={canActivate}
            canManage={canManage}
            onFormChange={setSectionFormOpen}
            onRefresh={refreshArrangements}
            recordId={recordKind === 'work-arrangement' ? recordId : null}
            ref={arrangementsRef}
            request={request}
          />
        </SectionTabPanel>

        <DialogContent
          aria-describedby={dialogDescriptionId}
          className={editingCalendar ? 'max-w-[980px]' : undefined}
        >
          <DialogHeader>
            <div className="grid min-w-0 gap-1.5">
              <DialogTitle>
                {dialog === 'calendar-create'
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
                {dialog === 'calendar-activate'
                  ? 'Activation pins the authority Document Version, validates the Draft, and retires any predecessor by supersession.'
                  : dialog === 'calendar-successor'
                    ? 'The successor copies the current published definition and receives a later effective date. It remains Draft until reviewed.'
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
                disabled={busy}
                type="button"
              >
                <span aria-hidden="true" className="text-xl leading-none">
                  ×
                </span>
              </Button>
            </DialogClose>
          </DialogHeader>

          {dialog === 'calendar-detail' ? (
            <HolidayCalendarDetailBody
              detail={calendarDetail}
              detailLoading={detailLoading}
              error={error}
            />
          ) : dialog === 'calendar-activate' ? (
            <ActivationForm
              activation={activation}
              error={error}
              evidenceLoading={evidenceLoading}
              evidenceOptions={evidenceOptions}
              onSubmit={submitActivation}
              setActivation={setActivation}
            />
          ) : dialog === 'calendar-successor' ? (
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
          ) : dialog === 'calendar-create' || dialog === 'calendar-edit' ? (
            <form
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              onSubmit={(event) => void submitHolidayCalendar(event)}
            >
              <DialogBody className="grid auto-rows-max content-start gap-6">
                <FormError message={error} />
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
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} type="submit" variant="primary">
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
          ) : null}
        </DialogContent>
      </SectionTabs>
    </Dialog>
  );
}
