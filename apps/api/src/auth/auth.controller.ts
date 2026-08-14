import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { OidcError } from '@lingkod-hr/auth';
import { getConfig } from '@lingkod-hr/config';
import { AuthGuard } from './auth.guard';
import { AuthService, AuthServiceError, OIDC_FLOW_COOKIE, SESSION_COOKIE } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
import {
  activationTokenSchema,
  backchannelLogoutSchema,
  callbackQuerySchema,
  loginQuerySchema,
  switchAgencySchema,
} from './auth.schemas';

function translateError(error: unknown): never {
  if (error instanceof AuthServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message } },
      error.statusCode,
    );
  }
  if (error instanceof OidcError) {
    throw new HttpException(
      {
        error: {
          code: 'OIDC_AUTHENTICATION_FAILED',
          message: 'Authentication could not be completed.',
        },
      },
      HttpStatus.UNAUTHORIZED,
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

  @Get('login')
  async login(
    @Query('invitation') invitationToken: string | undefined,
    @Query('membershipId') membershipId: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const query = loginQuerySchema.safeParse({ invitation: invitationToken, membershipId });
    if (!query.success) throw new BadRequestException('Invalid login parameters.');
    try {
      await this.authService.assertLoginAllowed(request.ip ?? 'unknown');
      const start = await this.authService.beginLogin(
        query.data.invitation ?? null,
        query.data.membershipId ?? null,
      );
      response.cookie(OIDC_FLOW_COOKIE, start.flowCookie, {
        ...cookieOptions(this.config.NODE_ENV === 'production'),
        maxAge: 10 * 60 * 1000,
      });
      response.redirect(start.authorizationUrl);
    } catch (error: unknown) {
      translateError(error);
    }
  }

  @Get('invitations/:token/activate')
  async activateInvitation(
    @Param('token') token: string,
    @Res() response: Response,
  ): Promise<void> {
    const parsed = activationTokenSchema.safeParse(token);
    if (!parsed.success) throw new BadRequestException('The invitation token is invalid.');
    response.redirect(`/api/v1/auth/login?invitation=${encodeURIComponent(parsed.data)}`);
  }

  @Get('callback')
  async callback(
    @Query('state') state: string | undefined,
    @Query('code') code: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const query = callbackQuerySchema.safeParse({ state, code });
    if (!query.success) throw new BadRequestException('OIDC callback parameters are incomplete.');
    const flowCookie = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${OIDC_FLOW_COOKIE}=`))
      ?.slice(OIDC_FLOW_COOKIE.length + 1);
    if (!flowCookie) throw new BadRequestException('OIDC callback parameters are incomplete.');
    const requestId = request.header('x-request-id') ?? 'unknown-request';
    try {
      await this.authService.assertLoginAllowed(request.ip ?? 'unknown');
      let decodedFlowCookie: string;
      try {
        decodedFlowCookie = decodeURIComponent(flowCookie);
      } catch {
        throw new BadRequestException('The authentication flow cookie is invalid.');
      }
      const result = await this.authService.completeLogin(
        decodedFlowCookie,
        query.data.state,
        query.data.code,
        requestId,
      );
      response.clearCookie(OIDC_FLOW_COOKIE, cookieOptions(this.config.NODE_ENV === 'production'));
      response.cookie(SESSION_COOKIE, result.token, {
        ...cookieOptions(this.config.NODE_ENV === 'production'),
        maxAge: 8 * 60 * 60 * 1000,
      });
      response.redirect(this.config.APP_URL);
    } catch (error: unknown) {
      try {
        await this.authService.recordLoginFailure(
          requestId,
          error instanceof AuthServiceError ? error.code : 'OIDC_CALLBACK_FAILED',
          request.ip ?? 'unknown',
        );
      } catch {
        // Preserve the authentication error when the audit store is unavailable.
      }
      translateError(error);
    }
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() request: AuthenticatedRequest) {
    const session = request.authSession;
    if (!session) throw new UnauthorizedException();
    const { context, display } = session;
    return {
      userId: context.userId,
      agencyId: context.agencyId,
      membershipId: context.membershipId,
      agency: display.agency,
      identity: display.identity,
      effectiveRoles: display.effectiveRoles,
      permissions: context.permissions,
    };
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  async logout(@Req() request: AuthenticatedRequest, @Res() response: Response): Promise<void> {
    if (!request.authSession || !request.sessionToken) throw new UnauthorizedException();
    try {
      const providerLogoutUrl = await this.authService.revokeSession(
        request.sessionToken,
        request.authSession,
        'USER_LOGOUT',
        request.header('x-request-id') ?? 'unknown-request',
      );
      response.clearCookie(SESSION_COOKIE, cookieOptions(this.config.NODE_ENV === 'production'));
      response.status(HttpStatus.OK).json({ loggedOut: true, providerLogoutUrl });
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

  @Post('backchannel-logout')
  async backchannelLogout(@Body() body: unknown, @Req() request: Request) {
    const parsed = backchannelLogoutSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('logout_token is required.');
    try {
      await this.authService.handleBackChannelLogout(
        parsed.data.logout_token,
        request.header('x-request-id') ?? 'unknown-request',
      );
      return { accepted: true };
    } catch (error: unknown) {
      translateError(error);
    }
  }
}
