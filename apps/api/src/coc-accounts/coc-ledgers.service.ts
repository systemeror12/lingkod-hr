import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { manilaToday, resolveEmployeeScope, scopeCovers } from '../employee-scope';
import {
  COC_CERTIFICATE_SOURCE_TYPE,
  CocServiceError,
  fromCocDate,
  toCocDate,
  type CocAccountSummary,
  type CocLedger,
} from './coc-accounts.types';

const READ = 'overtime.coc.read';

type Transaction = Prisma.TransactionClient;

const forbidden = () =>
  new CocServiceError(
    'The COC Account is outside the scope of the current Agency Membership.',
    403,
    'COC_BALANCE_FORBIDDEN',
  );

/**
 * Read COC Accounts and their ledgers with `overtime.coc.read` within the
 * reader's scope, so an Employee holding the OWN grant reads only their own.
 * Nothing here writes.
 */
@Injectable()
export class CocLedgersService {
  /**
   * The accounts within scope, by Employee name. An active account carries its
   * balance as of today in Asia/Manila, counted as the balance read counts it;
   * a closed one carries none.
   */
  async list(context: RequestContext): Promise<{ accounts: CocAccountSummary[] }> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const scope = await resolveEmployeeScope(transaction, context, READ);
      if (scope.kind === 'NONE') throw forbidden();
      const accounts = await transaction.cocAccount.findMany({
        where: {
          agencyId: context.agencyId,
          ...(scope.kind === 'SCOPED' ? { employeeId: { in: scope.employeeIds } } : {}),
        },
        select: {
          id: true,
          employeeId: true,
          status: true,
          openedAt: true,
          closedAt: true,
          employee: { select: { legalName: true, employeeNumber: true } },
        },
        orderBy: [{ employee: { legalName: 'asc' } }, { openedAt: 'desc' }],
      });
      const today = toCocDate(manilaToday(), 'Balance date');
      const totals = await transaction.cocLedgerEntry.groupBy({
        by: ['cocAccountId'],
        where: {
          agencyId: context.agencyId,
          cocAccountId: { in: accounts.map((account) => account.id) },
          effectiveDate: { lte: today },
          validUntil: { gte: today },
        },
        _sum: { minutes: true },
      });
      const totalOf = new Map(
        totals.map((row) => [row.cocAccountId, row._sum.minutes?.toFixed(1) ?? '0.0']),
      );
      return {
        accounts: accounts.map((account) => ({
          id: account.id,
          employeeId: account.employeeId,
          employeeName: account.employee.legalName,
          employeeNumber: account.employee.employeeNumber,
          status: account.status,
          openedAt: fromCocDate(account.openedAt),
          closedAt: account.closedAt ? fromCocDate(account.closedAt) : null,
          balanceMinutes: account.status === 'ACTIVE' ? (totalOf.get(account.id) ?? '0.0') : null,
        })),
      };
    });
  }

  /**
   * Every entry of one account, by effective date then posting. Each entry names
   * the entry it reverses and the entry that reversed it, and a certificate
   * entry names the Overtime Authority its certified service came from. A
   * scoped caller cannot tell a missing account from one beyond reach.
   */
  async ledger(context: RequestContext, cocAccountId: string): Promise<CocLedger> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const scope = await resolveEmployeeScope(transaction, context, READ);
      if (scope.kind === 'NONE') throw forbidden();
      const account = await transaction.cocAccount.findFirst({
        where: { agencyId: context.agencyId, id: cocAccountId },
        select: {
          id: true,
          employeeId: true,
          status: true,
          openedAt: true,
          closedAt: true,
          employee: { select: { legalName: true, employeeNumber: true } },
        },
      });
      if (!account || !scopeCovers(scope, account.employeeId)) {
        if (scope.kind === 'SCOPED') throw forbidden();
        throw new CocServiceError(
          'The COC Account could not be found.',
          404,
          'COC_ACCOUNT_NOT_FOUND',
        );
      }
      const entries = await transaction.cocLedgerEntry.findMany({
        where: { agencyId: context.agencyId, cocAccountId },
        orderBy: [{ effectiveDate: 'asc' }, { postedAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          minutes: true,
          effectiveDate: true,
          validUntil: true,
          earnedMonth: true,
          sourceType: true,
          sourceId: true,
          sourcePostingKey: true,
          ruleCode: true,
          reason: true,
          supportingDocumentVersionId: true,
          reversesEntryId: true,
          postedAt: true,
          reversedByEntry: { select: { id: true } },
        },
      });
      const authorities = await this.certificateAuthorities(
        transaction,
        context.agencyId,
        entries
          .filter((entry) => entry.sourceType === COC_CERTIFICATE_SOURCE_TYPE)
          .map((entry) => entry.sourcePostingKey),
      );
      return {
        account: {
          id: account.id,
          employeeId: account.employeeId,
          employeeName: account.employee.legalName,
          employeeNumber: account.employee.employeeNumber,
          status: account.status,
          openedAt: fromCocDate(account.openedAt),
          closedAt: account.closedAt ? fromCocDate(account.closedAt) : null,
        },
        entries: entries.map((entry) => {
          const authority =
            entry.sourceType === COC_CERTIFICATE_SOURCE_TYPE
              ? (authorities.get(entry.sourcePostingKey) ?? null)
              : null;
          return {
            id: entry.id,
            minutes: entry.minutes.toFixed(1),
            effectiveDate: fromCocDate(entry.effectiveDate),
            validUntil: fromCocDate(entry.validUntil),
            earnedMonth: entry.earnedMonth ? fromCocDate(entry.earnedMonth) : null,
            sourceType: entry.sourceType,
            sourceId: entry.sourceId,
            ruleCode: entry.ruleCode,
            reason: entry.reason,
            supportingDocumentVersionId: entry.supportingDocumentVersionId,
            reversesEntryId: entry.reversesEntryId,
            reversedByEntryId: entry.reversedByEntry[0]?.id ?? null,
            postedAt: entry.postedAt.toISOString(),
            overtimeAuthority: authority,
          };
        }),
      };
    });
  }

  /** The Overtime Authority behind each certificate line, by line id. */
  private async certificateAuthorities(
    transaction: Transaction,
    agencyId: string,
    lineIds: string[],
  ): Promise<Map<string, { id: string; authorityNo: string }>> {
    if (lineIds.length === 0) return new Map();
    const lines = await transaction.cocEarnedCertificateLine.findMany({
      where: { agencyId, id: { in: lineIds } },
      select: {
        id: true,
        serviceRecord: {
          select: {
            authorityEmployee: {
              select: { authority: { select: { id: true, authorityNo: true } } },
            },
          },
        },
      },
    });
    return new Map(lines.map((line) => [line.id, line.serviceRecord.authorityEmployee.authority]));
  }
}
