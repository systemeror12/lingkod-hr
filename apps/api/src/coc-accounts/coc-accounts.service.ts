import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  allocateCocAward,
  COC_DAY_CLASSIFICATIONS,
  COC_EARNING_RULE_CODE,
  cocValidUntil,
  earnCoc,
  formatCocMinutes,
  inWorkDateOrder,
  type CocAwardLineCoc,
  type CocEarningRefusalCode,
} from './coc-earning-rule';
import {
  COC_CERTIFICATE_SOURCE_TYPE,
  CocServiceError,
  fromCocDate,
  toCocDate,
  type CocAwardInput,
  type CocAwardResult,
  type CocBalance,
} from './coc-accounts.types';

type Transaction = Prisma.TransactionClient;

const tenths = (minutes: Prisma.Decimal | null | undefined) =>
  minutes ? minutes.mul(10).toNumber() : 0;

/**
 * The COC module's commands for other modules. Each runs inside the caller's
 * transaction, so a Certificate of COC Earned approval and its award commit or
 * roll back together (ADR 0008). No HTTP route reaches them.
 */
@Injectable()
export class CocAccountsService {
  /**
   * Award a Certificate of COC Earned on approval, keyed by the certificate.
   * Applies the earning rule, the monthly and balance caps in Work Date order,
   * and the certificate's Valid Until. Opens the Employee's account if none is
   * active and locks it, then writes one entry per credited line. A repeat for
   * the same certificate returns its existing entries and writes nothing.
   */
  async awardEarnedCocInTransaction(
    transaction: Transaction,
    agencyId: string,
    input: CocAwardInput,
  ): Promise<CocAwardResult> {
    const { lineCoc, validUntil } = this.validateAward(input);

    const employee = await transaction.employee.findFirst({
      where: { agencyId, id: input.employeeId },
      select: { id: true },
    });
    if (!employee) {
      throw new CocServiceError(
        'The Employee does not belong to this Agency.',
        404,
        'COC_EMPLOYEE_NOT_FOUND',
      );
    }

    const earlier = await this.replay(transaction, agencyId, input, lineCoc, validUntil);
    if (earlier) return earlier;

    const cocAccountId = await this.openAndLockAccount(transaction, agencyId, input);
    // A concurrent award of the same certificate may have committed while this one waited.
    const concurrent = await this.replay(transaction, agencyId, input, lineCoc, validUntil);
    if (concurrent) return concurrent;

    // Read under the account lock, so concurrent certificates for the month serialize.
    const monthCredited = await transaction.cocLedgerEntry.aggregate({
      where: {
        agencyId,
        earnedMonth: toCocDate(input.earnedMonth, 'Earned month'),
        cocAccount: { employeeId: input.employeeId },
      },
      _sum: { minutes: true },
    });
    const balance = await transaction.cocLedgerEntry.aggregate({
      where: {
        agencyId,
        cocAccountId,
        effectiveDate: { lte: toCocDate(input.approvalDate, 'Approval date') },
      },
      _sum: { minutes: true },
    });
    const allocations = allocateCocAward(
      lineCoc,
      tenths(monthCredited._sum.minutes),
      tenths(balance._sum.minutes),
    );

    const lines = [];
    for (const allocation of allocations) {
      const entry =
        allocation.creditedTenths > 0
          ? await transaction.cocLedgerEntry.create({
              data: {
                agencyId,
                cocAccountId,
                minutes: new Prisma.Decimal(formatCocMinutes(allocation.creditedTenths)),
                effectiveDate: toCocDate(input.approvalDate, 'Approval date'),
                validUntil: toCocDate(validUntil, 'Valid Until'),
                earnedMonth: toCocDate(input.earnedMonth, 'Earned month'),
                sourceType: COC_CERTIFICATE_SOURCE_TYPE,
                sourceId: input.certificateId,
                sourcePostingKey: allocation.certificateLineId,
                ruleCode: COC_EARNING_RULE_CODE,
                postedByMembershipId: input.approvedByMembershipId,
              },
              select: { id: true },
            })
          : null;
      lines.push({
        certificateLineId: allocation.certificateLineId,
        workDate: allocation.workDate,
        cocMinutes: formatCocMinutes(allocation.cocTenths),
        creditedMinutes: formatCocMinutes(allocation.creditedTenths),
        excessMinutes: formatCocMinutes(allocation.excessTenths),
        ledgerEntryId: entry?.id ?? null,
      });
    }
    return { cocAccountId, validUntil, replayed: false, lines };
  }

