import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { resolveEmployeeScope, scopeCovers } from '../employee-scope';
import { DocumentsService } from '../documents/documents.service';
import { AttendanceService } from '../attendance/attendance.service';
import { addDateValueDays, localDateValue } from '../attendance/attendance.types';
import {
  ATTENDANCE_WORK_DATE_LOCKED,
  findLockedWorkDate,
  lockedWorkDateMessage,
} from '../attendance-work-date-lock';
import {
  contextOverlayCoversWindow,
  type AttendanceCorrectionContextOverlay,
} from '../attendance-corrections/attendance-corrections.effects';
import {
  ATTENDANCE_CONTEXT_AUDIT_WRITER,
  type AttendanceContextAuditWriter,
} from './attendance-contexts.audit';
import {
  AttendanceContextServiceError,
  CONFLICTING_COVERAGE_EXCEPTION_TYPE,
  formatDate,
  formatInstant,
  normalizeAttendanceContextInput,
  toDatabaseDate,
  toDatabaseInstant,
  type AttendanceContextConflict,
  type AttendanceContextCoverageInterval,
  type AttendanceContextCoverageMode,
  type AttendanceContextEvidenceSummary,
  type AttendanceContextListFilters,
  type AttendanceContextResolution,
  type AttendanceContextSummary,
  type AttendanceContextType,
  type AttendanceContextWorkDateWindow,
  type NormalizedAttendanceContextInput,
  type RecordAttendanceContextInput,
} from './attendance-contexts.types';

const contextSelect = {
  id: true,
  agencyId: true,
  employeeId: true,
  contextType: true,
  coverageMode: true,
  workDate: true,
  startsAt: true,
  endsAt: true,
  reason: true,
  sourceType: true,
  sourceId: true,
  evidenceDocumentVersionId: true,
  enteredByMembershipId: true,
  createdAt: true,
  employee: { select: { id: true, employeeNumber: true, legalName: true } },
  evidenceVersion: {
    select: {
      id: true,
      versionNo: true,
      document: {
        select: { id: true, documentNo: true, documentType: true, classification: true },
      },
    },
  },
  enteredBy: {
    select: {
      id: true,
      employee: { select: { legalName: true } },
    },
  },
} as const;

type AttendanceContextRecord = Prisma.AttendanceContextGetPayload<{
  select: typeof contextSelect;
}>;

