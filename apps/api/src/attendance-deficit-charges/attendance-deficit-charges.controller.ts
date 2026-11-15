import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { RequestContext } from '@lingkod-hr/auth';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import {
  AttendanceDeficitChargeServiceError,
  AttendanceDeficitChargesService,
  type PublicationDeficitCharges,
} from './attendance-deficit-charges.service';

const publicationIdSchema = z.string().uuid();

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class AttendanceDeficitChargesController {
  constructor(
    @Inject(AttendanceDeficitChargesService)
    private readonly service: AttendanceDeficitChargesService,
  ) {}

  /** One publication's charges and uncharged facts per Employee. */
  @Get(':agencyId/attendance-payroll-publications/:publicationId/deficit-charges')
  @RequirePermission('leave.deficit_charges.read')
  async read(
    @Param('agencyId') agencyId: string,
    @Param('publicationId') publicationId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<PublicationDeficitCharges> {
    const id = this.resolve(agencyId, publicationId, context);
    return this.call(context, () => this.service.read(context, id));
  }

  /** Rerun one publication's charge; already charged facts are returned unchanged. */
  @Post(':agencyId/attendance-payroll-publications/:publicationId/deficit-charges/run')
  @HttpCode(200)
  @RequirePermission('leave.deficit_charges.run')
  async run(
    @Param('agencyId') agencyId: string,
    @Param('publicationId') publicationId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<PublicationDeficitCharges> {
    const id = this.resolve(agencyId, publicationId, context);
    return this.call(context, () => this.service.run(context, id));
  }

  private resolve(agencyId: string, publicationId: string, context: RequestContext): string {
    const agency = agencyIdSchema.safeParse(agencyId);
    const publication = publicationIdSchema.safeParse(publicationId);
    if (!agency.success || agency.data !== context.agencyId || !publication.success) {
      throw new HttpException(
        {
          error: {
            code: 'ATTENDANCE_PAYROLL_PUBLICATION_NOT_FOUND',
            message: 'The Attendance Payroll Publication could not be found.',
            requestId: context.requestId,
          },
        },
        404,
      );
    }
    return publication.data;
  }

  private async call<T>(context: RequestContext, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error: unknown) {
      if (error instanceof AttendanceDeficitChargeServiceError) {
        throw new HttpException(
          { error: { code: error.code, message: error.message, requestId: context.requestId } },
          error.statusCode,
        );
      }
      throw error;
    }
  }
}
