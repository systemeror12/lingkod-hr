import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { ownEmployeeId, resolveEmployeeScope } from '../employee-scope';
import { AttendanceEventType } from '../attendance/attendance.types';
import { presentWorkDateEvents } from '../attendance/attendance-matching';
import {
  formatDate,
  fromTimeValue,
} from '../attendance-configuration/attendance-configuration.types';
import { type WorkScheduleDayRuleSummary } from '../attendance-configuration/work-schedules.service';
import { attendanceCorrectionEventFactSchema } from '../attendance-corrections/attendance-corrections.types';
import type {
  AttendanceDayRuleSnapshot,
  AttendanceDayState,
} from '../attendance-days/attendance-days.types';
import { DocumentsService } from '../documents/documents.service';
import { DTR_AUDIT_WRITER, type DtrAuditWriter } from './dtrs.audit';
import {
  renderDtrPreviewDocument,
  renderDtrSystemViewDocument,
  zonedDateTimeParts,
} from './dtrs.render';
import {
  DTR_MANIFEST_FORMAT,
  DtrServiceError,
  type DtrDocumentDetail,
  type DtrDocumentSummary,
  type DtrGenerateResult,
  type DtrListFilters,
  type DtrManifest,
  type DtrManifestDay,
  type DtrManifestEmployee,
  type DtrManifestPeriod,
  type DtrPeriodVersionSummary,
  type DtrPreview,
  type DtrPreviewInput,
  type DtrPresentationEntry,
} from './dtrs.types';

const MAX_LIST_LIMIT = 200;
const DEFAULT_LIST_LIMIT = 100;

const dtrSelect = {
  id: true,
  agencyId: true,
  attendancePeriodVersionId: true,
  employeeId: true,
  predecessorDtrDocumentId: true,
  classification: true,
  outputType: true,
  documentVersionId: true,
  generatedAt: true,
  attendancePeriodVersion: {
    select: {
      id: true,
      versionNo: true,
      status: true,
      predecessorVersionId: true,
      lockedAt: true,
      lockedByMembershipId: true,
      reviewedAt: true,
      reviewedByMembershipId: true,
      attendancePeriod: {
        select: { id: true, code: true, dateFrom: true, dateTo: true, status: true },
      },
    },
  },
  employee: { select: { id: true, employeeNumber: true, legalName: true } },
} as const;

type DtrRecord = Prisma.DtrDocumentGetPayload<{ select: typeof dtrSelect }>;

const daySelect = {
  id: true,
  attendancePeriodId: true,
  employeeId: true,
  workDate: true,
  dayClassification: true,
  status: true,
  expectedMinutes: true,
  workedMinutes: true,
  coverageMinutes: true,
  lateMinutes: true,
  undertimeMinutes: true,
  absenceMinutes: true,
  officialBusinessMinutes: true,
  officialTravelMinutes: true,
  trainingMinutes: true,
  approvedAbsenceMinutes: true,
  postedLeaveMinutes: true,
  outsideScheduleMinutes: true,
  statutoryNightWindowMinutes: true,
  calculationVersion: true,
  ruleSnapshot: true,
  isCurrent: true,
} as const;

type DayRecord = Prisma.AttendanceDayGetPayload<{ select: typeof daySelect }>;

