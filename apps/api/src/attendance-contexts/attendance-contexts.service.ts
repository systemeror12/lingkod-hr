import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
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
  type AttendanceContextListFilters,
  type AttendanceContextResolution,
  type AttendanceContextSummary,
  type AttendanceContextType,
  type AttendanceContextWorkDateWindow,
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
      document: { select: { id: true, documentNo: true, documentType: true } },
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

function contextSummary(record: AttendanceContextRecord): AttendanceContextSummary {
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
    evidence: record.evidenceVersion
      ? {
          documentVersionId: record.evidenceVersion.id,
          documentId: record.evidenceVersion.document.id,
          documentNo: record.evidenceVersion.document.documentNo,
          documentType: record.evidenceVersion.document.documentType,
          versionNo: record.evidenceVersion.versionNo,
        }
      : null,
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
  ) {}

  async list(
    context: RequestContext,
    filters: AttendanceContextListFilters = {},
  ): Promise<AttendanceContextSummary[]> {
    const scope = this.requireReadScope(context);
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const records = await transaction.attendanceContext.findMany({
        where: {
          agencyId: context.agencyId,
          ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
          ...(filters.contextType ? { contextType: filters.contextType } : {}),
          ...(filters.coverageMode ? { coverageMode: filters.coverageMode } : {}),
          ...(scope === 'OWN'
            ? { employee: { memberships: { some: { id: context.membershipId } } } }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
        select: contextSelect,
      });
      return records.map(contextSummary);
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
          return contextSummary(existing);
        }
      }
      const employee = await transaction.employee.findFirst({
        where: { agencyId: context.agencyId, id: normalized.employeeId },
        select: { id: true },
      });
      if (!employee) throw this.employeeNotFound();
      let evidenceDocumentVersionId: string | null = null;
      if (normalized.evidenceDocumentVersionId) {
        const evidence = await this.documentsService.resolveFinalizedVersionInTransaction(
          transaction,
          { agencyId: context.agencyId },
          normalized.evidenceDocumentVersionId,
        );
        if (!evidence) throw this.evidenceInvalid();
        evidenceDocumentVersionId = evidence.id;
      }
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
      return contextSummary(record);
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
    const scope = this.requireReadScope(context);
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
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const employee = await transaction.employee.findFirst({
        where: { agencyId: context.agencyId, id: employeeId },
        select: { id: true, memberships: { select: { id: true } } },
      });
      if (!employee) throw this.employeeNotFound();
      if (scope === 'OWN' && !employee.memberships.some((m) => m.id === context.membershipId)) {
        throw new AttendanceContextServiceError(
          'The attendance.contexts.read permission is required.',
          403,
          'ATTENDANCE_CONTEXT_READ_FORBIDDEN',
        );
      }
      const records = await transaction.attendanceContext.findMany({
        where: {
          agencyId: context.agencyId,
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
      const intervals: MutableInterval[] = records.map((record) => ({
        startsAt: record.startsAt ? record.startsAt.getTime() : windowStartsAt.getTime(),
        endsAt: record.endsAt ? record.endsAt.getTime() : windowEndsAt.getTime(),
        context: contextSummary(record),
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
    });
  }

  private requireReadScope(context: RequestContext): 'AGENCY' | 'OWN' {
    if (
      context.permissions.some(
        (grant) => grant.code === 'attendance.contexts.read' && grant.scopePolicy === 'AGENCY',
      )
    ) {
      return 'AGENCY';
    }
    if (
      context.permissions.some(
        (grant) => grant.code === 'attendance.contexts.read' && grant.scopePolicy === 'OWN',
      )
    ) {
      return 'OWN';
    }
    throw new AttendanceContextServiceError(
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
