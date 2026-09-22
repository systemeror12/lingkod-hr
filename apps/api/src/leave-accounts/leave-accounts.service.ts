import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import {
  findLeaveCatalogueEntry,
  type LeaveEntitlementBasis,
} from '../leave-policies/leave-catalogue';

/**
 * Only these entitlement bases hold a running credit balance. QUALIFYING_EVENT
 * and NON_CREDIT_AUTHORIZATION leave are authorizations, not accounts.
 */
export const LEAVE_CREDIT_BEARING_BASES = [
  'ACCRUED_ACCOUNT',
  'PERIODIC_ALLOWANCE',
] as const satisfies readonly LeaveEntitlementBasis[];

export function isCreditBearingLeaveType(code: string): boolean {
  const entry = findLeaveCatalogueEntry(code);
  return (
    entry !== null &&
    (LEAVE_CREDIT_BEARING_BASES as readonly string[]).includes(entry.entitlementBasis)
  );
}

export const LEAVE_ACCOUNT_STATUSES = ['ACTIVE', 'FROZEN', 'CLOSED'] as const;
export type LeaveAccountStatus = (typeof LEAVE_ACCOUNT_STATUSES)[number];

export const LEAVE_ACCOUNT_LEDGER_SOURCE_TYPES = {
  OPENING: 'LeaveAccountOpening',
  ADJUSTMENT: 'LeaveLedgerAdjustment',
} as const;

/** The source type Leave posting uses so Attendance can recognize posted leave. */
export const LEAVE_APPLICATION_LEDGER_SOURCE_TYPE = 'LeaveApplicationVersion';

/**
 * One posted-leave fact for a Work Date. `wholeDay` is true only when the
 * posting covers the entire Work Date; `ambiguousReason` reports a posting
 * Attendance cannot place on the clock, which becomes a blocking exception.
 */
export interface PostedLeaveDayCoverage {
  ledgerEntryId: string;
  leaveAccountId: string;
  leaveApplicationId: string;
  policyVersionId: string;
  quantity: number;
  wholeDay: boolean;
  ambiguousReason: string | null;
}

export interface LeaveAccountListFilters {
  employeeId?: string | undefined;
  leaveTypeId?: string | undefined;
  status?: LeaveAccountStatus | undefined;
  asOf?: string | undefined;
  recordedThrough?: string | undefined;
}

export interface LeaveAccountBalances {
  asOf: string;
  recordedThrough: string;
  postedQuantity: string;
  committedQuantity: string;
  availableQuantity: string;
}

export interface LeaveAccountSummary {
  id: string;
  agencyId: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  unitCode: string;
  status: LeaveAccountStatus;
  openedAt: string;
  closedAt: string | null;
  balances: LeaveAccountBalances;
}

export interface LeaveLedgerEntrySummary {
  id: string;
  quantity: string;
  effectiveDate: string;
  sourceType: string;
  sourceId: string;
  sourcePostingKey: string;
  policyVersionId: string;
  policyVersionNo: number;
  reversesEntryId: string | null;
  postedAt: string;
  postedByMembershipId: string | null;
  postedByName: string | null;
}

export interface LeaveCreditCommitmentSummary {
  id: string;
  quantity: string;
  sourceType: string;
  sourceId: string;
  sourceCommitmentKey: string;
  succeedsCommitmentId: string | null;
  status: string;
  effectiveFrom: string;
  endedAt: string | null;
}

export interface LeaveAccountOpeningSummary {
  id: string;
  quantity: string;
  effectiveDate: string;
  policyVersionId: string;
  policyVersionNo: number;
  evidenceDocumentId: string;
  evidenceDocumentVersionId: string;
  evidenceDocumentNo: string | null;
  evidenceDocumentType: string;
  evidenceDocumentVersionNo: number;
  reason: string | null;
  openedByMembershipId: string;
  openedByName: string | null;
  openedAt: string;
}

export interface LeaveAccountHistoryEntry {
  id: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  effectiveDate: string | null;
  occurredAt: string;
}

export interface LeaveAccountDetail {
  account: LeaveAccountSummary;
  opening: LeaveAccountOpeningSummary | null;
  ledgerEntries: LeaveLedgerEntrySummary[];
  commitments: LeaveCreditCommitmentSummary[];
  history: LeaveAccountHistoryEntry[];
}

export interface OpenLeaveAccountInput {
  employeeId: string;
  leaveTypeId: string;
  effectiveDate: string;
  openingQuantity: number;
  evidenceDocumentId: string;
  reason?: string | undefined;
}

export interface FreezeLeaveAccountInput {
  reason: string;
}

export interface CloseLeaveAccountInput {
  closedAt: string;
  reason: string;
}

export interface RecordLeaveAdjustmentInput {
  quantity: number;
  effectiveDate: string;
  authorityDocumentId: string;
  evidenceDocumentId: string;
  reason: string;
}

export interface ReverseLeaveLedgerEntryInput {
  authorityDocumentId: string;
  evidenceDocumentId: string;
  reason: string;
}

export interface LeaveAccountAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const LEAVE_ACCOUNT_AUDIT_WRITER = Symbol('LEAVE_ACCOUNT_AUDIT_WRITER');

export const leaveAccountAuditWriter: LeaveAccountAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};

export class LeaveAccountServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly reasons: string[] = [],
  ) {
    super(message);
    this.name = 'LeaveAccountServiceError';
  }
}

const accountSelect = {
  id: true,
  agencyId: true,
  employeeId: true,
  leaveTypeId: true,
  unitCode: true,
  status: true,
  openedAt: true,
  closedAt: true,
  employee: {
    select: {
      employeeNumber: true,
      legalName: true,
      memberships: { select: { id: true } },
    },
  },
  leaveType: { select: { code: true, name: true } },
} as const;

const ledgerEntrySelect = {
  id: true,
  leaveAccountId: true,
  quantity: true,
  effectiveDate: true,
  sourceType: true,
  sourceId: true,
  sourcePostingKey: true,
  policyVersionId: true,
  reversesEntryId: true,
  postedAt: true,
  postedByMembershipId: true,
  policyVersion: { select: { versionNo: true } },
  postedBy: { select: { employee: { select: { legalName: true } } } },
} as const;

