import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  hashEmail,
  hashPassword,
  normalizeRecoveryCode,
  permissionsRequireMfa,
  sealTotpSecret,
} from '@lingkod-hr/auth';
import { getConfig, parseProtectedValueKey } from '@lingkod-hr/config';

if (process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production') {
  throw new Error('The protected-shell seed holds local-only credentials and refuses production.');
}
// Validated before any database write, so a missing key fails the run without a partial seed.
const config = getConfig();

const databaseUrl =
  process.env.DATABASE_E2E_ADMIN_URL ??
  process.env.DATABASE_MIGRATION_OWNER_URL ??
  'postgresql://hris_local:local_only@localhost:55432/hris';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const foreignAgencyId = '11111111-1111-4111-8111-111111111111';
const foreignUnitId = '22222222-2222-4222-8222-222222222222';
const foreignUnitVersionId = '33333333-3333-4333-8333-333333333333';
const foreignAuditEventId = '44444444-4444-4444-8444-444444444444';
const foreignEmployeeId = '55555555-5555-4555-8555-555555555555';
const foreignIdentifierId = '66666666-6666-4666-8666-666666666666';
const leaveNationalRuleDocumentId = '77777777-7777-4777-8777-777777777777';
const leaveAgencyConfigurationDocumentId = '88888888-8888-4888-8888-888888888888';
const phase5OwnerEmail = 'phase5.owner@example.test';
const phase5OwnerToken = 'phase5-owner-invitation-token-0000000000000';
const phase5RestrictedEmail = 'phase5.restricted@example.test';
const phase5RestrictedToken = 'phase5-restricted-invitation-token-00000000';
// An MFA-Required User left without a TOTP factor, so sign-in starts forced enrollment.
const enrollmentCandidateEmail = 'enrollment.candidate@example.test';
// A Security Administrator who resets the Factor Reset candidate's authenticator, after which the
// candidate, an MFA-Required HRMO Administrator, enrolls again.
const securityOfficerEmail = 'security.officer@example.test';
const factorResetCandidateEmail = 'factor.reset.candidate@example.test';
// The same officer locks and unlocks this HRMO Administrator; each seed run unlocks them.
const userLockCandidateEmail = 'user.lock.candidate@example.test';
const seedPhase5Access = process.env.PHASE5_ACCESS_FIXTURES === 'true';

/**
 * Local-only sign-in credentials, documented in the README. Every seeded User gets the passphrase;
 * seeded MFA-Required Users also get a TOTP factor with this secret and these Recovery Codes. The
 * Playwright fixture in `apps/web/e2e/sign-in.ts` repeats these values.
 */
const LOCAL_SEED_PASSPHRASE = 'local-only seed passphrase';
const LOCAL_SEED_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const LOCAL_SEED_RECOVERY_CODES = [
  'seedc-ode22',
  'seedc-ode23',
  'seedc-ode24',
  'seedc-ode25',
  'seedc-ode26',
  'seedc-ode27',
  'seedc-ode32',
  'seedc-ode33',
  'seedc-ode34',
  'seedc-ode35',
];
const seededUserEmails = [
  'marisol.santos@example.test',
  'personnel.preparer@example.test',
  phase5OwnerEmail,
  phase5RestrictedEmail,
  'foreign.personnel@example.test',
  'dtr.reviewer@example.test',
  enrollmentCandidateEmail,
  securityOfficerEmail,
  factorResetCandidateEmail,
  userLockCandidateEmail,
];

function manilaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function resetProfile(agency: {
  id: string;
  name: string;
  acronym: string | null;
  agencyType: string;
  status: string;
}): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.agency.update({
      where: { id: agency.id },
      data: { currentProfileVersionId: null },
    });
    await transaction.auditEvent.deleteMany({
      where: { agencyId: agency.id, entityType: 'AgencyProfileVersion' },
    });
    await transaction.agencyProfileVersion.deleteMany({ where: { agencyId: agency.id } });
    const profile = await transaction.agencyProfileVersion.create({
      data: {
        agencyId: agency.id,
        versionNo: 1,
        officialName: agency.name,
        acronym: agency.acronym,
        agencyType: agency.agencyType,
        parentOrganization: 'Office of the President',
        reportingIdentifiers: 'UACS 240010000',
        appointingAuthorityTitle: 'Secretary',
        defaultTimezone: 'Asia/Manila',
        defaultCurrency: 'PHP',
        deploymentProfile: 'SHARED_SAAS',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        status: 'ACTIVE',
        domainStatus: agency.status,
      },
    });
    await transaction.agency.update({
      where: { id: agency.id },
      data: {
        currentProfileVersionId: profile.id,
        name: agency.name,
        acronym: agency.acronym,
        agencyType: agency.agencyType,
        status: agency.status,
        defaultTimezone: 'Asia/Manila',
        defaultCurrency: 'PHP',
      },
    });
  });
}

const dtrFixture = {
  agencyId: 'd7a00000-0000-4000-8000-000000000001',
  membershipId: 'd7a00000-0000-4000-8000-000000000002',
  employeeId: 'd7a00000-0000-4000-8000-000000000003',
  reviewerMembershipId: 'd7a00000-0000-4000-8000-000000000004',
} as const;

const dtrReviewerInvitationToken = 'dtr-reviewer-invitation-token-0000000000000';

/**
 * Dedicated Daily Time Record journey: one agency whose only membership is
 * linked to its Employee and owns a locked Attendance Period Version. Keeping
 * this fixture in its own agency leaves the main protected-shell journeys
 * untouched while the DTR workspace exercises its whole submitted and
 * finalized lineage.
 */
