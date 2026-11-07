import { Inject, Injectable } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { manilaToday, resolveEmployeeScope, scopeCovers } from '../employee-scope';
import { CocAccountsService } from './coc-accounts.service';
import { CocServiceError, type CocBalance } from './coc-accounts.types';

const READ = 'overtime.coc.read';

/** Read an Employee's COC balance, derived from the ledger as of today in Asia/Manila. */
@Injectable()
export class CocBalancesService {
  constructor(@Inject(CocAccountsService) private readonly cocAccounts: CocAccountsService) {}

  /**
   * The scope check comes first, so a scoped caller learns nothing about an
   * Employee beyond their reach. An Employee with no active account has a zero
   * balance and a `null` account, and reading it opens nothing.
   */
  async read(context: RequestContext, employeeId: string): Promise<CocBalance> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const scope = await resolveEmployeeScope(context, READ, transaction);
      if (!scope || !scopeCovers(scope, employeeId)) {
        throw new CocServiceError(
          'The Employee is outside the scope of the current Agency Membership.',
          403,
          'COC_BALANCE_FORBIDDEN',
        );
      }
      const employee = await transaction.employee.findFirst({
        where: { agencyId: context.agencyId, id: employeeId },
        select: { id: true },
      });
      if (!employee) {
        throw new CocServiceError(
          'The Employee could not be found in this Agency.',
          404,
          'COC_EMPLOYEE_NOT_FOUND',
        );
      }
      return this.cocAccounts.readBalanceInTransaction(
        transaction,
        context.agencyId,
        employeeId,
        manilaToday(),
      );
    });
  }
}
