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

/**
 * A second Employee in the fixture Agency on an overnight 22:00-06:00 Work
 * Schedule, so a Work Date's calculation window runs past midnight.
 */
async function createOvernightEmployee(fixture: AttendanceWorkflowFixture): Promise<string> {
  const { admin, agencyId, services, suffix } = fixture;
  const context = fixture.administratorContext;
  const evidenceOf = (documentType: string) =>
    admin.documentVersion.findFirstOrThrow({
      where: { agencyId, document: { documentType } },
      select: { id: true },
    });
  const scheduleEvidence = await evidenceOf('WORK_SCHEDULE_AUTHORITY');
  const assignmentEvidence = await evidenceOf('SCHEDULE_ASSIGNMENT_AUTHORITY');
  const effectiveFrom = manilaDate(-30);
  const schedule = await services.schedules.create(context, {
    code: 'OVERNIGHT',
    name: 'Overnight Work Schedule',
    scheduleType: 'REGULAR',
    effectiveDate: effectiveFrom,
    dayRules: [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
      weekday <= 5
        ? {
            weekday,
            ruleType: 'FIXED' as const,
            dutyStartTime: '22:00',
            dutyEndTime: '06:00',
            endNextCalendarDay: true,
            requiredMinutes: 480,
            eventPattern: 'IN_OUT' as const,
            collectionBeforeMinutes: 0,
            collectionAfterMinutes: 0,
            breaks: [],
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
    ),
  });
  const active = await services.schedules.activate(context, schedule.id, schedule.draft!.id, {
    authorityDocumentVersionId: scheduleEvidence.id,
    approvingAuthority: 'Office of the President',
    reason: 'Overnight schedule authority reviewed.',
  });
  const arrangementVersion = await admin.workArrangementVersion.findFirstOrThrow({
    where: { agencyId },
    select: { id: true },
  });
  const employee = await admin.employee.create({
    data: {
      agencyId,
      employeeNumber: `CTO-NIGHT-${suffix}`,
      legalName: `Attendance CTO Night ${suffix}`,
      birthDate: new Date('1990-01-01'),
      sex: 'FEMALE',
      civilStatus: 'SINGLE',
      contactEmail: `attendance-cto-night-${suffix}@example.test`,
      serviceStatus: 'ACTIVE',
      createdByMembershipId: fixture.memberships.administrator,
      updatedByMembershipId: fixture.memberships.administrator,
    },
  });
  await withDatabaseContext(
    {
      agencyId,
      membershipId: fixture.memberships.administrator,
      capabilities: ['personnel-baseline-transition'],
    },
    (transaction) =>
      transaction.serviceSegment.create({
        data: {
          agencyId,
          employeeId: employee.id,
          organizationUnitId: fixture.unitId,
          appointmentStatus: 'PERMANENT',
          salaryGrade: 18,
          salaryStep: 2,
          effectiveFrom: new Date('2020-01-01'),
          status: 'ACTIVE',
          createdByMembershipId: fixture.memberships.administrator,
        },
      }),
  );
  await services.assignments.create(context, {
    employeeId: employee.id,
    workScheduleVersionId: active.currentVersion!.id,
    workArrangementVersionId: arrangementVersion.id,
    authorityDocumentVersionId: assignmentEvidence.id,
    effectiveFrom,
  });
  return employee.id;
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
        ctoMinutes: 60,
      });
      expect(
        (await admin.attendanceDay.findUniqueOrThrow({ where: { id: recalculated.day.id } }))
          .ctoMinutes,
      ).toBe(60);
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
          endsAt: manilaInstant(workDate, '17:00').toISOString(),
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

      // The database refuses a TIMED row missing a bound.
      await expect(
        withDatabaseContext({ agencyId }, (transaction) =>
          transaction.attendanceCtoInput.create({
            data: {
              agencyId,
              employeeId,
              sourceKey: `${fixture.suffix}-null-bound`,
              sourceType: 'CtoRequest',
              sourceId: employeeId,
              workDate: new Date(`${shiftDate(workDate, -7)}T00:00:00.000Z`),
              coverageMode: 'TIMED',
              startsAt: manilaInstant(shiftDate(workDate, -7), '08:00'),
            },
          }),
        ),
      ).rejects.toThrow(/attendance_cto_inputs_coverage_check/);

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
      // The stored CTO total reconciles with the published CTO classification.
      const reconciliation = await services.periods.reconcile(context, submitted.version.id);
      expect(reconciliation.ok).toBe(true);
      expect(reconciliation.payroll.factTypeMinutes).toMatchObject({ CTO: 60 });
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

