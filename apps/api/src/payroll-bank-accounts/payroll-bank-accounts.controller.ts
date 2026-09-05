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
  PayrollBankAccountDto,
  PayrollBankAccountHistoryDto,
  PayrollBankAccountListDto,
  PayrollBankAccountRevealDto,
} from './payroll-bank-accounts.dto';
import {
  payrollBankAccountActivateSchema,
  payrollBankAccountCorrectSchema,
  payrollBankAccountCreateSchema,
  payrollBankAccountIdSchema,
  payrollBankAccountInactivateSchema,
  payrollBankAccountReplaceSchema,
  payrollBankAccountRevealSchema,
} from './payroll-bank-accounts.schemas';
import {
  PayrollBankAccountsService,
  PayrollBankAccountsServiceError,
} from './payroll-bank-accounts.service';

function validationFields(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path.map(String).join('.') || 'form';
    if (fields[field] === undefined) fields[field] = issue.message;
  }
  return fields;
}

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof PayrollBankAccountsServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard)
export class PayrollBankAccountsController {
  constructor(
    @Inject(PayrollBankAccountsService)
    private readonly service: PayrollBankAccountsService,
  ) {}

  @Get(':agencyId/employees/:employeeId/payroll-bank-accounts')
  @UseGuards(PermissionGuard)
  @RequirePermission('payroll.bank_accounts.read')
  async list(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<PayrollBankAccountListDto> {
    const id = this.employeeId(agencyId, employeeId, context);
    try {
      const accounts = await this.service.list(context, id);
      if (!accounts) throw this.notFound(context);
      return new PayrollBankAccountListDto(accounts);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/employees/:employeeId/payroll-bank-accounts')
  @UseGuards(PermissionGuard)
  @RequirePermission('payroll.bank_accounts.manage')
  async create(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PayrollBankAccountDto> {
    const id = this.employeeId(agencyId, employeeId, context);
    const input = payrollBankAccountCreateSchema.safeParse(body);
    if (!input.success) throw this.invalidInput(input.error.issues, context);
    try {
      return new PayrollBankAccountDto(await this.service.create(context, id, input.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/employees/:employeeId/payroll-bank-accounts/history')
  @UseGuards(PermissionGuard)
  @RequirePermission('payroll.bank_accounts.history.read')
  async history(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Query('accountId') accountId: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<PayrollBankAccountHistoryDto> {
    const id = this.employeeId(agencyId, employeeId, context);
    const parsedAccountId = accountId ? payrollBankAccountIdSchema.safeParse(accountId) : undefined;
    if (parsedAccountId && !parsedAccountId.success) throw this.notFound(context);
    try {
      const history = await this.service.history(context, id, parsedAccountId?.data);
      if (!history) throw this.notFound(context);
      return new PayrollBankAccountHistoryDto(history);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/employees/:employeeId/payroll-bank-accounts/:accountId/replace')
  @UseGuards(PermissionGuard)
  @RequirePermission('payroll.bank_accounts.manage')
  async replace(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PayrollBankAccountDto> {
    return this.mutate(
      agencyId,
      employeeId,
      accountId,
      body,
      context,
      payrollBankAccountReplaceSchema,
      'replace',
    );
  }

  @Post(':agencyId/employees/:employeeId/payroll-bank-accounts/:accountId/activate')
  @UseGuards(PermissionGuard)
  @RequirePermission('payroll.bank_accounts.manage')
  async activate(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PayrollBankAccountDto> {
    return this.mutate(
      agencyId,
      employeeId,
      accountId,
      body,
      context,
      payrollBankAccountActivateSchema,
      'activate',
    );
  }

  @Patch(':agencyId/employees/:employeeId/payroll-bank-accounts/:accountId/inactivate')
  @UseGuards(PermissionGuard)
  @RequirePermission('payroll.bank_accounts.manage')
  async inactivate(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PayrollBankAccountDto> {
    return this.mutate(
      agencyId,
      employeeId,
      accountId,
      body,
      context,
      payrollBankAccountInactivateSchema,
      'inactivate',
    );
  }

  @Post(':agencyId/employees/:employeeId/payroll-bank-accounts/:accountId/correct')
  @UseGuards(PermissionGuard)
  @RequirePermission('payroll.bank_accounts.manage')
  async correct(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PayrollBankAccountDto> {
    return this.mutate(
      agencyId,
      employeeId,
      accountId,
      body,
      context,
      payrollBankAccountCorrectSchema,
      'correct',
    );
  }

  @Post(':agencyId/employees/:employeeId/payroll-bank-accounts/:accountId/reveal')
  async reveal(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PayrollBankAccountRevealDto> {
    const ids = this.ids(agencyId, employeeId, accountId, context);
    const input = payrollBankAccountRevealSchema.safeParse(body ?? {});
    if (!input.success) throw this.invalidInput(input.error.issues, context);
    try {
      return new PayrollBankAccountRevealDto(
        await this.service.reveal(context, ids.employeeId, ids.accountId, input.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private async mutate<T>(
    agencyId: string,
    employeeId: string,
    accountId: string,
    body: unknown,
    context: RequestContext,
    schema: {
      safeParse(
        value: unknown,
      ):
        | { success: true; data: T }
        | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
    },
    operation: 'replace' | 'activate' | 'inactivate' | 'correct',
  ): Promise<PayrollBankAccountDto> {
    const ids = this.ids(agencyId, employeeId, accountId, context);
    const input = schema.safeParse(body);
    if (!input.success) throw this.invalidInput(input.error.issues, context);
    try {
      const value = await this.service[operation](
        context,
        ids.employeeId,
        ids.accountId,
        input.data as never,
      );
      return new PayrollBankAccountDto(value);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private employeeId(agencyId: string, employeeId: string, context: RequestContext): string {
    this.assertAgency(agencyId, context);
    const parsed = employeeIdSchema.safeParse(employeeId);
    if (!parsed.success) throw this.notFound(context);
    return parsed.data;
  }

  private ids(
    agencyId: string,
    employeeId: string,
    accountId: string,
    context: RequestContext,
  ): { employeeId: string; accountId: string } {
    const parsedEmployeeId = this.employeeId(agencyId, employeeId, context);
    const parsedAccountId = payrollBankAccountIdSchema.safeParse(accountId);
    if (!parsedAccountId.success) throw this.notFound(context);
    return { employeeId: parsedEmployeeId, accountId: parsedAccountId.data };
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
        message: 'Enter valid payroll bank account details and an exact evidence reference.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'PAYROLL_BANK_ACCOUNT_NOT_FOUND',
          message: 'The payroll bank account could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
