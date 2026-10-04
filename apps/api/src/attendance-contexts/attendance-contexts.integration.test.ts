import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { attendanceWorkflowServices } from '../attendance-test-fixtures';

const enabled = process.env.DATABASE_E2E === 'true';

function context(
  agencyId: string,
  userId: string,
  membershipId: string,
  permissions: RequestContext['permissions'],
): RequestContext {
  return {
    requestId: 'attendance-context-integration-test',
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions,
  };
}

async function createAdminClient(): Promise<PrismaClient> {
  const databaseUrl =
    process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!databaseUrl) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

async function createEvidence(
  admin: PrismaClient,
  agencyId: string,
  membershipId: string,
  suffix: string,
  finalized = true,
) {
  const document = await admin.document.create({
    data: {
      agencyId,
      documentType: 'ATTENDANCE_CONTEXT_EVIDENCE',
      classification: 'INTERNAL',
      status: finalized ? 'APPROVED' : 'DRAFT',
      createdByMembershipId: membershipId,
    },
  });
  const version = await admin.documentVersion.create({
    data: {
      agencyId,
      documentId: document.id,
      versionNo: 1,
      storageKey: `attendance-context-integration/${suffix}`,
      contentHash: 'c'.repeat(64),
      mimeType: 'application/pdf',
      sizeBytes: 1,
      ...(finalized ? { issuedAt: new Date('2026-01-02T00:00:00.000Z') } : {}),
      createdByMembershipId: membershipId,
    },
  });
  await admin.document.update({
    where: { id: document.id },
    data: { currentVersionId: version.id },
  });
  return version.id;
}

async function createEmployee(
  admin: PrismaClient,
  agencyId: string,
  membershipId: string,
  suffix: string,
  name: string,
) {
  return admin.employee.create({
    data: {
      agencyId,
      employeeNumber: `EMP-${suffix}`,
      legalName: name,
      birthDate: new Date('1990-01-01'),
      sex: 'FEMALE',
      civilStatus: 'SINGLE',
      contactEmail: `${suffix}@example.test`,
      serviceStatus: 'ACTIVE',
      createdByMembershipId: membershipId,
      updatedByMembershipId: membershipId,
    },
  });
}

