import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export interface PermissionGrant {
  code: string;
  scopePolicy: string;
}

export interface ActiveSession {
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

function isActiveSession(value: unknown): value is ActiveSession {
  if (typeof value !== 'object' || value === null) return false;
  const session = value as Partial<ActiveSession>;
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
        typeof grant.scopePolicy === 'string',
    )
  );
}

export const getActiveSession = cache(async (): Promise<ActiveSession> => {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const cookieStore = await cookies();
  const response = await fetch(`${apiUrl}/api/v1/auth/me`, {
    headers: {
      cookie: cookieStore.toString(),
      origin: new URL(appUrl).origin,
    },
    cache: 'no-store',
  });

  if (response.status === 401) {
    redirect(`${apiUrl}/api/v1/auth/login`);
  }
  if (!response.ok) {
    throw new Error('The protected workspace could not be loaded.');
  }

  const value: unknown = await response.json();
  if (!isActiveSession(value)) {
    throw new Error('The protected workspace returned an invalid session context.');
  }
  return value;
});

export function hasPermission(session: ActiveSession, permission: string): boolean {
  return session.permissions.some((grant) => grant.code === permission);
}
