import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { ApprovalServiceError } from '../approvals/approval.service';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import {
  cocEarnedCertificateIdSchema,
  cocEarnedCertificatePrepareSchema,
  cocEarnedCertificateReturnSchema,
} from './coc-earned-certificates.schemas';
import { CocEarnedCertificatesService } from './coc-earned-certificates.service';
import {
  CocEarnedCertificateServiceError,
  type CocEarnedCertificateSummary,
} from './coc-earned-certificates.types';

function validationFields(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && fields[field] === undefined) fields[field] = issue.message;
  }
  return fields;
}

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof CocEarnedCertificateServiceError || error instanceof ApprovalServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class CocEarnedCertificatesController {
  constructor(
    @Inject(CocEarnedCertificatesService)
    private readonly service: CocEarnedCertificatesService,
  ) {}

  @Post(':agencyId/coc-earned-certificates')
  @RequirePermission('overtime.coc_certificates.prepare')
  async prepare(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<CocEarnedCertificateSummary> {
    this.assertAgency(agencyId, context);
    const parsed = cocEarnedCertificatePrepareSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return await this.service.prepare(context, parsed.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/coc-earned-certificates/:certificateId/submit')
  @RequirePermission('overtime.coc_certificates.prepare')
  async submit(
    @Param('agencyId') agencyId: string,
    @Param('certificateId') certificateId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<CocEarnedCertificateSummary> {
    const id = this.certificateId(agencyId, certificateId, context);
    try {
      return await this.service.submit(context, id);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/coc-earned-certificates/:certificateId/return')
  @RequirePermission('overtime.coc_certificates.approve')
  async return(
    @Param('agencyId') agencyId: string,
    @Param('certificateId') certificateId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<CocEarnedCertificateSummary> {
    const id = this.certificateId(agencyId, certificateId, context);
    const parsed = cocEarnedCertificateReturnSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return await this.service.return(context, id, parsed.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/coc-earned-certificates/:certificateId/discard')
  @RequirePermission('overtime.coc_certificates.prepare')
  async discard(
    @Param('agencyId') agencyId: string,
    @Param('certificateId') certificateId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<CocEarnedCertificateSummary> {
    const id = this.certificateId(agencyId, certificateId, context);
    try {
      return await this.service.discard(context, id);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private certificateId(agencyId: string, certificateId: string, context: RequestContext): string {
    this.assertAgency(agencyId, context);
    const parsed = cocEarnedCertificateIdSchema.safeParse(certificateId);
    if (!parsed.success) {
      throw new HttpException(
        {
          error: {
            code: 'COC_EARNED_CERTIFICATE_NOT_FOUND',
            message: 'The Certificate of COC Earned could not be found.',
            requestId: context.requestId,
          },
        },
        404,
      );
    }
    return parsed.data;
  }

  private assertAgency(agencyId: string, context: RequestContext): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success || parsed.data !== context.agencyId) {
      throw new HttpException(
        {
          error: {
            code: 'COC_EARNED_CERTIFICATE_WRITE_FORBIDDEN',
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
        message: 'Enter supported Certificate of COC Earned values.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }
}
