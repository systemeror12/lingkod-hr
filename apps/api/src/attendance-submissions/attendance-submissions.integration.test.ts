import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  cleanupAttendanceWorkflowAgency,
  createAttendanceWorkflowFixture,
  manilaInstant,
} from '../attendance-test-fixtures';

const enabled = process.env.DATABASE_E2E === 'true';

it.skipIf(!enabled)(
  'submits an own exact day set, returns it for a reason, and approves only through a different reviewer',
  async () => {
    const fixture = await createAttendanceWorkflowFixture();
    const { admin, services } = fixture;
    try {
      const created = await services.submissions.create(fixture.employeeContext, {
        attendancePeriodId: fixture.periodId,
      });
      expect(created.submission.status).toBe('DRAFT');
      expect(created.submission.versionNo).toBe(1);
      expect(created.days).toHaveLength(1);
      expect(created.days[0]!.attendanceDayId).toBe(fixture.attendanceDayId);
      expect(created.days[0]!.isCurrent).toBe(true);

      const submitted = await services.submissions.submit(
        fixture.employeeContext,
        created.submission.id,
        'submit-1',
      );
      expect(submitted.submission.status).toBe('SUBMITTED');
      expect(submitted.submission.submittedAt).not.toBeNull();

      await expect(
        services.submissions.approve(fixture.employeeContext, created.submission.id, {}),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_SUBMISSION_APPROVE_FORBIDDEN' });

      const returned = await services.submissions.returnForReason(
        fixture.officerContext,
        created.submission.id,
        { reason: 'Please confirm the afternoon time out.' },
      );
      expect(returned.submission.status).toBe('RETURNED');
      expect(returned.submission.reviewReason).toBe('Please confirm the afternoon time out.');

      const resubmitted = await services.submissions.submit(
        fixture.employeeContext,
        created.submission.id,
      );
      expect(resubmitted.submission.status).toBe('SUBMITTED');
      expect(resubmitted.submission.reviewReason).toBeNull();

      const approved = await services.submissions.approve(
        fixture.officerContext,
        created.submission.id,
        { reason: 'Exact Attendance Day versions verified.' },
        'approve-1',
      );
      expect(approved.submission.status).toBe('APPROVED');
      expect(approved.submission.reviewedByMembershipId).toBe(fixture.memberships.officer);

      const day = await admin.attendanceDay.findFirstOrThrow({
        where: { agencyId: fixture.agencyId, id: fixture.attendanceDayId },
      });
      expect(day.status).toBe('APPROVED');

      await expect(
        services.submissions.create(fixture.employeeContext, {
          attendancePeriodId: fixture.periodId,
        }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_SUBMISSION_EXISTS' });
    } finally {
      await cleanupAttendanceWorkflowAgency(admin, fixture.agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'marks a submitted set stale after recalculation and requires a successor submission version',
  async () => {
    const fixture = await createAttendanceWorkflowFixture();
    const { admin, services } = fixture;
    try {
      const created = await services.submissions.create(fixture.employeeContext, {
        attendancePeriodId: fixture.periodId,
      });
      await services.submissions.submit(fixture.employeeContext, created.submission.id);

      await admin.attendanceEvent.create({
        data: {
          agencyId: fixture.agencyId,
          employeeId: fixture.employeeId,
          eventTime: manilaInstant(fixture.workDate, '16:30'),
          eventType: 'BREAK_OUT',
          source: 'MANUAL',
          enteredByMembershipId: fixture.memberships.administrator,
          reason: 'A late correction of the recorded events.',
        },
      });
      const recalculated = await services.days.calculate(fixture.administratorContext, {
        periodCode: (
          await admin.attendancePeriod.findUniqueOrThrow({ where: { id: fixture.periodId } })
        ).code,
        dateFrom: fixture.workDate,
        dateTo: fixture.workDate,
        employeeIds: [fixture.employeeId],
      });
      expect(recalculated.recalculatedCount).toBe(1);

      const stale = await admin.employeeAttendanceSubmission.findFirstOrThrow({
        where: { agencyId: fixture.agencyId, id: created.submission.id },
      });
      expect(stale.status).toBe('STALE');

      await expect(
        services.submissions.submit(fixture.employeeContext, created.submission.id),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_SUBMISSION_STATE_INVALID' });

      const successor = await services.submissions.create(fixture.employeeContext, {
        attendancePeriodId: fixture.periodId,
      });
      expect(successor.submission.versionNo).toBe(2);
      expect(successor.submission.status).toBe('DRAFT');
      expect(successor.days[0]!.calculationVersion).toBe(2);
      expect(successor.days[0]!.attendanceDayId).not.toBe(fixture.attendanceDayId);
    } finally {
      await cleanupAttendanceWorkflowAgency(admin, fixture.agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'blocks approval while a bound Attendance Day version has an open exception',
  async () => {
    const fixture = await createAttendanceWorkflowFixture({ assignment: false });
    const { admin, services } = fixture;
    try {
      const created = await services.submissions.create(fixture.employeeContext, {
        attendancePeriodId: fixture.periodId,
      });
      expect(created.days[0]!.status).toBe('EXCEPTION');
      expect(created.days[0]!.openExceptionCount).toBeGreaterThan(0);
      await services.submissions.submit(fixture.employeeContext, created.submission.id);

      await expect(
        services.submissions.approve(fixture.officerContext, created.submission.id, {}),
      ).rejects.toMatchObject({
        code: 'ATTENDANCE_SUBMISSION_NOT_APPROVABLE',
        statusCode: 409,
      });
      const untouched = await admin.employeeAttendanceSubmission.findFirstOrThrow({
        where: { agencyId: fixture.agencyId, id: created.submission.id },
      });
      expect(untouched.status).toBe('SUBMITTED');
    } finally {
      await cleanupAttendanceWorkflowAgency(admin, fixture.agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'requires reason and evidence for an on-behalf submission, enforces separation, and rejects a foreign Agency',
  async () => {
    const fixture = await createAttendanceWorkflowFixture();
    const { admin, services } = fixture;
    try {
      await expect(
        services.submissions.create(fixture.administratorContext, {
          attendancePeriodId: fixture.periodId,
          employeeId: fixture.employeeId,
          onBehalfReason: 'Employee is on field assignment.',
        }),
      ).rejects.toMatchObject({
        code: 'ATTENDANCE_SUBMISSION_ON_BEHALF_FACT_REQUIRED',
        statusCode: 400,
      });

      await expect(
        services.submissions.create(fixture.administratorContext, {
          attendancePeriodId: fixture.periodId,
          employeeId: fixture.employeeId,
          onBehalfReason: 'Employee is on field assignment.',
          evidenceDocumentVersionId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_SUBMISSION_EVIDENCE_INVALID' });

      const onBehalf = await services.submissions.create(fixture.administratorContext, {
        attendancePeriodId: fixture.periodId,
        employeeId: fixture.employeeId,
        onBehalfReason: 'Employee is on field assignment.',
        evidenceDocumentVersionId: fixture.evidenceDocumentVersionId,
      });
      expect(onBehalf.submission.status).toBe('DRAFT');
      expect(onBehalf.submission.onBehalfReason).toBe('Employee is on field assignment.');
      expect(onBehalf.submission.evidence).toEqual({
        access: 'FULL',
        documentVersionId: fixture.evidenceDocumentVersionId,
      });
      expect(onBehalf.submission.submittedByMembershipId).toBe(fixture.memberships.administrator);

      const submitted = await services.submissions.submit(
        fixture.administratorContext,
        onBehalf.submission.id,
      );
      expect(submitted.submission.status).toBe('SUBMITTED');
      await expect(
        services.submissions.approve(fixture.administratorContext, onBehalf.submission.id, {}),
      ).rejects.toMatchObject({
        code: 'ATTENDANCE_SUBMISSION_SEPARATION_REQUIRED',
        statusCode: 403,
      });
      await expect(
        services.submissions.cancel(fixture.employeeContext, onBehalf.submission.id, {}),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_SUBMISSION_SCOPE_FORBIDDEN' });

      const foreignAgencyId = randomUUID();
      const foreignContext = {
        ...fixture.administratorContext,
        requestId: 'foreign-agency',
        agencyId: foreignAgencyId,
      };
      await expect(
        services.submissions.create(foreignContext, {
          attendancePeriodId: fixture.periodId,
          employeeId: fixture.employeeId,
          onBehalfReason: 'Employee is on field assignment.',
          evidenceDocumentVersionId: fixture.evidenceDocumentVersionId,
        }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_SUBMISSION_EVIDENCE_INVALID' });
      await expect(
        services.submissions.findById(foreignContext, onBehalf.submission.id),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_SUBMISSION_NOT_FOUND' });
    } finally {
      await cleanupAttendanceWorkflowAgency(admin, fixture.agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'requires read_sensitive for HIGHLY_SENSITIVE on-behalf evidence and hides it from other readers',
  async () => {
    const fixture = await createAttendanceWorkflowFixture();
    const { admin, services } = fixture;
    const foreignSuffix = `${fixture.suffix}-foreign`;
    let foreignAgencyId: string | null = null;
    try {
      const foreignAgency = await admin.agency.create({
        data: {
          code: `ASF-${foreignSuffix}`,
          name: 'Foreign Attendance Submission Agency',
          agencyType: 'NGA',
          status: 'ACTIVE',
        },
      });
      foreignAgencyId = foreignAgency.id;
      const foreignUser = await admin.user.create({
        data: {
          emailNormalized: `attendance-submission-foreign-${foreignSuffix}@example.test`,
          displayName: 'Foreign Attendance Submission Custodian',
          globalStatus: 'ACTIVE',
        },
      });
      const foreignMembership = await admin.agencyMembership.create({
        data: { agencyId: foreignAgency.id, userId: foreignUser.id, status: 'ACTIVE' },
      });
      const foreignDocument = await admin.document.create({
        data: {
          agencyId: foreignAgency.id,
          documentType: 'ATTENDANCE_SUBMISSION_EVIDENCE',
          classification: 'HIGHLY_SENSITIVE',
          status: 'APPROVED',
          createdByMembershipId: foreignMembership.id,
        },
      });
      const foreignVersion = await admin.documentVersion.create({
        data: {
          agencyId: foreignAgency.id,
          documentId: foreignDocument.id,
          versionNo: 1,
          storageKey: `attendance-workflow/${foreignSuffix}`,
          contentHash: 'c'.repeat(64),
          mimeType: 'application/pdf',
          sizeBytes: 1,
          issuedAt: new Date(),
          createdByMembershipId: foreignMembership.id,
        },
      });
      await admin.document.update({
        where: { id: foreignDocument.id },
        data: { currentVersionId: foreignVersion.id },
      });

      const version = await admin.documentVersion.findUniqueOrThrow({
        where: { id: fixture.evidenceDocumentVersionId },
      });
      await admin.document.update({
        where: { id: version.documentId },
        data: { classification: 'HIGHLY_SENSITIVE' },
      });
      const input = {
        attendancePeriodId: fixture.periodId,
        employeeId: fixture.employeeId,
        onBehalfReason: 'Employee is on field assignment.',
        evidenceDocumentVersionId: fixture.evidenceDocumentVersionId,
      };
      const sensitiveContext = {
        ...fixture.administratorContext,
        permissions: [
          ...fixture.administratorContext.permissions,
          { code: 'documents.evidence.read_sensitive', scopePolicy: 'AGENCY' as const },
        ],
      };

      await expect(
        services.submissions.create(fixture.administratorContext, input),
      ).rejects.toMatchObject({
        code: 'ATTENDANCE_SUBMISSION_EVIDENCE_FORBIDDEN',
        statusCode: 403,
      });
      // Foreign evidence is invalid whether or not the actor may read sensitive evidence.
      for (const actor of [fixture.administratorContext, sensitiveContext]) {
        await expect(
          services.submissions.create(actor, {
            ...input,
            evidenceDocumentVersionId: foreignVersion.id,
          }),
        ).rejects.toMatchObject({
          code: 'ATTENDANCE_SUBMISSION_EVIDENCE_INVALID',
          statusCode: 409,
        });
      }
      expect(
        await admin.employeeAttendanceSubmission.count({ where: { agencyId: fixture.agencyId } }),
      ).toBe(0);

      const created = await services.submissions.create(sensitiveContext, input);
      expect(created.submission.evidence).toEqual({
        access: 'FULL',
        documentVersionId: fixture.evidenceDocumentVersionId,
      });

      const restricted = await services.submissions.findById(
        fixture.administratorContext,
        created.submission.id,
      );
      expect(restricted.submission.evidence).toEqual({ access: 'RESTRICTED' });
      const ownList = await services.submissions.list(fixture.employeeContext, {});
      expect(ownList.map((item) => item.id)).toEqual([created.submission.id]);
      expect(ownList[0]?.evidence).toEqual({ access: 'RESTRICTED' });
      expect(JSON.stringify(ownList)).not.toContain(fixture.evidenceDocumentVersionId);

      const full = await services.submissions.list(sensitiveContext, {});
      expect(full[0]?.evidence).toEqual({
        access: 'FULL',
        documentVersionId: fixture.evidenceDocumentVersionId,
      });
    } finally {
      if (foreignAgencyId) {
        await cleanupAttendanceWorkflowAgency(admin, foreignAgencyId, foreignSuffix);
      }
      await cleanupAttendanceWorkflowAgency(admin, fixture.agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)('cancels an undecided submission and rejects a decided one', async () => {
  const fixture = await createAttendanceWorkflowFixture();
  const { admin, services } = fixture;
  try {
    const draft = await services.submissions.create(fixture.employeeContext, {
      attendancePeriodId: fixture.periodId,
    });
    const cancelled = await services.submissions.cancel(
      fixture.employeeContext,
      draft.submission.id,
      { reason: 'The day will be corrected first.' },
    );
    expect(cancelled.submission.status).toBe('CANCELLED');

    const successor = await services.submissions.create(fixture.employeeContext, {
      attendancePeriodId: fixture.periodId,
    });
    expect(successor.submission.versionNo).toBe(2);
    await services.submissions.submit(fixture.employeeContext, successor.submission.id);
    await services.submissions.approve(fixture.officerContext, successor.submission.id, {});
    await expect(
      services.submissions.cancel(fixture.employeeContext, successor.submission.id, {}),
    ).rejects.toMatchObject({ code: 'ATTENDANCE_SUBMISSION_STATE_INVALID' });
  } finally {
    await cleanupAttendanceWorkflowAgency(admin, fixture.agencyId, fixture.suffix);
    await admin.$disconnect();
  }
});