it.skipIf(!enabled)(
  "refuses a timed CTO interval outside the Work Date's expected duty, which an overnight Day Rule extends past midnight",
  async () => {
    const fixture = await createAttendanceWorkflowFixture();
    const { admin, services, agencyId, employeeId, workDate } = fixture;
    const context = fixture.administratorContext;
    const cto = new AttendanceCtoInputsService(services.days);
    const record = (input: RecordCtoInput) =>
      withDatabaseContext({ agencyId, membershipId: context.membershipId }, (transaction) =>
        cto.recordInTransaction(transaction, context, input),
      );
    const base = { employeeId, sourceType: 'CtoRequest', sourceId: employeeId };

    try {
      const nightEmployeeId = await createOvernightEmployee(fixture);
      const nightDate = shiftDate(workDate, -6);
      const night = { ...base, employeeId: nightEmployeeId, workDate: nightDate };
      await record({
        ...night,
        sourceKey: `${fixture.suffix}-after-midnight`,
        coverageMode: 'TIMED',
        startsAt: manilaInstant(shiftDate(nightDate, 1), '00:00').toISOString(),
        endsAt: manilaInstant(shiftDate(nightDate, 1), '02:00').toISOString(),
      });
      await expect(
        record({
          ...night,
          sourceKey: `${fixture.suffix}-other-date`,
          coverageMode: 'TIMED',
          startsAt: manilaInstant(shiftDate(nightDate, -1), '22:00').toISOString(),
          endsAt: manilaInstant(shiftDate(nightDate, -1), '23:00').toISOString(),
        }),
      ).rejects.toMatchObject({ code: 'CTO_INPUT_OUTSIDE_EXPECTED_DUTY', statusCode: 400 });
      await expect(
        record({
          ...night,
          sourceKey: `${fixture.suffix}-past-window`,
          coverageMode: 'TIMED',
          startsAt: manilaInstant(shiftDate(nightDate, 1), '05:30').toISOString(),
          endsAt: manilaInstant(shiftDate(nightDate, 1), '06:30').toISOString(),
        }),
      ).rejects.toMatchObject({ code: 'CTO_INPUT_OUTSIDE_EXPECTED_DUTY' });
      await expect(
        record({
          ...base,
          sourceKey: `${fixture.suffix}-day-other-date`,
          workDate: nightDate,
          coverageMode: 'TIMED',
          startsAt: manilaInstant(shiftDate(nightDate, 1), '08:00').toISOString(),
          endsAt: manilaInstant(shiftDate(nightDate, 1), '09:00').toISOString(),
        }),
      ).rejects.toMatchObject({ code: 'CTO_INPUT_OUTSIDE_EXPECTED_DUTY' });

      expect(await admin.attendanceCtoInput.count({ where: { agencyId } })).toBe(1);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.attendanceCtoInput.deleteMany({ where: { agencyId } });
      });
      await cleanupAttendanceWorkflowAgency(admin, agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'refuses CTO outside expected duty or on a date without it, and blocks a recorded CTO a schedule change leaves outside expected duty',
  async () => {
    const fixture = await createAttendanceWorkflowFixture({ collectionAfterMinutes: 60 });
    const { admin, services, agencyId, employeeId, workDate } = fixture;
    const context = fixture.administratorContext;
    const cto = new AttendanceCtoInputsService(services.days);
    const record = (input: RecordCtoInput) =>
      withDatabaseContext({ agencyId, membershipId: context.membershipId }, (transaction) =>
        cto.recordInTransaction(transaction, context, input),
      );
    const base = { employeeId, sourceType: 'CtoRequest', sourceId: employeeId };
    const timedOn = (date: string, sourceKey: string, startsAt: string, endsAt: string) => ({
      ...base,
      sourceKey: `${fixture.suffix}-${sourceKey}`,
      workDate: date,
      coverageMode: 'TIMED' as const,
      startsAt: manilaInstant(date, startsAt).toISOString(),
      endsAt: manilaInstant(date, endsAt).toISOString(),
    });
    // The fixture's Work Date is a Wednesday, so three days earlier is a REST Sunday.
    const restDate = shiftDate(workDate, -3);

    try {
      // Inside the after-margin of the Event Collection Window, but after duty ends.
      await expect(
        record(timedOn(workDate, 'after-margin', '17:00', '18:00')),
      ).rejects.toMatchObject({ code: 'CTO_INPUT_OUTSIDE_EXPECTED_DUTY', statusCode: 400 });
      // The scheduled unpaid lunch break is not expected duty.
      await expect(record(timedOn(workDate, 'over-break', '11:00', '14:00'))).rejects.toMatchObject(
        { code: 'CTO_INPUT_OUTSIDE_EXPECTED_DUTY' },
      );
      await expect(record(timedOn(restDate, 'rest-timed', '09:00', '12:00'))).rejects.toMatchObject(
        { code: 'CTO_INPUT_NO_EXPECTED_DUTY', statusCode: 409 },
      );
      await expect(
        record({
          ...base,
          sourceKey: `${fixture.suffix}-rest-whole`,
          workDate: restDate,
          coverageMode: 'WHOLE_WORK_DATE',
        }),
      ).rejects.toMatchObject({ code: 'CTO_INPUT_NO_EXPECTED_DUTY' });
      expect(await admin.attendanceCtoInput.count({ where: { agencyId } })).toBe(0);

      // CTO is approved before it is taken, so a schedule change can still make
      // its future Work Date REST after the CTO input is recorded.
      let ctoDate = manilaDate(2);
      while (new Date(`${ctoDate}T00:00:00.000Z`).getUTCDay() !== 3)
        ctoDate = shiftDate(ctoDate, 1);
      const recorded = await record(timedOn(ctoDate, 'before-change', '16:00', '17:00'));
      const evidenceOf = (documentType: string) =>
        admin.documentVersion.findFirstOrThrow({
          where: { agencyId, document: { documentType } },
          select: { id: true },
        });
      const restSchedule = await services.schedules.create(context, {
        code: 'ALL-REST',
        name: 'All Rest Work Schedule',
        scheduleType: 'REGULAR',
        effectiveDate: manilaDate(-30),
        dayRules: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          ruleType: 'REST' as const,
          requiredMinutes: 0,
          eventPattern: 'IN_OUT' as const,
          collectionBeforeMinutes: 0,
          collectionAfterMinutes: 0,
          breaks: [],
        })),
      });
      const restActive = await services.schedules.activate(
        context,
        restSchedule.id,
        restSchedule.draft!.id,
        {
          authorityDocumentVersionId: (await evidenceOf('WORK_SCHEDULE_AUTHORITY')).id,
          approvingAuthority: 'Office of the President',
          reason: 'Rest schedule authority reviewed.',
        },
      );
      const assignment = await admin.scheduleAssignment.findFirstOrThrow({
        where: { agencyId, employeeId },
        select: { id: true, workArrangementVersionId: true },
      });
      await services.assignments.end(context, assignment.id, {
        effectiveTo: shiftDate(ctoDate, -1),
        reason: 'Schedule changed after the CTO was recorded.',
      });
      await services.assignments.create(context, {
        employeeId,
        workScheduleVersionId: restActive.currentVersion!.id,
        workArrangementVersionId: assignment.workArrangementVersionId,
        authorityDocumentVersionId: (await evidenceOf('SCHEDULE_ASSIGNMENT_AUTHORITY')).id,
        effectiveFrom: ctoDate,
      });
      const recalculated = await services.days.calculate(context, {
        periodCode: `CTO-REST-${fixture.suffix.slice(0, 12)}`,
        dateFrom: ctoDate,
        dateTo: ctoDate,
        employeeIds: [employeeId],
      });
      expect(recalculated.days[0]?.status).toBe('EXCEPTION');
      expect(recalculated.days[0]?.exceptionTypes).toContain('UNPLACED_CTO_INPUT');
      const [day] = await services.days.list(context, {
        employeeId,
        workDateFrom: ctoDate,
        workDateTo: ctoDate,
      });
      const detail = await services.days.findById(context, day!.id);
      expect(detail.day.totals).toMatchObject({ ctoMinutes: 0 });
      expect(detail.exceptions).toContainEqual(
        expect.objectContaining({
          exceptionType: 'UNPLACED_CTO_INPUT',
          details: expect.objectContaining({ ctoInputId: recorded.id }),
        }),
      );
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.attendanceCtoInput.deleteMany({ where: { agencyId } });
      });
      await cleanupAttendanceWorkflowAgency(admin, agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);
