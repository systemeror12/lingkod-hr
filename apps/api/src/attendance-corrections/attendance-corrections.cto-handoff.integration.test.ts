import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import {
  approvalAuditWriter,
  ApprovalCompletionRegistry,
  ApprovalsService,
} from '../approvals/approval.service';
import { AttendanceCtoInputsService } from '../attendance-cto-inputs/attendance-cto-inputs.service';
import {
  cleanupAttendanceWorkflowAgency,
  createAttendanceWorkflowFixture,
  lockAttendancePeriod,
  manilaDate,
  manilaInstant,
  type AttendanceWorkflowFixture,
} from '../attendance-test-fixtures';
import { requestDatabaseContext } from '../database-context';
import { attendanceCorrectionAuditWriter } from './attendance-corrections.audit';
import { AttendanceCorrectionsService } from './attendance-corrections.service';
import {
  ATTENDANCE_CORRECTION_CTO_INPUT_ROUTE_CODE,
  attendanceCorrectionCreateSchema,
  type CtoInputHandoffInput,
} from './attendance-corrections.types';

const enabled = process.env.DATABASE_E2E === 'true';

const authorizerPermissions: RequestContext['permissions'] = [
  { code: 'attendance.corrections.authorize_locked', scopePolicy: 'AGENCY' },
  { code: 'attendance.days.read', scopePolicy: 'AGENCY' },
  { code: 'attendance.dtr.generate', scopePolicy: 'AGENCY' },
  { code: 'attendance.payroll_publications.read', scopePolicy: 'AGENCY' },
  { code: 'approvals.requests.approve', scopePolicy: 'AGENCY' },
];

async function createAdministrator(
  fixture: AttendanceWorkflowFixture,
  label: string,
  permissions: RequestContext['permissions'],
): Promise<RequestContext> {
  const { admin, agencyId, suffix } = fixture;
  const user = await admin.user.create({
    data: {
      emailNormalized: `cto-handoff-${label}-${suffix}@example.test`,
      displayName: `CTO Handoff ${label}`,
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId, userId: user.id, status: 'ACTIVE' },
  });
  const role = await admin.role.findFirstOrThrow({
    where: { agencyId: null, code: 'hrmo_administrator' },
  });
  await admin.membershipRole.create({
    data: {
      agencyId,
      membershipId: membership.id,
      roleId: role.id,
      effectiveFrom: new Date('2020-01-01'),
    },
  });
  return {
    ...fixture.administratorContext,
    requestId: `cto-handoff-${label}-${suffix}`,
    userId: user.id,
    membershipId: membership.id,
    permissions,
  };
}

