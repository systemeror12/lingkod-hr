import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasAllPermissions } from '@lingkod-hr/auth';
import { REQUIRED_PERMISSIONS, REQUIRED_ROLES } from './auth.decorators';
import type { AuthenticatedRequest } from './auth.types';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(executionContext: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, [
      executionContext.getHandler(),
      executionContext.getClass(),
    ]);
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(REQUIRED_ROLES, [
      executionContext.getHandler(),
      executionContext.getClass(),
    ]);
    if ((!required || required.length === 0) && (!requiredRoles || requiredRoles.length === 0)) {
      return true;
    }
    const request = executionContext.switchToHttp().getRequest<AuthenticatedRequest>();
    const context = request.authSession?.context;
    const hasRequiredRoles =
      !requiredRoles ||
      requiredRoles.length === 0 ||
      requiredRoles.every((role) =>
        request.authSession?.display.effectiveRoles.some(({ code }) => code === role),
      );
    if (!context || !hasRequiredRoles || (required && !hasAllPermissions(context, required))) {
      throw new ForbiddenException('The current Agency Membership lacks the required permission.');
    }
    return true;
  }
}