const commitmentSelect = {
  id: true,
  quantity: true,
  sourceType: true,
  sourceId: true,
  sourceCommitmentKey: true,
  succeedsCommitmentId: true,
  status: true,
  effectiveFrom: true,
  endedAt: true,
} as const;

const openingSelect = {
  id: true,
  quantity: true,
  effectiveDate: true,
  policyVersionId: true,
  evidenceDocumentId: true,
  evidenceDocumentVersionId: true,
  reason: true,
  openedByMembershipId: true,
  openedAt: true,
  policyVersion: { select: { versionNo: true } },
  evidence: { select: { documentNo: true, documentType: true } },
  evidenceVersion: { select: { versionNo: true } },
  openedBy: { select: { employee: { select: { legalName: true } } } },
} as const;

type LeaveAccountRecord = Prisma.LeaveAccountGetPayload<{ select: typeof accountSelect }>;
type LeaveLedgerEntryRecord = Prisma.LeaveLedgerEntryGetPayload<{
  select: typeof ledgerEntrySelect;
}>;
type LeaveCreditCommitmentRecord = Prisma.LeaveCreditCommitmentGetPayload<{
  select: typeof commitmentSelect;
}>;
type LeaveAccountOpeningRecord = Prisma.LeaveAccountOpeningGetPayload<{
  select: typeof openingSelect;
}>;

const ZERO = new Prisma.Decimal(0);

function databaseContext(context: RequestContext) {
  return requestDatabaseContext(context);
}

function toDatabaseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw dateInvalid();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw dateInvalid();
  }
  return date;
}

