import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canAccessRecord, type RequestContext } from '@lingkod-hr/auth';
import {
  ProtectedValueError,
  decryptProtectedValue,
  encryptProtectedValue,
  getConfig,
  normalizeProtectedValue,
  parseProtectedValueKey,
  sanitizeProtectedValueMetadata,
  type ProtectedValueKey,
} from '@lingkod-hr/config';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import type { PayrollBankAccountStatus } from './payroll-bank-accounts.constants';

export interface PayrollBankAccountCreateInput {
  bankCode: string;
  accountName: string;
  accountNumber: string;
  effectiveFrom: string;
  evidenceDocumentId?: string | null | undefined;
  evidenceDocumentVersionId?: string | null | undefined;
}

export type PayrollBankAccountReplaceInput = PayrollBankAccountCreateInput & { reason: string };

export interface PayrollBankAccountCorrectInput {
  bankCode: string;
  accountName: string;
  accountNumber: string;
  reason: string;
  evidenceDocumentId?: string | null | undefined;
  evidenceDocumentVersionId?: string | null | undefined;
}

export interface PayrollBankAccountActivateInput {
  verificationState: 'VERIFIED';
  verifiedAt: string;
  reason: string;
  evidenceDocumentId?: string | null | undefined;
  evidenceDocumentVersionId?: string | null | undefined;
}

export interface PayrollBankAccountInactivateInput {
  effectiveTo: string;
  reason: string;
}

export interface PayrollBankAccountRevealInput {
  reason: string;
}

export interface PayrollBankAccountSummary {
  id: string;
  employeeId: string;
  bankCode: string;
  accountName: string;
  maskedAccountNumber: string;
  verificationState: string;
  verifiedAt: string | null;
  status: PayrollBankAccountStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string | null;
  evidenceDocumentId: string | null;
  evidenceDocumentVersionId: string | null;
  predecessorAccountId: string | null;
  transitionKind: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollBankAccountReveal extends PayrollBankAccountSummary {
  accountNumber: string;
}

export interface PayrollBankAccountHistoryEntry {
  id: string;
  accountId: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  bankCode: string | null;
  accountName: string | null;
  maskedAccountNumber: string | null;
  reason: string | null;
  actorDisplayName: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  evidenceDocumentId: string | null;
  evidenceDocumentVersionId: string | null;
  predecessorAccountId: string | null;
  transitionKind: string | null;
  actedAt: string;
}

export interface PayrollBankAccountHistory {
  entries: PayrollBankAccountHistoryEntry[];
}

export interface PayrollBankAccountAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const PAYROLL_BANK_ACCOUNT_AUDIT_WRITER = Symbol('PAYROLL_BANK_ACCOUNT_AUDIT_WRITER');

export const payrollBankAccountAuditWriter: PayrollBankAccountAuditWriter = {
  async write(transaction, event): Promise<void> {
    const { metadata, ...rest } = event;
    await transaction.auditEvent.create({
      data: {
        ...rest,
        metadata: sanitizeProtectedValueMetadata(metadata) as Prisma.InputJsonObject,
      },
    });
  },
};

export class PayrollBankAccountsServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PayrollBankAccountsServiceError';
  }
}

const ENCRYPTION_VERSION = 1;
const LIST_LIMIT = 200;
const currentStatuses: PayrollBankAccountStatus[] = ['PENDING_VERIFICATION', 'ACTIVE'];

const accountSelect = {
  id: true,
  agencyId: true,
  employeeId: true,
  bankCode: true,
  accountName: true,
  encryptedAccountNumber: true,
  encryptionVersion: true,
  maskedAccountNumber: true,
  verificationState: true,
  verifiedAt: true,
  status: true,
  effectiveFrom: true,
  effectiveTo: true,
  reason: true,
  evidenceDocumentId: true,
  evidenceDocumentVersionId: true,
  predecessorAccountId: true,
  transitionKind: true,
  createdByMembershipId: true,
  createdAt: true,
  updatedByMembershipId: true,
  updatedAt: true,
} as const;

const employeeAccessSelect = {
  id: true,
  memberships: { where: { status: 'ACTIVE' }, select: { userId: true } },
  currentServiceSegment: { select: { organizationUnitId: true } },
} as const;

const historyEventSelect = {
  id: true,
  entityId: true,
  action: true,
  previousStatus: true,
  newStatus: true,
  reason: true,
  occurredAt: true,
  metadata: true,
  actorUser: { select: { displayName: true } },
} as const;

