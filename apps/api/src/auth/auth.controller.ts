import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { getConfig } from '@lingkod-hr/config';
import { AuthGuard, cookieValue } from './auth.guard';
import { AuthMeResponseDto } from './auth.dto';
import {
  AuthService,
  AuthServiceError,
  PENDING_ACTIVATION_COOKIE,
  PENDING_ACTIVATION_LIFETIME_MS,
  PENDING_AUTHENTICATION_COOKIE,
  PENDING_SIGN_IN_LIFETIME_MS,
  SESSION_COOKIE,
} from './auth.service';
import type { ActivationDone } from './auth.service';
import { signInRequest, type AuthenticatedRequest } from './auth.types';
import { ReauthenticationGuard } from './reauthentication.guard';
import type { MailMessage } from '../invitations/mail';
import {
  activationStartSchema,
  activationTokenSchema,
  enrollmentFinishSchema,
  passwordResetCompleteSchema,
  passwordResetRequestSchema,
  passwordChangeSchema,
  passwordSignInSchema,
  reauthenticateSchema,
  switchAgencySchema,
  recoveryCodeSignInSchema,
  totpReplacementSchema,
  totpSignInSchema,
} from './auth.schemas';

function translateError(error: unknown): never {
  if (error instanceof AuthServiceError) {
    throw new HttpException(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.retryAt ? { retryAt: error.retryAt.toISOString() } : {}),
        },
      },
      error.statusCode,
    );
  }
  throw error;
}

function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? ('none' as const) : ('lax' as const),
    path: '/',
  };
}

@Controller('auth')
export class AuthController {
  private readonly config = getConfig();

  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  /**
   * Email and password. Answers `TOTP_REQUIRED`, or `ENROLLMENT_REQUIRED` with the secret to add to
   * an authenticator app, with a pending-sign-in cookie; otherwise signs in.
   */
  @Post('sign-in')
  async signIn(
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const parsed = passwordSignInSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Email and password are required.');
    const secure = this.config.NODE_ENV === 'production';
    try {
      const result = await this.authService.signInWithPassword(
        parsed.data.email,
        parsed.data.password,
        parsed.data.membershipId ?? null,
        signInRequest(request),
      );
      if (result.status === 'SIGNED_IN') {
        response.cookie(SESSION_COOKIE, result.session.token, {
          ...cookieOptions(secure),
          maxAge: 8 * 60 * 60 * 1000,
        });
        response.status(HttpStatus.OK).json({ status: result.status });
        return;
      }
      response.cookie(PENDING_AUTHENTICATION_COOKIE, result.pendingToken, {
        ...cookieOptions(secure),
        maxAge: PENDING_SIGN_IN_LIFETIME_MS,
      });
      response.status(HttpStatus.OK).json(
        result.status === 'ENROLLMENT_REQUIRED'
          ? {
              status: result.status,
              enrollment: {
                ...result.enrollment,
                expiresAt: result.enrollment.expiresAt.toISOString(),
              },
            }
          : { status: result.status },
      );
    } catch (error: unknown) {
      translateError(error);
    }
  }

  /** The TOTP code that completes a pending sign-in. */
  @Post('sign-in/totp')
  async signInWithTotp(
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const parsed = totpSignInSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('A code is required.');
    const secure = this.config.NODE_ENV === 'production';
    const pendingToken = cookieValue(request, PENDING_AUTHENTICATION_COOKIE);
    try {
      await this.authService.assertIpAllowed(signInRequest(request));
      const session = await this.authService.completeTotpSignIn(
        pendingToken ?? '',
        parsed.data.code,
        signInRequest(request),
      );
      response.clearCookie(PENDING_AUTHENTICATION_COOKIE, cookieOptions(secure));
      response.cookie(SESSION_COOKIE, session.token, {
        ...cookieOptions(secure),
        maxAge: 8 * 60 * 60 * 1000,
      });
      response.status(HttpStatus.OK).json({ status: 'SIGNED_IN' });
    } catch (error: unknown) {
      this.clearEndedPendingSignIn(error, response);
      translateError(error);
    }
  }

