import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { manilaToday } from '../attendance-configuration/attendance-configuration.types';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import { CocAccountsService } from './coc-accounts.service';
import {
  COC_ADJUSTMENT_SOURCE_TYPE,
  COC_CORRECTION_RULE_CODE,
  COC_EXPIRY_SOURCE_TYPE,
  COC_REVERSAL_SOURCE_TYPE,
  CocServiceError,
  fromCocDate,
  toCocDate,
  type CocAdjustmentInput,
  type CocCorrectionEntry,
  type CocReversalInput,
  type CocReversalResult,
} from './coc-accounts.types';

type Transaction = Prisma.TransactionClient;

/**
 * The only sources an authorized user may reverse. It is an allow-list so a
 * negative source added later, such as CTO usage (which returns through CTO
 * cancellation) or a Separation Case forfeiture, is refused until it is decided.
 */
const REVERSIBLE_SOURCE_TYPES = [COC_ADJUSTMENT_SOURCE_TYPE, COC_EXPIRY_SOURCE_TYPE];

const entrySelect = {
  id: true,
  cocAccountId: true,
  minutes: true,
  effectiveDate: true,
  validUntil: true,
  sourceType: true,
} satisfies Prisma.CocLedgerEntrySelect;

type EntryRecord = Prisma.CocLedgerEntryGetPayload<{ select: typeof entrySelect }>;

const toEntry = (entry: EntryRecord): CocCorrectionEntry => ({
  id: entry.id,
  cocAccountId: entry.cocAccountId,
  minutes: entry.minutes.toFixed(1),
  effectiveDate: fromCocDate(entry.effectiveDate),
  validUntil: fromCocDate(entry.validUntil),
});

/**
 * An authorized user's corrections to the COC ledger (hris-controls §5.18).
 * Nothing is edited and neither command creates credit outside a certificate:
 * an adjustment draws COC down, and a reversal only restores what a negative
 * entry removed. Each locks the account, so concurrent commands serialize.
 */
@Injectable()
export class CocLedgerCorrectionsService {
  constructor(
    @Inject(CocAccountsService) private readonly accounts: CocAccountsService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
  ) {}

