import type { ActiveSession } from './session';
import { hasPermission } from './session';

export type DestinationIcon =
  'dashboard' | 'users' | 'organization' | 'authority' | 'qualification' | 'position' | 'audit';

export interface Destination {
  href: string;
  label: string;
  icon: DestinationIcon;
}

export function canManageHrmoInvitations(session: ActiveSession): boolean {
  return (
    session.effectiveRoles.some(({ code }) => code === 'agency_administrator') &&
    hasPermission(session, 'security.users.invite') &&
    hasPermission(session, 'security.users.update_roles')
  );
}

const destinations: readonly (Destination & {
  permission?: string;
  visible?: (session: ActiveSession) => boolean;
})[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  {
    href: '/users-access',
    label: 'Users & Access',
    icon: 'users',
    visible: canManageHrmoInvitations,
  },
  {
    href: '/organization',
    label: 'Organization',
    icon: 'organization',
    permission: 'organization.units.read',
  },
  {
    href: '/staffing-authorities',
    label: 'Staffing Authorities',
    icon: 'authority',
    permission: 'staffing.authorities.read',
  },
  {
    href: '/qualification-standards',
    label: 'Qualification Standards',
    icon: 'qualification',
    permission: 'qualification.standards.read',
  },
  {
    href: '/plantilla-positions',
    label: 'Plantilla Positions',
    icon: 'position',
    permission: 'positions.items.read',
  },
  {
    href: '/employees',
    label: 'Employees',
    icon: 'users',
    permission: 'personnel.employees.read',
  },
  {
    href: '/pds',
    label: 'My PDS',
    icon: 'users',
    permission: 'personnel.pds.read',
    visible: (session) =>
      session.permissions.some(
        ({ code, scopePolicy }) => code === 'personnel.pds.read' && scopePolicy === 'OWN',
      ),
  },
  {
    href: '/my-documents',
    label: 'My Documents',
    icon: 'users',
    visible: (session) =>
      session.permissions.some(
        ({ code, scopePolicy }) => code === 'personnel.documents.read' && scopePolicy === 'OWN',
      ),
  },
  {
    href: '/personnel-baselines',
    label: 'Personnel Baselines',
    icon: 'position',
    permission: 'personnel.baselines.read',
  },
  { href: '/audit', label: 'Audit Log', icon: 'audit', permission: 'audit.events.read' },
];

export function authorizedDestinations(session: ActiveSession): readonly Destination[] {
  return destinations
    .filter(
      ({ permission, visible }) =>
        (permission === undefined || hasPermission(session, permission)) &&
        (visible === undefined || visible(session)),
    )
    .map(({ href, label, icon }) => ({ href, label, icon }));
}
