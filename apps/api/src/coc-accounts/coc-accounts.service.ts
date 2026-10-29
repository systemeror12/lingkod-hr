import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  creditCertificateLines,
  COC_DAY_CLASSIFICATIONS,
  COC_EARNING_RULE_CODE,
  cocValidUntil,
  earnCoc,
  formatCocMinutes,
  type CertificateLineCoc,
  type CocEarningRefusalCode,
} from './coc-earning-rule';
import {
  COC_CERTIFICATE_SOURCE_TYPE,
  CocServiceError,
  fromCocDate,
  toCocDate,
  type CocEarnedCertificate,
  type CocEarnedCertificateCredit,
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
   * active and locks it, then writes one entry per credited line.
   *
   * Under the lock, a certificate that already has entries writes nothing and
   * returns those stored entries. The repeat is refused only when the entries
   * belong to another Employee or name a line the input lacks; it does not
   * check certified minutes, day classifications, earned month, or added
   * lines. A certificate whose lines all credited zero leaves no entries, so
   * a repeat of it awards afresh. The certificate's FOR_APPROVAL to APPROVED
   * transition in the Overtime module (#538) is what guarantees one award.
   */
  async awardEarnedCocInTransaction(
    transaction: Transaction,
    agencyId: string,
    input: CocEarnedCertificate,
  ): Promise<CocEarnedCertificateCredit> {
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

    const cocAccountId = await this.openAndLockAccount(transaction, agencyId, input);
    // Checked after the insert, so a close committed before it is seen and
    // the refusal rolls back the account the insert just opened.
    await this.refuseServiceInClosedAccount(transaction, agencyId, input);
    // Read under the lock, so a concurrent award of the same certificate is seen.
    const earlier = await this.replay(transaction, agencyId, input);
    if (earlier) return earlier;

    // An earlier-dated award would raise the balance under a later award's cap.
    const approvalDate = toCocDate(input.approvalDate, 'Approval date');
    const latest = await transaction.cocLedgerEntry.aggregate({
      where: { agencyId, cocAccountId, earnedMonth: { not: null } },
      _max: { effectiveDate: true },
    });
    if (latest._max.effectiveDate && approvalDate < latest._max.effectiveDate) {
      throw new CocServiceError(
        `The account already has a certificate approved on ${fromCocDate(latest._max.effectiveDate)}.`,
        409,
        'COC_APPROVAL_BEFORE_LATEST_CERTIFICATE',
      );
    }

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
        effectiveDate: { lte: approvalDate },
        validUntil: { gte: approvalDate },
      },
      _sum: { minutes: true },
    });
    const allocations = creditCertificateLines(
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
                effectiveDate: approvalDate,
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
   * or before it whose Valid Until is on or after it, grouped by Valid Until.
   * It never reads a stored balance.
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
      where: {
        agencyId,
        cocAccountId: account.id,
        effectiveDate: { lte: cutoff },
        validUntil: { gte: cutoff },
      },
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
  private validateAward(input: CocEarnedCertificate): {
    lineCoc: CertificateLineCoc[];
    validUntil: string;
  } {
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
    const lineCoc: CertificateLineCoc[] = [];
    const refused: { certificateLineId: string; code: CocEarningRefusalCode }[] = [];
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
        refused.push({ certificateLineId: line.certificateLineId, code: earning.code });
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
        refused,
      );
    }
    return { lineCoc, validUntil };
  }

  /**
   * Service on or before a closed account's close date belongs to the
   * forfeited period, so it cannot open a new account.
   */
  private async refuseServiceInClosedAccount(
    transaction: Transaction,
    agencyId: string,
    input: CocEarnedCertificate,
  ): Promise<void> {
    const earliestWorkDate = input.lines
      .map((line) => line.workDate)
      .reduce((earliest, workDate) => (workDate < earliest ? workDate : earliest));
    const closed = await transaction.cocAccount.findFirst({
      where: {
        agencyId,
        employeeId: input.employeeId,
        status: 'CLOSED',
        closedAt: { gte: toCocDate(earliestWorkDate, 'Work Date') },
      },
      select: { closedAt: true },
    });
    if (closed?.closedAt) {
      throw new CocServiceError(
        `The Employee's COC Account closed on ${fromCocDate(closed.closedAt)}, on or after this service.`,
        409,
        'COC_SERVICE_IN_CLOSED_ACCOUNT',
      );
    }
  }

  /**
   * Open the Employee's account if none is active, then lock it so
   * balance-sensitive commands recompute under one writer. NO KEY leaves
   * foreign-key checks against the account free to proceed, as Leave does.
   */
  private async openAndLockAccount(
    transaction: Transaction,
    agencyId: string,
    input: CocEarnedCertificate,
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
      FOR NO KEY UPDATE
    `;
    if (!account) throw new Error('The COC Account could not be opened.');
    return account.id;
  }

  /**
   * The certificate's stored entries, if any. Refused when they belong to
   * another Employee or name a line the input lacks; otherwise returned as
   * stored, without recomputing what the input would earn.
   */
  private async replay(
    transaction: Transaction,
    agencyId: string,
    input: CocEarnedCertificate,
  ): Promise<CocEarnedCertificateCredit | null> {
    const entries = await transaction.cocLedgerEntry.findMany({
      where: { agencyId, sourceType: COC_CERTIFICATE_SOURCE_TYPE, sourceId: input.certificateId },
      select: {
        id: true,
        cocAccountId: true,
        sourcePostingKey: true,
        minutes: true,
        validUntil: true,
        cocAccount: { select: { employeeId: true } },
      },
      orderBy: { sourcePostingKey: 'asc' },
    });
    const first = entries[0];
    if (!first) return null;
    if (entries.some((entry) => entry.cocAccount.employeeId !== input.employeeId)) {
      throw new CocServiceError(
        'This certificate was already awarded to another Employee.',
        409,
        'COC_CERTIFICATE_OF_ANOTHER_EMPLOYEE',
      );
    }
    const inputLineIds = new Set(input.lines.map((line) => line.certificateLineId));
    if (entries.some((entry) => !inputLineIds.has(entry.sourcePostingKey))) {
      throw new CocServiceError(
        'This certificate was already awarded with a line the input lacks.',
        409,
        'COC_AWARD_REPLAY_MISMATCH',
      );
    }
    return {
      replayed: true,
      cocAccountId: first.cocAccountId,
      validUntil: fromCocDate(first.validUntil),
      entries: entries.map((entry) => ({
        certificateLineId: entry.sourcePostingKey,
        creditedMinutes: formatCocMinutes(tenths(entry.minutes)),
        ledgerEntryId: entry.id,
      })),
    };
  }
}
