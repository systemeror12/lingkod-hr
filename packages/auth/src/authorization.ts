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

const MFA_METHODS = new Set([
  'face',
  'fpt',
  'hwk',
  'iris',
  'mfa',
  'otp',
  'passkey',
  'retina',
  'sms',
  'totp',
  'webauthn',
]);

export function hasMfaEvidence(methods: readonly string[]): boolean {
  return methods.some((method) => MFA_METHODS.has(method.toLowerCase()));
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

export interface AgencyRecord {
  agencyId: string;
  ownerUserId?: string;
  supervisorMembershipId?: string;
  organizationUnitId?: string;
  allowedMembershipIds?: readonly string[];
}

export function hasPermission(
  context: RequestContext,
  code: string,
  record?: AgencyRecord,
): boolean {
  if (record && record.agencyId !== context.agencyId) return false;

  return context.permissions.some(
    (grant) => grant.code === code && (!record || grant.scopePolicy === 'AGENCY'),
  );
}

export function canAccessRecord(
  context: RequestContext,
  code: string,
  record: AgencyRecord,
): boolean {
  if (record.agencyId !== context.agencyId) return false;

  return context.permissions.some((grant) => {
    if (grant.code !== code) return false;
    switch (grant.scopePolicy) {
      case 'AGENCY':
        return true;
      case 'OWN':
        return record.ownerUserId === context.userId;
      case 'DIRECT_REPORTS':
        return record.supervisorMembershipId === context.membershipId;
      case 'ASSIGNED_OFFICE':
        return (
          context.primaryOrganizationUnitId !== null &&
          record.organizationUnitId === context.primaryOrganizationUnitId
        );
      case 'RESTRICTED':
        return record.allowedMembershipIds?.includes(context.membershipId) ?? false;
    }
  });
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

export function assertRecordAccess(
  context: RequestContext,
  permission: string,
  record: AgencyRecord,
): void {
  if (!canAccessRecord(context, permission, record)) {
    throw new AuthorizationError();
  }
}
