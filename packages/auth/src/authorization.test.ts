import { expect, it } from 'vitest';
import {
  canAccessRecord,
  hasAllPermissions,
  hasMfaEvidence,
  hasPermission,
  permissionsRequireMfa,
} from './authorization';

const context = {
  requestId: 'req-1',
  userId: 'user-1',
  agencyId: 'agency-1',
  membershipId: 'membership-1',
  primaryOrganizationUnitId: 'office-1',
  permissions: [
    { code: 'personnel.records.read', scopePolicy: 'OWN' as const },
    { code: 'organization.units.read', scopePolicy: 'AGENCY' as const },
  ],
};

it('denies a permission outside the authenticated agency', () => {
  expect(hasPermission(context, 'organization.units.read', { agencyId: 'agency-2' })).toBe(false);
});

it('requires every permission for a compound protected action', () => {
  expect(hasAllPermissions(context, ['personnel.records.read', 'organization.units.read'])).toBe(
    true,
  );
  expect(
    hasAllPermissions(context, ['personnel.records.read', 'security.users.update_roles']),
  ).toBe(false);
});

it('enforces the permission scope for a record', () => {
  expect(
    canAccessRecord(context, 'personnel.records.read', {
      agencyId: 'agency-1',
      ownerUserId: 'user-1',
    }),
  ).toBe(true);
  expect(
    canAccessRecord(context, 'personnel.records.read', {
      agencyId: 'agency-1',
      ownerUserId: 'user-2',
    }),
  ).toBe(false);
});

it('recognizes MFA evidence without treating a password as MFA', () => {
  expect(hasMfaEvidence(['pwd'])).toBe(false);
  expect(hasMfaEvidence(['pwd', 'totp'])).toBe(true);
  expect(hasMfaEvidence(['pwd', 'recovery_code'])).toBe(true);
  expect(hasMfaEvidence(['totp'])).toBe(false);
  expect(hasMfaEvidence(['recovery_code'])).toBe(false);
  // Methods only an identity provider reported are not evidence.
  expect(hasMfaEvidence(['mfa'])).toBe(false);
  expect(hasMfaEvidence(['pwd', 'otp'])).toBe(false);
  expect(hasMfaEvidence(['pwd', 'webauthn'])).toBe(false);
  expect(permissionsRequireMfa([{ code: 'security.events.read', scopePolicy: 'AGENCY' }])).toBe(
    true,
  );
  expect(permissionsRequireMfa([{ code: 'audit.events.read', scopePolicy: 'AGENCY' }])).toBe(false);
});
