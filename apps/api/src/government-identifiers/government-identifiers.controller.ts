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
  Query,
  UseGuards,
} from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import { employeeIdSchema } from '../employees/employees.schemas';
import {
  GovernmentIdentifierDto,
  GovernmentIdentifierHistoryResponseDto,
  GovernmentIdentifierListResponseDto,
  GovernmentIdentifierRevealDto,
} from './government-identifiers.dto';
import {
  governmentIdentifierCreateSchema,
  governmentIdentifierIdSchema,
  governmentIdentifierInvalidateSchema,
  governmentIdentifierReplaceSchema,
  governmentIdentifierRevealSchema,
} from './government-identifiers.schemas';
import {
  GovernmentIdentifiersService,
  GovernmentIdentifiersServiceError,
} from './government-identifiers.service';

function validationFields(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path.map(String).join('.') || 'form';
    if (fields[field] === undefined) fields[field] = issue.message;
  }
  return fields;
}

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof GovernmentIdentifiersServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard)
export class GovernmentIdentifiersController {
  constructor(
    @Inject(GovernmentIdentifiersService)
    private readonly service: GovernmentIdentifiersService,
  ) {}

  @Get(':agencyId/employees/:employeeId/government-identifiers')
  @UseGuards(PermissionGuard)
  @RequirePermission('personnel.identifiers.read')
  async listActive(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<GovernmentIdentifierListResponseDto> {
    this.assertAgency(agencyId, context);
    const parsedEmployeeId = employeeIdSchema.safeParse(employeeId);
    if (!parsedEmployeeId.success) throw this.notFound(context);
    try {
      const identifiers = await this.service.listActive(context, parsedEmployeeId.data);
      if (!identifiers) throw this.notFound(context);
      return new GovernmentIdentifierListResponseDto(identifiers);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/employees/:employeeId/government-identifiers')
  @UseGuards(PermissionGuard)
  @RequirePermission('personnel.identifiers.manage')
  async create(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<GovernmentIdentifierDto> {
    this.assertAgency(agencyId, context);
    const parsedEmployeeId = employeeIdSchema.safeParse(employeeId);
    const parsedBody = governmentIdentifierCreateSchema.safeParse(body);
    if (!parsedEmployeeId.success) throw this.notFound(context);
    if (!parsedBody.success) throw this.invalidInput(parsedBody.error.issues, context);
    try {
      return new GovernmentIdentifierDto(
        await this.service.create(context, parsedEmployeeId.data, parsedBody.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/employees/:employeeId/government-identifiers/history')
  @UseGuards(PermissionGuard)
  @RequirePermission('personnel.identifiers.history.read')
  async history(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Query('identifierId') identifierId: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<GovernmentIdentifierHistoryResponseDto> {
    this.assertAgency(agencyId, context);
    const parsedEmployeeId = employeeIdSchema.safeParse(employeeId);
    const parsedIdentifierId =
      identifierId === undefined ? undefined : governmentIdentifierIdSchema.safeParse(identifierId);
    if (!parsedEmployeeId.success) throw this.notFound(context);
    if (parsedIdentifierId && !parsedIdentifierId.success) throw this.notFound(context);
    try {
      const history = await this.service.history(
        context,
        parsedEmployeeId.data,
        parsedIdentifierId?.data,
      );
      if (!history) throw this.notFound(context);
      return new GovernmentIdentifierHistoryResponseDto(history);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/employees/:employeeId/government-identifiers/:identifierId/replace')
  @UseGuards(PermissionGuard)
  @RequirePermission('personnel.identifiers.manage')
  async replace(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Param('identifierId') identifierId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<GovernmentIdentifierDto> {
    this.assertAgency(agencyId, context);
    const parsedEmployeeId = employeeIdSchema.safeParse(employeeId);
    const parsedIdentifierId = governmentIdentifierIdSchema.safeParse(identifierId);
    const parsedBody = governmentIdentifierReplaceSchema.safeParse(body);
    if (!parsedEmployeeId.success || !parsedIdentifierId.success) throw this.notFound(context);
    if (!parsedBody.success) throw this.invalidInput(parsedBody.error.issues, context);
    try {
      return new GovernmentIdentifierDto(
        await this.service.replace(
          context,
          parsedEmployeeId.data,
          parsedIdentifierId.data,
          parsedBody.data,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Patch(':agencyId/employees/:employeeId/government-identifiers/:identifierId/invalidate')
  @UseGuards(PermissionGuard)
  @RequirePermission('personnel.identifiers.manage')
  async invalidate(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Param('identifierId') identifierId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<GovernmentIdentifierDto> {
    this.assertAgency(agencyId, context);
    const parsedEmployeeId = employeeIdSchema.safeParse(employeeId);
    const parsedIdentifierId = governmentIdentifierIdSchema.safeParse(identifierId);
    const parsedBody = governmentIdentifierInvalidateSchema.safeParse(body);
    if (!parsedEmployeeId.success || !parsedIdentifierId.success) throw this.notFound(context);
    if (!parsedBody.success) throw this.invalidInput(parsedBody.error.issues, context);
    try {
      return new GovernmentIdentifierDto(
        await this.service.invalidate(
          context,
          parsedEmployeeId.data,
          parsedIdentifierId.data,
          parsedBody.data,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/employees/:employeeId/government-identifiers/:identifierId/reveal')
  async reveal(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Param('identifierId') identifierId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<GovernmentIdentifierRevealDto> {
    this.assertAgency(agencyId, context);
    const parsedEmployeeId = employeeIdSchema.safeParse(employeeId);
    const parsedIdentifierId = governmentIdentifierIdSchema.safeParse(identifierId);
    const parsedBody = governmentIdentifierRevealSchema.safeParse(body ?? {});
    if (!parsedEmployeeId.success || !parsedIdentifierId.success) throw this.notFound(context);
    if (!parsedBody.success) throw this.invalidInput(parsedBody.error.issues, context);
    try {
      return new GovernmentIdentifierRevealDto(
        await this.service.reveal(
          context,
          parsedEmployeeId.data,
          parsedIdentifierId.data,
          parsedBody.data,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private assertAgency(agencyId: string, context: RequestContext): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success || parsed.data !== context.agencyId) throw this.notFound(context);
  }

  private invalidInput(
    issues: readonly { path: PropertyKey[]; message: string }[],
    context: RequestContext,
  ): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'INVALID_INPUT',
        message: 'Enter a supported government identifier value and evidence reference.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'GOVERNMENT_IDENTIFIER_NOT_FOUND',
          message: 'The government identifier could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
