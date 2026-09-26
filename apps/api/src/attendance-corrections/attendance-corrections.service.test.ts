import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { attendanceCorrectionAuditWriter } from './attendance-corrections.audit';
import { AttendanceCorrectionsService } from './attendance-corrections.service';
import { ApprovalCompletionRegistry } from '../approvals/approval.service';

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'correction-service-test',
    userId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    agencyId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
    membershipId: '3f2504e0-4f89-41d3-9a0c-0305e82c3303',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

function service() {
  const registry = new ApprovalCompletionRegistry();
  return new AttendanceCorrectionsService(
    attendanceCorrectionAuditWriter,
    { resolveActiveRouteInTransaction: vi.fn() } as never,
    registry,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('AttendanceCorrectionsService authorization gates', () => {
  it('registers its approval completion handler on initialization', () => {
    const registry = new ApprovalCompletionRegistry();
    const register = vi.spyOn(registry, 'register');
    new AttendanceCorrectionsService(
      attendanceCorrectionAuditWriter,
      {} as never,
      registry,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    ).onModuleInit();
    expect(register).toHaveBeenCalledWith('ATTENDANCE_CORRECTION', expect.any(Function));
  });

  it('refuses creation without the create permission', async () => {
    await expect(service().create(context([]), {} as never)).rejects.toMatchObject({
      code: 'ATTENDANCE_CORRECTION_CREATE_FORBIDDEN',
      statusCode: 403,
    });
  });

  it('refuses submission without the submit permission', async () => {
    await expect(
      service().submit(context([]), '3f2504e0-4f89-41d3-9a0c-0305e82c3304'),
    ).rejects.toMatchObject({ code: 'ATTENDANCE_CORRECTION_SUBMIT_FORBIDDEN', statusCode: 403 });
  });

  it('refuses factual approval without the approve permission', async () => {
    await expect(
      service().approve(context([]), '3f2504e0-4f89-41d3-9a0c-0305e82c3304', 'Approved.'),
    ).rejects.toMatchObject({ code: 'ATTENDANCE_CORRECTION_APPROVE_FORBIDDEN', statusCode: 403 });
  });

  it('refuses locked authorization without the authorize permission', async () => {
    await expect(
      service().authorizeLocked(context([]), '3f2504e0-4f89-41d3-9a0c-0305e82c3304', undefined),
    ).rejects.toMatchObject({
      code: 'ATTENDANCE_CORRECTION_AUTHORIZE_FORBIDDEN',
      statusCode: 403,
    });
  });

  it('requires a return reason before touching the transaction', async () => {
    await expect(
      service().returnForInformation(
        context([{ code: 'attendance.corrections.return', scopePolicy: 'AGENCY' }]),
        '3f2504e0-4f89-41d3-9a0c-0305e82c3304',
        '   ',
      ),
    ).rejects.toMatchObject({ code: 'ATTENDANCE_CORRECTION_REASON_REQUIRED', statusCode: 400 });
  });

  it('requires a rejection reason before touching the transaction', async () => {
    await expect(
      service().reject(
        context([{ code: 'attendance.corrections.reject', scopePolicy: 'AGENCY' }]),
        '3f2504e0-4f89-41d3-9a0c-0305e82c3304',
        '',
      ),
    ).rejects.toMatchObject({ code: 'ATTENDANCE_CORRECTION_REASON_REQUIRED', statusCode: 400 });
  });

  it('requires a cancellation reason before touching the transaction', async () => {
    await expect(
      service().cancel(
        context([{ code: 'attendance.corrections.cancel', scopePolicy: 'AGENCY' }]),
        '3f2504e0-4f89-41d3-9a0c-0305e82c3304',
        '',
      ),
    ).rejects.toMatchObject({ code: 'ATTENDANCE_CORRECTION_REASON_REQUIRED', statusCode: 400 });
  });
});
