import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import type { AuthenticatedRequest } from './auth.types';

export const REQUIRED_PERMISSIONS = 'required_permissions';
export const REQUIRED_ROLES = 'required_roles';
export const SKIP_IDLE_RENEWAL = 'skip_idle_renewal';

export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const RequireRole = (...roles: string[]) => SetMetadata(REQUIRED_ROLES, roles);

/**
 * Marks a route whose request must not count as activity: `AuthGuard` checks the session without
 * moving its last-seen time, so the idle timer runs on.
 */
export const SkipIdleRenewal = () => SetMetadata(SKIP_IDLE_RENEWAL, true);

export const CurrentContext = createParamDecorator(
  (_data: unknown, executionContext: ExecutionContext): RequestContext => {
    const request = executionContext.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.authSession) throw new Error('Authenticated request context is missing.');
    return request.authSession.context;
  },
);
