import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { attendanceSubmissionAuditWriter } from './attendance-submissions.audit';
import { AttendanceSubmissionsService } from './attendance-submissions.service';
import { createAttendanceSubmissionSchema } from './attendance-submissions.types';

// Each gate refuses before the transaction reads anything: without a grant the
// Employee Scope resolves to NONE without a query, so no database is needed.
vi.mock('@lingkod-hr/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lingkod-hr/database')>()),
  withDatabaseContext: (_context: unknown, work: (client: unknown) => unknown) => work({}),
}));

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'submission-service-test',
    userId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    agencyId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
    membershipId: '3f2504e0-4f89-41d3-9a0c-0305e82c3303',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

function service() {
  return new AttendanceSubmissionsService(
    attendanceSubmissionAuditWriter,
    { resolveFinalizedVersionInTransaction: async () => null } as never,
    {} as never,
  );
}

const periodId = '3f2504e0-4f89-41d3-9a0c-0305e82c3304';
const submissionId = '3f2504e0-4f89-41d3-9a0c-0305e82c3305';

describe('AttendanceSubmissionsService authorization gates', () => {
  it('refuses an own submission without the create permission', async () => {
    await expect(
      service().create(context([]), { attendancePeriodId: periodId }),
    ).rejects.toMatchObject({
      code: 'ATTENDANCE_SUBMISSION_CREATE_FORBIDDEN',
      statusCode: 403,
    });
  });

  it('refuses submit without the submit permission', async () => {
    await expect(service().submit(context([]), submissionId)).rejects.toMatchObject({
      code: 'ATTENDANCE_SUBMISSION_SUBMIT_FORBIDDEN',
      statusCode: 403,
    });
  });

  it('refuses a return without the return permission', async () => {
    await expect(
      service().returnForReason(context([]), submissionId, { reason: 'Incomplete.' }),
    ).rejects.toMatchObject({
      code: 'ATTENDANCE_SUBMISSION_RETURN_FORBIDDEN',
      statusCode: 403,
    });
  });

  it('refuses approval without the approve permission', async () => {
    await expect(service().approve(context([]), submissionId, {})).rejects.toMatchObject({
      code: 'ATTENDANCE_SUBMISSION_APPROVE_FORBIDDEN',
      statusCode: 403,
    });
  });

  it('refuses cancellation without the cancel permission', async () => {
    await expect(service().cancel(context([]), submissionId, {})).rejects.toMatchObject({
      code: 'ATTENDANCE_SUBMISSION_CANCEL_FORBIDDEN',
      statusCode: 403,
    });
  });

  it('refuses reads without the attendance.days.read permission', async () => {
    await expect(service().list(context([]))).rejects.toMatchObject({
      code: 'ATTENDANCE_SUBMISSION_READ_FORBIDDEN',
      statusCode: 403,
    });
    await expect(service().findById(context([]), submissionId)).rejects.toMatchObject({
      code: 'ATTENDANCE_SUBMISSION_READ_FORBIDDEN',
      statusCode: 403,
    });
  });
});

describe('createAttendanceSubmissionSchema', () => {
  it('accepts an own submission without an on-behalf reason', () => {
    expect(
      createAttendanceSubmissionSchema.safeParse({ attendancePeriodId: periodId }).success,
    ).toBe(true);
  });

  it('requires the reason and evidence together for an on-behalf fact', () => {
    const missingEvidence = createAttendanceSubmissionSchema.safeParse({
      attendancePeriodId: periodId,
      employeeId: '3f2504e0-4f89-41d3-9a0c-0305e82c3306',
      onBehalfReason: 'Employee is on field assignment.',
    });
    expect(missingEvidence.success).toBe(false);
    const complete = createAttendanceSubmissionSchema.safeParse({
      attendancePeriodId: periodId,
      employeeId: '3f2504e0-4f89-41d3-9a0c-0305e82c3306',
      onBehalfReason: 'Employee is on field assignment.',
      evidenceDocumentVersionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3307',
    });
    expect(complete.success).toBe(true);
  });
});
