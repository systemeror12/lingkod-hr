import type { ActiveSession } from './session';
export function hasPermission(session: ActiveSession, permission: string): boolean {
  return session.permissions.some((grant) => grant.code === permission);
}

/** Lifecycle stages of the primary navigation, in the order a position is filled and served. */
export const lifecycleStages = [
  'Structure',
  'Merit selection',
  'Personnel',
  'Time & attendance',
  'Leave',
  'Overtime',
  'Oversight',
] as const;

export type LifecycleStage = (typeof lifecycleStages)[number];

export interface Destination {
  href: string;
  label: string;
  /** `null` places the destination above the stages, like the Work queue. */
  stage: LifecycleStage | null;
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
  { href: '/dashboard', label: 'Work queue', stage: null },
  {
    href: '/organization',
    label: 'Organization',
    stage: 'Structure',
    visible: (session) =>
      hasPermission(session, 'organization.units.read') ||
      hasPermission(session, 'organization.agency.read'),
  },
  {
    href: '/staffing-authorities',
    label: 'Staffing Authorities',
    stage: 'Structure',
    permission: 'staffing.authorities.read',
  },
  {
    href: '/qualification-standards',
    label: 'Qualification Standards',
    stage: 'Structure',
    permission: 'qualification.standards.read',
  },
  {
    href: '/plantilla-positions',
    label: 'Plantilla Positions',
    stage: 'Structure',
    permission: 'positions.items.read',
  },
  {
    href: '/recruitment',
    label: 'Recruitment',
    stage: 'Merit selection',
    visible: (session) =>
      hasPermission(session, 'recruitment.requests.read') ||
      hasPermission(session, 'recruitment.vacancies.read'),
  },
  {
    href: '/appointments',
    label: 'Appointments',
    stage: 'Merit selection',
    permission: 'appointments.records.read',
  },
  {
    href: '/employees',
    label: 'Employees',
    stage: 'Personnel',
    permission: 'personnel.employees.read',
  },
  {
    href: '/pds',
    label: 'My PDS',
    stage: 'Personnel',
    permission: 'personnel.pds.read',
    visible: (session) =>
      session.permissions.some(
        ({ code, scopePolicy }) => code === 'personnel.pds.read' && scopePolicy === 'OWN',
      ),
  },
  {
    href: '/my-documents',
    label: 'My Documents',
    stage: 'Personnel',
    visible: (session) =>
      session.permissions.some(
        ({ code, scopePolicy }) => code === 'personnel.documents.read' && scopePolicy === 'OWN',
      ),
  },
  {
    href: '/my-saln',
    label: 'My SALN Compliance',
    stage: 'Personnel',
    visible: (session) =>
      session.permissions.some(
        ({ code, scopePolicy }) =>
          code === 'personnel.saln_compliance.read' && scopePolicy === 'OWN',
      ),
  },
  {
    href: '/personnel-baselines',
    label: 'Personnel Baselines',
    stage: 'Personnel',
    permission: 'personnel.baselines.read',
  },
  {
    href: '/personnel-actions',
    label: 'Personnel Actions',
    stage: 'Personnel',
    permission: 'personnel.actions.read',
  },
  {
    href: '/service-records',
    label: 'Service Records',
    stage: 'Personnel',
    permission: 'personnel.service_records.read',
  },
  {
    href: '/attendance',
    label: 'Attendance',
    stage: 'Time & attendance',
    visible: (session) =>
      hasPermission(session, 'attendance.events.read') ||
      hasPermission(session, 'attendance.events.clock') ||
      hasPermission(session, 'attendance.configuration.read'),
  },
  {
    href: '/attendance-configuration',
    label: 'Attendance Configuration',
    stage: 'Time & attendance',
    permission: 'attendance.configuration.manage',
  },
  {
    href: '/attendance-contexts',
    label: 'Attendance Contexts',
    stage: 'Time & attendance',
    permission: 'attendance.contexts.read',
  },
  {
    href: '/attendance-days',
    label: 'Attendance Days',
    stage: 'Time & attendance',
    visible: (session) =>
      hasPermission(session, 'attendance.days.read') ||
      hasPermission(session, 'attendance.days.calculate'),
  },
  {
    href: '/attendance-corrections',
    label: 'Attendance Corrections',
    stage: 'Time & attendance',
    visible: (session) =>
      hasPermission(session, 'attendance.days.read') ||
      hasPermission(session, 'attendance.corrections.create'),
  },
  {
    href: '/attendance-dtrs',
    label: 'Daily Time Records',
    stage: 'Time & attendance',
    visible: (session) =>
      hasPermission(session, 'attendance.days.read') ||
      hasPermission(session, 'attendance.reports.read') ||
      hasPermission(session, 'attendance.submissions.create'),
  },
  {
    href: '/attendance-periods',
    label: 'Attendance Periods',
    stage: 'Time & attendance',
    visible: (session) =>
      hasPermission(session, 'attendance.reports.read') ||
      hasPermission(session, 'attendance.periods.submit') ||
      hasPermission(session, 'attendance.periods.return') ||
      hasPermission(session, 'attendance.periods.approve') ||
      hasPermission(session, 'attendance.periods.lock'),
  },
  {
    href: '/leave-policies',
    label: 'Leave Policies',
    stage: 'Leave',
    permission: 'leave.types.read',
  },
  {
    href: '/leave-accounts',
    label: 'Leave Accounts',
    stage: 'Leave',
    permission: 'leave.accounts.read',
  },
  {
    href: '/leave-applications',
    label: 'Leave Applications',
    stage: 'Leave',
    permission: 'leave.applications.create',
  },
  {
    href: '/mandatory-leave',
    label: 'Mandatory Leave',
    stage: 'Leave',
    permission: 'leave.mandatory_assessments.read',
  },
  {
    href: '/leave-monetization',
    label: 'Leave Monetization',
    stage: 'Leave',
    permission: 'leave.accounts.read',
  },
  {
    href: '/terminal-leave-inputs',
    label: 'Terminal Leave Inputs',
    stage: 'Leave',
    permission: 'leave.terminal_inputs.read',
  },
  {
    href: '/overtime-authorities',
    label: 'Overtime Authorities',
    stage: 'Overtime',
    permission: 'overtime.authorities.read',
  },
  {
    href: '/coc-accounts',
    label: 'COC Accounts',
    stage: 'Overtime',
    permission: 'overtime.coc.read',
  },
  {
    href: '/users-access',
    label: 'Users & Access',
    stage: 'Oversight',
    permission: 'security.users.read',
  },
  { href: '/audit', label: 'Audit Log', stage: 'Oversight', permission: 'audit.events.read' },
];

export function authorizedDestinations(session: ActiveSession): readonly Destination[] {
  return destinations
    .filter(
      ({ permission, visible }) =>
        (permission === undefined || hasPermission(session, permission)) &&
        (visible === undefined || visible(session)),
    )
    .map(({ href, label, stage }) => ({ href, label, stage }));
}

export interface StageGroup {
  stage: LifecycleStage;
  destinations: readonly Destination[];
}

/** Split destinations into the entries above the stages and the non-empty stage groups. */
export function navigationGroups(destinations: readonly Destination[]): {
  workQueue: readonly Destination[];
  groups: readonly StageGroup[];
} {
  return {
    workQueue: destinations.filter(({ stage }) => stage === null),
    groups: lifecycleStages
      .map((stage) => ({
        stage,
        destinations: destinations.filter((destination) => destination.stage === stage),
      }))
      .filter(({ destinations: members }) => members.length > 0),
  };
}

/** Cookie that keeps the navigation rail collapsed across navigation and reloads. */
export const navigationCollapsedCookie = 'lingkod-nav-collapsed';

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