function toDatabaseInstant(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw dateInvalid();
  return date;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatDateTime(value: Date): string {
  return value.toISOString();
}

function formatQuantity(value: Prisma.Decimal): string {
  return value.toFixed(4);
}

function quantityDecimal(value: number): Prisma.Decimal {
  const decimal = new Prisma.Decimal(value);
  if (decimal.decimalPlaces() > 4) throw quantityInvalid();
  return decimal;
}

function manilaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function metadataString(metadata: Prisma.JsonValue, key: string): string | null {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function balanceValues(
  posted: Prisma.Decimal,
  committed: Prisma.Decimal,
  asOf: Date,
  recordedThrough: Date,
): LeaveAccountBalances {
  return {
    asOf: formatDate(asOf),
    recordedThrough: formatDateTime(recordedThrough),
    postedQuantity: formatQuantity(posted),
    committedQuantity: formatQuantity(committed),
    availableQuantity: formatQuantity(posted.minus(committed)),
  };
}

function accountSummary(
  record: LeaveAccountRecord,
  balances: LeaveAccountBalances,
): LeaveAccountSummary {
  return {
    id: record.id,
    agencyId: record.agencyId,
    employeeId: record.employeeId,
    employeeNumber: record.employee.employeeNumber,
    employeeName: record.employee.legalName,
    leaveTypeId: record.leaveTypeId,
    leaveTypeCode: record.leaveType.code,
    leaveTypeName: record.leaveType.name,
    unitCode: record.unitCode,
    status: record.status as LeaveAccountStatus,
    openedAt: formatDate(record.openedAt),
    closedAt: record.closedAt ? formatDate(record.closedAt) : null,
    balances,
  };
}

function ledgerEntrySummary(record: LeaveLedgerEntryRecord): LeaveLedgerEntrySummary {
  return {
    id: record.id,
    quantity: formatQuantity(record.quantity),
    effectiveDate: formatDate(record.effectiveDate),
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    sourcePostingKey: record.sourcePostingKey,
    policyVersionId: record.policyVersionId,
    policyVersionNo: record.policyVersion.versionNo,
    reversesEntryId: record.reversesEntryId,
    postedAt: formatDateTime(record.postedAt),
    postedByMembershipId: record.postedByMembershipId,
    postedByName: record.postedBy?.employee?.legalName ?? null,
  };
}

function commitmentSummary(record: LeaveCreditCommitmentRecord): LeaveCreditCommitmentSummary {
  return {
    id: record.id,
    quantity: formatQuantity(record.quantity),
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    sourceCommitmentKey: record.sourceCommitmentKey,
    succeedsCommitmentId: record.succeedsCommitmentId,
    status: record.status,
    effectiveFrom: formatDateTime(record.effectiveFrom),
    endedAt: record.endedAt ? formatDateTime(record.endedAt) : null,
  };
}

function openingSummary(record: LeaveAccountOpeningRecord): LeaveAccountOpeningSummary {
  return {
    id: record.id,
    quantity: formatQuantity(record.quantity),
    effectiveDate: formatDate(record.effectiveDate),
    policyVersionId: record.policyVersionId,
    policyVersionNo: record.policyVersion.versionNo,
    evidenceDocumentId: record.evidenceDocumentId,
    evidenceDocumentVersionId: record.evidenceDocumentVersionId,
    evidenceDocumentNo: record.evidence.documentNo,
    evidenceDocumentType: record.evidence.documentType,
    evidenceDocumentVersionNo: record.evidenceVersion.versionNo,
    reason: record.reason,
    openedByMembershipId: record.openedByMembershipId,
    openedByName: record.openedBy.employee?.legalName ?? null,
    openedAt: formatDateTime(record.openedAt),
  };
}

/**
 * Leave Accounts hold the posted credit balance per Employee, credit-bearing
 * Leave Type, and continuous entitlement period. Leave Ledger Entries are the
 * only source of the posted balance; Leave Credit Commitments reserve credits
 * without changing it. Every write states the exact agency evidence it relies
 * on, locks the account before recomputing balance-sensitive facts, and is
 * replay-safe through the Idempotency-Key header.
 */
@Injectable()
export class LeaveAccountsService {
  constructor(
    @Inject(LEAVE_ACCOUNT_AUDIT_WRITER)
    private readonly auditWriter: LeaveAccountAuditWriter,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
  ) {}

  async list(
    context: RequestContext,
    filters: LeaveAccountListFilters = {},
  ): Promise<LeaveAccountSummary[]> {
    const scope = this.requireReadScope(context);
    const asOfValue = filters.asOf ?? manilaToday();
    const asOf = toDatabaseDate(asOfValue);
    const recordedThrough = filters.recordedThrough
      ? toDatabaseInstant(filters.recordedThrough)
      : new Date();
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const records = await transaction.leaveAccount.findMany({
        where: {
          agencyId: context.agencyId,
          ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
          ...(filters.leaveTypeId ? { leaveTypeId: filters.leaveTypeId } : {}),
          ...(filters.status ? { status: filters.status } : {}),
          ...(scope === 'OWN'
            ? { employee: { memberships: { some: { id: context.membershipId } } } }
            : {}),
        },
        orderBy: [{ employee: { legalName: 'asc' } }, { leaveType: { code: 'asc' } }],
        select: accountSelect,
      });
      const balances = await this.balanceMap(
        transaction,
        context.agencyId,
        records.map((record) => record.id),
        asOf,
        recordedThrough,
      );
      return records.map((record) =>
        accountSummary(
          record,
          balances.get(record.id) ?? balanceValues(ZERO, ZERO, asOf, recordedThrough),
        ),
      );
    });
  }

  async findById(
    context: RequestContext,
    accountId: string,
    options: { asOf?: string | undefined; recordedThrough?: string | undefined } = {},
  ): Promise<LeaveAccountDetail | null> {
    const scope = this.requireReadScope(context);
    const asOf = toDatabaseDate(options.asOf ?? manilaToday());
    const recordedThrough = options.recordedThrough
      ? toDatabaseInstant(options.recordedThrough)
      : new Date();
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const record = await transaction.leaveAccount.findFirst({
        where: { agencyId: context.agencyId, id: accountId },
        select: accountSelect,
      });
      if (!record) return null;
      if (
        scope === 'OWN' &&
        !record.employee.memberships.some((m) => m.id === context.membershipId)
      ) {
        return null;
      }
      const opening = await transaction.leaveAccountOpening.findFirst({
        where: { agencyId: context.agencyId, leaveAccountId: accountId },
        select: openingSelect,
      });
      const entries = await transaction.leaveLedgerEntry.findMany({
        where: { agencyId: context.agencyId, leaveAccountId: accountId },
        orderBy: [{ effectiveDate: 'desc' }, { postedAt: 'desc' }, { id: 'desc' }],
        take: 200,
        select: ledgerEntrySelect,
      });
      const commitments = await transaction.leaveCreditCommitment.findMany({
        where: { agencyId: context.agencyId, leaveAccountId: accountId },
        orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
        take: 200,
        select: commitmentSelect,
      });
      const balances = await this.balanceSnapshot(
        transaction,
        context.agencyId,
        accountId,
        asOf,
        recordedThrough,
      );
      const events = await transaction.auditEvent.findMany({
        where: {
          agencyId: context.agencyId,
          entityType: 'LeaveAccount',
          entityId: accountId,
          action: { startsWith: 'LEAVE_' },
        },
        orderBy: { occurredAt: 'asc' },
        select: {
          id: true,
          action: true,
          previousStatus: true,
          newStatus: true,
          reason: true,
          metadata: true,
          occurredAt: true,
        },
      });
      return {
        account: accountSummary(record, balances),
        opening: opening ? openingSummary(opening) : null,
        ledgerEntries: entries.map((entry) => ledgerEntrySummary(entry)),
        commitments: commitments.map((commitment) => commitmentSummary(commitment)),
        history: events.map((event) => ({
          id: event.id,
          action: event.action,
          previousStatus: event.previousStatus,
          newStatus: event.newStatus,
          reason: event.reason,
          effectiveDate: metadataString(event.metadata, 'effectiveDate'),
          occurredAt: formatDateTime(event.occurredAt),
        })),
      };
    });
  }

  async open(
    context: RequestContext,
    input: OpenLeaveAccountInput,
    rawIdempotencyKey?: string,
  ): Promise<LeaveAccountSummary> {
    this.assertPermission(context, 'leave.credits.adjust', 'LEAVE_CREDIT_ADJUST_FORBIDDEN');
    this.assertPermission(context, 'documents.evidence.read', 'LEAVE_ACCOUNT_EVIDENCE_FORBIDDEN');
    const effectiveDate = toDatabaseDate(input.effectiveDate);
    const quantity = quantityDecimal(input.openingQuantity);
    const reason = input.reason?.trim() || null;
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const fingerprint = canonicalJson({
      command: 'LEAVE_ACCOUNT_OPENED',
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      effectiveDate: input.effectiveDate,
      openingQuantity: formatQuantity(quantity),
      evidenceDocumentId: input.evidenceDocumentId,
      reason,
    });
    try {
      return await withDatabaseContext(databaseContext(context), async (transaction) => {
        if (idempotencyKey) {
          const completed = await this.completedWrite(transaction, context, {
            action: 'LEAVE_ACCOUNT_OPENED',
            idempotencyKey,
            fingerprint,
          });
          if (completed) {
            const accountId = metadataString(completed.metadata, 'accountId');
            const existing = accountId
              ? await this.accountRecord(transaction, context.agencyId, accountId)
              : null;
            if (!existing) throw idempotencyConflict();
            return accountSummary(
              existing,
              await this.balanceSnapshot(
                transaction,
                context.agencyId,
                existing.id,
                effectiveDate,
                new Date(),
              ),
            );
          }
        }
        const employee = await transaction.employee.findFirst({
          where: { agencyId: context.agencyId, id: input.employeeId },
          select: { id: true },
        });
        if (!employee) throw employeeNotFound();
        const leaveType = await transaction.leaveType.findFirst({
          where: { agencyId: context.agencyId, id: input.leaveTypeId },
          select: { id: true, code: true, status: true },
        });
        if (!leaveType) throw leaveTypeNotFound();
        if (!isCreditBearingLeaveType(leaveType.code)) throw leaveTypeNotCreditBearing();
        if (leaveType.status !== 'ACTIVE') throw leaveTypeInactive();
        const policyVersion = await this.effectivePolicyVersion(
          transaction,
          context.agencyId,
          leaveType.id,
          effectiveDate,
        );
        if (!policyVersion) throw policyVersionNotEffective();
        const evidence = await this.resolveEvidence(transaction, context, input.evidenceDocumentId);
        const account = await transaction.leaveAccount.create({
          data: {
            agencyId: context.agencyId,
            employeeId: input.employeeId,
            leaveTypeId: input.leaveTypeId,
            unitCode: 'CREDIT_DAY',
            status: 'ACTIVE',
            openedAt: effectiveDate,
          },
          select: accountSelect,
        });
        const opening = await transaction.leaveAccountOpening.create({
          data: {
            agencyId: context.agencyId,
            leaveAccountId: account.id,
            policyVersionId: policyVersion.id,
            quantity,
            effectiveDate,
            evidenceDocumentId: evidence.document.id,
            evidenceDocumentVersionId: evidence.document.currentVersion.id,
            reason,
            openedByMembershipId: context.membershipId,
          },
          select: { id: true },
        });
        let ledgerEntryId: string | null = null;
        if (!quantity.isZero()) {
          const entry = await this.insertLedgerEntry(transaction, context, {
            leaveAccountId: account.id,
            quantity,
            effectiveDate,
            policyVersionId: policyVersion.id,
            sourceType: LEAVE_ACCOUNT_LEDGER_SOURCE_TYPES.OPENING,
            sourceId: opening.id,
            sourcePostingKey: 'OPENING',
          });
          ledgerEntryId = entry.id;
        }
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'LEAVE_ACCOUNT_OPENED',
          entityType: 'LeaveAccount',
          entityId: account.id,
          newStatus: 'ACTIVE',
          requestId: context.requestId,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          metadata: {
            fingerprint,
            accountId: account.id,
            openingId: opening.id,
            ledgerEntryId,
            employeeId: input.employeeId,
            leaveTypeId: input.leaveTypeId,
            effectiveDate: input.effectiveDate,
            openingQuantity: formatQuantity(quantity),
            policyVersionId: policyVersion.id,
            documentId: evidence.document.id,
            documentVersionId: evidence.document.currentVersion.id,
          },
        });
        return accountSummary(
          account,
          await this.balanceSnapshot(
            transaction,
            context.agencyId,
            account.id,
            effectiveDate,
            new Date(),
          ),
        );
      });
    } catch (error: unknown) {
      if (error instanceof LeaveAccountServiceError) throw error;
      if (isUniqueViolation(error)) throw alreadyOpen();
      throw error;
    }
  }

  async freeze(
    context: RequestContext,
    accountId: string,
    input: FreezeLeaveAccountInput,
    rawIdempotencyKey?: string,
  ): Promise<LeaveAccountSummary> {
    return this.transition(context, accountId, {
      action: 'LEAVE_ACCOUNT_FROZEN',
      fromStatus: 'ACTIVE',
      toStatus: 'FROZEN',
      reason: input.reason.trim(),
      fingerprint: canonicalJson({
        command: 'LEAVE_ACCOUNT_FROZEN',
        accountId,
        reason: input.reason.trim(),
      }),
      rawIdempotencyKey,
    });
  }

  async unfreeze(
    context: RequestContext,
    accountId: string,
    input: FreezeLeaveAccountInput,
    rawIdempotencyKey?: string,
  ): Promise<LeaveAccountSummary> {
    return this.transition(context, accountId, {
      action: 'LEAVE_ACCOUNT_UNFROZEN',
      fromStatus: 'FROZEN',
      toStatus: 'ACTIVE',
      reason: input.reason.trim(),
      fingerprint: canonicalJson({
        command: 'LEAVE_ACCOUNT_UNFROZEN',
        accountId,
        reason: input.reason.trim(),
      }),
      rawIdempotencyKey,
    });
  }

  async close(
    context: RequestContext,
    accountId: string,
    input: CloseLeaveAccountInput,
    rawIdempotencyKey?: string,
  ): Promise<LeaveAccountSummary> {
    return this.transition(context, accountId, {
      action: 'LEAVE_ACCOUNT_CLOSED',
      fromStatus: null,
      toStatus: 'CLOSED',
      reason: input.reason.trim(),
      closedAt: toDatabaseDate(input.closedAt),
      fingerprint: canonicalJson({
        command: 'LEAVE_ACCOUNT_CLOSED',
        accountId,
        closedAt: input.closedAt,
        reason: input.reason.trim(),
      }),
      rawIdempotencyKey,
    });
  }

  async recordAdjustment(
    context: RequestContext,
    accountId: string,
    input: RecordLeaveAdjustmentInput,
    rawIdempotencyKey?: string,
  ): Promise<LeaveAccountSummary> {
    this.assertPermission(context, 'leave.credits.adjust', 'LEAVE_CREDIT_ADJUST_FORBIDDEN');
    this.assertPermission(context, 'documents.evidence.read', 'LEAVE_ACCOUNT_EVIDENCE_FORBIDDEN');
    const quantity = quantityDecimal(input.quantity);
    if (quantity.isZero()) throw quantityInvalid();
    const effectiveDate = toDatabaseDate(input.effectiveDate);
    const reason = input.reason.trim();
    if (!reason) throw reasonRequired();
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const fingerprint = canonicalJson({
      command: 'LEAVE_LEDGER_ADJUSTMENT_RECORDED',
      accountId,
      quantity: formatQuantity(quantity),
      effectiveDate: input.effectiveDate,
      authorityDocumentId: input.authorityDocumentId,
      evidenceDocumentId: input.evidenceDocumentId,
      reason,
    });
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const account = await this.lockAccount(transaction, context.agencyId, accountId);
      if (idempotencyKey) {
        const completed = await this.completedWrite(transaction, context, {
          action: 'LEAVE_LEDGER_ADJUSTMENT_RECORDED',
          entityId: accountId,
          idempotencyKey,
          fingerprint,
        });
        if (completed) {
          return accountSummary(
            account,
            await this.balanceSnapshot(
              transaction,
              context.agencyId,
              accountId,
              effectiveDate,
              new Date(),
            ),
          );
        }
      }
      if (account.status !== 'ACTIVE') throw statusInvalid('ACTIVE', account.status);
      const policyVersion = await this.effectivePolicyVersion(
        transaction,
        context.agencyId,
        account.leaveTypeId,
        effectiveDate,
      );
      if (!policyVersion) throw policyVersionNotEffective();
      const authority = await this.resolveEvidence(
        transaction,
        context,
        input.authorityDocumentId,
        'LEAVE_ACCOUNT_AUTHORITY_INELIGIBLE',
      );
      const evidence = await this.resolveEvidence(transaction, context, input.evidenceDocumentId);
      if (quantity.isNegative()) {
        await this.assertSufficientPostedBalance(
          transaction,
          context.agencyId,
          accountId,
          effectiveDate,
          quantity,
        );
      }
      const adjustment = await transaction.leaveLedgerAdjustment.create({
        data: {
          agencyId: context.agencyId,
          leaveAccountId: accountId,
          policyVersionId: policyVersion.id,
          quantity,
          effectiveDate,
          authorityDocumentId: authority.document.id,
          authorityDocumentVersionId: authority.document.currentVersion.id,
          evidenceDocumentId: evidence.document.id,
          evidenceDocumentVersionId: evidence.document.currentVersion.id,
          reason,
          recordedByMembershipId: context.membershipId,
        },
        select: { id: true },
      });
      const entry = await this.insertLedgerEntry(transaction, context, {
        leaveAccountId: accountId,
        quantity,
        effectiveDate,
        policyVersionId: policyVersion.id,
        sourceType: LEAVE_ACCOUNT_LEDGER_SOURCE_TYPES.ADJUSTMENT,
        sourceId: adjustment.id,
        sourcePostingKey: 'ADJUSTMENT',
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'LEAVE_LEDGER_ADJUSTMENT_RECORDED',
        entityType: 'LeaveAccount',
        entityId: accountId,
        previousStatus: account.status,
        newStatus: account.status,
        reason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          fingerprint,
          accountId,
          adjustmentId: adjustment.id,
          ledgerEntryId: entry.id,
          quantity: formatQuantity(quantity),
          effectiveDate: input.effectiveDate,
          policyVersionId: policyVersion.id,
          authorityDocumentId: authority.document.id,
          authorityDocumentVersionId: authority.document.currentVersion.id,
          documentId: evidence.document.id,
          documentVersionId: evidence.document.currentVersion.id,
        },
      });
      return accountSummary(
        account,
        await this.balanceSnapshot(
          transaction,
          context.agencyId,
          accountId,
          effectiveDate,
          new Date(),
        ),
      );
    });
  }

  async reverseEntry(
    context: RequestContext,
    accountId: string,
    entryId: string,
    input: ReverseLeaveLedgerEntryInput,
    rawIdempotencyKey?: string,
  ): Promise<LeaveAccountSummary> {
    this.assertPermission(context, 'leave.credits.adjust', 'LEAVE_CREDIT_ADJUST_FORBIDDEN');
    this.assertPermission(context, 'documents.evidence.read', 'LEAVE_ACCOUNT_EVIDENCE_FORBIDDEN');
    const reason = input.reason.trim();
    if (!reason) throw reasonRequired();
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const fingerprint = canonicalJson({
      command: 'LEAVE_LEDGER_ENTRY_REVERSED',
      accountId,
      entryId,
      authorityDocumentId: input.authorityDocumentId,
      evidenceDocumentId: input.evidenceDocumentId,
      reason,
    });
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const account = await this.lockAccount(transaction, context.agencyId, accountId);
      if (idempotencyKey) {
        const completed = await this.completedWrite(transaction, context, {
          action: 'LEAVE_LEDGER_ENTRY_REVERSED',
          entityId: accountId,
          idempotencyKey,
          fingerprint,
        });
        if (completed) {
          return accountSummary(
            account,
            await this.balanceSnapshot(
              transaction,
              context.agencyId,
              accountId,
              account.openedAt,
              new Date(),
            ),
          );
        }
      }
      if (account.status !== 'ACTIVE') throw statusInvalid('ACTIVE', account.status);
      const original = await transaction.leaveLedgerEntry.findFirst({
        where: { agencyId: context.agencyId, leaveAccountId: accountId, id: entryId },
        select: ledgerEntrySelect,
      });
      if (!original) throw ledgerEntryNotFound();
      const existingReversal = await transaction.leaveLedgerEntry.findFirst({
        where: { agencyId: context.agencyId, reversesEntryId: entryId },
        select: { id: true },
      });
      if (existingReversal) throw reversalExists();
      const authority = await this.resolveEvidence(
        transaction,
        context,
        input.authorityDocumentId,
        'LEAVE_ACCOUNT_AUTHORITY_INELIGIBLE',
      );
      const evidence = await this.resolveEvidence(transaction, context, input.evidenceDocumentId);
      const quantity = original.quantity.negated();
      const reversal = await transaction.leaveLedgerAdjustment.create({
        data: {
          agencyId: context.agencyId,
          leaveAccountId: accountId,
          policyVersionId: original.policyVersionId,
          quantity,
          effectiveDate: original.effectiveDate,
          authorityDocumentId: authority.document.id,
          authorityDocumentVersionId: authority.document.currentVersion.id,
          evidenceDocumentId: evidence.document.id,
          evidenceDocumentVersionId: evidence.document.currentVersion.id,
          reversesEntryId: entryId,
          reason,
          recordedByMembershipId: context.membershipId,
        },
        select: { id: true },
      });
      const entry = await this.insertLedgerEntry(transaction, context, {
        leaveAccountId: accountId,
        quantity,
        effectiveDate: original.effectiveDate,
        policyVersionId: original.policyVersionId,
        sourceType: LEAVE_ACCOUNT_LEDGER_SOURCE_TYPES.ADJUSTMENT,
        sourceId: reversal.id,
        sourcePostingKey: 'REVERSAL',
        reversesEntryId: entryId,
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'LEAVE_LEDGER_ENTRY_REVERSED',
        entityType: 'LeaveAccount',
        entityId: accountId,
        previousStatus: account.status,
        newStatus: account.status,
        reason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          fingerprint,
          accountId,
          reversalSourceId: reversal.id,
          reversalEntryId: entry.id,
          reversesEntryId: entryId,
          quantity: formatQuantity(quantity),
          effectiveDate: formatDate(original.effectiveDate),
          policyVersionId: original.policyVersionId,
          authorityDocumentId: authority.document.id,
          authorityDocumentVersionId: authority.document.currentVersion.id,
          documentId: evidence.document.id,
          documentVersionId: evidence.document.currentVersion.id,
        },
      });
      return accountSummary(
        account,
        await this.balanceSnapshot(
          transaction,
          context.agencyId,
          accountId,
          original.effectiveDate,
          new Date(),
        ),
      );
    });
  }

  private async transition(
    context: RequestContext,
    accountId: string,
    input: {
      action: string;
      fromStatus: LeaveAccountStatus | null;
      toStatus: LeaveAccountStatus;
      reason: string;
      closedAt?: Date | undefined;
      fingerprint: string;
      rawIdempotencyKey?: string | undefined;
    },
  ): Promise<LeaveAccountSummary> {
    this.assertPermission(context, 'leave.credits.adjust', 'LEAVE_CREDIT_ADJUST_FORBIDDEN');
    if (!input.reason) throw reasonRequired();
    const idempotencyKey = input.rawIdempotencyKey?.trim() || null;
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const account = await this.lockAccount(transaction, context.agencyId, accountId);
      const asOf = input.closedAt ?? account.openedAt;
      if (idempotencyKey) {
        const completed = await this.completedWrite(transaction, context, {
          action: input.action,
          entityId: accountId,
          idempotencyKey,
          fingerprint: input.fingerprint,
        });
        if (completed) {
          return accountSummary(
            account,
            await this.balanceSnapshot(transaction, context.agencyId, accountId, asOf, new Date()),
          );
        }
      }
      if (input.fromStatus !== null && account.status !== input.fromStatus) {
        throw statusInvalid(input.fromStatus, account.status);
      }
      if (input.fromStatus === null && account.status === 'CLOSED') {
        throw statusInvalid('ACTIVE', account.status);
      }
      if (input.closedAt && input.closedAt < account.openedAt) throw closeDateInvalid();
      const updated = await transaction.leaveAccount.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: accountId } },
        data: {
          status: input.toStatus,
          ...(input.closedAt ? { closedAt: input.closedAt } : {}),
        },
        select: accountSelect,
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: input.action,
        entityType: 'LeaveAccount',
        entityId: accountId,
        previousStatus: account.status,
        newStatus: input.toStatus,
        reason: input.reason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          fingerprint: input.fingerprint,
          accountId,
          ...(input.closedAt ? { closedAt: formatDate(input.closedAt) } : {}),
        },
      });
      return accountSummary(
        updated,
        await this.balanceSnapshot(transaction, context.agencyId, accountId, asOf, new Date()),
      );
    });
  }

  /** Locks the account row so balance-sensitive posting recomputes under one writer. */
  private async lockAccount(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    accountId: string,
  ): Promise<LeaveAccountRecord> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "leave_accounts" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${accountId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) throw accountNotFound();
    const account = await this.accountRecord(transaction, agencyId, accountId);
    if (!account) throw accountNotFound();
    return account;
  }

  private async accountRecord(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    accountId: string,
  ): Promise<LeaveAccountRecord | null> {
    return transaction.leaveAccount.findFirst({
      where: { agencyId, id: accountId },
      select: accountSelect,
    });
  }

  private async balanceSnapshot(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    accountId: string,
    asOf: Date,
    recordedThrough: Date,
  ): Promise<LeaveAccountBalances> {
    const ledger = await transaction.leaveLedgerEntry.aggregate({
      where: {
        agencyId,
        leaveAccountId: accountId,
        effectiveDate: { lte: asOf },
        postedAt: { lte: recordedThrough },
      },
      _sum: { quantity: true },
    });
    const commitments = await transaction.leaveCreditCommitment.aggregate({
      where: {
        agencyId,
        leaveAccountId: accountId,
        effectiveFrom: { lte: recordedThrough },
        OR: [{ endedAt: null }, { endedAt: { gt: recordedThrough } }],
      },
      _sum: { quantity: true },
    });
    return balanceValues(
      ledger._sum.quantity ?? ZERO,
      commitments._sum.quantity ?? ZERO,
      asOf,
      recordedThrough,
    );
  }

  private async balanceMap(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    accountIds: readonly string[],
    asOf: Date,
    recordedThrough: Date,
  ): Promise<Map<string, LeaveAccountBalances>> {
    const balances = new Map<string, LeaveAccountBalances>();
    if (accountIds.length === 0) return balances;
    const ledger = await transaction.leaveLedgerEntry.groupBy({
      by: ['leaveAccountId'],
      where: {
        agencyId,
        leaveAccountId: { in: [...accountIds] },
        effectiveDate: { lte: asOf },
        postedAt: { lte: recordedThrough },
      },
      _sum: { quantity: true },
    });
    const commitments = await transaction.leaveCreditCommitment.groupBy({
      by: ['leaveAccountId'],
      where: {
        agencyId,
        leaveAccountId: { in: [...accountIds] },
        effectiveFrom: { lte: recordedThrough },
        OR: [{ endedAt: null }, { endedAt: { gt: recordedThrough } }],
      },
      _sum: { quantity: true },
    });
    const posted = new Map(
      ledger.map((row) => [row.leaveAccountId, row._sum.quantity ?? ZERO] as const),
    );
    const committed = new Map(
      commitments.map((row) => [row.leaveAccountId, row._sum.quantity ?? ZERO] as const),
    );
    for (const accountId of accountIds) {
      balances.set(
        accountId,
        balanceValues(
          posted.get(accountId) ?? ZERO,
          committed.get(accountId) ?? ZERO,
          asOf,
          recordedThrough,
        ),
      );
    }
    return balances;
  }

  private async effectivePolicyVersion(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    leaveTypeId: string,
    effectiveDate: Date,
  ): Promise<{ id: string } | null> {
    return transaction.leavePolicyVersion.findFirst({
      where: {
        agencyId,
        leaveTypeId,
        status: { in: ['ACTIVE', 'SUPERSEDED'] },
        effectiveFrom: { lte: effectiveDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveDate } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: { id: true },
    });
  }

  private async resolveEvidence(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    documentId: string,
    code = 'LEAVE_ACCOUNT_EVIDENCE_INELIGIBLE',
  ) {
    const evidence = await this.documentsService.resolveExternalEvidenceInTransaction(
      transaction,
      context,
      { documentId, allowSensitive: false, requirement: 'FINALIZED_VERSION' },
    );
    if (!evidence.ok) {
      throw new LeaveAccountServiceError(
        'The document must be an exact finalized Document Version in this Agency.',
        400,
        code,
        [evidence.reason],
      );
    }
    return evidence;
  }

  /**
   * Negative postings must not take the posted balance below zero at their
   * effective date. Commitments reserve availability for leave applications but
   * are consumed by their own posting workflow, so they do not block
   * corrections. Reversals are exempt because a correction must always be
   * possible.
   */
  private async assertSufficientPostedBalance(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    accountId: string,
    effectiveDate: Date,
    quantity: Prisma.Decimal,
  ): Promise<void> {
    const ledger = await transaction.leaveLedgerEntry.aggregate({
      where: {
        agencyId,
        leaveAccountId: accountId,
        effectiveDate: { lte: effectiveDate },
      },
      _sum: { quantity: true },
    });
    const posted = ledger._sum.quantity ?? ZERO;
    if (posted.plus(quantity).isNegative()) throw insufficientBalance(posted, quantity);
  }

  private async insertLedgerEntry(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: {
      leaveAccountId: string;
      quantity: Prisma.Decimal;
      effectiveDate: Date;
      policyVersionId: string;
      sourceType: string;
      sourceId: string;
      sourcePostingKey: string;
      reversesEntryId?: string | null;
    },
  ): Promise<{ id: string }> {
    return transaction.leaveLedgerEntry.create({
      data: {
        agencyId: context.agencyId,
        leaveAccountId: input.leaveAccountId,
        quantity: input.quantity,
        effectiveDate: input.effectiveDate,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourcePostingKey: input.sourcePostingKey,
        policyVersionId: input.policyVersionId,
        reversesEntryId: input.reversesEntryId ?? null,
        postedByMembershipId: context.membershipId,
      },
      select: { id: true },
    });
  }

  private async completedWrite(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: {
      action: string;
      entityId?: string | undefined;
      idempotencyKey: string;
      fingerprint: string;
    },
  ): Promise<{ metadata: Prisma.JsonValue } | null> {
    const completed = await transaction.auditEvent.findFirst({
      where: {
        agencyId: context.agencyId,
        action: input.action,
        ...(input.entityId ? { entityId: input.entityId } : {}),
        idempotencyKey: input.idempotencyKey,
      },
      select: { metadata: true },
    });
    if (!completed) return null;
    if (metadataString(completed.metadata, 'fingerprint') !== input.fingerprint) {
      throw idempotencyConflict();
    }
    return completed;
  }

  /**
   * Read the posted leave that covers one Work Date inside a caller-owned
   * transaction. Leave owns the posting; Attendance only reads the immutable
   * ledger fact and the accepted Leave Calculation Segment behind it. A posting
   * whose quantity cannot be placed on the clock returns an ambiguity instead of
   * an assumed interval, so the calculation can fail closed.
   */
  async postedLeaveCoverageInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    workDateValue: string,
  ): Promise<PostedLeaveDayCoverage[]> {
    const workDate = toDatabaseDate(workDateValue);
    const entries = await transaction.leaveLedgerEntry.findMany({
      where: {
        agencyId,
        effectiveDate: workDate,
        quantity: { gt: 0 },
        sourceType: LEAVE_APPLICATION_LEDGER_SOURCE_TYPE,
        reversesEntryId: null,
        reversedByEntry: { none: {} },
        leaveAccount: { employeeId },
      },
      orderBy: [{ postedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        leaveAccountId: true,
        quantity: true,
        sourceId: true,
        policyVersionId: true,
      },
    });
    const coverage: PostedLeaveDayCoverage[] = [];
    for (const entry of entries) {
      const quantity = entry.quantity.toNumber();
      const ambiguous = (reason: string, leaveApplicationId: string | null): void => {
        coverage.push({
          ledgerEntryId: entry.id,
          leaveAccountId: entry.leaveAccountId,
          leaveApplicationId: leaveApplicationId ?? entry.sourceId,
          policyVersionId: entry.policyVersionId,
          quantity,
          wholeDay: false,
          ambiguousReason: reason,
        });
      };
      const version = await transaction.leaveApplicationVersion.findFirst({
        where: { agencyId, id: entry.sourceId },
        select: { id: true, leaveApplicationId: true },
      });
      if (!version) {
        ambiguous('The posted leave names no Leave Application Version.', null);
        continue;
      }
      const segments = await transaction.leaveCalculationSegment.findMany({
        where: {
          agencyId,
          leaveApplicationVersionId: version.id,
          policyVersionId: entry.policyVersionId,
          dateFrom: { lte: workDate },
          dateTo: { gte: workDate },
        },
        select: { requestedUnit: true },
      });
      if (segments.length !== 1) {
        ambiguous(
          'The posted leave matches no unique accepted Leave Calculation Segment.',
          version.leaveApplicationId,
        );
        continue;
      }
      const unit = segments[0]!.requestedUnit;
      if (unit !== 'WORKING_DAY' && unit !== 'CALENDAR_DAY') {
        ambiguous(
          `The posted leave unit ${unit} carries no clock placement for the Work Date.`,
          version.leaveApplicationId,
        );
        continue;
      }
      if (!Number.isInteger(quantity) || quantity < 1) {
        ambiguous(
          'The posted leave covers a fraction of the Work Date without a clock placement.',
          version.leaveApplicationId,
        );
        continue;
      }
      coverage.push({
        ledgerEntryId: entry.id,
        leaveAccountId: entry.leaveAccountId,
        leaveApplicationId: version.leaveApplicationId,
        policyVersionId: entry.policyVersionId,
        quantity,
        wholeDay: true,
        ambiguousReason: null,
      });
    }
    return coverage;
  }

  private requireReadScope(context: RequestContext): 'AGENCY' | 'OWN' {
    if (
      context.permissions.some(
        (grant) => grant.code === 'leave.accounts.read' && grant.scopePolicy === 'AGENCY',
      )
    ) {
      return 'AGENCY';
    }
    if (
      context.permissions.some(
        (grant) => grant.code === 'leave.accounts.read' && grant.scopePolicy === 'OWN',
      )
    ) {
      return 'OWN';
    }
    throw new LeaveAccountServiceError(
      'The leave.accounts.read permission is required.',
      403,
      'LEAVE_ACCOUNT_READ_FORBIDDEN',
    );
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (!hasPermission(context, permission)) {
      throw new LeaveAccountServiceError(`The ${permission} permission is required.`, 403, code);
    }
  }
}

