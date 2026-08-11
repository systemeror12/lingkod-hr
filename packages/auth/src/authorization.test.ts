import { expect, it } from 'vitest';
import {
  canAccessRecord,
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
  expect(hasMfaEvidence(['pwd', 'otp'])).toBe(true);
  expect(hasMfaEvidence(['mfa'])).toBe(true);
  expect(hasMfaEvidence(['otp'])).toBe(false);
  expect(hasMfaEvidence(['pwd'])).toBe(false);
  expect(permissionsRequireMfa([{ code: 'security.events.read', scopePolicy: 'AGENCY' }])).toBe(
    true,
  );
  expect(permissionsRequireMfa([{ code: 'audit.events.read', scopePolicy: 'AGENCY' }])).toBe(false);
});
