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
  UseGuards,
} from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import {
  PersonnelBaselineDto,
  PersonnelBaselineHistoryResponseDto,
  PersonnelBaselineListResponseDto,
} from './personnel-baselines.dto';
import {
  personnelBaselineCreateSchema,
  personnelBaselineIdempotencyKeySchema,
  personnelBaselineIdSchema,
  personnelBaselineReviewSchema,
  personnelBaselineUpdateSchema,
  personnelBaselineVoidSchema,
} from './personnel-baselines.schemas';
import {
  PersonnelBaselineServiceError,
  PersonnelBaselinesService,
} from './personnel-baselines.service';

function validationFields(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && fields[field] === undefined) fields[field] = issue.message;
  }
  return fields;
}

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof PersonnelBaselineServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class PersonnelBaselinesController {
  constructor(
    @Inject(PersonnelBaselinesService) private readonly service: PersonnelBaselinesService,
  ) {}

  @Get(':agencyId/personnel-baselines')
  @RequirePermission('personnel.baselines.read')
  async list(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<PersonnelBaselineListResponseDto> {
    this.assertReadAgency(agencyId, context);
    try {
      return new PersonnelBaselineListResponseDto(await this.service.list(context));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/personnel-baselines')
  @RequirePermission('personnel.baselines.prepare')
  async create(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PersonnelBaselineDto> {
    this.assertWriteAgency(agencyId, context);
    const parsed = personnelBaselineCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new PersonnelBaselineDto(await this.service.create(context, parsed.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/personnel-baselines/:baselineId/history')
  @RequirePermission('personnel.baselines.audit.read')
  async history(
    @Param('agencyId') agencyId: string,
    @Param('baselineId') baselineId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<PersonnelBaselineHistoryResponseDto> {
    this.assertReadAgency(agencyId, context);
    const parsedId = personnelBaselineIdSchema.safeParse(baselineId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      const history = await this.service.history(context, parsedId.data);
      if (!history) throw this.notFound(context);
      return new PersonnelBaselineHistoryResponseDto(history);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/personnel-baselines/:baselineId')
  @RequirePermission('personnel.baselines.read')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('baselineId') baselineId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<PersonnelBaselineDto> {
    this.assertReadAgency(agencyId, context);
    const parsedId = personnelBaselineIdSchema.safeParse(baselineId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      const baseline = await this.service.findById(context, parsedId.data);
      if (!baseline) throw this.notFound(context);
      return new PersonnelBaselineDto(baseline);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Patch(':agencyId/personnel-baselines/:baselineId')
  @RequirePermission('personnel.baselines.prepare')
  async updateDraft(
    @Param('agencyId') agencyId: string,
    @Param('baselineId') baselineId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PersonnelBaselineDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = personnelBaselineIdSchema.safeParse(baselineId);
    const parsed = personnelBaselineUpdateSchema.safeParse(body);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new PersonnelBaselineDto(
        await this.service.updateDraft(context, parsedId.data, parsed.data, parsed.data.rowVersion),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/personnel-baselines/:baselineId/submit')
  @RequirePermission('personnel.baselines.prepare')
  async submit(
    @Param('agencyId') agencyId: string,
    @Param('baselineId') baselineId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<PersonnelBaselineDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = personnelBaselineIdSchema.safeParse(baselineId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      return new PersonnelBaselineDto(await this.service.submit(context, parsedId.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/personnel-baselines/:baselineId/review')
  @RequirePermission('personnel.baselines.review')
  async review(
    @Param('agencyId') agencyId: string,
    @Param('baselineId') baselineId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PersonnelBaselineDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = personnelBaselineIdSchema.safeParse(baselineId);
    const parsed = personnelBaselineReviewSchema.safeParse(body);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new PersonnelBaselineDto(
        await this.service.review(context, parsedId.data, parsed.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/personnel-baselines/:baselineId/effectuate')
  @RequirePermission('personnel.baselines.effectuate')
  async effectuate(
    @Param('agencyId') agencyId: string,
    @Param('baselineId') baselineId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<PersonnelBaselineDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = personnelBaselineIdSchema.safeParse(baselineId);
    const parsedKey = idempotencyKey
      ? personnelBaselineIdempotencyKeySchema.safeParse(idempotencyKey)
      : { success: true as const, data: undefined };
    if (!parsedId.success) throw this.notFound(context);
    if (!parsedKey.success) throw this.invalidInput(parsedKey.error.issues, context);
    try {
      return new PersonnelBaselineDto(
        await this.service.effectuate(context, parsedId.data, parsedKey.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/personnel-baselines/:baselineId/correct')
  @RequirePermission('personnel.baselines.correct')
  async correct(
    @Param('agencyId') agencyId: string,
    @Param('baselineId') baselineId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PersonnelBaselineDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = personnelBaselineIdSchema.safeParse(baselineId);
    const parsed = personnelBaselineCreateSchema.safeParse(body);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new PersonnelBaselineDto(
        await this.service.correct(context, parsedId.data, parsed.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/personnel-baselines/:baselineId/void')
  @RequirePermission('personnel.baselines.correct')
  async void(
    @Param('agencyId') agencyId: string,
    @Param('baselineId') baselineId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PersonnelBaselineDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = personnelBaselineIdSchema.safeParse(baselineId);
    const parsed = personnelBaselineVoidSchema.safeParse(body);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new PersonnelBaselineDto(
        await this.service.void(context, parsedId.data, parsed.data.reason),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
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
            code: 'PERSONNEL_BASELINE_WRITE_FORBIDDEN',
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
        message: 'Enter complete Personnel Baseline evidence and service values.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'PERSONNEL_BASELINE_NOT_FOUND',
          message: 'The Personnel Baseline could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
