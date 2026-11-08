import { Inject, Injectable } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { manilaToday, resolveEmployeeScope, scopeCovers } from '../employee-scope';
import { CocAccountsService } from './coc-accounts.service';
import { CocServiceError, type CocBalanceRead, type CocOwnBalanceRead } from './coc-accounts.types';
import { formatCocMinutes } from './coc-earning-rule';

const READ = 'overtime.coc.read';

/**
 * Read an Employee's COC balance, derived from the ledger as of today in Asia/Manila,
 * and the COC available to CTO from today, net of future-dated uses.
 */
@Injectable()
export class CocBalancesService {
  constructor(@Inject(CocAccountsService) private readonly cocAccounts: CocAccountsService) {}

  /**
   * The scope check comes first, so a scoped caller learns nothing about an
   * Employee beyond their reach. An Employee with no active account has a zero
   * balance and a `null` account, and reading it opens nothing.
   */
  /**
   * Read the balance of the Employee the caller's Membership is linked to, under the
   * same scope check, so an Employee can see their COC before they name themselves.
   */
  async readOwn(context: RequestContext): Promise<CocOwnBalanceRead> {
    const membership = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      transaction.agencyMembership.findFirst({
        where: { agencyId: context.agencyId, id: context.membershipId },
        select: { employeeId: true },
      }),
    );
    if (!membership?.employeeId) {
      throw new CocServiceError(
        'The current Agency Membership is not linked to an Employee.',
        404,
        'COC_EMPLOYEE_NOT_LINKED',
      );
    }
    return {
      employeeId: membership.employeeId,
      ...(await this.read(context, membership.employeeId)),
    };
  }

  async read(context: RequestContext, employeeId: string): Promise<CocBalanceRead> {
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
      const today = manilaToday();
      const balance = await this.cocAccounts.readBalanceInTransaction(
        transaction,
        context.agencyId,
        employeeId,
        today,
      );
      const available = balance.cocAccountId
        ? await this.cocAccounts.readAvailableInTransaction(
            transaction,
            context.agencyId,
            balance.cocAccountId,
            today,
          )
        : [];
      const held = available.filter((group) => group.tenths > 0);
      return {
        ...balance,
        available: {
          byValidUntil: held.map((group) => ({
            validUntil: group.validUntil,
            minutes: formatCocMinutes(group.tenths),
          })),
          totalMinutes: formatCocMinutes(held.reduce((sum, group) => sum + group.tenths, 0)),
        },
      };
    });
  }
}
