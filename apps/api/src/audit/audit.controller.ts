import {
  Controller,
  Get,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { agencyIdSchema } from '../auth/auth.schemas';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { AuditEventDetailDto, AuditEventListResponseDto } from './audit.dto';
import { auditEventIdSchema, auditEventListQuerySchema } from './audit.schemas';
import { AuditService, AuditServiceError } from './audit.service';

function translateAuditError(error: unknown, context: RequestContext): never {
  if (error instanceof AuditServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId: context.requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class AuditController {
  constructor(@Inject(AuditService) private readonly auditService: AuditService) {}

  @Get(':agencyId/audit-events')
  @RequirePermission('audit.events.read')
  async list(
    @Param('agencyId') agencyId: string,
    @Query() query: Record<string, unknown>,
    @CurrentContext() context: RequestContext,
  ): Promise<AuditEventListResponseDto> {
    this.assertAgency(agencyId, context);
    const parsedQuery = auditEventListQuerySchema.safeParse(query);
    if (!parsedQuery.success) {
      throw new HttpException(
        {
          error: {
            code: 'INVALID_INPUT',
            message: 'Invalid Audit Log pagination.',
            requestId: context.requestId,
          },
        },
        400,
      );
    }
    try {
      return new AuditEventListResponseDto(await this.auditService.list(context, parsedQuery.data));
    } catch (error: unknown) {
      translateAuditError(error, context);
    }
  }

  @Get(':agencyId/audit-events/:eventId')
  @RequirePermission('audit.events.read')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('eventId') eventId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<AuditEventDetailDto> {
    this.assertAgency(agencyId, context);
    const parsedEventId = auditEventIdSchema.safeParse(eventId);
    if (!parsedEventId.success) throw this.notFound(context);
    try {
      const event = await this.auditService.findById(context, parsedEventId.data);
      if (!event) throw this.notFound(context);
      return new AuditEventDetailDto(event);
    } catch (error: unknown) {
      translateAuditError(error, context);
    }
  }

  private assertAgency(agencyId: string, context: RequestContext): void {
    const parsedAgencyId = agencyIdSchema.safeParse(agencyId);
    if (!parsedAgencyId.success || parsedAgencyId.data !== context.agencyId) {
      throw this.notFound(context);
    }
  }

  private notFound(context: RequestContext): NotFoundException {
    return new NotFoundException({
      error: {
        code: 'AUDIT_EVENT_NOT_FOUND',
        message: 'The Audit Event could not be found.',
        requestId: context.requestId,
      },
    });
  }
}
