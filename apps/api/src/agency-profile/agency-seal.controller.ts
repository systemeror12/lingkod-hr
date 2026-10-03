import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Injectable,
  PayloadTooLargeException,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import type { RequestContext } from '@lingkod-hr/auth';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import {
  AgencySealService,
  SEAL_MAX_BYTES,
  sealError,
  type SealUpload,
} from './agency-seal.service';

const revisionSchema = z.object({
  expectedSealId: z.union([z.uuid(), z.literal('')]).transform((value) => value || null),
});

@Injectable()
class SealUploadInterceptor extends FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: SEAL_MAX_BYTES + 1, files: 1, fields: 1 },
  fileFilter(request, file, callback) {
    (request as typeof request & { sealFileName?: string }).sealFileName = file.originalname;
    callback(null, true);
  },
}) {
  async intercept(context: ExecutionContext, next: CallHandler) {
    try {
      return await super.intercept(context, next);
    } catch (error) {
      if (error instanceof PayloadTooLargeException) {
        const request = context
          .switchToHttp()
          .getRequest<{ sealFileName?: string; authSession: { context: RequestContext } }>();
        throw sealError(
          request.authSession.context,
          'AGENCY_SEAL_TOO_LARGE',
          `${request.sealFileName ?? 'Selected file'}: Use a file no larger than 2 MB. The current seal is unchanged.`,
        );
      }
      throw error;
    }
  }
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class AgencySealController {
  constructor(@Inject(AgencySealService) private readonly service: AgencySealService) {}

  @Get(':agencyId/agency-profile/seal')
  @RequirePermission('organization.agency.read')
  read(@Param('agencyId') agencyId: string, @CurrentContext() context: RequestContext) {
    this.assertAgency(agencyId, context);
    return this.service.read(context);
  }

  @Put(':agencyId/agency-profile/seal')
  @RequirePermission('organization.agency.update')
  @UseInterceptors(SealUploadInterceptor)
  save(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @UploadedFile() file: SealUpload | undefined,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertAgency(agencyId, context);
    const expectedSealId = this.revision(body, context);
    if (!file) throw sealError(context, 'INVALID_INPUT', 'Choose a seal file.');
    return this.service.save(context, file, expectedSealId);
  }

  @Delete(':agencyId/agency-profile/seal')
  @RequirePermission('organization.agency.update')
  remove(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertAgency(agencyId, context);
    return this.service.remove(context, this.revision(body, context));
  }

  private revision(body: unknown, context: RequestContext) {
    const parsed = revisionSchema.safeParse(body);
    if (!parsed.success)
      throw sealError(
        context,
        'INVALID_INPUT',
        'The current seal reference is invalid. Reload this page.',
      );
    return parsed.data.expectedSealId;
  }

  private assertAgency(agencyId: string, context: RequestContext) {
    if (agencyId !== context.agencyId)
      throw sealError(
        context,
        'AGENCY_SEAL_FORBIDDEN',
        'The requested Agency is outside the active context.',
        403,
      );
  }
}
