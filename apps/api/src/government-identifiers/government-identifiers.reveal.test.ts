import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { encryptProtectedValue } from '@lingkod-hr/config';
import {
  governmentIdentifierAuditWriter,
  GovernmentIdentifiersService,
} from './government-identifiers.service';

const databaseMock = vi.hoisted(() => ({ withDatabaseContext: vi.fn() }));

vi.mock('@lingkod-hr/database', () => databaseMock);

const agencyId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const membershipId = '00000000-0000-4000-8000-000000000003';
const employeeId = '00000000-0000-4000-8000-000000000004';
const identifierId = '00000000-0000-4000-8000-000000000005';
const key = Buffer.alloc(32, 7);

const employee = {
  id: employeeId,
  memberships: [{ id: membershipId, userId }],
  currentServiceSegment: null,
};

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'government-identifiers-reveal-test',
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions,
  };
}

function record(encryptedValue: Uint8Array) {
  return {
    id: identifierId,
    agencyId,
    employeeId,
    identifierType: 'TIN',
    encryptedValue,
    encryptionVersion: 1,
    maskedValue: '********1234',
    verifiedAt: null,
    status: 'ACTIVE',
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveTo: null,
    reason: null,
    evidenceDocumentId: null,
    evidenceDocumentVersionId: null,
    replacesIdentifierId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function setupTransaction(identifier: ReturnType<typeof record>) {
  const auditEvents: Array<{ data: Record<string, unknown> }> = [];
  const transaction = {
    governmentIdentifier: {
      findFirst: vi.fn().mockResolvedValue(identifier),
    },
    employee: {
      findUnique: vi.fn().mockResolvedValue(employee),
    },
    auditEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditEvents.push({ data });
        return data;
      }),
    },
  };
  databaseMock.withDatabaseContext.mockImplementationOnce(
    async (_databaseContext: unknown, work: (value: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  );
  return { auditEvents, transaction };
}

function sealedValue(value: string) {
  return encryptProtectedValue(value, key, {
    metadata: JSON.stringify({ employeeId, identifierType: 'TIN' }),
  });
}

it('audits a reveal denied by permission without exposing the value', async () => {
  const plaintext = 'TIN-123456789';
  const sealed = sealedValue(plaintext);
  const { auditEvents } = setupTransaction(record(sealed.envelope));
  process.env.DATA_ENCRYPTION_KEY = key.toString('hex');
  const service = new GovernmentIdentifiersService(governmentIdentifierAuditWriter);

  await expect(
    service.reveal(
      context([{ code: 'personnel.identifiers.read', scopePolicy: 'AGENCY' }]),
      employeeId,
      identifierId,
      { reason: 'Review the submitted record.' },
    ),
  ).rejects.toMatchObject({ statusCode: 404, code: 'GOVERNMENT_IDENTIFIER_NOT_FOUND' });

  expect(auditEvents).toHaveLength(1);
  expect(auditEvents[0]?.data).toMatchObject({
    action: 'GOVERNMENT_IDENTIFIER_REVEAL_ATTEMPTED',
    newStatus: 'DENIED',
  });
  expect(JSON.stringify(auditEvents[0]?.data.metadata)).not.toContain(plaintext);
});

it('returns plaintext only on an authorized reveal and keeps it out of the audit event', async () => {
  const plaintext = 'TIN-123456789';
  const sealed = sealedValue(plaintext);
  const { auditEvents } = setupTransaction(record(sealed.envelope));
  process.env.DATA_ENCRYPTION_KEY = key.toString('hex');
  const service = new GovernmentIdentifiersService(governmentIdentifierAuditWriter);

  await expect(
    service.reveal(
      context([{ code: 'personnel.identifiers.reveal', scopePolicy: 'AGENCY' }]),
      employeeId,
      identifierId,
      { reason: plaintext },
    ),
  ).resolves.toMatchObject({ value: plaintext, maskedValue: '********1234' });

  expect(auditEvents).toHaveLength(1);
  expect(auditEvents[0]?.data).toMatchObject({
    action: 'GOVERNMENT_IDENTIFIER_REVEAL_ATTEMPTED',
    newStatus: 'REVEALED',
    reason: null,
  });
  expect(JSON.stringify(auditEvents[0]?.data)).not.toContain(plaintext);
  expect(JSON.stringify(auditEvents[0]?.data.metadata)).not.toContain(plaintext);
});

it('reveals values returned from Prisma as Uint8Array', async () => {
  const plaintext = 'TIN-123456789';
  const sealed = sealedValue(plaintext);
  setupTransaction(record(new Uint8Array(sealed.envelope)));
  process.env.DATA_ENCRYPTION_KEY = key.toString('hex');
  const service = new GovernmentIdentifiersService(governmentIdentifierAuditWriter);

  await expect(
    service.reveal(
      context([{ code: 'personnel.identifiers.reveal', scopePolicy: 'AGENCY' }]),
      employeeId,
      identifierId,
      { reason: 'Review the submitted record.' },
    ),
  ).resolves.toMatchObject({ value: plaintext });
});

it('audits tampered ciphertext as a failed reveal without exposing the value', async () => {
  const plaintext = 'TIN-123456789';
  const sealed = sealedValue(plaintext);
  const tampered = Buffer.from(sealed.envelope);
  const lastByte = tampered.length - 1;
  tampered[lastByte] = (tampered[lastByte] ?? 0) ^ 1;
  const { auditEvents } = setupTransaction(record(tampered));
  process.env.DATA_ENCRYPTION_KEY = key.toString('hex');
  const service = new GovernmentIdentifiersService(governmentIdentifierAuditWriter);

  await expect(
    service.reveal(
      context([{ code: 'personnel.identifiers.reveal', scopePolicy: 'AGENCY' }]),
      employeeId,
      identifierId,
      { reason: 'Review the submitted record.' },
    ),
  ).rejects.toMatchObject({ statusCode: 500, code: 'GOVERNMENT_IDENTIFIER_REVEAL_FAILED' });

  expect(auditEvents).toHaveLength(1);
  expect(auditEvents[0]?.data).toMatchObject({
    action: 'GOVERNMENT_IDENTIFIER_REVEAL_ATTEMPTED',
    newStatus: 'FAILED',
  });
  expect(JSON.stringify(auditEvents[0]?.data.metadata)).not.toContain(plaintext);
});
