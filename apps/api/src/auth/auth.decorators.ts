import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import type { AuthenticatedRequest } from './auth.types';

export const REQUIRED_PERMISSIONS = 'required_permissions';
export const REQUIRED_ROLES = 'required_roles';

export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const RequireRole = (...roles: string[]) => SetMetadata(REQUIRED_ROLES, roles);

export const CurrentContext = createParamDecorator(
  (_data: unknown, executionContext: ExecutionContext): RequestContext => {
    const request = executionContext.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.authSession) throw new Error('Authenticated request context is missing.');
    return request.authSession.context;
  },
);
