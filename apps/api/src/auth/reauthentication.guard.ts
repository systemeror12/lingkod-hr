import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { isWithinReauthenticationWindow } from '@lingkod-hr/auth';
import type { AuthenticatedRequest } from './auth.types';

/**
 * Refuses a sensitive action with `403 REAUTHENTICATION_REQUIRED` unless the User proved who they
 * are in the last 5 minutes. Runs after `AuthGuard`; the client answers by calling
 * `POST /auth/reauthenticate` and retrying once.
 */
@Injectable()
export class ReauthenticationGuard implements CanActivate {
  canActivate(executionContext: ExecutionContext): boolean {
    const { authSession } = executionContext.switchToHttp().getRequest<AuthenticatedRequest>();
    if (authSession && isWithinReauthenticationWindow(authSession.authTime)) return true;
    throw new HttpException(
      {
        error: {
          code: 'REAUTHENTICATION_REQUIRED',
          message: 'Confirm it’s you to continue.',
        },
      },
      403,
    );
  }
}
