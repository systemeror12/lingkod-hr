import {
  Body,
  Controller,
  ForbiddenException,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService, AuthServiceError, type InvitationResult } from './auth.service';
import { AuthGuard } from './auth.guard';
import { CurrentContext, RequirePermission } from './auth.decorators';
import { PermissionGuard } from './permission.guard';
import type { RequestContext } from '@lingkod-hr/auth';
import type { AuthenticatedRequest } from './auth.types';
import { getConfig } from '@lingkod-hr/config';
import { agencyIdSchema, invitationSchema } from './auth.schemas';

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class AgencyController {
  private readonly config = getConfig();

  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post(':agencyId/invitations')
  @RequirePermission('security.users.invite')
  async invite(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsedAgencyId = agencyIdSchema.safeParse(agencyId);
    if (!parsedAgencyId.success || parsedAgencyId.data !== context.agencyId) {
      throw new ForbiddenException('The requested Agency is outside the active context.');
    }
    const parsedBody = invitationSchema.safeParse(body);
    if (!parsedBody.success)
      throw new HttpException(
        { error: { code: 'INVALID_INPUT', message: 'Invalid invitation input.' } },
        400,
      );
    let invitation: InvitationResult;
    try {
      invitation = await this.authService.createInvitation(
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
          activationUrl: `${this.config.API_URL}/api/v1/auth/invitations/${invitation.activationToken}/activate`,
        };
  }
}
