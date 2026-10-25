import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import {
  cleanupAttendanceWorkflowAgency,
  createAttendanceWorkflowFixture,
  finalizeAttendancePeriod,
  manilaDate,
  manilaInstant,
  type AttendanceWorkflowFixture,
} from './attendance-test-fixtures';

const enabled = process.env.DATABASE_E2E === 'true';

const refusal = {
  statusCode: 409,
  code: 'ATTENDANCE_WORK_DATE_LOCKED',
  message: expect.stringContaining('Attendance Correction'),
};

function recorder(fixture: AttendanceWorkflowFixture): RequestContext {
  return {
    ...fixture.administratorContext,
    permissions: [
      ...fixture.administratorContext.permissions,
      { code: 'attendance.contexts.create', scopePolicy: 'AGENCY' },
      { code: 'attendance.events.create_manual', scopePolicy: 'AGENCY' },
    ],
  };
}

async function lockPeriod(fixture: AttendanceWorkflowFixture): Promise<void> {
  await finalizeAttendancePeriod(fixture.admin, fixture.periodId);
}

it.skipIf(!enabled)(
  'refuses an Attendance Context and a manual Attendance Event on a locked Work Date',
  async () => {
    const fixture = await createAttendanceWorkflowFixture();
    const context = recorder(fixture);
    const timed = (startsAt: string, endsAt: string) => ({
      employeeId: fixture.employeeId,
      contextType: 'OFFICIAL_BUSINESS' as const,
      coverageMode: 'TIMED' as const,
      startsAt: manilaInstant(fixture.workDate, startsAt).toISOString(),
      endsAt: manilaInstant(fixture.workDate, endsAt).toISOString(),
      reason: 'Attended an inter-agency meeting.',
      evidenceDocumentVersionId: fixture.evidenceDocumentVersionId,
    });
    try {
      // Unlocked Work Dates record as before.
      await fixture.services.contexts.record(context, timed('14:00', '15:00'));
      await fixture.services.attendance.captureManual(context, {
        employeeId: fixture.employeeId,
        eventType: 'TIME_OUT',
        eventTime: manilaInstant(fixture.workDate, '16:30').toISOString(),
        reason: 'Logbook entry transcribed.',
      });

      await lockPeriod(fixture);
      const counts = async () => ({
        contexts: await fixture.admin.attendanceContext.count({
          where: { agencyId: fixture.agencyId },
        }),
        events: await fixture.admin.attendanceEvent.count({
          where: { agencyId: fixture.agencyId },
        }),
        audits: await fixture.admin.auditEvent.count({ where: { agencyId: fixture.agencyId } }),
      });
      const before = await counts();

      await expect(
        fixture.services.contexts.record(context, timed('15:00', '16:00')),
      ).rejects.toMatchObject(refusal);
      await expect(
        fixture.services.contexts.record(context, {
          employeeId: fixture.employeeId,
          contextType: 'TRAINING',
          coverageMode: 'WHOLE_WORK_DATE',
          workDate: fixture.workDate,
          reason: 'Attended a mandatory training.',
          evidenceDocumentVersionId: fixture.evidenceDocumentVersionId,
        }),
      ).rejects.toMatchObject(refusal);
      await expect(
        fixture.services.attendance.captureManual(context, {
          employeeId: fixture.employeeId,
          eventType: 'TIME_OUT',
          eventTime: manilaInstant(fixture.workDate, '16:45').toISOString(),
          reason: 'Logbook entry transcribed.',
        }),
      ).rejects.toMatchObject(refusal);
      // An unmatched event has no Work Date; its local date fails closed.
      await expect(
        fixture.services.attendance.captureManual(context, {
          employeeId: fixture.employeeId,
          eventType: 'TIME_OUT',
          eventTime: manilaInstant(fixture.workDate, '21:00').toISOString(),
          reason: 'Logbook entry transcribed.',
        }),
      ).rejects.toMatchObject(refusal);

      expect(await counts()).toEqual(before);
    } finally {
      await cleanupAttendanceWorkflowAgency(fixture.admin, fixture.agencyId, fixture.suffix);
    }
  },
);

it.skipIf(!enabled)('refuses a web clock event on a locked Work Date', async () => {
  const fixture = await createAttendanceWorkflowFixture({ events: false });
  const today = manilaDate(0);
  try {
    const period = await fixture.services.days.calculate(fixture.administratorContext, {
      periodCode: `AWF-TODAY-${fixture.suffix.slice(0, 4)}`,
      dateFrom: today,
      dateTo: today,
      employeeIds: [fixture.employeeId],
    });
    await fixture.services.attendance.setWebClockEnablement(fixture.administratorContext, {
      enabled: true,
      effectiveFrom: today,
      reason: 'Approved web clock.',
    });
    await finalizeAttendancePeriod(fixture.admin, period.period.id);
    const employee: RequestContext = {
      ...fixture.employeeContext,
      permissions: [
        ...fixture.employeeContext.permissions,
        { code: 'attendance.events.clock', scopePolicy: 'OWN' },
      ],
    };

    await expect(fixture.services.attendance.clock(employee, {})).rejects.toMatchObject(refusal);
    expect(
      await fixture.admin.attendanceEvent.count({ where: { agencyId: fixture.agencyId } }),
    ).toBe(0);
  } finally {
    await cleanupAttendanceWorkflowAgency(fixture.admin, fixture.agencyId, fixture.suffix);
  }
});

it.skipIf(!enabled)(
  'refuses a timed Attendance Context on a locked Work Date without a Schedule Assignment',
  async () => {
    const fixture = await createAttendanceWorkflowFixture({ assignment: false, events: false });
    try {
      await lockPeriod(fixture);

      await expect(
        fixture.services.contexts.record(recorder(fixture), {
          employeeId: fixture.employeeId,
          contextType: 'OFFICIAL_BUSINESS',
          coverageMode: 'TIMED',
          startsAt: manilaInstant(fixture.workDate, '09:00').toISOString(),
          endsAt: manilaInstant(fixture.workDate, '10:00').toISOString(),
          reason: 'Attended an inter-agency meeting.',
          evidenceDocumentVersionId: fixture.evidenceDocumentVersionId,
        }),
      ).rejects.toMatchObject(refusal);
      expect(
        await fixture.admin.attendanceContext.count({ where: { agencyId: fixture.agencyId } }),
      ).toBe(0);
    } finally {
      await cleanupAttendanceWorkflowAgency(fixture.admin, fixture.agencyId, fixture.suffix);
    }
  },
);
