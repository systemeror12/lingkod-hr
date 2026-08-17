import type { ActiveSessionResponse, PermissionGrant } from '@lingkod-hr/auth';

export class AuthMeResponseDto implements ActiveSessionResponse {
  constructor(
    readonly userId: string,
    readonly agencyId: string,
    readonly membershipId: string,
    readonly agency: ActiveSessionResponse['agency'],
    readonly identity: ActiveSessionResponse['identity'],
    readonly effectiveRoles: ActiveSessionResponse['effectiveRoles'],
    readonly permissions: readonly PermissionGrant[],
  ) {}
}
