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
  addDays,
  formatDate,
  inputJsonList,
  manilaToday,
  normalizeArrangementDefinition,
  toDatabaseDate,
  WORK_SCHEDULE_TYPES,
  type ActivateAttendanceConfigurationInput,
  type CreateWorkArrangementInput,
  type UpdateWorkArrangementDraftInput,
  type WorkArrangementType,
  type WorkArrangementVersionState,
  type WorkScheduleType,
} from './attendance-configuration.types';

export interface WorkArrangementVersionSummary {
  id: string;
  workArrangementId: string;
  versionNo: number;
  arrangementType: WorkArrangementType;
  permittedScheduleTypes: WorkScheduleType[];
  holidayCalendarId: string;
  authorityDocumentVersionId: string | null;
  approvingAuthority: string | null;
  versionState: WorkArrangementVersionState;
  effectiveFrom: string;
  effectiveTo: string | null;
  activatedAt: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkArrangementSummary {
  id: string;
  code: string;
  name: string;
  currentVersion: WorkArrangementVersionSummary | null;
  draft: WorkArrangementVersionSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkArrangementHistoryEntry {
  id: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  effectiveDate: string | null;
  occurredAt: string;
}

export interface WorkArrangementDetail {
  arrangement: WorkArrangementSummary;
  asOf: string;
  effective: WorkArrangementVersionSummary | null;
  versions: WorkArrangementVersionSummary[];
  history: WorkArrangementHistoryEntry[];
}

export interface WorkArrangementSuccessor {
  current: WorkArrangementVersionSummary;
  draft: WorkArrangementVersionSummary;
}

const versionSelect = {
  id: true,
  workArrangementId: true,
  versionNo: true,
  arrangementType: true,
  permittedScheduleTypes: true,
  holidayCalendarId: true,
  authorityDocumentVersionId: true,
  approvingAuthority: true,
  status: true,
  effectiveFrom: true,
  effectiveTo: true,
  activatedAt: true,
  rowVersion: true,
  createdAt: true,
  updatedAt: true,
} as const;

const arrangementSelect = {
  id: true,
  code: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  versions: {
    where: { status: 'DRAFT' },
    orderBy: { versionNo: 'desc' as const },
    take: 1,
    select: versionSelect,
  },
} as const;

type WorkArrangementVersionRecord = Prisma.WorkArrangementVersionGetPayload<{
  select: typeof versionSelect;
}>;
type WorkArrangementRecord = Prisma.WorkArrangementGetPayload<{
  select: typeof arrangementSelect;
}>;

function databaseContext(context: RequestContext, transition = false) {
  return requestDatabaseContext(
    context,
    ...(transition ? (['work-arrangement-transition'] as const) : []),
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

function permittedTypes(value: Prisma.JsonValue): WorkScheduleType[] {
  return inputJsonList(value).filter(
    (item): item is WorkScheduleType =>
      typeof item === 'string' && (WORK_SCHEDULE_TYPES as readonly string[]).includes(item),
  );
}

function versionSummary(record: WorkArrangementVersionRecord): WorkArrangementVersionSummary {
  return {
    id: record.id,
    workArrangementId: record.workArrangementId,
    versionNo: record.versionNo,
    arrangementType: record.arrangementType as WorkArrangementType,
    permittedScheduleTypes: permittedTypes(record.permittedScheduleTypes),
    holidayCalendarId: record.holidayCalendarId,
    authorityDocumentVersionId: record.authorityDocumentVersionId,
    approvingAuthority: record.approvingAuthority,
    versionState: record.status as WorkArrangementVersionState,
    effectiveFrom: formatDate(record.effectiveFrom),
    effectiveTo: record.effectiveTo ? formatDate(record.effectiveTo) : null,
    activatedAt: record.activatedAt ? formatDateTime(record.activatedAt) : null,
    rowVersion: record.rowVersion,
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt),
  };
}

function arrangementSummary(
  record: WorkArrangementRecord,
  currentVersion: WorkArrangementVersionRecord | null,
): WorkArrangementSummary {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    currentVersion: currentVersion ? versionSummary(currentVersion) : null,
    draft: record.versions[0] ? versionSummary(record.versions[0]) : null,
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt),
  };
}

function auditVersionData(value: WorkArrangementVersionSummary): Prisma.InputJsonObject {
  return {
    versionId: value.id,
    versionNo: value.versionNo,
    arrangementType: value.arrangementType,
    permittedScheduleTypes: value.permittedScheduleTypes,
    holidayCalendarId: value.holidayCalendarId,
    versionState: value.versionState,
    effectiveFrom: value.effectiveFrom,
    effectiveTo: value.effectiveTo,
  };
}

@Injectable()
export class WorkArrangementsService {
  constructor(
    @Inject(ATTENDANCE_CONFIGURATION_AUDIT_WRITER)
    private readonly auditWriter: AttendanceConfigurationAuditWriter,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
  ) {}

