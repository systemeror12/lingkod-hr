import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from '@lingkod-hr/auth';
import { REQUIRED_PERMISSIONS } from './auth.decorators';
import type { AuthenticatedRequest } from './auth.types';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(executionContext: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, [
      executionContext.getHandler(),
      executionContext.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const request = executionContext.switchToHttp().getRequest<AuthenticatedRequest>();
    const context = request.authSession?.context;
    if (!context || !required.some((permission) => hasPermission(context, permission))) {
      throw new ForbiddenException('The current Agency Membership lacks the required permission.');
    }
    return true;
  }
}
