/** Shared fixtures for the Overtime Service Record DB-backed integration tests. */
import type { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import {
  cleanupAttendanceWorkflowAgency,
  type AttendanceWorkflowFixture,
} from '../attendance-test-fixtures';
import type { AgencyFixture } from '../overtime-authorities/overtime-authority-test-fixtures';

export function serviceGrants(
  scopePolicy: 'AGENCY' | 'DIRECT_REPORTS' | 'OWN',
  codes = ['overtime.service.record', 'overtime.service.submit'],
): RequestContext['permissions'] {
  return codes.map((code) => ({ code, scopePolicy }));
}

/**
 * Create an authority as a DRAFT, the only status that accepts covered
 * Employees, then approve it directly; approval itself is #532's to test.
 */
export async function approvedAuthority(
  admin: PrismaClient,
  options: {
    agencyId: string;
    requestingUnitId: string;
    approverMembershipId: string;
    authorityNo: string;
    workDateFrom: string;
    workDateTo: string;
    employeeIds: string[];
    status?: 'APPROVED' | 'DRAFT';
    approvedAt?: Date;
    authorizedHours?: string;
  },
): Promise<string> {
  const authority = await admin.overtimeAuthority.create({
    data: {
      agencyId: options.agencyId,
      requestingUnitId: options.requestingUnitId,
      authorityNo: options.authorityNo,
      purpose: 'Year-end closing of accounts.',
      workDateFrom: new Date(options.workDateFrom),
      workDateTo: new Date(options.workDateTo),
      compensationMethod: 'COC',
      status: 'DRAFT',
    },
  });
  await admin.overtimeAuthorityEmployee.createMany({
    data: options.employeeIds.map((employeeId) => ({
      agencyId: options.agencyId,
      overtimeAuthorityId: authority.id,
      employeeId,
      authorizedHours: options.authorizedHours ?? '16',
    })),
  });
  if (options.status !== 'DRAFT') {
    await admin.overtimeAuthority.update({
      where: { id: authority.id },
      data: {
        status: 'APPROVED',
        approvedByMembershipId: options.approverMembershipId,
        approvedAt: options.approvedAt ?? new Date('2026-05-01T00:00:00+08:00'),
      },
    });
  }
  return authority.id;
}

/** Link an Agency Membership to an Employee, as the Membership's own User. */
export function linkEmployee(home: AgencyFixture, membershipId: string, employeeId: string) {
  return withDatabaseContext(
    {
      agencyId: home.agency.id,
      membershipId: home.membership.id,
      capabilities: ['employee-membership-link'],
    },
    (transaction) =>
      transaction.agencyMembership.update({
        where: { agencyId_id: { agencyId: home.agency.id, id: membershipId } },
        data: { employeeId },
      }),
  );
}

/** Remove an Attendance workflow fixture's Agency along with its Overtime rows. */
export async function cleanupAttendanceOvertime(fixture: AttendanceWorkflowFixture): Promise<void> {
  const { admin, agencyId, suffix } = fixture;
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.overtimeServiceRecord.deleteMany({ where: { agencyId } });
    await transaction.overtimeAuthorityEmployee.deleteMany({ where: { agencyId } });
    await transaction.overtimeAuthority.deleteMany({ where: { agencyId } });
    await transaction.lockedAttendanceAdjustmentPeriod.deleteMany({ where: { agencyId } });
    await transaction.lockedAttendanceAdjustment.deleteMany({ where: { agencyId } });
    await transaction.attendanceCorrectionEffect.deleteMany({ where: { agencyId } });
    await transaction.attendanceCorrectionEvidence.deleteMany({ where: { agencyId } });
    await transaction.attendanceCorrection.deleteMany({ where: { agencyId } });
    await transaction.approvalDecision.deleteMany({ where: { agencyId } });
    await transaction.approvalStep.deleteMany({ where: { agencyId } });
    await transaction.approvalRequest.deleteMany({ where: { agencyId } });
    await transaction.approvalRouteVersion.deleteMany({ where: { agencyId } });
  });
  await cleanupAttendanceWorkflowAgency(admin, agencyId, suffix);
}