it.skipIf(!enabled)(
  'records, replays, lists, and resolves Attendance Contexts under RLS',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-attendance-context`;
    const agency = await admin.agency.create({
      data: {
        code: `AC-${suffix}`,
        name: 'Attendance Context Integration Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const foreignAgency = await admin.agency.create({
      data: {
        code: `AC-F-${suffix}`,
        name: 'Foreign Attendance Context Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        emailNormalized: `attendance-context-${suffix}@example.test`,
        displayName: 'Attendance Context Custodian',
        globalStatus: 'ACTIVE',
      },
    });
    const foreignUser = await admin.user.create({
      data: {
        emailNormalized: `foreign-attendance-context-${suffix}@example.test`,
        displayName: 'Foreign Attendance Context Custodian',
        globalStatus: 'ACTIVE',
      },
    });
    const foreignMembership = await admin.agencyMembership.create({
      data: { agencyId: foreignAgency.id, userId: foreignUser.id, status: 'ACTIVE' },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const employee = await createEmployee(
      admin,
      agency.id,
      membership.id,
      `${suffix}-1`,
      'Ana Reyes',
    );
    await withDatabaseContext(
      {
        agencyId: agency.id,
        userId: user.id,
        membershipId: membership.id,
        capabilities: ['employee-membership-link'],
      },
      (transaction) =>
        transaction.agencyMembership.update({
          where: { agencyId_id: { agencyId: agency.id, id: membership.id } },
          data: { employeeId: employee.id },
        }),
    );
    const coEmployee = await createEmployee(
      admin,
      agency.id,
      membership.id,
      `${suffix}-2`,
      'Ben Cruz',
    );
    const foreignEmployee = await createEmployee(
      admin,
      foreignAgency.id,
      foreignMembership.id,
      `${suffix}-f`,
      'Cara Diaz',
    );

    const service = attendanceWorkflowServices().contexts;
    const hrContext = context(agency.id, user.id, membership.id, [
      { code: 'attendance.contexts.read', scopePolicy: 'AGENCY' },
      { code: 'attendance.contexts.create', scopePolicy: 'AGENCY' },
    ]);

    try {
      const evidenceId = await createEvidence(admin, agency.id, membership.id, `${suffix}-1`);
      const unfinalizedEvidenceId = await createEvidence(
        admin,
        agency.id,
        membership.id,
        `${suffix}-2`,
        false,
      );
      const foreignEvidenceId = await createEvidence(
        admin,
        foreignAgency.id,
        foreignMembership.id,
        `${suffix}-f`,
      );

      const whole = await service.record(
        hrContext,
        {
          employeeId: employee.id,
          contextType: 'OFFICIAL_BUSINESS',
          coverageMode: 'WHOLE_WORK_DATE',
          workDate: '2026-01-05',
          reason: 'Field validation in the municipality.',
          evidenceDocumentVersionId: evidenceId,
        },
        'attendance-context-integration-1',
      );
      expect(whole).toMatchObject({
        employee: { id: employee.id, legalName: 'Ana Reyes' },
        contextType: 'OFFICIAL_BUSINESS',
        coverageMode: 'WHOLE_WORK_DATE',
        workDate: '2026-01-05',
        startsAt: null,
        endsAt: null,
        evidence: { documentVersionId: evidenceId },
        recordedBy: { membershipId: membership.id, legalName: 'Ana Reyes' },
      });

      const replay = await service.record(
        hrContext,
        {
          employeeId: employee.id,
          contextType: 'OFFICIAL_BUSINESS',
          coverageMode: 'WHOLE_WORK_DATE',
          workDate: '2026-01-05',
          reason: 'Field validation in the municipality.',
          evidenceDocumentVersionId: evidenceId,
        },
        'attendance-context-integration-1',
      );
      expect(replay.id).toBe(whole.id);
      await expect(
        service.record(
          hrContext,
          {
            employeeId: employee.id,
            contextType: 'OFFICIAL_BUSINESS',
            coverageMode: 'WHOLE_WORK_DATE',
            workDate: '2026-01-06',
            reason: 'Field validation in the municipality.',
            evidenceDocumentVersionId: evidenceId,
          },
          'attendance-context-integration-1',
        ),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_CONTEXT_IDEMPOTENCY_CONFLICT' });

      const audit = await admin.auditEvent.findFirstOrThrow({
        where: {
          agencyId: agency.id,
          action: 'ATTENDANCE_CONTEXT_RECORDED',
          entityId: whole.id,
        },
      });
      expect(audit.idempotencyKey).toBe('attendance-context-integration-1');
      expect(audit.metadata).toMatchObject({ contextId: whole.id, employeeId: employee.id });

      const timed = await service.record(hrContext, {
        employeeId: employee.id,
        contextType: 'TRAINING',
        coverageMode: 'TIMED',
        startsAt: '2026-01-05T01:00:00.000Z',
        endsAt: '2026-01-05T05:00:00.000Z',
        reason: 'Records management training.',
        sourceType: 'TrainingNomination',
        sourceId: '00000000-0000-4000-8000-000000000099',
      });
      const sameType = await service.record(hrContext, {
        employeeId: employee.id,
        contextType: 'OFFICIAL_BUSINESS',
        coverageMode: 'TIMED',
        startsAt: '2026-01-05T02:00:00.000Z',
        endsAt: '2026-01-05T03:00:00.000Z',
        reason: 'Second field validation covering the same hours.',
        evidenceDocumentVersionId: evidenceId,
      });
      await service.record(hrContext, {
        employeeId: employee.id,
        contextType: 'TRAINING',
        coverageMode: 'TIMED',
        startsAt: '2026-01-06T01:00:00.000Z',
        endsAt: '2026-01-06T05:00:00.000Z',
        reason: 'Records management training, day two.',
        sourceType: 'TrainingNomination',
        sourceId: '00000000-0000-4000-8000-000000000099',
      });

      const resolution = await service.resolveCoverage(hrContext, employee.id, '2026-01-05', {
        startsAt: '2026-01-05T00:00:00.000Z',
        endsAt: '2026-01-05T08:00:00.000Z',
      });
      expect(resolution.intervals).toHaveLength(3);
      expect(resolution.intervals.map((interval) => interval.context.id).sort()).toEqual(
        [whole.id, timed.id, sameType.id].sort(),
      );
      expect(resolution.conflicts).toHaveLength(1);
      expect(resolution.conflicts[0]).toMatchObject({
        exceptionType: 'CONFLICTING_COVERAGE',
        startsAt: '2026-01-05T01:00:00.000Z',
        endsAt: '2026-01-05T05:00:00.000Z',
      });
      expect(resolution.conflicts[0]?.contextTypes).toEqual(['OFFICIAL_BUSINESS', 'TRAINING']);

      const listed = await service.list(hrContext, { employeeId: employee.id });
      expect(listed).toHaveLength(4);
      const trainings = await service.list(hrContext, { contextType: 'TRAINING' });
      expect(trainings).toHaveLength(2);

      await expect(
        service.record(hrContext, {
          employeeId: foreignEmployee.id,
          contextType: 'OFFICIAL_BUSINESS',
          coverageMode: 'WHOLE_WORK_DATE',
          workDate: '2026-01-05',
          reason: 'Foreign employee context.',
          evidenceDocumentVersionId: evidenceId,
        }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_CONTEXT_EMPLOYEE_NOT_FOUND' });
      await expect(
        service.record(hrContext, {
          employeeId: employee.id,
          contextType: 'OFFICIAL_BUSINESS',
          coverageMode: 'WHOLE_WORK_DATE',
          workDate: '2026-01-05',
          reason: 'Foreign evidence.',
          evidenceDocumentVersionId: foreignEvidenceId,
        }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_CONTEXT_EVIDENCE_INVALID' });
      await expect(
        service.record(hrContext, {
          employeeId: employee.id,
          contextType: 'OFFICIAL_BUSINESS',
          coverageMode: 'WHOLE_WORK_DATE',
          workDate: '2026-01-05',
          reason: 'Unfinalized evidence.',
          evidenceDocumentVersionId: unfinalizedEvidenceId,
        }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_CONTEXT_EVIDENCE_INVALID' });

      const ownContext = context(agency.id, user.id, membership.id, [
        { code: 'attendance.contexts.read', scopePolicy: 'OWN' },
      ]);
      const ownList = await service.list(ownContext);
      expect(ownList).toHaveLength(4);
      const touched = await service.resolveCoverage(ownContext, employee.id, '2026-01-05', {
        startsAt: '2026-01-05T00:00:00.000Z',
        endsAt: '2026-01-05T08:00:00.000Z',
      });
      expect(touched.intervals).toHaveLength(3);
      await expect(
        service.list(
          context(agency.id, foreignUser.id, foreignMembership.id, [
            { code: 'attendance.contexts.read', scopePolicy: 'OWN' },
          ]),
        ),
      ).resolves.toHaveLength(0);
      await expect(
        service.resolveCoverage(ownContext, coEmployee.id, '2026-01-05', {
          startsAt: '2026-01-05T00:00:00.000Z',
          endsAt: '2026-01-05T08:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_CONTEXT_READ_FORBIDDEN' });
    } finally {
      await admin.$disconnect();
    }
  },
);
