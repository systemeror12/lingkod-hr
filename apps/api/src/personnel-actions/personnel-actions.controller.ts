import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
  personnelActionCreateSchema,
  personnelActionDecisionSchema,
  personnelActionIdSchema,
  personnelActionReasonSchema,
  personnelActionReviewSchema,
  personnelActionUpdateSchema,
} from './personnel-actions.schemas';
import {
  PersonnelActionServiceError,
  PersonnelActionsService,
  type PersonnelActionAuthority,
  type PersonnelActionHistory,
  type PersonnelActionSummary,
} from './personnel-actions.service';

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof PersonnelActionServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class PersonnelActionsController {
  constructor(@Inject(PersonnelActionsService) private readonly service: PersonnelActionsService) {}

  @Get(':agencyId/personnel-actions')
  @RequirePermission('personnel.actions.read')
  async list(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ actions: PersonnelActionSummary[] }> {
    this.assertReadAgency(agencyId, context);
    try {
      return { actions: await this.service.list(context) };
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/personnel-actions')
  @RequirePermission('personnel.actions.create')
  async create(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PersonnelActionSummary> {
    this.assertWriteAgency(agencyId, context);
    const parsed = personnelActionCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return await this.service.create(context, parsed.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/personnel-actions/:actionId/history')
  @RequirePermission('personnel.actions.audit.read')
  async history(
    @Param('agencyId') agencyId: string,
    @Param('actionId') actionId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<PersonnelActionHistory> {
    this.assertReadAgency(agencyId, context);
    const id = this.parseId(actionId, context);
    try {
      const history = await this.service.history(context, id);
      if (!history) throw this.notFound(context);
      return history;
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/personnel-actions/:actionId/authority')
  @RequirePermission('personnel.actions.read')
  async authority(
    @Param('agencyId') agencyId: string,
    @Param('actionId') actionId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<PersonnelActionAuthority> {
    this.assertReadAgency(agencyId, context);
    const id = this.parseId(actionId, context);
    try {
      const authority = await this.service.authority(context, id);
      if (!authority) throw this.notFound(context);
      return authority;
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/personnel-actions/:actionId')
  @RequirePermission('personnel.actions.read')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('actionId') actionId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<PersonnelActionSummary> {
    this.assertReadAgency(agencyId, context);
    const id = this.parseId(actionId, context);
    try {
      const action = await this.service.findById(context, id);
      if (!action) throw this.notFound(context);
      return action;
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Patch(':agencyId/personnel-actions/:actionId')
  @RequirePermission('personnel.actions.create')
  async updateDraft(
    @Param('agencyId') agencyId: string,
    @Param('actionId') actionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PersonnelActionSummary> {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(actionId, context);
    const parsed = personnelActionUpdateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const { rowVersion, ...draft } = parsed.data;
    const input = personnelActionCreateSchema.parse(draft);
    try {
      return await this.service.updateDraft(
        context,
        id,
        input,
        typeof rowVersion === 'number' ? rowVersion : undefined,
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/personnel-actions/:actionId/submit')
  @RequirePermission('personnel.actions.submit')
  async submit(
    @Param('agencyId') agencyId: string,
    @Param('actionId') actionId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<PersonnelActionSummary> {
    this.assertWriteAgency(agencyId, context);
    try {
      return await this.service.submit(context, this.parseId(actionId, context));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/personnel-actions/:actionId/review')
  async review(
    @Param('agencyId') agencyId: string,
    @Param('actionId') actionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PersonnelActionSummary> {
    this.assertWriteAgency(agencyId, context);
    const parsed = personnelActionReviewSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return await this.service.review(context, this.parseId(actionId, context), parsed.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/personnel-actions/:actionId/decision')
  async decide(
    @Param('agencyId') agencyId: string,
    @Param('actionId') actionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PersonnelActionSummary> {
    this.assertWriteAgency(agencyId, context);
    const parsed = personnelActionDecisionSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return await this.service.decide(context, this.parseId(actionId, context), parsed.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/personnel-actions/:actionId/cancel')
  async cancel(
    @Param('agencyId') agencyId: string,
    @Param('actionId') actionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PersonnelActionSummary> {
    this.assertWriteAgency(agencyId, context);
    const parsed = personnelActionReasonSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return await this.service.cancel(
        context,
        this.parseId(actionId, context),
        parsed.data.reason,
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/personnel-actions/:actionId/replace')
  @RequirePermission('personnel.actions.correct')
  async replace(
    @Param('agencyId') agencyId: string,
    @Param('actionId') actionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PersonnelActionSummary> {
    this.assertWriteAgency(agencyId, context);
    const parsed = personnelActionCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return await this.service.replace(context, this.parseId(actionId, context), parsed.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/personnel-actions/:actionId/effectuate')
  @RequirePermission('personnel.actions.effectuate')
  async effectuate(
    @Param('agencyId') agencyId: string,
    @Param('actionId') actionId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<never> {
    this.assertWriteAgency(agencyId, context);
    try {
      return await this.service.requestEffectuation(context, this.parseId(actionId, context));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private parseId(value: string, context: RequestContext): string {
    const parsed = personnelActionIdSchema.safeParse(value);
    if (!parsed.success) throw this.notFound(context);
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
            code: 'PERSONNEL_ACTION_WRITE_FORBIDDEN',
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
    const fields: Record<string, string> = {};
    for (const issue of issues) {
      const field = issue.path[0];
      if (typeof field === 'string' && fields[field] === undefined) fields[field] = issue.message;
    }
    return new BadRequestException({
      error: {
        code: 'INVALID_INPUT',
        message: 'Enter a supported, source-backed Personnel Action.',
        fields,
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'PERSONNEL_ACTION_NOT_FOUND',
          message: 'The Personnel Action could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