function metadataString(metadata: Prisma.JsonValue, key: string): string | null {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

export function parseDtrDayRuleSnapshot(value: Prisma.JsonValue): AttendanceDayRuleSnapshot {
  const snapshot = (value ?? {}) as Record<string, unknown>;
  return {
    fingerprint: typeof snapshot.fingerprint === 'string' ? snapshot.fingerprint : '',
    timezone: typeof snapshot.timezone === 'string' ? snapshot.timezone : '',
    assignmentId: typeof snapshot.assignmentId === 'string' ? snapshot.assignmentId : null,
    workScheduleVersionId:
      typeof snapshot.workScheduleVersionId === 'string' ? snapshot.workScheduleVersionId : null,
    workArrangementVersionId:
      typeof snapshot.workArrangementVersionId === 'string'
        ? snapshot.workArrangementVersionId
        : null,
    holidayCalendarVersionId:
      typeof snapshot.holidayCalendarVersionId === 'string'
        ? snapshot.holidayCalendarVersionId
        : null,
    dayRuleId: typeof snapshot.dayRuleId === 'string' ? snapshot.dayRuleId : null,
    eventIds: Array.isArray(snapshot.eventIds)
      ? snapshot.eventIds.filter((item): item is string => typeof item === 'string')
      : undefined,
    resolutionException:
      snapshot.resolutionException !== null &&
      typeof snapshot.resolutionException === 'object' &&
      !Array.isArray(snapshot.resolutionException)
        ? (snapshot.resolutionException as AttendanceDayRuleSnapshot['resolutionException'])
        : undefined,
    capturedAt: typeof snapshot.capturedAt === 'string' ? snapshot.capturedAt : '',
  };
}

const segmentSelect = {
  attendanceDayId: true,
  id: true,
  sequenceNo: true,
  startsAt: true,
  endsAt: true,
  dutyRelation: true,
  coverageType: true,
  deficitType: true,
  holidayClassification: true,
  sourceReferences: true,
} as const;

const exceptionSelect = {
  attendanceDayId: true,
  id: true,
  exceptionType: true,
  status: true,
  details: true,
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
  breaks: {
    orderBy: { sequenceNo: 'asc' },
    select: {
      id: true,
      sequenceNo: true,
      breakStartTime: true,
      breakEndTime: true,
      endNextCalendarDay: true,
    },
  },
} as const;

type SegmentRow = Prisma.AttendanceDaySegmentGetPayload<{ select: typeof segmentSelect }>;
type ExceptionRow = Prisma.AttendanceExceptionGetPayload<{ select: typeof exceptionSelect }>;
type DayRuleRow = Prisma.WorkScheduleDayRuleGetPayload<{ select: typeof dayRuleSelect }>;
type EventRow = { id: string; eventType: string; eventTime: Date };
type EffectRow = { id: string; effectAction: string; replacementRecord: Prisma.JsonValue };

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function groupRows<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = grouped.get(key);
    if (list) list.push(row);
    else grouped.set(key, [row]);
  }
  return grouped;
}

function dayRuleSummary(record: DayRuleRow): WorkScheduleDayRuleSummary {
  const time = (value: Date | null): string | null => (value ? fromTimeValue(value) : null);
  return {
    id: record.id,
    weekday: record.weekday,
    ruleType: record.ruleType as WorkScheduleDayRuleSummary['ruleType'],
    dutyStartTime: time(record.dutyStartTime),
    earliestStartTime: time(record.earliestStartTime),
    latestStartTime: time(record.latestStartTime),
    dutyEndTime: time(record.dutyEndTime),
    endNextCalendarDay: record.endNextCalendarDay,
    requiredMinutes: record.requiredMinutes,
    coreStartTime: time(record.coreStartTime),
    coreEndTime: time(record.coreEndTime),
    eventPattern: record.eventPattern as WorkScheduleDayRuleSummary['eventPattern'],
    collectionBeforeMinutes: record.collectionBeforeMinutes,
    collectionAfterMinutes: record.collectionAfterMinutes,
    breaks: record.breaks.map((breakInterval) => ({
      id: breakInterval.id,
      sequenceNo: breakInterval.sequenceNo,
      breakStartTime: fromTimeValue(breakInterval.breakStartTime),
      breakEndTime: fromTimeValue(breakInterval.breakEndTime),
      endNextCalendarDay: breakInterval.endNextCalendarDay,
    })),
  };
}

/**
 * Rebuild the DTR presentation from the exact effective sources recorded in
 * the Attendance Day snapshot. An Attendance Correction effect keeps its own
 * identity, so a replaced event shows the correction lineage rather than the
 * overwritten original.
 */
