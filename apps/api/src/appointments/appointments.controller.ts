import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import {
  appointmentCancelSchema,
  appointmentCorrectionSchema,
  appointmentCreateSchema,
  appointmentExternalActionSchema,
  appointmentExternalSubmissionSchema,
  appointmentIdSchema,
  appointmentIdempotencyKeySchema,
  appointmentListSchema,
  appointmentReasonSchema,
  appointmentSettingsSchema,
  appointmentUpdateSchema,
} from './appointments.schemas';
import { AppointmentServiceError, AppointmentsService } from './appointments.service';

function validationFields(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && fields[field] === undefined) fields[field] = issue.message;
  }
  return fields;
}

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof AppointmentServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class AppointmentsController {
  constructor(@Inject(AppointmentsService) private readonly service: AppointmentsService) {}

  @Get(':agencyId/appointments')
  @RequirePermission('appointments.records.read')
  async list(
    @Param('agencyId') agencyId: string,
    @Query() query: unknown,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertReadAgency(agencyId, context);
    const parsed = appointmentListSchema.safeParse(query ?? {});
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      const page = await this.service.list(context, parsed.data);
      return { appointments: page.items, hasMore: page.hasMore, nextOffset: page.nextOffset };
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/appointments/eligible-selections')
  @RequirePermission('appointments.records.read')
  async listEligibleSelections(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertReadAgency(agencyId, context);
    try {
      return await this.service.listEligibleSelections(context);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/appointments')
  @RequirePermission('appointments.records.create')
  async create(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const parsed = appointmentCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.create(context, parsed.data, key);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/appointments/:appointmentId')
  @RequirePermission('appointments.records.read')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('appointmentId') appointmentId: string,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertReadAgency(agencyId, context);
    const id = this.parseId(appointmentId, context);
    try {
      return await this.service.findById(context, id);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Patch(':agencyId/appointments/:appointmentId')
  @RequirePermission('appointments.records.create')
  async updateDraft(
    @Param('agencyId') agencyId: string,
    @Param('appointmentId') appointmentId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(appointmentId, context);
    const parsed = appointmentUpdateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.updateDraft(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/appointments/:appointmentId/submit')
  @RequirePermission('appointments.records.submit')
  async submit(
    @Param('agencyId') agencyId: string,
    @Param('appointmentId') appointmentId: string,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(appointmentId, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.submit(context, id, key);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/appointments/:appointmentId/return')
  @RequirePermission('appointments.records.return')
  async returnForCorrection(
    @Param('agencyId') agencyId: string,
    @Param('appointmentId') appointmentId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(appointmentId, context);
    const parsed = appointmentReasonSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.returnForCorrection(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/appointments/:appointmentId/endorse')
  @RequirePermission('appointments.records.endorse')
  async endorse(
    @Param('agencyId') agencyId: string,
    @Param('appointmentId') appointmentId: string,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(appointmentId, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.endorse(context, id, key);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/appointments/:appointmentId/issue')
  @RequirePermission('appointments.records.issue')
  async issue(
    @Param('agencyId') agencyId: string,
    @Param('appointmentId') appointmentId: string,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(appointmentId, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.issue(context, id, key);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/appointments/:appointmentId/cancel')
  @RequirePermission('appointments.records.cancel')
  async cancel(
    @Param('agencyId') agencyId: string,
    @Param('appointmentId') appointmentId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(appointmentId, context);
    const parsed = appointmentCancelSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.cancel(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/appointments/:appointmentId/corrections')
  @RequirePermission('appointments.records.create')
  async correct(
    @Param('agencyId') agencyId: string,
    @Param('appointmentId') appointmentId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(appointmentId, context);
    const parsed = appointmentCorrectionSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.correct(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/appointments/:appointmentId/external-submissions')
  @RequirePermission('appointments.external_events.record')
  async recordExternalSubmission(
    @Param('agencyId') agencyId: string,
    @Param('appointmentId') appointmentId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(appointmentId, context);
    const parsed = appointmentExternalSubmissionSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.recordExternalSubmission(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/appointments/:appointmentId/external-actions')
  @RequirePermission('appointments.external_actions.record')
  async recordExternalAction(
    @Param('agencyId') agencyId: string,
    @Param('appointmentId') appointmentId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(appointmentId, context);
    const parsed = appointmentExternalActionSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.recordExternalAction(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/appointment-settings')
  @RequirePermission('appointments.records.read')
  async getSettings(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertReadAgency(agencyId, context);
    try {
      return await this.service.getSettings(context);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Put(':agencyId/appointment-settings')
  @RequirePermission('appointments.settings.manage')
  async configureSettings(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const parsed = appointmentSettingsSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.configureSettings(context, parsed.data, key);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private parseId(value: string, context: RequestContext): string {
    const parsed = appointmentIdSchema.safeParse(value);
    if (!parsed.success) throw this.notFound(context);
    return parsed.data;
  }

  private parseIdempotencyKey(
    value: string | undefined,
    context: RequestContext,
  ): string | undefined {
    if (value === undefined) return undefined;
    const parsed = appointmentIdempotencyKeySchema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_IDEMPOTENCY_KEY',
          message: 'Enter a valid Idempotency-Key.',
          requestId: context.requestId,
        },
      });
    }
    return parsed.data;
  }

  private assertReadAgency(agencyId: string, context: RequestContext): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success || parsed.data !== context.agencyId) throw this.notFound(context);
  }

  private assertWriteAgency(agencyId: string, context: RequestContext): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success || parsed.data !== context.agencyId) {
      throw new HttpException(
        {
          error: {
            code: 'APPOINTMENT_WRITE_FORBIDDEN',
            message: 'The requested Agency is outside the active context.',
            requestId: context.requestId,
          },
        },
        403,
      );
    }
  }

  private invalidInput(
    issues: readonly { path: PropertyKey[]; message: string }[],
    context: RequestContext,
  ): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'INVALID_INPUT',
        message: 'Enter supported Appointment values.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'APPOINTMENT_NOT_FOUND',
          message: 'The Appointment could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