type AccountRecord = Prisma.PayrollBankAccountGetPayload<{ select: typeof accountSelect }>;
type EmployeeAccessRecord = Prisma.EmployeeGetPayload<{ select: typeof employeeAccessSelect }>;
type HistoryEventRecord = Prisma.AuditEventGetPayload<{ select: typeof historyEventSelect }>;

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatDateTime(value: Date): string {
  return value.toISOString();
}

function toDatabaseDate(value: string, code: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(date.getTime()) ||
    formatDate(date) !== value
  ) {
    throw new PayrollBankAccountsServiceError(
      'Enter a valid payroll bank account effective date.',
      400,
      code,
    );
  }
  return date;
}

function toDatabaseDateTime(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new PayrollBankAccountsServiceError(
      'Enter a valid payroll bank account verification timestamp.',
      400,
      'PAYROLL_BANK_ACCOUNT_VERIFIED_AT_INVALID',
    );
  }
  return date;
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function accountSummary(record: AccountRecord): PayrollBankAccountSummary {
  return {
    id: record.id,
    employeeId: record.employeeId,
    bankCode: record.bankCode,
    accountName: record.accountName,
    maskedAccountNumber: record.maskedAccountNumber,
    verificationState: record.verificationState,
    verifiedAt: record.verifiedAt ? formatDateTime(record.verifiedAt) : null,
    status: record.status as PayrollBankAccountStatus,
    effectiveFrom: formatDate(record.effectiveFrom),
    effectiveTo: record.effectiveTo ? formatDate(record.effectiveTo) : null,
    reason: record.reason,
    evidenceDocumentId: record.evidenceDocumentId,
    evidenceDocumentVersionId: record.evidenceDocumentVersionId,
    predecessorAccountId: record.predecessorAccountId,
    transitionKind: record.transitionKind,
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt),
  };
}

function auditMetadata(
  value: PayrollBankAccountSummary,
  extra: Prisma.InputJsonObject = {},
): Prisma.InputJsonObject {
  return {
    employeeId: value.employeeId,
    bankCode: value.bankCode,
    accountName: value.accountName,
    maskedAccountNumber: value.maskedAccountNumber,
    verificationState: value.verificationState,
    verifiedAt: value.verifiedAt,
    status: value.status,
    effectiveFrom: value.effectiveFrom,
    effectiveTo: value.effectiveTo,
    evidenceDocumentId: value.evidenceDocumentId,
    evidenceDocumentVersionId: value.evidenceDocumentVersionId,
    predecessorAccountId: value.predecessorAccountId,
    transitionKind: value.transitionKind,
    ...extra,
  };
}

function protectedValueMatchesRecord(
  metadata: Buffer,
  employeeId: string,
  bankCode: string,
): boolean {
  try {
    const value: unknown = JSON.parse(metadata.toString('utf8'));
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as { employeeId?: unknown }).employeeId === employeeId &&
      (value as { bankCode?: unknown }).bankCode === bankCode &&
      (value as { purpose?: unknown }).purpose === 'PAYROLL_BANK_ACCOUNT'
    );
  } catch {
    return false;
  }
}

function metadataObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function metadataField(metadata: unknown, field: string): string | null {
  const root = metadataObject(metadata);
  const after = metadataObject(root?.after);
  const before = metadataObject(root?.before);
  for (const value of [after?.[field], root?.[field], before?.[field]]) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function historyEntry(event: HistoryEventRecord): PayrollBankAccountHistoryEntry {
  return {
    id: event.id,
    accountId: event.entityId,
    action: event.action,
    previousStatus: event.previousStatus,
    newStatus: event.newStatus,
    bankCode: metadataField(event.metadata, 'bankCode'),
    accountName: metadataField(event.metadata, 'accountName'),
    maskedAccountNumber: metadataField(event.metadata, 'maskedAccountNumber'),
    reason: event.reason,
    actorDisplayName: event.actorUser?.displayName ?? null,
    effectiveFrom: metadataField(event.metadata, 'effectiveFrom'),
    effectiveTo: metadataField(event.metadata, 'effectiveTo'),
    evidenceDocumentId: metadataField(event.metadata, 'evidenceDocumentId'),
    evidenceDocumentVersionId: metadataField(event.metadata, 'evidenceDocumentVersionId'),
    predecessorAccountId: metadataField(event.metadata, 'predecessorAccountId'),
    transitionKind: metadataField(event.metadata, 'transitionKind'),
    actedAt: formatDateTime(event.occurredAt),
  };
}

function lineageIds(records: readonly AccountRecord[], selectedId: string): Set<string> {
  const ids = new Set<string>([selectedId]);
  const byId = new Map(records.map((record) => [record.id, record]));
  let current = byId.get(selectedId);
  while (current?.predecessorAccountId) {
    const predecessor = byId.get(current.predecessorAccountId);
    if (!predecessor) break;
    ids.add(predecessor.id);
    current = predecessor;
  }
  let added = true;
  while (added) {
    added = false;
    for (const record of records) {
      if (
        record.predecessorAccountId &&
        ids.has(record.predecessorAccountId) &&
        !ids.has(record.id)
      ) {
        ids.add(record.id);
        added = true;
      }
    }
  }
  return ids;
}

type RevealResult =
  | { kind: 'denied' }
  | { kind: 'reason-required' }
  | { kind: 'encryption-unavailable' }
  | { kind: 'failed' }
  | { kind: 'revealed'; value: PayrollBankAccountReveal };

@Injectable()
export class PayrollBankAccountsService {
  private readonly protectedValueKey: ProtectedValueKey | null;

  constructor(
    @Inject(PAYROLL_BANK_ACCOUNT_AUDIT_WRITER)
    private readonly auditWriter: PayrollBankAccountAuditWriter,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
  ) {
    const rawKey = getConfig().DATA_ENCRYPTION_KEY;
    try {
      this.protectedValueKey = rawKey ? parseProtectedValueKey(rawKey) : null;
    } catch (error: unknown) {
      if (!(error instanceof ProtectedValueError)) throw error;
      this.protectedValueKey = null;
    }
  }

  async list(
    context: RequestContext,
    employeeId: string,
  ): Promise<PayrollBankAccountSummary[] | null> {
    this.assertPermission(
      context,
      'payroll.bank_accounts.read',
      'PAYROLL_BANK_ACCOUNT_READ_FORBIDDEN',
    );
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const employee = await this.employeeAccess(transaction, context, employeeId);
      if (!employee || !this.canAccess(context, 'payroll.bank_accounts.read', employee))
        return null;
      const records = await transaction.payrollBankAccount.findMany({
        where: { agencyId: context.agencyId, employeeId, status: { in: currentStatuses } },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
        take: LIST_LIMIT,
        select: accountSelect,
      });
      return records.map(accountSummary);
    });
  }

  async create(
    context: RequestContext,
    employeeId: string,
    input: PayrollBankAccountCreateInput,
  ): Promise<PayrollBankAccountSummary> {
    this.assertPermission(
      context,
      'payroll.bank_accounts.manage',
      'PAYROLL_BANK_ACCOUNT_MANAGE_FORBIDDEN',
    );
    const effectiveFrom = toDatabaseDate(
      input.effectiveFrom,
      'PAYROLL_BANK_ACCOUNT_EFFECTIVE_FROM_INVALID',
    );
    const sealed = this.encrypt(input, employeeId);
    return withDatabaseContext(
      requestDatabaseContext(context, 'payroll-bank-account-transition'),
      async (transaction) => {
        await this.lockEmployee(transaction, context.agencyId, employeeId);
        const employee = await this.employeeAccess(transaction, context, employeeId);
        if (!employee || !this.canAccess(context, 'payroll.bank_accounts.manage', employee)) {
          throw this.notFound();
        }
        await this.assertEvidence(transaction, context, input);
        const created = await transaction.payrollBankAccount.create({
          data: {
            agencyId: context.agencyId,
            employeeId,
            bankCode: input.bankCode,
            accountName: input.accountName.trim(),
            encryptedAccountNumber: new Uint8Array(sealed.envelope),
            encryptionVersion: ENCRYPTION_VERSION,
            maskedAccountNumber: sealed.maskedValue,
            verificationState: 'PENDING',
            status: 'PENDING_VERIFICATION',
            effectiveFrom,
            evidenceDocumentId: input.evidenceDocumentId ?? null,
            evidenceDocumentVersionId: input.evidenceDocumentVersionId ?? null,
            createdByMembershipId: context.membershipId,
            updatedByMembershipId: context.membershipId,
          },
          select: accountSelect,
        });
        const value = accountSummary(created);
        await this.writeAudit(transaction, context, 'PAYROLL_BANK_ACCOUNT_CREATED', value, {
          previousStatus: 'NONE',
          newStatus: value.status,
          metadata: auditMetadata(value),
        });
        return value;
      },
    );
  }

  async replace(
    context: RequestContext,
    employeeId: string,
    accountId: string,
    input: PayrollBankAccountReplaceInput,
  ): Promise<PayrollBankAccountSummary> {
    this.assertPermission(
      context,
      'payroll.bank_accounts.manage',
      'PAYROLL_BANK_ACCOUNT_MANAGE_FORBIDDEN',
    );
    const reason = this.reason(input.reason);
    const effectiveFrom = toDatabaseDate(
      input.effectiveFrom,
      'PAYROLL_BANK_ACCOUNT_EFFECTIVE_FROM_INVALID',
    );
    const sealed = this.encrypt(input, employeeId);
    return withDatabaseContext(
      requestDatabaseContext(context, 'payroll-bank-account-transition'),
      async (transaction) => {
        await this.lockEmployee(transaction, context.agencyId, employeeId);
        const employee = await this.employeeAccess(transaction, context, employeeId);
        const source = await this.account(transaction, context.agencyId, employeeId, accountId);
        if (
          !employee ||
          !this.canAccess(context, 'payroll.bank_accounts.manage', employee) ||
          source?.status !== 'ACTIVE'
        ) {
          throw this.notFound();
        }
        if (effectiveFrom <= source.effectiveFrom) {
          throw new PayrollBankAccountsServiceError(
            'The replacement effective date must be after the current payroll bank account start date.',
            400,
            'PAYROLL_BANK_ACCOUNT_EFFECTIVE_PERIOD_INVALID',
          );
        }
        await this.assertNoSuccessor(transaction, source.id);
        await this.assertEvidence(transaction, context, input);
        const created = await transaction.payrollBankAccount.create({
          data: {
            agencyId: context.agencyId,
            employeeId,
            bankCode: input.bankCode,
            accountName: input.accountName.trim(),
            encryptedAccountNumber: new Uint8Array(sealed.envelope),
            encryptionVersion: ENCRYPTION_VERSION,
            maskedAccountNumber: sealed.maskedValue,
            verificationState: 'PENDING',
            status: 'PENDING_VERIFICATION',
            effectiveFrom,
            reason,
            evidenceDocumentId: input.evidenceDocumentId ?? null,
            evidenceDocumentVersionId: input.evidenceDocumentVersionId ?? null,
            predecessorAccountId: source.id,
            transitionKind: 'REPLACEMENT',
            createdByMembershipId: context.membershipId,
            updatedByMembershipId: context.membershipId,
          },
          select: accountSelect,
        });
        const before = accountSummary(source);
        const after = accountSummary(created);
        await this.writeAudit(
          transaction,
          context,
          'PAYROLL_BANK_ACCOUNT_REPLACEMENT_PREPARED',
          after,
          {
            previousStatus: before.status,
            newStatus: after.status,
            reason,
            metadata: { before: auditMetadata(before), after: auditMetadata(after) },
          },
        );
        return after;
      },
    );
  }

  async activate(
    context: RequestContext,
    employeeId: string,
    accountId: string,
    input: PayrollBankAccountActivateInput,
  ): Promise<PayrollBankAccountSummary> {
    this.assertPermission(
      context,
      'payroll.bank_accounts.manage',
      'PAYROLL_BANK_ACCOUNT_MANAGE_FORBIDDEN',
    );
    const reason = this.reason(input.reason);
    const verifiedAt = toDatabaseDateTime(input.verifiedAt);
    return withDatabaseContext(
      requestDatabaseContext(context, 'payroll-bank-account-transition'),
      async (transaction) => {
        await this.lockEmployee(transaction, context.agencyId, employeeId);
        const employee = await this.employeeAccess(transaction, context, employeeId);
        const pending = await this.account(transaction, context.agencyId, employeeId, accountId);
        if (
          !employee ||
          !this.canAccess(context, 'payroll.bank_accounts.manage', employee) ||
          pending?.status !== 'PENDING_VERIFICATION'
        ) {
          throw this.notFound();
        }
        const evidence = {
          evidenceDocumentId: input.evidenceDocumentId ?? pending.evidenceDocumentId,
          evidenceDocumentVersionId:
            input.evidenceDocumentVersionId ?? pending.evidenceDocumentVersionId,
        };
        await this.assertEvidence(transaction, context, evidence);
        let replaced: PayrollBankAccountSummary | null = null;
        const source = await this.activePredecessor(
          transaction,
          context.agencyId,
          employeeId,
          pending,
        );
        if (source) {
          if (pending.effectiveFrom <= source.effectiveFrom) {
            throw this.notFound();
          }
          const closed = await transaction.payrollBankAccount.update({
            where: { agencyId_id: { agencyId: context.agencyId, id: source.id } },
            data: {
              status: 'REPLACED',
              effectiveTo: addDays(pending.effectiveFrom, -1),
              reason,
              updatedByMembershipId: context.membershipId,
            },
            select: accountSelect,
          });
          replaced = accountSummary(closed);
        }
        await this.assertNoOverlap(
          transaction,
          context.agencyId,
          employeeId,
          pending.effectiveFrom,
        );
        const activated = await transaction.payrollBankAccount.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: pending.id } },
          data: {
            verificationState: input.verificationState,
            verifiedAt,
            status: 'ACTIVE',
            reason,
            evidenceDocumentId: evidence.evidenceDocumentId,
            evidenceDocumentVersionId: evidence.evidenceDocumentVersionId,
            updatedByMembershipId: context.membershipId,
          },
          select: accountSelect,
        });
        const before = accountSummary(pending);
        const after = accountSummary(activated);
        await this.writeAudit(transaction, context, 'PAYROLL_BANK_ACCOUNT_ACTIVATED', after, {
          previousStatus: before.status,
          newStatus: after.status,
          reason,
          metadata: {
            before: auditMetadata(before),
            after: auditMetadata(after),
            ...(replaced ? { replaced: auditMetadata(replaced) } : {}),
          },
        });
        return after;
      },
    );
  }

  async inactivate(
    context: RequestContext,
    employeeId: string,
    accountId: string,
    input: PayrollBankAccountInactivateInput,
  ): Promise<PayrollBankAccountSummary> {
    this.assertPermission(
      context,
      'payroll.bank_accounts.manage',
      'PAYROLL_BANK_ACCOUNT_MANAGE_FORBIDDEN',
    );
    const reason = this.reason(input.reason);
    const effectiveTo = toDatabaseDate(
      input.effectiveTo,
      'PAYROLL_BANK_ACCOUNT_EFFECTIVE_TO_INVALID',
    );
    return withDatabaseContext(
      requestDatabaseContext(context, 'payroll-bank-account-transition'),
      async (transaction) => {
        await this.lockEmployee(transaction, context.agencyId, employeeId);
        const employee = await this.employeeAccess(transaction, context, employeeId);
        const source = await this.account(transaction, context.agencyId, employeeId, accountId);
        if (
          !employee ||
          !this.canAccess(context, 'payroll.bank_accounts.manage', employee) ||
          source?.status !== 'ACTIVE'
        ) {
          throw this.notFound();
        }
        if (effectiveTo < source.effectiveFrom) {
          throw new PayrollBankAccountsServiceError(
            'The inactivation date cannot be before the payroll bank account start date.',
            400,
            'PAYROLL_BANK_ACCOUNT_EFFECTIVE_PERIOD_INVALID',
          );
        }
        const updated = await transaction.payrollBankAccount.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: source.id } },
          data: {
            status: 'INACTIVE',
            effectiveTo,
            reason,
            updatedByMembershipId: context.membershipId,
          },
          select: accountSelect,
        });
        const before = accountSummary(source);
        const after = accountSummary(updated);
        await this.writeAudit(transaction, context, 'PAYROLL_BANK_ACCOUNT_INACTIVATED', after, {
          previousStatus: before.status,
          newStatus: after.status,
          reason,
          metadata: { before: auditMetadata(before), after: auditMetadata(after) },
        });
        return after;
      },
    );
  }

  async correct(
    context: RequestContext,
    employeeId: string,
    accountId: string,
    input: PayrollBankAccountCorrectInput,
  ): Promise<PayrollBankAccountSummary> {
    this.assertPermission(
      context,
      'payroll.bank_accounts.manage',
      'PAYROLL_BANK_ACCOUNT_MANAGE_FORBIDDEN',
    );
    const reason = this.reason(input.reason);
    const sealed = this.encrypt(input, employeeId);
    return withDatabaseContext(
      requestDatabaseContext(context, 'payroll-bank-account-transition'),
      async (transaction) => {
        await this.lockEmployee(transaction, context.agencyId, employeeId);
        const employee = await this.employeeAccess(transaction, context, employeeId);
        const source = await this.account(transaction, context.agencyId, employeeId, accountId);
        if (
          !employee ||
          !this.canAccess(context, 'payroll.bank_accounts.manage', employee) ||
          !source ||
          source.status === 'CORRECTED'
        ) {
          throw this.notFound();
        }
        await this.assertNoSuccessor(transaction, source.id);
        const evidence = {
          evidenceDocumentId: input.evidenceDocumentId ?? source.evidenceDocumentId,
          evidenceDocumentVersionId:
            input.evidenceDocumentVersionId ?? source.evidenceDocumentVersionId,
        };
        await this.assertEvidence(transaction, context, evidence);
        const originalStatus = source.status as PayrollBankAccountStatus;
        const correctedSource = await transaction.payrollBankAccount.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: source.id } },
          data: { status: 'CORRECTED', reason, updatedByMembershipId: context.membershipId },
          select: accountSelect,
        });
        const created = await transaction.payrollBankAccount.create({
          data: {
            agencyId: context.agencyId,
            employeeId,
            bankCode: input.bankCode,
            accountName: input.accountName.trim(),
            encryptedAccountNumber: new Uint8Array(sealed.envelope),
            encryptionVersion: ENCRYPTION_VERSION,
            maskedAccountNumber: sealed.maskedValue,
            verificationState: source.verificationState,
            verifiedAt: source.verifiedAt,
            status: originalStatus,
            effectiveFrom: source.effectiveFrom,
            effectiveTo: source.effectiveTo,
            reason,
            evidenceDocumentId: evidence.evidenceDocumentId,
            evidenceDocumentVersionId: evidence.evidenceDocumentVersionId,
            predecessorAccountId: source.id,
            transitionKind: 'CORRECTION',
            createdByMembershipId: context.membershipId,
            updatedByMembershipId: context.membershipId,
          },
          select: accountSelect,
        });
        const before = accountSummary(correctedSource);
        const after = accountSummary(created);
        await this.writeAudit(transaction, context, 'PAYROLL_BANK_ACCOUNT_CORRECTED', after, {
          previousStatus: originalStatus,
          newStatus: after.status,
          reason,
          metadata: { before: auditMetadata(before), after: auditMetadata(after) },
        });
        return after;
      },
    );
  }

  async history(
    context: RequestContext,
    employeeId: string,
    accountId?: string,
  ): Promise<PayrollBankAccountHistory | null> {
    this.assertPermission(
      context,
      'payroll.bank_accounts.history.read',
      'PAYROLL_BANK_ACCOUNT_HISTORY_FORBIDDEN',
    );
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const employee = await this.employeeAccess(transaction, context, employeeId);
      if (!employee || !this.canAccess(context, 'payroll.bank_accounts.history.read', employee))
        return null;
      const selected = accountId
        ? await this.account(transaction, context.agencyId, employeeId, accountId)
        : null;
      if (accountId && !selected) return null;
      const records = await transaction.payrollBankAccount.findMany({
        where: { agencyId: context.agencyId, employeeId },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
        take: LIST_LIMIT,
        select: accountSelect,
      });
      const ids = selected
        ? lineageIds(records, selected.id)
        : new Set(records.map(({ id }) => id));
      if (ids.size === 0) return { entries: [] };
      const events = await transaction.auditEvent.findMany({
        where: {
          agencyId: context.agencyId,
          entityType: 'PayrollBankAccount',
          entityId: { in: [...ids] },
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: LIST_LIMIT,
        select: historyEventSelect,
      });
      return { entries: events.map(historyEntry) };
    });
  }

  async reveal(
    context: RequestContext,
    employeeId: string,
    accountId: string,
    input: PayrollBankAccountRevealInput,
  ): Promise<PayrollBankAccountReveal> {
    this.assertContext(context);
    const result = await withDatabaseContext<RevealResult>(
      requestDatabaseContext(context),
      async (transaction) => {
        const record = await this.account(transaction, context.agencyId, employeeId, accountId);
        const employee = await this.employeeAccess(transaction, context, employeeId);
        const base = record ? accountSummary(record) : null;
        const scoped =
          Boolean(record && employee) &&
          this.canAccess(context, 'payroll.bank_accounts.reveal', employee as EmployeeAccessRecord);
        const reason = input.reason.trim();
        let outcome: 'DENIED' | 'FAILED' | 'REVEALED' = 'DENIED';
        let reveal: RevealResult;
        if (
          !record ||
          !employee ||
          !scoped ||
          !currentStatuses.includes(record.status as PayrollBankAccountStatus)
        ) {
          reveal = { kind: 'denied' };
        } else if (!reason) {
          reveal = { kind: 'reason-required' };
        } else if (!this.protectedValueKey) {
          outcome = 'FAILED';
          reveal = { kind: 'encryption-unavailable' };
        } else if (record.encryptionVersion !== ENCRYPTION_VERSION) {
          outcome = 'FAILED';
          reveal = { kind: 'failed' };
        } else {
          outcome = 'FAILED';
          try {
            const opened = decryptProtectedValue(
              Buffer.from(record.encryptedAccountNumber),
              this.protectedValueKey,
            );
            if (!protectedValueMatchesRecord(opened.metadata, employeeId, record.bankCode)) {
              reveal = { kind: 'failed' };
            } else {
              outcome = 'REVEALED';
              reveal = { kind: 'revealed', value: { ...base!, accountNumber: opened.plaintext } };
            }
          } catch {
            reveal = { kind: 'failed' };
          }
        }
        await this.auditReveal(transaction, context, accountId, base, outcome);
        return reveal;
      },
    );
    if (result.kind === 'denied') throw this.notFound();
    if (result.kind === 'reason-required') throw this.reasonRequired();
    if (result.kind === 'encryption-unavailable') throw this.encryptionUnavailable();
    if (result.kind === 'failed') {
      throw new PayrollBankAccountsServiceError(
        'The payroll bank account cannot be revealed.',
        500,
        'PAYROLL_BANK_ACCOUNT_REVEAL_FAILED',
      );
    }
    return result.value;
  }

  private encrypt(
    input: Pick<PayrollBankAccountCreateInput, 'accountNumber' | 'bankCode'>,
    employeeId: string,
  ) {
    let accountNumber: string;
    try {
      accountNumber = normalizeProtectedValue(input.accountNumber);
    } catch (error: unknown) {
      if (!(error instanceof ProtectedValueError)) throw error;
      throw new PayrollBankAccountsServiceError(
        'Enter a valid payroll bank account number.',
        400,
        'PAYROLL_BANK_ACCOUNT_NUMBER_INVALID',
      );
    }
    if (!accountNumber) {
      throw new PayrollBankAccountsServiceError(
        'Enter a payroll bank account number.',
        400,
        'PAYROLL_BANK_ACCOUNT_NUMBER_REQUIRED',
      );
    }
    return encryptProtectedValue(accountNumber, this.key(), {
      metadata: JSON.stringify({
        purpose: 'PAYROLL_BANK_ACCOUNT',
        employeeId,
        bankCode: input.bankCode,
      }),
    });
  }

  private async account(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    accountId: string,
  ): Promise<AccountRecord | null> {
    return transaction.payrollBankAccount.findFirst({
      where: { agencyId, employeeId, id: accountId },
      select: accountSelect,
    });
  }

  private async employeeAccess(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    employeeId: string,
  ): Promise<EmployeeAccessRecord | null> {
    return transaction.employee.findUnique({
      where: { agencyId_id: { agencyId: context.agencyId, id: employeeId } },
      select: employeeAccessSelect,
    });
  }

  private async lockEmployee(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "employees" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${employeeId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) throw this.notFound();
  }

  private async assertNoOverlap(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    effectiveFrom: Date,
  ): Promise<void> {
    const conflict = await transaction.payrollBankAccount.findFirst({
      where: {
        agencyId,
        employeeId,
        status: 'ACTIVE',
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
      },
      select: { id: true },
    });
    if (conflict) {
      throw new PayrollBankAccountsServiceError(
        'The Employee already has an overlapping active primary payroll bank account.',
        409,
        'PAYROLL_BANK_ACCOUNT_ACTIVE_OVERLAP',
      );
    }
  }

  private async activePredecessor(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    account: AccountRecord,
  ): Promise<AccountRecord | null> {
    let predecessorId = account.predecessorAccountId;
    while (predecessorId) {
      const predecessor = await this.account(transaction, agencyId, employeeId, predecessorId);
      if (!predecessor) return null;
      if (predecessor.status === 'ACTIVE') return predecessor;
      predecessorId = predecessor.predecessorAccountId;
    }
    return null;
  }

  private async assertNoSuccessor(
    transaction: Prisma.TransactionClient,
    accountId: string,
  ): Promise<void> {
    const successor = await transaction.payrollBankAccount.findFirst({
      where: { predecessorAccountId: accountId },
      select: { id: true },
    });
    if (successor) {
      throw new PayrollBankAccountsServiceError(
        'This payroll bank account already has a successor.',
        409,
        'PAYROLL_BANK_ACCOUNT_SUCCESSOR_CONFLICT',
      );
    }
  }

  private async assertEvidence(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: {
      evidenceDocumentId?: string | null | undefined;
      evidenceDocumentVersionId?: string | null | undefined;
    },
  ): Promise<void> {
    const documentId = input.evidenceDocumentId ?? null;
    const versionId = input.evidenceDocumentVersionId ?? null;
    if (!documentId && !versionId) return;
    if (!documentId || !versionId) {
      throw new PayrollBankAccountsServiceError(
        'Evidence must reference an exact Document Version.',
        400,
        'PAYROLL_BANK_ACCOUNT_EVIDENCE_INVALID',
      );
    }
    const evidence = await this.documentsService.resolveExternalEvidenceInTransaction(
      transaction,
      context,
      {
        documentId,
        versionId,
        allowSensitive: context.permissions.some(
          ({ code }) => code === 'documents.evidence.read_sensitive',
        ),
        requirement: 'FINALIZED_VERSION',
      },
    );
    if (evidence.ok) return;
    if (evidence.reason === 'STATUS_INELIGIBLE') {
      throw new PayrollBankAccountsServiceError(
        'Only a finalized Document Version can support a payroll bank account.',
        400,
        'PAYROLL_BANK_ACCOUNT_EVIDENCE_INELIGIBLE',
      );
    }
    throw this.notFound();
  }

  private canAccess(
    context: RequestContext,
    permission: string,
    employee: EmployeeAccessRecord,
  ): boolean {
    const ownerUserId = employee.memberships[0]?.userId;
    return canAccessRecord(context, permission, {
      agencyId: context.agencyId,
      ...(ownerUserId ? { ownerUserId } : {}),
      ...(employee.currentServiceSegment
        ? { organizationUnitId: employee.currentServiceSegment.organizationUnitId }
        : {}),
    });
  }

  private reason(value: string): string {
    const reason = value.trim();
    if (!reason) throw this.reasonRequired();
    return reason;
  }

  private key(): ProtectedValueKey {
    if (!this.protectedValueKey) throw this.encryptionUnavailable();
    return this.protectedValueKey;
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    this.assertContext(context);
    if (!context.permissions.some((grant) => grant.code === permission)) {
      throw new PayrollBankAccountsServiceError(
        'The current Agency Membership lacks the required payroll bank account permission.',
        403,
        code,
      );
    }
  }

  private assertContext(context: RequestContext): void {
    if (!context.agencyId || !context.userId || !context.membershipId) {
      throw new PayrollBankAccountsServiceError(
        'The active Agency Context is required.',
        403,
        'PAYROLL_BANK_ACCOUNT_CONTEXT_INVALID',
      );
    }
  }

  private encryptionUnavailable(): PayrollBankAccountsServiceError {
    return new PayrollBankAccountsServiceError(
      'Payroll bank account encryption is not configured.',
      503,
      'PAYROLL_BANK_ACCOUNT_ENCRYPTION_UNAVAILABLE',
    );
  }

  private reasonRequired(): PayrollBankAccountsServiceError {
    return new PayrollBankAccountsServiceError(
      'A reason is required for this payroll bank account operation.',
      400,
      'PAYROLL_BANK_ACCOUNT_REASON_REQUIRED',
    );
  }

  private notFound(): PayrollBankAccountsServiceError {
    return new PayrollBankAccountsServiceError(
      'The payroll bank account could not be found.',
      404,
      'PAYROLL_BANK_ACCOUNT_NOT_FOUND',
    );
  }

  private async writeAudit(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    action: string,
    value: PayrollBankAccountSummary,
    input: {
      previousStatus?: string | null;
      newStatus?: string | null;
      reason?: string | null;
      metadata: Prisma.InputJsonObject;
    },
  ): Promise<void> {
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action,
      entityType: 'PayrollBankAccount',
      entityId: value.id,
      previousStatus: input.previousStatus ?? null,
      newStatus: input.newStatus ?? null,
      reason: input.reason ?? null,
      requestId: context.requestId,
      occurredAt: new Date(),
      metadata: input.metadata,
    });
  }

  private async auditReveal(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    accountId: string,
    value: PayrollBankAccountSummary | null,
    outcome: 'DENIED' | 'FAILED' | 'REVEALED',
  ): Promise<void> {
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action: 'PAYROLL_BANK_ACCOUNT_REVEAL_ATTEMPTED',
      entityType: 'PayrollBankAccount',
      entityId: accountId,
      previousStatus: value?.status ?? null,
      newStatus: outcome,
      reason: null,
      requestId: context.requestId,
      occurredAt: new Date(),
      metadata: value
        ? auditMetadata(value, { outcome })
        : ({ outcome, accountFound: false } satisfies Prisma.InputJsonObject),
    });
  }
}
