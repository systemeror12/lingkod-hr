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
  fromTimeValue,
  manilaToday,
  normalizeDayRules,
  normalizeScheduleDefinition,
  timeColumn,
  timeValueOf,
  toDatabaseDate,
  type ActivateAttendanceConfigurationInput,
  type AttendanceConfigurationDayRuleInput,
  type CreateWorkScheduleInput,
  type DayRuleType,
  type EventPattern,
  type UpdateWorkScheduleDraftInput,
  type WorkScheduleType,
  type WorkScheduleVersionDefinition,
  type WorkScheduleVersionState,
} from './attendance-configuration.types';

export interface WorkScheduleBreakSummary {
  id: string;
  sequenceNo: number;
  breakStartTime: string;
  breakEndTime: string;
  endNextCalendarDay: boolean;
}

export interface WorkScheduleDayRuleSummary {
  id: string;
  weekday: number;
  ruleType: DayRuleType;
  dutyStartTime: string | null;
  earliestStartTime: string | null;
  latestStartTime: string | null;
  dutyEndTime: string | null;
  endNextCalendarDay: boolean;
  requiredMinutes: number;
  coreStartTime: string | null;
  coreEndTime: string | null;
  eventPattern: EventPattern;
  collectionBeforeMinutes: number;
  collectionAfterMinutes: number;
  breaks: WorkScheduleBreakSummary[];
}