it.skipIf(!enabled)(
  'accepts a locked CTO correction once per effect key, keeps locked records unchanged, separates its authorizer, and applies through a Locked Attendance Adjustment',
  async () => {
    const fixture = await createAttendanceWorkflowFixture();
    const { admin, agencyId, employeeId, services, workDate } = fixture;
    const context = fixture.administratorContext;
    const registry = new ApprovalCompletionRegistry();
    const approvals = new ApprovalsService(approvalAuditWriter, registry);
    const corrections = new AttendanceCorrectionsService(
      attendanceCorrectionAuditWriter,
      approvals,
      registry,
      services.days,
      services.attendance,
      services.documents,
      services.dtrs,
      services.periods,
    );
    corrections.onModuleInit();
    const ctoInputs = new AttendanceCtoInputsService(services.days);

    const approvingOfficial = await createAdministrator(fixture, 'official', [
      ...authorizerPermissions,
      { code: 'approvals.routes.read', scopePolicy: 'AGENCY' },
      { code: 'approvals.requests.create', scopePolicy: 'AGENCY' },
    ]);
    const authorizer = await createAdministrator(fixture, 'authorizer', authorizerPermissions);
    const locker = await createAdministrator(fixture, 'locker', context.permissions);
    const employeeAuthorizer: RequestContext = {
      ...fixture.employeeContext,
      permissions: authorizerPermissions,
    };

    const handOff = (input: CtoInputHandoffInput) =>
      withDatabaseContext(
        requestDatabaseContext(approvingOfficial, 'approval-transition'),
        (transaction) =>
          corrections.handOffCtoInputInTransaction(transaction, approvingOfficial, input),
      );
    const record = (label: string, from: string, to: string) =>
      withDatabaseContext({ agencyId, membershipId: context.membershipId }, (transaction) =>
        ctoInputs.recordInTransaction(transaction, context, {
          sourceKey: `${fixture.suffix}-${label}`,
          employeeId,
          sourceType: 'CtoRequest',
          sourceId: randomUUID(),
          workDate,
          coverageMode: 'TIMED',
          startsAt: manilaInstant(workDate, from).toISOString(),
          endsAt: manilaInstant(workDate, to).toISOString(),
        }),
      );
    const currentDay = () =>
      admin.attendanceDay.findFirstOrThrow({
        where: { agencyId, employeeId, workDate: new Date(workDate), isCurrent: true },
      });
    const lockedRecords = async () => ({
      days: await admin.attendanceDay.findMany({
        where: { agencyId, employeeId },
        orderBy: { id: 'asc' },
      }),
      versions: await admin.attendancePeriodVersion.findMany({
        where: { agencyId },
        orderBy: { id: 'asc' },
      }),
      publications: await admin.attendancePayrollPublication.findMany({
        where: { agencyId },
        orderBy: { id: 'asc' },
      }),
      facts: await admin.attendancePayrollFact.findMany({
        where: { agencyId },
        orderBy: { id: 'asc' },
      }),
      dtrs: await admin.dtrDocument.findMany({ where: { agencyId }, orderBy: { id: 'asc' } }),
      successors: await admin.attendanceCtoInput.count({
        where: { agencyId, predecessorInputId: { not: null } },
      }),
    });

    try {
      // The fixture worked 08:00-16:00, so CTO over 16:00-17:00 is the Day's only CTO.
      const voided = await record('void', '16:00', '16:30');
      const replaced = await record('replace', '16:30', '17:00');
      const cancellation = {
        id: randomUUID(),
        approvingOfficialMembershipId: approvingOfficial.membershipId,
        approvedAt: new Date(),
        reason: 'Recalled in the exigency of the service.',
      };
      const voidInput: CtoInputHandoffInput = {
        effectKey: `${fixture.suffix}:void`,
        employeeId,
        predecessorInputId: voided.id,
        coverageMode: 'NONE',
        cancellation,
      };
      const replaceInput: CtoInputHandoffInput = {
        effectKey: `${fixture.suffix}:replace`,
        employeeId,
        predecessorInputId: replaced.id,
        coverageMode: 'TIMED',
        startsAt: manilaInstant(workDate, '16:30').toISOString(),
        endsAt: manilaInstant(workDate, '16:45').toISOString(),
        cancellation,
      };

      // An open Work Date needs no correction.
      await expect(handOff(voidInput)).rejects.toMatchObject({
        code: 'ATTENDANCE_CORRECTION_WORK_DATE_NOT_LOCKED',
        statusCode: 409,
      });

      const lockedVersionId = await lockAttendancePeriod(fixture, locker);
      const before = await lockedRecords();
      const lockedDay = await currentDay();
      expect(lockedDay.ctoMinutes).toBe(60);

      // A missing authorization route is a typed refusal, and the same key retries.
      await expect(handOff(voidInput)).rejects.toMatchObject({
        code: 'APPROVAL_ROUTE_RESOLUTION_FAILED',
        statusCode: 409,
      });
      expect(await admin.attendanceCorrection.count({ where: { agencyId } })).toBe(0);
      const route = await services.approvals.createRoute(context, {
        routeCode: ATTENDANCE_CORRECTION_CTO_INPUT_ROUTE_CODE,
        domain: 'ATTENDANCE',
        versionNo: 1,
        effectiveFrom: manilaDate(-30),
        stepDefinition: {
          steps: [
            {
              stepNo: 1,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'attendance.corrections.authorize_locked',
              assignment: { kind: 'MEMBERSHIP', membershipId: authorizer.membershipId },
              requiresSeparateReview: true,
            },
          ],
        },
      });
      await services.approvals.activateRoute(context, route.id, 'Activate the CTO handoff route.');

      // Concurrent calls and a later retry all return one correction.
      const [accepted, concurrent] = await Promise.all([handOff(voidInput), handOff(voidInput)]);
      expect(concurrent.id).toBe(accepted.id);
      expect((await handOff(voidInput)).id).toBe(accepted.id);
      expect(await admin.attendanceCorrection.count({ where: { agencyId } })).toBe(1);
      expect(
        await admin.approvalRequest.count({ where: { agencyId, subjectId: accepted.id } }),
      ).toBe(1);
      expect(
        await admin.auditEvent.count({
          where: {
            agencyId,
            entityId: accepted.id,
            action: 'ATTENDANCE_CORRECTION_FOR_AUTHORIZATION',
          },
        }),
      ).toBe(1);

      // The same key with different facts conflicts; another key cannot correct it twice.
      await expect(
        handOff({ ...voidInput, cancellation: { ...cancellation, id: randomUUID() } }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_CORRECTION_EFFECT_KEY_CONFLICT' });
      await expect(
        handOff({
          ...voidInput,
          coverageMode: 'TIMED',
          startsAt: manilaInstant(workDate, '16:00').toISOString(),
          endsAt: manilaInstant(workDate, '16:15').toISOString(),
        }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_CORRECTION_EFFECT_KEY_CONFLICT' });
      await expect(
        handOff({ ...voidInput, effectKey: `${fixture.suffix}:again` }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_CORRECTION_CTO_INPUT_ALREADY_CORRECTED' });

      // A malformed call or a replacement that could not be placed never waits for authorization.
      await expect(
        handOff({ ...voidInput, effectKey: '  ', predecessorInputId: replaced.id }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_CORRECTION_FACT_INVALID' });
      await expect(
        handOff({ ...voidInput, effectKey: `${fixture.suffix}:foreign`, employeeId: randomUUID() }),
      ).rejects.toMatchObject({
        code: 'ATTENDANCE_CORRECTION_CTO_INPUT_NOT_FOUND',
        statusCode: 404,
      });
      await expect(
        handOff({
          ...replaceInput,
          startsAt: manilaInstant(workDate, '16:15').toISOString(),
        }),
      ).rejects.toMatchObject({ code: 'CTO_INPUT_OVERLAPS_CTO' });
      await expect(
        handOff({
          ...replaceInput,
          startsAt: manilaInstant(workDate, '18:00').toISOString(),
          endsAt: manilaInstant(workDate, '19:00').toISOString(),
        }),
      ).rejects.toMatchObject({ code: 'CTO_INPUT_OUTSIDE_EXPECTED_DUTY' });

      const pendingReplace = await handOff(replaceInput);

      // Its evidence names the cancellation, and the approved cancellation is its factual review.
      const correction = await admin.attendanceCorrection.findUniqueOrThrow({
        where: { id: accepted.id },
        include: { evidence: true },
      });
      expect(correction).toMatchObject({
        targetType: 'CTO_INPUT',
        requestedAction: 'VOID',
        targetId: voided.id,
        status: 'FOR_AUTHORIZATION',
        requestedRecord: null,
        effectKey: voidInput.effectKey,
        initiatedByMembershipId: approvingOfficial.membershipId,
        decidedByMembershipId: approvingOfficial.membershipId,
        excludedDeciderMembershipIds: [approvingOfficial.membershipId],
      });
      expect(correction.evidence).toEqual([
        expect.objectContaining({
          sourceType: 'CtoCancellation',
          sourceId: cancellation.id,
          documentVersionId: null,
        }),
      ]);
      expect(
        await admin.attendanceCorrection.findUniqueOrThrow({ where: { id: pendingReplace.id } }),
      ).toMatchObject({
        requestedAction: 'REPLACE',
        requestedRecord: {
          workDate,
          coverageMode: 'TIMED',
          startsAt: replaceInput.startsAt,
          endsAt: replaceInput.endsAt,
        },
      });

      // Only the COC module's handoff creates one: not the request API, nor a raw draft.
      expect(
        attendanceCorrectionCreateSchema.safeParse({
          employeeId,
          targetType: 'CTO_INPUT',
          requestedAction: 'VOID',
          targetId: voided.id,
          reason: 'Not from COC.',
          evidence: [{ sourceType: 'CtoCancellation', sourceId: cancellation.id }],
        }).success,
      ).toBe(false);
      await expect(
        admin.attendanceCorrection.create({
          data: {
            agencyId,
            employeeId,
            initiatedByMembershipId: approvingOfficial.membershipId,
            recordedByMembershipId: approvingOfficial.membershipId,
            targetType: 'CTO_INPUT',
            requestedAction: 'VOID',
            targetId: randomUUID(),
            status: 'DRAFT',
            reason: 'Not from COC.',
            approvalRouteVersionId: route.id,
            impactPreview: {},
            decidedByMembershipId: approvingOfficial.membershipId,
            effectKey: `${fixture.suffix}:raw`,
            updatedAt: new Date(),
          },
        }),
      ).rejects.toThrow(/must start at FOR_AUTHORIZATION/);

      // The cancellation's Approving Official and the Employee cannot authorize or block it.
      for (const actor of [approvingOfficial, employeeAuthorizer]) {
        await expect(
          corrections.authorizeLocked(actor, accepted.id, undefined),
        ).rejects.toMatchObject({ code: 'ATTENDANCE_CORRECTION_SEPARATION_REQUIRED' });
        await expect(
          corrections.recordBlockingReason(actor, accepted.id, 'I object.'),
        ).rejects.toMatchObject({ code: 'ATTENDANCE_CORRECTION_SEPARATION_REQUIRED' });
      }

      // An authorizer may record a blocking reason instead, and COC can read it.
      const blocked = await corrections.recordBlockingReason(
        authorizer,
        accepted.id,
        'The cancellation order is unsigned.',
      );
      expect(blocked.correction).toMatchObject({
        status: 'FOR_AUTHORIZATION',
        blockingReason: 'The cancellation order is unsigned.',
        blockedByMembershipId: authorizer.membershipId,
      });
      const statuses = await withDatabaseContext({ agencyId }, (transaction) =>
        corrections.ctoInputHandoffStatusesInTransaction(transaction, agencyId, [
          accepted.id,
          pendingReplace.id,
        ]),
      );
      expect(statuses.get(accepted.id)).toMatchObject({
        correctionId: accepted.id,
        status: 'FOR_AUTHORIZATION',
        blockingReason: 'The cancellation order is unsigned.',
        blockedAt: expect.any(String),
      });
      expect(statuses.get(pendingReplace.id)).toMatchObject({ blockingReason: null });

      // Nothing locked has changed while either correction waits.
      expect(await lockedRecords()).toEqual(before);

      // Authorization runs the ordinary Locked Attendance Adjustment.
      const applied = await corrections.authorizeLocked(authorizer, accepted.id, undefined);
      expect(applied.correction).toMatchObject({
        status: 'APPLIED',
        authorizedByMembershipId: authorizer.membershipId,
        blockingReason: 'The cancellation order is unsigned.',
      });
      expect(applied.effect).toMatchObject({
        effectAction: 'VOID',
        targetType: 'CTO_INPUT',
        originalTargetId: voided.id,
        replacementRecord: null,
      });
      expect(applied.lockedAdjustment!.periods).toEqual([
        expect.objectContaining({ predecessorPeriodVersionId: lockedVersionId }),
      ]);
      const voidSuccessor = await admin.attendanceCtoInput.findFirstOrThrow({
        where: { agencyId, predecessorInputId: voided.id },
      });
      expect(voidSuccessor).toMatchObject({
        coverageMode: 'NONE',
        sourceType: 'CtoCancellation',
        sourceId: cancellation.id,
      });
      const afterVoid = await currentDay();
      expect(afterVoid.id).not.toBe(lockedDay.id);
      expect(afterVoid.ctoMinutes).toBe(30);

      // A later authorization applies against the versions the first moved forward.
      const appliedReplace = await corrections.authorizeLocked(
        authorizer,
        pendingReplace.id,
        undefined,
      );
      expect(appliedReplace.correction.status).toBe('APPLIED');
      expect(appliedReplace.effect).toMatchObject({
        effectAction: 'REPLACE',
        replacementRecord: expect.objectContaining({ coverageMode: 'TIMED' }),
      });
      expect(appliedReplace.lockedAdjustment!.periods).toEqual([
        expect.objectContaining({
          predecessorPeriodVersionId:
            applied.lockedAdjustment!.periods[0]!.successorPeriodVersionId,
        }),
      ]);
      expect(
        await admin.attendanceCtoInput.findFirstOrThrow({
          where: { agencyId, predecessorInputId: replaced.id },
        }),
      ).toMatchObject({
        coverageMode: 'TIMED',
        startsAt: manilaInstant(workDate, '16:30'),
        endsAt: manilaInstant(workDate, '16:45'),
      });
      expect((await currentDay()).ctoMinutes).toBe(15);

      // Every locked record is retained as it was; successors and a new publication sit beside it.
      const after = await lockedRecords();
      for (const key of ['versions', 'publications', 'facts', 'dtrs'] as const) {
        expect(after[key]).toEqual(expect.arrayContaining(before[key] as unknown[]));
      }
      // Only a superseded Day's current marker moves; every recorded fact stays.
      expect(after.days).toEqual(
        expect.arrayContaining(
          before.days.map((day) => ({ ...day, isCurrent: expect.any(Boolean) })),
        ),
      );
      expect(after.publications.length).toBeGreaterThan(before.publications.length);
      expect(after.dtrs.length).toBeGreaterThan(before.dtrs.length);
      const publication = await services.periods.findPublication(
        context,
        appliedReplace.lockedAdjustment!.periods[0]!.successorPeriodVersionId,
      );
      expect(publication.facts.find((fact) => fact.factType === 'CTO')).toMatchObject({
        correctedMinutes: 15,
      });

      // A retry after authorization still returns the correction and creates nothing.
      const correctionCount = await admin.attendanceCorrection.count({ where: { agencyId } });
      expect((await handOff(voidInput)).id).toBe(accepted.id);
      expect(await admin.attendanceCorrection.count({ where: { agencyId } })).toBe(correctionCount);

      // A superseded input takes no new correction.
      await expect(
        handOff({ ...voidInput, effectKey: `${fixture.suffix}:stale` }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_CORRECTION_CTO_INPUT_NOT_CURRENT' });
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.lockedAttendanceAdjustmentPeriod.deleteMany({ where: { agencyId } });
        await transaction.lockedAttendanceAdjustment.deleteMany({ where: { agencyId } });
        await transaction.attendanceCorrectionEffect.deleteMany({ where: { agencyId } });
        await transaction.attendanceCorrectionEvidence.deleteMany({ where: { agencyId } });
        await transaction.attendanceCorrection.deleteMany({ where: { agencyId } });
        await transaction.attendanceCtoInput.deleteMany({ where: { agencyId } });
      });
      await cleanupAttendanceWorkflowAgency(admin, agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);
