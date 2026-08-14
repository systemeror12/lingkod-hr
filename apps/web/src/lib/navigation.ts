import type { ActiveSession } from './session';
import { hasPermission } from './session';

export type DestinationIcon = 'dashboard' | 'users' | 'organization' | 'audit';

export interface Destination {
  href: string;
  label: string;
  icon: DestinationIcon;
}

const destinations: readonly (Destination & { permission?: string })[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  {
    href: '/users-access',
    label: 'Users & Access',
    icon: 'users',
    permission: 'security.users.read',
  },
  {
    href: '/organization',
    label: 'Organization',
    icon: 'organization',
    permission: 'organization.units.read',
  },
  { href: '/audit', label: 'Audit Log', icon: 'audit', permission: 'audit.events.read' },
];

export function authorizedDestinations(session: ActiveSession): readonly Destination[] {
  return destinations
    .filter(({ permission }) => permission === undefined || hasPermission(session, permission))
    .map(({ href, label, icon }) => ({ href, label, icon }));
}
