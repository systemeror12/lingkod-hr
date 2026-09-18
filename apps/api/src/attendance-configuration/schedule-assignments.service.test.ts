import { expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { attendanceConfigurationAuditWriter } from './attendance-configuration.audit';
import { HolidayCalendarsService } from './holiday-calendars.service';
import { ScheduleAssignmentsService } from './schedule-assignments.service';
import { WorkArrangementsService } from './work-arrangements.service';
import { WorkSchedulesService } from './work-schedules.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const assignmentId = '00000000-0000-4000-8000-000000000004';
const employeeId = '00000000-0000-4000-8000-000000000005';
const scheduleVersionId = '00000000-0000-4000-8000-000000000006';
const arrangementVersionId = '00000000-0000-4000-8000-000000000007';
const documentVersionId = '00000000-0000-4000-8000-000000000008';
const documentsService = {} as ConstructorParameters<typeof WorkSchedulesService>[1];

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'schedule-assignment-service-test',
    userId: '00000000-0000-4000-8000-000000000002',
    agencyId,
    membershipId: '00000000-0000-4000-8000-000000000003',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

function service() {
  return new ScheduleAssignmentsService(
    attendanceConfigurationAuditWriter,
    documentsService,
    new WorkSchedulesService(attendanceConfigurationAuditWriter, documentsService),
    new WorkArrangementsService(attendanceConfigurationAuditWriter, documentsService),
    new HolidayCalendarsService(attendanceConfigurationAuditWriter, documentsService),
  );
}

const configure = [{ code: 'attendance.configuration.manage', scopePolicy: 'AGENCY' }] as const;
const assign = [{ code: 'attendance.assignments.manage', scopePolicy: 'AGENCY' }] as const;

it('rechecks permissions before opening a Schedule Assignment workflow', async () => {
  const assignments = service();

  await expect(assignments.list(context([]))).rejects.toMatchObject({
    code: 'SCHEDULE_ASSIGNMENT_READ_FORBIDDEN',
    statusCode: 403,
  });
  await expect(
    assignments.resolveForWorkDate(context([]), employeeId, '2026-01-05'),
  ).rejects.toMatchObject({ code: 'SCHEDULE_ASSIGNMENT_READ_FORBIDDEN', statusCode: 403 });
  await expect(
    assignments.create(context([]), {
      employeeId,
      workScheduleVersionId: scheduleVersionId,
      workArrangementVersionId: arrangementVersionId,
      authorityDocumentVersionId: documentVersionId,
      effectiveFrom: '2026-01-05',
    }),
  ).rejects.toMatchObject({ code: 'SCHEDULE_ASSIGNMENT_MANAGE_FORBIDDEN', statusCode: 403 });
  await expect(
    assignments.end(context([]), assignmentId, {
      effectiveTo: '2026-06-30',
      reason: 'Reassignment.',
    }),
  ).rejects.toMatchObject({ code: 'SCHEDULE_ASSIGNMENT_MANAGE_FORBIDDEN', statusCode: 403 });
});

it('keeps configuration management separate from assignment management', async () => {
  const assignments = service();

  await expect(
    assignments.create(context(configure), {
      employeeId,
      workScheduleVersionId: scheduleVersionId,
      workArrangementVersionId: arrangementVersionId,
      authorityDocumentVersionId: documentVersionId,
      effectiveFrom: '2026-01-05',
    }),
  ).rejects.toMatchObject({ code: 'SCHEDULE_ASSIGNMENT_MANAGE_FORBIDDEN', statusCode: 403 });
  await expect(assignments.list(context(assign))).rejects.toMatchObject({
    code: 'SCHEDULE_ASSIGNMENT_READ_FORBIDDEN',
    statusCode: 403,
  });
});

it('requires a reason before ending a Schedule Assignment', async () => {
  const assignments = service();

  await expect(
    assignments.end(context(assign), assignmentId, {
      effectiveTo: '2026-06-30',
      reason: ' ',
    }),
  ).rejects.toMatchObject({
    code: 'SCHEDULE_ASSIGNMENT_END_REASON_REQUIRED',
    statusCode: 400,
  });
});
