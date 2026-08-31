import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpException,
  Inject,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { RequestContext } from '@lingkod-hr/auth';
import { getConfig } from '@lingkod-hr/config';
import { CurrentContext } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { DocumentsServiceError, type UploadedDocumentFile } from '../documents/documents.service';
import {
  EmployeeDocumentAccessDto,
  EmployeeDocumentDto,
  EmployeeDocumentListResponseDto,
  EmployeeDocumentRemovalDto,
} from './employee-documents.dto';
import {
  employeeDocumentIdSchema,
  employeeDocumentLinkSchema,
  employeeDocumentRemovalSchema,
  employeeDocumentUploadSchema,
} from './employee-documents.schemas';
import {
  EmployeeDocumentsService,
  EmployeeDocumentsServiceError,
} from './employee-documents.service';

@Controller('agencies')
@UseGuards(AuthGuard)
export class EmployeeDocumentsController {
  constructor(
    @Inject(EmployeeDocumentsService) private readonly service: EmployeeDocumentsService,
  ) {}

  @Get(':agencyId/employees/:employeeId/documents')
  async list(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<EmployeeDocumentListResponseDto> {
    this.assertAgency(agencyId, context);
    const parsedEmployeeId = employeeDocumentIdSchema.safeParse(employeeId);
    if (!parsedEmployeeId.success) throw this.notFound(context);
    try {
      const documents = await this.service.list(context, parsedEmployeeId.data);
      if (!documents) throw this.notFound(context);
      return new EmployeeDocumentListResponseDto(documents);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/employees/:employeeId/documents')
  async link(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<EmployeeDocumentDto> {
    this.assertAgency(agencyId, context);
    const parsedEmployeeId = employeeDocumentIdSchema.safeParse(employeeId);
    const parsedBody = employeeDocumentLinkSchema.safeParse(body);
    if (!parsedEmployeeId.success) throw this.notFound(context);
    if (!parsedBody.success) throw this.invalidInput(parsedBody.error.issues, context);
    try {
      return new EmployeeDocumentDto(
        await this.service.link(context, parsedEmployeeId.data, parsedBody.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/employees/:employeeId/documents/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: getConfig().EXTERNAL_EVIDENCE_MAX_SIZE_BYTES },
    }),
  )
  async upload(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
    @UploadedFile() file: UploadedDocumentFile | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<EmployeeDocumentDto> {
    this.assertAgency(agencyId, context);
    const parsedEmployeeId = employeeDocumentIdSchema.safeParse(employeeId);
    const parsedBody = employeeDocumentUploadSchema.safeParse(body);
    if (!parsedEmployeeId.success) throw this.notFound(context);
    if (!parsedBody.success || !file || !idempotencyKey?.trim()) {
      throw this.invalidInput(parsedBody.success ? [] : parsedBody.error.issues, context);
    }
    try {
      return new EmployeeDocumentDto(
        await this.service.upload(context, parsedEmployeeId.data, {
          ...parsedBody.data,
          idempotencyKey,
          file,
        }),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/employees/:employeeId/documents/:linkId/access')
  async access(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Param('linkId') linkId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<EmployeeDocumentAccessDto> {
    this.assertAgency(agencyId, context);
    const parsedEmployeeId = employeeDocumentIdSchema.safeParse(employeeId);
    const parsedLinkId = employeeDocumentIdSchema.safeParse(linkId);
    if (!parsedEmployeeId.success || !parsedLinkId.success) throw this.notFound(context);
    try {
      const document = await this.service.access(context, parsedEmployeeId.data, parsedLinkId.data);
      if (!document) throw this.notFound(context);
      return new EmployeeDocumentAccessDto(document);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Delete(':agencyId/employees/:employeeId/documents/:linkId')
  async remove(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Param('linkId') linkId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<EmployeeDocumentRemovalDto> {
    this.assertAgency(agencyId, context);
    const parsedEmployeeId = employeeDocumentIdSchema.safeParse(employeeId);
    const parsedLinkId = employeeDocumentIdSchema.safeParse(linkId);
    const parsedBody = employeeDocumentRemovalSchema.safeParse(body ?? {});
    if (!parsedEmployeeId.success || !parsedLinkId.success) throw this.notFound(context);
    if (!parsedBody.success) throw this.invalidInput(parsedBody.error.issues, context);
    try {
      await this.service.remove(
        context,
        parsedEmployeeId.data,
        parsedLinkId.data,
        parsedBody.data.reason,
      );
      return new EmployeeDocumentRemovalDto();
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
    const fields: Record<string, string> = {};
    for (const issue of issues) {
      const field = issue.path[0];
      if (typeof field === 'string' && fields[field] === undefined) fields[field] = issue.message;
    }
    return new BadRequestException({
      error: {
        code: 'INVALID_INPUT',
        message:
          'Enter an exact Document Version, supported personnel classification, purpose, and file.',
        fields,
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'EMPLOYEE_DOCUMENT_NOT_FOUND',
          message: 'The Employee or Personnel Document could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof EmployeeDocumentsServiceError || error instanceof DocumentsServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}