  /**
   * Post one negative entry effective today against one Valid Until: the chosen
   * one, or the earliest-expiring still valid with COC remaining. An
   * `Idempotency-Key` retry returns the stored entry, since a repeat would draw
   * the COC down twice.
   */
  async adjust(
    context: RequestContext,
    cocAccountId: string,
    input: CocAdjustmentInput,
    idempotencyKey?: string,
  ): Promise<CocCorrectionEntry> {
    this.assertPermission(context, 'overtime.coc.adjust');
    const today = manilaToday();
    const fingerprint = JSON.stringify([
      cocAccountId,
      input.minutes,
      input.validUntil ?? null,
      input.reason,
      input.supportingDocumentVersionId,
    ]);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const account = await this.lockAccount(transaction, context, cocAccountId);
      // Replay first: the entry already posted, whatever has happened to the account since.
      if (idempotencyKey) {
        const earlier = await this.completedAdjustment(
          transaction,
          context,
          idempotencyKey,
          fingerprint,
        );
        if (earlier) return earlier;
      }
      await this.refuseCorrection(transaction, context, account);
      await this.assertEvidenceLinkable(transaction, context, input.supportingDocumentVersionId);

      const minutes = new Prisma.Decimal(input.minutes);
      const validUntil = await this.drawFrom(
        transaction,
        context.agencyId,
        cocAccountId,
        input.validUntil,
        today,
      );
      // Every entry counts, including future-dated uses, so COC they already
      // claim cannot be adjusted away.
      const available = await transaction.cocLedgerEntry.aggregate({
        where: { agencyId: context.agencyId, cocAccountId, validUntil },
        _sum: { minutes: true },
      });
      if ((available._sum.minutes ?? new Prisma.Decimal(0)).add(minutes).isNegative()) {
        throw new CocServiceError(
          `The adjustment exceeds the COC remaining for Valid Until ${fromCocDate(validUntil)}.`,
          409,
          'COC_INSUFFICIENT_BALANCE',
        );
      }

      // An adjustment has no table of its own, so its entry is its source.
      const entryId = randomUUID();
      const entry = await transaction.cocLedgerEntry.create({
        data: {
          id: entryId,
          agencyId: context.agencyId,
          cocAccountId,
          minutes,
          effectiveDate: toCocDate(today, 'Adjustment date'),
          validUntil,
          sourceType: COC_ADJUSTMENT_SOURCE_TYPE,
          sourceId: entryId,
          sourcePostingKey: 'ADJUSTMENT',
          ruleCode: COC_CORRECTION_RULE_CODE,
          reason: input.reason,
          supportingDocumentVersionId: input.supportingDocumentVersionId,
          postedByMembershipId: context.membershipId,
        },
        select: entrySelect,
      });
      await this.audit(transaction, context, {
        action: 'COC_ADJUSTED',
        entry,
        reason: input.reason,
        supportingDocumentVersionId: input.supportingDocumentVersionId,
        idempotencyKey,
        fingerprint,
      });
      return toEntry(entry);
    });
  }

  /**
   * Exactly negate one negative entry, effective on its date and restoring its
   * Valid Until. When that Valid Until has passed, the restored COC expires again
   * in this transaction. A retry is refused as already reversed, so it needs no
   * idempotency key.
   */
  async reverse(
    context: RequestContext,
    cocAccountId: string,
    entryId: string,
    input: CocReversalInput,
  ): Promise<CocReversalResult> {
    this.assertPermission(context, 'overtime.coc.reverse');
    const today = manilaToday();
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const account = await this.lockAccount(transaction, context, cocAccountId);
      const original = await transaction.cocLedgerEntry.findFirst({
        where: { agencyId: context.agencyId, cocAccountId, id: entryId },
        select: entrySelect,
      });
      if (!original) {
        throw new CocServiceError(
          'The COC Ledger Entry could not be found.',
          404,
          'COC_ENTRY_NOT_FOUND',
        );
      }
      // Already reversed first: a retry stays one, whatever has happened to the account since.
      const existing = await transaction.cocLedgerEntry.findFirst({
        where: { agencyId: context.agencyId, reversesEntryId: original.id },
        select: { id: true },
      });
      if (existing) {
        throw new CocServiceError(
          'This COC Ledger Entry was already reversed.',
          409,
          'COC_ENTRY_ALREADY_REVERSED',
        );
      }
      await this.refuseCorrection(transaction, context, account);
      if (!original.minutes.isNegative()) {
        throw new CocServiceError(
          'Only a negative COC Ledger Entry can be reversed.',
          409,
          'COC_REVERSAL_NOT_NEGATIVE',
        );
      }
      if (!REVERSIBLE_SOURCE_TYPES.includes(original.sourceType)) {
        throw new CocServiceError(
          'Only a COC adjustment or expiry can be reversed; CTO usage returns through CTO cancellation.',
          409,
          'COC_REVERSAL_SOURCE_NOT_ALLOWED',
        );
      }
      await this.assertEvidenceLinkable(transaction, context, input.supportingDocumentVersionId);

      const reversal = await transaction.cocLedgerEntry.create({
        data: {
          agencyId: context.agencyId,
          cocAccountId,
          minutes: original.minutes.negated(),
          effectiveDate: original.effectiveDate,
          validUntil: original.validUntil,
          sourceType: COC_REVERSAL_SOURCE_TYPE,
          sourceId: original.id,
          sourcePostingKey: original.id,
          ruleCode: COC_CORRECTION_RULE_CODE,
          reason: input.reason,
          supportingDocumentVersionId: input.supportingDocumentVersionId,
          reversesEntryId: original.id,
          postedByMembershipId: context.membershipId,
        },
        select: entrySelect,
      });
      await this.audit(transaction, context, {
        action: 'COC_REVERSED',
        entry: reversal,
        reason: input.reason,
        supportingDocumentVersionId: input.supportingDocumentVersionId,
        reversesEntryId: original.id,
      });
      const expiryEntryId = await this.accounts.expireCocInTransaction(
        transaction,
        context.agencyId,
        { cocAccountId, validUntil: fromCocDate(original.validUntil), asOf: today },
      );
      return { entry: toEntry(reversal), expiryEntryId };
    });
  }

  private assertPermission(context: RequestContext, permission: string): void {
    if (!hasPermission(context, permission, { agencyId: context.agencyId })) {
      throw new CocServiceError(
        `The ${permission} permission is required.`,
        403,
        'COC_CORRECTION_FORBIDDEN',
      );
    }
  }

  /** Lock the account, so concurrent commands recompute under one writer. */
  private async lockAccount(
    transaction: Transaction,
    context: RequestContext,
    cocAccountId: string,
  ): Promise<{ employee_id: string; status: string }> {
    const [account] = await transaction.$queryRaw<{ employee_id: string; status: string }[]>`
      SELECT "employee_id", "status" FROM "coc_accounts"
      WHERE "agency_id" = CAST(${context.agencyId} AS uuid)
        AND "id" = CAST(${cocAccountId} AS uuid)
      FOR NO KEY UPDATE
    `;
    if (!account) {
      throw new CocServiceError(
        'The COC Account could not be found.',
        404,
        'COC_ACCOUNT_NOT_FOUND',
      );
    }
    return account;
  }

  /**
   * Refuse a correction by the account's own Employee or to a closed account. A
   * closed account is final, and restoring COC to it would leave credit no one
   * can use, so an erroneous forfeiture is not corrected here.
   */
  private async refuseCorrection(
    transaction: Transaction,
    context: RequestContext,
    account: { employee_id: string; status: string },
  ): Promise<void> {
    const membership = await transaction.agencyMembership.findFirst({
      where: { agencyId: context.agencyId, id: context.membershipId },
      select: { employeeId: true },
    });
    if (membership?.employeeId === account.employee_id) {
      throw new CocServiceError(
        'Nobody adjusts or reverses entries on their own COC Account.',
        403,
        'COC_OWN_ACCOUNT_FORBIDDEN',
      );
    }
    if (account.status !== 'ACTIVE') {
      throw new CocServiceError('This COC Account is closed.', 409, 'COC_ACCOUNT_CLOSED');
    }
  }

  /** The stored entry of an earlier adjustment under this key, if any. */
  private async completedAdjustment(
    transaction: Transaction,
    context: RequestContext,
    idempotencyKey: string,
    fingerprint: string,
  ): Promise<CocCorrectionEntry | null> {
    const event = await transaction.auditEvent.findFirst({
      where: { agencyId: context.agencyId, action: 'COC_ADJUSTED', idempotencyKey },
      select: { entityId: true, metadata: true },
    });
    if (!event) return null;
    const metadata = event.metadata as Prisma.JsonObject | null;
    if (metadata?.fingerprint !== fingerprint || !event.entityId) {
      throw new CocServiceError(
        'This Idempotency-Key was used for a different COC adjustment.',
        409,
        'COC_IDEMPOTENCY_CONFLICT',
      );
    }
    const entry = await transaction.cocLedgerEntry.findFirstOrThrow({
      where: { agencyId: context.agencyId, id: event.entityId },
      select: entrySelect,
    });
    return toEntry(entry);
  }

  /** The chosen Valid Until, still valid today, or the earliest-expiring with COC remaining. */
  private async drawFrom(
    transaction: Transaction,
    agencyId: string,
    cocAccountId: string,
    chosen: string | undefined,
    today: string,
  ): Promise<Date> {
    if (chosen) {
      if (chosen < today) {
        throw new CocServiceError(
          `The COC was valid only until ${chosen}, so none of it remains to adjust.`,
          409,
          'COC_VALIDITY_PASSED',
        );
      }
      return toCocDate(chosen, 'Valid Until');
    }
    const groups = await transaction.cocLedgerEntry.groupBy({
      by: ['validUntil'],
      where: { agencyId, cocAccountId, validUntil: { gte: toCocDate(today, 'Adjustment date') } },
      _sum: { minutes: true },
      orderBy: { validUntil: 'asc' },
    });
    const earliest = groups.find((group) => group._sum.minutes?.greaterThan(0));
    if (!earliest) {
      throw new CocServiceError(
        'The COC Account has no COC remaining to adjust.',
        409,
        'COC_INSUFFICIENT_BALANCE',
      );
    }
    return earliest.validUntil;
  }

  /**
   * The exact Document Version must be this Agency's, finalized, and readable by
   * the caller, as External Evidence is everywhere else.
   */
  private async assertEvidenceLinkable(
    transaction: Transaction,
    context: RequestContext,
    versionId: string,
  ): Promise<void> {
    if (!hasPermission(context, 'documents.evidence.read', { agencyId: context.agencyId })) {
      throw new CocServiceError(
        'The documents.evidence.read permission is required to link supporting evidence.',
        403,
        'COC_EVIDENCE_FORBIDDEN',
      );
    }
    const version = await transaction.documentVersion.findFirst({
      where: { agencyId: context.agencyId, id: versionId },
      select: { documentId: true },
    });
    const evidence = version
      ? await this.documents.resolveExternalEvidenceInTransaction(transaction, context, {
          documentId: version.documentId,
          versionId,
          allowSensitive: hasPermission(context, 'documents.evidence.read_sensitive', {
            agencyId: context.agencyId,
          }),
          requirement: 'FINALIZED_VERSION',
        })
      : null;
    if (evidence?.ok === false && evidence.reason === 'SENSITIVE_FORBIDDEN') {
      throw new CocServiceError(
        'The documents.evidence.read_sensitive permission is required to link this evidence.',
        403,
        'COC_EVIDENCE_FORBIDDEN',
      );
    }
    if (!evidence?.ok) {
      throw new CocServiceError(
        'The supporting evidence must be a finalized Document Version of this Agency.',
        409,
        'COC_EVIDENCE_INVALID',
      );
    }
  }

  private async audit(
    transaction: Transaction,
    context: RequestContext,
    event: {
      action: 'COC_ADJUSTED' | 'COC_REVERSED';
      entry: EntryRecord;
      reason: string;
      supportingDocumentVersionId: string;
      reversesEntryId?: string;
      idempotencyKey?: string | undefined;
      fingerprint?: string;
    },
  ): Promise<void> {
    const { entry } = event;
    await transaction.auditEvent.create({
      data: {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: event.action,
        entityType: 'CocLedgerEntry',
        entityId: entry.id,
        reason: event.reason,
        requestId: context.requestId,
        ...(event.idempotencyKey ? { idempotencyKey: event.idempotencyKey } : {}),
        metadata: {
          cocAccountId: entry.cocAccountId,
          minutes: entry.minutes.toFixed(1),
          effectiveDate: fromCocDate(entry.effectiveDate),
          validUntil: fromCocDate(entry.validUntil),
          supportingDocumentVersionId: event.supportingDocumentVersionId,
          ...(event.reversesEntryId ? { reversesEntryId: event.reversesEntryId } : {}),
          ...(event.fingerprint ? { fingerprint: event.fingerprint } : {}),
        },
      },
    });
  }
}
