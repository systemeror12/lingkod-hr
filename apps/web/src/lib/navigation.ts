import type { ActiveSession } from './session';
export function hasPermission(session: ActiveSession, permission: string): boolean {
  return session.permissions.some((grant) => grant.code === permission);
}

export type DestinationIcon =
  | 'dashboard'
  | 'users'
  | 'organization'
  | 'authority'
  | 'qualification'
  | 'position'
  | 'leave'
  | 'audit';

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
    visible: (session) =>
      hasPermission(session, 'organization.units.read') ||
      hasPermission(session, 'organization.agency.read'),
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
    href: '/recruitment',
    label: 'Recruitment',
    icon: 'authority',
    visible: (session) =>
      hasPermission(session, 'recruitment.requests.read') ||
      hasPermission(session, 'recruitment.vacancies.read'),
  },
  {
    href: '/appointments',
    label: 'Appointments',
    icon: 'authority',
    permission: 'appointments.records.read',
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
    href: '/my-saln',
    label: 'My SALN Compliance',
    icon: 'users',
    visible: (session) =>
      session.permissions.some(
        ({ code, scopePolicy }) =>
          code === 'personnel.saln_compliance.read' && scopePolicy === 'OWN',
      ),
  },
  {
    href: '/personnel-baselines',
    label: 'Personnel Baselines',
    icon: 'position',
    permission: 'personnel.baselines.read',
  },
  {
    href: '/personnel-actions',
    label: 'Personnel Actions',
    icon: 'authority',
    permission: 'personnel.actions.read',
  },
  {
    href: '/service-records',
    label: 'Service Records',
    icon: 'position',
    permission: 'personnel.service_records.read',
  },
  {
    href: '/attendance-configuration',
    label: 'Attendance Configuration',
    icon: 'position',
    permission: 'attendance.configuration.manage',
  },
  {
    href: '/leave-policies',
    label: 'Leave Policies',
    icon: 'leave',
    permission: 'leave.types.read',
  },
  {
    href: '/leave-accounts',
    label: 'Leave Accounts',
    icon: 'leave',
    permission: 'leave.accounts.read',
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

export function isDestinationCurrent(pathname: string, destination: string): boolean {
  return pathname === destination || pathname.startsWith(`${destination}/`);
}

/** Change record context without discarding the register's filters or effective date. */
export function recordHref(
  pathname: string,
  search: string,
  values: Record<string, string | null>,
): string {
  const next = new URLSearchParams(search);
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
  }
  return `${pathname}${next.size ? `?${next}` : ''}`;
}