function accountNotFound(): LeaveAccountServiceError {
  return new LeaveAccountServiceError(
    'The Leave Account could not be found.',
    404,
    'LEAVE_ACCOUNT_NOT_FOUND',
  );
}

function employeeNotFound(): LeaveAccountServiceError {
  return new LeaveAccountServiceError(
    'The Employee could not be found in this Agency.',
    404,
    'LEAVE_ACCOUNT_EMPLOYEE_NOT_FOUND',
  );
}

function leaveTypeNotFound(): LeaveAccountServiceError {
  return new LeaveAccountServiceError(
    'The Leave Type could not be found in this Agency.',
    404,
    'LEAVE_ACCOUNT_LEAVE_TYPE_NOT_FOUND',
  );
}

function leaveTypeNotCreditBearing(): LeaveAccountServiceError {
  return new LeaveAccountServiceError(
    'That Leave Type does not keep a credit balance.',
    409,
    'LEAVE_ACCOUNT_LEAVE_TYPE_NOT_CREDIT_BEARING',
  );
}

function leaveTypeInactive(): LeaveAccountServiceError {
  return new LeaveAccountServiceError(
    'New Leave Accounts require an ACTIVE Leave Type.',
    409,
    'LEAVE_ACCOUNT_LEAVE_TYPE_INACTIVE',
  );
}

