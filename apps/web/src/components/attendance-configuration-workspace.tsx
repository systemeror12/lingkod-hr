'use client';

import { useRecordNavigation } from './record-navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { PageHeader, type Breadcrumb } from './ui/page-header';
import { SectionTabList, SectionTabPanel, SectionTabs } from './ui/section-tabs';
import { errorMessage } from './attendance-configuration/helpers';
import {
  type WorkSchedule,
  type WorkScheduleListResponse,
  type WorkArrangement,
  type WorkArrangementListResponse,
  type HolidayCalendar,
  type HolidayCalendarListResponse,
  AttendanceRequestError,
  type TabSectionHandle,
} from './attendance-configuration/types';
import { AssignmentsSection } from './attendance-configuration/assignments-section';
import { HolidayCalendarsSection } from './attendance-configuration/holiday-calendars-section';
import { WorkArrangementsSection } from './attendance-configuration/work-arrangements-section';
import { WorkSchedulesSection } from './attendance-configuration/work-schedules-section';

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
  const [sectionFormOpen, setSectionFormOpen] = useState(false);
  const schedulesRef = useRef<TabSectionHandle>(null);
  const arrangementsRef = useRef<TabSectionHandle>(null);
  const calendarsRef = useRef<TabSectionHandle>(null);
  const assignmentsRef = useRef<TabSectionHandle>(null);
  const navigation = useRecordNavigation();
  const recordId = navigation.search.get('record');
  const recordKind =
    navigation.search.get('kind') === 'work-arrangement' ? 'work-arrangement' : 'work-schedule';

  useEffect(() => {
    if (recordId) setTab(recordKind === 'work-arrangement' ? 'arrangements' : 'schedules');
  }, [recordId, recordKind]);

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
                open: (target) => assignmentsRef.current?.openCreate(target),
              }
            : null;

  return (
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
              hidden={sectionFormOpen}
              onClick={(event) => creator.open(event.currentTarget as unknown as { focus(): void })}
              type="button"
              variant="primary"
            >
              {creator.name}
            </Button>
          ) : null
        }
        breadcrumbs={breadcrumbs}
        tabs={
          <div hidden={sectionFormOpen}>
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

      <p hidden={sectionFormOpen} className="m-0 max-w-[760px] text-small text-ink-muted">
        Maintain effective-dated Work Schedule and Work Arrangement Versions, the Holiday Calendars
        that bind their scope, and the Schedule Assignments that resolve personnel to a duty roster
        on any Work date. Published versions are immutable.
      </p>

      {/* The sections show their own forms inline in these panels. */}
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

      {/* Kept mounted so loaded Assignments and Employees survive tab switches. */}
      <SectionTabPanel forceMount value="assignments" className="data-[state=inactive]:hidden">
        <AssignmentsSection
          ref={assignmentsRef}
          agencyId={agencyId}
          request={request}
          active={tab === 'assignments'}
          canAssign={canAssign}
          schedules={schedules}
          arrangements={arrangements}
          onFormChange={setSectionFormOpen}
        />
      </SectionTabPanel>
    </SectionTabs>
  );
}
