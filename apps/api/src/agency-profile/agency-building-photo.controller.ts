import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
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
import { AgencyBuildingPhotoService, PHOTO_RULES } from './agency-building-photo.service';

const expectedPhotoId = z.union([z.uuid(), z.literal('')]).transform((value) => value || null);
const revisionSchema = z.object({ expectedPhotoId });
const shownSchema = z.object({ expectedPhotoId, shown: z.boolean() });

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class AgencyBuildingPhotoController {
  constructor(
    @Inject(AgencyBuildingPhotoService) private readonly service: AgencyBuildingPhotoService,
  ) {}

  @Get(':agencyId/agency-profile/building-photo')
  @RequirePermission('organization.agency.read')
  read(@Param('agencyId') agencyId: string, @CurrentContext() context: RequestContext) {
    this.assertAgency(agencyId, context);
    return this.service.read(context);
  }

  @Put(':agencyId/agency-profile/building-photo')
  @RequirePermission('organization.agency.update')
  @UseInterceptors(brandImageInterceptor(PHOTO_RULES))
  save(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @UploadedFile() file: BrandImageUpload | undefined,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertAgency(agencyId, context);
    const { expectedPhotoId } = this.parse(revisionSchema, body, context);
    if (!file) throw brandError(context, 'INVALID_INPUT', 'Choose a building photo file.');
    return this.service.save(context, file, expectedPhotoId);
  }

  @Patch(':agencyId/agency-profile/building-photo')
  @RequirePermission('organization.agency.update')
  setShown(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertAgency(agencyId, context);
    const { expectedPhotoId, shown } = this.parse(shownSchema, body, context);
    return this.service.setShown(context, expectedPhotoId, shown);
  }

  @Delete(':agencyId/agency-profile/building-photo')
  @RequirePermission('organization.agency.update')
  remove(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertAgency(agencyId, context);
    return this.service.remove(context, this.parse(revisionSchema, body, context).expectedPhotoId);
  }

  private parse<T>(schema: z.ZodType<T>, body: unknown, context: RequestContext): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw brandError(
        context,
        'INVALID_INPUT',
        'The current building photo reference is invalid. Reload this page.',
      );
    return parsed.data;
  }

  private assertAgency(agencyId: string, context: RequestContext) {
    if (agencyId !== context.agencyId)
      throw brandError(
        context,
        'AGENCY_PHOTO_FORBIDDEN',
        'The requested Agency is outside the active context.',
        403,
      );
  }
}