function presentationEntries(
  eventIds: readonly string[],
  dayRule: WorkScheduleDayRuleSummary,
  workDate: string,
  timezone: string,
  eventsById: ReadonlyMap<string, EventRow>,
  effectsById: ReadonlyMap<string, EffectRow>,
): DtrPresentationEntry[] {
  if (eventIds.length === 0) return [];
  const presentable: Array<{ id: string; eventType: AttendanceEventType; eventTime: Date }> = [];
  const sourceByEventId = new Map<string, DtrPresentationEntry['sourceType']>();
  for (const id of eventIds) {
    const event = eventsById.get(id);
    if (event) {
      presentable.push({
        id: event.id,
        eventType: event.eventType as AttendanceEventType,
        eventTime: event.eventTime,
      });
      sourceByEventId.set(event.id, 'ATTENDANCE_EVENT');
      continue;
    }
    const effect = effectsById.get(id);
    if (effect && effect.effectAction !== 'VOID' && effect.replacementRecord !== null) {
      const parsed = attendanceCorrectionEventFactSchema.safeParse(effect.replacementRecord);
      if (!parsed.success) {
        throw new DtrServiceError(
          'An applied Attendance Correction effect could not be read for the Daily Time Record.',
          409,
          'DTR_SOURCE_UNRESOLVED',
          [`EFFECT:${effect.id}`],
        );
      }
      presentable.push({
        id: effect.id,
        eventType: parsed.data.eventType,
        eventTime: new Date(parsed.data.eventTime),
      });
      sourceByEventId.set(effect.id, 'ATTENDANCE_CORRECTION_EFFECT');
    }
  }
  if (presentable.length !== eventIds.length) {
    const resolved = new Set(presentable.map((event) => event.id));
    throw new DtrServiceError(
      'An Attendance Day source could not be resolved for the Daily Time Record.',
      409,
      'DTR_SOURCE_UNRESOLVED',
      eventIds.filter((id) => !resolved.has(id)).map((id) => `SOURCE:${id}`),
    );
  }
  const presentations = presentWorkDateEvents(workDate, dayRule, presentable);
  return presentable
    .map((event) => {
      const entry = presentations.get(event.id);
      const parts = zonedDateTimeParts(event.eventTime, timezone);
      return {
        entry: {
          slot: entry?.slot ?? null,
          label: entry?.label ?? 'Attendance event',
          eventId: event.id,
          sourceType: sourceByEventId.get(event.id) ?? 'ATTENDANCE_EVENT',
          eventType: event.eventType,
          eventTime: event.eventTime.toISOString(),
          localDate: parts.localDate,
          localTime: parts.localTime,
        } satisfies DtrPresentationEntry,
        sortKey: `${event.eventTime.toISOString()}|${event.id}`,
      };
    })
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
    .map(({ entry }) => entry);
}

function manifestDay(
  record: DayRecord,
  snapshot: AttendanceDayRuleSnapshot,
  sources: {
    segments: readonly SegmentRow[];
    exceptions: readonly ExceptionRow[];
    dayRulesById: ReadonlyMap<string, WorkScheduleDayRuleSummary>;
    eventsById: ReadonlyMap<string, EventRow>;
    effectsById: ReadonlyMap<string, EffectRow>;
  },
): DtrManifestDay {
  const workDate = formatDate(record.workDate);
  const dayRule = snapshot.dayRuleId
    ? (sources.dayRulesById.get(snapshot.dayRuleId) ?? null)
    : null;
  const presentation = dayRule
    ? presentationEntries(
        snapshot.eventIds ?? [],
        dayRule,
        workDate,
        snapshot.timezone,
        sources.eventsById,
        sources.effectsById,
      )
    : [];
  return {
    attendanceDayId: record.id,
    calculationVersion: record.calculationVersion,
    workDate,
    dayClassification: record.dayClassification as DtrManifestDay['dayClassification'],
    status: record.status as AttendanceDayState,
    totals: {
      expectedMinutes: record.expectedMinutes,
      workedMinutes: record.workedMinutes,
      coverageMinutes: record.coverageMinutes,
      lateMinutes: record.lateMinutes,
      undertimeMinutes: record.undertimeMinutes,
      absenceMinutes: record.absenceMinutes,
      officialBusinessMinutes: record.officialBusinessMinutes,
      officialTravelMinutes: record.officialTravelMinutes,
      trainingMinutes: record.trainingMinutes,
      approvedAbsenceMinutes: record.approvedAbsenceMinutes,
      postedLeaveMinutes: record.postedLeaveMinutes,
      outsideScheduleMinutes: record.outsideScheduleMinutes,
      statutoryNightWindowMinutes: record.statutoryNightWindowMinutes,
    },
    schedule: {
      dayRuleId: dayRule?.id ?? null,
      ruleType: dayRule?.ruleType ?? null,
      timezone: snapshot.timezone || null,
      dutyStartTime: dayRule?.dutyStartTime ?? null,
      dutyEndTime: dayRule?.dutyEndTime ?? null,
      endNextCalendarDay: dayRule?.endNextCalendarDay ?? null,
      eventPattern: dayRule?.eventPattern ?? null,
    },
    sources: {
      fingerprint: snapshot.fingerprint,
      scheduleAssignmentId: snapshot.assignmentId ?? null,
      workScheduleVersionId: snapshot.workScheduleVersionId ?? null,
      workArrangementVersionId: snapshot.workArrangementVersionId ?? null,
      holidayCalendarVersionId: snapshot.holidayCalendarVersionId ?? null,
    },
    presentation,
    segments: sources.segments.map((segment) => ({
      id: segment.id,
      sequenceNo: segment.sequenceNo,
      startsAt: segment.startsAt.toISOString(),
      endsAt: segment.endsAt.toISOString(),
      dutyRelation: segment.dutyRelation,
      coverageType: segment.coverageType,
      deficitType: segment.deficitType,
      holidayClassification: segment.holidayClassification,
      sourceReferences: segment.sourceReferences,
    })),
    exceptions: sources.exceptions.map((exception) => ({
      id: exception.id,
      exceptionType: exception.exceptionType,
      status: exception.status as DtrManifestDay['exceptions'][number]['status'],
      message: metadataString(exception.details, 'message'),
    })),
  };
}

