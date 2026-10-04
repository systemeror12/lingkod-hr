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
} from '@nestjs/common';
import { z } from 'zod';
import type { RequestContext } from '@lingkod-hr/auth';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { brandError, brandImageInterceptor, type BrandImageUpload } from './agency-brand-image';
import { AgencySealService, SEAL_RULES } from './agency-seal.service';

const revisionSchema = z.object({
  expectedSealId: z.union([z.uuid(), z.literal('')]).transform((value) => value || null),
});

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
  @UseInterceptors(brandImageInterceptor(SEAL_RULES))
  save(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @UploadedFile() file: BrandImageUpload | undefined,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertAgency(agencyId, context);
    const expectedSealId = this.revision(body, context);
    if (!file) throw brandError(context, 'INVALID_INPUT', 'Choose a seal file.');
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
      throw brandError(
        context,
        'INVALID_INPUT',
        'The current seal reference is invalid. Reload this page.',
      );
    return parsed.data.expectedSealId;
  }

  private assertAgency(agencyId: string, context: RequestContext) {
    if (agencyId !== context.agencyId)
      throw brandError(
        context,
        'AGENCY_SEAL_FORBIDDEN',
        'The requested Agency is outside the active context.',
        403,
      );
  }
}
