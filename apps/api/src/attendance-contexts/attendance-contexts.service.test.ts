import { expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { attendanceContextAuditWriter } from './attendance-contexts.audit';
import { AttendanceContextsService } from './attendance-contexts.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const employeeId = '00000000-0000-4000-8000-000000000005';
const documentVersionId = '00000000-0000-4000-8000-000000000008';
const documentsService = {} as ConstructorParameters<typeof AttendanceContextsService>[1];

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'attendance-context-service-test',
    userId: '00000000-0000-4000-8000-000000000002',
    agencyId,
    membershipId: '00000000-0000-4000-8000-000000000003',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

function service() {
  return new AttendanceContextsService(attendanceContextAuditWriter, documentsService);
}

const read = [{ code: 'attendance.contexts.read', scopePolicy: 'AGENCY' }] as const;
const create = [{ code: 'attendance.contexts.create', scopePolicy: 'AGENCY' }] as const;

it('rechecks Attendance Context permissions before any read or write', async () => {
  const contexts = service();

  await expect(contexts.list(context([]))).rejects.toMatchObject({
    code: 'ATTENDANCE_CONTEXT_READ_FORBIDDEN',
    statusCode: 403,
  });
  await expect(
    contexts.record(context([]), {
      employeeId,
      contextType: 'OFFICIAL_BUSINESS',
      coverageMode: 'WHOLE_WORK_DATE',
      workDate: '2026-01-05',
      reason: 'Field validation.',
    }),
  ).rejects.toMatchObject({
    code: 'ATTENDANCE_CONTEXT_CREATE_FORBIDDEN',
    statusCode: 403,
  });
  await expect(
    contexts.resolveCoverage(context([]), employeeId, '2026-01-05', {
      startsAt: '2026-01-05T00:00:00.000Z',
      endsAt: '2026-01-05T08:00:00.000Z',
    }),
  ).rejects.toMatchObject({
    code: 'ATTENDANCE_CONTEXT_READ_FORBIDDEN',
    statusCode: 403,
  });
});

it('keeps creating separate from reading Attendance Contexts', async () => {
  const contexts = service();

  await expect(contexts.list(context(create))).rejects.toMatchObject({
    code: 'ATTENDANCE_CONTEXT_READ_FORBIDDEN',
    statusCode: 403,
  });
  await expect(
    contexts.record(context(read), {
      employeeId,
      contextType: 'TRAINING',
      coverageMode: 'WHOLE_WORK_DATE',
      workDate: '2026-01-05',
      reason: 'Training.',
    }),
  ).rejects.toMatchObject({
    code: 'ATTENDANCE_CONTEXT_CREATE_FORBIDDEN',
    statusCode: 403,
  });
});

it('rejects Coverage that ends before it starts', async () => {
  const contexts = service();

  await expect(
    contexts.record(context(create), {
      employeeId,
      contextType: 'OFFICIAL_TRAVEL',
      coverageMode: 'TIMED',
      startsAt: '2026-01-05T09:00:00.000Z',
      endsAt: '2026-01-05T08:00:00.000Z',
      reason: 'Travel to the regional office.',
    }),
  ).rejects.toMatchObject({
    code: 'ATTENDANCE_CONTEXT_INVALID_INPUT',
    statusCode: 400,
  });
});

it('requires a linked authoritative source or supporting Document Version', async () => {
  const contexts = service();
  const baseInput = {
    employeeId,
    contextType: 'OFFICIAL_BUSINESS' as const,
    coverageMode: 'WHOLE_WORK_DATE' as const,
    workDate: '2026-01-05',
    reason: 'Official business abroad.',
  };

  await expect(contexts.record(context(create), baseInput)).rejects.toMatchObject({
    code: 'ATTENDANCE_CONTEXT_INVALID_INPUT',
    statusCode: 400,
  });
  await expect(
    contexts.record(context(create), { ...baseInput, sourceType: 'TravelOrder' }),
  ).rejects.toMatchObject({
    code: 'ATTENDANCE_CONTEXT_INVALID_INPUT',
    statusCode: 400,
  });
  await expect(
    contexts.record(context(create), {
      ...baseInput,
      evidenceDocumentVersionId: documentVersionId,
      sourceType: 'TravelOrder',
    }),
  ).rejects.toMatchObject({
    code: 'ATTENDANCE_CONTEXT_INVALID_INPUT',
    statusCode: 400,
  });
});

it('requires a reason for every Attendance Context', async () => {
  const contexts = service();

  await expect(
    contexts.record(context(create), {
      employeeId,
      contextType: 'APPROVED_ABSENCE',
      coverageMode: 'WHOLE_WORK_DATE',
      workDate: '2026-01-05',
      reason: ' ',
      evidenceDocumentVersionId: documentVersionId,
    }),
  ).rejects.toMatchObject({
    code: 'ATTENDANCE_CONTEXT_INVALID_INPUT',
    statusCode: 400,
  });
});

it('rejects an inverted Work Date window before reading coverage', async () => {
  const contexts = service();

  await expect(
    contexts.resolveCoverage(context(read), employeeId, '2026-01-05', {
      startsAt: '2026-01-05T08:00:00.000Z',
      endsAt: '2026-01-05T08:00:00.000Z',
    }),
  ).rejects.toMatchObject({
    code: 'ATTENDANCE_CONTEXT_WINDOW_INVALID',
    statusCode: 400,
  });
});
