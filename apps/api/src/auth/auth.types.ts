import type { Request } from 'express';
import type { AuthenticatedSession, SignInRequest } from './auth.service';

export interface AuthenticatedRequest extends Request {
  authSession?: AuthenticatedSession;
  sessionToken?: string | undefined;
}

/** Longest User-Agent header a Security Event keeps. */
const USER_AGENT_MAX_LENGTH = 512;

/** Who is making the request and from where, for the Security Events it writes. */
export function signInRequest(request: Request): SignInRequest {
  return {
    requestId: request.header('x-request-id') ?? 'unknown-request',
    ipAddress: request.ip ?? null,
    userAgent: request.header('user-agent')?.slice(0, USER_AGENT_MAX_LENGTH) ?? null,
  };
}
