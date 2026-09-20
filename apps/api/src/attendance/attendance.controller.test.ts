import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { AttendanceExceptionError } from '../attendance-configuration/attendance-configuration.types';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import {
  AttendanceServiceError,
  type AttendanceClockStateSummary,
  type AttendanceEventCaptureResult,
  type AttendanceEventSummary,
  type AttendanceWebClockStatusSummary,
} from './attendance.types';

const agencyId = '00000000-0000-4000-8000-000000000001';
const otherAgencyId = '00000000-0000-4000-8000-000000000002';
const employeeId = '00000000-0000-4000-8000-000000000003';
const eventId = '00000000-0000-4000-8000-000000000004';
const versionId = '00000000-0000-4000-8000-000000000005';
const context: RequestContext = {
  requestId: 'attendance-api-test',
  userId: '00000000-0000-4000-8000-000000000006',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000007',
  primaryOrganizationUnitId: null,
  permissions: [
    { code: 'attendance.configuration.read', scopePolicy: 'AGENCY' },
    { code: 'attendance.configuration.activate', scopePolicy: 'AGENCY' },
    { code: 'attendance.events.read', scopePolicy: 'AGENCY' },
    { code: 'attendance.events.create_manual', scopePolicy: 'AGENCY' },
    { code: 'attendance.events.clock', scopePolicy: 'AGENCY' },
  ],
};

const employee = { id: employeeId, employeeNumber: 'EMP-1', legalName: 'Employee One' };

const event: AttendanceEventSummary = {
  id: eventId,
  employeeId,
  employee,
  eventTime: '2026-01-02T00:00:00.000Z',
  eventType: 'TIME_IN',
  source: 'MANUAL',
  sourceReference: null,
  enteredByMembershipId: context.membershipId,
  reason: 'Power interruption.',
  createdAt: '2026-01-02T00:05:00.000Z',
};

const webClock: AttendanceWebClockStatusSummary = {
  asOf: '2026-01-02',
  enabled: true,
  version: {
    id: versionId,
    versionNo: 1,
    enabled: true,
    effectiveFrom: '2026-01-02',
    effectiveTo: null,
    status: 'ACTIVE',
    reason: 'Approved web clock.',
    activatedByMembershipId: context.membershipId,
    activatedAt: '2026-01-02T00:00:00.000Z',
    createdAt: '2026-01-02T00:00:00.000Z',
  },
  history: [],
};

const capture: AttendanceEventCaptureResult = {
  event,
  match: {
    status: 'UNMATCHED',
    workDate: null,
    unscheduled: false,
    association: null,
    matches: [],
  },
  exceptions: [],
  presentation: null,
};

const clockState: AttendanceClockStateSummary = {
  asOf: '2026-01-02',
  enabled: true,
  employee,
  nextEventType: 'TIME_IN',
  association: null,
  exceptions: [],
  events: [],
};

function serviceMocks() {
  return {
    getWebClockStatus: vi.fn(),
    setWebClockEnablement: vi.fn(),
    listEvents: vi.fn(),
    getEventContext: vi.fn(),
    captureManual: vi.fn(),
    getClockState: vi.fn(),
    clock: vi.fn(),
  };
}

function controllerWith(mocks: ReturnType<typeof serviceMocks>) {
  return new AttendanceController(mocks as unknown as AttendanceService);
}

it('does not disclose Attendance records outside the active Agency', async () => {
  const mocks = serviceMocks();
  const controller = controllerWith(mocks);

  await expect(
    controller.getWebClockStatus(otherAgencyId, undefined, context),
  ).rejects.toMatchObject({
    status: 404,
    response: { error: { code: 'ATTENDANCE_NOT_FOUND', requestId: context.requestId } },
  });
  await expect(
    controller.createManualEvent(
      otherAgencyId,
      {
        employeeId,
        eventType: 'TIME_IN',
        eventTime: '2026-01-02T00:00:00+08:00',
        reason: 'Late entry.',
      },
      undefined,
      context,
    ),
  ).rejects.toMatchObject({
    status: 403,
    response: { error: { code: 'ATTENDANCE_WRITE_FORBIDDEN', requestId: context.requestId } },
  });
  expect(mocks.getWebClockStatus).not.toHaveBeenCalled();
  expect(mocks.captureManual).not.toHaveBeenCalled();
});

it('returns the web clock status and forwards enablement with the Idempotency-Key', async () => {
  const mocks = serviceMocks();
  mocks.setWebClockEnablement.mockResolvedValue(webClock);
  const controller = controllerWith(mocks);

  await expect(
    controller.setWebClockEnablement(
      agencyId,
      { enabled: true, effectiveFrom: '2026-01-02', reason: 'Approved web clock.' },
      'clock-enable-1',
      context,
    ),
  ).resolves.toMatchObject({ asOf: '2026-01-02', enabled: true, version: { id: versionId } });
  expect(mocks.setWebClockEnablement).toHaveBeenCalledWith(
    context,
    { enabled: true, effectiveFrom: '2026-01-02', reason: 'Approved web clock.' },
    'clock-enable-1',
  );
});