function databaseContext(context: RequestContext) {
  return requestDatabaseContext(context);
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

function canReadSensitiveEvidence(context: RequestContext): boolean {
  return holdsAgencyWide(context, 'documents.evidence.read_sensitive');
}

function evidenceSummary(
  record: AttendanceContextRecord,
  canReadSensitive: boolean,
): AttendanceContextEvidenceSummary | null {
  const version = record.evidenceVersion;
  if (!version) return null;
  if (version.document.classification === 'HIGHLY_SENSITIVE' && !canReadSensitive) {
    return { access: 'RESTRICTED' };
  }
  return {
    access: 'FULL',
    documentVersionId: version.id,
    documentId: version.document.id,
    documentNo: version.document.documentNo,
    documentType: version.document.documentType,
    versionNo: version.versionNo,
  };
}

function contextSummary(
  record: AttendanceContextRecord,
  canReadSensitive: boolean,
): AttendanceContextSummary {
  return {
    id: record.id,
    agencyId: record.agencyId,
    employee: {
      id: record.employee.id,
      employeeNumber: record.employee.employeeNumber,
      legalName: record.employee.legalName,
    },
    contextType: record.contextType as AttendanceContextType,
    coverageMode: record.coverageMode as AttendanceContextCoverageMode,
    workDate: record.workDate ? formatDate(record.workDate) : null,
    startsAt: record.startsAt ? formatInstant(record.startsAt) : null,
    endsAt: record.endsAt ? formatInstant(record.endsAt) : null,
    reason: record.reason,
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    evidence: evidenceSummary(record, canReadSensitive),
    recordedBy: {
      membershipId: record.enteredBy.id,
      legalName: record.enteredBy.employee?.legalName ?? null,
    },
    recordedAt: formatInstant(record.createdAt),
  };
}

interface MutableInterval {
  startsAt: number;
  endsAt: number;
  context: AttendanceContextSummary;
}

function correctionOverlaySummary(
  overlay: AttendanceCorrectionContextOverlay,
  agencyId: string,
  employeeId: string,
): AttendanceContextSummary {
  return {
    id: overlay.effectId,
    agencyId,
    employee: { id: employeeId, employeeNumber: '', legalName: '' },
    contextType: overlay.contextType as AttendanceContextType,
    coverageMode: overlay.coverageMode as AttendanceContextCoverageMode,
    workDate: overlay.workDate,
    startsAt: overlay.startsAt ? formatInstant(overlay.startsAt) : null,
    endsAt: overlay.endsAt ? formatInstant(overlay.endsAt) : null,
    reason: overlay.reason ?? '',
    sourceType: null,
    sourceId: null,
    evidence: null,
    recordedBy: { membershipId: overlay.appliedByMembershipId, legalName: null },
    recordedAt: formatInstant(overlay.appliedAt),
  };
}

interface MutableConflict {
  startsAt: number;
  endsAt: number;
  contextIds: Set<string>;
  contextTypes: Set<string>;
}

function toConflict(interval: MutableConflict): AttendanceContextConflict {
  return {
    exceptionType: CONFLICTING_COVERAGE_EXCEPTION_TYPE,
    startsAt: new Date(interval.startsAt).toISOString(),
    endsAt: new Date(interval.endsAt).toISOString(),
    contextIds: [...interval.contextIds].sort(),
    contextTypes: [...interval.contextTypes].sort() as AttendanceContextType[],
  };
}

/**
 * Overlapping coverage only conflicts when classifications differ. Two contexts
 * of the same type may overlap; calculation unions them instead of raising an
 * exception, and Attendance never assumes a precedence between classifications.
 */
function detectConflicts(intervals: readonly MutableInterval[]): AttendanceContextConflict[] {
  const pairs: MutableConflict[] = [];
  for (let left = 0; left < intervals.length; left += 1) {
    for (let right = left + 1; right < intervals.length; right += 1) {
      const a = intervals[left]!;
      const b = intervals[right]!;
      if (a.context.contextType === b.context.contextType) continue;
      if (a.startsAt >= b.endsAt || b.startsAt >= a.endsAt) continue;
      pairs.push({
        startsAt: Math.max(a.startsAt, b.startsAt),
        endsAt: Math.min(a.endsAt, b.endsAt),
        contextIds: new Set([a.context.id, b.context.id]),
        contextTypes: new Set([a.context.contextType, b.context.contextType]),
      });
    }
  }
  pairs.sort((left, right) => left.startsAt - right.startsAt || left.endsAt - right.endsAt);
  const merged: MutableConflict[] = [];
  for (const pair of pairs) {
    const last = merged[merged.length - 1];
    if (last && pair.startsAt < last.endsAt) {
      last.endsAt = Math.max(last.endsAt, pair.endsAt);
      for (const id of pair.contextIds) last.contextIds.add(id);
      for (const type of pair.contextTypes) last.contextTypes.add(type);
    } else {
      merged.push(pair);
    }
  }
  return merged.map(toConflict);
}

/**
 * Records official business, official travel, training, and approved absence
 * coverage as immutable Attendance Context facts. Each request appends one
 * record and one audit event and is replay-safe through the Idempotency-Key
 * header.
 */
@Injectable()
export class AttendanceContextsService {
  constructor(
    @Inject(ATTENDANCE_CONTEXT_AUDIT_WRITER)
    private readonly auditWriter: AttendanceContextAuditWriter,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
    @Inject(AttendanceService) private readonly attendance: AttendanceService,
  ) {}

  async list(
    context: RequestContext,
    filters: AttendanceContextListFilters = {},
  ): Promise<AttendanceContextSummary[]> {
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const scope = await resolveEmployeeScope(transaction, context, 'attendance.contexts.read');
      if (scope.kind === 'NONE') throw this.readForbidden();
      const records = await transaction.attendanceContext.findMany({
        where: {
          agencyId: context.agencyId,
          AND: [
            filters.employeeId ? { employeeId: filters.employeeId } : {},
            scope.kind === 'SCOPED' ? { employeeId: { in: scope.employeeIds } } : {},
          ],
          ...(filters.contextType ? { contextType: filters.contextType } : {}),
          ...(filters.coverageMode ? { coverageMode: filters.coverageMode } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
        select: contextSelect,
      });
      const canReadSensitive = canReadSensitiveEvidence(context);
      return records.map((record) => contextSummary(record, canReadSensitive));
    });
  }

  async record(
    context: RequestContext,
    input: RecordAttendanceContextInput,
    rawIdempotencyKey?: string,
  ): Promise<AttendanceContextSummary> {
    this.assertPermission(
      context,
      'attendance.contexts.create',
      'ATTENDANCE_CONTEXT_CREATE_FORBIDDEN',
    );
    const normalized = normalizeAttendanceContextInput(input);
    const fingerprint = canonicalJson(normalized);
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const canReadSensitive = canReadSensitiveEvidence(context);
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      if (idempotencyKey) {
        const completed = await transaction.auditEvent.findFirst({
          where: {
            agencyId: context.agencyId,
            action: 'ATTENDANCE_CONTEXT_RECORDED',
            idempotencyKey,
          },
          select: { metadata: true },
        });
        if (completed) {
          const contextId = metadataString(completed.metadata, 'contextId');
          if (!contextId || metadataString(completed.metadata, 'fingerprint') !== fingerprint) {
            throw this.idempotencyConflict();
          }
          const existing = await transaction.attendanceContext.findFirst({
            where: { agencyId: context.agencyId, id: contextId },
            select: contextSelect,
          });
          if (!existing) throw this.idempotencyConflict();
          return contextSummary(existing, canReadSensitive);
        }
      }
      const employee = await transaction.employee.findFirst({
        where: { agencyId: context.agencyId, id: normalized.employeeId },
        select: { id: true },
      });
      if (!employee) throw this.employeeNotFound();
      const locked = await findLockedWorkDate(
        transaction,
        context.agencyId,
        await this.coveredWorkDates(transaction, context.agencyId, normalized),
      );
      if (locked) {
        throw new AttendanceContextServiceError(
          lockedWorkDateMessage(locked),
          409,
          ATTENDANCE_WORK_DATE_LOCKED,
        );
      }
      const evidenceDocumentVersionId = normalized.evidenceDocumentVersionId
        ? await this.resolveEvidence(
            transaction,
            context,
            normalized.evidenceDocumentVersionId,
            canReadSensitive,
          )
        : null;
      const created = await transaction.attendanceContext.create({
        data: {
          agencyId: context.agencyId,
          employeeId: normalized.employeeId,
          contextType: normalized.contextType,
          coverageMode: normalized.coverageMode,
          workDate: normalized.workDate ? toDatabaseDate(normalized.workDate) : null,
          startsAt: normalized.startsAt ? toDatabaseInstant(normalized.startsAt) : null,
          endsAt: normalized.endsAt ? toDatabaseInstant(normalized.endsAt) : null,
          reason: normalized.reason,
          sourceType: normalized.sourceType,
          sourceId: normalized.sourceId,
          evidenceDocumentVersionId,
          enteredByMembershipId: context.membershipId,
        },
        select: { id: true },
      });
      const record = await transaction.attendanceContext.findFirstOrThrow({
        where: { agencyId: context.agencyId, id: created.id },
        select: contextSelect,
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'ATTENDANCE_CONTEXT_RECORDED',
        entityType: 'AttendanceContext',
        entityId: record.id,
        previousStatus: 'None',
        newStatus: 'RECORDED',
        reason: normalized.reason,
        idempotencyKey,
        requestId: context.requestId,
        metadata: {
          contextId: record.id,
          fingerprint,
          employeeId: normalized.employeeId,
          contextType: normalized.contextType,
          coverageMode: normalized.coverageMode,
          workDate: normalized.workDate,
          startsAt: normalized.startsAt,
          endsAt: normalized.endsAt,
          sourceType: normalized.sourceType,
          sourceId: normalized.sourceId,
          evidenceDocumentVersionId,
        },
      });
      return contextSummary(record, canReadSensitive);
    });
  }

  /**
   * Answers which recorded Attendance Contexts cover one Work Date for one
   * Employee and reports conflicting classifications. Callers own how a Work
   * Date maps to instants, so a whole-work-date context covers the supplied
   * window and a timed context is returned when its instants intersect it.
   */
  async resolveCoverage(
    context: RequestContext,
    employeeId: string,
    workDateValue: string,
    window: AttendanceContextWorkDateWindow,
  ): Promise<AttendanceContextResolution> {
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const scope = await resolveEmployeeScope(transaction, context, 'attendance.contexts.read');
      if (scope.kind === 'NONE') throw this.readForbidden();
      const workDate = toDatabaseDate(workDateValue);
      const windowStartsAt = toDatabaseInstant(window.startsAt);
      const windowEndsAt = toDatabaseInstant(window.endsAt);
      if (windowEndsAt.getTime() <= windowStartsAt.getTime()) {
        throw new AttendanceContextServiceError(
          'The Work Date window must end after it starts.',
          400,
          'ATTENDANCE_CONTEXT_WINDOW_INVALID',
        );
      }
      const employee = await transaction.employee.findFirst({
        where: { agencyId: context.agencyId, id: employeeId },
        select: { id: true },
      });
      if (!employee) throw this.employeeNotFound();
      if (!scopeCovers(scope, employeeId)) throw this.readForbidden();
      return this.coverageInTransaction(
        transaction,
        context.agencyId,
        employeeId,
        workDate,
        windowStartsAt,
        windowEndsAt,
        [],
        canReadSensitiveEvidence(context),
      );
    });
  }

  /**
   * Resolve the Attendance Context coverage of one Work Date inside a
   * caller-owned transaction. Attendance Day calculation uses this seam so its
   * already-authorized caller can reuse the exact same overlap and conflict
   * semantics without holding the read permission itself. Sensitive evidence
   * stays restricted because this seam has no reader to authorize.
   */
  async resolveCoverageInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    workDateValue: string,
    window: AttendanceContextWorkDateWindow,
    correctionOverlays: readonly AttendanceCorrectionContextOverlay[] = [],
  ): Promise<AttendanceContextResolution> {
    const workDate = toDatabaseDate(workDateValue);
    const windowStartsAt = toDatabaseInstant(window.startsAt);
    const windowEndsAt = toDatabaseInstant(window.endsAt);
    if (windowEndsAt.getTime() <= windowStartsAt.getTime()) {
      throw new AttendanceContextServiceError(
        'The Work Date window must end after it starts.',
        400,
        'ATTENDANCE_CONTEXT_WINDOW_INVALID',
      );
    }
    const employee = await transaction.employee.findFirst({
      where: { agencyId, id: employeeId },
      select: { id: true },
    });
    if (!employee) throw this.employeeNotFound();
    return this.coverageInTransaction(
      transaction,
      agencyId,
      employeeId,
      workDate,
      windowStartsAt,
      windowEndsAt,
      correctionOverlays,
    );
  }

  private async coverageInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    workDate: Date,
    windowStartsAt: Date,
    windowEndsAt: Date,
    correctionOverlays: readonly AttendanceCorrectionContextOverlay[] = [],
    canReadSensitive = false,
  ): Promise<AttendanceContextResolution> {
    const records = await transaction.attendanceContext.findMany({
      where: {
        agencyId,
        employeeId,
        OR: [
          { coverageMode: 'WHOLE_WORK_DATE', workDate },
          {
            coverageMode: 'TIMED',
            startsAt: { lt: windowEndsAt },
            endsAt: { gt: windowStartsAt },
          },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: contextSelect,
    });
    const replacedTargetIds = new Set(
      correctionOverlays
        .filter((overlay) => overlay.effectAction !== 'ADD' && overlay.originalTargetId !== null)
        .map((overlay) => overlay.originalTargetId!),
    );
    const effectiveSummaries: AttendanceContextSummary[] = records
      .filter((record) => !replacedTargetIds.has(record.id))
      .map((record) => contextSummary(record, canReadSensitive));
    const workDateValue = formatDate(workDate);
    for (const overlay of correctionOverlays) {
      if (overlay.effectAction === 'VOID') continue;
      if (!contextOverlayCoversWindow(overlay, workDateValue, windowStartsAt, windowEndsAt)) {
        continue;
      }
      effectiveSummaries.push(correctionOverlaySummary(overlay, agencyId, employeeId));
    }
    const intervals: MutableInterval[] = effectiveSummaries.map((summary) => ({
      startsAt: summary.startsAt ? new Date(summary.startsAt).getTime() : windowStartsAt.getTime(),
      endsAt: summary.endsAt ? new Date(summary.endsAt).getTime() : windowEndsAt.getTime(),
      context: summary,
    }));
    const coverage: AttendanceContextCoverageInterval[] = intervals.map((interval) => ({
      context: interval.context,
      startsAt: new Date(interval.startsAt).toISOString(),
      endsAt: new Date(interval.endsAt).toISOString(),
    }));
    return {
      employeeId,
      workDate: formatDate(workDate),
      window: {
        startsAt: formatInstant(windowStartsAt),
        endsAt: formatInstant(windowEndsAt),
      },
      intervals: coverage,
      conflicts: detectConflicts(intervals),
    };
  }

  /**
   * Work Dates a new Context would add a source to. A timed interval too long
   * to resolve against schedules fails closed to every local date it could
   * touch, including Work Dates whose collection windows reach into it.
   */
  private async coveredWorkDates(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    input: NormalizedAttendanceContextInput,
  ): Promise<string[]> {
    if (input.workDate) return [input.workDate];
    const startsAt = toDatabaseInstant(input.startsAt!);
    const endsAt = toDatabaseInstant(input.endsAt!);
    const resolved = await this.attendance.coveredWorkDatesInTransaction(
      transaction,
      agencyId,
      input.employeeId,
      startsAt,
      endsAt,
    );
    // A date without a schedule may still hold a locked Attendance Day.
    if (resolved) return [...resolved.covered, ...resolved.unresolved];
    const agency = await transaction.agency.findFirst({
      where: { id: agencyId },
      select: { defaultTimezone: true },
    });
    const timezone = agency?.defaultTimezone ?? 'Asia/Manila';
    const lastDate = addDateValueDays(localDateValue(endsAt, timezone), 2);
    const dates: string[] = [];
    for (
      let cursor = addDateValueDays(localDateValue(startsAt, timezone), -3);
      cursor <= lastDate;
      cursor = addDateValueDays(cursor, 1)
    ) {
      dates.push(cursor);
    }
    return dates;
  }

  /**
   * Applies the shared External Evidence rule to a supporting Document Version:
   * same Agency, finalized, and `HIGHLY_SENSITIVE` only with
   * `documents.evidence.read_sensitive`.
   */
  private async resolveEvidence(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    versionId: string,
    canReadSensitive: boolean,
  ): Promise<string> {
    const version = await transaction.documentVersion.findFirst({
      where: { agencyId: context.agencyId, id: versionId },
      select: { documentId: true },
    });
    if (!version) throw this.evidenceInvalid();
    const evidence = await this.documentsService.resolveExternalEvidenceInTransaction(
      transaction,
      context,
      {
        documentId: version.documentId,
        versionId,
        allowSensitive: canReadSensitive,
        requirement: 'FINALIZED_VERSION',
      },
    );
    if (evidence.ok === false && evidence.reason === 'SENSITIVE_FORBIDDEN') {
      throw new AttendanceContextServiceError(
        'The documents.evidence.read_sensitive permission is required to link this evidence.',
        403,
        'ATTENDANCE_CONTEXT_EVIDENCE_FORBIDDEN',
      );
    }
    if (!evidence.ok) throw this.evidenceInvalid();
    return evidence.document.currentVersion.id;
  }

  private readForbidden(): AttendanceContextServiceError {
    return new AttendanceContextServiceError(
      'The attendance.contexts.read permission is required.',
      403,
      'ATTENDANCE_CONTEXT_READ_FORBIDDEN',
    );
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (!hasPermission(context, permission)) {
      throw new AttendanceContextServiceError(
        `The ${permission} permission is required.`,
        403,
        code,
      );
    }
  }

  private employeeNotFound(): AttendanceContextServiceError {
    return new AttendanceContextServiceError(
      'The Employee could not be found in this Agency.',
      404,
      'ATTENDANCE_CONTEXT_EMPLOYEE_NOT_FOUND',
    );
  }

  private evidenceInvalid(): AttendanceContextServiceError {
    return new AttendanceContextServiceError(
      'The evidence Document Version must be a finalized version in this Agency.',
      409,
      'ATTENDANCE_CONTEXT_EVIDENCE_INVALID',
    );
  }

  private idempotencyConflict(): AttendanceContextServiceError {
    return new AttendanceContextServiceError(
      'The Idempotency-Key was already used for a different Attendance Context request.',
      409,
      'ATTENDANCE_CONTEXT_IDEMPOTENCY_CONFLICT',
    );
  }
}
