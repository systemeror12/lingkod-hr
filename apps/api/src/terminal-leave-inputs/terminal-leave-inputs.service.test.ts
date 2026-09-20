import { expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import {
  TerminalLeaveInputsService,
  qualifySeparationType,
  terminalLeaveInputAuditWriter,
} from './terminal-leave-inputs.service';

const documentsService = {} as ConstructorParameters<typeof TerminalLeaveInputsService>[1];
const separationsService = {} as ConstructorParameters<typeof TerminalLeaveInputsService>[2];
const agencyId = '00000000-0000-4000-8000-000000000001';
const separationCaseId = '00000000-0000-4000-8000-000000000002';
const snapshotId = '00000000-0000-4000-8000-000000000003';
const documentId = '00000000-0000-4000-8000-000000000004';

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'terminal-leave-input-service-test',
    userId: '00000000-0000-4000-8000-000000000005',
    agencyId,
    membershipId: '00000000-0000-4000-8000-000000000006',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

const read = { code: 'leave.terminal_inputs.read', scopePolicy: 'AGENCY' } as const;
const preservePermission = {
  code: 'leave.terminal_inputs.preserve',
  scopePolicy: 'AGENCY',
} as const;

function service() {
  return new TerminalLeaveInputsService(
    terminalLeaveInputAuditWriter,
    documentsService,
    separationsService,
  );
}

it('requires leave.terminal_inputs.read before exposing assessments', async () => {
  await expect(service().list(context([]))).rejects.toMatchObject({
    code: 'TERMINAL_LEAVE_INPUT_READ_FORBIDDEN',
    statusCode: 403,
  });
  await expect(service().findById(context([]), separationCaseId)).rejects.toMatchObject({
    code: 'TERMINAL_LEAVE_INPUT_READ_FORBIDDEN',
    statusCode: 403,
  });
  await expect(service().listCandidates(context([]))).rejects.toMatchObject({
    code: 'TERMINAL_LEAVE_INPUT_READ_FORBIDDEN',
    statusCode: 403,
  });
});

it('requires leave.terminal_inputs.preserve before preserving inputs', async () => {
  await expect(service().preserve(context([read]), { separationCaseId })).rejects.toMatchObject({
    code: 'TERMINAL_LEAVE_INPUT_PRESERVE_FORBIDDEN',
    statusCode: 403,
  });
});

it('requires evidence read access before binding documents', async () => {
  await expect(
    service().preserve(context([preservePermission]), {
      separationCaseId,
      clearanceDocumentId: documentId,
    }),
  ).rejects.toMatchObject({ code: 'TERMINAL_LEAVE_INPUT_EVIDENCE_FORBIDDEN', statusCode: 403 });
});

it('requires a reason when superseding a snapshot', async () => {
  await expect(
    service().preserve(context([preservePermission]), {
      separationCaseId,
      supersedesSnapshotId: snapshotId,
    }),
  ).rejects.toMatchObject({ code: 'TERMINAL_LEAVE_INPUT_REASON_REQUIRED', statusCode: 400 });
  await expect(
    service().preserve(context([preservePermission]), {
      separationCaseId,
      supersedesSnapshotId: snapshotId,
      reason: '   ',
    }),
  ).rejects.toMatchObject({ code: 'TERMINAL_LEAVE_INPUT_REASON_REQUIRED', statusCode: 400 });
});

it('maps only accepted authorities to qualifying separations', () => {
  expect(qualifySeparationType('RETIREMENT')).toBe('QUALIFYING');
  expect(qualifySeparationType('RESIGNATION')).toBe('QUALIFYING');
  expect(qualifySeparationType('DEATH')).toBe('QUALIFYING');
  expect(qualifySeparationType('EXPIRATION')).toBe('QUALIFYING');
  expect(qualifySeparationType('DISMISSAL')).toBe('NOT_QUALIFYING');
  expect(qualifySeparationType('DROPPING_FROM_ROLLS')).toBe('NOT_QUALIFYING');
  expect(qualifySeparationType('TERMINATION')).toBe('UNRESOLVED');
  expect(qualifySeparationType('TRANSFER')).toBe('UNRESOLVED');
});

it('validates handoff outcomes before touching the snapshot', async () => {
  const transaction = {} as Prisma.TransactionClient;
  await expect(
    service().recordHandoffOutcomeInTransaction(transaction, context([]), {
      snapshotId,
      attemptKey: '   ',
      result: 'ACCEPTED',
    }),
  ).rejects.toMatchObject({ code: 'TERMINAL_LEAVE_INPUT_ATTEMPT_KEY_REQUIRED', statusCode: 400 });
  await expect(
    service().recordHandoffOutcomeInTransaction(transaction, context([]), {
      snapshotId,
      attemptKey: 'attempt-1',
      result: 'UNSUPPORTED' as never,
    }),
  ).rejects.toMatchObject({ code: 'TERMINAL_LEAVE_INPUT_HANDOFF_RESULT_INVALID', statusCode: 400 });
  await expect(
    service().recordHandoffOutcomeInTransaction(transaction, context([]), {
      snapshotId,
      attemptKey: 'attempt-1',
      result: 'ACCEPTED',
    }),
  ).rejects.toMatchObject({
    code: 'TERMINAL_LEAVE_INPUT_HANDOFF_REFERENCE_REQUIRED',
    statusCode: 400,
  });
  await expect(
    service().recordHandoffOutcomeInTransaction(transaction, context([]), {
      snapshotId,
      attemptKey: 'attempt-1',
      result: 'REJECTED',
    }),
  ).rejects.toMatchObject({
    code: 'TERMINAL_LEAVE_INPUT_HANDOFF_REASON_REQUIRED',
    statusCode: 400,
  });
});

it('reports a missing snapshot for a handoff outcome', async () => {
  const transaction = {
    terminalLeaveInputSnapshot: { findFirst: async () => null },
  } as unknown as Prisma.TransactionClient;
  await expect(
    service().recordHandoffOutcomeInTransaction(transaction, context([]), {
      snapshotId,
      attemptKey: 'attempt-1',
      result: 'ACCEPTED',
      separationReference: { separationRecordId: snapshotId },
    }),
  ).rejects.toMatchObject({ code: 'TERMINAL_LEAVE_INPUT_SNAPSHOT_NOT_FOUND', statusCode: 404 });
});
