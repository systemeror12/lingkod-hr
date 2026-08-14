import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { getConfig } from '@lingkod-hr/config';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
import { assertCookieMutationOrigin } from './csrf';

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(value.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function requestSessionToken(request: Request): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7).trim() || null;
  return cookieValue(request, 'hris_session');
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly allowedOrigin = new URL(getConfig().APP_URL).origin;

  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const request = executionContext.switchToHttp().getRequest<AuthenticatedRequest>();
    assertCookieMutationOrigin(request, this.allowedOrigin);
    const token = requestSessionToken(request);
    const authSession = token
      ? await this.authService.authenticateSession(
          token,
          request.header('x-request-id') ?? 'unknown-request',
        )
      : null;
    if (!authSession) throw new UnauthorizedException('An active HRIS session is required.');
    request.authSession = authSession;
    request.sessionToken = token ?? undefined;
    return true;
  }
}
