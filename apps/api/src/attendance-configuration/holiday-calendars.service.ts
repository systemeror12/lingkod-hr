import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import {
  ATTENDANCE_CONFIGURATION_AUDIT_WRITER,
  type AttendanceConfigurationAuditWriter,
} from './attendance-configuration.audit';
import {
  AttendanceConfigurationServiceError,
  HOLIDAY_CALENDAR_SCOPE_TYPES,
  addDays,
  formatDate,
  manilaToday,
  normalizeHolidayCalendarDefinition,
  toDatabaseDate,
  type ActivateAttendanceConfigurationInput,
  type CreateHolidayCalendarInput,
  type HolidayCalendarScopeType,
  type HolidayCalendarVersionDefinition,
  type HolidayCalendarVersionState,
  type HolidayDayType,
  type UpdateHolidayCalendarDraftInput,
} from './attendance-configuration.types';

export interface HolidayCalendarEntrySummary {
  id: string;
  holidayDate: string;
  name: string;
  dayType: HolidayDayType;
  sourceReference: string;
  rowVersion: number;
}

export interface HolidayCalendarVersionSummary {
  id: string;
  holidayCalendarId: string;
  versionNo: number;
  authorityDocumentVersionId: string | null;
  approvingAuthority: string | null;
  versionState: HolidayCalendarVersionState;
  effectiveFrom: string;
  effectiveTo: string | null;
  activatedAt: string | null;
  entries: HolidayCalendarEntrySummary[];
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface HolidayCalendarSummary {
  id: string;
  code: string;
  name: string;
  scopeType: HolidayCalendarScopeType;
  scopeReference: string;
  currentVersion: HolidayCalendarVersionSummary | null;
  draft: HolidayCalendarVersionSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface HolidayCalendarHistoryEntry {
  id: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  effectiveDate: string | null;
  occurredAt: string;
}

export interface HolidayCalendarDetail {
  calendar: HolidayCalendarSummary;
  asOf: string;
  effective: HolidayCalendarVersionSummary | null;
  versions: HolidayCalendarVersionSummary[];
  history: HolidayCalendarHistoryEntry[];
}

export interface HolidayCalendarSuccessor {
  current: HolidayCalendarVersionSummary;
  draft: HolidayCalendarVersionSummary;
}

const entrySelect = {
  id: true,
  holidayDate: true,
  name: true,
  dayType: true,
  sourceReference: true,
  rowVersion: true,
} as const;

const versionSelect = {
  id: true,
  holidayCalendarId: true,
  versionNo: true,
  authorityDocumentVersionId: true,
  approvingAuthority: true,
  status: true,
  effectiveFrom: true,
  effectiveTo: true,
  activatedAt: true,
  rowVersion: true,
  createdAt: true,
  updatedAt: true,
  entries: {
    orderBy: { holidayDate: 'asc' } as const,
    select: entrySelect,
  },
} as const;

const calendarSelect = {
  id: true,
  code: true,
  name: true,
  scopeType: true,
  scopeReference: true,
  createdAt: true,
  updatedAt: true,
  versions: {
    where: { status: 'DRAFT' },
    orderBy: { versionNo: 'desc' as const },
    take: 1,
    select: versionSelect,
  },
} as const;

type HolidayCalendarVersionRecord = Prisma.HolidayCalendarVersionGetPayload<{
  select: typeof versionSelect;
}>;
type HolidayCalendarRecord = Prisma.HolidayCalendarGetPayload<{ select: typeof calendarSelect }>;

function databaseContext(context: RequestContext, transition = false) {
  return requestDatabaseContext(
    context,
    ...(transition ? (['holiday-calendar-transition'] as const) : []),
  );
}

function formatDateTime(value: Date): string {
  return value.toISOString();
}

function periodsOverlap(aFrom: Date, aTo: Date | null, bFrom: Date, bTo: Date | null): boolean {
  const aEnd = aTo?.getTime() ?? Number.POSITIVE_INFINITY;
  const bEnd = bTo?.getTime() ?? Number.POSITIVE_INFINITY;
  return aFrom.getTime() <= bEnd && bFrom.getTime() <= aEnd;
}

function entrySummary(
  record: HolidayCalendarVersionRecord['entries'][number],
): HolidayCalendarEntrySummary {
  return {
    id: record.id,
    holidayDate: formatDate(record.holidayDate),
    name: record.name,
    dayType: record.dayType as HolidayDayType,
    sourceReference: record.sourceReference,
    rowVersion: record.rowVersion,
  };
}

function versionSummary(record: HolidayCalendarVersionRecord): HolidayCalendarVersionSummary {
  return {
    id: record.id,
    holidayCalendarId: record.holidayCalendarId,
    versionNo: record.versionNo,
    authorityDocumentVersionId: record.authorityDocumentVersionId,
    approvingAuthority: record.approvingAuthority,
    versionState: record.status as HolidayCalendarVersionState,
    effectiveFrom: formatDate(record.effectiveFrom),
    effectiveTo: record.effectiveTo ? formatDate(record.effectiveTo) : null,
    activatedAt: record.activatedAt ? formatDateTime(record.activatedAt) : null,
    entries: record.entries.map(entrySummary),
    rowVersion: record.rowVersion,
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt),
  };
}

function calendarSummary(
  record: HolidayCalendarRecord,
  currentVersion: HolidayCalendarVersionRecord | null,
): HolidayCalendarSummary {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    scopeType: record.scopeType as HolidayCalendarScopeType,
    scopeReference: record.scopeReference,
    currentVersion: currentVersion ? versionSummary(currentVersion) : null,
    draft: record.versions[0] ? versionSummary(record.versions[0]) : null,
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt),
  };
}