function alreadyOpen(): LeaveAccountServiceError {
  return new LeaveAccountServiceError(
    'An open Leave Account already covers this Employee and Leave Type.',
    409,
    'LEAVE_ACCOUNT_ALREADY_OPEN',
  );
}

function statusInvalid(expected: LeaveAccountStatus, actual: string): LeaveAccountServiceError {
  return new LeaveAccountServiceError(
    `The Leave Account must be ${expected} for this action; it is ${actual}.`,
    409,
    'LEAVE_ACCOUNT_STATUS_INVALID',
    [`EXPECTED:${expected}`, `ACTUAL:${actual}`],
  );
}

function closeDateInvalid(): LeaveAccountServiceError {
  return new LeaveAccountServiceError(
    'The close date cannot precede the Leave Account open date.',
    400,
    'LEAVE_ACCOUNT_CLOSE_DATE_INVALID',
  );
}

function policyVersionNotEffective(): LeaveAccountServiceError {
  return new LeaveAccountServiceError(
    'No published Leave Policy Version governs that effective date.',
    409,
    'LEAVE_POLICY_VERSION_NOT_EFFECTIVE',
  );
}

function insufficientBalance(
  posted: Prisma.Decimal,
  quantity: Prisma.Decimal,
): LeaveAccountServiceError {
  return new LeaveAccountServiceError(
    'The posting would take the posted balance below zero.',
    409,
    'LEAVE_ACCOUNT_INSUFFICIENT_BALANCE',
    [`POSTED:${formatQuantity(posted)}`, `REQUESTED:${formatQuantity(quantity)}`],
  );
}

