import { expect, it } from 'vitest';
import { authorizedDestinations, canManageHrmoInvitations } from './navigation';
import type { ActiveSession } from './session';

function session(roleCode: string, permissions: readonly string[]): ActiveSession {
  return {
    userId: '00000000-0000-4000-8000-000000000001',
    agencyId: '00000000-0000-4000-8000-000000000002',
    membershipId: '00000000-0000-4000-8000-000000000003',
    agency: { id: '00000000-0000-4000-8000-000000000002', name: 'Test Agency', acronym: null },
    identity: {
      id: '00000000-0000-4000-8000-000000000001',
      displayName: 'Test User',
      email: 'test@example.test',
    },
    effectiveRoles: [{ code: roleCode, name: roleCode }],
    permissions: permissions.map((code) => ({ code, scopePolicy: 'AGENCY' as const })),
  };
}

it('shows Users & Access only to an Agency Administrator with both handoff permissions', () => {
  const administrator = session('agency_administrator', [
    'security.users.read',
    'security.users.invite',
    'security.users.update_roles',
  ]);
  const hrmo = session('hrmo_administrator', ['security.users.read', 'security.users.invite']);

  expect(canManageHrmoInvitations(administrator)).toBe(true);
  expect(canManageHrmoInvitations(hrmo)).toBe(false);
  expect(authorizedDestinations(administrator).some(({ href }) => href === '/users-access')).toBe(
    true,
  );
  expect(authorizedDestinations(hrmo).some(({ href }) => href === '/users-access')).toBe(false);
});
