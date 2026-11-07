import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it, vi } from 'vitest';
import {
  approvalAuditWriter,
  ApprovalCompletionRegistry,
  ApprovalsService,
} from '../approvals/approval.service';
import {
  createAttendanceWorkflowFixture,
  manilaDate,
  type AttendanceWorkflowFixture,
} from '../attendance-test-fixtures';
import { AttendanceCtoInputsService } from '../attendance-cto-inputs/attendance-cto-inputs.service';
import { CocAccountsService } from '../coc-accounts/coc-accounts.service';
import { overtimeAuthorityAuditWriter } from '../overtime-authorities/overtime-authorities.audit';
import {
  cleanup,
  context,
  createAgency,
  enabled,
  errorOf,
  giveRole,
} from '../overtime-authorities/overtime-authority-test-fixtures';
import { cleanupAttendanceOvertime } from '../overtime-service-records/overtime-service-test-fixtures';
import { ApproveCtoRequestService } from './approve-cto-request.service';
import { CreateCtoRequestService } from './create-cto-request.service';
import { registerCtoRequestApproval } from './cto-request-approval';
import { CtoRequestsController } from './cto-requests.controller';
import type { CtoRequestDateInput } from './cto-requests.types';
import { DiscardCtoRequestService } from './discard-cto-request.service';
import { RecommendCtoRequestService } from './recommend-cto-request.service';
import { RejectCtoRequestService } from './reject-cto-request.service';
import { ReturnCtoRequestService } from './return-cto-request.service';
import { SubmitCtoRequestService } from './submit-cto-request.service';
import { WithdrawCtoRequestService } from './withdraw-cto-request.service';

function grantsOf(
  scopePolicy: 'AGENCY' | 'DIRECT_REPORTS' | 'OWN',
  codes: readonly string[],
): RequestContext['permissions'] {
  return codes.map((code) => ({ code, scopePolicy }));
}

const EMPLOYEE_GRANTS = grantsOf('OWN', [
  'overtime.cto.create',
  'overtime.cto.submit',
  'overtime.cto.withdraw',
  'approvals.routes.read',
  'approvals.requests.create',
  'approvals.requests.cancel',
]);
const LEAVE_ADMIN_GRANTS = grantsOf('AGENCY', [
  'overtime.cto.create',
  'overtime.cto.submit',
  'approvals.routes.read',
  'approvals.requests.create',
  'approvals.requests.cancel',
]);
const SUPERVISOR_GRANTS = grantsOf('DIRECT_REPORTS', [
  'overtime.cto.recommend',
  'overtime.cto.return',
]);
const OFFICIAL_GRANTS = grantsOf('AGENCY', [
  'overtime.cto.return',
  'overtime.cto.approve',
  'overtime.cto.reject',
]);

function services(fixture: AttendanceWorkflowFixture) {
  const registry = new ApprovalCompletionRegistry();
  registerCtoRequestApproval(registry);
  const approvals = new ApprovalsService(approvalAuditWriter, registry);
  const audit = overtimeAuthorityAuditWriter;
  const coc = new CocAccountsService();
  const days = fixture.services.days;
  const create = new CreateCtoRequestService(audit, days, coc);
  const discard = new DiscardCtoRequestService(audit, approvals);
  const submit = new SubmitCtoRequestService(audit, approvals, days, coc);
  const withdraw = new WithdrawCtoRequestService(audit, approvals);
  const recommend = new RecommendCtoRequestService(audit, approvals);
  const returnRequest = new ReturnCtoRequestService(audit, approvals);
  const approve = new ApproveCtoRequestService(
    audit,
    approvals,
    days,
    coc,
    new AttendanceCtoInputsService(days),
  );
  const reject = new RejectCtoRequestService(audit, approvals);
  return {
    approvals,
    create,
    discard,
    submit,
    withdraw,
    recommend,
    returnRequest,
    approve,
    reject,
    controller: new CtoRequestsController(
      create,
      discard,
      submit,
      withdraw,
      recommend,
      returnRequest,
      approve,
      reject,
    ),
  };
}

/**
 * A Monday at least a week out and the weekdays after it, in a stretch clear of the
 * fixture calendar's December 25, so every weekday has expected duty.
 */
function workWeek(): (offset: number) => string {
  for (let start = 7; ; start += 1) {
    const monday = manilaDate(start);
    if (new Date(`${monday}T00:00:00.000Z`).getUTCDay() !== 1) continue;
    const day = (offset: number) => manilaDate(start + offset);
    const year = monday.slice(0, 4);
    if (
      [0, 7, 14].some((offset) => day(offset) >= `${year}-12-20` && day(offset) <= `${year}-12-31`)
    ) {
      continue;
    }
    return day;
  }
}

const whole = (workDate: string): CtoRequestDateInput => ({ workDate, unit: 'WHOLE' });
const half = (workDate: string, from: string, to: string): CtoRequestDateInput => ({
  workDate,
  unit: 'HALF',
  startsAt: `${workDate}T${from}:00+08:00`,
  endsAt: `${workDate}T${to}:00+08:00`,
});