function auditVersionData(value: HolidayCalendarVersionSummary): Prisma.InputJsonObject {
  return {
    versionId: value.id,
    versionNo: value.versionNo,
    versionState: value.versionState,
    effectiveFrom: value.effectiveFrom,
    effectiveTo: value.effectiveTo,
    entryCount: value.entries.length,
  };
}

function entryWriteData(entry: HolidayCalendarVersionDefinition['entries'][number]) {
  return {
    holidayDate: toDatabaseDate(entry.holidayDate),
    name: entry.name,
    dayType: entry.dayType,
    sourceReference: entry.sourceReference,
  };
}

@Injectable()
export class HolidayCalendarsService {
  constructor(
    @Inject(ATTENDANCE_CONFIGURATION_AUDIT_WRITER)
    private readonly auditWriter: AttendanceConfigurationAuditWriter,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
  ) {}

  async list(context: RequestContext): Promise<HolidayCalendarSummary[]> {
    this.assertPermission(
      context,
      'attendance.configuration.read',
      'HOLIDAY_CALENDAR_READ_FORBIDDEN',
    );
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const records = await transaction.holidayCalendar.findMany({
        where: { agencyId: context.agencyId },
        orderBy: [{ code: 'asc' }],
        select: calendarSelect,
      });
      const current = await this.currentPublishedForCalendars(
        transaction,
        context.agencyId,
        records.map((record) => record.id),
      );
      return records.map((record) => calendarSummary(record, current.get(record.id) ?? null));
    });
  }

  async findById(
    context: RequestContext,
    holidayCalendarId: string,
    asOfValue = manilaToday(),
  ): Promise<HolidayCalendarDetail | null> {
    this.assertPermission(
      context,
      'attendance.configuration.read',
      'HOLIDAY_CALENDAR_READ_FORBIDDEN',
    );
    const asOf = toDatabaseDate(asOfValue);
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const record = await transaction.holidayCalendar.findFirst({
        where: { id: holidayCalendarId, agencyId: context.agencyId },
        select: {
          ...calendarSelect,
          versions: {
            orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
            select: versionSelect,
          },
        },
      });
      if (!record) return null;
      const draft = record.versions.find((version) => version.status === 'DRAFT') ?? null;
      const effective = await this.currentPublished(
        transaction,
        context.agencyId,
        holidayCalendarId,
        asOf,
      );
      const current = await this.currentPublished(
        transaction,
        context.agencyId,
        holidayCalendarId,
        toDatabaseDate(manilaToday()),
      );
      const events = await transaction.auditEvent.findMany({
        where: {
          agencyId: context.agencyId,
          entityType: 'HolidayCalendar',
          entityId: holidayCalendarId,
          action: { startsWith: 'HOLIDAY_CALENDAR_' },
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
        calendar: calendarSummary({ ...record, versions: draft ? [draft] : [] }, current),
        asOf: asOfValue,
        effective: effective ? versionSummary(effective) : null,
        versions: record.versions.map(versionSummary),
        history: events.map((event) => ({
          id: event.id,
          action: event.action,
          previousStatus: event.previousStatus,
          newStatus: event.newStatus,
          reason: event.reason,
          effectiveDate: this.metadataString(event.metadata, 'effectiveDate'),
          occurredAt: formatDateTime(event.occurredAt),
        })),
      };
    });
  }

  async create(
    context: RequestContext,
    rawInput: CreateHolidayCalendarInput,
  ): Promise<HolidayCalendarSummary> {
    this.assertPermission(
      context,
      'attendance.configuration.manage',
      'HOLIDAY_CALENDAR_MANAGE_FORBIDDEN',
    );
    const code = rawInput.code.trim();
    const name = rawInput.name.trim();
    const scopeReference = rawInput.scopeReference.trim();
    if (!code) throw this.invalidInput('A Holiday Calendar code is required.');
    if (!name) throw this.invalidInput('A Holiday Calendar name is required.');
    if (!scopeReference) {
      throw this.invalidInput('A Holiday Calendar scope reference is required.');
    }
    if (!(HOLIDAY_CALENDAR_SCOPE_TYPES as readonly string[]).includes(rawInput.scopeType)) {
      throw this.invalidInput('A Holiday Calendar uses a supported scope type.');
    }
    const definition = normalizeHolidayCalendarDefinition(rawInput);
    try {
      return await withDatabaseContext(databaseContext(context), async (transaction) => {
        const calendar = await transaction.holidayCalendar.create({
          data: {
            agencyId: context.agencyId,
            code,
            name,
            scopeType: rawInput.scopeType,
            scopeReference,
          },
        });
        const version = await transaction.holidayCalendarVersion.create({
          data: {
            agencyId: context.agencyId,
            holidayCalendarId: calendar.id,
            versionNo: 1,
            effectiveFrom: toDatabaseDate(definition.effectiveDate),
            status: 'DRAFT',
          },
          select: { id: true },
        });
        await this.writeEntries(transaction, context.agencyId, version.id, definition.entries);
        const result = await this.calendarRecord(transaction, context.agencyId, calendar.id);
        if (!result) throw this.notFound();
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'HOLIDAY_CALENDAR_CREATED',
          entityType: 'HolidayCalendar',
          entityId: calendar.id,
          previousStatus: 'None',
          newStatus: 'DRAFT',
          requestId: context.requestId,
          metadata: {
            code,
            name,
            scopeType: rawInput.scopeType,
            scopeReference,
            versionNo: 1,
            effectiveDate: definition.effectiveDate,
            entryCount: definition.entries.length,
          },
        });
        return calendarSummary(result, null);
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.codeConflict();
      }
      throw error;
    }
  }

  async createSuccessor(
    context: RequestContext,
    holidayCalendarId: string,
  ): Promise<HolidayCalendarSuccessor> {
    this.assertPermission(
      context,
      'attendance.configuration.manage',
      'HOLIDAY_CALENDAR_MANAGE_FORBIDDEN',
    );
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      await this.lockCalendar(transaction, context.agencyId, holidayCalendarId);
      const current = await this.latestPublished(transaction, context.agencyId, holidayCalendarId);
      if (!current) throw this.successorNotAllowed();
      const existingDraft = await transaction.holidayCalendarVersion.findFirst({
        where: { agencyId: context.agencyId, holidayCalendarId, status: 'DRAFT' },
        select: versionSelect,
      });
      if (existingDraft) {
        return { current: versionSummary(current), draft: versionSummary(existingDraft) };
      }
      const latest = await transaction.holidayCalendarVersion.findFirst({
        where: { agencyId: context.agencyId, holidayCalendarId },
        orderBy: { versionNo: 'desc' },
        select: { versionNo: true },
      });
      const effectiveFrom = new Date(
        Math.max(
          addDays(current.effectiveFrom, 1).getTime(),
          addDays(toDatabaseDate(manilaToday()), 1).getTime(),
        ),
      );
      const draft = await transaction.holidayCalendarVersion.create({
        data: {
          agencyId: context.agencyId,
          holidayCalendarId,
          versionNo: (latest?.versionNo ?? current.versionNo) + 1,
          effectiveFrom,
          status: 'DRAFT',
        },
        select: { id: true },
      });
      for (const entry of current.entries) {
        await transaction.holidayCalendarEntry.create({
          data: {
            agencyId: context.agencyId,
            holidayCalendarVersionId: draft.id,
            holidayDate: entry.holidayDate,
            name: entry.name,
            dayType: entry.dayType,
            sourceReference: entry.sourceReference,
          },
        });
      }
      const result = await transaction.holidayCalendarVersion.findFirstOrThrow({
        where: { id: draft.id, agencyId: context.agencyId },
        select: versionSelect,
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'HOLIDAY_CALENDAR_SUCCESSOR_CREATED',
        entityType: 'HolidayCalendar',
        entityId: holidayCalendarId,
        previousStatus: current.status,
        newStatus: 'DRAFT',
        requestId: context.requestId,
        metadata: {
          predecessorId: current.id,
          versionId: result.id,
          effectiveDate: formatDate(effectiveFrom),
          entryCount: result.entries.length,
        },
      });
      return { current: versionSummary(current), draft: versionSummary(result) };
    });
  }

  async updateDraft(
    context: RequestContext,
    holidayCalendarId: string,
    draftId: string,
    rawInput: UpdateHolidayCalendarDraftInput,
  ): Promise<HolidayCalendarVersionSummary> {
    this.assertPermission(
      context,
      'attendance.configuration.manage',
      'HOLIDAY_CALENDAR_MANAGE_FORBIDDEN',
    );
    const definition = normalizeHolidayCalendarDefinition(rawInput);
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      await this.lockCalendar(transaction, context.agencyId, holidayCalendarId);
      const draft = await transaction.holidayCalendarVersion.findFirst({
        where: {
          id: draftId,
          agencyId: context.agencyId,
          holidayCalendarId,
          status: 'DRAFT',
        },
        select: versionSelect,
      });
      if (!draft) throw this.draftNotFound();
      const updated = await transaction.holidayCalendarVersion.updateMany({
        where: {
          id: draftId,
          agencyId: context.agencyId,
          status: 'DRAFT',
          ...(rawInput.rowVersion === undefined ? {} : { rowVersion: rawInput.rowVersion }),
        },
        data: { effectiveFrom: toDatabaseDate(definition.effectiveDate) },
      });
      if (updated.count !== 1) throw this.draftConflict();
      await transaction.holidayCalendarEntry.deleteMany({
        where: { agencyId: context.agencyId, holidayCalendarVersionId: draftId },
      });
      await this.writeEntries(transaction, context.agencyId, draftId, definition.entries);
      const result = await transaction.holidayCalendarVersion.findFirstOrThrow({
        where: { id: draftId, agencyId: context.agencyId },
        select: versionSelect,
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'HOLIDAY_CALENDAR_DRAFT_UPDATED',
        entityType: 'HolidayCalendar',
        entityId: holidayCalendarId,
        previousStatus: 'DRAFT',
        newStatus: 'DRAFT',
        requestId: context.requestId,
        metadata: {
          before: auditVersionData(versionSummary(draft)),
          after: auditVersionData(versionSummary(result)),
        },
      });
      return versionSummary(result);
    });
  }

  async activate(
    context: RequestContext,
    holidayCalendarId: string,
    draftId: string,
    input: ActivateAttendanceConfigurationInput,
    rawIdempotencyKey?: string,
  ): Promise<HolidayCalendarSummary> {
    this.assertPermission(
      context,
      'attendance.configuration.activate',
      'HOLIDAY_CALENDAR_ACTIVATE_FORBIDDEN',
    );
    const reason = input.reason.trim();
    if (!reason) throw this.activationReasonRequired();
    const approvingAuthority = input.approvingAuthority.trim();
    if (!approvingAuthority) throw this.approvingAuthorityRequired();
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockCalendar(transaction, context.agencyId, holidayCalendarId);
      if (idempotencyKey) {
        const completed = await transaction.auditEvent.findFirst({
          where: {
            agencyId: context.agencyId,
            action: 'HOLIDAY_CALENDAR_VERSION_ACTIVATED',
            entityId: holidayCalendarId,
            idempotencyKey,
          },
          select: { reason: true, metadata: true },
        });
        if (completed) {
          if (
            completed.reason !== reason ||
            this.metadataString(completed.metadata, 'versionId') !== draftId
          ) {
            throw this.idempotencyConflict();
          }
          const existing = await this.calendarRecord(
            transaction,
            context.agencyId,
            holidayCalendarId,
          );
          if (!existing) throw this.idempotencyConflict();
          const current = await this.currentPublished(
            transaction,
            context.agencyId,
            holidayCalendarId,
            toDatabaseDate(manilaToday()),
          );
          return calendarSummary(existing, current);
        }
      }
      const draft = await transaction.holidayCalendarVersion.findFirst({
        where: {
          id: draftId,
          agencyId: context.agencyId,
          holidayCalendarId,
          status: 'DRAFT',
        },
        select: versionSelect,
      });
      if (!draft) throw this.draftNotFound();
      if (draft.entries.length === 0) throw this.entriesRequired();
      const evidence = await this.documentsService.resolveFinalizedVersionInTransaction(
        transaction,
        { agencyId: context.agencyId },
        input.authorityDocumentVersionId,
      );
      if (!evidence) throw this.evidenceRequired();
      const published = await transaction.holidayCalendarVersion.findMany({
        where: {
          agencyId: context.agencyId,
          holidayCalendarId,
          status: { in: ['ACTIVE', 'SUPERSEDED'] },
        },
        select: { id: true, effectiveFrom: true, effectiveTo: true, status: true, versionNo: true },
      });
      const predecessor = published
        .filter((version) => version.effectiveFrom < draft.effectiveFrom)
        .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
      if (published.length > 0 && !predecessor) throw this.periodOverlap();
      if (predecessor && predecessor.status !== 'ACTIVE') throw this.predecessorInvalid();
      if (
        predecessor?.effectiveTo &&
        predecessor.effectiveTo.getTime() !== addDays(draft.effectiveFrom, -1).getTime()
      ) {
        throw this.predecessorInvalid();
      }
      if (predecessor && draft.effectiveFrom <= toDatabaseDate(manilaToday())) {
        throw this.prospectiveRequired();
      }
      if (
        published.some(
          (version) =>
            version.id !== predecessor?.id &&
            periodsOverlap(
              version.effectiveFrom,
              version.effectiveTo,
              draft.effectiveFrom,
              draft.effectiveTo,
            ),
        )
      ) {
        throw this.periodOverlap();
      }
      if (predecessor) {
        await transaction.holidayCalendarVersion.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: predecessor.id } },
          data: { status: 'SUPERSEDED', effectiveTo: addDays(draft.effectiveFrom, -1) },
        });
      }
      await transaction.holidayCalendarVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: draft.id } },
        data: {
          status: 'ACTIVE',
          effectiveTo: null,
          authorityDocumentVersionId: evidence.id,
          approvingAuthority,
          activatedByMembershipId: context.membershipId,
          activatedAt: new Date(),
        },
      });
      await this.refreshCurrentProjection(transaction, context.agencyId, holidayCalendarId);
      const result = await this.calendarRecord(transaction, context.agencyId, holidayCalendarId);
      if (!result) throw this.notFound();
      const current = await this.currentPublished(
        transaction,
        context.agencyId,
        holidayCalendarId,
        toDatabaseDate(manilaToday()),
      );
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'HOLIDAY_CALENDAR_VERSION_ACTIVATED',
        entityType: 'HolidayCalendar',
        entityId: holidayCalendarId,
        previousStatus: predecessor?.status ?? 'DRAFT',
        newStatus: 'ACTIVE',
        reason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          versionId: draft.id,
          predecessorId: predecessor?.id ?? null,
          effectiveDate: formatDate(draft.effectiveFrom),
          approvingAuthority,
          authorityDocumentVersionId: evidence.id,
          after: auditVersionData(versionSummary(current ?? draft)),
        },
      });
      return calendarSummary(result, current);
    });
  }

  /**
   * Resolve the one published Holiday Calendar Version effective on a Work Date.
   * Callers decide how a missing or ambiguous version becomes a blocking
   * Attendance Exception; this method returns candidates without assuming one.
   */
  async findPublishedCandidates(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    holidayCalendarId: string,
    asOf: Date,
  ): Promise<HolidayCalendarVersionSummary[]> {
    const records = await this.findPublishedVersionRecords(
      transaction,
      agencyId,
      holidayCalendarId,
      asOf,
    );
    return records.map(versionSummary);
  }

  private async findPublishedVersionRecords(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    holidayCalendarId: string,
    asOf: Date,
  ): Promise<HolidayCalendarVersionRecord[]> {
    return transaction.holidayCalendarVersion.findMany({
      where: {
        agencyId,
        holidayCalendarId,
        status: { in: ['ACTIVE', 'SUPERSEDED'] },
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: versionSelect,
    });
  }

  private async writeEntries(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    versionId: string,
    entries: HolidayCalendarVersionDefinition['entries'],
  ): Promise<void> {
    for (const entry of entries) {
      await transaction.holidayCalendarEntry.create({
        data: {
          agencyId,
          holidayCalendarVersionId: versionId,
          ...entryWriteData(entry),
        },
      });
    }
  }

  private async calendarRecord(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    holidayCalendarId: string,
  ): Promise<HolidayCalendarRecord | null> {
    return transaction.holidayCalendar.findFirst({
      where: { id: holidayCalendarId, agencyId },
      select: calendarSelect,
    });
  }

  private async latestPublished(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    holidayCalendarId: string,
  ): Promise<HolidayCalendarVersionRecord | null> {
    return transaction.holidayCalendarVersion.findFirst({
      where: { agencyId, holidayCalendarId, status: { in: ['ACTIVE', 'SUPERSEDED'] } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: versionSelect,
    });
  }

  private async currentPublishedForCalendars(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    holidayCalendarIds: string[],
  ): Promise<Map<string, HolidayCalendarVersionRecord>> {
    if (holidayCalendarIds.length === 0) return new Map();
    const today = toDatabaseDate(manilaToday());
    const candidates = await transaction.holidayCalendarVersion.findMany({
      where: {
        agencyId,
        holidayCalendarId: { in: holidayCalendarIds },
        status: { in: ['ACTIVE', 'SUPERSEDED'] },
        effectiveFrom: { lte: today },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: { id: true, holidayCalendarId: true },
    });
    const chosen = new Map<string, string>();
    for (const candidate of candidates) {
      if (!chosen.has(candidate.holidayCalendarId)) {
        chosen.set(candidate.holidayCalendarId, candidate.id);
      }
    }
    if (chosen.size === 0) return new Map();
    const versions = await transaction.holidayCalendarVersion.findMany({
      where: { id: { in: [...chosen.values()] } },
      select: versionSelect,
    });
    return new Map(versions.map((version) => [version.holidayCalendarId, version]));
  }

  private async currentPublished(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    holidayCalendarId: string,
    asOf: Date,
  ): Promise<HolidayCalendarVersionRecord | null> {
    return transaction.holidayCalendarVersion.findFirst({
      where: {
        agencyId,
        holidayCalendarId,
        status: { in: ['ACTIVE', 'SUPERSEDED'] },
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: versionSelect,
    });
  }

  private async refreshCurrentProjection(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    holidayCalendarId: string,
  ): Promise<void> {
    const current = await this.currentPublished(
      transaction,
      agencyId,
      holidayCalendarId,
      toDatabaseDate(manilaToday()),
    );
    await transaction.holidayCalendar.update({
      where: { agencyId_id: { agencyId, id: holidayCalendarId } },
      data: { currentVersionId: current?.id ?? null },
    });
  }

  private async lockCalendar(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    holidayCalendarId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "holiday_calendars" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${holidayCalendarId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) throw this.notFound();
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (
      !context.agencyId ||
      !context.userId ||
      !context.membershipId ||
      !hasPermission(context, permission, { agencyId: context.agencyId })
    ) {
      throw new AttendanceConfigurationServiceError(
        'The current Agency Membership lacks the required permission.',
        403,
        code,
      );
    }
  }

  private metadataString(value: Prisma.JsonValue, key: string): string | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const item = value[key];
    return typeof item === 'string' ? item : null;
  }

  private invalidInput(message: string): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      message,
      400,
      'ATTENDANCE_CONFIGURATION_INVALID_INPUT',
    );
  }

  private codeConflict(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'A Holiday Calendar with this Agency code already exists.',
      409,
      'HOLIDAY_CALENDAR_CODE_CONFLICT',
    );
  }

  private notFound(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The Holiday Calendar could not be found.',
      404,
      'HOLIDAY_CALENDAR_NOT_FOUND',
    );
  }

  private draftNotFound(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The Draft Holiday Calendar Version could not be found.',
      404,
      'HOLIDAY_CALENDAR_DRAFT_NOT_FOUND',
    );
  }

  private draftConflict(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The Draft Holiday Calendar Version changed. Reload and try again.',
      409,
      'HOLIDAY_CALENDAR_DRAFT_CONFLICT',
    );
  }

  private successorNotAllowed(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'Only an activated Holiday Calendar can have a successor.',
      409,
      'HOLIDAY_CALENDAR_SUCCESSOR_NOT_ALLOWED',
    );
  }

  private predecessorInvalid(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The successor date does not follow the current Holiday Calendar period.',
      409,
      'HOLIDAY_CALENDAR_PREDECESSOR_INVALID',
    );
  }

  private prospectiveRequired(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'An activated successor Holiday Calendar Version must take effect after today to preserve prior history.',
      409,
      'HOLIDAY_CALENDAR_PROSPECTIVE_REQUIRED',
    );
  }

  private periodOverlap(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'Holiday Calendar effective periods cannot overlap.',
      409,
      'HOLIDAY_CALENDAR_PERIOD_OVERLAP',
    );
  }

  private entriesRequired(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'A Holiday Calendar Version requires at least one categorized entry before activation.',
      409,
      'HOLIDAY_CALENDAR_ENTRIES_REQUIRED',
    );
  }

  private evidenceRequired(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'A finalized authority Document Version is required before activation.',
      409,
      'HOLIDAY_CALENDAR_EVIDENCE_REQUIRED',
    );
  }

  private approvingAuthorityRequired(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The approving authority is required before activation.',
      400,
      'HOLIDAY_CALENDAR_APPROVING_AUTHORITY_REQUIRED',
    );
  }

  private activationReasonRequired(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'A reason for Holiday Calendar activation is required.',
      400,
      'HOLIDAY_CALENDAR_ACTIVATION_REASON_REQUIRED',
    );
  }

  private idempotencyConflict(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The Idempotency-Key was already used for a different Holiday Calendar request.',
      409,
      'HOLIDAY_CALENDAR_IDEMPOTENCY_CONFLICT',
    );
  }
}
