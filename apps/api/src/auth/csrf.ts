import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';

const SESSION_COOKIE = 'hris_session=';

export function assertCookieMutationOrigin(request: Request, allowedOrigin: string): void {
  if (request.headers.authorization?.startsWith('Bearer ')) return;
  if (!request.headers.cookie?.includes(SESSION_COOKIE)) return;

  const origin = request.header('origin');
  if (origin === allowedOrigin) return;

  const referer = request.header('referer');
  if (!origin && referer) {
    try {
      if (new URL(referer).origin === allowedOrigin) return;
    } catch {
      // Treat malformed browser metadata as an invalid origin.
    }
  }
  throw new ForbiddenException('A same-origin request is required.');
}
