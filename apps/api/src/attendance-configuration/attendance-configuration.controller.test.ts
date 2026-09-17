import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { AttendanceConfigurationController } from './attendance-configuration.controller';
import { AttendanceConfigurationServiceError } from './attendance-configuration.types';
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
      listHolidayCalendars: vi.fn(),
    },
  };
}

function controllerWith(mocks: ReturnType<typeof serviceMocks>) {
  return new AttendanceConfigurationController(
    mocks.schedules as never,
    mocks.arrangements as never,
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
  mocks.arrangements.listHolidayCalendars.mockResolvedValue([
    {
      id: documentVersionId,
      code: 'PH-NATIONAL',
      name: 'Philippine National Holidays',
      scopeType: 'AGENCY',
      scopeReference: 'Agency-wide',
      currentVersionId: null,
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
