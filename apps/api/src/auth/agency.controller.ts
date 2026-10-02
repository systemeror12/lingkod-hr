import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AuthService,
  AuthServiceError,
  type InvitationResult,
  type PendingInvitation,
} from './auth.service';
import { AuthGuard } from './auth.guard';
import { CurrentContext, RequirePermission, RequireRole } from './auth.decorators';
import { PermissionGuard } from './permission.guard';
import type { RequestContext } from '@lingkod-hr/auth';
import type { AuthenticatedRequest } from './auth.types';
import { getConfig } from '@lingkod-hr/config';
import { agencyIdSchema, hrmoInvitationSchema } from './auth.schemas';

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class AgencyController {
  private readonly config = getConfig();

  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Get(':agencyId/invitations')
  @RequirePermission('security.users.invite', 'security.users.update_roles')
  @RequireRole('agency_administrator')
  async pendingInvitations(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ pendingCount: number; invitations: PendingInvitation[] }> {
    this.assertAgencyContext(agencyId, context);
    try {
      return await this.authService.listPendingInvitations(context);
    } catch (error: unknown) {
      this.translateAuthError(error);
    }
  }

  @Post(':agencyId/invitations')
  @RequirePermission('security.users.invite', 'security.users.update_roles')
  @RequireRole('agency_administrator')
  async invite(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Req() request: AuthenticatedRequest,
  ) {
    this.assertAgencyContext(agencyId, context);
    const parsedBody = hrmoInvitationSchema.safeParse(body);
    if (!parsedBody.success)
      throw new HttpException(
        { error: { code: 'INVALID_INPUT', message: 'Invalid invitation input.' } },
        400,
      );
    let invitation: InvitationResult;
    try {
      invitation = await this.authService.createHrmoAdministratorInvitation(
        context,
        parsedBody.data.email,
        parsedBody.data.roleCodes,
        request.header('x-request-id') ?? 'unknown-request',
      );
    } catch (error: unknown) {
      if (error instanceof AuthServiceError) {
        throw new HttpException(
          { error: { code: error.code, message: error.message } },
          error.statusCode,
        );
      }
      throw error;
    }
    return this.config.NODE_ENV === 'production'
      ? { id: invitation.id, email: invitation.email, expiresAt: invitation.expiresAt }
      : {
          id: invitation.id,
          email: invitation.email,
          expiresAt: invitation.expiresAt,
          activationUrl: `${this.config.APP_URL.replace(/\/$/, '')}/invite/${invitation.activationToken}`,
        };
  }

  private assertAgencyContext(agencyId: string, context: RequestContext): void {
    const parsedAgencyId = agencyIdSchema.safeParse(agencyId);
    if (!parsedAgencyId.success || parsedAgencyId.data !== context.agencyId) {
      throw new ForbiddenException('The requested Agency is outside the active context.');
    }
  }

  private translateAuthError(error: unknown): never {
    if (error instanceof AuthServiceError) {
      throw new HttpException(
        { error: { code: error.code, message: error.message } },
        error.statusCode,
      );
    }
    throw error;
  }
}
