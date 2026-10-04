import { expect, it } from 'vitest';
import {
  cleanupAttendanceWorkflowAgency,
  createAttendanceWorkflowFixture,
  finalizeAttendancePeriod,
  manilaDate,
  type AttendanceWorkflowFixture,
} from '../attendance-test-fixtures';

const enabled = process.env.DATABASE_E2E === 'true';

async function lockPeriodVersion(
  fixture: AttendanceWorkflowFixture,
  routeVersionId: string,
): Promise<{ id: string; dtrId: string }> {
  const submission = await fixture.services.submissions.create(fixture.employeeContext, {
    attendancePeriodId: fixture.periodId,
  });
  await fixture.services.submissions.submit(fixture.employeeContext, submission.submission.id);
  await fixture.services.submissions.approve(fixture.officerContext, submission.submission.id, {});
  const version = await fixture.admin.attendancePeriodVersion.create({
    data: {
      agencyId: fixture.agencyId,
      attendancePeriodId: fixture.periodId,
      versionNo: 1,
      status: 'LOCKED',
      approvalRouteVersionId: routeVersionId,
      submittedByMembershipId: fixture.memberships.administrator,
      submittedAt: new Date(),
      reviewedByMembershipId: fixture.memberships.officer,
      reviewedAt: new Date(),
      reviewReason: 'Period version reviewed for the DTR fixture.',
      lockedByMembershipId: fixture.memberships.administrator,
      lockedAt: new Date('2026-06-16T01:30:00.000Z'),
      reconciliation: { seed: true },
    },
  });
  await fixture.admin.attendancePeriodVersionDay.create({
    data: {
      agencyId: fixture.agencyId,
      attendancePeriodVersionId: version.id,
      employeeAttendanceSubmissionId: submission.submission.id,
      attendanceDayId: fixture.attendanceDayId,
    },
  });
  await finalizeAttendancePeriod(fixture.admin, fixture.periodId);
  return { id: version.id, dtrId: submission.submission.id };
}

async function createLockRoute(fixture: AttendanceWorkflowFixture): Promise<string> {
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
          requiredPermission: 'attendance.dtr.generate',
          assignment: { kind: 'MEMBERSHIP', membershipId: fixture.memberships.administrator },
          requiresSeparateReview: false,
        },
      ],
    },
  });
  await fixture.services.approvals.activateRoute(
    fixture.administratorContext,
    route.id,
    'Activate the DTR fixture lock route.',
  );
  const version = await fixture.admin.approvalRouteVersion.findFirstOrThrow({
    where: { agencyId: fixture.agencyId, routeCode: 'DTR-PERIOD-LOCK', status: 'ACTIVE' },
  });
  return version.id;
}

it.skipIf(!enabled)(
  'derives an unfinalized preview and generates idempotent Finalized DTRs for a locked version',
  async () => {
    const fixture = await createAttendanceWorkflowFixture();
    const { admin, services } = fixture;
    try {
      const routeVersionId = await createLockRoute(fixture);
      const locked = await lockPeriodVersion(fixture, routeVersionId);

      const preview = await services.dtrs.preview(fixture.employeeContext, {
        attendancePeriodId: fixture.periodId,
      });
      expect(preview.unfinalized).toBe(true);
      expect(preview.days).toHaveLength(1);
      const previewDay = preview.days[0]!;
      expect(previewDay.attendanceDayId).toBe(fixture.attendanceDayId);
      expect(previewDay.presentation.map((entry) => entry.label)).toEqual([
        'AM In',
        'AM Out',
        'PM In',
        'PM Out',
      ]);
      expect(previewDay.presentation.map((entry) => entry.slot)).toEqual([
        'AM_IN',
        'AM_OUT',
        'PM_IN',
        'PM_OUT',
      ]);
      expect(previewDay.presentation[0]!.localTime).toBe('08:00:00');
      expect(previewDay.sources.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(previewDay.sources.workScheduleVersionId).not.toBeNull();

      const generated = await services.dtrs.generate(fixture.administratorContext, locked.id);
      expect(generated.dtrDocumentIds).toHaveLength(1);
      expect(generated.existingDtrDocumentIds).toHaveLength(0);

      const replay = await services.dtrs.generate(fixture.administratorContext, locked.id);
      expect(replay.dtrDocumentIds).toHaveLength(0);
      expect(replay.existingDtrDocumentIds).toEqual(generated.dtrDocumentIds);

      const list = await services.dtrs.list(fixture.administratorContext, {
        attendancePeriodId: fixture.periodId,
      });
      expect(list).toHaveLength(1);
      expect(list[0]!.classification).toBe('ORIGINAL');
      expect(list[0]!.outputType).toBe('PRINTABLE_SYSTEM_VIEW');
      expect(list[0]!.isCurrent).toBe(true);
      expect(list[0]!.versionNo).toBe(1);

      const detail = await services.dtrs.findById(
        fixture.employeeContext,
        generated.dtrDocumentIds[0]!,
      );
      expect(detail.manifest.days[0]!.attendanceDayId).toBe(fixture.attendanceDayId);
      expect(detail.manifest.version.lockedAt).toBe('2026-06-16T01:30:00.000Z');
      expect(detail.manifest.employee.id).toBe(fixture.employeeId);

      const html = await services.dtrs.render(fixture.employeeContext, list[0]!.id);
      expect(html).toContain('Daily Time Record');
      expect(html).toContain('Version 1 · ORIGINAL');
      expect(html).not.toContain('UNFINALIZED PREVIEW');

      const previewHtml = await services.dtrs.renderPreview(fixture.employeeContext, {
        attendancePeriodId: fixture.periodId,
      });
      expect(previewHtml).toContain('UNFINALIZED PREVIEW');

      await expect(
        admin.dtrDocument.update({
          where: { agencyId_id: { agencyId: fixture.agencyId, id: generated.dtrDocumentIds[0]! } },
          data: { generatedAt: new Date() },
        }),
      ).rejects.toThrow(/immutable/i);

      const foreignContext = {
        ...fixture.administratorContext,
        requestId: 'foreign-dtr',
        agencyId: '00000000-0000-4000-8000-000000000999',
      };
      await expect(
        services.dtrs.findById(foreignContext, generated.dtrDocumentIds[0]!),
      ).rejects.toMatchObject({ code: 'DTR_NOT_FOUND' });
    } finally {
      await cleanupAttendanceWorkflowAgency(admin, fixture.agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'refuses to generate Finalized DTRs for a version that is not locked',
  async () => {
    const fixture = await createAttendanceWorkflowFixture();
    const { admin, services } = fixture;
    try {
      const routeVersionId = await createLockRoute(fixture);
      const version = await admin.attendancePeriodVersion.create({
        data: {
          agencyId: fixture.agencyId,
          attendancePeriodId: fixture.periodId,
          versionNo: 1,
          status: 'FOR_REVIEW',
          approvalRouteVersionId: routeVersionId,
          submittedByMembershipId: fixture.memberships.administrator,
          submittedAt: new Date(),
        },
      });
      await expect(
        services.dtrs.generate(fixture.administratorContext, version.id),
      ).rejects.toMatchObject({ code: 'DTR_VERSION_NOT_LOCKED', statusCode: 409 });
    } finally {
      await cleanupAttendanceWorkflowAgency(admin, fixture.agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);