async function seedDtrFixture(): Promise<void> {
  const user = await prisma.user.findFirstOrThrow({
    where: { emailNormalized: 'marisol.santos@example.test' },
  });
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.attendancePayrollFact.deleteMany({
      where: { agencyId: dtrFixture.agencyId },
    });
    await transaction.attendancePayrollPublication.deleteMany({
      where: { agencyId: dtrFixture.agencyId },
    });
    await transaction.dtrDocument.deleteMany({ where: { agencyId: dtrFixture.agencyId } });
    await transaction.documentVersion.deleteMany({ where: { agencyId: dtrFixture.agencyId } });
    await transaction.document.deleteMany({ where: { agencyId: dtrFixture.agencyId } });
    await transaction.attendancePeriodVersionDay.deleteMany({
      where: { agencyId: dtrFixture.agencyId },
    });
    await transaction.attendancePeriodVersion.deleteMany({
      where: { agencyId: dtrFixture.agencyId },
    });
    await transaction.employeeAttendanceSubmissionDay.deleteMany({
      where: { agencyId: dtrFixture.agencyId },
    });
    await transaction.employeeAttendanceSubmission.deleteMany({
      where: { agencyId: dtrFixture.agencyId },
    });
    await transaction.attendanceException.deleteMany({ where: { agencyId: dtrFixture.agencyId } });
    await transaction.attendanceDaySegment.deleteMany({ where: { agencyId: dtrFixture.agencyId } });
    await transaction.attendanceDay.deleteMany({ where: { agencyId: dtrFixture.agencyId } });
    await transaction.attendancePeriod.deleteMany({ where: { agencyId: dtrFixture.agencyId } });
    await transaction.attendanceEvent.deleteMany({ where: { agencyId: dtrFixture.agencyId } });
    await transaction.scheduleAssignment.deleteMany({ where: { agencyId: dtrFixture.agencyId } });
    await transaction.holidayCalendarEntry.deleteMany({ where: { agencyId: dtrFixture.agencyId } });
    await transaction.workArrangementVersion.deleteMany({
      where: { agencyId: dtrFixture.agencyId },
    });
    await transaction.workArrangement.updateMany({
      where: { agencyId: dtrFixture.agencyId },
      data: { currentVersionId: null },
    });
    await transaction.workArrangement.deleteMany({ where: { agencyId: dtrFixture.agencyId } });
    await transaction.holidayCalendarVersion.deleteMany({
      where: { agencyId: dtrFixture.agencyId },
    });
    await transaction.holidayCalendar.updateMany({
      where: { agencyId: dtrFixture.agencyId },
      data: { currentVersionId: null },
    });
    await transaction.holidayCalendar.deleteMany({ where: { agencyId: dtrFixture.agencyId } });
    await transaction.workScheduleBreakInterval.deleteMany({
      where: { agencyId: dtrFixture.agencyId },
    });
    await transaction.workScheduleDayRule.deleteMany({ where: { agencyId: dtrFixture.agencyId } });
    await transaction.workScheduleVersion.deleteMany({ where: { agencyId: dtrFixture.agencyId } });
    await transaction.workSchedule.updateMany({
      where: { agencyId: dtrFixture.agencyId },
      data: { currentVersionId: null },
    });
    await transaction.workSchedule.deleteMany({ where: { agencyId: dtrFixture.agencyId } });
    await transaction.approvalRouteVersion.deleteMany({
      where: { agencyId: dtrFixture.agencyId },
    });
    await transaction.membershipRole.deleteMany({ where: { agencyId: dtrFixture.agencyId } });
    await transaction.employee.updateMany({
      where: { agencyId: dtrFixture.agencyId },
      data: { currentServiceSegmentId: null },
    });
    await transaction.serviceSegment.deleteMany({ where: { agencyId: dtrFixture.agencyId } });
    await transaction.organizationUnit.updateMany({
      where: { agencyId: dtrFixture.agencyId },
      data: { currentVersionId: null },
    });
    await transaction.organizationUnitVersion.deleteMany({
      where: { agencyId: dtrFixture.agencyId },
    });
    await transaction.organizationUnit.deleteMany({ where: { agencyId: dtrFixture.agencyId } });
    await transaction.employee.deleteMany({ where: { agencyId: dtrFixture.agencyId } });
    await transaction.invitation.deleteMany({ where: { agencyId: dtrFixture.agencyId } });
    await transaction.userSession.deleteMany({
      where: {
        agencyMembershipId: {
          in: [dtrFixture.membershipId, dtrFixture.reviewerMembershipId],
        },
      },
    });
    await transaction.agencyMembership.deleteMany({ where: { agencyId: dtrFixture.agencyId } });
    await transaction.agency.deleteMany({ where: { id: dtrFixture.agencyId } });
    const reviewer = await transaction.user.findUnique({
      where: { emailNormalized: 'dtr.reviewer@example.test' },
      select: { id: true },
    });
    if (reviewer) {
      // Replica mode skips cascades, so remove what the browser journey's activation wrote.
      const where = { userId: reviewer.id };
      await transaction.userSession.deleteMany({ where });
      await transaction.pendingAuthentication.deleteMany({ where });
      await transaction.userPassword.deleteMany({ where });
      await transaction.userTotpFactor.deleteMany({ where });
      await transaction.userRecoveryCode.deleteMany({ where });
      await transaction.securityEvent.deleteMany({ where });
      await transaction.user.deleteMany({ where: { id: reviewer.id } });
    }
  });

  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    const agency = await transaction.agency.create({
      data: {
        id: dtrFixture.agencyId,
        code: 'E2E-DTR',
        name: 'Daily Time Record Journey Agency',
        acronym: 'DTR',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const membership = await transaction.agencyMembership.create({
      data: {
        id: dtrFixture.membershipId,
        agencyId: agency.id,
        userId: user.id,
        status: 'ACTIVE',
        activatedAt: new Date('2026-01-01'),
      },
    });
    const employee = await transaction.employee.create({
      data: {
        id: dtrFixture.employeeId,
        agencyId: agency.id,
        employeeNumber: 'E2E-DTR-0001',
        legalName: 'DTR Journey Employee',
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: 'dtr.journey@example.test',
        serviceStatus: 'ACTIVE',
        firstGovernmentServiceDate: new Date('2020-01-01'),
        agencyServiceStartDate: new Date('2020-01-01'),
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    await transaction.agencyMembership.update({
      where: { id: membership.id },
      data: { employeeId: employee.id },
    });
    const dtrUnit = await transaction.organizationUnit.create({
      data: {
        agencyId: agency.id,
        code: 'DTR-UNIT',
        unitType: 'DIVISION',
        status: 'ACTIVE',
      },
    });
    const dtrUnitVersion = await transaction.organizationUnitVersion.create({
      data: {
        agencyId: agency.id,
        organizationUnitId: dtrUnit.id,
        versionNo: 1,
        name: 'Daily Time Record Division',
        effectiveFrom: new Date('2020-01-01'),
        status: 'ACTIVE',
        domainStatus: 'ACTIVE',
      },
    });
    await transaction.organizationUnit.update({
      where: { id: dtrUnit.id },
      data: { currentVersionId: dtrUnitVersion.id },
    });
    const dtrServiceSegment = await transaction.serviceSegment.create({
      data: {
        agencyId: agency.id,
        employeeId: employee.id,
        organizationUnitId: dtrUnit.id,
        appointmentStatus: 'PERMANENT',
        salaryGrade: 18,
        salaryStep: 2,
        effectiveFrom: new Date('2020-01-01'),
        status: 'ACTIVE',
        createdByMembershipId: membership.id,
      },
    });
    await transaction.employee.update({
      where: { id: employee.id },
      data: { currentServiceSegmentId: dtrServiceSegment.id },
    });
    // The reviewer is a second person. The browser journey activates the
    // seeded invitation as the reviewer so it can prove
    // transaction-level separation of duties between reviewer and locker.
    const reviewerEmail = 'dtr.reviewer@example.test';
    const reviewerUser = await transaction.user.create({
      data: {
        emailNormalized: reviewerEmail,
        displayName: 'DTR Journey Reviewer',
        globalStatus: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    const reviewerMembership = await transaction.agencyMembership.create({
      data: {
        id: dtrFixture.reviewerMembershipId,
        agencyId: agency.id,
        userId: reviewerUser.id,
        status: 'INVITED',
      },
    });
    await transaction.invitation.create({
      data: {
        agencyId: agency.id,
        emailNormalized: reviewerEmail,
        invitedByMembershipId: membership.id,
        tokenHash: createHash('sha256').update(dtrReviewerInvitationToken).digest(),
        requestedRoleCodes: ['hrmo_administrator'],
        expiresAt: new Date('2099-01-01'),
        status: 'PENDING',
      },
    });
    const authorityDocument = await transaction.document.create({
      data: {
        agencyId: agency.id,
        documentType: 'SCHEDULE_ASSIGNMENT_AUTHORITY',
        classification: 'INTERNAL',
        status: 'APPROVED',
        createdByMembershipId: membership.id,
      },
    });
    const authorityVersion = await transaction.documentVersion.create({
      data: {
        agencyId: agency.id,
        documentId: authorityDocument.id,
        versionNo: 1,
        storageKey: `e2e-dtr-authority-${authorityDocument.id}`,
        contentHash: 'a'.repeat(64),
        mimeType: 'application/pdf',
        sizeBytes: 1,
        issuedAt: new Date('2026-01-01'),
        createdByMembershipId: membership.id,
      },
    });
    await transaction.document.update({
      where: { id: authorityDocument.id },
      data: { currentVersionId: authorityVersion.id },
    });
    for (const roleCode of ['employee', 'personnel_records_officer', 'hrmo_administrator']) {
      const role = await transaction.role.findFirstOrThrow({
        where: { agencyId: null, code: roleCode, status: 'ACTIVE' },
      });
      await transaction.membershipRole.create({
        data: {
          agencyId: agency.id,
          membershipId: membership.id,
          roleId: role.id,
          effectiveFrom: new Date('2026-01-01'),
        },
      });
    }
    const holidayCalendar = await transaction.holidayCalendar.create({
      data: {
        agencyId: agency.id,
        code: 'DTR-PH',
        name: 'DTR Philippine Holidays',
        scopeType: 'AGENCY',
        scopeReference: 'Agency-wide',
      },
    });
    const holidayVersion = await transaction.holidayCalendarVersion.create({
      data: {
        agencyId: agency.id,
        holidayCalendarId: holidayCalendar.id,
        versionNo: 1,
        authorityDocumentVersionId: authorityVersion.id,
        approvingAuthority: 'Office of the President',
        effectiveFrom: new Date('2026-01-01'),
        status: 'ACTIVE',
        activatedByMembershipId: membership.id,
        activatedAt: new Date('2026-01-01'),
      },
    });
    await transaction.holidayCalendar.update({
      where: { id: holidayCalendar.id },
      data: { currentVersionId: holidayVersion.id },
    });
    const schedule = await transaction.workSchedule.create({
      data: { agencyId: agency.id, code: 'DTR-ORDINARY', name: 'DTR Ordinary Work Schedule' },
    });
    const scheduleVersion = await transaction.workScheduleVersion.create({
      data: {
        agencyId: agency.id,
        workScheduleId: schedule.id,
        versionNo: 1,
        scheduleType: 'REGULAR',
        timezone: 'Asia/Manila',
        authorityDocumentVersionId: authorityVersion.id,
        approvingAuthority: 'Office of the President',
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-01-01'),
        activatedByMembershipId: membership.id,
        activatedAt: new Date('2026-01-01'),
      },
    });
    for (const weekday of [1, 2, 3, 4, 5]) {
      await transaction.workScheduleDayRule.create({
        data: {
          agencyId: agency.id,
          workScheduleVersionId: scheduleVersion.id,
          weekday,
          ruleType: 'FIXED',
          dutyStartTime: new Date(Date.UTC(1970, 0, 1, 8, 0)),
          dutyEndTime: new Date(Date.UTC(1970, 0, 1, 17, 0)),
          requiredMinutes: 480,
          eventPattern: 'IN_OUT',
          collectionBeforeMinutes: 0,
          collectionAfterMinutes: 0,
          breaks: {
            create: [
              {
                sequenceNo: 1,
                breakStartTime: new Date(Date.UTC(1970, 0, 1, 12, 0)),
                breakEndTime: new Date(Date.UTC(1970, 0, 1, 13, 0)),
              },
            ],
          },
        },
      });
    }
    for (const weekday of [6, 7]) {
      await transaction.workScheduleDayRule.create({
        data: {
          agencyId: agency.id,
          workScheduleVersionId: scheduleVersion.id,
          weekday,
          ruleType: 'REST',
          requiredMinutes: 0,
          eventPattern: 'IN_OUT',
          collectionBeforeMinutes: 0,
          collectionAfterMinutes: 0,
        },
      });
    }
    await transaction.workSchedule.update({
      where: { id: schedule.id },
      data: { currentVersionId: scheduleVersion.id },
    });
    const arrangement = await transaction.workArrangement.create({
      data: { agencyId: agency.id, code: 'DTR-ONSITE', name: 'DTR Onsite Work Arrangement' },
    });
    const arrangementVersion = await transaction.workArrangementVersion.create({
      data: {
        agencyId: agency.id,
        workArrangementId: arrangement.id,
        versionNo: 1,
        arrangementType: 'ONSITE',
        permittedScheduleTypes: ['REGULAR'],
        holidayCalendarId: holidayCalendar.id,
        authorityDocumentVersionId: authorityVersion.id,
        approvingAuthority: 'Office of the President',
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-01-01'),
        activatedByMembershipId: membership.id,
        activatedAt: new Date('2026-01-01'),
      },
    });
    await transaction.workArrangement.update({
      where: { id: arrangement.id },
      data: { currentVersionId: arrangementVersion.id },
    });
    const scheduleAssignment = await transaction.scheduleAssignment.create({
      data: {
        agencyId: agency.id,
        employeeId: employee.id,
        workScheduleVersionId: scheduleVersion.id,
        workArrangementVersionId: arrangementVersion.id,
        authorityDocumentVersionId: authorityVersion.id,
        effectiveFrom: new Date('2026-01-01'),
        assignedByMembershipId: membership.id,
      },
    });
    const eventIds: string[] = [];
    for (const [eventType, hour] of [
      ['TIME_IN', 8],
      ['BREAK_OUT', 12],
      ['BREAK_IN', 13],
      ['TIME_OUT', 16],
    ] as const) {
      const event = await transaction.attendanceEvent.create({
        data: {
          agencyId: agency.id,
          employeeId: employee.id,
          eventTime: new Date(`2026-01-05T${String(hour).padStart(2, '0')}:00:00+08:00`),
          eventType,
          source: 'MANUAL',
          enteredByMembershipId: membership.id,
          reason: 'Daily Time Record journey fixture.',
        },
      });
      eventIds.push(event.id);
    }
    const mondayRule = await transaction.workScheduleDayRule.findFirstOrThrow({
      where: { agencyId: agency.id, workScheduleVersionId: scheduleVersion.id, weekday: 1 },
    });
    const period = await transaction.attendancePeriod.create({
      data: {
        agencyId: agency.id,
        code: 'E2E-DTR-2026-01',
        dateFrom: new Date('2026-01-01'),
        dateTo: new Date('2026-01-31'),
        status: 'FINALIZED',
      },
    });
    const day = await transaction.attendanceDay.create({
      data: {
        agencyId: agency.id,
        attendancePeriodId: period.id,
        employeeId: employee.id,
        workDate: new Date('2026-01-05'),
        scheduleAssignmentId: scheduleAssignment.id,
        workScheduleVersionId: scheduleVersion.id,
        workArrangementVersionId: arrangementVersion.id,
        holidayCalendarVersionId: holidayVersion.id,
        dayClassification: 'SCHEDULED',
        status: 'APPROVED',
        expectedMinutes: 480,
        workedMinutes: 480,
        coverageMinutes: 480,
        calculationVersion: 1,
        ruleSnapshot: {
          fingerprint: 'e'.repeat(64),
          timezone: 'Asia/Manila',
          assignmentId: scheduleAssignment.id,
          workScheduleVersionId: scheduleVersion.id,
          workArrangementVersionId: arrangementVersion.id,
          holidayCalendarVersionId: holidayVersion.id,
          dayRuleId: mondayRule.id,
          holidayClassifications: {},
          eventIds,
          coverageSources: [],
          capturedAt: '2026-01-05T00:00:00.000Z',
        },
        isCurrent: true,
        calculatedAt: new Date('2026-01-05T09:00:00.000Z'),
      },
    });
    const submission = await transaction.employeeAttendanceSubmission.create({
      data: {
        agencyId: agency.id,
        attendancePeriodId: period.id,
        employeeId: employee.id,
        versionNo: 1,
        status: 'APPROVED',
        submittedByMembershipId: membership.id,
        submittedAt: new Date('2026-01-06T01:00:00.000Z'),
        reviewedByMembershipId: reviewerMembership.id,
        reviewedAt: new Date('2026-01-06T02:00:00.000Z'),
        reviewReason: 'Daily Time Record journey fixture.',
      },
    });
    await transaction.employeeAttendanceSubmissionDay.create({
      data: {
        agencyId: agency.id,
        employeeAttendanceSubmissionId: submission.id,
        attendanceDayId: day.id,
      },
    });
    const routeVersion = await transaction.approvalRouteVersion.create({
      data: {
        agencyId: agency.id,
        routeCode: 'DTR-PERIOD-LOCK',
        versionNo: 1,
        domain: 'ATTENDANCE',
        stepDefinition: {
          steps: [
            {
              stepNo: 1,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'attendance.periods.approve',
              assignment: { kind: 'MEMBERSHIP', membershipId: reviewerMembership.id },
              requiresSeparateReview: false,
            },
          ],
        },
        effectiveFrom: new Date('2026-01-01'),
        status: 'ACTIVE',
      },
    });
    const periodVersion = await transaction.attendancePeriodVersion.create({
      data: {
        agencyId: agency.id,
        attendancePeriodId: period.id,
        versionNo: 1,
        status: 'LOCKED',
        approvalRouteVersionId: routeVersion.id,
        submittedByMembershipId: membership.id,
        submittedAt: new Date('2026-01-06T02:00:00.000Z'),
        reviewedByMembershipId: reviewerMembership.id,
        reviewedAt: new Date('2026-01-06T03:00:00.000Z'),
        reviewReason: 'Daily Time Record journey fixture.',
        lockedByMembershipId: membership.id,
        lockedAt: new Date('2026-01-06T04:00:00.000Z'),
        reconciliation: { source: 'E2E_DTR_FIXTURE' },
      },
    });
    await transaction.attendancePeriodVersionDay.create({
      data: {
        agencyId: agency.id,
        attendancePeriodVersionId: periodVersion.id,
        employeeAttendanceSubmissionId: submission.id,
        attendanceDayId: day.id,
      },
    });
  });
}

async function seed(): Promise<void> {
  const agency = await prisma.agency.upsert({
    where: { code: 'E2E-WORK-QUEUE' },
    update: {
      name: 'National Archives Coordination Office',
      acronym: 'NACO',
      status: 'ACTIVE',
    },
    create: {
      code: 'E2E-WORK-QUEUE',
      name: 'National Archives Coordination Office',
      acronym: 'NACO',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  await resetProfile(agency);
  await prisma.invitation.deleteMany({
    where: { agencyId: agency.id, status: 'PENDING' },
  });
  const user = await prisma.user.upsert({
    where: { emailNormalized: 'marisol.santos@example.test' },
    update: {
      displayName: 'Marisol Santos',
      globalStatus: 'ACTIVE',
      lockedAt: null,
      lockedByAgencyId: null,
      emailVerifiedAt: new Date(),
    },
    create: {
      emailNormalized: 'marisol.santos@example.test',
      displayName: 'Marisol Santos',
      globalStatus: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const membership =
    (await prisma.agencyMembership.findFirst({
      where: { agencyId: agency.id, userId: user.id },
    })) ??
    (await prisma.agencyMembership.create({
      data: {
        agencyId: agency.id,
        userId: user.id,
        status: 'ACTIVE',
        activatedAt: new Date(),
      },
    }));
  if (membership.status !== 'ACTIVE') {
    await prisma.agencyMembership.update({
      where: { id: membership.id },
      data: { status: 'ACTIVE', activatedAt: new Date(), deactivatedAt: null },
    });
  }
  const preparerUser = await prisma.user.upsert({
    where: { emailNormalized: 'personnel.preparer@example.test' },
    update: {
      displayName: 'Personnel Preparer',
      globalStatus: 'ACTIVE',
      lockedAt: null,
      lockedByAgencyId: null,
    },
    create: {
      emailNormalized: 'personnel.preparer@example.test',
      displayName: 'Personnel Preparer',
      globalStatus: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const preparerMembership =
    (await prisma.agencyMembership.findFirst({
      where: { agencyId: agency.id, userId: preparerUser.id },
    })) ??
    (await prisma.agencyMembership.create({
      data: {
        agencyId: agency.id,
        userId: preparerUser.id,
        status: 'ACTIVE',
        activatedAt: new Date(),
      },
    }));
  const enrollmentUser = await prisma.user.upsert({
    where: { emailNormalized: enrollmentCandidateEmail },
    update: {
      displayName: 'Enrollment Candidate',
      globalStatus: 'ACTIVE',
      lockedAt: null,
      lockedByAgencyId: null,
    },
    create: {
      emailNormalized: enrollmentCandidateEmail,
      displayName: 'Enrollment Candidate',
      globalStatus: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const enrollmentMembership =
    (await prisma.agencyMembership.findFirst({
      where: { agencyId: agency.id, userId: enrollmentUser.id },
    })) ??
    (await prisma.agencyMembership.create({
      data: {
        agencyId: agency.id,
        userId: enrollmentUser.id,
        status: 'ACTIVE',
        activatedAt: new Date(),
      },
    }));
  const securityAdministrator = await prisma.role.findFirstOrThrow({
    where: { agencyId: null, code: 'security_administrator', status: 'ACTIVE' },
  });
  if (
    !(await prisma.membershipRole.findFirst({
      where: { membershipId: enrollmentMembership.id, roleId: securityAdministrator.id },
    }))
  ) {
    await prisma.membershipRole.create({
      data: {
        agencyId: agency.id,
        membershipId: enrollmentMembership.id,
        roleId: securityAdministrator.id,
        effectiveFrom: new Date('2026-01-01'),
        assignedByMembershipId: membership.id,
        reason: 'Forced enrollment E2E fixture',
      },
    });
  }

  for (const fixture of [
    {
      email: securityOfficerEmail,
      displayName: 'Security Officer',
      role: 'security_administrator',
    },
    {
      email: factorResetCandidateEmail,
      displayName: 'Factor Reset Candidate',
      role: 'hrmo_administrator',
    },
    {
      email: userLockCandidateEmail,
      displayName: 'User Lock Candidate',
      role: 'hrmo_administrator',
    },
  ]) {
    const fixtureUser = await prisma.user.upsert({
      where: { emailNormalized: fixture.email },
      update: {
        displayName: fixture.displayName,
        globalStatus: 'ACTIVE',
        lockedAt: null,
        lockedByAgencyId: null,
      },
      create: {
        emailNormalized: fixture.email,
        displayName: fixture.displayName,
        globalStatus: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    const fixtureMembership =
      (await prisma.agencyMembership.findFirst({
        where: { agencyId: agency.id, userId: fixtureUser.id },
      })) ??
      (await prisma.agencyMembership.create({
        data: {
          agencyId: agency.id,
          userId: fixtureUser.id,
          status: 'ACTIVE',
          activatedAt: new Date(),
        },
      }));
    const role = await prisma.role.findFirstOrThrow({
      where: { agencyId: null, code: fixture.role, status: 'ACTIVE' },
    });
    if (
      !(await prisma.membershipRole.findFirst({
        where: { membershipId: fixtureMembership.id, roleId: role.id },
      }))
    ) {
      await prisma.membershipRole.create({
        data: {
          agencyId: agency.id,
          membershipId: fixtureMembership.id,
          roleId: role.id,
          effectiveFrom: new Date('2026-01-01'),
          assignedByMembershipId: membership.id,
          reason: 'Factor Reset E2E fixture',
        },
      });
    }
  }

  async function seedInvitation(email: string, token: string, roleCodes: string[]) {
    const invitee = await prisma.user.upsert({
      where: { emailNormalized: email },
      update: { globalStatus: 'ACTIVE', lockedAt: null, lockedByAgencyId: null },
      create: {
        emailNormalized: email,
        displayName: email === phase5OwnerEmail ? 'Phase5 Owner' : 'Phase5 Restricted',
        globalStatus: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    const inviteeMembership =
      (await prisma.agencyMembership.findFirst({
        where: { agencyId: agency.id, userId: invitee.id },
      })) ??
      (await prisma.agencyMembership.create({
        data: { agencyId: agency.id, userId: invitee.id, status: 'INVITED' },
      }));
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.userSession.deleteMany({
        where: { agencyMembershipId: inviteeMembership.id },
      });
      await transaction.membershipRole.deleteMany({
        where: { membershipId: inviteeMembership.id },
      });
      await transaction.invitation.deleteMany({
        where: { agencyId: agency.id, emailNormalized: email },
      });
      await transaction.agencyMembership.update({
        where: { id: inviteeMembership.id },
        data: { employeeId: null, status: 'INVITED', activatedAt: null },
      });
      if (seedPhase5Access)
        await transaction.invitation.create({
          data: {
            agencyId: agency.id,
            emailNormalized: email,
            invitedByMembershipId: membership.id,
            tokenHash: createHash('sha256').update(token).digest(),
            requestedRoleCodes: roleCodes,
            expiresAt: new Date('2099-01-01'),
            status: 'PENDING',
          },
        });
    });
  }

  await seedInvitation(phase5OwnerEmail, phase5OwnerToken, [
    'employee',
    'personnel_records_officer',
  ]);
  await seedInvitation(phase5RestrictedEmail, phase5RestrictedToken, ['employee']);
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.payrollMonetizationAdjustmentOutcome.deleteMany({
      where: { agencyId: agency.id },
    });
    await transaction.payrollMonetizationEarningInput.deleteMany({
      where: { agencyId: agency.id },
    });
    await transaction.monetizationAdjustmentLine.deleteMany({ where: { agencyId: agency.id } });
    await transaction.monetizationAdjustment.deleteMany({ where: { agencyId: agency.id } });
    await transaction.monetizationCreditCertificationLine.deleteMany({
      where: { agencyId: agency.id },
    });
    await transaction.monetizationCreditCertification.deleteMany({
      where: { agencyId: agency.id },
    });
    await transaction.monetizationFundingDetermination.deleteMany({
      where: { agencyId: agency.id },
    });
    await transaction.monetizationEligibilityAssessment.deleteMany({
      where: { agencyId: agency.id },
    });
    await transaction.leaveMonetizationAllocation.deleteMany({ where: { agencyId: agency.id } });
    await transaction.monetizationPosting.deleteMany({ where: { agencyId: agency.id } });
    await transaction.leaveMonetizationRequestVersion.deleteMany({
      where: { agencyId: agency.id },
    });
    await transaction.leaveMonetizationRequest.deleteMany({ where: { agencyId: agency.id } });
    await transaction.auditEvent.deleteMany({ where: { agencyId: agency.id } });
    await transaction.leaveCalculationSegment.deleteMany({ where: { agencyId: agency.id } });
    await transaction.leaveEligibilityAssessment.deleteMany({ where: { agencyId: agency.id } });
    await transaction.leaveApplicationVersionDocument.deleteMany({
      where: { agencyId: agency.id },
    });
    await transaction.leaveApplicationPeriod.deleteMany({ where: { agencyId: agency.id } });
    await transaction.leaveApplicationVersion.deleteMany({ where: { agencyId: agency.id } });
    await transaction.leaveApplicationDraftDocument.deleteMany({ where: { agencyId: agency.id } });
    await transaction.leaveApplicationDraftPeriod.deleteMany({ where: { agencyId: agency.id } });
    await transaction.leaveApplication.deleteMany({ where: { agencyId: agency.id } });
    await transaction.approvalDecision.deleteMany({ where: { agencyId: agency.id } });
    await transaction.approvalStep.deleteMany({ where: { agencyId: agency.id } });
    await transaction.approvalRequest.deleteMany({ where: { agencyId: agency.id } });
    await transaction.approvalRouteVersion.deleteMany({ where: { agencyId: agency.id } });
    await transaction.appointment.updateMany({
      where: { agencyId: agency.id },
      data: { currentVersionId: null },
    });
    await transaction.appointmentDocumentVersionLink.deleteMany({ where: { agencyId: agency.id } });
    await transaction.appointmentVersion.deleteMany({ where: { agencyId: agency.id } });
    await transaction.appointment.deleteMany({ where: { agencyId: agency.id } });
    await transaction.appointmentAgencySettings.deleteMany({ where: { agencyId: agency.id } });
    await transaction.recruitmentAppointmentHandoff.deleteMany({ where: { agencyId: agency.id } });
    await transaction.selectionDecision.deleteMany({ where: { agencyId: agency.id } });
    await transaction.candidateEvaluationReportVersion.deleteMany({
      where: { agencyId: agency.id },
    });
    await transaction.boardRecommendation.deleteMany({ where: { agencyId: agency.id } });
    await transaction.applicantQuorumSnapshot.deleteMany({ where: { agencyId: agency.id } });
    await transaction.conflictDeclaration.deleteMany({ where: { agencyId: agency.id } });
    await transaction.boardMemberParticipation.deleteMany({ where: { agencyId: agency.id } });
    await transaction.boardRosterSnapshotMember.deleteMany({ where: { agencyId: agency.id } });
    await transaction.selectionBoardSession.deleteMany({ where: { agencyId: agency.id } });
    await transaction.assessmentResultVersion.deleteMany({ where: { agencyId: agency.id } });
    await transaction.assessment.deleteMany({ where: { agencyId: agency.id } });
    await transaction.interviewFeedbackVersion.deleteMany({ where: { agencyId: agency.id } });
    await transaction.interview.deleteMany({ where: { agencyId: agency.id } });
    await transaction.applicationScreeningEvidence.deleteMany({ where: { agencyId: agency.id } });
    await transaction.applicationScreening.deleteMany({ where: { agencyId: agency.id } });
    await transaction.applicationDocument.deleteMany({ where: { agencyId: agency.id } });
    await transaction.application.deleteMany({ where: { agencyId: agency.id } });
    await transaction.applicant.deleteMany({ where: { agencyId: agency.id } });
    await transaction.vacancyPublicationEvidence.deleteMany({ where: { agencyId: agency.id } });
    await transaction.vacancyPublication.deleteMany({ where: { agencyId: agency.id } });
    await transaction.requestMspRebaseline.deleteMany({ where: { agencyId: agency.id } });
    await transaction.requestApprovalRouteBinding.deleteMany({ where: { agencyId: agency.id } });
    await transaction.requestToFill.deleteMany({ where: { agencyId: agency.id } });
    await transaction.boardAppointment.deleteMany({ where: { agencyId: agency.id } });
    await transaction.boardDefinition.deleteMany({ where: { agencyId: agency.id } });
    await transaction.meritSelectionCriteriaSet.deleteMany({ where: { agencyId: agency.id } });
    await transaction.agencyMeritSelectionPlanVersion.deleteMany({
      where: { agencyId: agency.id },
    });
    await transaction.serviceRecordSnapshot.deleteMany({ where: { agencyId: agency.id } });
    await transaction.lockedAttendanceAdjustmentPeriod.deleteMany({
      where: { agencyId: agency.id },
    });
    await transaction.lockedAttendanceAdjustment.deleteMany({ where: { agencyId: agency.id } });
    await transaction.dtrDocument.deleteMany({ where: { agencyId: agency.id } });
    await transaction.attendanceCorrectionEffect.deleteMany({ where: { agencyId: agency.id } });
    await transaction.attendanceCorrectionEvidence.deleteMany({ where: { agencyId: agency.id } });
    await transaction.attendanceCorrection.deleteMany({ where: { agencyId: agency.id } });
    await transaction.attendancePeriodVersionDay.deleteMany({ where: { agencyId: agency.id } });
    await transaction.attendancePeriodVersion.deleteMany({ where: { agencyId: agency.id } });
    await transaction.employeeAttendanceSubmissionDay.deleteMany({
      where: { agencyId: agency.id },
    });
    await transaction.employeeAttendanceSubmission.deleteMany({ where: { agencyId: agency.id } });
    await transaction.attendanceException.deleteMany({ where: { agencyId: agency.id } });
    await transaction.attendanceDaySegment.deleteMany({ where: { agencyId: agency.id } });
    await transaction.attendanceDay.deleteMany({ where: { agencyId: agency.id } });
    await transaction.attendancePeriod.deleteMany({ where: { agencyId: agency.id } });
    await transaction.attendanceEvent.deleteMany({ where: { agencyId: agency.id } });
    await transaction.attendanceWebClockVersion.deleteMany({ where: { agencyId: agency.id } });
    await transaction.outboxEvent.deleteMany({ where: { agencyId: agency.id } });
    await transaction.separationEffect.deleteMany({ where: { agencyId: agency.id } });
    await transaction.separationCase.deleteMany({ where: { agencyId: agency.id } });
    await transaction.personnelActionEvidence.deleteMany({ where: { agencyId: agency.id } });
    await transaction.personnelAction.updateMany({
      where: { agencyId: agency.id },
      data: { currentVersionId: null },
    });
    await transaction.personnelActionVersion.deleteMany({ where: { agencyId: agency.id } });
    await transaction.personnelAction.deleteMany({ where: { agencyId: agency.id } });
    await transaction.personnelBaseline.deleteMany({ where: { agencyId: agency.id } });
    await transaction.positionIncumbency.deleteMany({ where: { agencyId: agency.id } });
    await transaction.employee.updateMany({
      where: { agencyId: agency.id },
      data: { currentServiceSegmentId: null },
    });
    await transaction.serviceSegment.deleteMany({ where: { agencyId: agency.id } });
    await transaction.attendanceContext.deleteMany({ where: { agencyId: agency.id } });
    await transaction.scheduleAssignment.deleteMany({ where: { agencyId: agency.id } });
    await transaction.positionDocument.deleteMany({ where: { agencyId: agency.id } });
    await transaction.plantillaPosition.updateMany({
      where: { agencyId: agency.id },
      data: { currentVersionId: null },
    });
    await transaction.plantillaPositionVersion.deleteMany({ where: { agencyId: agency.id } });
    await transaction.plantillaPosition.deleteMany({ where: { agencyId: agency.id } });
    await transaction.governmentIdentifier.deleteMany({ where: { agencyId: agency.id } });
    await transaction.payrollBankAccount.deleteMany({ where: { agencyId: agency.id } });
    await transaction.salnComplianceRecord.deleteMany({ where: { agencyId: agency.id } });
    await transaction.employeeDocument.deleteMany({ where: { agencyId: agency.id } });
    await transaction.pdsOutputArtifact.deleteMany({ where: { agencyId: agency.id } });
    await transaction.pdsWesEntry.deleteMany({ where: { agencyId: agency.id } });
    await transaction.pdsWesArtifact.deleteMany({ where: { agencyId: agency.id } });
    await transaction.pdsTransitionEvent.deleteMany({ where: { agencyId: agency.id } });
    await transaction.pdsPageSignature.deleteMany({ where: { agencyId: agency.id } });
    await transaction.pdsCertificationDetails.deleteMany({ where: { agencyId: agency.id } });
    await transaction.pdsReferenceRecord.deleteMany({ where: { agencyId: agency.id } });
    await transaction.pdsDeclarationDetails.deleteMany({ where: { agencyId: agency.id } });
    await transaction.pdsOtherInformation.deleteMany({ where: { agencyId: agency.id } });
    await transaction.pdsLearningDevelopmentRecord.deleteMany({ where: { agencyId: agency.id } });
    await transaction.pdsVoluntaryWorkRecord.deleteMany({ where: { agencyId: agency.id } });
    await transaction.pdsWorkExperienceRecord.deleteMany({ where: { agencyId: agency.id } });
    await transaction.pdsEligibilityRecord.deleteMany({ where: { agencyId: agency.id } });
    await transaction.pdsEducationRecord.deleteMany({ where: { agencyId: agency.id } });
    await transaction.pdsFamilyRecord.deleteMany({ where: { agencyId: agency.id } });
    await transaction.pdsPersonalDetails.deleteMany({ where: { agencyId: agency.id } });
    await transaction.pdsVersion.deleteMany({ where: { agencyId: agency.id } });
    await transaction.agencyMembership.updateMany({
      where: { agencyId: agency.id },
      data: { employeeId: null },
    });
    await transaction.employee.deleteMany({ where: { agencyId: agency.id } });
    await transaction.staffingAuthority.deleteMany({ where: { agencyId: agency.id } });
    await transaction.organizationUnitVersion.deleteMany({ where: { agencyId: agency.id } });
    await transaction.organizationUnit.deleteMany({ where: { agencyId: agency.id } });
    await transaction.workScheduleBreakInterval.deleteMany({ where: { agencyId: agency.id } });
    await transaction.workScheduleDayRule.deleteMany({ where: { agencyId: agency.id } });
    await transaction.workSchedule.updateMany({
      where: { agencyId: agency.id },
      data: { currentVersionId: null },
    });
    await transaction.workScheduleVersion.deleteMany({ where: { agencyId: agency.id } });
    await transaction.workSchedule.deleteMany({ where: { agencyId: agency.id } });
    await transaction.workArrangement.updateMany({
      where: { agencyId: agency.id },
      data: { currentVersionId: null },
    });
    await transaction.workArrangementVersion.deleteMany({ where: { agencyId: agency.id } });
    await transaction.workArrangement.deleteMany({ where: { agencyId: agency.id } });
    await transaction.holidayCalendarEntry.deleteMany({ where: { agencyId: agency.id } });
    await transaction.holidayCalendarVersion.deleteMany({ where: { agencyId: agency.id } });
    await transaction.holidayCalendar.deleteMany({ where: { agencyId: agency.id } });
    await transaction.qualificationStandard.updateMany({
      where: { agencyId: agency.id },
      data: { currentVersionId: null },
    });
    await transaction.qualificationStandardVersion.deleteMany({ where: { agencyId: agency.id } });
    await transaction.qualificationStandard.deleteMany({ where: { agencyId: agency.id } });
    await transaction.leaveType.updateMany({
      where: { agencyId: agency.id },
      data: { currentPolicyVersionId: null },
    });
    await transaction.leaveLedgerAdjustment.deleteMany({ where: { agencyId: agency.id } });
    await transaction.leaveLedgerEntry.deleteMany({ where: { agencyId: agency.id } });
    await transaction.leaveCreditCommitment.deleteMany({ where: { agencyId: agency.id } });
    await transaction.leaveAccountOpening.deleteMany({ where: { agencyId: agency.id } });
    await transaction.leaveAccount.deleteMany({ where: { agencyId: agency.id } });
    await transaction.leavePolicyAuthority.deleteMany({ where: { agencyId: agency.id } });
    await transaction.leavePolicyVersion.deleteMany({ where: { agencyId: agency.id } });
    await transaction.leaveType.deleteMany({ where: { agencyId: agency.id } });
    await transaction.documentVersion.deleteMany({
      where: { agencyId: agency.id, document: { documentNo: { startsWith: 'P5-PDS-' } } },
    });
    await transaction.document.deleteMany({
      where: { agencyId: agency.id, documentNo: { startsWith: 'P5-PDS-' } },
    });
    await transaction.documentVersion.deleteMany({
      where: {
        agencyId: agency.id,
        document: {
          documentNo: {
            in: [
              'E2E-PLANTILLA-QS-SOURCE',
              'E2E-PLANTILLA-QS-APPROVAL',
              'E2E-PLANTILLA-AUTHORITY',
              'E2E-ACTION-NOSI',
              'E2E-ACTION-CURRENT_COMPENSATION',
              'E2E-ACTION-PERFORMANCE_OR_SERVICE',
              'E2E-ACTION-SERVICE_CONTINUITY',
              'E2E-PDS-EVIDENCE',
              'E2E-CS-FORM-9',
              'E2E-CSC-FIELD-OFFICE-POSTING',
              'E2E-CSC-JOB-PORTAL-POSTING',
              'E2E-AGENCY-POSTING-1',
              'E2E-AGENCY-POSTING-2',
              'E2E-AGENCY-POSTING-3',
              'E2E-APPLICANT-EDUCATION',
              'E2E-APPLICANT-ELIGIBILITY',
              'E2E-APPT-PDS',
              'E2E-APPT-WES',
              'E2E-APPT-ELIGIBILITY',
              'E2E-APPT-POSITION-DESC',
              'E2E-APPT-SELECTION-CERT',
              'E2E-APPT-PUBLICATION-CERT',
              'E2E-APPT-AUTHORITY',
              'E2E-ORDINARY-SCHEDULE-AUTHORITY',
              'E2E-HOLIDAY-CALENDAR-AUTHORITY',
              'E2E-ONSITE-ARRANGEMENT-AUTHORITY',
              'E2E-SCHEDULE-ASSIGNMENT-AUTHORITY',
              'E2E-MOVE-AUTHORITY',
              'E2E-LEAVE-NATIONAL-RULE',
              'E2E-LEAVE-AGENCY-CONFIG',
            ],
          },
        },
      },
    });
    await transaction.document.deleteMany({
      where: {
        agencyId: agency.id,
        documentNo: {
          in: [
            'E2E-PLANTILLA-QS-SOURCE',
            'E2E-PLANTILLA-QS-APPROVAL',
            'E2E-PLANTILLA-AUTHORITY',
            'E2E-ACTION-NOSI',
            'E2E-ACTION-CURRENT_COMPENSATION',
            'E2E-ACTION-PERFORMANCE_OR_SERVICE',
            'E2E-ACTION-SERVICE_CONTINUITY',
            'E2E-PDS-EVIDENCE',
            'E2E-CS-FORM-9',
            'E2E-CSC-FIELD-OFFICE-POSTING',
            'E2E-CSC-JOB-PORTAL-POSTING',
            'E2E-AGENCY-POSTING-1',
            'E2E-AGENCY-POSTING-2',
            'E2E-AGENCY-POSTING-3',
            'E2E-APPLICANT-EDUCATION',
            'E2E-APPLICANT-ELIGIBILITY',
            'E2E-APPT-PDS',
            'E2E-APPT-WES',
            'E2E-APPT-ELIGIBILITY',
            'E2E-APPT-POSITION-DESC',
            'E2E-APPT-SELECTION-CERT',
            'E2E-APPT-PUBLICATION-CERT',
            'E2E-APPT-AUTHORITY',
            'E2E-ORDINARY-SCHEDULE-AUTHORITY',
            'E2E-HOLIDAY-CALENDAR-AUTHORITY',
            'E2E-ONSITE-ARRANGEMENT-AUTHORITY',
            'E2E-SCHEDULE-ASSIGNMENT-AUTHORITY',
            'E2E-MOVE-AUTHORITY',
            'E2E-LEAVE-NATIONAL-RULE',
            'E2E-LEAVE-AGENCY-CONFIG',
          ],
        },
      },
    });

    const unit = await transaction.organizationUnit.create({
      data: {
        agencyId: agency.id,
        code: 'HRM-DIV',
        unitType: 'DIVISION',
        status: 'ACTIVE',
      },
    });
    const unitVersion = await transaction.organizationUnitVersion.create({
      data: {
        agencyId: agency.id,
        organizationUnitId: unit.id,
        versionNo: 1,
        name: 'Human Resource Management Division',
        effectiveFrom: new Date('2026-01-01'),
        status: 'ACTIVE',
        domainStatus: 'ACTIVE',
      },
    });
    await transaction.organizationUnit.update({
      where: { id: unit.id },
      data: { currentVersionId: unitVersion.id },
    });

    async function evidence(documentNo: string, documentType: string, id?: string) {
      const document = await transaction.document.create({
        data: {
          id,
          agencyId: agency.id,
          documentNo,
          documentType,
          classification: 'CONFIDENTIAL',
          status: 'DRAFT',
          createdByMembershipId: membership.id,
        },
      });
      const version = await transaction.documentVersion.create({
        data: {
          agencyId: agency.id,
          documentId: document.id,
          versionNo: 1,
          storageKey: `e2e/${documentNo}`,
          contentHash: 'a'.repeat(64),
          mimeType: 'application/pdf',
          sizeBytes: 1,
          createdByMembershipId: membership.id,
          issuedAt: new Date('2026-01-01'),
        },
      });
      return transaction.document.update({
        where: { id: document.id },
        data: { currentVersionId: version.id, status: 'APPROVED' },
        select: { id: true, currentVersionId: true },
      });
    }

    const sourceEvidence = await evidence('E2E-PLANTILLA-QS-SOURCE', 'QUALIFICATION_STANDARD');
    const approvalEvidence = await evidence('E2E-PLANTILLA-QS-APPROVAL', 'QUALIFICATION_STANDARD');
    const authorityEvidence = await evidence('E2E-PLANTILLA-AUTHORITY', 'STAFFING_AUTHORITY');
    await evidence('E2E-LEAVE-NATIONAL-RULE', 'LEAVE_POLICY', leaveNationalRuleDocumentId);
    await evidence('E2E-LEAVE-AGENCY-CONFIG', 'LEAVE_POLICY', leaveAgencyConfigurationDocumentId);
    await evidence('E2E-PDS-EVIDENCE', 'PDS');
    const standard = await transaction.qualificationStandard.create({
      data: {
        agencyId: agency.id,
        code: 'QS-HRM-E2E',
        name: 'Human Resource Management',
        status: 'ACTIVE',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const standardVersion = await transaction.qualificationStandardVersion.create({
      data: {
        agencyId: agency.id,
        qualificationStandardId: standard.id,
        versionNo: 1,
        educationRequirement: 'Bachelor degree',
        eligibilityRequirement: 'Career service',
        sourceDocumentId: sourceEvidence.id,
        sourceEvidenceVersionId: sourceEvidence.currentVersionId!,
        sourceEvidenceValidatedAt: new Date('2026-01-02'),
        sourceEvidenceValidatedByMembershipId: membership.id,
        sourceEvidenceValidationReason: 'Protected shell fixture source reviewed.',
        approvalDocumentId: approvalEvidence.id,
        approvalEvidenceVersionId: approvalEvidence.currentVersionId!,
        approvalEvidenceValidatedAt: new Date('2026-01-02'),
        approvalEvidenceValidatedByMembershipId: membership.id,
        approvalEvidenceValidationReason: 'Protected shell fixture approval reviewed.',
        effectiveFrom: new Date('2026-01-01'),
        status: 'ACTIVE',
        domainStatus: 'ACTIVE',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    await transaction.qualificationStandard.update({
      where: { id: standard.id },
      data: { currentVersionId: standardVersion.id },
    });
    const authority = await transaction.staffingAuthority.create({
      data: {
        agencyId: agency.id,
        authorityType: 'DBM_APPROVAL',
        referenceNo: 'E2E-NOSCA-2026-001',
        issuedDate: new Date('2025-12-01'),
        effectiveDate: new Date('2026-01-01'),
        documentId: authorityEvidence.id,
        evidenceVersionId: authorityEvidence.currentVersionId!,
        evidenceValidatedAt: new Date('2026-01-02'),
        evidenceValidatedByMembershipId: membership.id,
        evidenceValidationReason: 'Protected shell fixture authority reviewed.',
        status: 'ACTIVE',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const scheduleEvidence = await evidence(
      'E2E-ORDINARY-SCHEDULE-AUTHORITY',
      'WORK_SCHEDULE_AUTHORITY',
    );
    const holidayCalendar = await transaction.holidayCalendar.create({
      data: {
        agencyId: agency.id,
        code: 'PH-NATIONAL',
        name: 'Philippine National Holidays',
        scopeType: 'AGENCY',
        scopeReference: 'Agency-wide',
      },
    });
    const holidayEvidence = await evidence(
      'E2E-HOLIDAY-CALENDAR-AUTHORITY',
      'HOLIDAY_CALENDAR_AUTHORITY',
    );
    const holidayVersion = await transaction.holidayCalendarVersion.create({
      data: {
        agencyId: agency.id,
        holidayCalendarId: holidayCalendar.id,
        versionNo: 1,
        authorityDocumentVersionId: holidayEvidence.currentVersionId!,
        approvingAuthority: 'Office of the President',
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-01-01'),
        activatedByMembershipId: membership.id,
        activatedAt: new Date('2026-01-01'),
      },
    });
    await transaction.holidayCalendarEntry.createMany({
      data: [
        {
          agencyId: agency.id,
          holidayCalendarVersionId: holidayVersion.id,
          holidayDate: new Date('2026-01-01'),
          name: "New Year's Day",
          dayType: 'REGULAR_HOLIDAY',
          sourceReference: 'E2E Proclamation Fixture',
        },
        {
          agencyId: agency.id,
          holidayCalendarVersionId: holidayVersion.id,
          holidayDate: new Date('2026-04-09'),
          name: 'Araw ng Kagitingan',
          dayType: 'REGULAR_HOLIDAY',
          sourceReference: 'E2E Proclamation Fixture',
        },
        {
          agencyId: agency.id,
          holidayCalendarVersionId: holidayVersion.id,
          holidayDate: new Date('2026-11-01'),
          name: "All Saints' Day",
          dayType: 'SPECIAL_NON_WORKING',
          sourceReference: 'E2E Proclamation Fixture',
        },
        {
          agencyId: agency.id,
          holidayCalendarVersionId: holidayVersion.id,
          holidayDate: new Date('2026-12-25'),
          name: 'Christmas Day',
          dayType: 'REGULAR_HOLIDAY',
          sourceReference: 'E2E Proclamation Fixture',
        },
      ],
    });
    await transaction.holidayCalendar.update({
      where: { id: holidayCalendar.id },
      data: { currentVersionId: holidayVersion.id },
    });
    const ordinarySchedule = await transaction.workSchedule.create({
      data: { agencyId: agency.id, code: 'ORDINARY', name: 'Ordinary Work Schedule' },
    });
    const ordinaryVersion = await transaction.workScheduleVersion.create({
      data: {
        agencyId: agency.id,
        workScheduleId: ordinarySchedule.id,
        versionNo: 1,
        scheduleType: 'REGULAR',
        timezone: 'Asia/Manila',
        authorityDocumentVersionId: scheduleEvidence.currentVersionId!,
        approvingAuthority: 'Office of the President',
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-01-01'),
        activatedByMembershipId: membership.id,
        activatedAt: new Date('2026-01-01'),
      },
    });
    for (const weekday of [1, 2, 3, 4, 5]) {
      await transaction.workScheduleDayRule.create({
        data: {
          agencyId: agency.id,
          workScheduleVersionId: ordinaryVersion.id,
          weekday,
          ruleType: 'FIXED',
          dutyStartTime: new Date(Date.UTC(1970, 0, 1, 8, 0)),
          dutyEndTime: new Date(Date.UTC(1970, 0, 1, 17, 0)),
          requiredMinutes: 480,
          eventPattern: 'IN_OUT',
          collectionBeforeMinutes: 0,
          collectionAfterMinutes: 0,
          breaks: {
            create: [
              {
                sequenceNo: 1,
                breakStartTime: new Date(Date.UTC(1970, 0, 1, 12, 0)),
                breakEndTime: new Date(Date.UTC(1970, 0, 1, 13, 0)),
              },
            ],
          },
        },
      });
    }
    for (const weekday of [6, 7]) {
      await transaction.workScheduleDayRule.create({
        data: {
          agencyId: agency.id,
          workScheduleVersionId: ordinaryVersion.id,
          weekday,
          ruleType: 'REST',
          requiredMinutes: 0,
          eventPattern: 'IN_OUT',
          collectionBeforeMinutes: 0,
          collectionAfterMinutes: 0,
        },
      });
    }
    await transaction.workSchedule.update({
      where: { id: ordinarySchedule.id },
      data: { currentVersionId: ordinaryVersion.id },
    });
    const arrangementEvidence = await evidence(
      'E2E-ONSITE-ARRANGEMENT-AUTHORITY',
      'WORK_ARRANGEMENT_AUTHORITY',
    );
    const ordinaryArrangement = await transaction.workArrangement.create({
      data: { agencyId: agency.id, code: 'ONSITE', name: 'Onsite Work Arrangement' },
    });
    const ordinaryArrangementVersion = await transaction.workArrangementVersion.create({
      data: {
        agencyId: agency.id,
        workArrangementId: ordinaryArrangement.id,
        versionNo: 1,
        arrangementType: 'ONSITE',
        permittedScheduleTypes: ['REGULAR'],
        holidayCalendarId: holidayCalendar.id,
        authorityDocumentVersionId: arrangementEvidence.currentVersionId!,
        approvingAuthority: 'Office of the President',
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-01-01'),
        activatedByMembershipId: membership.id,
        activatedAt: new Date('2026-01-01'),
      },
    });
    await transaction.workArrangement.update({
      where: { id: ordinaryArrangement.id },
      data: { currentVersionId: ordinaryArrangementVersion.id },
    });
    const formNo9Evidence = await evidence('E2E-CS-FORM-9', 'CS_FORM_NO_9');
    const fieldOfficePosting = await evidence('E2E-CSC-FIELD-OFFICE-POSTING', 'VACANCY_POSTING');
    const jobPortalPosting = await evidence('E2E-CSC-JOB-PORTAL-POSTING', 'VACANCY_POSTING');
    const agencyPostingOne = await evidence('E2E-AGENCY-POSTING-1', 'VACANCY_POSTING');
    const agencyPostingTwo = await evidence('E2E-AGENCY-POSTING-2', 'VACANCY_POSTING');
    const agencyPostingThree = await evidence('E2E-AGENCY-POSTING-3', 'VACANCY_POSTING');
    const applicantEducation = await evidence('E2E-APPLICANT-EDUCATION', 'TRANSCRIPT_OF_RECORDS');
    const applicantEligibility = await evidence(
      'E2E-APPLICANT-ELIGIBILITY',
      'CERTIFICATE_OF_ELIGIBILITY',
    );
    const meritPlan = await transaction.agencyMeritSelectionPlanVersion.create({
      data: {
        agencyId: agency.id,
        planCode: 'E2E-MSP-2026',
        versionNo: 1,
        applicability: {},
        effectiveFrom: new Date('2026-01-01'),
        approvalDocumentVersionId: authorityEvidence.currentVersionId,
        status: 'ACTIVE',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const criteriaSet = await transaction.meritSelectionCriteriaSet.create({
      data: {
        agencyId: agency.id,
        planVersionId: meritPlan.id,
        criteriaCode: 'E2E-MSP-CRITERIA',
        applicability: {},
        criteriaDefinition: {
          stages: [
            {
              stageCode: 'WRITTEN_EXAM',
              stageType: 'ASSESSMENT',
              label: 'Written examination',
              criteria: [
                {
                  criterionCode: 'JOB_KNOWLEDGE',
                  label: 'Job knowledge',
                  criterionType: 'NUMERIC',
                  weight: 70,
                  minimumScore: 0,
                  maximumScore: 100,
                  passingScore: 70,
                  evidenceRequired: false,
                  commentsRequired: false,
                  evaluatorRoleCodes: ['hrmo_administrator', 'recruitment_officer'],
                },
                {
                  criterionCode: 'DOCUMENTATION',
                  label: 'Documentation quality',
                  criterionType: 'RATING_SCALE',
                  weight: 30,
                  ratingScale: [
                    { code: 'LOW', label: 'Low', value: 0 },
                    { code: 'SATISFACTORY', label: 'Satisfactory', value: 50 },
                    { code: 'HIGH', label: 'High', value: 100 },
                  ],
                  passingScore: 50,
                  evidenceRequired: true,
                  commentsRequired: false,
                  evaluatorRoleCodes: ['hrmo_administrator', 'recruitment_officer'],
                },
              ],
              aggregation: {
                method: 'WEIGHTED_AVERAGE',
                evaluatorMethod: 'MEAN',
                rounding: { mode: 'HALF_UP', decimals: 2 },
                passingScore: 70,
                tieBreakers: ['JOB_KNOWLEDGE'],
              },
            },
            {
              stageCode: 'PANEL_INTERVIEW',
              stageType: 'INTERVIEW',
              label: 'Panel interview',
              feedback: {
                minimumScore: 0,
                maximumScore: 100,
                passingScore: 70,
                evidenceRequired: false,
                commentsRequired: true,
                evaluatorRoleCodes: ['hrmo_administrator', 'recruitment_officer'],
              },
              aggregation: {
                evaluatorMethod: 'MEAN',
                rounding: { mode: 'HALF_UP', decimals: 2 },
                passingScore: 70,
              },
            },
          ],
        },
        status: 'ACTIVE',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const board = await transaction.boardDefinition.create({
      data: {
        agencyId: agency.id,
        planVersionId: meritPlan.id,
        boardCode: 'E2E-HRMPSB',
        versionNo: 1,
        applicability: {},
        seatDefinition: { seats: [{ seatCode: 'HRMO', required: true }] },
        quorumDefinition: { minimum: 1 },
        status: 'ACTIVE',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    await transaction.boardAppointment.create({
      data: {
        agencyId: agency.id,
        boardDefinitionId: board.id,
        seatCode: 'HRMO',
        membershipId: membership.id,
        appointmentKind: 'REGULAR',
        effectiveFrom: new Date('2026-01-01'),
        authorityDocumentVersionId: authorityEvidence.currentVersionId,
        status: 'ACTIVE',
        createdByMembershipId: membership.id,
      },
    });
    const routeStep = (permission: string) => ({
      steps: [
        {
          stepNo: 1,
          stepMode: 'SEQUENTIAL',
          requiredPermission: permission,
          approvePermission: permission,
          returnPermission: permission,
          rejectPermission: permission,
          assignment: { kind: 'MEMBERSHIP', membershipId: membership.id },
          requiresSeparateReview: false,
        },
      ],
    });
    await transaction.approvalRouteVersion.createMany({
      data: [
        {
          agencyId: agency.id,
          routeCode: 'RECRUITMENT_REQUEST_REVIEW',
          versionNo: 1,
          domain: 'recruitment',
          stepDefinition: routeStep('recruitment.requests.approve'),
          effectiveFrom: new Date('2026-01-01'),
          status: 'ACTIVE',
        },
        {
          agencyId: agency.id,
          routeCode: 'RECRUITMENT_VACANCY_PUBLICATION',
          versionNo: 1,
          domain: 'recruitment',
          stepDefinition: routeStep('recruitment.vacancies.publish'),
          effectiveFrom: new Date('2026-01-01'),
          status: 'ACTIVE',
        },
        {
          agencyId: agency.id,
          routeCode: 'LEAVE_MONETIZATION',
          versionNo: 1,
          domain: 'leave',
          stepDefinition: routeStep('approvals.requests.approve'),
          effectiveFrom: new Date('2026-01-01'),
          status: 'ACTIVE',
        },
        {
          agencyId: agency.id,
          routeCode: 'LEAVE_MONETIZATION_ADJUSTMENT',
          versionNo: 1,
          domain: 'leave',
          stepDefinition: routeStep('approvals.requests.approve'),
          effectiveFrom: new Date('2026-01-01'),
          status: 'ACTIVE',
        },
        {
          agencyId: agency.id,
          routeCode: 'ATTENDANCE_CORRECTION',
          versionNo: 1,
          domain: 'attendance',
          stepDefinition: routeStep('attendance.corrections.approve'),
          effectiveFrom: new Date('2026-01-01'),
          status: 'ACTIVE',
        },
        {
          agencyId: agency.id,
          routeCode: 'ATTENDANCE_CORRECTION_LOCKED',
          versionNo: 1,
          domain: 'attendance',
          stepDefinition: {
            steps: [
              {
                stepNo: 1,
                stepMode: 'SEQUENTIAL',
                requiredPermission: 'attendance.corrections.approve',
                approvePermission: 'attendance.corrections.approve',
                returnPermission: 'attendance.corrections.approve',
                rejectPermission: 'attendance.corrections.approve',
                assignment: { kind: 'MEMBERSHIP', membershipId: membership.id },
                requiresSeparateReview: false,
              },
              {
                stepNo: 2,
                stepMode: 'SEQUENTIAL',
                requiredPermission: 'attendance.corrections.authorize_locked',
                approvePermission: 'attendance.corrections.authorize_locked',
                returnPermission: 'attendance.corrections.authorize_locked',
                rejectPermission: 'attendance.corrections.authorize_locked',
                assignment: { kind: 'MEMBERSHIP', membershipId: membership.id },
                requiresSeparateReview: false,
              },
            ],
          },
          effectiveFrom: new Date('2026-01-01'),
          status: 'ACTIVE',
        },
      ],
    });
    void criteriaSet;
    void formNo9Evidence;
    void fieldOfficePosting;
    void jobPortalPosting;
    void agencyPostingOne;
    void agencyPostingTwo;
    void agencyPostingThree;
    void applicantEducation;
    void applicantEligibility;

    // A publication whose period has elapsed and an Application whose configured
    // stages are complete, so the protected browser journey can deliberate and
    // record the appointing authority Selection Decision without waiting.
    const publicationRoute = await transaction.approvalRouteVersion.findFirstOrThrow({
      where: { agencyId: agency.id, routeCode: 'RECRUITMENT_VACANCY_PUBLICATION', versionNo: 1 },
    });
    const deliberationPosition = await transaction.plantillaPosition.create({
      data: {
        agencyId: agency.id,
        itemNumber: 'HRM-000144',
        status: 'VACANT',
        createdFromAuthorityId: authority.id,
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const deliberationPositionVersion = await transaction.plantillaPositionVersion.create({
      data: {
        agencyId: agency.id,
        positionId: deliberationPosition.id,
        organizationUnitId: unit.id,
        qualificationStandardVersionId: standardVersion.id,
        staffingAuthorityId: authority.id,
        versionNo: 1,
        positionTitle: 'Human Resource Management Officer II',
        salaryGrade: 15,
        fundingSource: 'General Appropriations Act',
        employmentCategory: 'PLANTILLA',
        effectiveFrom: new Date('2026-01-01'),
        status: 'ACTIVE',
        domainStatus: 'VACANT',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    await transaction.plantillaPosition.update({
      where: { id: deliberationPosition.id },
      data: { currentVersionId: deliberationPositionVersion.id, status: 'VACANT' },
    });
    const deliberationRequest = await transaction.requestToFill.create({
      data: {
        agencyId: agency.id,
        positionId: deliberationPosition.id,
        requestingUnitId: unit.id,
        requestedByMembershipId: membership.id,
        justification: 'Protected-shell deliberation fixture with an elapsed publication.',
        qualificationStandardVersionId: standardVersion.id,
        mspPlanVersionId: meritPlan.id,
        criteriaSetId: criteriaSet.id,
        boardDefinitionId: board.id,
        bindingSetNo: 1,
        bindingsResolvedAt: new Date('2026-01-01'),
        bindingFrozenAt: new Date('2026-01-01'),
        status: 'APPROVED',
        submittedAt: new Date('2026-01-01'),
        approvedAt: new Date('2026-01-01'),
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const deliberationPublication = await transaction.vacancyPublication.create({
      data: {
        agencyId: agency.id,
        requestToFillId: deliberationRequest.id,
        qualificationStandardVersionId: standardVersion.id,
        formDocumentVersionId: formNo9Evidence.currentVersionId!,
        approvalRouteVersionId: publicationRoute.id,
        openingDate: new Date('2026-01-01'),
        closingDate: new Date('2026-01-31'),
        channels: [],
        positionDetails: {},
        applicationRequirements: [],
        contactDetails: { name: 'Marisol Santos', email: 'marisol.santos@example.test' },
        hrmoCertification: { certified: true },
        certifiedByMembershipId: membership.id,
        certifiedAt: new Date('2026-01-01'),
        publishedAt: new Date('2026-01-01'),
        status: 'PUBLISHED',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const deliberationApplicant = await transaction.applicant.create({
      data: {
        agencyId: agency.id,
        firstName: 'Deliberation',
        lastName: 'Candidate',
        emailNormalized: 'deliberation.candidate@example.test',
        privacyNoticeVersion: 'Privacy Notice v1',
        consentedAt: new Date('2026-01-02'),
        deduplicationKey: `deliberation-${agency.id}`,
        createdByMembershipId: membership.id,
      },
    });
    const deliberationApplication = await transaction.application.create({
      data: {
        agencyId: agency.id,
        vacancyPublicationId: deliberationPublication.id,
        applicantId: deliberationApplicant.id,
        qualificationStandardVersionId: standardVersion.id,
        status: 'FOR_INTERVIEW',
        receivedAt: new Date('2026-01-02'),
        receivedByMembershipId: membership.id,
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const deliberationAssessment = await transaction.assessment.create({
      data: {
        agencyId: agency.id,
        applicationId: deliberationApplication.id,
        criteriaSetId: criteriaSet.id,
        stageCode: 'WRITTEN_EXAM',
        stageType: 'ASSESSMENT',
        status: 'COMPLETED',
        completedAt: new Date('2026-01-03'),
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    await transaction.assessmentResultVersion.create({
      data: {
        agencyId: agency.id,
        assessmentId: deliberationAssessment.id,
        criterionCode: 'JOB_KNOWLEDGE',
        evaluatedByMembershipId: membership.id,
        versionNo: 1,
        score: 85,
        recordedAt: new Date('2026-01-03'),
      },
    });
    const deliberationInterview = await transaction.interview.create({
      data: {
        agencyId: agency.id,
        applicationId: deliberationApplication.id,
        criteriaSetId: criteriaSet.id,
        stageCode: 'PANEL_INTERVIEW',
        scheduledAt: new Date('2026-01-04'),
        status: 'COMPLETED',
        completedAt: new Date('2026-01-04'),
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    await transaction.interviewFeedbackVersion.create({
      data: {
        agencyId: agency.id,
        interviewId: deliberationInterview.id,
        interviewerMembershipId: membership.id,
        versionNo: 1,
        score: 80,
        recommendation: 'PROCEED',
        submittedAt: new Date('2026-01-04'),
      },
    });
    void deliberationApplicant;

    // A completed deliberation handoff and Reservation on a dedicated item, so
    // the protected browser journey can prepare, review, issue, and cancel an
    // Appointment without replaying the whole Recruitment lifecycle first. The
    // dedicated item keeps the HRM-000144 deliberation fixture untouched for the
    // Recruitment journey.
    const appointmentEvidence = {
      pds: await evidence('E2E-APPT-PDS', 'PDS'),
      wes: await evidence('E2E-APPT-WES', 'WORK_EXPERIENCE_SHEET'),
      eligibility: await evidence('E2E-APPT-ELIGIBILITY', 'CERTIFICATE_OF_ELIGIBILITY'),
      positionDescription: await evidence('E2E-APPT-POSITION-DESC', 'POSITION_DESCRIPTION_FORM'),
      selectionCertification: await evidence('E2E-APPT-SELECTION-CERT', 'SELECTION_CERTIFICATION'),
      publicationCertification: await evidence(
        'E2E-APPT-PUBLICATION-CERT',
        'PUBLICATION_CERTIFICATION',
      ),
      authority: await evidence('E2E-APPT-AUTHORITY', 'APPOINTING_AUTHORITY'),
    };
    async function seedAppointmentPipeline(input: {
      itemNumber: string;
      positionTitle: string;
      salaryGrade: number;
      applicant: {
        firstName: string;
        lastName: string;
        email: string;
        deduplicationKey: string;
      };
      handoffKey: string;
    }): Promise<void> {
      const appointmentPosition = await transaction.plantillaPosition.create({
        data: {
          agencyId: agency.id,
          itemNumber: input.itemNumber,
          status: 'VACANT',
          createdFromAuthorityId: authority.id,
          createdByMembershipId: membership.id,
          updatedByMembershipId: membership.id,
        },
      });
      const appointmentPositionVersion = await transaction.plantillaPositionVersion.create({
        data: {
          agencyId: agency.id,
          positionId: appointmentPosition.id,
          organizationUnitId: unit.id,
          qualificationStandardVersionId: standardVersion.id,
          staffingAuthorityId: authority.id,
          versionNo: 1,
          positionTitle: input.positionTitle,
          salaryGrade: input.salaryGrade,
          fundingSource: 'General Appropriations Act',
          employmentCategory: 'PLANTILLA',
          effectiveFrom: new Date('2026-01-01'),
          status: 'ACTIVE',
          domainStatus: 'VACANT',
          createdByMembershipId: membership.id,
          updatedByMembershipId: membership.id,
        },
      });
      await transaction.plantillaPosition.update({
        where: { id: appointmentPosition.id },
        data: { currentVersionId: appointmentPositionVersion.id, status: 'VACANT' },
      });
      const appointmentRequest = await transaction.requestToFill.create({
        data: {
          agencyId: agency.id,
          positionId: appointmentPosition.id,
          requestingUnitId: unit.id,
          requestedByMembershipId: membership.id,
          justification: 'Protected-shell appointment fixture with a completed selection.',
          qualificationStandardVersionId: standardVersion.id,
          mspPlanVersionId: meritPlan.id,
          criteriaSetId: criteriaSet.id,
          boardDefinitionId: board.id,
          bindingSetNo: 1,
          bindingsResolvedAt: new Date('2026-01-01'),
          bindingFrozenAt: new Date('2026-01-01'),
          status: 'APPROVED',
          submittedAt: new Date('2026-01-01'),
          approvedAt: new Date('2026-01-01'),
          createdByMembershipId: membership.id,
          updatedByMembershipId: membership.id,
        },
      });
      const appointmentPublication = await transaction.vacancyPublication.create({
        data: {
          agencyId: agency.id,
          requestToFillId: appointmentRequest.id,
          qualificationStandardVersionId: standardVersion.id,
          formDocumentVersionId: formNo9Evidence.currentVersionId!,
          approvalRouteVersionId: publicationRoute.id,
          openingDate: new Date('2026-01-01'),
          closingDate: new Date('2026-01-31'),
          channels: [],
          positionDetails: {},
          applicationRequirements: [],
          contactDetails: { name: 'Marisol Santos', email: 'marisol.santos@example.test' },
          hrmoCertification: { certified: true },
          certifiedByMembershipId: membership.id,
          certifiedAt: new Date('2026-01-01'),
          publishedAt: new Date('2026-01-01'),
          status: 'PUBLISHED',
          createdByMembershipId: membership.id,
          updatedByMembershipId: membership.id,
        },
      });
      const appointmentApplicant = await transaction.applicant.create({
        data: {
          agencyId: agency.id,
          firstName: input.applicant.firstName,
          lastName: input.applicant.lastName,
          emailNormalized: input.applicant.email,
          privacyNoticeVersion: 'Privacy Notice v1',
          consentedAt: new Date('2025-12-02'),
          deduplicationKey: input.applicant.deduplicationKey,
          createdByMembershipId: membership.id,
        },
      });
      const appointmentApplication = await transaction.application.create({
        data: {
          agencyId: agency.id,
          vacancyPublicationId: appointmentPublication.id,
          applicantId: appointmentApplicant.id,
          qualificationStandardVersionId: standardVersion.id,
          status: 'SELECTED',
          receivedAt: new Date('2025-12-03'),
          createdAt: new Date('2025-12-03'),
          receivedByMembershipId: membership.id,
          createdByMembershipId: membership.id,
          updatedByMembershipId: membership.id,
        },
      });
      const appointmentSession = await transaction.selectionBoardSession.create({
        data: {
          agencyId: agency.id,
          vacancyPublicationId: appointmentPublication.id,
          boardDefinitionId: board.id,
          sessionDate: new Date('2026-01-05'),
          status: 'COMPLETED',
          rosterFrozenAt: new Date('2026-01-05'),
          startedAt: new Date('2026-01-05'),
          completedAt: new Date('2026-01-05'),
          createdByMembershipId: membership.id,
          updatedByMembershipId: membership.id,
        },
      });
      const appointmentRecommendation = await transaction.boardRecommendation.create({
        data: {
          agencyId: agency.id,
          sessionId: appointmentSession.id,
          applicationId: appointmentApplication.id,
          rankNo: 1,
          recommendation: 'RECOMMENDED',
          compositeScore: 82.5,
          reason: 'Highest overall rating for the appointment fixture item.',
          recordedByMembershipId: membership.id,
          recordedAt: new Date('2026-01-05'),
        },
      });
      const appointmentEvaluationReport = await transaction.candidateEvaluationReportVersion.create(
        {
          data: {
            agencyId: agency.id,
            sessionId: appointmentSession.id,
            versionNo: 1,
            reportDocumentVersionId: appointmentEvidence.selectionCertification.currentVersionId!,
            reportData: {
              sessionDate: '2026-01-05',
              recommendation: 'RECOMMENDED',
              compositeScore: 82.5,
            },
            issuedByMembershipId: membership.id,
            issuedAt: new Date('2026-01-05'),
          },
        },
      );
      const appointmentSelectionDecision = await transaction.selectionDecision.create({
        data: {
          agencyId: agency.id,
          applicationId: appointmentApplication.id,
          sessionId: appointmentSession.id,
          boardRecommendationId: appointmentRecommendation.id,
          decision: 'SELECTED',
          reason: 'The appointing authority selected the Board-recommended candidate.',
          authorityDocumentVersionId: authorityEvidence.currentVersionId,
          decidedByMembershipId: membership.id,
          decidedAt: new Date('2026-01-05'),
        },
      });
      const reservationDate = new Date(`${manilaToday()}T00:00:00.000Z`);
      await transaction.plantillaPositionVersion.update({
        where: { id: appointmentPositionVersion.id },
        data: { effectiveTo: new Date(reservationDate.getTime() - 86_400_000) },
      });
      const reservedVersion = await transaction.plantillaPositionVersion.create({
        data: {
          agencyId: agency.id,
          positionId: appointmentPosition.id,
          organizationUnitId: unit.id,
          qualificationStandardVersionId: standardVersion.id,
          staffingAuthorityId: authority.id,
          versionNo: 2,
          positionTitle: input.positionTitle,
          salaryGrade: input.salaryGrade,
          fundingSource: 'General Appropriations Act',
          employmentCategory: 'PLANTILLA',
          effectiveFrom: reservationDate,
          status: 'ACTIVE',
          domainStatus: 'RESERVED',
          createdByMembershipId: membership.id,
          updatedByMembershipId: membership.id,
        },
      });
      await transaction.plantillaPosition.update({
        where: { id: appointmentPosition.id },
        data: { currentVersionId: reservedVersion.id, status: 'RESERVED' },
      });
      await transaction.recruitmentAppointmentHandoff.create({
        data: {
          agencyId: agency.id,
          selectionDecisionId: appointmentSelectionDecision.id,
          applicationId: appointmentApplication.id,
          positionId: appointmentPosition.id,
          idempotencyKey: input.handoffKey,
          handedOffAt: new Date('2026-01-05'),
          selectionPackage: {
            selectionDecisionId: appointmentSelectionDecision.id,
            decision: 'SELECTED',
            decidedAt: '2026-01-05T00:00:00.000Z',
            decidedByMembershipId: membership.id,
            applicationId: appointmentApplication.id,
            applicationNo: `APP-${String(appointmentApplication.applicationNo).padStart(6, '0')}`,
            applicant: {
              id: appointmentApplicant.id,
              fullName: `${input.applicant.firstName} ${input.applicant.lastName}`,
              email: input.applicant.email,
              mobileNumber: null,
            },
            publicationId: appointmentPublication.id,
            publicationNo: `PUB-${String(appointmentPublication.publicationNo).padStart(6, '0')}`,
            requestToFillId: appointmentRequest.id,
            requestNo: `RTF-${String(appointmentRequest.requestNo).padStart(6, '0')}`,
            qualificationStandardVersionId: standardVersion.id,
            mspPlanVersionId: meritPlan.id,
            criteriaSetId: criteriaSet.id,
            boardDefinitionId: board.id,
            boardRecommendation: {
              id: appointmentRecommendation.id,
              recommendation: 'RECOMMENDED',
              rankNo: 1,
              compositeScore: 82.5,
              reason: 'Highest overall rating for the appointment fixture item.',
            },
            report: {
              id: appointmentEvaluationReport.id,
              versionNo: 1,
              reportDocumentVersionId: appointmentEvaluationReport.reportDocumentVersionId,
            },
            authorityDocumentVersionId: authorityEvidence.currentVersionId,
            position: {
              id: appointmentPosition.id,
              itemNumber: input.itemNumber,
              status: 'RESERVED',
              positionVersionId: reservedVersion.id,
              title: input.positionTitle,
              salaryGrade: input.salaryGrade,
              organizationUnitId: unit.id,
            },
            documents: [],
            reservedOn: manilaToday(),
          },
        },
      });
    }
    await seedAppointmentPipeline({
      itemNumber: 'HRM-000145',
      positionTitle: 'Human Resource Management Officer II',
      salaryGrade: 15,
      applicant: {
        firstName: 'Appointment',
        lastName: 'Candidate',
        email: 'appointment.candidate@example.test',
        deduplicationKey: `appointment-${agency.id}`,
      },
      handoffKey: 'E2E-APPOINTMENT-HANDOFF-1',
    });
    await seedAppointmentPipeline({
      itemNumber: 'HRM-000146',
      positionTitle: 'Human Resource Management Officer I',
      salaryGrade: 11,
      applicant: {
        firstName: 'Activation',
        lastName: 'Candidate',
        email: 'activation.candidate@example.test',
        deduplicationKey: `activation-${agency.id}`,
      },
      handoffKey: 'E2E-APPOINTMENT-HANDOFF-2',
    });
    await transaction.appointmentAgencySettings.create({
      data: {
        agencyId: agency.id,
        regulatoryStatus: 'REGULATED',
        statusEvidenceDocumentVersionId: appointmentEvidence.authority.currentVersionId!,
        configuredByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });

    const position = await transaction.plantillaPosition.create({
      data: {
        agencyId: agency.id,
        itemNumber: 'HRM-000142',
        status: 'PROPOSED',
        createdFromAuthorityId: authority.id,
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const positionVersion = await transaction.plantillaPositionVersion.create({
      data: {
        agencyId: agency.id,
        positionId: position.id,
        organizationUnitId: unit.id,
        qualificationStandardVersionId: standardVersion.id,
        staffingAuthorityId: authority.id,
        versionNo: 1,
        positionTitle: 'Senior Human Resource Management Officer',
        parentheticalTitle: 'Records and Staffing',
        salaryGrade: 24,
        fundingSource: 'General Appropriations Act',
        employmentCategory: 'PLANTILLA',
        effectiveFrom: new Date('2026-01-01'),
        status: 'ACTIVE',
        domainStatus: 'PROPOSED',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    await transaction.plantillaPosition.update({
      where: { id: position.id },
      data: { currentVersionId: positionVersion.id, status: 'OCCUPIED' },
    });
    await transaction.plantillaPositionVersion.update({
      where: { id: positionVersion.id },
      data: { domainStatus: 'OCCUPIED' },
    });

    const vacantPosition = await transaction.plantillaPosition.create({
      data: {
        agencyId: agency.id,
        itemNumber: 'HRM-000143',
        status: 'VACANT',
        createdFromAuthorityId: authority.id,
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const vacantPositionVersion = await transaction.plantillaPositionVersion.create({
      data: {
        agencyId: agency.id,
        positionId: vacantPosition.id,
        organizationUnitId: unit.id,
        qualificationStandardVersionId: standardVersion.id,
        staffingAuthorityId: authority.id,
        versionNo: 1,
        positionTitle: 'Human Resource Management Officer III',
        parentheticalTitle: 'Personnel Records',
        salaryGrade: 18,
        fundingSource: 'General Appropriations Act',
        employmentCategory: 'PLANTILLA',
        effectiveFrom: new Date('2026-01-01'),
        status: 'ACTIVE',
        domainStatus: 'VACANT',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    await transaction.plantillaPosition.update({
      where: { id: vacantPosition.id },
      data: { currentVersionId: vacantPositionVersion.id },
    });

    const employee = await transaction.employee.create({
      data: {
        agencyId: agency.id,
        employeeNumber: 'E2E-0001',
        legalName: 'Alex Rivera',
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: 'alex.rivera@example.test',
        serviceStatus: 'ACTIVE',
        firstGovernmentServiceDate: new Date('2020-01-01'),
        agencyServiceStartDate: new Date('2020-01-01'),
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const serviceSegment = await transaction.serviceSegment.create({
      data: {
        agencyId: agency.id,
        employeeId: employee.id,
        positionId: position.id,
        organizationUnitId: unit.id,
        appointmentStatus: 'PERMANENT',
        salaryGrade: 24,
        salaryStep: 1,
        effectiveFrom: new Date('2020-01-01'),
        status: 'ACTIVE',
        createdByMembershipId: membership.id,
      },
    });
    await transaction.employee.update({
      where: { id: employee.id },
      data: { currentServiceSegmentId: serviceSegment.id },
    });
    const assignmentEvidence = await evidence(
      'E2E-SCHEDULE-ASSIGNMENT-AUTHORITY',
      'SCHEDULE_ASSIGNMENT_AUTHORITY',
    );
    await transaction.scheduleAssignment.create({
      data: {
        agencyId: agency.id,
        employeeId: employee.id,
        workScheduleVersionId: ordinaryVersion.id,
        workArrangementVersionId: ordinaryArrangementVersion.id,
        authorityDocumentVersionId: assignmentEvidence.currentVersionId!,
        effectiveFrom: new Date('2026-01-01'),
        assignedByMembershipId: membership.id,
      },
    });

    const actionEvidence = await Promise.all(
      ['NOSI', 'CURRENT_COMPENSATION', 'PERFORMANCE_OR_SERVICE', 'SERVICE_CONTINUITY'].map((type) =>
        evidence(`E2E-ACTION-${type}`, type),
      ),
    );
    const compensationAction = await transaction.personnelAction.create({
      data: {
        agencyId: agency.id,
        employeeId: employee.id,
        actionType: 'STEP_INCREMENT',
        status: 'APPROVED',
        preparedByMembershipId: preparerMembership.id,
        approvedByMembershipId: membership.id,
        approvedAt: new Date(),
      },
    });
    const compensationActionVersion = await transaction.personnelActionVersion.create({
      data: {
        agencyId: agency.id,
        actionId: compensationAction.id,
        versionNo: 1,
        proposedEffectivity: new Date(`${manilaToday()}T00:00:00.000Z`),
        fromServiceSegmentId: serviceSegment.id,
        targetFacts: { newSalaryStep: 2 },
        reason: 'Apply the signed Notice of Step Increment on its stated date.',
        createdByMembershipId: membership.id,
      },
    });
    await transaction.personnelActionEvidence.createMany({
      data: actionEvidence.map((item, index) => ({
        agencyId: agency.id,
        actionVersionId: compensationActionVersion.id,
        evidenceType: [
          'NOSI',
          'CURRENT_COMPENSATION',
          'PERFORMANCE_OR_SERVICE',
          'SERVICE_CONTINUITY',
        ][index]!,
        documentId: item.id,
        documentVersionId: item.currentVersionId!,
        sourceDate: new Date('2026-01-01'),
        createdByMembershipId: membership.id,
      })),
    });
    await transaction.personnelAction.update({
      where: { id: compensationAction.id },
      data: { currentVersionId: compensationActionVersion.id },
    });
    await transaction.auditEvent.create({
      data: {
        agencyId: agency.id,
        actorUserId: user.id,
        actorMembershipId: membership.id,
        actorType: 'USER',
        action: 'PERSONNEL_ACTION_APPROVED',
        entityType: 'PersonnelAction',
        entityId: compensationAction.id,
        previousStatus: 'FOR_APPROVAL',
        newStatus: 'APPROVED',
        reason: 'Protected shell effectuation fixture.',
        requestId: 'protected-shell-seed',
        metadata: { actionType: 'STEP_INCREMENT', versionId: compensationActionVersion.id },
      },
    });

    const actionEmployee = await transaction.employee.create({
      data: {
        agencyId: agency.id,
        employeeNumber: 'E2E-PA-001',
        legalName: 'E2E Separation Candidate',
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: 'e2e.separation@example.test',
        serviceStatus: 'ACTIVE',
        firstGovernmentServiceDate: new Date('2020-01-01'),
        agencyServiceStartDate: new Date('2020-01-01'),
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const actionSegment = await transaction.serviceSegment.create({
      data: {
        agencyId: agency.id,
        employeeId: actionEmployee.id,
        organizationUnitId: unit.id,
        appointmentStatus: 'PERMANENT',
        salaryGrade: 11,
        salaryStep: 2,
        effectiveFrom: new Date('2020-01-01'),
        status: 'ACTIVE',
        createdByMembershipId: membership.id,
      },
    });
    await transaction.employee.update({
      where: { id: actionEmployee.id },
      data: { currentServiceSegmentId: actionSegment.id },
    });
    const separationAction = await transaction.personnelAction.create({
      data: {
        agencyId: agency.id,
        employeeId: actionEmployee.id,
        actionType: 'SEPARATION_RESIGNATION',
        status: 'APPROVED',
        preparedByMembershipId: membership.id,
        approvedByMembershipId: membership.id,
        approvedAt: new Date(),
      },
    });
    const separationActionVersion = await transaction.personnelActionVersion.create({
      data: {
        agencyId: agency.id,
        actionId: separationAction.id,
        versionNo: 1,
        proposedEffectivity: new Date(),
        fromServiceSegmentId: actionSegment.id,
        targetFacts: {
          acceptanceDate: '2026-09-01',
          noticeDate: '2026-08-01',
          withdrawalState: 'NONE',
          mutuallyAgreedEarlier: false,
        },
        reason: 'Protected shell effectuation modal fixture.',
        createdByMembershipId: membership.id,
      },
    });
    await transaction.personnelAction.update({
      where: { id: separationAction.id },
      data: { currentVersionId: separationActionVersion.id },
    });

    // An issued and assumed PROMOTION contract with its reviewed position
    // movement, so the protected browser journey can exercise the #108
    // approval, confirmation, result, and history surfaces.
    const movementEvidence = await evidence('E2E-MOVE-AUTHORITY', 'AUTHORITY');
    const movementSourcePosition = await transaction.plantillaPosition.create({
      data: {
        agencyId: agency.id,
        itemNumber: 'E2E-MOVE-SRC',
        status: 'OCCUPIED',
        createdFromAuthorityId: authority.id,
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const movementSourceVersion = await transaction.plantillaPositionVersion.create({
      data: {
        agencyId: agency.id,
        positionId: movementSourcePosition.id,
        organizationUnitId: unit.id,
        qualificationStandardVersionId: standardVersion.id,
        staffingAuthorityId: authority.id,
        versionNo: 1,
        positionTitle: 'Administrative Officer IV',
        salaryGrade: 12,
        fundingSource: 'General Appropriations Act',
        employmentCategory: 'PLANTILLA',
        effectiveFrom: new Date('2020-01-01'),
        status: 'ACTIVE',
        domainStatus: 'OCCUPIED',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    await transaction.plantillaPosition.update({
      where: { id: movementSourcePosition.id },
      data: { currentVersionId: movementSourceVersion.id },
    });
    const movementTargetPosition = await transaction.plantillaPosition.create({
      data: {
        agencyId: agency.id,
        itemNumber: 'E2E-MOVE-TGT',
        status: 'RESERVED',
        createdFromAuthorityId: authority.id,
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const movementTargetVersion = await transaction.plantillaPositionVersion.create({
      data: {
        agencyId: agency.id,
        positionId: movementTargetPosition.id,
        organizationUnitId: unit.id,
        qualificationStandardVersionId: standardVersion.id,
        staffingAuthorityId: authority.id,
        versionNo: 1,
        positionTitle: 'Human Resource Management Officer III',
        salaryGrade: 13,
        fundingSource: 'General Appropriations Act',
        employmentCategory: 'PLANTILLA',
        effectiveFrom: new Date('2026-01-01'),
        status: 'ACTIVE',
        domainStatus: 'RESERVED',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    await transaction.plantillaPosition.update({
      where: { id: movementTargetPosition.id },
      data: { currentVersionId: movementTargetVersion.id, status: 'RESERVED' },
    });
    const movementPersonKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const movementEmployee = await transaction.employee.create({
      data: {
        agencyId: agency.id,
        employeeNumber: 'E2E-MOVE-001',
        personKey: movementPersonKey,
        legalName: 'E2E Movement Candidate',
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: 'e2e.movement@example.test',
        serviceStatus: 'ACTIVE',
        firstGovernmentServiceDate: new Date('2020-01-01'),
        agencyServiceStartDate: new Date('2020-01-01'),
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const movementSegment = await transaction.serviceSegment.create({
      data: {
        agencyId: agency.id,
        employeeId: movementEmployee.id,
        positionId: movementSourcePosition.id,
        organizationUnitId: unit.id,
        appointmentStatus: 'PERMANENT',
        salaryGrade: 12,
        salaryStep: 2,
        effectiveFrom: new Date('2020-01-01'),
        status: 'ACTIVE',
        createdByMembershipId: membership.id,
      },
    });
    await transaction.positionIncumbency.create({
      data: {
        agencyId: agency.id,
        positionId: movementSourcePosition.id,
        employeeId: movementEmployee.id,
        serviceSegmentId: movementSegment.id,
        effectiveFrom: new Date('2020-01-01'),
        status: 'ACTIVE',
        createdByMembershipId: membership.id,
      },
    });
    await transaction.employee.update({
      where: { id: movementEmployee.id },
      data: { currentServiceSegmentId: movementSegment.id },
    });
    const movementAssumptionDate = new Date(`${manilaToday()}T00:00:00.000Z`);
    const movementSelectionPackage = {
      selectionDecisionId: '88888888-8888-4888-8888-888888888888',
      decision: 'SELECTED',
      applicant: {
        id: movementPersonKey,
        fullName: 'E2E Movement Candidate',
        email: 'e2e.movement@example.test',
        mobileNumber: null,
      },
      applicationNo: 'E2E-MOVE-APP-1',
      qualificationStandardVersionId: standardVersion.id,
      position: {
        id: movementTargetPosition.id,
        itemNumber: 'E2E-MOVE-TGT',
        positionVersionId: movementTargetVersion.id,
        title: 'Human Resource Management Officer III',
        salaryGrade: 13,
        organizationUnitId: unit.id,
      },
      documents: [],
    };
    const movementHandoff = await transaction.recruitmentAppointmentHandoff.create({
      data: {
        agencyId: agency.id,
        selectionDecisionId: '88888888-8888-4888-8888-888888888888',
        applicationId: '99999999-9999-4999-8999-999999999999',
        positionId: movementTargetPosition.id,
        selectionPackage: movementSelectionPackage,
        idempotencyKey: 'E2E-MOVEMENT-HANDOFF-1',
        handedOffAt: new Date('2026-01-05'),
      },
    });
    const movementAppointment = await transaction.appointment.create({
      data: {
        agencyId: agency.id,
        recruitmentHandoffId: movementHandoff.id,
        recruitmentSelectionPackage: movementSelectionPackage,
        positionId: movementTargetPosition.id,
        appointeePersonKey: movementPersonKey,
        workflowStatus: 'ISSUED',
        issuedAt: new Date('2026-01-06'),
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const movementAppointmentVersion = await transaction.appointmentVersion.create({
      data: {
        agencyId: agency.id,
        appointmentId: movementAppointment.id,
        versionNo: 1,
        employmentStatus: 'PERMANENT',
        natureOfAppointment: 'PROMOTION',
        salaryGrade: 13,
        salaryStep: 3,
        effectivityDate: movementAssumptionDate,
        appointingAuthorityMembershipId: membership.id,
        formVariant: 'CS_FORM_33_A_2025',
        signatureMethod: 'WET_INK',
        appointmentDocumentVersionId: movementEvidence.currentVersionId!,
        status: 'ISSUED',
        issuedAt: new Date('2026-01-06'),
        issuedByMembershipId: membership.id,
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    await transaction.appointment.update({
      where: { id: movementAppointment.id },
      data: { currentVersionId: movementAppointmentVersion.id },
    });
    await transaction.appointmentAcknowledgment.create({
      data: {
        agencyId: agency.id,
        appointmentVersionId: movementAppointmentVersion.id,
        acknowledgedAt: new Date('2026-01-07'),
        evidenceDocumentVersionId: movementEvidence.currentVersionId!,
      },
    });
    const movementOath = await transaction.oathOfOffice.create({
      data: {
        agencyId: agency.id,
        appointmentVersionId: movementAppointmentVersion.id,
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const movementOathVersion = await transaction.oathVersion.create({
      data: {
        agencyId: agency.id,
        oathId: movementOath.id,
        versionNo: 1,
        oathDate: movementAssumptionDate,
        administeredByMembershipId: membership.id,
        authority: 'Agency Human Resource Management Officer',
        documentVersionId: movementEvidence.currentVersionId!,
      },
    });
    await transaction.oathOfOffice.update({
      where: { id: movementOath.id },
      data: { currentVersionId: movementOathVersion.id },
    });
    const movementAssumption = await transaction.assumptionToDuty.create({
      data: {
        agencyId: agency.id,
        appointmentVersionId: movementAppointmentVersion.id,
        status: 'PENDING',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const movementAssumptionVersion = await transaction.assumptionVersion.create({
      data: {
        agencyId: agency.id,
        assumptionId: movementAssumption.id,
        versionNo: 1,
        oathVersionId: movementOathVersion.id,
        actualAssumptionDate: movementAssumptionDate,
        certifiedByMembershipId: membership.id,
        certifyingAuthority: 'Agency Human Resource Management Officer',
        certifiedAt: new Date(),
        documentVersionId: movementEvidence.currentVersionId!,
      },
    });
    await transaction.assumptionToDuty.update({
      where: { id: movementAssumption.id },
      data: { currentVersionId: movementAssumptionVersion.id, status: 'ASSUMED' },
    });
    const movementAction = await transaction.personnelAction.create({
      data: {
        agencyId: agency.id,
        employeeId: movementEmployee.id,
        actionType: 'PROMOTION',
        status: 'FOR_APPROVAL',
        preparedByMembershipId: preparerMembership.id,
      },
    });
    const movementActionVersion = await transaction.personnelActionVersion.create({
      data: {
        agencyId: agency.id,
        actionId: movementAction.id,
        versionNo: 1,
        proposedEffectivity: movementAssumptionDate,
        fromServiceSegmentId: movementSegment.id,
        targetPositionId: movementTargetPosition.id,
        targetOrganizationUnitId: unit.id,
        targetFacts: { appointmentVersionId: movementAppointmentVersion.id },
        reason: 'Effectuate the Appointment-backed promotion on its assumption date.',
        createdByMembershipId: membership.id,
      },
    });
    await transaction.personnelActionEvidence.create({
      data: {
        agencyId: agency.id,
        actionVersionId: movementActionVersion.id,
        evidenceType: 'AUTHORITY',
        documentId: movementEvidence.id,
        documentVersionId: movementEvidence.currentVersionId!,
        sourceDate: new Date('2026-01-01'),
        createdByMembershipId: membership.id,
      },
    });
    await transaction.personnelAction.update({
      where: { id: movementAction.id },
      data: { currentVersionId: movementActionVersion.id },
    });
    await transaction.auditEvent.create({
      data: {
        agencyId: agency.id,
        actorUserId: preparerUser.id,
        actorMembershipId: preparerMembership.id,
        actorType: 'USER',
        action: 'PERSONNEL_ACTION_SUBMITTED',
        entityType: 'PersonnelAction',
        entityId: movementAction.id,
        previousStatus: 'DRAFT',
        newStatus: 'FOR_REVIEW',
        reason: 'Effectuate the Appointment-backed promotion on its assumption date.',
        requestId: 'protected-shell-seed',
        metadata: { actionType: 'PROMOTION', versionId: movementActionVersion.id },
      },
    });
    await transaction.auditEvent.create({
      data: {
        agencyId: agency.id,
        actorUserId: user.id,
        actorMembershipId: membership.id,
        actorType: 'USER',
        action: 'PERSONNEL_ACTION_ENDORSED',
        entityType: 'PersonnelAction',
        entityId: movementAction.id,
        previousStatus: 'FOR_REVIEW',
        newStatus: 'FOR_APPROVAL',
        reason: 'The assumed Appointment and reserved item were reviewed.',
        requestId: 'protected-shell-seed',
        metadata: { actionType: 'PROMOTION', versionId: movementActionVersion.id },
      },
    });
  });
  // One protected-shell identity exercises the browser critical path; production role grants remain distinct.
  for (const roleCode of [
    'agency_administrator',
    'employee',
    'hrmo_administrator',
    'hrmpsb_member',
    'personnel_records_officer',
    'appointing_authority',
    'payroll_preparer',
    'plantilla_officer',
    'budget_officer',
  ]) {
    const role = await prisma.role.findFirstOrThrow({
      where: { agencyId: null, code: roleCode, status: 'ACTIVE' },
    });
    const assignment = await prisma.membershipRole.findFirst({
      where: { agencyId: agency.id, membershipId: membership.id, roleId: role.id },
    });
    if (!assignment) {
      await prisma.membershipRole.create({
        data: {
          agencyId: agency.id,
          membershipId: membership.id,
          roleId: role.id,
          effectiveFrom: new Date('2026-01-01'),
          assignedByMembershipId: membership.id,
          reason: 'Protected shell E2E fixture',
        },
      });
    } else if (assignment.effectiveFrom > new Date('2026-01-01')) {
      await prisma.membershipRole.update({
        where: { id: assignment.id },
        data: { effectiveFrom: new Date('2026-01-01') },
      });
    }
  }

  const foreignAgency = await prisma.agency.upsert({
    where: { id: foreignAgencyId },
    update: {
      code: 'E2E-FOREIGN-RECORDS',
      name: 'Synthetic Foreign Records Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
    create: {
      id: foreignAgencyId,
      code: 'E2E-FOREIGN-RECORDS',
      name: 'Synthetic Foreign Records Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  await resetProfile(foreignAgency);
  const foreignUser = await prisma.user.upsert({
    where: { emailNormalized: 'foreign.personnel@example.test' },
    update: {
      displayName: 'Foreign Personnel User',
      globalStatus: 'ACTIVE',
      lockedAt: null,
      lockedByAgencyId: null,
    },
    create: {
      emailNormalized: 'foreign.personnel@example.test',
      displayName: 'Foreign Personnel User',
      globalStatus: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const foreignMembership =
    (await prisma.agencyMembership.findFirst({
      where: { agencyId: foreignAgency.id, userId: foreignUser.id },
    })) ??
    (await prisma.agencyMembership.create({
      data: {
        agencyId: foreignAgency.id,
        userId: foreignUser.id,
        status: 'ACTIVE',
        activatedAt: new Date(),
      },
    }));
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.auditEvent.deleteMany({ where: { agencyId: foreignAgency.id } });
    await transaction.leaveCalculationSegment.deleteMany({ where: { agencyId: foreignAgency.id } });
    await transaction.leaveEligibilityAssessment.deleteMany({
      where: { agencyId: foreignAgency.id },
    });
    await transaction.leaveApplicationVersionDocument.deleteMany({
      where: { agencyId: foreignAgency.id },
    });
    await transaction.leaveApplicationPeriod.deleteMany({ where: { agencyId: foreignAgency.id } });
    await transaction.leaveApplicationVersion.deleteMany({ where: { agencyId: foreignAgency.id } });
    await transaction.leaveApplicationDraftDocument.deleteMany({
      where: { agencyId: foreignAgency.id },
    });
    await transaction.leaveApplicationDraftPeriod.deleteMany({
      where: { agencyId: foreignAgency.id },
    });
    await transaction.leaveApplication.deleteMany({ where: { agencyId: foreignAgency.id } });
    await transaction.agencyMembership.updateMany({
      where: { agencyId: foreignAgency.id },
      data: { employeeId: null },
    });
    await transaction.governmentIdentifier.deleteMany({ where: { agencyId: foreignAgency.id } });
    await transaction.attendanceContext.deleteMany({ where: { agencyId: foreignAgency.id } });
    await transaction.scheduleAssignment.deleteMany({ where: { agencyId: foreignAgency.id } });
    await transaction.employee.deleteMany({ where: { agencyId: foreignAgency.id } });
    await transaction.organizationUnitVersion.deleteMany({ where: { agencyId: foreignAgency.id } });
    await transaction.organizationUnit.deleteMany({ where: { agencyId: foreignAgency.id } });
    await transaction.organizationUnit.create({
      data: {
        id: foreignUnitId,
        agencyId: foreignAgency.id,
        code: 'FOREIGN-RECORD',
        unitType: 'OFFICE',
        status: 'DRAFT',
      },
    });
    await transaction.organizationUnitVersion.create({
      data: {
        id: foreignUnitVersionId,
        agencyId: foreignAgency.id,
        organizationUnitId: foreignUnitId,
        versionNo: 1,
        name: 'Synthetic Foreign Records Office',
        effectiveFrom: new Date('2026-08-16'),
        status: 'DRAFT',
      },
    });
    await transaction.organizationUnit.update({
      where: { id: foreignUnitId },
      data: { currentVersionId: foreignUnitVersionId },
    });
    await transaction.auditEvent.create({
      data: {
        id: foreignAuditEventId,
        agencyId: foreignAgency.id,
        actorType: 'SYSTEM',
        action: 'ORGANIZATION_UNIT_CREATED',
        entityType: 'OrganizationUnit',
        entityId: foreignUnitId,
        previousStatus: 'None',
        newStatus: 'DRAFT',
        metadata: {
          officialName: 'Synthetic Foreign Records Office',
          code: 'FOREIGN-RECORD',
          unitType: 'OFFICE',
          effectiveDate: '2026-08-16',
        },
      },
    });
    await transaction.employee.create({
      data: {
        id: foreignEmployeeId,
        agencyId: foreignAgency.id,
        employeeNumber: 'FOREIGN-0001',
        legalName: 'Synthetic Foreign Employee',
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: 'foreign.personnel@example.test',
        createdByMembershipId: foreignMembership.id,
        updatedByMembershipId: foreignMembership.id,
      },
    });
    await transaction.governmentIdentifier.create({
      data: {
        id: foreignIdentifierId,
        agencyId: foreignAgency.id,
        employeeId: foreignEmployeeId,
        identifierType: 'PHILHEALTH',
        encryptedValue: Buffer.from('foreign-protected-fixture'),
        maskedValue: '••••0001',
        effectiveFrom: new Date('2026-01-01'),
        createdByMembershipId: foreignMembership.id,
        updatedByMembershipId: foreignMembership.id,
      },
    });
  });
  await seedDtrFixture();
}

/**
 * Gives each seeded User the local passphrase and, when their current roles make them an
 * MFA-Required User, a TOTP factor sealed with this run's `DATA_ENCRYPTION_KEY` and a full set of
 * the local Recovery Codes. A factor that already exists keeps its id and replay guard; used
 * Recovery Codes come back on every run. The enrollment candidate gets neither, so each run
 * enrolls again.
 */
async function seedLocalCredentials(): Promise<void> {
  const dataEncryptionKey = parseProtectedValueKey(config.DATA_ENCRYPTION_KEY);
  const passwordHash = await hashPassword(LOCAL_SEED_PASSPHRASE);
  const recoveryCodeHashes = await Promise.all(
    LOCAL_SEED_RECOVERY_CODES.map((code) => hashPassword(normalizeRecoveryCode(code) ?? '')),
  );
  const now = new Date();
  const users = await prisma.user.findMany({
    where: { emailNormalized: { in: seededUserEmails } },
    select: { id: true, emailNormalized: true },
  });
  for (const user of users) {
    await prisma.userPassword.upsert({
      where: { userId: user.id },
      update: { passwordHash, changedAt: now, secondFactorFailures: 0, resetRequiredAt: null },
      create: { userId: user.id, passwordHash },
    });
    await prisma.pendingAuthentication.deleteMany({ where: { userId: user.id } });
    const emailHash = hashEmail(user.emailNormalized, config.BLIND_INDEX_KEY);
    await prisma.signInThrottle.deleteMany({ where: { emailHash: new Uint8Array(emailHash) } });
    const assignments = await prisma.membershipRole.findMany({
      where: {
        membership: { userId: user.id, status: 'ACTIVE' },
        role: { status: 'ACTIVE' },
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      select: { role: { select: { permissions: { select: { permission: true } } } } },
    });
    const mfaRequired = permissionsRequireMfa(
      assignments.flatMap(({ role }) =>
        role.permissions.map(({ permission }) => ({
          code: permission.code,
          scopePolicy: 'AGENCY' as const,
        })),
      ),
    );
    await prisma.userRecoveryCode.deleteMany({ where: { userId: user.id } });
    if (!mfaRequired || user.emailNormalized === enrollmentCandidateEmail) {
      await prisma.userTotpFactor.deleteMany({ where: { userId: user.id } });
      continue;
    }
    await prisma.userRecoveryCode.createMany({
      data: recoveryCodeHashes.map((codeHash) => ({ userId: user.id, codeHash })),
    });
    const existing = await prisma.userTotpFactor.findUnique({ where: { userId: user.id } });
    const factorId = existing?.id ?? randomUUID();
    const secretEnvelope = sealTotpSecret(LOCAL_SEED_TOTP_SECRET, dataEncryptionKey, {
      userId: user.id,
      factorId,
    });
    await prisma.userTotpFactor.upsert({
      where: { userId: user.id },
      update: { secretEnvelope },
      create: { id: factorId, userId: user.id, secretEnvelope },
    });
  }
}

seed()
  .then(seedLocalCredentials)
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
