import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import {
  cleanupAttendanceWorkflowAgency,
  createAttendanceWorkflowFixture,
  manilaDate,
  manilaInstant,
  type AttendanceWorkflowFixture,
} from '../attendance-test-fixtures';
import { AttendanceCtoInputsService } from './attendance-cto-inputs.service';
import type { RecordCtoInput } from './attendance-cto-inputs.types';

const enabled = process.env.DATABASE_E2E === 'true';

async function activateLockRoute(fixture: AttendanceWorkflowFixture): Promise<void> {
  const route = await fixture.services.approvals.createRoute(fixture.administratorContext, {
    routeCode: 'DTR-PERIOD-LOCK',
    domain: 'ATTENDANCE',
    versionNo: 1,
    effectiveFrom: manilaDate(-30),
    stepDefinition: {
      steps: [
        {
          stepNo: 1,
          stepMode: 'SEQUENTIAL',
          requiredPermission: 'attendance.periods.approve',
          assignment: { kind: 'MEMBERSHIP', membershipId: fixture.memberships.officer },
          requiresSeparateReview: false,
        },
      ],
    },
  });
  await fixture.services.approvals.activateRoute(
    fixture.administratorContext,
    route.id,
    'Activate the Attendance Period lock route.',
  );
}

async function createSecondAdministrator(
  fixture: AttendanceWorkflowFixture,
): Promise<RequestContext> {
  const user = await fixture.admin.user.create({
    data: {
      emailNormalized: `attendance-cto-admin-two-${fixture.suffix}@example.test`,
      displayName: 'Attendance CTO Admin Two',
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await fixture.admin.agencyMembership.create({
    data: { agencyId: fixture.agencyId, userId: user.id, status: 'ACTIVE' },
  });
  return {
    ...fixture.administratorContext,
    requestId: `attendance-cto-${fixture.suffix}-administrator-two`,
    membershipId: membership.id,
  };
}

function shiftDate(value: string, days: number): string {
  return new Date(new Date(`${value}T00:00:00.000Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

it.skipIf(!enabled)(
  'records CTO inputs idempotently, places them as paid coverage, publishes them, and refuses overlaps, locked dates, and other Agencies',
  async () => {
    const fixture = await createAttendanceWorkflowFixture();
    const { admin, services, agencyId, employeeId, workDate } = fixture;
    const context = fixture.administratorContext;
    const cto = new AttendanceCtoInputsService(services.days);
    const foreignAgency = await admin.agency.create({
      data: {
        code: `CTO-B-${fixture.suffix}`,
        name: 'Attendance CTO Foreign Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const inAgency = <T>(
      run: (transaction: Parameters<Parameters<typeof withDatabaseContext>[1]>[0]) => Promise<T>,
    ) => withDatabaseContext({ agencyId, membershipId: context.membershipId }, run);
    const record = (input: RecordCtoInput) =>
      inAgency((transaction) => cto.recordInTransaction(transaction, context, input));
    const totals = async (date: string) => {
      const [day] = await services.days.list(context, {
        employeeId,
        workDateFrom: date,
        workDateTo: date,
      });
      return services.days.findById(context, day!.id);
    };

    try {
      // The fixture's Work Date worked 08:00-16:00 with a lunch break: 60 undertime minutes.
      expect((await totals(workDate)).day.totals).toMatchObject({ undertimeMinutes: 60 });
      const base = {
        employeeId,
        sourceType: 'CtoRequest',
        sourceId: employeeId,
      };
      const timed: RecordCtoInput = {
        ...base,
        sourceKey: `${fixture.suffix}-timed`,
        workDate,
        coverageMode: 'TIMED',
        startsAt: manilaInstant(workDate, '16:00').toISOString(),
        endsAt: manilaInstant(workDate, '17:00').toISOString(),
      };
      const first = await record(timed);
      const recalculated = await totals(workDate);
      expect(recalculated.day.calculationVersion).toBe(2);
      expect(recalculated.day.totals).toMatchObject({
        undertimeMinutes: 0,
        coverageMinutes: 480,
      });
      expect(recalculated.segments.find((segment) => segment.coverageType === 'CTO')).toMatchObject(
        { deficitType: null, dutyRelation: 'EXPECTED' },
      );

      // A retry returns the same input and leaves the Attendance Day unchanged.
      expect((await record(timed)).id).toBe(first.id);
      expect((await totals(workDate)).day.calculationVersion).toBe(2);
      await expect(
        record({ ...timed, endsAt: manilaInstant(workDate, '16:30').toISOString() }),
      ).rejects.toMatchObject({ code: 'CTO_INPUT_SOURCE_KEY_CONFLICT', statusCode: 409 });
      await expect(
        record({ ...timed, sourceKey: `${fixture.suffix}-whole`, coverageMode: 'WHOLE_WORK_DATE' }),
      ).rejects.toMatchObject({ code: 'CTO_INPUT_INVALID' });

      // Overlap with another current CTO input is refused.
      await expect(
        record({
          ...timed,
          sourceKey: `${fixture.suffix}-overlap`,
          startsAt: manilaInstant(workDate, '16:30').toISOString(),
          endsAt: manilaInstant(workDate, '17:30').toISOString(),
        }),
      ).rejects.toMatchObject({ code: 'CTO_INPUT_OVERLAPS_CTO', statusCode: 409 });
      await expect(
        record({
          ...base,
          sourceKey: `${fixture.suffix}-whole-overlap`,
          workDate,
          coverageMode: 'WHOLE_WORK_DATE',
        }),
      ).rejects.toMatchObject({ code: 'CTO_INPUT_OVERLAPS_CTO' });

      // Overlap with current posted leave is refused.
      const leaveDate = shiftDate(workDate, -1);
      await inAgency((transaction) =>
        services.postedLeaveInputs.createInTransaction(transaction, agencyId, {
          employeeId,
          sourceKey: `${fixture.suffix}-leave`,
          sourceType: 'LeavePosting',
          sourceId: employeeId,
          dateFrom: leaveDate,
          dateTo: leaveDate,
          unitCode: 'WORKING_DAY',
          quantity: 1,
          allocationKind: 'LEAVE_ACCOUNT',
        }),
      );
      await expect(
        record({
          ...base,
          sourceKey: `${fixture.suffix}-on-leave`,
          workDate: leaveDate,
          coverageMode: 'WHOLE_WORK_DATE',
        }),
      ).rejects.toMatchObject({ code: 'CTO_INPUT_OVERLAPS_POSTED_LEAVE', statusCode: 409 });

      // Whole Work Date CTO covers the date's expected duty with no deficit.
      const wholeDate = shiftDate(workDate, -2);
      const whole = await record({
        ...base,
        sourceKey: `${fixture.suffix}-whole-date`,
        workDate: wholeDate,
        coverageMode: 'WHOLE_WORK_DATE',
      });
      await services.days.calculate(context, {
        periodCode: `CTO-${fixture.suffix.slice(0, 12)}`,
        dateFrom: wholeDate,
        dateTo: wholeDate,
        employeeIds: [employeeId],
      });
      const wholeDay = await totals(wholeDate);
      expect(wholeDay.day.totals).toMatchObject({
        expectedMinutes: 480,
        coverageMinutes: 480,
        absenceMinutes: 0,
      });
      expect(wholeDay.segments.every((segment) => segment.coverageType === 'CTO')).toBe(true);
      expect(wholeDay.day.ruleSnapshot.coverageSources).toContainEqual({
        sourceType: 'CTO_INPUT',
        sourceId: whole.id,
        coverageType: 'CTO',
      });

      // Agency isolation: another Agency cannot name this Employee or read its inputs.
      await expect(
        withDatabaseContext({ agencyId: foreignAgency.id }, (transaction) =>
          cto.recordInTransaction(
            transaction,
            { ...context, agencyId: foreignAgency.id },
            {
              ...base,
              sourceKey: `${fixture.suffix}-foreign`,
              workDate: shiftDate(workDate, -3),
              coverageMode: 'WHOLE_WORK_DATE',
            },
          ),
        ),
      ).rejects.toMatchObject({ code: 'CTO_INPUT_EMPLOYEE_NOT_FOUND', statusCode: 404 });
      expect(
        await withDatabaseContext({ agencyId: foreignAgency.id }, (transaction) =>
          transaction.attendanceCtoInput.count({ where: { employeeId } }),
        ),
      ).toBe(0);

      // Inputs are immutable and retained.
      await expect(
        admin.attendanceCtoInput.update({ where: { id: first.id }, data: { sourceType: 'Other' } }),
      ).rejects.toThrow(/immutable/);
      await expect(admin.attendanceCtoInput.delete({ where: { id: first.id } })).rejects.toThrow(
        /retained/,
      );

      // Locking publishes CTO as its own Attendance Payroll Fact classification.
      await activateLockRoute(fixture);
      const submission = await services.submissions.create(fixture.employeeContext, {
        attendancePeriodId: fixture.periodId,
      });
      await services.submissions.submit(fixture.employeeContext, submission.submission.id);
      await services.submissions.approve(fixture.officerContext, submission.submission.id, {});
      const submitted = await services.periods.submitForReview(context, fixture.periodId);
      await services.periods.approve(fixture.officerContext, submitted.version.id, {});
      const locked = await services.periods.lock(
        await createSecondAdministrator(fixture),
        submitted.version.id,
      );
      const publication = await services.periods.findPublication(context, submitted.version.id);
      expect(publication.publication.id).toBe(locked.publication.id);
      expect(
        Object.fromEntries(publication.facts.map((fact) => [fact.factType, fact.correctedMinutes])),
      ).toEqual({ EXPECTED: 480, WORKED: 420, CTO: 60 });

      // A locked Work Date refuses a new input, while a retry still returns the original.
      await expect(
        record({
          ...base,
          sourceKey: `${fixture.suffix}-locked`,
          workDate,
          coverageMode: 'TIMED',
          startsAt: manilaInstant(workDate, '07:00').toISOString(),
          endsAt: manilaInstant(workDate, '07:30').toISOString(),
        }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_WORK_DATE_LOCKED', statusCode: 409 });
      expect((await record(timed)).id).toBe(first.id);
      expect(await admin.attendanceCtoInput.count({ where: { agencyId } })).toBe(2);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.attendanceCtoInput.deleteMany({ where: { agencyId } });
        await transaction.attendancePostedLeaveInput.deleteMany({ where: { agencyId } });
        await transaction.agency.delete({ where: { id: foreignAgency.id } });
      });
      await cleanupAttendanceWorkflowAgency(admin, agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);
