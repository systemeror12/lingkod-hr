import type { MailMessage } from '../invitations/mail';

export class AuthServiceError extends Error {
  /** When a refused attempt may be tried again. */
  readonly retryAt: Date | undefined;
  /** A notice for `sendNotice` once the refusal is out. */
  readonly notice: MailMessage | undefined;

  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = 'AUTHENTICATION_ERROR',
    options: { retryAt?: Date; notice?: MailMessage } = {},
  ) {
    super(message);
    this.name = 'AuthServiceError';
    this.retryAt = options.retryAt;
    this.notice = options.notice;
  }
}