  /** The first code from the authenticator app; answers the Recovery Codes, shown once. */
  @Post('sign-in/enrollment/confirm')
  async confirmEnrollment(
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const parsed = totpSignInSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('A code is required.');
    try {
      await this.authService.assertIpAllowed(signInRequest(request));
      const result = await this.authService.confirmTotpEnrollment(
        cookieValue(request, PENDING_AUTHENTICATION_COOKIE) ?? '',
        parsed.data.code,
        signInRequest(request),
      );
      response.status(HttpStatus.OK).json({ status: 'RECOVERY_CODES', ...result });
    } catch (error: unknown) {
      this.clearEndedPendingSignIn(error, response);
      translateError(error);
    }
  }

  /** The acknowledgment that the Recovery Codes are saved; finishes enrollment and signs in. */
  @Post('sign-in/enrollment/finish')
  async finishEnrollment(
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const parsed = enrollmentFinishSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Confirm that you saved your Recovery Codes.');
    }
    const secure = this.config.NODE_ENV === 'production';
    try {
      await this.authService.assertIpAllowed(signInRequest(request));
      const session = await this.authService.completeTotpEnrollment(
        cookieValue(request, PENDING_AUTHENTICATION_COOKIE) ?? '',
        signInRequest(request),
      );
      response.clearCookie(PENDING_AUTHENTICATION_COOKIE, cookieOptions(secure));
      response.cookie(SESSION_COOKIE, session.token, {
        ...cookieOptions(secure),
        maxAge: 8 * 60 * 60 * 1000,
      });
      response.status(HttpStatus.OK).json({ status: 'SIGNED_IN' });
      this.noticeAfterResponse(response, session.notice);
    } catch (error: unknown) {
      this.clearEndedPendingSignIn(error, response);
      translateError(error);
    }
  }

  /** A Recovery Code in place of the TOTP code. Signs out the User's other sessions. */
  @Post('sign-in/recovery-code')
  async signInWithRecoveryCode(
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const parsed = recoveryCodeSignInSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('A Recovery Code is required.');
    const secure = this.config.NODE_ENV === 'production';
    const pendingToken = cookieValue(request, PENDING_AUTHENTICATION_COOKIE);
    try {
      await this.authService.assertIpAllowed(signInRequest(request));
      const result = await this.authService.completeRecoveryCodeSignIn(
        pendingToken ?? '',
        parsed.data.code,
        signInRequest(request),
      );
      response.clearCookie(PENDING_AUTHENTICATION_COOKIE, cookieOptions(secure));
      response.cookie(SESSION_COOKIE, result.session.token, {
        ...cookieOptions(secure),
        maxAge: 8 * 60 * 60 * 1000,
      });
      response
        .status(HttpStatus.OK)
        .json({ status: 'SIGNED_IN', recoveryCodesRemaining: result.recoveryCodesRemaining });
      this.noticeAfterResponse(response, result.notice);
    } catch (error: unknown) {
      this.clearEndedPendingSignIn(error, response);
      translateError(error);
    }
  }

  /**
   * Asks for a reset link. Every request gets the same answer, whether or not the email has an
   * account; the link is mailed after the response.
   */
  @Post('password-reset')
  async requestPasswordReset(
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const parsed = passwordResetRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('An email is required.');
    try {
      const mail = await this.authService.requestPasswordReset(
        parsed.data.email,
        signInRequest(request),
      );
      response.status(HttpStatus.ACCEPTED).json({ status: 'REQUESTED' });
      if (mail) this.noticeAfterResponse(response, mail);
    } catch (error: unknown) {
      translateError(error);
    }
  }

  /** What the reset page shows. Reading it writes nothing. */
  @Get('password-reset/:token')
  async lookupPasswordReset(@Param('token') token: string) {
    const parsed = activationTokenSchema.safeParse(token);
    if (!parsed.success) return { status: 'INVALID' };
    const link = await this.authService.lookupPasswordReset(parsed.data);
    return link.status === 'VALID' ? { ...link, expiresAt: link.expiresAt.toISOString() } : link;
  }

  /** Sets the new password. Signs out every session and doesn't sign the User in. */
  @Post('password-reset/:token')
  async completePasswordReset(
    @Param('token') token: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const parsed = passwordResetCompleteSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('A new password is required.');
    const resetToken = activationTokenSchema.safeParse(token);
    try {
      const { notices } = await this.authService.completePasswordReset(
        resetToken.success ? resetToken.data : '',
        parsed.data,
        signInRequest(request),
      );
      response.status(HttpStatus.OK).json({ status: 'RESET' });
      for (const notice of notices) this.noticeAfterResponse(response, notice);
    } catch (error: unknown) {
      translateError(error);
    }
  }

  /** What the invitation page shows. Reading it writes nothing. */
  @Get('invitations/:token')
  @Header('Cache-Control', 'no-store')
  async lookupInvitation(@Param('token') token: string) {
    const parsed = activationTokenSchema.safeParse(token);
    if (!parsed.success) return { status: 'INVALID' };
    const invitation = await this.authService.lookupInvitation(parsed.data);
    return invitation.status === 'VALID'
      ? { ...invitation, expiresAt: invitation.expiresAt.toISOString() }
      : invitation;
  }

  /**
   * Starts an Invitation Activation: a new password for a first-time User, or an existing User's
   * password. Answers `CODE_REQUIRED` or `ENROLLMENT_REQUIRED` with a pending-activation cookie, or
   * `ACTIVATED` with a session.
   */
  @Post('invitations/:token/activation')
  async startActivation(
    @Param('token') token: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const invitationToken = this.invitationToken(token);
    const parsed = activationStartSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('A password is required.');
    const secure = this.config.NODE_ENV === 'production';
    try {
      await this.authService.assertIpAllowed(signInRequest(request));
      const result = await this.authService.startActivation(
        invitationToken,
        parsed.data,
        signInRequest(request),
      );
      if (result.status === 'ACTIVATED') {
        this.activated(response, result);
        return;
      }
      response.cookie(PENDING_ACTIVATION_COOKIE, result.pendingToken, {
        ...cookieOptions(secure),
        maxAge: PENDING_ACTIVATION_LIFETIME_MS,
      });
      response.status(HttpStatus.OK).json(
        result.status === 'ENROLLMENT_REQUIRED'
          ? {
              status: result.status,
              enrollment: {
                ...result.enrollment,
                expiresAt: result.enrollment.expiresAt.toISOString(),
              },
            }
          : { status: result.status },
      );
    } catch (error: unknown) {
      this.clearEndedActivation(error, response);
      translateError(error);
    }
  }

  /** An existing User's TOTP code; finishes the activation. */
  @Post('invitations/:token/activation/code')
  async activateWithTotp(
    @Param('token') token: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const invitationToken = this.invitationToken(token);
    const parsed = totpSignInSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('A code is required.');
    try {
      await this.authService.assertIpAllowed(signInRequest(request));
      this.activated(
        response,
        await this.authService.completeActivationWithTotp(
          invitationToken,
          cookieValue(request, PENDING_ACTIVATION_COOKIE) ?? '',
          parsed.data.code,
          signInRequest(request),
        ),
      );
    } catch (error: unknown) {
      this.clearEndedActivation(error, response);
      translateError(error);
    }
  }

  /** An existing User's Recovery Code in place of the TOTP code. Signs out their other sessions. */
  @Post('invitations/:token/activation/recovery-code')
  async activateWithRecoveryCode(
    @Param('token') token: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const invitationToken = this.invitationToken(token);
    const parsed = recoveryCodeSignInSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('A Recovery Code is required.');
    try {
      await this.authService.assertIpAllowed(signInRequest(request));
      this.activated(
        response,
        await this.authService.completeActivationWithRecoveryCode(
          invitationToken,
          cookieValue(request, PENDING_ACTIVATION_COOKIE) ?? '',
          parsed.data.code,
          signInRequest(request),
        ),
      );
    } catch (error: unknown) {
      this.clearEndedActivation(error, response);
      translateError(error);
    }
  }

  /** The first code from the authenticator app; answers the Recovery Codes, shown once. */
  @Post('invitations/:token/activation/enrollment/confirm')
  async confirmActivationEnrollment(
    @Param('token') token: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const invitationToken = this.invitationToken(token);
    const parsed = totpSignInSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('A code is required.');
    try {
      await this.authService.assertIpAllowed(signInRequest(request));
      const result = await this.authService.confirmActivationEnrollment(
        invitationToken,
        cookieValue(request, PENDING_ACTIVATION_COOKIE) ?? '',
        parsed.data.code,
        signInRequest(request),
      );
      response.status(HttpStatus.OK).json({ status: 'RECOVERY_CODES', ...result });
    } catch (error: unknown) {
      this.clearEndedActivation(error, response);
      translateError(error);
    }
  }

  /** The acknowledgment that the Recovery Codes are saved; saves the activation and signs in. */
  @Post('invitations/:token/activation/enrollment/finish')
  async finishActivationEnrollment(
    @Param('token') token: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const invitationToken = this.invitationToken(token);
    const parsed = enrollmentFinishSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Confirm that you saved your Recovery Codes.');
    }
    try {
      await this.authService.assertIpAllowed(signInRequest(request));
      this.activated(
        response,
        await this.authService.finishActivationEnrollment(
          invitationToken,
          cookieValue(request, PENDING_ACTIVATION_COOKIE) ?? '',
          signInRequest(request),
        ),
      );
    } catch (error: unknown) {
      this.clearEndedActivation(error, response);
      translateError(error);
    }
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() request: AuthenticatedRequest): AuthMeResponseDto {
    const session = request.authSession;
    if (!session) throw new UnauthorizedException();
    const { context, display } = session;
    return new AuthMeResponseDto(
      context.userId,
      context.agencyId,
      context.membershipId,
      display.agency,
      display.identity,
      display.effectiveRoles,
      context.permissions,
    );
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  async logout(@Req() request: AuthenticatedRequest, @Res() response: Response): Promise<void> {
    if (!request.authSession || !request.sessionToken) throw new UnauthorizedException();
    try {
      await this.authService.revokeSession(
        request.sessionToken,
        request.authSession,
        'USER_LOGOUT',
        request.header('x-request-id') ?? 'unknown-request',
      );
      response.clearCookie(SESSION_COOKIE, cookieOptions(this.config.NODE_ENV === 'production'));
      response.status(HttpStatus.OK).json({ loggedOut: true });
    } catch (error: unknown) {
      translateError(error);
    }
  }

  @Post('switch-agency')
  @UseGuards(AuthGuard)
  async switchAgency(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    if (!request.authSession || !request.sessionToken) throw new UnauthorizedException();
    const parsed = switchAgencySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('membershipId must be a UUID.');
    try {
      const result = await this.authService.switchAgency(
        request.sessionToken,
        request.authSession,
        parsed.data.membershipId,
        request.header('x-request-id') ?? 'unknown-request',
      );
      response.cookie(SESSION_COOKIE, result.token, {
        ...cookieOptions(this.config.NODE_ENV === 'production'),
        maxAge: 8 * 60 * 60 * 1000,
      });
      response.json({
        agencyId: result.context.agencyId,
        membershipId: result.context.membershipId,
      });
    } catch (error: unknown) {
      translateError(error);
    }
  }

  /**
   * Proves again who the signed-in User is, with the same proof as sign-in, and opens the
   * Reauthentication Window for 5 minutes.
   */
  @Post('reauthenticate')
  @UseGuards(AuthGuard)
  async reauthenticate(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    if (!request.authSession) throw new UnauthorizedException();
    const parsed = reauthenticateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('A password is required.');
    try {
      const { notice } = await this.authService.reauthenticate(
        request.authSession,
        parsed.data,
        signInRequest(request),
      );
      response.status(HttpStatus.OK).json({ status: 'REAUTHENTICATED' });
      if (notice) this.noticeAfterResponse(response, notice);
    } catch (error: unknown) {
      if (error instanceof AuthServiceError && error.notice) {
        this.noticeAfterResponse(response, error.notice);
      }
      translateError(error);
    }
  }

  @Get('recovery-codes')
  @UseGuards(AuthGuard)
  recoveryCodeStatus(@Req() request: AuthenticatedRequest) {
    if (!request.authSession) throw new UnauthorizedException();
    return this.authService.recoveryCodeStatus(request.authSession);
  }

  /** A new set of 10 Recovery Codes, shown once; the old set stops working. */
  @Post('recovery-codes')
  @UseGuards(AuthGuard, ReauthenticationGuard)
  async regenerateRecoveryCodes(
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    if (!request.authSession) throw new UnauthorizedException();
    try {
      const { recoveryCodes, notice } = await this.authService.regenerateRecoveryCodes(
        request.authSession,
        request.header('x-request-id') ?? 'unknown-request',
      );
      response.status(HttpStatus.OK).json({ recoveryCodes });
      this.noticeAfterResponse(response, notice);
    } catch (error: unknown) {
      translateError(error);
    }
  }

  /**
   * Changes the signed-in User's password. It asks for the current password and a code every
   * time, so the Reauthentication Window doesn't guard it.
   */
  @Post('password')
  @UseGuards(AuthGuard)
  async changePassword(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    if (!request.authSession) throw new UnauthorizedException();
    const parsed = passwordChangeSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('The current password and a new password are required.');
    }
    try {
      const { revokedSessions, notices } = await this.authService.changePassword(
        request.authSession,
        parsed.data,
        signInRequest(request),
      );
      response.status(HttpStatus.OK).json({ status: 'CHANGED', revokedSessions });
      for (const notice of notices) this.noticeAfterResponse(response, notice);
    } catch (error: unknown) {
      if (error instanceof AuthServiceError && error.notice) {
        this.noticeAfterResponse(response, error.notice);
      }
      translateError(error);
    }
  }

  /** Starts replacing the authenticator app with a new secret, to scan within 5 minutes. */
  @Post('authenticator/replacement')
  @UseGuards(AuthGuard, ReauthenticationGuard)
  async beginTotpReplacement(@Req() request: AuthenticatedRequest) {
    if (!request.authSession) throw new UnauthorizedException();
    try {
      return await this.authService.beginTotpReplacement(request.authSession);
    } catch (error: unknown) {
      translateError(error);
    }
  }

  /** Confirms the replacement with a code from the new app; the old app stops working. */
  @Post('authenticator/replacement/confirm')
  @UseGuards(AuthGuard, ReauthenticationGuard)
  async confirmTotpReplacement(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    if (!request.authSession) throw new UnauthorizedException();
    const parsed = totpReplacementSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('A code is required.');
    try {
      const { revokedSessions, notice } = await this.authService.confirmTotpReplacement(
        request.authSession,
        parsed.data.code,
        signInRequest(request),
      );
      response.status(HttpStatus.OK).json({ status: 'REPLACED', revokedSessions });
      this.noticeAfterResponse(response, notice);
    } catch (error: unknown) {
      translateError(error);
    }
  }

  /**
   * Sends a credential notice once the response is out, so neither the transaction nor the
   * User's wait depends on mail. Later credential notices reuse this path.
   */
  private noticeAfterResponse(response: Response, notice: MailMessage): void {
    response.once('close', () => void this.authService.sendNotice(notice));
  }

  /**
   * A pending sign-in the service found gone or expired, or ended at the second-factor ceiling, is
   * no use to the browser either. The ceiling's notice goes out once the refusal is.
   */
  private clearEndedPendingSignIn(error: unknown, response: Response): void {
    if (!(error instanceof AuthServiceError)) return;
    if (error.code === 'SIGN_IN_EXPIRED' || error.code === 'PASSWORD_RESET_REQUIRED') {
      response.clearCookie(
        PENDING_AUTHENTICATION_COOKIE,
        cookieOptions(this.config.NODE_ENV === 'production'),
      );
    }
    if (error.notice) this.noticeAfterResponse(response, error.notice);
  }

  private invitationToken(token: string): string {
    const parsed = activationTokenSchema.safeParse(token);
    if (!parsed.success) {
      translateError(
        new AuthServiceError(
          'This invitation can’t be used. Ask your Agency Administrator for a new one.',
          400,
          'INVITATION_INVALID',
        ),
      );
    }
    return parsed.data;
  }

  /** Ends a saved activation: drops its pending cookie, signs in, and sends its notices. */
  private activated(response: Response, done: ActivationDone): void {
    const secure = this.config.NODE_ENV === 'production';
    response.clearCookie(PENDING_ACTIVATION_COOKIE, cookieOptions(secure));
    response.cookie(SESSION_COOKIE, done.session.token, {
      ...cookieOptions(secure),
      maxAge: 8 * 60 * 60 * 1000,
    });
    response.status(HttpStatus.OK).json({ status: 'ACTIVATED' });
    for (const notice of done.notices) this.noticeAfterResponse(response, notice);
  }

  /** A pending activation the service found gone, or whose invitation can no longer be used. */
  private clearEndedActivation(error: unknown, response: Response): void {
    if (!(error instanceof AuthServiceError)) return;
    if (
      [
        'ACTIVATION_EXPIRED',
        'INVITATION_INVALID',
        'INVITATION_EXPIRED',
        'INVITATION_ROLE_UNAVAILABLE',
        'MEMBERSHIP_EXISTS',
        'PASSWORD_RESET_REQUIRED',
        'USER_LOCKED',
        'USER_NOT_ACTIVE',
      ].includes(error.code)
    ) {
      response.clearCookie(
        PENDING_ACTIVATION_COOKIE,
        cookieOptions(this.config.NODE_ENV === 'production'),
      );
    }
    if (error.notice) this.noticeAfterResponse(response, error.notice);
  }
}
