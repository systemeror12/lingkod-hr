'use client';

import { Field, inputClass, FormError } from './ui/field';
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
import { VersionMeta } from './attendance-configuration/shared';
import {
  countLabel,
  dateLabel,
  describeRequestError,
  errorMessage,
  label,
  noteClass,
  parseEvidenceOptions,
  targetValue,
  validForm,
} from './attendance-configuration/helpers';
import {
  weekdayLabels,
  type WorkSchedule,
  type WorkScheduleListResponse,
  type WorkArrangement,
  type WorkArrangementListResponse,
  type HolidayCalendar,
  type HolidayCalendarListResponse,
  type ScheduleAssignment,
  type ScheduleAssignmentListResponse,
  type AttendanceResolution,
  type EmployeeOption,
  type EvidenceOption,
  type AssignmentFormValues,
  type AssignmentEndValues,
  AttendanceRequestError,
  type DialogKind,
  type TabSectionHandle,
} from './attendance-configuration/types';
import { HolidayCalendarsSection } from './attendance-configuration/holiday-calendars-section';
import { WorkArrangementsSection } from './attendance-configuration/work-arrangements-section';
import {
  ruleWindow,
  WorkSchedulesSection,
} from './attendance-configuration/work-schedules-section';

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
  const [selectedAssignment, setSelectedAssignment] = useState<ScheduleAssignment | null>(null);
  const [assignmentValues, setAssignmentValues] = useState(emptyAssignmentValues);
  const [assignmentEndValues, setAssignmentEndValues] = useState<AssignmentEndValues>(() => ({
    effectiveTo: manilaToday(),
    reason: '',
  }));
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
  const calendarsRef = useRef<TabSectionHandle>(null);
  const navigation = useRecordNavigation();
  const recordId = navigation.search.get('record');
  const recordKind =
    navigation.search.get('kind') === 'work-arrangement' ? 'work-arrangement' : 'work-schedule';

  useEffect(() => {
    if (recordId) setTab(recordKind === 'work-arrangement' ? 'arrangements' : 'schedules');
  }, [recordId, recordKind]);

  useEffect(() => {
    if (dialog !== 'assignment-create') return;
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
  }

  function openDialog(
    kind: DialogKind,
    target: { focus(): void },
    entity: ScheduleAssignment | null,
  ): void {
    returnFocusRef.current = target;
    resetAction();
    setSelectedAssignment(entity);
    setDialog(kind);
  }

  function closeDialog(force = false): void {
    if (busy && !force) return;
    const focusTarget = returnFocusRef.current;
    navigation.navigate({ record: null, view: null, kind: null });
    setDialog(null);
    setSelectedAssignment(null);
    setTimeout(() => {
      focusTarget?.focus();
      setTimeout(() => focusTarget?.focus(), 0);
    }, 0);
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

  const showingForm =
    sectionFormOpen || dialog === 'assignment-create' || dialog === 'assignment-end';
  const selectedLabel =
    dialog === 'assignment-end' && selectedAssignment
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
              open: (target) => calendarsRef.current?.openCreate(target),
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

        <SectionTabPanel value="calendars">
          <HolidayCalendarsSection
            ref={calendarsRef}
            agencyId={agencyId}
            request={request}
            canManage={canManage}
            canActivate={canActivate}
            calendars={calendars}
            onRefresh={refreshCalendars}
            onFormChange={setSectionFormOpen}
          />
        </SectionTabPanel>

        <DialogContent aria-describedby={dialogDescriptionId}>
          <DialogHeader>
            <div className="grid min-w-0 gap-1.5">
              <DialogTitle>
                {dialog === 'assignment-create'
                  ? 'Create Schedule Assignment'
                  : 'End Schedule Assignment · ' + selectedLabel}
              </DialogTitle>
              <DialogDescription id={dialogDescriptionId}>
                {dialog === 'assignment-create'
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

          {dialog === 'assignment-create' ? (
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
