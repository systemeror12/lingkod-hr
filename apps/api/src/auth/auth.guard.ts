import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';

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
  constructor(private readonly authService: AuthService) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const request = executionContext.switchToHttp().getRequest<AuthenticatedRequest>();
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
