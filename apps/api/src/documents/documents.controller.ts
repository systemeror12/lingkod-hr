import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
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
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import { DocumentAccessDto, DocumentDto } from './documents.dto';
import {
  documentCreateSchema,
  documentIdSchema,
  documentVersionCreateSchema,
} from './documents.schemas';
import {
  DocumentsService,
  DocumentsServiceError,
  type UploadedDocumentFile,
} from './documents.service';

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post(':agencyId/documents')
  @RequirePermission('documents.evidence.create')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: getConfig().EXTERNAL_EVIDENCE_MAX_SIZE_BYTES },
    }),
  )
  async create(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @UploadedFile() file: UploadedDocumentFile | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<DocumentDto> {
    this.assertWriteAgency(agencyId, context);
    const parsed = documentCreateSchema.safeParse(body);
    if (!parsed.success || !file || !idempotencyKey?.trim()) {
      throw this.invalidInput(context);
    }
    try {
      return new DocumentDto(
        await this.documentsService.create(context, {
          ...parsed.data,
          documentNo: parsed.data.documentNo ?? null,
          idempotencyKey,
          file,
        }),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/documents/:documentId')
  @RequirePermission('documents.evidence.read')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('documentId') documentId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<DocumentDto> {
    this.assertReadAgency(agencyId, context);
    const parsedId = documentIdSchema.safeParse(documentId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      const document = await this.documentsService.findById(context, parsedId.data);
      if (!document) throw this.notFound(context);
      return new DocumentDto(document);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/documents/:documentId/access')
  @RequirePermission('documents.evidence.read')
  async access(
    @Param('agencyId') agencyId: string,
    @Param('documentId') documentId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<DocumentAccessDto> {
    return this.accessVersion(agencyId, documentId, undefined, context);
  }

  @Get(':agencyId/documents/:documentId/versions/:versionId/access')
  @RequirePermission('documents.evidence.read')
  async accessVersion(
    @Param('agencyId') agencyId: string,
    @Param('documentId') documentId: string,
    @Param('versionId') versionId: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<DocumentAccessDto> {
    this.assertReadAgency(agencyId, context);
    const parsedDocumentId = documentIdSchema.safeParse(documentId);
    const parsedVersionId =
      versionId === undefined ? undefined : documentIdSchema.safeParse(versionId);
    if (!parsedDocumentId.success || (parsedVersionId && !parsedVersionId.success)) {
      throw this.notFound(context);
    }
    try {
      const access = await this.documentsService.issueAccessLink(
        context,
        parsedDocumentId.data,
        parsedVersionId?.data,
      );
      if (!access) throw this.notFound(context);
      return new DocumentAccessDto(access);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/documents/:documentId/versions')
  @RequirePermission('documents.evidence.create')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: getConfig().EXTERNAL_EVIDENCE_MAX_SIZE_BYTES },
    }),
  )
  async createVersion(
    @Param('agencyId') agencyId: string,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
    @UploadedFile() file: UploadedDocumentFile | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<DocumentDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedDocumentId = documentIdSchema.safeParse(documentId);
    const parsedBody = documentVersionCreateSchema.safeParse(body ?? {});
    if (!parsedDocumentId.success || !parsedBody.success || !file || !idempotencyKey?.trim()) {
      throw this.invalidInput(context);
    }
    try {
      return new DocumentDto(
        await this.documentsService.createVersion(
          context,
          parsedDocumentId.data,
          file,
          idempotencyKey,
        ),
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
            code: 'DOCUMENT_WRITE_FORBIDDEN',
            message: 'The requested Agency is outside the active context.',
            requestId: context.requestId,
          },
        },
        403,
      );
    }
  }

  private invalidInput(context: RequestContext): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'INVALID_INPUT',
        message:
          'Enter an Idempotency-Key, document type, classification, and a non-empty supported file.',
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'DOCUMENT_NOT_FOUND',
          message: 'The Document could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof DocumentsServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}
