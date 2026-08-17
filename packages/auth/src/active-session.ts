import { SCOPE_POLICIES, type PermissionGrant } from './authorization';

export interface ActiveSessionResponse {
  userId: string;
  agencyId: string;
  membershipId: string;
  agency: {
    id: string;
    name: string;
    acronym: string | null;
  };
  identity: {
    id: string;
    displayName: string;
    email: string;
  };
  effectiveRoles: readonly {
    code: string;
    name: string;
  }[];
  permissions: readonly PermissionGrant[];
}

export type SessionDisplay = Pick<ActiveSessionResponse, 'agency' | 'identity' | 'effectiveRoles'>;

export function isActiveSessionResponse(value: unknown): value is ActiveSessionResponse {
  if (typeof value !== 'object' || value === null) return false;
  const session = value as Partial<ActiveSessionResponse>;
  return (
    typeof session.userId === 'string' &&
    typeof session.agencyId === 'string' &&
    typeof session.membershipId === 'string' &&
    typeof session.agency?.id === 'string' &&
    typeof session.agency.name === 'string' &&
    (session.agency.acronym === null || typeof session.agency.acronym === 'string') &&
    typeof session.identity?.id === 'string' &&
    typeof session.identity.displayName === 'string' &&
    typeof session.identity.email === 'string' &&
    Array.isArray(session.effectiveRoles) &&
    session.effectiveRoles.every(
      (role) =>
        typeof role === 'object' &&
        role !== null &&
        typeof role.code === 'string' &&
        typeof role.name === 'string',
    ) &&
    Array.isArray(session.permissions) &&
    session.permissions.every(
      (grant) =>
        typeof grant === 'object' &&
        grant !== null &&
        typeof grant.code === 'string' &&
        SCOPE_POLICIES.some((policy) => policy === grant.scopePolicy),
    )
  );
}
