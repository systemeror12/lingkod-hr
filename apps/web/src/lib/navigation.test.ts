import { expect, it } from 'vitest';
import {
  authorizedDestinations,
  canManageHrmoInvitations,
  isDestinationCurrent,
  lifecycleStages,
  navigationGroups,
  recordHref,
} from './navigation';
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

it('shows Users & Access to readers of users, and invitations only to an Agency Administrator', () => {
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
  expect(authorizedDestinations(hrmo).some(({ href }) => href === '/users-access')).toBe(true);
  expect(
    authorizedDestinations(session('employee', [])).some(({ href }) => href === '/users-access'),
  ).toBe(false);
});

it('shows My SALN Compliance only for own-record access', () => {
  const own = session('employee', []);
  own.permissions = [{ code: 'personnel.saln_compliance.read', scopePolicy: 'OWN' }];
  const agency = session('personnel_officer', ['personnel.saln_compliance.read']);

  expect(authorizedDestinations(own).some(({ href }) => href === '/my-saln')).toBe(true);
  expect(authorizedDestinations(agency).some(({ href }) => href === '/my-saln')).toBe(false);
});

it('keeps the authorized destination current on nested record routes only', () => {
  expect(isDestinationCurrent('/employees/employee-1/pds', '/employees')).toBe(true);
  expect(isDestinationCurrent('/employees', '/employees')).toBe(true);
  expect(isDestinationCurrent('/employees-other', '/employees')).toBe(false);
  expect(isDestinationCurrent('/my-documents', '/employees')).toBe(false);
});

it('retains register filters and effectivity while opening and leaving record history', () => {
  const form = recordHref('/plantilla-positions', 'q=Engineer&asOf=2026-09-01', {
    record: 'position-1',
    view: 'form',
    section: 'history',
  });
  expect(form).toBe(
    '/plantilla-positions?q=Engineer&asOf=2026-09-01&record=position-1&view=form&section=history',
  );
  expect(
    recordHref('/plantilla-positions', form.split('?')[1]!, {
      record: null,
      view: null,
      section: null,
    }),
  ).toBe('/plantilla-positions?q=Engineer&asOf=2026-09-01');
});

it('retains Agency Profile navigation for memberships permitted only to read the profile', () => {
  expect(
    authorizedDestinations(session('profile_reader', ['organization.agency.read'])).some(
      ({ href }) => href === '/organization',
    ),
  ).toBe(true);
});

it('groups authorized destinations by lifecycle stage below the Work queue', () => {
  const own = session('employee', ['leave.applications.create', 'audit.events.read']);
  own.permissions = [
    ...own.permissions,
    { code: 'personnel.pds.read', scopePolicy: 'OWN' },
    { code: 'personnel.documents.read', scopePolicy: 'OWN' },
    { code: 'personnel.saln_compliance.read', scopePolicy: 'OWN' },
  ];

  const { workQueue, groups } = navigationGroups(authorizedDestinations(own));

  expect(workQueue.map(({ label }) => label)).toEqual(['Work queue']);
  expect(groups.map(({ stage }) => stage)).toEqual(['Personnel', 'Leave', 'Oversight']);
  expect(groups[0]!.destinations.map(({ label }) => label)).toEqual([
    'My PDS',
    'My Documents',
    'My SALN Compliance',
  ]);
  expect(groups[1]!.destinations.map(({ href }) => href)).toEqual(['/leave-applications']);
  expect(groups[2]!.destinations.map(({ href }) => href)).toEqual(['/audit']);
});

it('orders every stage along the personnel lifecycle', () => {
  const administrator = session('agency_administrator', [
    'security.users.read',
    'security.users.invite',
    'security.users.update_roles',
    'organization.units.read',
    'recruitment.requests.read',
    'personnel.employees.read',
    'attendance.events.read',
    'leave.types.read',
  ]);

  const { groups } = navigationGroups(authorizedDestinations(administrator));

  expect(groups.map(({ stage }) => stage)).toEqual(lifecycleStages);
  expect(groups.at(-1)!.destinations.map(({ href }) => href)).toEqual(['/users-access']);
});
