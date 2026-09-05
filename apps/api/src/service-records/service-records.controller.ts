import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { CurrentContext } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import {
  serviceRecordGenerationSchema,
  serviceRecordIdSchema,
  serviceRecordReplacementSchema,
} from './service-records.schemas';
import {
  ServiceRecordServiceError,
  ServiceRecordsService,
  type ServiceRecordData,
  type ServiceRecordSummary,
} from './service-records.service';

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof ServiceRecordServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class ServiceRecordsController {
  constructor(@Inject(ServiceRecordsService) private readonly service: ServiceRecordsService) {}

  @Get(':agencyId/service-records')
  async list(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ records: ServiceRecordSummary[] }> {
    this.assertAgency(agencyId, context);
    try {
      return { records: await this.service.list(context) };
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/service-records')
  async generate(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<ServiceRecordSummary> {
    this.assertAgency(agencyId, context);
    const input = serviceRecordGenerationSchema.safeParse(body);
    if (!input.success) throw this.invalidInput(context);
    try {
      return await this.service.generate(context, input.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/service-records/:snapshotId')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('snapshotId') snapshotId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<ServiceRecordSummary> {
    return this.read(agencyId, snapshotId, context, 'DETAIL');
  }

  @Get(':agencyId/service-records/:snapshotId/structured')
  async structured(
    @Param('agencyId') agencyId: string,
    @Param('snapshotId') snapshotId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<ServiceRecordData> {
    return (await this.read(agencyId, snapshotId, context, 'STRUCTURED')).snapshot;
  }

  @Get(':agencyId/service-records/:snapshotId/printable')
  async printable(
    @Param('agencyId') agencyId: string,
    @Param('snapshotId') snapshotId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<ServiceRecordData> {
    return (await this.read(agencyId, snapshotId, context, 'PRINTABLE')).snapshot;
  }

  @Post(':agencyId/service-records/:snapshotId/replace')
  async replace(
    @Param('agencyId') agencyId: string,
    @Param('snapshotId') snapshotId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<ServiceRecordSummary> {
    this.assertAgency(agencyId, context);
    const input = serviceRecordReplacementSchema.safeParse(body);
    if (!input.success) throw this.invalidInput(context);
    try {
      return await this.service.replace(context, this.parseId(snapshotId, context), input.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private async read(
    agencyId: string,
    snapshotId: string,
    context: RequestContext,
    accessKind: 'DETAIL' | 'PRINTABLE' | 'STRUCTURED',
  ): Promise<ServiceRecordSummary> {
    this.assertAgency(agencyId, context);
    try {
      const record = await this.service.findById(
        context,
        this.parseId(snapshotId, context),
        accessKind,
      );
      if (!record) throw this.notFound(context);
      return record;
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private assertAgency(agencyId: string, context: RequestContext): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success) throw this.invalidInput(context);
    if (parsed.data !== context.agencyId) throw this.notFound(context);
  }

  private parseId(value: string, context: RequestContext): string {
    const parsed = serviceRecordIdSchema.safeParse(value);
    if (!parsed.success) throw this.invalidInput(context);
    return parsed.data;
  }

  private invalidInput(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'SERVICE_RECORD_INPUT_INVALID',
          message: 'The Service Record input is invalid.',
          requestId: context.requestId,
        },
      },
      400,
    );
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'SERVICE_RECORD_NOT_FOUND',
          message: 'The Service Record was not found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