async function setup() {
  const fixture = await createAttendanceWorkflowFixture({ events: false });
  const { admin, agencyId, suffix } = fixture;
  const asReplica = <T>(write: (transaction: Prisma.TransactionClient) => Promise<T>) =>
    admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      return write(transaction);
    });
  const adminMembership = fixture.memberships.administrator;
  const serve = (employeeId: string, positionId?: string) =>
    withDatabaseContext(
      { agencyId, membershipId: adminMembership, capabilities: ['personnel-baseline-transition'] },
      async (transaction) => {
        const segment = await transaction.serviceSegment.create({
          data: {
            agencyId,
            employeeId,
            organizationUnitId: fixture.unitId,
            positionId: positionId ?? null,
            appointmentStatus: 'PERMANENT',
            salaryGrade: 18,
            salaryStep: 1,
            effectiveFrom: new Date('2020-01-01'),
            status: 'ACTIVE',
            createdByMembershipId: adminMembership,
          },
        });
        if (positionId) {
          await transaction.positionIncumbency.create({
            data: {
              agencyId,
              positionId,
              employeeId,
              serviceSegmentId: segment.id,
              effectiveFrom: new Date('2020-01-01'),
              status: 'ACTIVE',
              createdByMembershipId: adminMembership,
            },
          });
        }
      },
    );
  let sequence = 0;
  /** An Employee serving in the fixture unit, with a linked Membership and baseline role. */
  const person = async (
    label: string,
    roleCode: string,
    permissions: RequestContext['permissions'],
    positionId?: string,
  ) => {
    sequence += 1;
    const employee = await admin.employee.create({
      data: {
        agencyId,
        employeeNumber: `CTO-${sequence}-${suffix}`,
        legalName: `CTO ${label}`,
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `cto-${sequence}-${suffix}@example.test`,
        serviceStatus: 'ACTIVE',
        createdByMembershipId: adminMembership,
        updatedByMembershipId: adminMembership,
      },
    });
    await serve(employee.id, positionId);
    const user = await admin.user.create({
      data: {
        emailNormalized: `cto-${label.toLowerCase()}-${suffix}@example.test`,
        displayName: `CTO ${label}`,
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId, userId: user.id, status: 'ACTIVE' },
    });
    await giveRole(admin, agencyId, membership.id, roleCode);
    await withDatabaseContext(
      { agencyId, membershipId: membership.id, capabilities: ['employee-membership-link'] },
      (transaction) =>
        transaction.agencyMembership.update({
          where: { agencyId_id: { agencyId, id: membership.id } },
          data: { employeeId: employee.id },
        }),
    );
    return {
      employeeId: employee.id,
      context: context(agencyId, user.id, membership.id, permissions),
    };
  };

  const headPosition = await asReplica((transaction) =>
    transaction.plantillaPosition.create({
      data: {
        agencyId,
        itemNumber: `CTO-HEAD-${suffix}`,
        status: 'OCCUPIED',
        createdByMembershipId: adminMembership,
        updatedByMembershipId: adminMembership,
      },
    }),
  );
  await asReplica((transaction) =>
    transaction.organizationUnitVersion.updateMany({
      where: { agencyId, organizationUnitId: fixture.unitId },
      data: { headPositionId: headPosition.id },
    }),
  );
  const supervisor = await person('Supervisor', 'supervisor', SUPERVISOR_GRANTS, headPosition.id);
  const official = await person('Official', 'appointing_authority', OFFICIAL_GRANTS);
  const peer = await person('Peer', 'employee', EMPLOYEE_GRANTS);
  const ordinary = await admin.scheduleAssignment.findFirstOrThrow({
    where: { agencyId, employeeId: fixture.employeeId },
  });
  for (const { employeeId } of [supervisor, peer]) {
    await fixture.services.assignments.create(fixture.administratorContext, {
      employeeId,
      workScheduleVersionId: ordinary.workScheduleVersionId,
      workArrangementVersionId: ordinary.workArrangementVersionId,
      authorityDocumentVersionId: ordinary.authorityDocumentVersionId,
      effectiveFrom: manilaDate(-30),
    });
  }
  const route = await new ApprovalsService(
    approvalAuditWriter,
    new ApprovalCompletionRegistry(),
  ).createRoute(fixture.administratorContext, {
    routeCode: 'CTO_REQUEST',
    domain: 'OVERTIME',
    versionNo: 1,
    effectiveFrom: '2020-01-01',
    stepDefinition: {
      steps: [
        {
          stepNo: 1,
          stepMode: 'SEQUENTIAL' as const,
          requiredPermission: 'overtime.cto.recommend',
          returnPermission: 'overtime.cto.return',
          assignment: { kind: 'SUBJECT_SUPERVISOR' as const, roleCode: 'supervisor' },
          requiresSeparateReview: true,
        },
        {
          stepNo: 2,
          stepMode: 'SEQUENTIAL' as const,
          requiredPermission: 'overtime.cto.return',
          approvePermission: 'overtime.cto.approve',
          rejectPermission: 'overtime.cto.reject',
          returnPermission: 'overtime.cto.return',
          assignment: { kind: 'ROLE' as const, roleCode: 'appointing_authority' },
          requiresSeparateReview: true,
        },
      ],
    },
  });
  await new ApprovalsService(approvalAuditWriter, new ApprovalCompletionRegistry()).activateRoute(
    fixture.administratorContext,
    route.id,
    'Activate the CTO Request route.',
  );

  const employeeId = fixture.employeeId;
  const employee: RequestContext = {
    ...fixture.employeeContext,
    permissions: EMPLOYEE_GRANTS,
  };
  const leaveAdmin: RequestContext = {
    ...fixture.officerContext,
    permissions: LEAVE_ADMIN_GRANTS,
  };

  const accountOf = async (ownerId: string) =>
    (await admin.cocAccount.findFirst({
      where: { agencyId, employeeId: ownerId, status: 'ACTIVE' },
      select: { id: true },
    })) ??
    admin.cocAccount.create({
      data: { agencyId, employeeId: ownerId, status: 'ACTIVE', openedAt: new Date('2020-01-01') },
      select: { id: true },
    });
  /** Award COC directly, for ledger states the API cannot reach with today's clock. */
  const credit = async (ownerId: string, minutes: number, validYear?: number) => {
    const account = await accountOf(ownerId);
    const year = validYear ?? Number(manilaDate(0).slice(0, 4)) + 1;
    await admin.cocLedgerEntry.create({
      data: {
        agencyId,
        cocAccountId: account.id,
        minutes,
        effectiveDate: new Date(`${year - 1}-02-01`),
        validUntil: new Date(`${year}-12-31`),
        earnedMonth: new Date(`${year - 1}-01-01`),
        sourceType: 'COC_EARNED_CERTIFICATE',
        sourceId: randomUUID(),
        sourcePostingKey: randomUUID(),
        ruleCode: 'TEST',
      },
    });
    return account.id;
  };
  /** A CTO usage entry dated in the future, as approval (#543) will post one. */
  const futureUse = async (ownerId: string, minutes: number, workDate: string) => {
    const account = await accountOf(ownerId);
    const year = Number(manilaDate(0).slice(0, 4)) + 1;
    await admin.cocLedgerEntry.create({
      data: {
        agencyId,
        cocAccountId: account.id,
        minutes: -minutes,
        effectiveDate: new Date(workDate),
        validUntil: new Date(`${year}-12-31`),
        sourceType: 'CTO_REQUEST',
        sourceId: randomUUID(),
        sourcePostingKey: randomUUID(),
        ruleCode: 'TEST',
      },
    });
  };

  /** An Employee on their own schedule and arrangement, to reach other Day Rules. */
  const onSchedule = async (
    label: string,
    scheduleType: 'REGULAR' | 'COMPRESSED' | 'FLEXIBLE',
    dayRules: Parameters<typeof fixture.services.schedules.create>[1]['dayRules'],
  ) => {
    const { services: attendance } = fixture;
    const actor = fixture.administratorContext;
    const effectiveFrom = manilaDate(-30);
    const evidenceOf = (documentType: string) =>
      admin.documentVersion.findFirstOrThrow({
        where: { agencyId, document: { documentType } },
        select: { id: true },
      });
    const scheduleEvidence = await evidenceOf('WORK_SCHEDULE_AUTHORITY');
    const arrangementEvidence = await evidenceOf('WORK_ARRANGEMENT_AUTHORITY');
    const assignmentEvidence = await evidenceOf('SCHEDULE_ASSIGNMENT_AUTHORITY');
    const schedule = await attendance.schedules.create(actor, {
      code: label,
      name: `${label} Work Schedule`,
      scheduleType,
      effectiveDate: effectiveFrom,
      dayRules,
    });
    const activeSchedule = await attendance.schedules.activate(
      actor,
      schedule.id,
      schedule.draft!.id,
      {
        authorityDocumentVersionId: scheduleEvidence.id,
        approvingAuthority: 'Office of the President',
        reason: 'Schedule authority reviewed.',
      },
    );
    const calendar = await admin.holidayCalendar.findFirstOrThrow({
      where: { agencyId },
      select: { id: true },
    });
    const arrangement = await attendance.arrangements.create(actor, {
      code: label,
      name: `${label} Work Arrangement`,
      arrangementType: 'ONSITE',
      permittedScheduleTypes: [scheduleType],
      holidayCalendarId: calendar.id,
      effectiveDate: effectiveFrom,
    });
    const activeArrangement = await attendance.arrangements.activate(
      actor,
      arrangement.id,
      arrangement.draft!.id,
      {
        authorityDocumentVersionId: arrangementEvidence.id,
        approvingAuthority: 'Office of the President',
        reason: 'Arrangement authority reviewed.',
      },
    );
    const member = await person(label, 'employee', EMPLOYEE_GRANTS);
    await attendance.assignments.create(actor, {
      employeeId: member.employeeId,
      workScheduleVersionId: activeSchedule.currentVersion!.id,
      workArrangementVersionId: activeArrangement.currentVersion!.id,
      authorityDocumentVersionId: assignmentEvidence.id,
      effectiveFrom,
    });
    return member;
  };

  const teardown = async () => {
    await asReplica(async (transaction) => {
      const where = { agencyId };
      await transaction.attendanceCtoInput.deleteMany({ where });
      await transaction.ctoRequestDate.deleteMany({ where });
      await transaction.ctoRequest.deleteMany({ where });
      await transaction.cocLedgerEntry.deleteMany({ where });
      await transaction.cocAccount.deleteMany({ where });
      await transaction.auditEvent.deleteMany({ where });
      await transaction.positionIncumbency.deleteMany({ where });
      await transaction.organizationUnitVersion.updateMany({
        where,
        data: { headPositionId: null },
      });
      await transaction.serviceSegment.updateMany({ where, data: { positionId: null } });
      await transaction.plantillaPosition.deleteMany({ where });
      await transaction.agencyMembership.updateMany({ where, data: { employeeId: null } });
    });
    await cleanupAttendanceOvertime(fixture);
    await admin.$disconnect();
  };
  return {
    fixture,
    admin,
    agencyId,
    employee,
    employeeId,
    leaveAdmin,
    supervisor,
    official,
    peer,
    credit,
    futureUse,
    onSchedule,
    asReplica,
    day: workWeek(),
    teardown,
    ...services(fixture),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function withSetup(run: (fixture: Setup) => Promise<void>) {
  const fixture = await setup();
  try {
    await run(fixture);
  } finally {
    await fixture.teardown();
  }
}

function auditActions(fixture: Setup, requestId: string) {
  return fixture.admin.auditEvent
    .findMany({
      where: { entityType: 'CtoRequest', entityId: requestId },
      orderBy: { occurredAt: 'asc' },
      select: { action: true },
    })
    .then((events) => events.map((event) => event.action));
}

function approvalRequests(fixture: Setup, requestId: string) {
  return fixture.admin.approvalRequest.findMany({
    where: { agencyId: fixture.agencyId, subjectType: 'CTO_REQUEST', subjectId: requestId },
    orderBy: { requestedAt: 'asc' },
    select: { id: true, status: true, currentStepNo: true },
  });
}

it.skipIf(!enabled)('adds forced RLS and the baseline decision grants', () =>
  withSetup(async ({ admin }) => {
    const tables = await admin.$queryRaw<
      Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('cto_requests', 'cto_request_dates')`;
    expect(tables).toHaveLength(2);
    expect(tables.every((table) => table.relrowsecurity && table.relforcerowsecurity)).toBe(true);
    const granted = await admin.rolePermission.findMany({
      where: {
        permission: { code: { in: ['overtime.cto.approve', 'overtime.cto.reject'] } },
        role: { agencyId: null },
      },
      select: { scopePolicy: true, role: { select: { code: true } } },
    });
    expect(granted).toEqual([
      { scopePolicy: 'AGENCY', role: { code: 'appointing_authority' } },
      { scopePolicy: 'AGENCY', role: { code: 'appointing_authority' } },
    ]);
  }),
);

it.skipIf(!enabled)(
  "charges each date from the Employee's schedule and keeps the draft's own shape",
  () =>
    withSetup(async (fixture) => {
      const { create, employee, employeeId, credit, day } = fixture;
      await credit(employeeId, 480);
      const draft = await create.execute(employee, {
        employeeId,
        dates: [half(day(1), '13:00', '17:00'), whole(day(0))],
      });
      expect(draft.status).toBe('DRAFT');
      expect(draft.totalChargedMinutes).toBe(720);
      expect(draft.dates).toMatchObject([
        { workDate: day(0), unit: 'WHOLE', chargedMinutes: 480, startsAt: null, endsAt: null },
        { workDate: day(1), unit: 'HALF', chargedMinutes: 240 },
      ]);
      expect(await auditActions(fixture, draft.id)).toEqual(['CTO_REQUEST_CREATED']);
    }),
);

it.skipIf(!enabled)('refuses a date without expected duty or an unusable half day', () =>
  withSetup(async ({ create, employee, employeeId, credit, day }) => {
    await credit(employeeId, 4800);
    const refused = (dates: CtoRequestDateInput[], code: string) =>
      expect(create.execute(employee, { employeeId, dates })).rejects.toMatchObject({ code });
    const saturday = day(5);
    await refused([whole(saturday)], 'CTO_NO_EXPECTED_DUTY');
    await refused([half(saturday, '08:00', '12:00')], 'CTO_NO_EXPECTED_DUTY');
    // Before duty, across the unpaid break, and after duty.
    await refused([half(day(0), '06:00', '10:00')], 'CTO_HALF_OUTSIDE_EXPECTED_DUTY');
    await refused([half(day(0), '10:00', '15:00')], 'CTO_HALF_OUTSIDE_EXPECTED_DUTY');
    await refused([half(day(0), '15:00', '19:00')], 'CTO_HALF_OUTSIDE_EXPECTED_DUTY');
    // Inside duty, but not half of it: Attendance would pay other than the charge.
    await refused([half(day(0), '08:00', '10:00')], 'CTO_HALF_INTERVAL_NOT_HALF');
    await refused(
      [
        {
          workDate: day(0),
          unit: 'HALF',
          startsAt: `${day(0)}T08:00:30+08:00`,
          endsAt: `${day(0)}T12:00:30+08:00`,
        },
      ],
      'CTO_HALF_INTERVAL_NOT_HALF',
    );
    // A half day stated on another date lies outside this date's duty.
    await refused(
      [
        {
          workDate: day(0),
          unit: 'HALF',
          startsAt: `${day(1)}T08:00:00+08:00`,
          endsAt: `${day(1)}T12:00:00+08:00`,
        },
      ],
      'CTO_HALF_OUTSIDE_EXPECTED_DUTY',
    );
  }),
);

const REST_DAY_RULE = {
  ruleType: 'REST' as const,
  requiredMinutes: 0,
  eventPattern: 'IN_OUT' as const,
  collectionBeforeMinutes: 0,
  collectionAfterMinutes: 0,
  breaks: [],
};

it.skipIf(!enabled)(
  'charges the blocks of a compressed day, skips its off day, and refuses an odd half',
  () =>
    withSetup(async ({ create, credit, day, onSchedule }) => {
      const compressed = await onSchedule(
        'COMPRESSED',
        'COMPRESSED',
        [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
          weekday <= 4
            ? {
                weekday,
                ruleType: 'FIXED' as const,
                dutyStartTime: '07:00',
                dutyEndTime: '18:00',
                requiredMinutes: 600,
                eventPattern: 'IN_OUT' as const,
                collectionBeforeMinutes: 0,
                collectionAfterMinutes: 0,
                breaks: [{ breakStartTime: '12:00', breakEndTime: '13:00' }],
              }
            : { weekday, ...REST_DAY_RULE },
        ),
      );
      await credit(compressed.employeeId, 6000);
      const draft = await create.execute(compressed.context, {
        employeeId: compressed.employeeId,
        // Thursday and the next Monday are consecutive: Friday to Sunday are off days.
        dates: [half(day(3), '07:00', '12:00'), whole(day(7))],
      });
      expect(draft.dates.map((date) => date.chargedMinutes)).toEqual([300, 600]);

      const odd = await onSchedule(
        'ODD',
        'REGULAR',
        [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
          weekday <= 5
            ? {
                weekday,
                ruleType: 'FIXED' as const,
                dutyStartTime: '08:00',
                dutyEndTime: '16:45',
                requiredMinutes: 465,
                eventPattern: 'IN_OUT' as const,
                collectionBeforeMinutes: 0,
                collectionAfterMinutes: 0,
                breaks: [{ breakStartTime: '12:00', breakEndTime: '13:00' }],
              }
            : { weekday, ...REST_DAY_RULE },
        ),
      );
      await credit(odd.employeeId, 6000);
      await expect(
        create.execute(odd.context, {
          employeeId: odd.employeeId,
          dates: [half(day(0), '08:00', '11:52')],
        }),
      ).rejects.toMatchObject({ code: 'CTO_HALF_NOT_WHOLE_MINUTES' });
    }),
);

it.skipIf(!enabled)('places a half day on a flexible schedule without Attendance Events', () =>
  withSetup(async ({ create, credit, day, onSchedule }) => {
    const flexible = await onSchedule(
      'FLEX',
      'FLEXIBLE',
      [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
        weekday <= 5
          ? {
              weekday,
              ruleType: 'FLEXIBLE' as const,
              earliestStartTime: '07:00',
              latestStartTime: '10:00',
              dutyEndTime: '19:00',
              requiredMinutes: 480,
              eventPattern: 'IN_OUT' as const,
              collectionBeforeMinutes: 0,
              collectionAfterMinutes: 0,
              breaks: [{ breakStartTime: '12:00', breakEndTime: '13:00' }],
            }
          : { weekday, ...REST_DAY_RULE },
      ),
    );
    await credit(flexible.employeeId, 4800);
    const draft = await create.execute(flexible.context, {
      employeeId: flexible.employeeId,
      dates: [whole(day(0)), half(day(1), '13:00', '17:00')],
    });
    expect(draft.dates.map((date) => date.chargedMinutes)).toEqual([480, 240]);
    await expect(
      create.execute(flexible.context, {
        employeeId: flexible.employeeId,
        dates: [half(day(2), '05:00', '09:00')],
      }),
    ).rejects.toMatchObject({ code: 'CTO_HALF_OUTSIDE_EXPECTED_DUTY' });
  }),
);

it.skipIf(!enabled)('holds at most five consecutive Work Dates', () =>
  withSetup(async ({ create, employee, employeeId, credit, day }) => {
    await credit(employeeId, 9600);
    const five = [0, 1, 2, 3, 4].map((offset) => whole(day(offset)));
    const draft = await create.execute(employee, { employeeId, dates: five });
    expect(draft.dates).toHaveLength(5);
    await expect(
      create.execute(employee, { employeeId, dates: [...five, whole(day(7))] }),
    ).rejects.toMatchObject({ code: 'CTO_TOO_MANY_WORK_DATES' });
    await expect(
      create.execute(employee, { employeeId, dates: [whole(day(0)), whole(day(2))] }),
    ).rejects.toMatchObject({ code: 'CTO_WORK_DATES_NOT_CONSECUTIVE' });
    await expect(
      create.execute(employee, { employeeId, dates: [whole(day(0)), whole(day(0))] }),
    ).rejects.toMatchObject({ code: 'CTO_WORK_DATE_REPEATED' });
    // Friday and the next Monday: the weekend has no expected duty.
    const acrossWeekend = await create.execute(employee, {
      employeeId,
      dates: [whole(day(4)), whole(day(7))],
    });
    expect(acrossWeekend.dates).toHaveLength(2);
  }),
);

it.skipIf(!enabled)('needs an active COC Account to draft and to submit', () =>
  withSetup(async ({ admin, create, submit, employee, employeeId, credit, day }) => {
    await expect(
      create.execute(employee, { employeeId, dates: [whole(day(0))] }),
    ).rejects.toMatchObject({ code: 'CTO_NO_ACTIVE_COC_ACCOUNT' });
    const accountId = await credit(employeeId, 480);
    const draft = await create.execute(employee, { employeeId, dates: [whole(day(0))] });
    await admin.cocAccount.update({
      where: { id: accountId },
      data: { status: 'CLOSED', closedAt: new Date(manilaDate(0)) },
    });
    await expect(submit.execute(employee, draft.id)).rejects.toMatchObject({
      code: 'CTO_NO_ACTIVE_COC_ACCOUNT',
    });
  }),
);

it.skipIf(!enabled)('refuses at submission a request above the COC available on its dates', () =>
  withSetup(async (fixture) => {
    const { create, submit, employee, employeeId, credit, futureUse, day, admin } = fixture;
    await credit(employeeId, 900);
    // A draft may exceed the balance; only submission refuses it.
    const above = await create.execute(employee, {
      employeeId,
      dates: [whole(day(0)), whole(day(1))],
    });
    await expect(submit.execute(employee, above.id)).rejects.toMatchObject({
      code: 'CTO_COC_INSUFFICIENT',
    });

    // Exactly enough once credited.
    await credit(employeeId, 60);
    const submitted = await submit.execute(employee, above.id);
    expect(submitted.status).toBe('SUBMITTED');
    const [approval] = await approvalRequests(fixture, above.id);
    expect(approval).toMatchObject({ status: 'IN_PROGRESS', currentStepNo: 1 });

    // Nothing is reserved between submission and approval, but a future-dated
    // use nets against what the next request can draw.
    const netted = await create.execute(employee, { employeeId, dates: [whole(day(7))] });
    await futureUse(employeeId, 600, day(21));
    await expect(submit.execute(employee, netted.id)).rejects.toMatchObject({
      code: 'CTO_COC_INSUFFICIENT',
    });
    await admin.cocLedgerEntry.create({
      data: {
        agencyId: fixture.agencyId,
        cocAccountId: above.cocAccountId,
        minutes: 600,
        effectiveDate: new Date('2020-01-01'),
        validUntil: new Date(`${Number(manilaDate(0).slice(0, 4)) + 1}-12-31`),
        earnedMonth: new Date(`${Number(manilaDate(0).slice(0, 4))}-01-01`),
        sourceType: 'COC_EARNED_CERTIFICATE',
        sourceId: randomUUID(),
        sourcePostingKey: randomUUID(),
        ruleCode: 'TEST',
      },
    });
    expect((await submit.execute(employee, netted.id)).status).toBe('SUBMITTED');
  }),
);

it.skipIf(!enabled)('does not count COC past its Valid Until on the date', () =>
  withSetup(async ({ create, submit, employee, employeeId, credit, day }) => {
    await credit(employeeId, 4800, Number(day(0).slice(0, 4)) - 1);
    const draft = await create.execute(employee, { employeeId, dates: [whole(day(0))] });
    await expect(submit.execute(employee, draft.id)).rejects.toMatchObject({
      code: 'CTO_COC_INSUFFICIENT',
    });
  }),
);

it.skipIf(!enabled)("refuses a date on another of the Employee's live requests", () =>
  withSetup(async (fixture) => {
    const { create, submit, withdraw, employee, employeeId, peer, credit, day } = fixture;
    await credit(employeeId, 4800);
    await credit(peer.employeeId, 4800);
    const dates = [whole(day(0))];
    const first = await create.execute(employee, { employeeId, dates });
    // Drafts are not live, so two may hold one date until one is submitted.
    const second = await create.execute(employee, { employeeId, dates });
    await submit.execute(employee, first.id);
    await expect(create.execute(employee, { employeeId, dates })).rejects.toMatchObject({
      code: 'CTO_WORK_DATE_TAKEN',
    });
    await expect(submit.execute(employee, second.id)).rejects.toMatchObject({
      code: 'CTO_WORK_DATE_TAKEN',
    });
    // Another Employee's request on the date doesn't count.
    const other = await create.execute(peer.context, {
      employeeId: peer.employeeId,
      dates,
    });
    expect(other.status).toBe('DRAFT');
    // Withdrawing frees the date.
    await withdraw.execute(employee, first.id);
    expect((await submit.execute(employee, second.id)).status).toBe('SUBMITTED');
  }),
);

it.skipIf(!enabled)('lets only one of two concurrent submissions claim a date', () =>
  withSetup(async (fixture) => {
    const { create, submit, employee, employeeId, credit, day, admin, agencyId } = fixture;
    await credit(employeeId, 4800);
    const dates = [whole(day(0)), whole(day(1))];
    const first = await create.execute(employee, { employeeId, dates });
    const second = await create.execute(employee, { employeeId, dates: [whole(day(1))] });
    const results = await Promise.allSettled([
      submit.execute(employee, first.id),
      submit.execute(employee, second.id),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'CTO_WORK_DATE_TAKEN',
    });
    const live = await admin.ctoRequest.count({
      where: { agencyId, employeeId, status: 'SUBMITTED' },
    });
    expect(live).toBe(1);
  }),
);

it.skipIf(!enabled)(
  'recommends, returns with a comment from either status, and restarts the route on resubmission',
  () =>
    withSetup(async (fixture) => {
      const { create, submit, recommend, returnRequest, employee, employeeId, credit, day } =
        fixture;
      const { supervisor, official, approvals } = fixture;
      await credit(employeeId, 4800);
      const draft = await create.execute(employee, { employeeId, dates: [whole(day(0))] });
      await submit.execute(employee, draft.id);

      // The Approving Official isn't the first step's authority.
      await expect(
        returnRequest.execute(official.context, draft.id, { comment: 'Not yet mine.' }),
      ).rejects.toMatchObject({ code: 'APPROVAL_AUTHORITY_REQUIRED' });
      await expect(
        returnRequest.execute(supervisor.context, draft.id, { comment: '  ' }),
      ).rejects.toMatchObject({ code: 'APPROVAL_DECISION_REASON_REQUIRED' });

      const returnedOnce = await returnRequest.execute(supervisor.context, draft.id, {
        comment: 'Please move this to next week.',
      });
      expect(returnedOnce.status).toBe('DRAFT');

      await submit.execute(employee, draft.id);
      const recommended = await recommend.execute(supervisor.context, draft.id, {
        comment: 'Service needs are covered.',
      });
      expect(recommended.status).toBe('FOR_APPROVAL');
      await expect(recommend.execute(supervisor.context, draft.id, {})).rejects.toMatchObject({
        code: 'CTO_REQUEST_STATUS_INVALID',
      });

      // The Supervisor's step is done, so the return is the Approving Official's.
      await expect(
        returnRequest.execute(supervisor.context, draft.id, { comment: 'Too late for me.' }),
      ).rejects.toMatchObject({ code: 'APPROVAL_AUTHORITY_REQUIRED' });
      const returnedTwice = await returnRequest.execute(official.context, draft.id, {
        comment: 'Attach the coverage plan.',
      });
      expect(returnedTwice.status).toBe('DRAFT');

      // Resubmitted, it starts over at the Supervisor rather than the step that returned it.
      await submit.execute(employee, draft.id);
      const requests = await approvalRequests(fixture, draft.id);
      expect(requests.map((request) => request.status)).toEqual([
        'CANCELLED',
        'CANCELLED',
        'IN_PROGRESS',
      ]);
      expect(requests[2]!.currentStepNo).toBe(1);
      expect((await recommend.execute(supervisor.context, draft.id, {})).status).toBe(
        'FOR_APPROVAL',
      );

      expect(await auditActions(fixture, draft.id)).toEqual([
        'CTO_REQUEST_CREATED',
        'CTO_REQUEST_SUBMITTED',
        'CTO_REQUEST_RETURNED',
        'CTO_REQUEST_SUBMITTED',
        'CTO_REQUEST_RECOMMENDED',
        'CTO_REQUEST_RETURNED',
        'CTO_REQUEST_SUBMITTED',
        'CTO_REQUEST_RECOMMENDED',
      ]);

      // The generic Approval API moves none of it.
      const open = requests[2]!.id;
      const drafter = {
        ...employee,
        permissions: grantsOf('AGENCY', ['approvals.requests.cancel']),
      };
      await expect(approvals.cancel(drafter, open, 'Skip the module.')).rejects.toMatchObject({
        code: 'CTO_REQUEST_APPROVAL_CANCEL_FORBIDDEN',
      });
      const generic = {
        ...official.context,
        permissions: grantsOf('AGENCY', [
          'approvals.requests.approve',
          'approvals.requests.reject',
        ]),
      };
      await expect(approvals.approve(generic, open)).rejects.toMatchObject({
        code: 'APPROVAL_DOMAIN_RECORD_FORBIDDEN',
      });
      await expect(approvals.returnRequest(generic, open, 'Skip it.')).rejects.toMatchObject({
        code: 'APPROVAL_DOMAIN_RECORD_FORBIDDEN',
      });
    }),
);

it.skipIf(!enabled)('withdraws before approval and discards only a draft', () =>
  withSetup(async (fixture) => {
    const { create, submit, recommend, withdraw, discard, returnRequest } = fixture;
    const { employee, employeeId, supervisor, leaveAdmin, credit, day } = fixture;
    await credit(employeeId, 9600);

    const draft = await create.execute(employee, { employeeId, dates: [whole(day(0))] });
    await expect(withdraw.execute(employee, draft.id)).rejects.toMatchObject({
      code: 'CTO_REQUEST_STATUS_INVALID',
    });
    expect((await discard.execute(employee, draft.id)).status).toBe('CANCELLED');
    await expect(discard.execute(employee, draft.id)).rejects.toMatchObject({
      code: 'CTO_REQUEST_STATUS_INVALID',
    });
    expect(await approvalRequests(fixture, draft.id)).toEqual([]);

    const submitted = await create.execute(employee, { employeeId, dates: [whole(day(1))] });
    await submit.execute(employee, submitted.id);
    await expect(discard.execute(employee, submitted.id)).rejects.toMatchObject({
      code: 'CTO_REQUEST_STATUS_INVALID',
    });
    expect((await withdraw.execute(employee, submitted.id)).status).toBe('CANCELLED');
    expect((await approvalRequests(fixture, submitted.id))[0]!.status).toBe('CANCELLED');

    const forApproval = await create.execute(employee, { employeeId, dates: [whole(day(2))] });
    await submit.execute(employee, forApproval.id);
    await recommend.execute(supervisor.context, forApproval.id, {});
    expect((await withdraw.execute(employee, forApproval.id)).status).toBe('CANCELLED');

    // A Leave Administrator drafts and submits for the Employee and discards a
    // returned draft, closing the request it was returned on. Only the Employee withdraws.
    const onBehalf = await create.execute(leaveAdmin, { employeeId, dates: [whole(day(3))] });
    await submit.execute(leaveAdmin, onBehalf.id);
    await expect(withdraw.execute(leaveAdmin, onBehalf.id)).rejects.toMatchObject({
      code: 'CTO_REQUEST_FORBIDDEN',
    });
    await returnRequest.execute(supervisor.context, onBehalf.id, { comment: 'Reschedule this.' });
    expect((await discard.execute(leaveAdmin, onBehalf.id)).status).toBe('CANCELLED');
    expect((await approvalRequests(fixture, onBehalf.id))[0]!.status).toBe('CANCELLED');
  }),
);

it.skipIf(!enabled)('lets nobody recommend or return their own request', () =>
  withSetup(
    async ({ create, submit, recommend, returnRequest, credit, day, supervisor, leaveAdmin }) => {
      await credit(supervisor.employeeId, 4800);
      const own = await create.execute(leaveAdmin, {
        employeeId: supervisor.employeeId,
        dates: [whole(day(0))],
      });
      await expect(submit.execute(leaveAdmin, own.id)).rejects.toMatchObject({
        code: 'APPROVAL_ASSIGNMENT_UNRESOLVED',
      });

      // Whatever the grant: an Agency-wide recommender is refused on their own request.
      const agencyWide = {
        ...supervisor.context,
        permissions: grantsOf('AGENCY', ['overtime.cto.recommend', 'overtime.cto.return']),
      };
      await expect(recommend.execute(agencyWide, own.id, {})).rejects.toMatchObject({
        code: 'CTO_REQUEST_SELF_DECISION',
      });
      await expect(
        returnRequest.execute(agencyWide, own.id, { comment: 'Mine.' }),
      ).rejects.toMatchObject({ code: 'CTO_REQUEST_SELF_DECISION' });
      // A DIRECT_REPORTS grant never reaches its holder.
      await expect(recommend.execute(supervisor.context, own.id, {})).rejects.toMatchObject({
        code: 'CTO_REQUEST_SCOPE_FORBIDDEN',
      });
    },
  ),
);

it.skipIf(!enabled)("refuses an Employee acting on someone else's request", () =>
  withSetup(async (fixture) => {
    const { create, submit, withdraw, discard, recommend, returnRequest } = fixture;
    const { employee, employeeId, peer, credit, day } = fixture;
    await credit(employeeId, 4800);
    const scoped = { code: 'CTO_REQUEST_SCOPE_FORBIDDEN' };
    await expect(
      create.execute(peer.context, { employeeId, dates: [whole(day(0))] }),
    ).rejects.toMatchObject(scoped);
    const draft = await create.execute(employee, { employeeId, dates: [whole(day(0))] });
    await expect(submit.execute(peer.context, draft.id)).rejects.toMatchObject(scoped);
    await expect(discard.execute(peer.context, draft.id)).rejects.toMatchObject(scoped);
    await submit.execute(employee, draft.id);
    await expect(withdraw.execute(peer.context, draft.id)).rejects.toMatchObject(scoped);

    const forbidden = { code: 'CTO_REQUEST_FORBIDDEN' };
    await expect(recommend.execute(peer.context, draft.id, {})).rejects.toMatchObject(forbidden);
    await expect(
      returnRequest.execute(peer.context, draft.id, { comment: 'Not mine.' }),
    ).rejects.toMatchObject(forbidden);
    // Holding the Supervisor's grants isn't enough without the reporting line.
    const notTheirSupervisor = { ...peer.context, permissions: SUPERVISOR_GRANTS };
    await expect(recommend.execute(notTheirSupervisor, draft.id, {})).rejects.toMatchObject(scoped);
    await expect(
      returnRequest.execute(notTheirSupervisor, draft.id, { comment: 'Not mine.' }),
    ).rejects.toMatchObject(scoped);
  }),
);

it.skipIf(!enabled)('keeps every command and row inside its Agency', () =>
  withSetup(async (fixture) => {
    const { create, submit, withdraw, discard, recommend, returnRequest, controller } = fixture;
    const { employee, employeeId, credit, day, admin, agencyId } = fixture;
    await credit(employeeId, 4800);
    const draft = await create.execute(employee, { employeeId, dates: [whole(day(0))] });

    const suffix = `${fixture.fixture.suffix}-foreign`;
    const foreign = await createAgency(admin, suffix, 'CTOF');
    try {
      const outsider = context(foreign.agency.id, foreign.user.id, foreign.membership.id, [
        ...LEAVE_ADMIN_GRANTS,
        ...grantsOf('AGENCY', [
          'overtime.cto.withdraw',
          'overtime.cto.recommend',
          'overtime.cto.return',
        ]),
      ]);
      const notFound = { code: 'CTO_REQUEST_NOT_FOUND', statusCode: 404 };
      await expect(submit.execute(outsider, draft.id)).rejects.toMatchObject(notFound);
      await expect(discard.execute(outsider, draft.id)).rejects.toMatchObject(notFound);
      await expect(withdraw.execute(outsider, draft.id)).rejects.toMatchObject(notFound);
      await expect(recommend.execute(outsider, draft.id, {})).rejects.toMatchObject(notFound);
      await expect(
        returnRequest.execute(outsider, draft.id, { comment: 'Across Agencies.' }),
      ).rejects.toMatchObject(notFound);
      await expect(
        create.execute(outsider, { employeeId, dates: [whole(day(0))] }),
      ).rejects.toMatchObject({ code: 'CTO_REQUEST_EMPLOYEE_NOT_FOUND', statusCode: 404 });

      // Row-level security hides the rows from the runtime role, whatever the query asks.
      const visible = await withDatabaseContext(
        { agencyId: foreign.agency.id, membershipId: foreign.membership.id },
        async (transaction) => ({
          requests: await transaction.ctoRequest.count(),
          dates: await transaction.ctoRequestDate.count(),
        }),
      );
      expect(visible).toEqual({ requests: 0, dates: 0 });

      // The controller refuses another Agency's path before any command runs.
      const crossPath = await errorOf(controller.submit(agencyId, draft.id, outsider));
      expect(crossPath.status).toBe(403);
    } finally {
      await cleanup(admin, [foreign.agency.id], suffix);
    }
    expect((await admin.ctoRequest.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
      'DRAFT',
    );
  }),
);

it.skipIf(!enabled)('guards the tables against a move the state table does not allow', () =>
  withSetup(async ({ admin, create, submit, employee, employeeId, credit, day }) => {
    await credit(employeeId, 4800);
    const draft = await create.execute(employee, { employeeId, dates: [whole(day(0))] });
    await expect(
      admin.ctoRequest.update({ where: { id: draft.id }, data: { status: 'FOR_APPROVAL' } }),
    ).rejects.toThrow(/cannot move from DRAFT to FOR_APPROVAL/);
    await expect(admin.ctoRequest.delete({ where: { id: draft.id } })).rejects.toThrow(
      /cannot be deleted/,
    );
    await submit.execute(employee, draft.id);
    const dateId = draft.dates[0]!.id;
    await expect(
      admin.ctoRequestDate.update({ where: { id: dateId }, data: { chargedMinutes: 1 } }),
    ).rejects.toThrow(/changes its charge/);
    await expect(
      admin.ctoRequestDate.update({ where: { id: dateId }, data: { workDate: new Date(day(1)) } }),
    ).rejects.toThrow(/cannot be rewritten/);
    await expect(
      admin.ctoRequestDate.create({
        data: {
          agencyId: draft.agencyId,
          ctoRequestId: draft.id,
          workDate: new Date(day(1)),
          unit: 'WHOLE',
          chargedMinutes: 480,
        },
      }),
    ).rejects.toThrow(/only to a DRAFT/);
  }),
);

it.skipIf(!enabled)('validates input at the controller', () =>
  withSetup(async ({ controller, employee, employeeId, agencyId, day, supervisor }) => {
    const body = (dates: unknown) => ({ employeeId, dates });
    const invalid = async (promise: Promise<unknown>) =>
      expect((await errorOf(promise)).status).toBe(400);
    await invalid(controller.create(agencyId, body([]), employee));
    await invalid(
      controller.create(agencyId, body([{ workDate: day(0), unit: 'QUARTER' }]), employee),
    );
    await invalid(
      controller.create(agencyId, body([{ workDate: day(0), unit: 'HALF' }]), employee),
    );
    await invalid(
      controller.create(
        agencyId,
        body([{ ...whole(day(0)), startsAt: `${day(0)}T08:00:00+08:00` }]),
        employee,
      ),
    );
    await invalid(
      controller.create(
        agencyId,
        body([
          {
            workDate: day(0),
            unit: 'HALF',
            startsAt: `${day(0)}T12:00:00+08:00`,
            endsAt: `${day(0)}T08:00:00+08:00`,
          },
        ]),
        employee,
      ),
    );
    await invalid(
      controller.create(agencyId, body([0, 1, 2, 3, 4, 7].map((n) => whole(day(n)))), employee),
    );
    await invalid(
      controller.return(agencyId, randomUUID(), { comment: '   ' }, supervisor.context),
    );
    expect((await errorOf(controller.submit(agencyId, 'not-a-uuid', employee))).status).toBe(404);
  }),
);

/** A request of the fixture Employee, submitted and recommended. */
async function forApproval(fixture: Setup, dates: CtoRequestDateInput[]) {
  const { create, submit, recommend, employee, employeeId, supervisor } = fixture;
  const draft = await create.execute(employee, { employeeId, dates });
  await submit.execute(employee, draft.id);
  await recommend.execute(supervisor.context, draft.id, {});
  return draft.id;
}

function ledgerEntries(fixture: Setup, requestId: string) {
  return fixture.admin.cocLedgerEntry.findMany({
    where: { agencyId: fixture.agencyId, sourceType: 'CTO_REQUEST', sourceId: requestId },
    orderBy: { sourcePostingKey: 'asc' },
  });
}

/** Everything approval writes is absent, and the route still awaits its second step. */
async function expectNothingPosted(fixture: Setup, requestId: string) {
  const { admin, agencyId } = fixture;
  const request = await admin.ctoRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { dates: true },
  });
  expect(request.status).toBe('FOR_APPROVAL');
  expect(request.approvedAt).toBeNull();
  expect(request.dates.every((date) => date.attendanceCtoInputId === null)).toBe(true);
  expect(await ledgerEntries(fixture, requestId)).toEqual([]);
  expect(await admin.attendanceCtoInput.count({ where: { agencyId, sourceId: requestId } })).toBe(
    0,
  );
  expect(await approvalRequests(fixture, requestId)).toMatchObject([
    { status: 'IN_PROGRESS', currentStepNo: 2 },
  ]);
  expect(await auditActions(fixture, requestId)).not.toContain('CTO_REQUEST_APPROVED');
}

/** A FINALIZED Attendance Period over these dates, standing in for a locked one. */
async function lockedPeriod(fixture: Setup, from: string, to: string) {
  const { admin, agencyId, asReplica } = fixture;
  const period = await admin.attendancePeriod.create({
    data: {
      agencyId,
      code: `CTO-LOCK-${randomUUID()}`,
      dateFrom: new Date(from),
      dateTo: new Date(to),
    },
  });
  const setStatus = (status: string) =>
    asReplica((transaction) =>
      transaction.attendancePeriod.update({ where: { id: period.id }, data: { status } }),
    );
  await setStatus('FINALIZED');
  return { unlock: () => setStatus('OPEN') };
}

it.skipIf(!enabled)(
  'approves by posting usage across two Valid Until dates and an Attendance input per Work Date',
  () =>
    withSetup(async (fixture) => {
      const { approve, official, employeeId, credit, day, admin, agencyId } = fixture;
      const year = Number(day(0).slice(0, 4));
      const accountId = await credit(employeeId, 300, year);
      await credit(employeeId, 4800, year + 1);
      const requestId = await forApproval(fixture, [whole(day(0)), half(day(1), '08:00', '12:00')]);

      const approved = await approve.execute(official.context, requestId, {
        comment: 'Service needs are met.',
      });

      expect(approved.status).toBe('APPROVED');
      expect(approved.approvedByMembershipId).toBe(official.context.membershipId);
      expect(approved.approvedAt).not.toBeNull();

      const entries = await ledgerEntries(fixture, requestId);
      expect(
        entries.map((entry) => ({
          minutes: entry.minutes.toFixed(1),
          effectiveDate: entry.effectiveDate.toISOString().slice(0, 10),
          validUntil: entry.validUntil.toISOString().slice(0, 10),
          sourcePostingKey: entry.sourcePostingKey,
          ruleCode: entry.ruleCode,
          postedByMembershipId: entry.postedByMembershipId,
          cocAccountId: entry.cocAccountId,
        })),
      ).toEqual(
        [
          { workDate: day(0), year, minutes: '-300.0' },
          { workDate: day(0), year: year + 1, minutes: '-180.0' },
          { workDate: day(1), year: year + 1, minutes: '-240.0' },
        ].map(({ workDate, year: validYear, minutes }) => ({
          minutes,
          effectiveDate: workDate,
          validUntil: `${validYear}-12-31`,
          sourcePostingKey: `${workDate}:${validYear}-12-31`,
          ruleCode: 'JC2_2004_CTO_AVAILMENT',
          postedByMembershipId: official.context.membershipId,
          cocAccountId: accountId,
        })),
      );

      const inputs = await admin.attendanceCtoInput.findMany({
        where: { agencyId, sourceType: 'CtoRequest', sourceId: requestId },
        orderBy: { workDate: 'asc' },
      });
      expect(inputs.map((input) => input.coverageMode)).toEqual(['WHOLE_WORK_DATE', 'TIMED']);
      expect(inputs[1]!.startsAt!.toISOString()).toBe(approved.dates[1]!.startsAt);
      expect(approved.dates.map((date) => date.attendanceCtoInputId)).toEqual(
        inputs.map((input) => input.id),
      );

      expect(await approvalRequests(fixture, requestId)).toMatchObject([
        { status: 'APPROVED', currentStepNo: null },
      ]);
      const event = await admin.auditEvent.findFirstOrThrow({
        where: { action: 'CTO_REQUEST_APPROVED', entityId: requestId },
      });
      expect(event).toMatchObject({
        actorMembershipId: official.context.membershipId,
        previousStatus: 'FOR_APPROVAL',
        newStatus: 'APPROVED',
        reason: 'Service needs are met.',
      });
      expect(event.metadata).toMatchObject({
        entries: entries.map((entry) => ({ id: entry.id })),
        inputs: inputs.map((input) => ({ attendanceCtoInputId: input.id })),
      });

      // Approved is final here: only #324's cancellation moves it on.
      await expect(approve.execute(official.context, requestId, {})).rejects.toMatchObject({
        code: 'CTO_REQUEST_STATUS_INVALID',
      });
      await expect(
        fixture.reject.execute(official.context, requestId, { reason: 'Too late.' }),
      ).rejects.toMatchObject({ code: 'CTO_REQUEST_STATUS_INVALID' });
    }),
);

/** Run with the clock at this instant, to stand on a Work Date's Asia/Manila date. */
async function at<T>(instant: string, run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(new Date(instant));
  try {
    return await run();
  } finally {
    vi.useRealTimers();
  }
}

it.skipIf(!enabled)('approves a Work Date of today and refuses one before today', () =>
  withSetup(async (fixture) => {
    const { approve, reject, controller, official, employeeId, credit, day, agencyId } = fixture;
    await credit(employeeId, 4800);
    const requestId = await forApproval(fixture, [whole(day(0))]);
    // Half past midnight in Manila is still the Work Date by UTC, so a UTC date would allow it.
    const justPassed = `${day(1)}T00:30:00+08:00`;

    await at(justPassed, async () => {
      await expect(
        approve.execute(official.context, requestId, {}, 'approve-today'),
      ).rejects.toMatchObject({ code: 'CTO_WORK_DATE_PASSED', statusCode: 409 });
      const refused = await errorOf(
        controller.approve(agencyId, requestId, {}, undefined, official.context),
      );
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ error: { code: 'CTO_WORK_DATE_PASSED' } });
    });
    await expectNothingPosted(fixture, requestId);

    // A refusal does not spend the key, and the last minutes of the Work Date are still today.
    const approved = await at(`${day(0)}T23:30:00+08:00`, () =>
      approve.execute(official.context, requestId, {}, 'approve-today'),
    );
    expect(approved.status).toBe('APPROVED');
    expect(await ledgerEntries(fixture, requestId)).toHaveLength(1);

    // A recorded approval still returns its first result once its date has passed.
    await at(justPassed, async () => {
      expect(await approve.execute(official.context, requestId, {}, 'approve-today')).toEqual(
        approved,
      );
    });
    expect(await ledgerEntries(fixture, requestId)).toHaveLength(1);

    // Any passed date refuses the whole request, and rejecting one stays allowed.
    const spanning = await forApproval(fixture, [whole(day(1)), whole(day(2))]);
    await at(`${day(2)}T09:00:00+08:00`, async () => {
      await expect(approve.execute(official.context, spanning, {})).rejects.toMatchObject({
        code: 'CTO_WORK_DATE_PASSED',
      });
      await expectNothingPosted(fixture, spanning);
      const rejected = await reject.execute(official.context, spanning, { reason: 'Too late.' });
      expect(rejected.status).toBe('REJECTED');
    });
  }),
);

it.skipIf(!enabled)('recalculates the current Attendance Day of an approved Work Date', () =>
  withSetup(async (fixture) => {
    const { approve, official, employeeId, credit, admin, agencyId, day } = fixture;
    const workDate = day(0);
    await credit(employeeId, 4800);
    await fixture.fixture.services.days.calculate(fixture.fixture.administratorContext, {
      periodCode: `CTO-DAY-${randomUUID()}`,
      dateFrom: workDate,
      dateTo: workDate,
      employeeIds: [employeeId],
    });
    const dayOf = () =>
      admin.attendanceDay.findFirstOrThrow({
        where: { agencyId, employeeId, workDate: new Date(workDate), isCurrent: true },
        select: { calculationVersion: true },
      });
    const before = await dayOf();
    const requestId = await forApproval(fixture, [whole(workDate)]);

    await approve.execute(official.context, requestId, {});

    expect((await dayOf()).calculationVersion).toBe(before.calculationVersion + 1);
  }),
);

it.skipIf(!enabled)('lets one of two racing approvals take the last COC on an account', () =>
  withSetup(async (fixture) => {
    const { approve, official, employeeId, credit, day, admin, agencyId } = fixture;
    const accountId = await credit(employeeId, 480);
    // Nothing is reserved before approval, so both pass submission on the same COC.
    const first = await forApproval(fixture, [whole(day(0))]);
    const second = await forApproval(fixture, [whole(day(1))]);

    const results = await Promise.allSettled([
      approve.execute(official.context, first, {}),
      approve.execute(official.context, second, {}),
    ]);

    const won = results.filter((result) => result.status === 'fulfilled');
    const lost = results.filter((result) => result.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'CTO_COC_INSUFFICIENT',
      statusCode: 422,
    });
    const balance = await admin.cocLedgerEntry.aggregate({
      where: { agencyId, cocAccountId: accountId },
      _sum: { minutes: true },
    });
    expect(balance._sum.minutes!.toNumber()).toBe(0);
    const winner = (won[0] as PromiseFulfilledResult<{ id: string }>).value.id;
    await expectNothingPosted(fixture, winner === first ? second : first);
  }),
);

it.skipIf(!enabled)(
  'refuses a locked Work Date with a typed reason and rolls back what earlier dates wrote',
  () =>
    withSetup(async (fixture) => {
      const { approve, controller, official, employeeId, credit, day, agencyId } = fixture;
      await credit(employeeId, 4800);
      const requestId = await forApproval(fixture, [whole(day(0)), whole(day(1))]);
      // Only the second date is locked, so the first date's entry and input are written.
      const period = await lockedPeriod(fixture, day(1), day(1));

      await expect(
        approve.execute(official.context, requestId, {}, 'approve-once'),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_WORK_DATE_LOCKED', statusCode: 409 });
      await expectNothingPosted(fixture, requestId);
      const refused = await errorOf(
        controller.approve(agencyId, requestId, {}, 'approve-once', official.context),
      );
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ error: { code: 'ATTENDANCE_WORK_DATE_LOCKED' } });

      // A refusal does not spend the key: the request can still be approved with it.
      await period.unlock();
      const approved = await approve.execute(official.context, requestId, {}, 'approve-once');
      expect(approved.status).toBe('APPROVED');
    }),
);

it.skipIf(!enabled)('rolls back when Attendance refuses overlapping posted leave', () =>
  withSetup(async (fixture) => {
    const { approve, official, employeeId, credit, day, admin, agencyId } = fixture;
    await credit(employeeId, 4800);
    const requestId = await forApproval(fixture, [whole(day(0)), whole(day(1))]);
    // Posted leave arrives after recommendation, on the second date only.
    await admin.attendancePostedLeaveInput.create({
      data: {
        agencyId,
        employeeId,
        sourceKey: randomUUID(),
        sourceType: 'LeavePosting',
        sourceId: randomUUID(),
        dateFrom: new Date(day(1)),
        dateTo: new Date(day(1)),
        unitCode: 'WORKING_DAY',
        quantity: 1,
        allocationKind: 'LEAVE_WITHOUT_PAY',
      },
    });

    await expect(approve.execute(official.context, requestId, {})).rejects.toMatchObject({
      code: 'CTO_INPUT_OVERLAPS_POSTED_LEAVE',
    });
    await expectNothingPosted(fixture, requestId);
  }),
);

it.skipIf(!enabled)('rechecks the COC and the charge when approving', () =>
  withSetup(async (fixture) => {
    const { approve, official, employeeId, credit, day, admin, agencyId, asReplica } = fixture;
    const accountId = await credit(employeeId, 480);
    const requestId = await forApproval(fixture, [whole(day(0))]);

    // COC adjusted away after submission.
    const adjustmentId = randomUUID();
    const version = await admin.documentVersion.findFirstOrThrow({
      where: { agencyId },
      select: { id: true },
    });
    const { validUntil } = await admin.cocLedgerEntry.findFirstOrThrow({
      where: { cocAccountId: accountId },
    });
    await admin.cocLedgerEntry.create({
      data: {
        id: adjustmentId,
        agencyId,
        cocAccountId: accountId,
        minutes: -1,
        effectiveDate: new Date(day(0)),
        validUntil,
        sourceType: 'COC_ADJUSTMENT',
        sourceId: adjustmentId,
        sourcePostingKey: 'ADJUSTMENT',
        ruleCode: 'TEST',
        reason: 'Test.',
        supportingDocumentVersionId: version.id,
        postedByMembershipId: fixture.fixture.memberships.administrator,
      },
    });
    await expect(approve.execute(official.context, requestId, {})).rejects.toMatchObject({
      code: 'CTO_COC_INSUFFICIENT',
    });
    await expectNothingPosted(fixture, requestId);

    // The charge the route reviewed no longer matches the schedule.
    await credit(employeeId, 4800);
    await asReplica((transaction) =>
      transaction.ctoRequestDate.updateMany({
        where: { ctoRequestId: requestId },
        data: { chargedMinutes: 240 },
      }),
    );
    await expect(approve.execute(official.context, requestId, {})).rejects.toMatchObject({
      code: 'CTO_CHARGE_CHANGED',
      statusCode: 409,
    });
    await expectNothingPosted(fixture, requestId);
  }),
);

it.skipIf(!enabled)('returns the first result to a retry with the same idempotency key', () =>
  withSetup(async (fixture) => {
    const { approve, official, employeeId, credit, day, agencyId } = fixture;
    await credit(employeeId, 4800);
    const requestId = await forApproval(fixture, [whole(day(0))]);
    const once = { comment: 'Approved.' };

    const [first, concurrent] = await Promise.all([
      approve.execute(official.context, requestId, once, 'retry-key'),
      approve.execute(official.context, requestId, once, 'retry-key'),
    ]);
    const retried = await approve.execute(official.context, requestId, once, 'retry-key');

    expect(concurrent).toEqual(first);
    expect(retried).toEqual(first);
    expect(await ledgerEntries(fixture, requestId)).toHaveLength(1);
    expect(
      await fixture.admin.attendanceCtoInput.count({ where: { agencyId, sourceId: requestId } }),
    ).toBe(1);
    expect(
      (await auditActions(fixture, requestId)).filter((a) => a === 'CTO_REQUEST_APPROVED'),
    ).toHaveLength(1);

    // The key names this decision: changing its reason or its actor is refused.
    const conflict = { code: 'CTO_REQUEST_IDEMPOTENCY_CONFLICT', statusCode: 409 };
    await expect(
      approve.execute(official.context, requestId, { comment: 'Other.' }, 'retry-key'),
    ).rejects.toMatchObject(conflict);
    await expect(
      approve.execute(
        { ...fixture.supervisor.context, permissions: OFFICIAL_GRANTS },
        requestId,
        once,
        'retry-key',
      ),
    ).rejects.toMatchObject(conflict);
  }),
);

it.skipIf(!enabled)('rejects with a reason and writes nothing to the ledger', () =>
  withSetup(async (fixture) => {
    const { reject, controller, official, employeeId, credit, day, admin, agencyId } = fixture;
    await credit(employeeId, 4800);
    const requestId = await forApproval(fixture, [whole(day(0))]);

    for (const body of [{}, { reason: '   ' }]) {
      const refused = await errorOf(
        controller.reject(agencyId, requestId, body, undefined, official.context),
      );
      expect(refused.status).toBe(400);
    }

    const rejected = await reject.execute(
      official.context,
      requestId,
      { reason: 'Service needs.' },
      'reject-key',
    );
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.approvedAt).toBeNull();
    expect(await ledgerEntries(fixture, requestId)).toEqual([]);
    expect(await admin.attendanceCtoInput.count({ where: { agencyId } })).toBe(0);
    expect(await approvalRequests(fixture, requestId)).toMatchObject([{ status: 'REJECTED' }]);
    expect(
      await admin.auditEvent.findFirstOrThrow({
        where: { action: 'CTO_REQUEST_REJECTED', entityId: requestId },
      }),
    ).toMatchObject({ reason: 'Service needs.', newStatus: 'REJECTED' });

    expect(
      await reject.execute(official.context, requestId, { reason: 'Service needs.' }, 'reject-key'),
    ).toEqual(rejected);

    // A rejected request frees its Work Date.
    await forApproval(fixture, [whole(day(0))]);
  }),
);

it.skipIf(!enabled)('requires each permission, the second step, and a separate approver', () =>
  withSetup(async (fixture) => {
    const { approve, reject, create, submit, official, employee, employeeId } = fixture;
    const { credit, day, supervisor } = fixture;
    await credit(employeeId, 4800);
    const requestId = await forApproval(fixture, [whole(day(0))]);
    const only = (code: string): RequestContext => ({
      ...official.context,
      permissions: grantsOf('AGENCY', [code]),
    });
    const forbidden = { code: 'CTO_REQUEST_FORBIDDEN', statusCode: 403 };

    await expect(approve.execute(only('overtime.cto.reject'), requestId, {})).rejects.toMatchObject(
      forbidden,
    );
    await expect(
      reject.execute(only('overtime.cto.approve'), requestId, { reason: 'No.' }),
    ).rejects.toMatchObject(forbidden);

    // The Employee cannot decide their own request, whatever they are granted.
    const own: RequestContext = { ...employee, permissions: OFFICIAL_GRANTS };
    const self = { code: 'CTO_REQUEST_SELF_DECISION', statusCode: 403 };
    await expect(approve.execute(own, requestId, {})).rejects.toMatchObject(self);
    await expect(reject.execute(own, requestId, { reason: 'No.' })).rejects.toMatchObject(self);

    // A grant is not the route step: only the assigned Approving Official decides it.
    const supervising = { ...supervisor.context, permissions: OFFICIAL_GRANTS };
    await expect(approve.execute(supervising, requestId, {})).rejects.toMatchObject({
      statusCode: 403,
    });
    await expectNothingPosted(fixture, requestId);

    // A request not yet recommended cannot be decided.
    const submitted = await create.execute(employee, { employeeId, dates: [whole(day(1))] });
    await submit.execute(employee, submitted.id);
    await expect(approve.execute(official.context, submitted.id, {})).rejects.toMatchObject({
      code: 'CTO_REQUEST_STATUS_INVALID',
    });
    await expect(
      reject.execute(official.context, submitted.id, { reason: 'No.' }),
    ).rejects.toMatchObject({ code: 'CTO_REQUEST_STATUS_INVALID' });
  }),
);

it.skipIf(!enabled)('keeps approval and rejection inside their Agency', () =>
  withSetup(async (fixture) => {
    const { approve, reject, controller, employeeId, credit, day, admin, agencyId } = fixture;
    await credit(employeeId, 4800);
    const requestId = await forApproval(fixture, [whole(day(0))]);
    const suffix = `${fixture.fixture.suffix}-foreign`;
    const foreign = await createAgency(admin, suffix, 'CTOD');
    try {
      const outsider = context(
        foreign.agency.id,
        foreign.user.id,
        foreign.membership.id,
        OFFICIAL_GRANTS,
      );
      const notFound = { code: 'CTO_REQUEST_NOT_FOUND', statusCode: 404 };
      await expect(approve.execute(outsider, requestId, {})).rejects.toMatchObject(notFound);
      await expect(
        reject.execute(outsider, requestId, { reason: 'Across Agencies.' }),
      ).rejects.toMatchObject(notFound);
      const crossPath = { status: 403 };
      expect(
        await errorOf(controller.approve(agencyId, requestId, {}, undefined, outsider)),
      ).toMatchObject(crossPath);
      expect(
        await errorOf(
          controller.reject(agencyId, requestId, { reason: 'No.' }, undefined, outsider),
        ),
      ).toMatchObject(crossPath);
    } finally {
      await cleanup(admin, [foreign.agency.id], suffix);
    }
    await expectNothingPosted(fixture, requestId);
  }),
);
