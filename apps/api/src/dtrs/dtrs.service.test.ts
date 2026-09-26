import { describe, expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { dtrAuditWriter } from './dtrs.audit';
import { parseDtrDayRuleSnapshot, DtrsService } from './dtrs.service';

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'dtr-service-test',
    userId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    agencyId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
    membershipId: '3f2504e0-4f89-41d3-9a0c-0305e82c3303',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

function service() {
  return new DtrsService(dtrAuditWriter, {} as never);
}

const periodId = '3f2504e0-4f89-41d3-9a0c-0305e82c3304';
const dtrId = '3f2504e0-4f89-41d3-9a0c-0305e82c3305';
const versionId = '3f2504e0-4f89-41d3-9a0c-0305e82c3306';

describe('DtrsService authorization gates', () => {
  it('refuses a preview without the attendance.days.read permission', async () => {
    await expect(
      service().preview(context([]), { attendancePeriodId: periodId }),
    ).rejects.toMatchObject({ code: 'DTR_READ_FORBIDDEN', statusCode: 403 });
    await expect(
      service().renderPreview(context([]), { attendancePeriodId: periodId }),
    ).rejects.toMatchObject({ code: 'DTR_READ_FORBIDDEN', statusCode: 403 });
  });

  it('refuses finalized reads without the attendance.reports.read permission', async () => {
    await expect(service().list(context([]))).rejects.toMatchObject({
      code: 'DTR_READ_FORBIDDEN',
      statusCode: 403,
    });
    await expect(service().findById(context([]), dtrId)).rejects.toMatchObject({
      code: 'DTR_READ_FORBIDDEN',
      statusCode: 403,
    });
  });

  it('refuses generation without the attendance.dtr.generate permission', async () => {
    await expect(service().generate(context([]), versionId)).rejects.toMatchObject({
      code: 'DTR_GENERATE_FORBIDDEN',
      statusCode: 403,
    });
  });

  it('refuses generation without Agency scope on the generate permission', async () => {
    await expect(
      service().generate(
        context([{ code: 'attendance.dtr.generate', scopePolicy: 'OWN' }]),
        versionId,
      ),
    ).rejects.toMatchObject({ code: 'DTR_GENERATE_FORBIDDEN', statusCode: 403 });
  });
});

describe('parseDtrDayRuleSnapshot', () => {
  it('narrows the stored snapshot fields', () => {
    expect(
      parseDtrDayRuleSnapshot({
        fingerprint: 'a'.repeat(64),
        timezone: 'Asia/Manila',
        assignmentId: 'assignment-1',
        dayRuleId: 'rule-1',
        eventIds: ['event-1', 7, 'effect-1'],
        capturedAt: '2026-06-01T00:00:00.000Z',
      }),
    ).toMatchObject({
      fingerprint: 'a'.repeat(64),
      timezone: 'Asia/Manila',
      assignmentId: 'assignment-1',
      dayRuleId: 'rule-1',
      eventIds: ['event-1', 'effect-1'],
    });
  });
});