function ledgerEntryNotFound(): LeaveAccountServiceError {
  return new LeaveAccountServiceError(
    'The Leave Ledger Entry could not be found on this Leave Account.',
    404,
    'LEAVE_LEDGER_ENTRY_NOT_FOUND',
  );
}

function reversalExists(): LeaveAccountServiceError {
  return new LeaveAccountServiceError(
    'That Leave Ledger Entry already has a reversal.',
    409,
    'LEAVE_LEDGER_ENTRY_REVERSAL_EXISTS',
  );
}

function reasonRequired(): LeaveAccountServiceError {
  return new LeaveAccountServiceError(
    'A reason is required for this Leave Account action.',
    400,
    'LEAVE_ACCOUNT_REASON_REQUIRED',
  );
}

function quantityInvalid(): LeaveAccountServiceError {
  return new LeaveAccountServiceError(
    'Enter a quantity with at most four decimal places.',
    400,
    'LEAVE_ACCOUNT_QUANTITY_INVALID',
  );
}

function dateInvalid(): LeaveAccountServiceError {
  return new LeaveAccountServiceError(
    'Enter a valid calendar date.',
    400,
    'LEAVE_ACCOUNT_DATE_INVALID',
  );
}

function idempotencyConflict(): LeaveAccountServiceError {
  return new LeaveAccountServiceError(
    'The Idempotency-Key was already used with different input.',
    409,
    'IDEMPOTENCY_CONFLICT',
  );
}
