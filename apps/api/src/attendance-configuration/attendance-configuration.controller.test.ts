import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { AttendanceConfigurationController } from './attendance-configuration.controller';
import {
  AttendanceConfigurationServiceError,
  AttendanceExceptionError,
} from './attendance-configuration.types';
import type { WorkScheduleSummary } from './work-schedules.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const otherAgencyId = '00000000-0000-4000-8000-000000000002';
const scheduleId = '00000000-0000-4000-8000-000000000003';
const draftId = '00000000-0000-4000-8000-000000000004';
const documentVersionId = '00000000-0000-4000-8000-000000000005';
const context: RequestContext = {
  requestId: 'attendance-configuration-api-test',
  userId: '00000000-0000-4000-8000-000000000006',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000007',
  primaryOrganizationUnitId: null,
  permissions: [{ code: 'attendance.configuration.read', scopePolicy: 'AGENCY' }],
};

const dayRules = [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
  weekday <= 5
    ? {
        weekday,
        ruleType: 'FIXED' as const,
        dutyStartTime: '08:00',
        dutyEndTime: '17:00',
        requiredMinutes: 480,
        eventPattern: 'IN_OUT' as const,
        collectionBeforeMinutes: 0,
        collectionAfterMinutes: 0,
        breaks: [{ breakStartTime: '12:00', breakEndTime: '13:00' }],
      }
    : {
        weekday,
        ruleType: 'REST' as const,
        requiredMinutes: 0,
        eventPattern: 'IN_OUT' as const,
        collectionBeforeMinutes: 0,
        collectionAfterMinutes: 0,
        breaks: [],
      },
);

