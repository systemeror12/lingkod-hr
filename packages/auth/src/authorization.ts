export const SCOPE_POLICIES = [
  'OWN',
  'DIRECT_REPORTS',
  'ASSIGNED_OFFICE',
  'AGENCY',
  'RESTRICTED',
] as const;

export type ScopePolicy = (typeof SCOPE_POLICIES)[number];

export interface PermissionGrant {
  code: string;
  scopePolicy: ScopePolicy;
}

const SECOND_FACTOR_METHODS = ['totp', 'recovery_code'];

/** Whether a session's methods show a password plus a TOTP code or Recovery Code. */
export function hasMfaEvidence(methods: readonly string[]): boolean {
  return (
    methods.includes('pwd') && SECOND_FACTOR_METHODS.some((method) => methods.includes(method))
  );
}

export function permissionsRequireMfa(permissions: readonly PermissionGrant[]): boolean {
  return permissions.some(({ code }) => code.startsWith('security.'));
}

export interface RequestContext {
  requestId: string;
  userId: string;
  agencyId: string;
  membershipId: string;
  primaryOrganizationUnitId: string | null;
  permissions: readonly PermissionGrant[];
}

/** Whether `code` is held at any scope. This is the route guard's check. */
export function hasPermission(context: RequestContext, code: string): boolean {
  return context.permissions.some((grant) => grant.code === code);
}

/** Whether every one of `codes` is held at any scope. */
export function hasAllPermissions(context: RequestContext, codes: readonly string[]): boolean {
  return codes.every((code) => hasPermission(context, code));
}

/**
 * Whether `permission` is held through an `AGENCY` grant, so it reaches the
 * whole acting Agency. A service asks this, or the Employee Scope module, when
 * a narrower grant must not be enough.
 */
export function holdsAgencyWide(context: RequestContext, permission: string): boolean {
  return context.permissions.some(
    (grant) => grant.code === permission && grant.scopePolicy === 'AGENCY',
  );
}

export class AuthorizationError extends Error {
  constructor(message = 'The requested record is outside the authorized scope.') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export function assertAgencyAccess(context: RequestContext, agencyId: string): void {
  if (context.agencyId !== agencyId) {
    throw new AuthorizationError('The requested record belongs to another Agency.');
  }
}