export interface WorkScheduleVersionSummary {
  id: string;
  workScheduleId: string;
  versionNo: number;
  scheduleType: WorkScheduleType;
  timezone: string;
  authorityDocumentVersionId: string | null;
  approvingAuthority: string | null;
  versionState: WorkScheduleVersionState;
  effectiveFrom: string;
  effectiveTo: string | null;
  activatedAt: string | null;
  dayRules: WorkScheduleDayRuleSummary[];
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkScheduleSummary {
  id: string;
  code: string;
  name: string;
  currentVersion: WorkScheduleVersionSummary | null;
  draft: WorkScheduleVersionSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkScheduleHistoryEntry {
  id: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  effectiveDate: string | null;
  occurredAt: string;
}

export interface WorkScheduleDetail {
  schedule: WorkScheduleSummary;
  asOf: string;
  effective: WorkScheduleVersionSummary | null;
  versions: WorkScheduleVersionSummary[];
  history: WorkScheduleHistoryEntry[];
}

export interface WorkScheduleSuccessor {
  current: WorkScheduleVersionSummary;
  draft: WorkScheduleVersionSummary;
}

const breakSelect = {
  id: true,
  sequenceNo: true,
  breakStartTime: true,
  breakEndTime: true,
  endNextCalendarDay: true,
} as const;

const dayRuleSelect = {
  id: true,
  weekday: true,
  ruleType: true,
  dutyStartTime: true,
  earliestStartTime: true,
  latestStartTime: true,
  dutyEndTime: true,
  endNextCalendarDay: true,
  requiredMinutes: true,
  coreStartTime: true,
  coreEndTime: true,
  eventPattern: true,
  collectionBeforeMinutes: true,
  collectionAfterMinutes: true,
  breaks: { orderBy: { sequenceNo: 'asc' as const }, select: breakSelect },
} as const;

const versionSelect = {
  id: true,
  workScheduleId: true,
  versionNo: true,
  scheduleType: true,
  timezone: true,
  holidayEffectRules: true,
  authorityDocumentVersionId: true,
  approvingAuthority: true,
  status: true,
  effectiveFrom: true,
  effectiveTo: true,
  activatedAt: true,
  rowVersion: true,
  createdAt: true,
  updatedAt: true,
  dayRules: { orderBy: { weekday: 'asc' as const }, select: dayRuleSelect },
} as const;

const scheduleSelect = {
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

type WorkScheduleVersionRecord = Prisma.WorkScheduleVersionGetPayload<{
  select: typeof versionSelect;
}>;
type WorkScheduleRecord = Prisma.WorkScheduleGetPayload<{ select: typeof scheduleSelect }>;

function databaseContext(context: RequestContext, transition = false) {
  return requestDatabaseContext(
    context,
    ...(transition ? (['work-schedule-transition'] as const) : []),
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

function breakSummary(
  record: WorkScheduleVersionRecord['dayRules'][number]['breaks'][number],
): WorkScheduleBreakSummary {
  return {
    id: record.id,
    sequenceNo: record.sequenceNo,
    breakStartTime: fromTimeValue(record.breakStartTime),
    breakEndTime: fromTimeValue(record.breakEndTime),
    endNextCalendarDay: record.endNextCalendarDay,
  };
}

function dayRuleSummary(
  record: WorkScheduleVersionRecord['dayRules'][number],
): WorkScheduleDayRuleSummary {
  return {
    id: record.id,
    weekday: record.weekday,
    ruleType: record.ruleType as DayRuleType,
    dutyStartTime: record.dutyStartTime ? fromTimeValue(record.dutyStartTime) : null,
    earliestStartTime: record.earliestStartTime ? fromTimeValue(record.earliestStartTime) : null,
    latestStartTime: record.latestStartTime ? fromTimeValue(record.latestStartTime) : null,
    dutyEndTime: record.dutyEndTime ? fromTimeValue(record.dutyEndTime) : null,
    endNextCalendarDay: record.endNextCalendarDay,
    requiredMinutes: record.requiredMinutes,
    coreStartTime: record.coreStartTime ? fromTimeValue(record.coreStartTime) : null,
    coreEndTime: record.coreEndTime ? fromTimeValue(record.coreEndTime) : null,
    eventPattern: record.eventPattern as EventPattern,
    collectionBeforeMinutes: record.collectionBeforeMinutes,
    collectionAfterMinutes: record.collectionAfterMinutes,
    breaks: record.breaks.map(breakSummary),
  };
}

function versionSummary(record: WorkScheduleVersionRecord): WorkScheduleVersionSummary {
  return {
    id: record.id,
    workScheduleId: record.workScheduleId,
    versionNo: record.versionNo,
    scheduleType: record.scheduleType as WorkScheduleType,
    timezone: record.timezone,
    authorityDocumentVersionId: record.authorityDocumentVersionId,
    approvingAuthority: record.approvingAuthority,
    versionState: record.status as WorkScheduleVersionState,
    effectiveFrom: formatDate(record.effectiveFrom),
    effectiveTo: record.effectiveTo ? formatDate(record.effectiveTo) : null,
    activatedAt: record.activatedAt ? formatDateTime(record.activatedAt) : null,
    dayRules: record.dayRules.map(dayRuleSummary),
    rowVersion: record.rowVersion,
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt),
  };
}

function scheduleSummary(
  record: WorkScheduleRecord,
  currentVersion: WorkScheduleVersionRecord | null,
): WorkScheduleSummary {
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

function auditVersionData(value: WorkScheduleVersionSummary): Prisma.InputJsonObject {
  return {
    versionId: value.id,
    versionNo: value.versionNo,
    scheduleType: value.scheduleType,
    versionState: value.versionState,
    effectiveFrom: value.effectiveFrom,
    effectiveTo: value.effectiveTo,
    requiredMinuteTotal: value.dayRules.reduce((total, rule) => total + rule.requiredMinutes, 0),
    workingDayCount: value.dayRules.filter((rule) => rule.ruleType !== 'REST').length,
  };
}

function storedDayRuleInput(
  record: WorkScheduleVersionRecord['dayRules'][number],
): AttendanceConfigurationDayRuleInput {
  return {
    weekday: record.weekday,
    ruleType: record.ruleType as DayRuleType,
    dutyStartTime: record.dutyStartTime ? fromTimeValue(record.dutyStartTime) : null,
    earliestStartTime: record.earliestStartTime ? fromTimeValue(record.earliestStartTime) : null,
    latestStartTime: record.latestStartTime ? fromTimeValue(record.latestStartTime) : null,
    dutyEndTime: record.dutyEndTime ? fromTimeValue(record.dutyEndTime) : null,
    endNextCalendarDay: record.endNextCalendarDay,
    requiredMinutes: record.requiredMinutes,
    coreStartTime: record.coreStartTime ? fromTimeValue(record.coreStartTime) : null,
    coreEndTime: record.coreEndTime ? fromTimeValue(record.coreEndTime) : null,
    eventPattern: record.eventPattern as EventPattern,
    collectionBeforeMinutes: record.collectionBeforeMinutes,
    collectionAfterMinutes: record.collectionAfterMinutes,
    breaks: record.breaks.map((item) => ({
      breakStartTime: fromTimeValue(item.breakStartTime),
      breakEndTime: fromTimeValue(item.breakEndTime),
      endNextCalendarDay: item.endNextCalendarDay,
    })),
  };
}

function dayRuleWriteData(rule: WorkScheduleVersionDefinition['dayRules'][number]) {
  return {
    weekday: rule.weekday,
    ruleType: rule.ruleType,
    dutyStartTime: timeColumn(rule.dutyStartTime),
    earliestStartTime: timeColumn(rule.earliestStartTime),
    latestStartTime: timeColumn(rule.latestStartTime),
    dutyEndTime: timeColumn(rule.dutyEndTime),
    endNextCalendarDay: rule.endNextCalendarDay,
    requiredMinutes: rule.requiredMinutes,
    coreStartTime: timeColumn(rule.coreStartTime),
    coreEndTime: timeColumn(rule.coreEndTime),
    eventPattern: rule.eventPattern,
    collectionBeforeMinutes: rule.collectionBeforeMinutes,
    collectionAfterMinutes: rule.collectionAfterMinutes,
    breaks: {
      create: rule.breaks.map((item) => ({
        sequenceNo: item.sequenceNo,
        breakStartTime: timeValueOf(item.breakStartTime),
        breakEndTime: timeValueOf(item.breakEndTime),
        endNextCalendarDay: item.endNextCalendarDay,
      })),
    },
  };
}

@Injectable()
export class WorkSchedulesService {
  constructor(
    @Inject(ATTENDANCE_CONFIGURATION_AUDIT_WRITER)
    private readonly auditWriter: AttendanceConfigurationAuditWriter,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
  ) {}

  async list(context: RequestContext): Promise<WorkScheduleSummary[]> {
    this.assertPermission(context, 'attendance.configuration.read', 'WORK_SCHEDULE_READ_FORBIDDEN');
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const records = await transaction.workSchedule.findMany({
        where: { agencyId: context.agencyId },
        orderBy: [{ code: 'asc' }],
        select: scheduleSelect,
      });
      const current = await this.currentPublishedForSchedules(
        transaction,
        context.agencyId,
        records.map((record) => record.id),
      );
      return records.map((record) => scheduleSummary(record, current.get(record.id) ?? null));
    });
  }

  async findById(
    context: RequestContext,
    workScheduleId: string,
    asOfValue = manilaToday(),
  ): Promise<WorkScheduleDetail | null> {
    this.assertPermission(context, 'attendance.configuration.read', 'WORK_SCHEDULE_READ_FORBIDDEN');
    const asOf = toDatabaseDate(asOfValue);
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const record = await transaction.workSchedule.findFirst({
        where: { id: workScheduleId, agencyId: context.agencyId },
        select: {
          ...scheduleSelect,
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
        workScheduleId,
        asOf,
      );
      const current = await this.currentPublished(
        transaction,
        context.agencyId,
        workScheduleId,
        toDatabaseDate(manilaToday()),
      );
      const events = await transaction.auditEvent.findMany({
        where: {
          agencyId: context.agencyId,
          entityType: 'WorkSchedule',
          entityId: workScheduleId,
          action: { startsWith: 'WORK_SCHEDULE_' },
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
        schedule: scheduleSummary({ ...record, versions: draft ? [draft] : [] }, current),
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
    rawInput: CreateWorkScheduleInput,
  ): Promise<WorkScheduleSummary> {
    this.assertPermission(
      context,
      'attendance.configuration.manage',
      'WORK_SCHEDULE_MANAGE_FORBIDDEN',
    );
    const code = rawInput.code.trim();
    const name = rawInput.name.trim();
    if (!code) throw this.invalidInput('A Work Schedule code is required.');
    if (!name) throw this.invalidInput('A Work Schedule name is required.');
    const definition = normalizeScheduleDefinition(rawInput);
    try {
      return await withDatabaseContext(databaseContext(context), async (transaction) => {
        const schedule = await transaction.workSchedule.create({
          data: { agencyId: context.agencyId, code, name },
        });
        const version = await transaction.workScheduleVersion.create({
          data: {
            agencyId: context.agencyId,
            workScheduleId: schedule.id,
            versionNo: 1,
            scheduleType: definition.scheduleType,
            timezone: definition.timezone,
            effectiveFrom: toDatabaseDate(definition.effectiveDate),
            status: 'DRAFT',
          },
          select: { id: true },
        });
        await this.writeDayRules(transaction, context.agencyId, version.id, definition.dayRules);
        const result = await this.scheduleRecord(transaction, context.agencyId, schedule.id);
        if (!result) throw this.notFound();
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'WORK_SCHEDULE_CREATED',
          entityType: 'WorkSchedule',
          entityId: schedule.id,
          previousStatus: 'None',
          newStatus: 'DRAFT',
          requestId: context.requestId,
          metadata: {
            code,
            name,
            versionNo: 1,
            effectiveDate: definition.effectiveDate,
            scheduleType: definition.scheduleType,
          },
        });
        return scheduleSummary(result, null);
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
    workScheduleId: string,
  ): Promise<WorkScheduleSuccessor> {
    this.assertPermission(
      context,
      'attendance.configuration.manage',
      'WORK_SCHEDULE_MANAGE_FORBIDDEN',
    );
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      await this.lockSchedule(transaction, context.agencyId, workScheduleId);
      const current = await this.latestPublished(transaction, context.agencyId, workScheduleId);
      if (!current) throw this.successorNotAllowed();
      const existingDraft = await transaction.workScheduleVersion.findFirst({
        where: { agencyId: context.agencyId, workScheduleId, status: 'DRAFT' },
        select: versionSelect,
      });
      if (existingDraft) {
        return { current: versionSummary(current), draft: versionSummary(existingDraft) };
      }
      const latest = await transaction.workScheduleVersion.findFirst({
        where: { agencyId: context.agencyId, workScheduleId },
        orderBy: { versionNo: 'desc' },
        select: { versionNo: true },
      });
      const effectiveFrom = new Date(
        Math.max(
          addDays(current.effectiveFrom, 1).getTime(),
          addDays(toDatabaseDate(manilaToday()), 1).getTime(),
        ),
      );
      const draft = await transaction.workScheduleVersion.create({
        data: {
          agencyId: context.agencyId,
          workScheduleId,
          versionNo: (latest?.versionNo ?? current.versionNo) + 1,
          scheduleType: current.scheduleType,
          timezone: current.timezone,
          holidayEffectRules: current.holidayEffectRules as Prisma.InputJsonValue,
          effectiveFrom,
          status: 'DRAFT',
        },
        select: { id: true },
      });
      for (const rule of current.dayRules) {
        await transaction.workScheduleDayRule.create({
          data: {
            agencyId: context.agencyId,
            workScheduleVersionId: draft.id,
            weekday: rule.weekday,
            ruleType: rule.ruleType,
            dutyStartTime: rule.dutyStartTime,
            earliestStartTime: rule.earliestStartTime,
            latestStartTime: rule.latestStartTime,
            dutyEndTime: rule.dutyEndTime,
            endNextCalendarDay: rule.endNextCalendarDay,
            requiredMinutes: rule.requiredMinutes,
            coreStartTime: rule.coreStartTime,
            coreEndTime: rule.coreEndTime,
            eventPattern: rule.eventPattern,
            collectionBeforeMinutes: rule.collectionBeforeMinutes,
            collectionAfterMinutes: rule.collectionAfterMinutes,
            breaks: {
              create: rule.breaks.map((item) => ({
                sequenceNo: item.sequenceNo,
                breakStartTime: item.breakStartTime,
                breakEndTime: item.breakEndTime,
                endNextCalendarDay: item.endNextCalendarDay,
              })),
            },
          },
        });
      }
      const result = await transaction.workScheduleVersion.findFirstOrThrow({
        where: { id: draft.id, agencyId: context.agencyId },
        select: versionSelect,
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'WORK_SCHEDULE_SUCCESSOR_CREATED',
        entityType: 'WorkSchedule',
        entityId: workScheduleId,
        previousStatus: current.status,
        newStatus: 'DRAFT',
        requestId: context.requestId,
        metadata: {
          predecessorId: current.id,
          versionId: result.id,
          effectiveDate: formatDate(effectiveFrom),
        },
      });
      return { current: versionSummary(current), draft: versionSummary(result) };
    });
  }

  async updateDraft(
    context: RequestContext,
    workScheduleId: string,
    draftId: string,
    rawInput: UpdateWorkScheduleDraftInput,
  ): Promise<WorkScheduleVersionSummary> {
    this.assertPermission(
      context,
      'attendance.configuration.manage',
      'WORK_SCHEDULE_MANAGE_FORBIDDEN',
    );
    const definition = normalizeScheduleDefinition(rawInput);
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      await this.lockSchedule(transaction, context.agencyId, workScheduleId);
      const draft = await transaction.workScheduleVersion.findFirst({
        where: {
          id: draftId,
          agencyId: context.agencyId,
          workScheduleId,
          status: 'DRAFT',
        },
        select: versionSelect,
      });
      if (!draft) throw this.draftNotFound();
      const updated = await transaction.workScheduleVersion.updateMany({
        where: {
          id: draftId,
          agencyId: context.agencyId,
          status: 'DRAFT',
          ...(rawInput.rowVersion === undefined ? {} : { rowVersion: rawInput.rowVersion }),
        },
        data: {
          scheduleType: definition.scheduleType,
          timezone: definition.timezone,
          effectiveFrom: toDatabaseDate(definition.effectiveDate),
        },
      });
      if (updated.count !== 1) throw this.draftConflict();
      await transaction.workScheduleBreakInterval.deleteMany({
        where: {
          agencyId: context.agencyId,
          dayRuleId: { in: draft.dayRules.map((rule) => rule.id) },
        },
      });
      await transaction.workScheduleDayRule.deleteMany({
        where: { agencyId: context.agencyId, workScheduleVersionId: draftId },
      });
      await this.writeDayRules(transaction, context.agencyId, draftId, definition.dayRules);
      const result = await transaction.workScheduleVersion.findFirstOrThrow({
        where: { id: draftId, agencyId: context.agencyId },
        select: versionSelect,
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'WORK_SCHEDULE_DRAFT_UPDATED',
        entityType: 'WorkSchedule',
        entityId: workScheduleId,
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
    workScheduleId: string,
    draftId: string,
    input: ActivateAttendanceConfigurationInput,
    rawIdempotencyKey?: string,
  ): Promise<WorkScheduleSummary> {
    this.assertPermission(
      context,
      'attendance.configuration.activate',
      'WORK_SCHEDULE_ACTIVATE_FORBIDDEN',
    );
    const reason = input.reason.trim();
    if (!reason) throw this.activationReasonRequired();
    const approvingAuthority = input.approvingAuthority.trim();
    if (!approvingAuthority) throw this.approvingAuthorityRequired();
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockSchedule(transaction, context.agencyId, workScheduleId);
      if (idempotencyKey) {
        const completed = await transaction.auditEvent.findFirst({
          where: {
            agencyId: context.agencyId,
            action: 'WORK_SCHEDULE_VERSION_ACTIVATED',
            entityId: workScheduleId,
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
          const existing = await this.scheduleRecord(transaction, context.agencyId, workScheduleId);
          if (!existing) throw this.idempotencyConflict();
          const current = await this.currentPublished(
            transaction,
            context.agencyId,
            workScheduleId,
            toDatabaseDate(manilaToday()),
          );
          return scheduleSummary(existing, current);
        }
      }
      const draft = await transaction.workScheduleVersion.findFirst({
        where: {
          id: draftId,
          agencyId: context.agencyId,
          workScheduleId,
          status: 'DRAFT',
        },
        select: versionSelect,
      });
      if (!draft) throw this.draftNotFound();
      this.assertActivatable(draft);
      const evidence = await this.documentsService.resolveFinalizedVersionInTransaction(
        transaction,
        { agencyId: context.agencyId },
        input.authorityDocumentVersionId,
      );
      if (!evidence) throw this.evidenceRequired();
      const published = await transaction.workScheduleVersion.findMany({
        where: {
          agencyId: context.agencyId,
          workScheduleId,
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
        await transaction.workScheduleVersion.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: predecessor.id } },
          data: { status: 'SUPERSEDED', effectiveTo: addDays(draft.effectiveFrom, -1) },
        });
      }
      await transaction.workScheduleVersion.update({
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
      await this.refreshCurrentProjection(transaction, context.agencyId, workScheduleId);
      const result = await this.scheduleRecord(transaction, context.agencyId, workScheduleId);
      if (!result) throw this.notFound();
      const current = await this.currentPublished(
        transaction,
        context.agencyId,
        workScheduleId,
        toDatabaseDate(manilaToday()),
      );
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'WORK_SCHEDULE_VERSION_ACTIVATED',
        entityType: 'WorkSchedule',
        entityId: workScheduleId,
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
      return scheduleSummary(result, current);
    });
  }

  private assertActivatable(draft: WorkScheduleVersionRecord): void {
    normalizeDayRules(draft.dayRules.map(storedDayRuleInput));
  }

  private async writeDayRules(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    versionId: string,
    rules: WorkScheduleVersionDefinition['dayRules'],
  ): Promise<void> {
    for (const rule of rules) {
      await transaction.workScheduleDayRule.create({
        data: { agencyId, workScheduleVersionId: versionId, ...dayRuleWriteData(rule) },
      });
    }
  }

  private async scheduleRecord(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    workScheduleId: string,
  ): Promise<WorkScheduleRecord | null> {
    return transaction.workSchedule.findFirst({
      where: { id: workScheduleId, agencyId },
      select: scheduleSelect,
    });
  }

  private async latestPublished(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    workScheduleId: string,
  ): Promise<WorkScheduleVersionRecord | null> {
    return transaction.workScheduleVersion.findFirst({
      where: { agencyId, workScheduleId, status: { in: ['ACTIVE', 'SUPERSEDED'] } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: versionSelect,
    });
  }

  private async currentPublishedForSchedules(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    workScheduleIds: string[],
  ): Promise<Map<string, WorkScheduleVersionRecord>> {
    if (workScheduleIds.length === 0) return new Map();
    const today = toDatabaseDate(manilaToday());
    const candidates = await transaction.workScheduleVersion.findMany({
      where: {
        agencyId,
        workScheduleId: { in: workScheduleIds },
        status: { in: ['ACTIVE', 'SUPERSEDED'] },
        effectiveFrom: { lte: today },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: { id: true, workScheduleId: true },
    });
    const chosen = new Map<string, string>();
    for (const candidate of candidates) {
      if (!chosen.has(candidate.workScheduleId)) {
        chosen.set(candidate.workScheduleId, candidate.id);
      }
    }
    if (chosen.size === 0) return new Map();
    const versions = await transaction.workScheduleVersion.findMany({
      where: { id: { in: [...chosen.values()] } },
      select: versionSelect,
    });
    return new Map(versions.map((version) => [version.workScheduleId, version]));
  }

  private async currentPublished(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    workScheduleId: string,
    asOf: Date,
  ): Promise<WorkScheduleVersionRecord | null> {
    return transaction.workScheduleVersion.findFirst({
      where: {
        agencyId,
        workScheduleId,
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
    workScheduleId: string,
  ): Promise<void> {
    const current = await this.currentPublished(
      transaction,
      agencyId,
      workScheduleId,
      toDatabaseDate(manilaToday()),
    );
    await transaction.workSchedule.update({
      where: { agencyId_id: { agencyId, id: workScheduleId } },
      data: { currentVersionId: current?.id ?? null },
    });
  }

  private async lockSchedule(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    workScheduleId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "work_schedules" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${workScheduleId} AS uuid) FOR UPDATE`,
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
      'A Work Schedule with this Agency code already exists.',
      409,
      'WORK_SCHEDULE_CODE_CONFLICT',
    );
  }

  private draftConflict(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The Draft Work Schedule Version changed. Reload and try again.',
      409,
      'WORK_SCHEDULE_DRAFT_CONFLICT',
    );
  }

  private draftNotFound(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The Draft Work Schedule Version could not be found.',
      404,
      'WORK_SCHEDULE_DRAFT_NOT_FOUND',
    );
  }

  private notFound(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The Work Schedule could not be found.',
      404,
      'WORK_SCHEDULE_NOT_FOUND',
    );
  }

  private successorNotAllowed(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'Only an activated Work Schedule can have a successor.',
      409,
      'WORK_SCHEDULE_SUCCESSOR_NOT_ALLOWED',
    );
  }

  private predecessorInvalid(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The successor date does not follow the current Work Schedule period.',
      409,
      'WORK_SCHEDULE_PREDECESSOR_INVALID',
    );
  }

  private prospectiveRequired(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'An activated successor Work Schedule Version must take effect after today to preserve prior history.',
      409,
      'WORK_SCHEDULE_PROSPECTIVE_REQUIRED',
    );
  }

  private periodOverlap(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'Work Schedule effective periods cannot overlap.',
      409,
      'WORK_SCHEDULE_PERIOD_OVERLAP',
    );
  }

  private evidenceRequired(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'A finalized authority Document Version is required before activation.',
      409,
      'WORK_SCHEDULE_EVIDENCE_REQUIRED',
    );
  }

  private approvingAuthorityRequired(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The approving authority is required before activation.',
      400,
      'WORK_SCHEDULE_APPROVING_AUTHORITY_REQUIRED',
    );
  }

  private activationReasonRequired(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'A reason for Work Schedule activation is required.',
      400,
      'WORK_SCHEDULE_ACTIVATION_REASON_REQUIRED',
    );
  }

  private idempotencyConflict(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The Idempotency-Key was already used for a different Work Schedule request.',
      409,
      'WORK_SCHEDULE_IDEMPOTENCY_CONFLICT',
    );
  }
}