const schedule: WorkScheduleSummary = {
  id: scheduleId,
  code: 'ORDINARY',
  name: 'Ordinary Work Schedule',
  currentVersion: null,
  draft: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function serviceMocks() {
  return {
    schedules: {
      list: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      createSuccessor: vi.fn(),
      updateDraft: vi.fn(),
      activate: vi.fn(),
    },
    arrangements: {
      list: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      createSuccessor: vi.fn(),
      updateDraft: vi.fn(),
      activate: vi.fn(),
    },
    holidayCalendars: {
      list: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      createSuccessor: vi.fn(),
      updateDraft: vi.fn(),
      activate: vi.fn(),
    },
    assignments: {
      list: vi.fn(),
      create: vi.fn(),
      end: vi.fn(),
      resolveForWorkDate: vi.fn(),
    },
  };
}

function controllerWith(mocks: ReturnType<typeof serviceMocks>) {
  return new AttendanceConfigurationController(
    mocks.schedules as never,
    mocks.arrangements as never,
    mocks.holidayCalendars as never,
    mocks.assignments as never,
  );
}

it('does not disclose Attendance configuration outside the active Agency', async () => {
  const mocks = serviceMocks();
  const controller = controllerWith(mocks);

  await expect(controller.listWorkSchedules(otherAgencyId, context)).rejects.toMatchObject({
    status: 404,
    response: {
      error: { code: 'ATTENDANCE_CONFIGURATION_NOT_FOUND', requestId: context.requestId },
    },
  });
  expect(mocks.schedules.list).not.toHaveBeenCalled();
});

it('returns the active Agency register and preserves service error envelopes', async () => {
  const mocks = serviceMocks();
  mocks.schedules.list.mockResolvedValue([schedule]);
  const controller = controllerWith(mocks);

  await expect(controller.listWorkSchedules(agencyId, context)).resolves.toEqual({
    items: [expect.objectContaining({ id: scheduleId, code: 'ORDINARY' })],
  });
  expect(mocks.schedules.list).toHaveBeenCalledWith(context);

  mocks.schedules.create.mockRejectedValue(
    new AttendanceConfigurationServiceError(
      'A Work Schedule with this Agency code already exists.',
      409,
      'WORK_SCHEDULE_CODE_CONFLICT',
    ),
  );
  await expect(
    controller.createWorkSchedule(
      agencyId,
      {
        code: 'ORDINARY',
        name: 'Ordinary Work Schedule',
        scheduleType: 'REGULAR',
        effectiveDate: '2026-01-01',
        dayRules,
      },
      context,
    ),
  ).rejects.toMatchObject({
    status: 409,
    response: {
      error: { code: 'WORK_SCHEDULE_CODE_CONFLICT', requestId: context.requestId },
    },
  });
});

it('forwards evidence-backed activation with the Idempotency-Key', async () => {
  const mocks = serviceMocks();
  mocks.schedules.activate.mockResolvedValue({ ...schedule, currentVersion: null });
  const controller = controllerWith(mocks);

  await expect(
    controller.activateWorkSchedule(
      agencyId,
      scheduleId,
      draftId,
      {
        authorityDocumentVersionId: documentVersionId,
        approvingAuthority: 'Office of the President',
        reason: 'Approved after review.',
      },
      'activate-ordinary',
      context,
    ),
  ).resolves.toMatchObject({ id: scheduleId, code: 'ORDINARY' });
  expect(mocks.schedules.activate).toHaveBeenCalledWith(
    context,
    scheduleId,
    draftId,
    {
      authorityDocumentVersionId: documentVersionId,
      approvingAuthority: 'Office of the President',
      reason: 'Approved after review.',
    },
    'activate-ordinary',
  );
});

it('rejects invalid bodies and superseded Idempotency-Keys at the boundary', async () => {
  const mocks = serviceMocks();
  const controller = controllerWith(mocks);

  await expect(
    controller.createWorkSchedule(
      agencyId,
      { code: 'ORDINARY', name: 'Ordinary Work Schedule', scheduleType: 'REGULAR' },
      context,
    ),
  ).rejects.toMatchObject({
    status: 400,
    response: { error: { code: 'INVALID_INPUT', requestId: context.requestId } },
  });
  expect(mocks.schedules.create).not.toHaveBeenCalled();

  await expect(
    controller.activateWorkSchedule(
      agencyId,
      scheduleId,
      draftId,
      {
        authorityDocumentVersionId: documentVersionId,
        approvingAuthority: 'Office of the President',
        reason: 'Approved after review.',
      },
      ' ',
      context,
    ),
  ).rejects.toMatchObject({
    status: 400,
    response: { error: { code: 'INVALID_IDEMPOTENCY_KEY', requestId: context.requestId } },
  });
});

it('forwards Work Arrangement transitions and Holiday Calendar reads', async () => {
  const mocks = serviceMocks();
  mocks.arrangements.createSuccessor.mockResolvedValue({
    current: { id: scheduleId },
    draft: { id: draftId },
  });
  mocks.holidayCalendars.list.mockResolvedValue([
    {
      id: documentVersionId,
      code: 'PH-NATIONAL',
      name: 'Philippine National Holidays',
      scopeType: 'AGENCY',
      scopeReference: 'Agency-wide',
      currentVersion: null,
      draft: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ]);
  const controller = controllerWith(mocks);

  await expect(
    controller.createWorkArrangementSuccessor(agencyId, scheduleId, context),
  ).resolves.toMatchObject({ id: draftId });
  await expect(controller.listHolidayCalendars(agencyId, context)).resolves.toMatchObject({
    items: [expect.objectContaining({ code: 'PH-NATIONAL' })],
  });
});

const employeeId = '00000000-0000-4000-8000-000000000008';
const assignmentId = '00000000-0000-4000-8000-000000000009';

const assignment = {
  id: assignmentId,
  employee: { id: employeeId, employeeNumber: 'EMP-0001', legalName: 'Maria Santos' },
  workScheduleVersionId: scheduleId,
  workScheduleVersionNo: 1,
  scheduleType: 'REGULAR' as const,
  workScheduleCode: 'ORDINARY',
  workScheduleName: 'Ordinary Work Schedule',
  workArrangementVersionId: draftId,
  workArrangementVersionNo: 1,
  arrangementType: 'ONSITE' as const,
  workArrangementCode: 'ONSITE',
  workArrangementName: 'Onsite Work Arrangement',
  holidayCalendarId: documentVersionId,
  authorityDocumentVersionId: documentVersionId,
  effectiveFrom: '2026-01-05',
  effectiveTo: null,
  assignedByMembershipId: context.membershipId,
  createdAt: '2026-01-05T00:00:00.000Z',
  updatedAt: '2026-01-05T00:00:00.000Z',
  rowVersion: 1,
};

it('forwards Schedule Assignment transitions with the Idempotency-Key', async () => {
  const mocks = serviceMocks();
  mocks.assignments.create.mockResolvedValue(assignment);
  mocks.assignments.end.mockResolvedValue({ ...assignment, effectiveTo: '2026-06-30' });
  const controller = controllerWith(mocks);

  await expect(
    controller.createScheduleAssignment(
      agencyId,
      {
        employeeId,
        workScheduleVersionId: scheduleId,
        workArrangementVersionId: draftId,
        authorityDocumentVersionId: documentVersionId,
        effectiveFrom: '2026-01-05',
      },
      'assignment-create',
      context,
    ),
  ).resolves.toMatchObject({ id: assignmentId, effectiveTo: null });
  expect(mocks.assignments.create).toHaveBeenCalledWith(
    context,
    {
      employeeId,
      workScheduleVersionId: scheduleId,
      workArrangementVersionId: draftId,
      authorityDocumentVersionId: documentVersionId,
      effectiveFrom: '2026-01-05',
    },
    'assignment-create',
  );

  await expect(
    controller.endScheduleAssignment(
      agencyId,
      assignmentId,
      { effectiveTo: '2026-06-30', reason: 'Reassignment.' },
      context,
    ),
  ).resolves.toMatchObject({ id: assignmentId, effectiveTo: '2026-06-30' });
  expect(mocks.assignments.end).toHaveBeenCalledWith(context, assignmentId, {
    effectiveTo: '2026-06-30',
    reason: 'Reassignment.',
  });

  mocks.assignments.create.mockClear();
  await expect(
    controller.createScheduleAssignment(agencyId, { employeeId }, undefined, context),
  ).rejects.toMatchObject({
    status: 400,
    response: { error: { code: 'INVALID_INPUT', requestId: context.requestId } },
  });
  expect(mocks.assignments.create).not.toHaveBeenCalled();
});

it('exposes the Attendance Exception cause on the blocking error envelope', async () => {
  const mocks = serviceMocks();
  mocks.assignments.resolveForWorkDate.mockRejectedValue(
    new AttendanceExceptionError(
      'MISSING_SCHEDULE_ASSIGNMENT',
      'No Schedule Assignment is effective on the Work Date.',
      { employeeId, workDate: '2026-01-05' },
    ),
  );
  const controller = controllerWith(mocks);

  await expect(
    controller.resolveScheduleAssignment(agencyId, employeeId, '2026-01-05', context),
  ).rejects.toMatchObject({
    status: 409,
    response: {
      error: {
        code: 'ATTENDANCE_EXCEPTION',
        exceptionType: 'MISSING_SCHEDULE_ASSIGNMENT',
        details: { employeeId, workDate: '2026-01-05' },
        requestId: context.requestId,
      },
    },
  });
});