/**
 * Finalized Daily Time Records and their unfinalized previews. A preview is
 * derived from the current Attendance Day versions and stays visibly
 * unfinalized; generation retains one immutable manifest per covered Employee
 * on a locked Attendance Period Version. The Printable System View is
 * reproduced deterministically from each retained manifest, so the document
 * version records the exact rendering identity without a stored file.
 */
@Injectable()
export class DtrsService {
  constructor(
    @Inject(DTR_AUDIT_WRITER) private readonly auditWriter: DtrAuditWriter,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
  ) {}

  async preview(context: RequestContext, input: DtrPreviewInput): Promise<DtrPreview> {
    const resolved = await this.previewInternal(context, input);
    return { unfinalized: true, ...resolved };
  }

  async renderPreview(context: RequestContext, input: DtrPreviewInput): Promise<string> {
    const resolved = await this.previewInternal(context, input);
    const agencyName = await this.agencyName(context);
    return renderDtrPreviewDocument({ unfinalized: true, ...resolved }, { agencyName });
  }

  async list(context: RequestContext, filters: DtrListFilters = {}): Promise<DtrDocumentSummary[]> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const scope = await this.reportsScope(transaction, context);
      if (
        scope.kind === 'SCOPED' &&
        filters.employeeId !== undefined &&
        !scope.employeeIds.includes(filters.employeeId)
      ) {
        return [];
      }
      const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
      const employeeFilter =
        scope.kind === 'SCOPED'
          ? { employeeId: { in: filters.employeeId ? [filters.employeeId] : scope.employeeIds } }
          : filters.employeeId
            ? { employeeId: filters.employeeId }
            : {};
      const records = await transaction.dtrDocument.findMany({
        where: {
          agencyId: context.agencyId,
          ...(filters.attendancePeriodId
            ? {
                attendancePeriodVersion: { attendancePeriodId: filters.attendancePeriodId },
              }
            : {}),
          ...employeeFilter,
        },
        orderBy: [{ generatedAt: 'desc' }, { id: 'asc' }],
        take: limit,
        select: dtrSelect,
      });
      const latest = await this.latestLockedVersionIds(
        transaction,
        context.agencyId,
        records.map((record) => record.attendancePeriodVersion.attendancePeriod.id),
      );
      const summaries = records.map((record) => dtrSummary(record, latest));
      if (filters.currentOnly) {
        return summaries.filter((summary) => summary.isCurrent);
      }
      return summaries;
    });
  }

  async listPeriodVersions(
    context: RequestContext,
    attendancePeriodId: string,
  ): Promise<DtrPeriodVersionSummary[]> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      await this.daysScope(transaction, context);
      const versions = await transaction.attendancePeriodVersion.findMany({
        where: { agencyId: context.agencyId, attendancePeriodId },
        orderBy: [{ versionNo: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          attendancePeriodId: true,
          versionNo: true,
          status: true,
          predecessorVersionId: true,
          lockedAt: true,
          _count: { select: { dtrDocuments: true } },
        },
      });
      return versions.map((version) => ({
        id: version.id,
        attendancePeriodId: version.attendancePeriodId,
        versionNo: version.versionNo,
        status: version.status,
        predecessorVersionId: version.predecessorVersionId,
        lockedAt: version.lockedAt ? version.lockedAt.toISOString() : null,
        dtrCount: version._count.dtrDocuments,
      }));
    });
  }

  async findById(context: RequestContext, dtrDocumentId: string): Promise<DtrDocumentDetail> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const scope = await this.reportsScope(transaction, context);
      const record = await transaction.dtrDocument.findFirst({
        where: { agencyId: context.agencyId, id: dtrDocumentId },
        select: { ...dtrSelect, sourceManifest: true },
      });
      if (!record) throw this.notFound();
      if (scope.kind === 'SCOPED' && !scope.employeeIds.includes(record.employeeId)) {
        throw this.notFound();
      }
      const latest = await this.latestLockedVersionIds(transaction, context.agencyId, [
        record.attendancePeriodVersion.attendancePeriod.id,
      ]);
      return {
        document: dtrSummary(record, latest),
        manifest: parseManifest(record.sourceManifest),
      };
    });
  }

  async render(context: RequestContext, dtrDocumentId: string): Promise<string> {
    const detail = await this.findById(context, dtrDocumentId);
    if (detail.manifest.renderedSystemViewHtml) {
      return detail.manifest.renderedSystemViewHtml;
    }
    const agencyName = await this.agencyName(context);
    return renderDtrSystemViewDocument(detail.manifest, { agencyName });
  }

  /**
   * Materialize the retained Finalized Daily Time Records of one locked
   * Attendance Period Version. The operation is idempotent: a Version and
   * Employee pair owns at most one DTR, and a replay reports the existing
   * artifacts instead of writing new ones.
   */
  async generate(context: RequestContext, versionId: string): Promise<DtrGenerateResult> {
    if (!hasPermission(context, 'attendance.dtr.generate')) {
      throw new DtrServiceError(
        'The attendance.dtr.generate permission is required.',
        403,
        'DTR_GENERATE_FORBIDDEN',
      );
    }
    this.assertAgencyPermission(context, 'attendance.dtr.generate');
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) =>
      this.materializeForLockedVersionInTransaction(transaction, context, versionId),
    );
  }

  /**
   * Internal contract: the Attendance Period lock and the Locked Attendance
   * Adjustment transactions materialize their DTRs in the same transaction as
   * the lock, so a failure leaves no partial finalized output.
   */
  async materializeForLockedVersionInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    versionId: string,
  ): Promise<DtrGenerateResult> {
    const version = await transaction.attendancePeriodVersion.findFirst({
      where: { agencyId: context.agencyId, id: versionId },
      select: {
        id: true,
        attendancePeriodId: true,
        versionNo: true,
        predecessorVersionId: true,
        status: true,
        lockedAt: true,
        lockedByMembershipId: true,
        reviewedAt: true,
        reviewedByMembershipId: true,
        attendancePeriod: {
          select: { id: true, code: true, dateFrom: true, dateTo: true, status: true },
        },
        days: {
          select: {
            attendanceDayId: true,
            attendanceDay: { select: { employeeId: true } },
          },
        },
      },
    });
    if (!version) {
      throw new DtrServiceError(
        'The requested Attendance Period Version could not be found.',
        404,
        'DTR_VERSION_NOT_FOUND',
      );
    }
    if (version.status !== 'LOCKED') {
      throw new DtrServiceError(
        'Only a locked Attendance Period Version creates Finalized Daily Time Records.',
        409,
        'DTR_VERSION_NOT_LOCKED',
        [`STATUS:${version.status}`],
      );
    }
    const dayIdsByEmployee = new Map<string, string[]>();
    for (const row of version.days) {
      const ids = dayIdsByEmployee.get(row.attendanceDay.employeeId) ?? [];
      ids.push(row.attendanceDayId);
      dayIdsByEmployee.set(row.attendanceDay.employeeId, ids);
    }
    const agencyName = await this.agencyNameInTransaction(transaction, context.agencyId);
    const created: string[] = [];
    const existing: string[] = [];
    for (const [employeeId, dayIds] of [...dayIdsByEmployee.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const current = await transaction.dtrDocument.findFirst({
        where: {
          agencyId: context.agencyId,
          attendancePeriodVersionId: version.id,
          employeeId,
        },
        select: { id: true },
      });
      if (current) {
        existing.push(current.id);
        continue;
      }
      const predecessor = version.predecessorVersionId
        ? await transaction.dtrDocument.findFirst({
            where: {
              agencyId: context.agencyId,
              attendancePeriodVersionId: version.predecessorVersionId,
              employeeId,
            },
            select: { id: true },
          })
        : null;
      if (version.predecessorVersionId && !predecessor) {
        throw new DtrServiceError(
          'The corrected successor requires the retained predecessor Daily Time Record.',
          409,
          'DTR_PREDECESSOR_MISSING',
          [`EMPLOYEE:${employeeId}`],
        );
      }
      const employee = await transaction.employee.findFirst({
        where: { agencyId: context.agencyId, id: employeeId },
        select: { id: true, employeeNumber: true, legalName: true },
      });
      if (!employee) {
        throw new DtrServiceError(
          'A covered Employee of the locked version could not be found.',
          409,
          'DTR_EMPLOYEE_NOT_FOUND',
          [`EMPLOYEE:${employeeId}`],
        );
      }
      const days = await this.manifestDays(transaction, context.agencyId, dayIds);
      const now = new Date();
      const lineage: Omit<DtrManifest, 'renderedSystemViewHtml'> = {
        format: DTR_MANIFEST_FORMAT,
        classification: version.predecessorVersionId ? 'CORRECTED' : 'ORIGINAL',
        outputType: 'PRINTABLE_SYSTEM_VIEW',
        predecessorDtrDocumentId: predecessor?.id ?? null,
        period: periodOf(version.attendancePeriod),
        version: {
          id: version.id,
          versionNo: version.versionNo,
          predecessorVersionId: version.predecessorVersionId,
          lockedAt: version.lockedAt ? version.lockedAt.toISOString() : null,
          lockedByMembershipId: version.lockedByMembershipId,
          reviewedAt: version.reviewedAt ? version.reviewedAt.toISOString() : null,
          reviewedByMembershipId: version.reviewedByMembershipId,
        },
        employee: {
          id: employee.id,
          employeeNumber: employee.employeeNumber,
          legalName: employee.legalName,
        },
        generatedAt: now.toISOString(),
        days,
      };
      const html = renderDtrSystemViewDocument(
        { ...lineage, renderedSystemViewHtml: '' },
        { agencyName },
      );
      const manifest: DtrManifest = { ...lineage, renderedSystemViewHtml: html };
      const issued = await this.documents.createIssuedVersionInTransaction(transaction, context, {
        documentType: 'DAILY_TIME_RECORD',
        classification: 'INTERNAL',
        content: Buffer.from(html, 'utf8'),
        mimeType: 'text/html',
      });
      const createdDtr = await transaction.dtrDocument.create({
        data: {
          id: randomUUID(),
          agencyId: context.agencyId,
          attendancePeriodVersionId: version.id,
          employeeId,
          predecessorDtrDocumentId: predecessor?.id ?? null,
          classification: manifest.classification,
          outputType: manifest.outputType,
          documentVersionId: issued.versionId,
          authoritativeTemplateReference: Prisma.DbNull,
          sourceManifest: manifest as unknown as Prisma.InputJsonValue,
          generatedAt: now,
        },
        select: { id: true },
      });
      created.push(createdDtr.id);
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'DTR_FINALIZED',
        entityType: 'DtrDocument',
        entityId: createdDtr.id,
        newStatus: 'FINALIZED',
        requestId: context.requestId,
        metadata: {
          command: 'DTR_FINALIZED',
          attendancePeriodVersionId: version.id,
          attendancePeriodId: version.attendancePeriodId,
          employeeId,
          classification: manifest.classification,
          outputType: manifest.outputType,
          predecessorDtrDocumentId: predecessor?.id ?? null,
          attendanceDayIds: dayIds,
        },
      });
    }
    return {
      attendancePeriodVersionId: version.id,
      dtrDocumentIds: created,
      existingDtrDocumentIds: existing,
    };
  }
  private async previewInternal(
    context: RequestContext,
    input: DtrPreviewInput,
  ): Promise<{ period: DtrManifestPeriod; employee: DtrManifestEmployee; days: DtrManifestDay[] }> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const scope = await this.daysScope(transaction, context);
      const employeeId = input.employeeId ?? (await ownEmployeeId(transaction, context));
      if (!employeeId) {
        throw new DtrServiceError(
          'The Agency Membership is not linked to an Employee record.',
          409,
          'DTR_PREVIEW_SUBJECT_REQUIRED',
        );
      }
      if (scope.kind === 'SCOPED' && !scope.employeeIds.includes(employeeId)) {
        throw this.notFound();
      }
      const period = await transaction.attendancePeriod.findFirst({
        where: { agencyId: context.agencyId, id: input.attendancePeriodId },
        select: { id: true, code: true, dateFrom: true, dateTo: true, status: true },
      });
      if (!period) {
        throw new DtrServiceError(
          'The requested Attendance Period could not be found.',
          404,
          'DTR_PERIOD_NOT_FOUND',
        );
      }
      const employee = await transaction.employee.findFirst({
        where: { agencyId: context.agencyId, id: employeeId },
        select: { id: true, employeeNumber: true, legalName: true },
      });
      if (!employee) throw this.notFound();
      const days = await transaction.attendanceDay.findMany({
        where: {
          agencyId: context.agencyId,
          attendancePeriodId: period.id,
          employeeId,
          isCurrent: true,
        },
        orderBy: [{ workDate: 'asc' }, { id: 'asc' }],
        select: daySelect,
      });
      return {
        period: periodOf(period),
        employee: {
          id: employee.id,
          employeeNumber: employee.employeeNumber,
          legalName: employee.legalName,
        },
        days: await this.manifestDaysForRecords(transaction, context.agencyId, days),
      };
    });
  }

  private async manifestDays(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    dayIds: readonly string[],
  ): Promise<DtrManifestDay[]> {
    if (dayIds.length === 0) return [];
    const records = await transaction.attendanceDay.findMany({
      where: { agencyId, id: { in: [...dayIds] } },
      orderBy: [{ workDate: 'asc' }, { id: 'asc' }],
      select: daySelect,
    });
    return this.manifestDaysForRecords(transaction, agencyId, records);
  }

  /**
   * Build every manifest day from one batched read per fact type so a locked
   * version with many Employees and Work Dates does not issue per-day queries.
   */
  private async manifestDaysForRecords(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    records: readonly DayRecord[],
  ): Promise<DtrManifestDay[]> {
    if (records.length === 0) return [];
    const recordIds = records.map((record) => record.id);
    const snapshots = new Map(
      records.map((record) => [record.id, parseDtrDayRuleSnapshot(record.ruleSnapshot)]),
    );
    const dayRuleIds = uniqueValues(
      [...snapshots.values()]
        .map((snapshot) => snapshot.dayRuleId ?? null)
        .filter((id): id is string => id !== null),
    );
    const eventIds = uniqueValues(
      [...snapshots.values()].flatMap((snapshot) => snapshot.eventIds ?? []),
    );
    const [segmentRows, exceptionRows, dayRuleRows, eventRows, effectRows] = await Promise.all([
      transaction.attendanceDaySegment.findMany({
        where: { agencyId, attendanceDayId: { in: recordIds } },
        orderBy: [{ attendanceDayId: 'asc' }, { sequenceNo: 'asc' }],
        select: segmentSelect,
      }),
      transaction.attendanceException.findMany({
        where: { agencyId, attendanceDayId: { in: recordIds } },
        orderBy: [{ attendanceDayId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: exceptionSelect,
      }),
      dayRuleIds.length > 0
        ? transaction.workScheduleDayRule.findMany({
            where: { agencyId, id: { in: dayRuleIds } },
            select: dayRuleSelect,
          })
        : Promise.resolve([]),
      eventIds.length > 0
        ? transaction.attendanceEvent.findMany({
            where: { agencyId, id: { in: eventIds } },
            select: { id: true, eventType: true, eventTime: true },
          })
        : Promise.resolve([]),
      eventIds.length > 0
        ? transaction.attendanceCorrectionEffect.findMany({
            where: { agencyId, id: { in: eventIds } },
            select: { id: true, effectAction: true, replacementRecord: true },
          })
        : Promise.resolve([]),
    ]);
    const segmentsByDay = groupRows(segmentRows, (row) => row.attendanceDayId);
    const exceptionsByDay = groupRows(exceptionRows, (row) => row.attendanceDayId);
    const dayRulesById = new Map(dayRuleRows.map((row) => [row.id, dayRuleSummary(row)]));
    const eventsById = new Map(eventRows.map((row) => [row.id, row]));
    const effectsById = new Map(effectRows.map((row) => [row.id, row]));
    return records.map((record) =>
      manifestDay(record, snapshots.get(record.id)!, {
        segments: segmentsByDay.get(record.id) ?? [],
        exceptions: exceptionsByDay.get(record.id) ?? [],
        dayRulesById,
        eventsById,
        effectsById,
      }),
    );
  }

  private async latestLockedVersionIds(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    periodIds: readonly string[],
  ): Promise<Map<string, string>> {
    const uniquePeriodIds = [...new Set(periodIds)];
    if (uniquePeriodIds.length === 0) return new Map();
    const versions = await transaction.attendancePeriodVersion.findMany({
      where: { agencyId, attendancePeriodId: { in: uniquePeriodIds }, status: 'LOCKED' },
      orderBy: [{ versionNo: 'desc' }, { id: 'asc' }],
      select: { id: true, attendancePeriodId: true },
    });
    const latest = new Map<string, string>();
    for (const version of versions) {
      if (!latest.has(version.attendancePeriodId)) {
        latest.set(version.attendancePeriodId, version.id);
      }
    }
    return latest;
  }

  private async agencyName(context: RequestContext): Promise<string> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) =>
      this.agencyNameInTransaction(transaction, context.agencyId),
    );
  }

  private async agencyNameInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
  ): Promise<string> {
    const agency = await transaction.agency.findFirst({
      where: { id: agencyId },
      select: { name: true },
    });
    return agency?.name ?? 'Agency';
  }

  private async daysScope(transaction: Prisma.TransactionClient, context: RequestContext) {
    return this.readScope(transaction, context, 'attendance.days.read');
  }

  private async reportsScope(transaction: Prisma.TransactionClient, context: RequestContext) {
    return this.readScope(transaction, context, 'attendance.reports.read');
  }

  /** Resolve one read permission's Employee Scope, denying a scope that reaches no Employee. */
  private async readScope(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    permissionCode: string,
  ) {
    const scope = await resolveEmployeeScope(transaction, context, permissionCode);
    if (scope.kind === 'NONE' || (scope.kind === 'SCOPED' && scope.employeeIds.length === 0)) {
      throw new DtrServiceError(
        `The ${permissionCode} permission is required.`,
        403,
        'DTR_READ_FORBIDDEN',
      );
    }
    return scope;
  }

  private assertAgencyPermission(context: RequestContext, permissionCode: string): void {
    const granted = context.permissions.some(
      (grant) => grant.code === permissionCode && grant.scopePolicy === 'AGENCY',
    );
    if (!granted) {
      throw new DtrServiceError(
        `The ${permissionCode} permission with Agency scope is required.`,
        403,
        'DTR_GENERATE_FORBIDDEN',
      );
    }
  }

  private notFound(): DtrServiceError {
    return new DtrServiceError(
      'The requested Finalized Daily Time Record could not be found.',
      404,
      'DTR_NOT_FOUND',
    );
  }
}