  /**
   * The Employee's active-account balance as of a date: entries effective on
   * or before it, grouped by Valid Until. It never reads a stored balance.
   */
  async readBalanceInTransaction(
    transaction: Transaction,
    agencyId: string,
    employeeId: string,
    asOf: string,
  ): Promise<CocBalance> {
    const cutoff = toCocDate(asOf, 'Balance date');
    const account = await transaction.cocAccount.findFirst({
      where: { agencyId, employeeId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!account) return { cocAccountId: null, asOf, byValidUntil: [], totalMinutes: '0.0' };

    const groups = await transaction.cocLedgerEntry.groupBy({
      by: ['validUntil'],
      where: { agencyId, cocAccountId: account.id, effectiveDate: { lte: cutoff } },
      _sum: { minutes: true },
      orderBy: { validUntil: 'asc' },
    });
    const byValidUntil = groups.map((group) => ({
      validUntil: fromCocDate(group.validUntil),
      tenths: tenths(group._sum.minutes),
    }));
    return {
      cocAccountId: account.id,
      asOf,
      byValidUntil: byValidUntil.map((group) => ({
        validUntil: group.validUntil,
        minutes: formatCocMinutes(group.tenths),
      })),
      totalMinutes: formatCocMinutes(byValidUntil.reduce((sum, group) => sum + group.tenths, 0)),
    };
  }

  /** Refuse a malformed award, a passed Valid Until, or service during a suspension. */
  private validateAward(input: CocAwardInput): { lineCoc: CocAwardLineCoc[]; validUntil: string } {
    const invalid = (message: string) => new CocServiceError(message, 400, 'COC_AWARD_INVALID');
    const earnedMonth = toCocDate(input.earnedMonth, 'Earned month');
    if (earnedMonth.getUTCDate() !== 1) throw invalid('The earned month must be its first day.');
    toCocDate(input.approvalDate, 'Approval date');
    if (input.lines.length === 0) throw invalid('A certificate needs at least one line.');
    if (new Set(input.lines.map((line) => line.certificateLineId)).size !== input.lines.length) {
      throw invalid('Each certificate line is awarded once.');
    }

    const validUntil = cocValidUntil(input.earnedMonth);
    if (input.approvalDate > validUntil) {
      throw new CocServiceError(
        `The certificate's COC was valid only until ${validUntil}.`,
        409,
        'COC_VALIDITY_PASSED',
      );
    }

    const month = input.earnedMonth.slice(0, 7);
    const lineCoc: CocAwardLineCoc[] = [];
    const refused: { lineId: string; code: CocEarningRefusalCode }[] = [];
    for (const line of input.lines) {
      toCocDate(line.workDate, 'Work Date');
      if (line.workDate.slice(0, 7) !== month) {
        throw invalid(`Work Date ${line.workDate} is outside the earned month.`);
      }
      if (!Number.isInteger(line.certifiedMinutes) || line.certifiedMinutes <= 0) {
        throw invalid('Certified minutes must be a positive whole number.');
      }
      if (!COC_DAY_CLASSIFICATIONS.includes(line.dayClassification)) {
        throw invalid(`Day classification ${String(line.dayClassification)} is not recognized.`);
      }
      const earning = earnCoc(line.certifiedMinutes, line.dayClassification);
      if (!earning.earns) {
        refused.push({ lineId: line.certificateLineId, code: earning.code });
        continue;
      }
      lineCoc.push({
        certificateLineId: line.certificateLineId,
        workDate: line.workDate,
        cocTenths: earning.cocTenths,
      });
    }
    if (refused[0]) {
      throw new CocServiceError(
        'Service during a work suspension earns no COC.',
        409,
        refused[0].code,
        refused.map((refusal) => refusal.lineId),
      );
    }
    return { lineCoc, validUntil };
  }

  /** Open the Employee's account if none is active, then lock it for this transaction. */
  private async openAndLockAccount(
    transaction: Transaction,
    agencyId: string,
    input: CocAwardInput,
  ): Promise<string> {
    await transaction.$executeRaw`
      INSERT INTO "coc_accounts" ("agency_id", "employee_id", "status", "opened_at")
      VALUES (
        CAST(${agencyId} AS uuid),
        CAST(${input.employeeId} AS uuid),
        'ACTIVE',
        CAST(${input.approvalDate} AS date)
      )
      ON CONFLICT ("agency_id", "employee_id") WHERE "status" = 'ACTIVE' DO NOTHING
    `;
    const [account] = await transaction.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "coc_accounts"
      WHERE "agency_id" = CAST(${agencyId} AS uuid)
        AND "employee_id" = CAST(${input.employeeId} AS uuid)
        AND "status" = 'ACTIVE'
      FOR UPDATE
    `;
    if (!account) throw new Error('The COC Account could not be opened.');
    return account.id;
  }

  /** The certificate's existing award, if any, rebuilt from its entries. */
  private async replay(
    transaction: Transaction,
    agencyId: string,
    input: CocAwardInput,
    lineCoc: readonly CocAwardLineCoc[],
    validUntil: string,
  ): Promise<CocAwardResult | null> {
    const entries = await transaction.cocLedgerEntry.findMany({
      where: { agencyId, sourceType: COC_CERTIFICATE_SOURCE_TYPE, sourceId: input.certificateId },
      select: { id: true, cocAccountId: true, sourcePostingKey: true, minutes: true },
    });
    const first = entries[0];
    if (!first) return null;

    const byLine = new Map(entries.map((entry) => [entry.sourcePostingKey, entry]));
    const coc = new Map(lineCoc.map((line) => [line.certificateLineId, line]));
    const mismatch = entries.some((entry) => {
      const line = coc.get(entry.sourcePostingKey);
      return !line || tenths(entry.minutes) > line.cocTenths;
    });
    if (mismatch) {
      throw new CocServiceError(
        'This certificate was already awarded for different lines.',
        409,
        'COC_AWARD_REPLAY_MISMATCH',
      );
    }

    const lines = inWorkDateOrder(lineCoc).map((line) => {
      const entry = byLine.get(line.certificateLineId);
      const credited = tenths(entry?.minutes);
      return {
        certificateLineId: line.certificateLineId,
        workDate: line.workDate,
        cocMinutes: formatCocMinutes(line.cocTenths),
        creditedMinutes: formatCocMinutes(credited),
        excessMinutes: formatCocMinutes(line.cocTenths - credited),
        ledgerEntryId: entry?.id ?? null,
      };
    });
    return { cocAccountId: first.cocAccountId, validUntil, replayed: true, lines };
  }
}
