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
  PdsOutputArtifactListDto,
  PdsVersionDetailDto,
  PdsVersionListResponseDto,
} from './pds.dto';
import {
  pdsCreateSchema,
  pdsEmployeeCertificationSchema,
  pdsEmptyActionSchema,
  pdsReasonSchema,
  pdsUpdateSchema,
  pdsVersionIdSchema,
} from './pds.schemas';
import { employeeIdSchema } from '../employees/employees.schemas';
import { PdsService, PdsServiceError } from './pds.service';

function validationFields(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path.map(String).join('.') || 'form';
    if (fields[field] === undefined) fields[field] = issue.message;
  }
  return fields;
}

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof PdsServiceError) {
    throw new HttpException(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
          requestId,
        },
      },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class PdsController {
  constructor(@Inject(PdsService) private readonly service: PdsService) {}

  @Get(':agencyId/employees/:employeeId/pds')
  @RequirePermission('personnel.pds.read')
  async list(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<PdsVersionListResponseDto> {
    this.assertReadAgency(agencyId, context);
    const parsedEmployeeId = employeeIdSchema.safeParse(employeeId);
    if (!parsedEmployeeId.success) throw this.notFound(context);
    try {
      return new PdsVersionListResponseDto(await this.service.list(context, parsedEmployeeId.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/employees/:employeeId/pds')
  @RequirePermission('personnel.pds.update')
  async createForEmployee(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PdsVersionDetailDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedEmployeeId = employeeIdSchema.safeParse(employeeId);
    const parsed = pdsCreateSchema.safeParse(body ?? {});
    if (!parsedEmployeeId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new PdsVersionDetailDto(
        await this.service.create(context, { ...parsed.data, employeeId: parsedEmployeeId.data }),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/my-pds')
  @RequirePermission('personnel.pds.read')
  async listOwn(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<PdsVersionListResponseDto> {
    this.assertReadAgency(agencyId, context);
    try {
      return new PdsVersionListResponseDto(await this.service.listOwn(context));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/my-pds')
  @RequirePermission('personnel.pds.update')
  async createOwn(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PdsVersionDetailDto> {
    this.assertWriteAgency(agencyId, context);
    const parsed = pdsCreateSchema.safeParse(body ?? {});
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const ownInput = { ...parsed.data };
    delete ownInput.employeeId;
    try {
      return new PdsVersionDetailDto(await this.service.create(context, ownInput));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/pds/:pdsVersionId')
  @RequirePermission('personnel.pds.read')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('pdsVersionId') pdsVersionId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<PdsVersionDetailDto> {
    this.assertReadAgency(agencyId, context);
    const parsedId = pdsVersionIdSchema.safeParse(pdsVersionId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      const value = await this.service.findById(context, parsedId.data);
      if (!value) throw this.notFound(context);
      return new PdsVersionDetailDto(value);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Patch(':agencyId/pds/:pdsVersionId')
  @RequirePermission('personnel.pds.update')
  async update(
    @Param('agencyId') agencyId: string,
    @Param('pdsVersionId') pdsVersionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PdsVersionDetailDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = pdsVersionIdSchema.safeParse(pdsVersionId);
    const parsed = pdsUpdateSchema.safeParse(body ?? {});
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new PdsVersionDetailDto(
        await this.service.update(context, parsedId.data, parsed.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/pds/:pdsVersionId/submit')
  @RequirePermission('personnel.pds.update')
  async submit(
    @Param('agencyId') agencyId: string,
    @Param('pdsVersionId') pdsVersionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PdsVersionDetailDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = pdsVersionIdSchema.safeParse(pdsVersionId);
    const parsed = pdsEmptyActionSchema.safeParse(body ?? {});
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new PdsVersionDetailDto(await this.service.submit(context, parsedId.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/pds/:pdsVersionId/return')
  @RequirePermission('personnel.pds.update')
  async returnForCorrection(
    @Param('agencyId') agencyId: string,
    @Param('pdsVersionId') pdsVersionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PdsVersionDetailDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = pdsVersionIdSchema.safeParse(pdsVersionId);
    const parsed = pdsReasonSchema.safeParse(body ?? {});
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new PdsVersionDetailDto(
        await this.service.returnForCorrection(context, parsedId.data, parsed.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/my-pds/:pdsVersionId/certify')
  @RequirePermission('personnel.pds.certify')
  async certifyOwn(
    @Param('agencyId') agencyId: string,
    @Param('pdsVersionId') pdsVersionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PdsVersionDetailDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = pdsVersionIdSchema.safeParse(pdsVersionId);
    const parsed = pdsEmployeeCertificationSchema.safeParse(body ?? {});
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new PdsVersionDetailDto(
        await this.service.certify(context, parsedId.data, parsed.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/pds/:pdsVersionId/verify')
  @RequirePermission('personnel.pds.certify')
  async verify(
    @Param('agencyId') agencyId: string,
    @Param('pdsVersionId') pdsVersionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PdsVersionDetailDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = pdsVersionIdSchema.safeParse(pdsVersionId);
    const parsed = pdsEmptyActionSchema.safeParse(body ?? {});
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new PdsVersionDetailDto(await this.service.verify(context, parsedId.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/pds/:pdsVersionId/correct')
  @RequirePermission('personnel.pds.update')
  async correct(
    @Param('agencyId') agencyId: string,
    @Param('pdsVersionId') pdsVersionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PdsVersionDetailDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = pdsVersionIdSchema.safeParse(pdsVersionId);
    const parsed = pdsReasonSchema.safeParse(body ?? {});
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new PdsVersionDetailDto(
        await this.service.correct(context, parsedId.data, parsed.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/pds/:pdsVersionId/render')
  @RequirePermission('personnel.pds.update')
  async render(
    @Param('agencyId') agencyId: string,
    @Param('pdsVersionId') pdsVersionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PdsOutputArtifactListDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = pdsVersionIdSchema.safeParse(pdsVersionId);
    const parsed = pdsEmptyActionSchema.safeParse(body ?? {});
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new PdsOutputArtifactListDto(await this.service.render(context, parsedId.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/pds/:pdsVersionId/outputs')
  @RequirePermission('personnel.pds.read')
  async listOutputs(
    @Param('agencyId') agencyId: string,
    @Param('pdsVersionId') pdsVersionId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<PdsOutputArtifactListDto> {
    this.assertReadAgency(agencyId, context);
    const parsedId = pdsVersionIdSchema.safeParse(pdsVersionId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      return new PdsOutputArtifactListDto(await this.service.listOutputs(context, parsedId.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/my-pds/:pdsVersionId/outputs')
  @RequirePermission('personnel.pds.read')
  async listOwnOutputs(
    @Param('agencyId') agencyId: string,
    @Param('pdsVersionId') pdsVersionId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<PdsOutputArtifactListDto> {
    return this.listOutputs(agencyId, pdsVersionId, context);
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
            code: 'PDS_WRITE_FORBIDDEN',
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
        message: 'Enter supported PDS section and workflow values.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'PDS_NOT_FOUND',
          message: 'The PDS Version could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