function periodOf(record: {
  id: string;
  code: string;
  dateFrom: Date;
  dateTo: Date;
  status: string;
}): DtrManifestPeriod {
  return {
    id: record.id,
    code: record.code,
    dateFrom: formatDate(record.dateFrom),
    dateTo: formatDate(record.dateTo),
    status: record.status as DtrManifestPeriod['status'],
  };
}

function dtrSummary(record: DtrRecord, latest: ReadonlyMap<string, string>): DtrDocumentSummary {
  const period = record.attendancePeriodVersion.attendancePeriod;
  return {
    id: record.id,
    agencyId: record.agencyId,
    attendancePeriodVersionId: record.attendancePeriodVersionId,
    period: periodOf(period),
    versionNo: record.attendancePeriodVersion.versionNo,
    versionStatus: record.attendancePeriodVersion.status,
    employee: {
      id: record.employee.id,
      employeeNumber: record.employee.employeeNumber,
      legalName: record.employee.legalName,
    },
    classification: record.classification as DtrDocumentSummary['classification'],
    outputType: record.outputType as DtrDocumentSummary['outputType'],
    predecessorDtrDocumentId: record.predecessorDtrDocumentId,
    documentVersionId: record.documentVersionId,
    generatedAt: record.generatedAt.toISOString(),
    isCurrent: latest.get(period.id) === record.attendancePeriodVersionId,
  };
}

function parseManifest(value: Prisma.JsonValue): DtrManifest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DtrServiceError(
      'The retained Daily Time Record manifest could not be read.',
      500,
      'DTR_MANIFEST_INVALID',
    );
  }
  const record = value as Record<string, unknown>;
  if (record.format !== DTR_MANIFEST_FORMAT || !Array.isArray(record.days)) {
    throw new DtrServiceError(
      'The retained Daily Time Record manifest could not be read.',
      500,
      'DTR_MANIFEST_INVALID',
    );
  }
  return record as unknown as DtrManifest;
}
