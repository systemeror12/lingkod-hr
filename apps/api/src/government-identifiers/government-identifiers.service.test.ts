import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import {
  sanitizeGovernmentIdentifierAuditMetadata,
  governmentIdentifierAuditWriter,
  GovernmentIdentifiersService,
  GovernmentIdentifiersServiceError,
} from './government-identifiers.service';

vi.mock('@lingkod-hr/config', async (importOriginal) => {
  const original = await importOriginal<typeof import('@lingkod-hr/config')>();
  return {
    ...original,
    getConfig: () => ({ ...original.getConfig(), DATA_ENCRYPTION_KEY: undefined }),
  };
});

const context: RequestContext = {
  requestId: 'government-identifiers-service-test',
  userId: '00000000-0000-4000-8000-000000000001',
  agencyId: '00000000-0000-4000-8000-000000000002',
  membershipId: '00000000-0000-4000-8000-000000000003',
  primaryOrganizationUnitId: null,
  permissions: [],
};

it('rechecks read and manage permissions at the service boundary', async () => {
  const service = new GovernmentIdentifiersService(governmentIdentifierAuditWriter);
  const employeeId = '00000000-0000-4000-8000-000000000004';

  await expect(service.listActive(context, employeeId)).rejects.toMatchObject({
    code: 'GOVERNMENT_IDENTIFIER_READ_FORBIDDEN',
    statusCode: 403,
  });
  await expect(
    service.create(context, employeeId, {
      identifierType: 'TIN',
      value: '123456789',
      effectiveFrom: '2026-09-01',
    }),
  ).rejects.toMatchObject({
    code: 'GOVERNMENT_IDENTIFIER_MANAGE_FORBIDDEN',
    statusCode: 403,
  });
});

it('fails safely when encryption is unavailable before persistence', async () => {
  const service = new GovernmentIdentifiersService(governmentIdentifierAuditWriter);
  const employeeId = '00000000-0000-4000-8000-000000000004';
  const manageContext = {
    ...context,
    permissions: [{ code: 'personnel.identifiers.manage', scopePolicy: 'AGENCY' as const }],
  };

  await expect(
    service.create(manageContext, employeeId, {
      identifierType: 'TIN',
      value: '123456789',
      effectiveFrom: '2026-09-01',
    }),
  ).rejects.toMatchObject({
    code: 'GOVERNMENT_IDENTIFIER_ENCRYPTION_UNAVAILABLE',
    statusCode: 503,
  });
});

it('uses a typed error for government identifier workflow failures', () => {
  expect(new GovernmentIdentifiersServiceError('message', 409, 'CODE')).toBeInstanceOf(Error);
});

it('removes protected fields from nested audit metadata', () => {
  expect(
    sanitizeGovernmentIdentifierAuditMetadata({
      maskedValue: '********1234',
      value: '123456789123',
      after: {
        maskedValue: '********4321',
        encryptedValue: 'ciphertext',
        reason: 'Corrected value',
      },
      nested: [{ plaintext: 'secret', safe: true }],
    }),
  ).toEqual({
    maskedValue: '********1234',
    after: { maskedValue: '********4321', reason: 'Corrected value' },
    nested: [{ safe: true }],
  });

  expect(
    sanitizeGovernmentIdentifierAuditMetadata(
      JSON.parse(
        '{"__proto__":{"leaked":"secret"},"constructor":{"leaked":"secret"},"prototype":{"leaked":"secret"}}',
      ),
    ),
  ).toEqual({});
});
