import { describe, expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { attendancePeriodAuditWriter } from './attendance-periods.audit';
import { AttendancePeriodsService } from './attendance-periods.service';

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'attendance-period-service-test',
    userId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    agencyId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
    membershipId: '3f2504e0-4f89-41d3-9a0c-0305e82c3303',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

function service() {
  return new AttendancePeriodsService(attendancePeriodAuditWriter, {} as never, {} as never);
}

const periodId = '3f2504e0-4f89-41d3-9a0c-0305e82c3304';
const versionId = '3f2504e0-4f89-41d3-9a0c-0305e82c3305';

describe('AttendancePeriodsService authorization gates', () => {
  it('requires the HR Administrator submit permission to open a review version', async () => {
    await expect(service().submitForReview(context([]), periodId)).rejects.toMatchObject({
      code: 'ATTENDANCE_PERIOD_SUBMIT_FORBIDDEN',
      statusCode: 403,
    });
    await expect(
      service().submitForReview(
        context([{ code: 'attendance.periods.submit', scopePolicy: 'ASSIGNED_OFFICE' }]),
        periodId,
      ),
    ).rejects.toMatchObject({ code: 'ATTENDANCE_PERIOD_SUBMIT_FORBIDDEN', statusCode: 403 });
  });

  it('requires a review permission to return or approve a version', async () => {
    await expect(
      service().returnForReason(context([]), versionId, { reason: 'Return.' }),
    ).rejects.toMatchObject({ code: 'ATTENDANCE_PERIOD_DECIDE_FORBIDDEN', statusCode: 403 });
    await expect(service().approve(context([]), versionId, {})).rejects.toMatchObject({
      code: 'ATTENDANCE_PERIOD_DECIDE_FORBIDDEN',
      statusCode: 403,
    });
  });

  it('requires the Agency-scoped HR Administrator lock permission', async () => {
    await expect(service().lock(context([]), versionId)).rejects.toMatchObject({
      code: 'ATTENDANCE_PERIOD_LOCK_FORBIDDEN',
      statusCode: 403,
    });
    await expect(
      service().lock(
        context([{ code: 'attendance.periods.lock', scopePolicy: 'ASSIGNED_OFFICE' }]),
        versionId,
      ),
    ).rejects.toMatchObject({ code: 'ATTENDANCE_PERIOD_LOCK_FORBIDDEN', statusCode: 403 });
  });

  it('requires the attendance.reports.read permission to read review output', async () => {
    await expect(service().list(context([]))).rejects.toMatchObject({
      code: 'ATTENDANCE_PERIOD_READ_FORBIDDEN',
      statusCode: 403,
    });
    await expect(service().findPublication(context([]), versionId)).rejects.toMatchObject({
      code: 'ATTENDANCE_PAYROLL_PUBLICATION_READ_FORBIDDEN',
      statusCode: 403,
    });
  });
});