it('returns captured events and forwards manual entry with the Idempotency-Key', async () => {
  const mocks = serviceMocks();
  mocks.captureManual.mockResolvedValue(capture);
  const controller = controllerWith(mocks);

  await expect(
    controller.createManualEvent(
      agencyId,
      {
        employeeId,
        eventType: 'TIME_IN',
        eventTime: '2026-01-02T00:00:00+08:00',
        reason: 'Power interruption.',
      },
      'manual-entry-1',
      context,
    ),
  ).resolves.toMatchObject({
    event: { id: eventId, eventType: 'TIME_IN' },
    match: { status: 'UNMATCHED' },
  });
  expect(mocks.captureManual).toHaveBeenCalledWith(
    context,
    {
      employeeId,
      eventType: 'TIME_IN',
      eventTime: '2026-01-02T00:00:00+08:00',
      reason: 'Power interruption.',
    },
    'manual-entry-1',
  );
});

it('lists events with a parsed filter and returns work date context', async () => {
  const mocks = serviceMocks();
  mocks.listEvents.mockResolvedValue([event]);
  mocks.getEventContext.mockResolvedValue({
    workDate: '2026-01-02',
    association: null,
    exceptions: [],
    events: [],
  });
  const controller = controllerWith(mocks);

  await expect(
    controller.listEvents(agencyId, { employeeId, from: '2026-01-01', to: '2026-01-31' }, context),
  ).resolves.toMatchObject({ events: [{ id: eventId, employee: { id: employeeId } }] });
  expect(mocks.listEvents).toHaveBeenCalledWith(context, {
    employeeId,
    from: '2026-01-01',
    to: '2026-01-31',
  });

  await expect(
    controller.getEventContext(agencyId, employeeId, '2026-01-02', context),
  ).resolves.toMatchObject({ workDate: '2026-01-02', events: [] });
  expect(mocks.getEventContext).toHaveBeenCalledWith(context, employeeId, '2026-01-02');
});

it('returns clock state and the captured web clock event', async () => {
  const mocks = serviceMocks();
  mocks.getClockState.mockResolvedValue(clockState);
  mocks.clock.mockResolvedValue({
    ...capture,
    event: { ...event, source: 'WEB_CLOCK', sourceReference: context.requestId, reason: null },
  });
  const controller = controllerWith(mocks);

  await expect(controller.getClockState(agencyId, context)).resolves.toMatchObject({
    enabled: true,
    nextEventType: 'TIME_IN',
    employee: { id: employeeId },
  });
  await expect(
    controller.clock(agencyId, { eventType: 'TIME_IN' }, 'clock-1', context),
  ).resolves.toMatchObject({ event: { id: eventId, source: 'WEB_CLOCK' } });
  expect(mocks.clock).toHaveBeenCalledWith(context, { eventType: 'TIME_IN' }, 'clock-1');
});

it('rejects invalid bodies, malformed Idempotency-Keys, and service failures', async () => {
  const mocks = serviceMocks();
  const controller = controllerWith(mocks);

  await expect(
    controller.createManualEvent(
      agencyId,
      { employeeId, eventType: 'TIME_IN' },
      undefined,
      context,
    ),
  ).rejects.toMatchObject({
    status: 400,
    response: { error: { code: 'INVALID_INPUT', requestId: context.requestId } },
  });
  expect(mocks.captureManual).not.toHaveBeenCalled();

  await expect(controller.clock(agencyId, {}, ' ', context)).rejects.toMatchObject({
    status: 400,
    response: { error: { code: 'INVALID_IDEMPOTENCY_KEY', requestId: context.requestId } },
  });

  mocks.getClockState.mockRejectedValue(
    new AttendanceServiceError(
      'The Agency web clock is disabled.',
      409,
      'ATTENDANCE_WEB_CLOCK_DISABLED',
    ),
  );
  await expect(controller.getClockState(agencyId, context)).rejects.toMatchObject({
    status: 409,
    response: {
      error: { code: 'ATTENDANCE_WEB_CLOCK_DISABLED', requestId: context.requestId },
    },
  });

  mocks.captureManual.mockRejectedValue(
    new AttendanceExceptionError('MISSING_SERVICE', 'No active service.', { employeeId }),
  );
  await expect(
    controller.createManualEvent(
      agencyId,
      {
        employeeId,
        eventType: 'TIME_IN',
        eventTime: '2026-01-02T00:00:00+08:00',
        reason: 'Power interruption.',
      },
      undefined,
      context,
    ),
  ).rejects.toMatchObject({
    status: 409,
    response: {
      error: {
        code: 'ATTENDANCE_EXCEPTION',
        exceptionType: 'MISSING_SERVICE',
        requestId: context.requestId,
      },
    },
  });
});