  async list(context: RequestContext): Promise<WorkArrangementSummary[]> {
    this.assertPermission(
      context,
      'attendance.configuration.read',
      'ATTENDANCE_CONFIGURATION_READ_FORBIDDEN',
    );
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const records = await transaction.workArrangement.findMany({
        where: { agencyId: context.agencyId },
        orderBy: [{ code: 'asc' }],
        select: arrangementSelect,
      });
      const current = await this.currentPublishedForArrangements(
        transaction,
        context.agencyId,
        records.map((record) => record.id),
      );
      return records.map((record) => arrangementSummary(record, current.get(record.id) ?? null));
    });
  }

  async findById(
    context: RequestContext,
    workArrangementId: string,
    asOfValue = manilaToday(),
  ): Promise<WorkArrangementDetail | null> {
    this.assertPermission(
      context,
      'attendance.configuration.read',
      'ATTENDANCE_CONFIGURATION_READ_FORBIDDEN',
    );
    const asOf = toDatabaseDate(asOfValue);
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const record = await transaction.workArrangement.findFirst({
        where: { id: workArrangementId, agencyId: context.agencyId },
        select: {
          ...arrangementSelect,
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
        workArrangementId,
        asOf,
      );
      const current = await this.currentPublished(
        transaction,
        context.agencyId,
        workArrangementId,
        toDatabaseDate(manilaToday()),
      );
      const events = await transaction.auditEvent.findMany({
        where: {
          agencyId: context.agencyId,
          entityType: 'WorkArrangement',
          entityId: workArrangementId,
          action: { startsWith: 'WORK_ARRANGEMENT_' },
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
        arrangement: arrangementSummary({ ...record, versions: draft ? [draft] : [] }, current),
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
    rawInput: CreateWorkArrangementInput,
  ): Promise<WorkArrangementSummary> {
    this.assertPermission(
      context,
      'attendance.configuration.manage',
      'WORK_ARRANGEMENT_MANAGE_FORBIDDEN',
    );
    const code = rawInput.code.trim();
    const name = rawInput.name.trim();
    if (!code) throw this.invalidInput('A Work Arrangement code is required.');
    if (!name) throw this.invalidInput('A Work Arrangement name is required.');
    const definition = normalizeArrangementDefinition(rawInput);
    try {
      return await withDatabaseContext(databaseContext(context), async (transaction) => {
        await this.assertHolidayCalendar(
          transaction,
          context.agencyId,
          definition.holidayCalendarId,
        );
        const arrangement = await transaction.workArrangement.create({
          data: { agencyId: context.agencyId, code, name },
        });
        await transaction.workArrangementVersion.create({
          data: {
            agencyId: context.agencyId,
            workArrangementId: arrangement.id,
            versionNo: 1,
            arrangementType: definition.arrangementType,
            permittedScheduleTypes: definition.permittedScheduleTypes,
            holidayCalendarId: definition.holidayCalendarId,
            effectiveFrom: toDatabaseDate(definition.effectiveDate),
            status: 'DRAFT',
          },
        });
        const result = await this.arrangementRecord(transaction, context.agencyId, arrangement.id);
        if (!result) throw this.notFound();
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'WORK_ARRANGEMENT_CREATED',
          entityType: 'WorkArrangement',
          entityId: arrangement.id,
          previousStatus: 'None',
          newStatus: 'DRAFT',
          requestId: context.requestId,
          metadata: {
            code,
            name,
            versionNo: 1,
            effectiveDate: definition.effectiveDate,
            arrangementType: definition.arrangementType,
          },
        });
        return arrangementSummary(result, null);
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
    workArrangementId: string,
  ): Promise<WorkArrangementSuccessor> {
    this.assertPermission(
      context,
      'attendance.configuration.manage',
      'WORK_ARRANGEMENT_MANAGE_FORBIDDEN',
    );
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      await this.lockArrangement(transaction, context.agencyId, workArrangementId);
      const current = await this.latestPublished(transaction, context.agencyId, workArrangementId);
      if (!current) throw this.successorNotAllowed();
      const existingDraft = await transaction.workArrangementVersion.findFirst({
        where: { agencyId: context.agencyId, workArrangementId, status: 'DRAFT' },
        select: versionSelect,
      });
      if (existingDraft) {
        return { current: versionSummary(current), draft: versionSummary(existingDraft) };
      }
      const latest = await transaction.workArrangementVersion.findFirst({
        where: { agencyId: context.agencyId, workArrangementId },
        orderBy: { versionNo: 'desc' },
        select: { versionNo: true },
      });
      const effectiveFrom = new Date(
        Math.max(
          addDays(current.effectiveFrom, 1).getTime(),
          addDays(toDatabaseDate(manilaToday()), 1).getTime(),
        ),
      );
      const draft = await transaction.workArrangementVersion.create({
        data: {
          agencyId: context.agencyId,
          workArrangementId,
          versionNo: (latest?.versionNo ?? current.versionNo) + 1,
          arrangementType: current.arrangementType,
          permittedScheduleTypes: permittedTypes(current.permittedScheduleTypes),
          holidayCalendarId: current.holidayCalendarId,
          effectiveFrom,
          status: 'DRAFT',
        },
        select: versionSelect,
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'WORK_ARRANGEMENT_SUCCESSOR_CREATED',
        entityType: 'WorkArrangement',
        entityId: workArrangementId,
        previousStatus: current.status,
        newStatus: 'DRAFT',
        requestId: context.requestId,
        metadata: {
          predecessorId: current.id,
          versionId: draft.id,
          effectiveDate: formatDate(effectiveFrom),
        },
      });
      return { current: versionSummary(current), draft: versionSummary(draft) };
    });
  }

  async updateDraft(
    context: RequestContext,
    workArrangementId: string,
    draftId: string,
    rawInput: UpdateWorkArrangementDraftInput,
  ): Promise<WorkArrangementVersionSummary> {
    this.assertPermission(
      context,
      'attendance.configuration.manage',
      'WORK_ARRANGEMENT_MANAGE_FORBIDDEN',
    );
    const definition = normalizeArrangementDefinition(rawInput);
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      await this.lockArrangement(transaction, context.agencyId, workArrangementId);
      const draft = await transaction.workArrangementVersion.findFirst({
        where: {
          id: draftId,
          agencyId: context.agencyId,
          workArrangementId,
          status: 'DRAFT',
        },
        select: versionSelect,
      });
      if (!draft) throw this.draftNotFound();
      await this.assertHolidayCalendar(transaction, context.agencyId, definition.holidayCalendarId);
      const updated = await transaction.workArrangementVersion.updateMany({
        where: {
          id: draftId,
          agencyId: context.agencyId,
          status: 'DRAFT',
          ...(rawInput.rowVersion === undefined ? {} : { rowVersion: rawInput.rowVersion }),
        },
        data: {
          arrangementType: definition.arrangementType,
          permittedScheduleTypes: definition.permittedScheduleTypes,
          holidayCalendarId: definition.holidayCalendarId,
          effectiveFrom: toDatabaseDate(definition.effectiveDate),
        },
      });
      if (updated.count !== 1) throw this.draftConflict();
      const result = await transaction.workArrangementVersion.findFirstOrThrow({
        where: { id: draftId, agencyId: context.agencyId },
        select: versionSelect,
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'WORK_ARRANGEMENT_DRAFT_UPDATED',
        entityType: 'WorkArrangement',
        entityId: workArrangementId,
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
    workArrangementId: string,
    draftId: string,
    input: ActivateAttendanceConfigurationInput,
    rawIdempotencyKey?: string,
  ): Promise<WorkArrangementSummary> {
    this.assertPermission(
      context,
      'attendance.configuration.activate',
      'WORK_ARRANGEMENT_ACTIVATE_FORBIDDEN',
    );
    const reason = input.reason.trim();
    if (!reason) throw this.activationReasonRequired();
    const approvingAuthority = input.approvingAuthority.trim();
    if (!approvingAuthority) throw this.approvingAuthorityRequired();
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockArrangement(transaction, context.agencyId, workArrangementId);
      if (idempotencyKey) {
        const completed = await transaction.auditEvent.findFirst({
          where: {
            agencyId: context.agencyId,
            action: 'WORK_ARRANGEMENT_VERSION_ACTIVATED',
            entityId: workArrangementId,
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
          const existing = await this.arrangementRecord(
            transaction,
            context.agencyId,
            workArrangementId,
          );
          if (!existing) throw this.idempotencyConflict();
          const current = await this.currentPublished(
            transaction,
            context.agencyId,
            workArrangementId,
            toDatabaseDate(manilaToday()),
          );
          return arrangementSummary(existing, current);
        }
      }
      const draft = await transaction.workArrangementVersion.findFirst({
        where: {
          id: draftId,
          agencyId: context.agencyId,
          workArrangementId,
          status: 'DRAFT',
        },
        select: versionSelect,
      });
      if (!draft) throw this.draftNotFound();
      await this.assertHolidayCalendar(transaction, context.agencyId, draft.holidayCalendarId);
      if (permittedTypes(draft.permittedScheduleTypes).length === 0) {
        throw this.invalidInput(
          'A Work Arrangement Version must permit at least one Work Schedule type.',
        );
      }
      const evidence = await this.documentsService.resolveFinalizedVersionInTransaction(
        transaction,
        { agencyId: context.agencyId },
        input.authorityDocumentVersionId,
      );
      if (!evidence) throw this.evidenceRequired();
      const published = await transaction.workArrangementVersion.findMany({
        where: {
          agencyId: context.agencyId,
          workArrangementId,
          status: { in: ['ACTIVE', 'SUPERSEDED'] },
        },
        select: { id: true, effectiveFrom: true, effectiveTo: true, status: true },
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
        await transaction.workArrangementVersion.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: predecessor.id } },
          data: { status: 'SUPERSEDED', effectiveTo: addDays(draft.effectiveFrom, -1) },
        });
      }
      await transaction.workArrangementVersion.update({
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
      await this.refreshCurrentProjection(transaction, context.agencyId, workArrangementId);
      const result = await this.arrangementRecord(transaction, context.agencyId, workArrangementId);
      if (!result) throw this.notFound();
      const current = await this.currentPublished(
        transaction,
        context.agencyId,
        workArrangementId,
        toDatabaseDate(manilaToday()),
      );
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'WORK_ARRANGEMENT_VERSION_ACTIVATED',
        entityType: 'WorkArrangement',
        entityId: workArrangementId,
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
      return arrangementSummary(result, current);
    });
  }

  /** Load one published Work Arrangement Version for calculation input resolution. */
  async findVersionInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    versionId: string,
    asOf: Date,
  ): Promise<WorkArrangementVersionSummary | null> {
    const record = await transaction.workArrangementVersion.findFirst({
      where: {
        agencyId,
        id: versionId,
        status: { in: ['ACTIVE', 'SUPERSEDED'] },
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
      },
      select: versionSelect,
    });
    return record ? versionSummary(record) : null;
  }

  private async assertHolidayCalendar(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    holidayCalendarId: string,
  ): Promise<void> {
    const calendar = await transaction.holidayCalendar.findFirst({
      where: { agencyId, id: holidayCalendarId },
      select: { id: true },
    });
    if (!calendar) {
      throw new AttendanceConfigurationServiceError(
        'The Work Arrangement Version must reference a Holiday Calendar in this Agency.',
        409,
        'WORK_ARRANGEMENT_HOLIDAY_CALENDAR_NOT_FOUND',
      );
    }
  }

  private async arrangementRecord(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    workArrangementId: string,
  ): Promise<WorkArrangementRecord | null> {
    return transaction.workArrangement.findFirst({
      where: { id: workArrangementId, agencyId },
      select: arrangementSelect,
    });
  }

  private async latestPublished(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    workArrangementId: string,
  ): Promise<WorkArrangementVersionRecord | null> {
    return transaction.workArrangementVersion.findFirst({
      where: { agencyId, workArrangementId, status: { in: ['ACTIVE', 'SUPERSEDED'] } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: versionSelect,
    });
  }

  private async currentPublishedForArrangements(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    workArrangementIds: string[],
  ): Promise<Map<string, WorkArrangementVersionRecord>> {
    if (workArrangementIds.length === 0) return new Map();
    const today = toDatabaseDate(manilaToday());
    const candidates = await transaction.workArrangementVersion.findMany({
      where: {
        agencyId,
        workArrangementId: { in: workArrangementIds },
        status: { in: ['ACTIVE', 'SUPERSEDED'] },
        effectiveFrom: { lte: today },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: { id: true, workArrangementId: true },
    });
    const chosen = new Map<string, string>();
    for (const candidate of candidates) {
      if (!chosen.has(candidate.workArrangementId)) {
        chosen.set(candidate.workArrangementId, candidate.id);
      }
    }
    if (chosen.size === 0) return new Map();
    const versions = await transaction.workArrangementVersion.findMany({
      where: { id: { in: [...chosen.values()] } },
      select: versionSelect,
    });
    return new Map(versions.map((version) => [version.workArrangementId, version]));
  }

  private async currentPublished(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    workArrangementId: string,
    asOf: Date,
  ): Promise<WorkArrangementVersionRecord | null> {
    return transaction.workArrangementVersion.findFirst({
      where: {
        agencyId,
        workArrangementId,
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
    workArrangementId: string,
  ): Promise<void> {
    const current = await this.currentPublished(
      transaction,
      agencyId,
      workArrangementId,
      toDatabaseDate(manilaToday()),
    );
    await transaction.workArrangement.update({
      where: { agencyId_id: { agencyId, id: workArrangementId } },
      data: { currentVersionId: current?.id ?? null },
    });
  }

  private async lockArrangement(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    workArrangementId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "work_arrangements" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${workArrangementId} AS uuid) FOR UPDATE`,
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
      'A Work Arrangement with this Agency code already exists.',
      409,
      'WORK_ARRANGEMENT_CODE_CONFLICT',
    );
  }

  private draftConflict(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The Draft Work Arrangement Version changed. Reload and try again.',
      409,
      'WORK_ARRANGEMENT_DRAFT_CONFLICT',
    );
  }

  private draftNotFound(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The Draft Work Arrangement Version could not be found.',
      404,
      'WORK_ARRANGEMENT_DRAFT_NOT_FOUND',
    );
  }

  private notFound(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The Work Arrangement could not be found.',
      404,
      'WORK_ARRANGEMENT_NOT_FOUND',
    );
  }

  private successorNotAllowed(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'Only an activated Work Arrangement can have a successor.',
      409,
      'WORK_ARRANGEMENT_SUCCESSOR_NOT_ALLOWED',
    );
  }

  private predecessorInvalid(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The successor date does not follow the current Work Arrangement period.',
      409,
      'WORK_ARRANGEMENT_PREDECESSOR_INVALID',
    );
  }

  private prospectiveRequired(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'An activated successor Work Arrangement Version must take effect after today to preserve prior history.',
      409,
      'WORK_ARRANGEMENT_PROSPECTIVE_REQUIRED',
    );
  }

  private periodOverlap(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'Work Arrangement effective periods cannot overlap.',
      409,
      'WORK_ARRANGEMENT_PERIOD_OVERLAP',
    );
  }

  private evidenceRequired(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'A finalized authority Document Version is required before activation.',
      409,
      'WORK_ARRANGEMENT_EVIDENCE_REQUIRED',
    );
  }

  private approvingAuthorityRequired(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The approving authority is required before activation.',
      400,
      'WORK_ARRANGEMENT_APPROVING_AUTHORITY_REQUIRED',
    );
  }

  private activationReasonRequired(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'A reason for Work Arrangement activation is required.',
      400,
      'WORK_ARRANGEMENT_ACTIVATION_REASON_REQUIRED',
    );
  }

  private idempotencyConflict(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The Idempotency-Key was already used for a different Work Arrangement request.',
      409,
      'WORK_ARRANGEMENT_IDEMPOTENCY_CONFLICT',
    );
  }
}
