import { createHash } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { AttendanceDaysService } from '../attendance-days/attendance-days.service';
import { AttendanceService } from '../attendance/attendance.service';
import {
  formatDate,
  manilaToday,
  toDatabaseDate,
} from '../attendance-configuration/attendance-configuration.types';
import { ScheduleAssignmentsService } from '../attendance-configuration/schedule-assignments.service';
import {
  addDateValueDays,
  eventCollectionWindow,
  localDateValue,
  zonedTimeToInstant,
} from '../attendance/attendance.types';
import {
  ApprovalCompletionRegistry,
  ApprovalsService,
  type ApprovalCompletionRequest,
  type ApprovalEffectContext,
  type ApprovalRouteSummary,
} from '../approvals/approval.service';
import { DocumentsService } from '../documents/documents.service';
import { DtrsService } from '../dtrs/dtrs.service';
import { AttendancePeriodsService } from '../attendance-periods/attendance-periods.service';
import { AttendancePostedLeaveInputError } from '../attendance-posted-leave-inputs/attendance-posted-leave-inputs.types';
import {
  ATTENDANCE_CORRECTION_AUDIT_WRITER,
  type AttendanceCorrectionAuditWriter,
} from './attendance-corrections.audit';
import {
  ATTENDANCE_CORRECTION_APPROVAL_EFFECT_KIND,
  ATTENDANCE_CORRECTION_APPROVAL_SUBJECT_TYPE,
  ATTENDANCE_CORRECTION_LOCKED_ROUTE_CODE,
  ATTENDANCE_CORRECTION_POSTED_LEAVE_ROUTE_CODE,
  ATTENDANCE_CORRECTION_ROUTE_CODE,
  AttendanceCorrectionServiceError,
  attendanceCorrectionContextFactSchema,
  attendanceCorrectionEventFactSchema,
  attendanceCorrectionPostedLeaveFactSchema,
  type AttendanceCorrectionAction,
  type AttendanceCorrectionCreateInput,
  type AttendanceCorrectionDetail,
  type AttendanceCorrectionImpactPreview,
  type AttendanceCorrectionImpactPreviewDay,
  type AttendanceCorrectionListFilters,
  type AttendanceCorrectionState,
  type AttendanceCorrectionSummary,
  type AttendanceCorrectionTargetType,
  type PostedLeaveHandoff,
  type PostedLeaveHandoffInput,
  type PostedLeaveHandoffStatus,
  type RequestedAttendanceContextFact,
  type RequestedAttendanceEventFact,
  type RequestedAttendanceFact,
  type RequestedPostedLeaveFact,
} from './attendance-corrections.types';

const MAX_LIST_LIMIT = 200;
const DEFAULT_LIST_LIMIT = 100;
const MAX_CONTEXT_ENUMERATION_DAYS = 62;
const CORRECTION_REVIEW_PERMISSIONS = ['attendance.corrections.approve'] as const;
const CORRECTION_AUTHORIZE_PERMISSIONS = ['attendance.corrections.authorize_locked'] as const;
const LEAVE_CANCELLATION_SOURCE_TYPE = 'LeaveCancellation';
const LEAVE_CANCELLATION_DECISION_REASON = 'Leave Cancellation approved.';

/** A VOID proposes no fact; every VOID fingerprints this same placeholder. */
const VOID_FACT: RequestedAttendanceEventFact = {
  eventType: 'TIME_IN',
  eventTime: '',
  sourceReference: null,
  reason: null,
};

type CorrectionRouteKind = 'OPEN' | 'LOCKED' | 'POSTED_LEAVE';

const CORRECTION_ROUTES: Record<CorrectionRouteKind, { code: string; steps: string[] }> = {
  OPEN: { code: ATTENDANCE_CORRECTION_ROUTE_CODE, steps: ['attendance.corrections.approve'] },
  LOCKED: {
    code: ATTENDANCE_CORRECTION_LOCKED_ROUTE_CODE,
    steps: ['attendance.corrections.approve', 'attendance.corrections.authorize_locked'],
  },
  // The approved Leave Cancellation is the factual review, so only authorization remains.
  POSTED_LEAVE: {
    code: ATTENDANCE_CORRECTION_POSTED_LEAVE_ROUTE_CODE,
    steps: ['attendance.corrections.authorize_locked'],
  },
};

const correctionEmployeeSelect = {
  id: true,
  employeeNumber: true,
  legalName: true,
} as const;

const correctionSelect = {
  id: true,
  agencyId: true,
  employeeId: true,
  initiatedByMembershipId: true,
  recordedByMembershipId: true,
  targetType: true,
  requestedAction: true,
  targetId: true,
  status: true,
  requestedRecord: true,
  reason: true,
  approvalRouteVersionId: true,
  impactPreview: true,
  submittedAt: true,
  decidedByMembershipId: true,
  decidedAt: true,
  decisionReason: true,
  authorizedByMembershipId: true,
  authorizedAt: true,
  appliedByMembershipId: true,
  appliedAt: true,
  excludedDeciderMembershipIds: true,
  blockingReason: true,
  blockedByMembershipId: true,
  blockedAt: true,
  createdAt: true,
  employee: { select: correctionEmployeeSelect },
} as const;

type CorrectionRecord = Prisma.AttendanceCorrectionGetPayload<{ select: typeof correctionSelect }>;

function databaseContext(context: RequestContext) {
  return requestDatabaseContext(context, 'approval-transition');
}

function metadataString(metadata: Prisma.JsonValue, key: string): string | null {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
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

function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function correctionSummary(record: CorrectionRecord): AttendanceCorrectionSummary {
  return {
    id: record.id,
    agencyId: record.agencyId,
    employee: {
      id: record.employee.id,
      employeeNumber: record.employee.employeeNumber,
      legalName: record.employee.legalName,
    },
    initiatedByMembershipId: record.initiatedByMembershipId,
    recordedByMembershipId: record.recordedByMembershipId,
    targetType: record.targetType as AttendanceCorrectionTargetType,
    requestedAction: record.requestedAction as AttendanceCorrectionAction,
    targetId: record.targetId,
    requestedRecord: record.requestedRecord,
    status: record.status as AttendanceCorrectionState,
    reason: record.reason,
    approvalRouteVersionId: record.approvalRouteVersionId,
    submittedAt: record.submittedAt ? record.submittedAt.toISOString() : null,
    decidedByMembershipId: record.decidedByMembershipId,
    decidedAt: record.decidedAt ? record.decidedAt.toISOString() : null,
    decisionReason: record.decisionReason,
    authorizedByMembershipId: record.authorizedByMembershipId,
    authorizedAt: record.authorizedAt ? record.authorizedAt.toISOString() : null,
    appliedByMembershipId: record.appliedByMembershipId,
    appliedAt: record.appliedAt ? record.appliedAt.toISOString() : null,
    excludedDeciderMembershipIds: record.excludedDeciderMembershipIds,
    blockingReason: record.blockingReason,
    blockedByMembershipId: record.blockedByMembershipId,
    blockedAt: record.blockedAt ? record.blockedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
  };
}

function parseImpactPreview(value: Prisma.JsonValue): AttendanceCorrectionImpactPreview {
  const record = (value ?? {}) as Record<string, unknown>;
  const days = Array.isArray(record.days)
    ? (record.days as AttendanceCorrectionImpactPreviewDay[])
    : [];
  const periods = Array.isArray(record.periods) ? record.periods : [];
  const lockedPeriodVersionIds = Array.isArray(record.lockedPeriodVersionIds)
    ? record.lockedPeriodVersionIds.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    computedAt: typeof record.computedAt === 'string' ? record.computedAt : '',
    targetType: record.targetType as AttendanceCorrectionTargetType,
    requestedAction: record.requestedAction as AttendanceCorrectionAction,
    targetWorkDates: Array.isArray(record.targetWorkDates)
      ? record.targetWorkDates.filter((item): item is string => typeof item === 'string')
      : [],
    proposedWorkDates: Array.isArray(record.proposedWorkDates)
      ? record.proposedWorkDates.filter((item): item is string => typeof item === 'string')
      : [],
    days,
    periods: periods as AttendanceCorrectionImpactPreview['periods'],
    lockedPeriodVersionIds,
    fingerprint: typeof record.fingerprint === 'string' ? record.fingerprint : '',
  };
}

function normalizeFact(input: AttendanceCorrectionCreateInput): RequestedAttendanceFact {
  if (input.targetType === 'ATTENDANCE_EVENT') {
    const record = input.requestedRecord;
    return {
      eventType: record?.eventType ?? 'TIME_IN',
      eventTime: record?.eventTime ?? '',
      sourceReference: record?.sourceReference ?? null,
      reason: record?.reason ?? null,
    };
  }
  const record = input.requestedRecord;
  if (!record) {
    return {
      contextType: 'OFFICIAL_BUSINESS',
      coverageMode: 'WHOLE_WORK_DATE',
      workDate: null,
      startsAt: null,
      endsAt: null,
      reason: '',
      sourceType: null,
      sourceId: null,
      evidenceDocumentVersionId: null,
    };
  }
  if (record.coverageMode === 'WHOLE_WORK_DATE') {
    return {
      contextType: record.contextType,
      coverageMode: 'WHOLE_WORK_DATE',
      workDate: record.workDate,
      startsAt: null,
      endsAt: null,
      reason: record.reason,
      sourceType: record.sourceType ?? null,
      sourceId: record.sourceId ?? null,
      evidenceDocumentVersionId: record.evidenceDocumentVersionId ?? null,
    };
  }
  return {
    contextType: record.contextType,
    coverageMode: 'TIMED',
    workDate: null,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    reason: record.reason,
    sourceType: record.sourceType ?? null,
    sourceId: record.sourceId ?? null,
    evidenceDocumentVersionId: record.evidenceDocumentVersionId ?? null,
  };
}

/**
 * An Attendance Correction is one evidence-backed ADD, REPLACE, or VOID of an
 * immutable Attendance Event or Attendance Context. Submission binds the exact
 * Approval Route Version and impact preview; factual approval applies an open
 * correction atomically, while a locked-period impact stops at
 * FOR_AUTHORIZATION for a different HR Administrator to authorize one grouped
 * Locked Attendance Adjustment.
 */
@Injectable()
export class AttendanceCorrectionsService implements OnModuleInit {
  constructor(
    @Inject(ATTENDANCE_CORRECTION_AUDIT_WRITER)
    private readonly auditWriter: AttendanceCorrectionAuditWriter,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
    @Inject(ApprovalCompletionRegistry)
    private readonly completionRegistry: ApprovalCompletionRegistry,
    @Inject(AttendanceDaysService) private readonly days: AttendanceDaysService,
    @Inject(AttendanceService) private readonly attendance: AttendanceService,
    @Inject(ScheduleAssignmentsService) private readonly assignments: ScheduleAssignmentsService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(DtrsService) private readonly dtrs: DtrsService,
    @Inject(AttendancePeriodsService) private readonly periods: AttendancePeriodsService,
  ) {}

  onModuleInit(): void {
    this.completionRegistry.register(
      ATTENDANCE_CORRECTION_APPROVAL_SUBJECT_TYPE,
      (transaction, context, request) => this.completeApproval(transaction, context, request),
    );
    // Return and reject go through Attendance so the correction moves with
    // its request; a generic Approval decision would strand it.
    this.completionRegistry.registerDecision(
      ATTENDANCE_CORRECTION_APPROVAL_SUBJECT_TYPE,
      async (_transaction, _context, request) => {
        if (request.effectContext?.kind !== ATTENDANCE_CORRECTION_APPROVAL_EFFECT_KIND) {
          throw this.approvalEffectRequired();
        }
      },
    );
  }

  async create(
    context: RequestContext,
    input: AttendanceCorrectionCreateInput,
    rawIdempotencyKey?: string,
  ): Promise<AttendanceCorrectionDetail> {
    this.assertPermission(
      context,
      'attendance.corrections.create',
      'ATTENDANCE_CORRECTION_CREATE_FORBIDDEN',
    );
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const command = fingerprint({ command: 'CREATE', input });
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      if (idempotencyKey) {
        const replay = await this.completedCommand(transaction, context, {
          action: 'ATTENDANCE_CORRECTION_CREATED',
          idempotencyKey,
          command,
        });
        if (replay) return this.findByIdInTransaction(transaction, context, replay);
      }
      const employee = await this.resolveSubjectEmployee(transaction, context, input.employeeId);
      if (employee.id !== employee.ownEmployeeId && !input.onBehalfReason) {
        throw this.onBehalfReasonRequired();
      }
      await this.validateTargetFact(
        transaction,
        context,
        employee.id,
        input.targetType,
        input.requestedAction,
        input.targetId,
      );
      this.validateRequestedFact(input);
      const preview = await this.computePreview(
        transaction,
        context,
        employee.id,
        input.targetType,
        input.requestedAction,
        input.targetId ?? null,
        normalizeFact(input),
      );
      const locked = preview.lockedPeriodVersionIds.length > 0;
      const route = await this.resolveCorrectionRoute(
        transaction,
        context,
        locked ? 'LOCKED' : 'OPEN',
      );
      const requestedRecord = this.requestedRecordJson(input);
      const created = await transaction.attendanceCorrection.create({
        data: {
          agencyId: context.agencyId,
          employeeId: employee.id,
          initiatedByMembershipId: context.membershipId,
          recordedByMembershipId: context.membershipId,
          targetType: input.targetType,
          requestedAction: input.requestedAction,
          targetId: input.targetId ?? null,
          status: 'DRAFT',
          ...(requestedRecord ? { requestedRecord } : {}),
          reason: input.reason,
          approvalRouteVersionId: route.id,
          impactPreview: preview as unknown as Prisma.InputJsonValue,
          updatedAt: new Date(),
        },
        select: { id: true },
      });
      for (const evidence of input.evidence) {
        const documentVersionId =
          'documentVersionId' in evidence ? evidence.documentVersionId : null;
        if (documentVersionId) {
          const resolved = await this.documents.resolveFinalizedVersionInTransaction(
            transaction,
            { agencyId: context.agencyId },
            documentVersionId,
          );
          if (!resolved) throw this.evidenceInvalid();
        }
        await transaction.attendanceCorrectionEvidence.create({
          data: {
            agencyId: context.agencyId,
            attendanceCorrectionId: created.id,
            documentVersionId,
            sourceType: documentVersionId ? null : (evidence as { sourceType: string }).sourceType,
            sourceId: documentVersionId ? null : (evidence as { sourceId: string }).sourceId,
          },
        });
      }
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'ATTENDANCE_CORRECTION_CREATED',
        entityType: 'AttendanceCorrection',
        entityId: created.id,
        previousStatus: null,
        newStatus: 'DRAFT',
        reason: input.reason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          command,
          employeeId: employee.id,
          targetType: input.targetType,
          requestedAction: input.requestedAction,
          targetId: input.targetId ?? null,
          onBehalf: employee.id !== employee.ownEmployeeId,
          onBehalfReason: input.onBehalfReason ?? null,
          approvalRouteVersionId: route.id,
          lockedImpact: locked,
        },
      });
      return this.findByIdInTransaction(transaction, context, created.id);
    });
  }

  async preview(
    context: RequestContext,
    correctionId: string,
  ): Promise<AttendanceCorrectionDetail> {
    this.assertPermission(
      context,
      'attendance.corrections.create',
      'ATTENDANCE_CORRECTION_CREATE_FORBIDDEN',
    );
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      await this.lockCorrection(transaction, context.agencyId, correctionId);
      const record = await this.requireCorrection(transaction, context, correctionId);
      this.assertActorMayPrepare(context, record);
      if (!['DRAFT', 'NEEDS_INFORMATION'].includes(record.status)) {
        throw this.boundPreview();
      }
      const preview = await this.computePreviewFromRecord(transaction, context, record);
      await transaction.attendanceCorrection.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: record.id } },
        data: {
          impactPreview: preview as unknown as Prisma.InputJsonValue,
          updatedAt: new Date(),
        },
      });
      return this.findByIdInTransaction(transaction, context, correctionId);
    });
  }

  async submit(
    context: RequestContext,
    correctionId: string,
    rawIdempotencyKey?: string,
  ): Promise<AttendanceCorrectionDetail> {
    this.assertPermission(
      context,
      'attendance.corrections.submit',
      'ATTENDANCE_CORRECTION_SUBMIT_FORBIDDEN',
    );
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const command = fingerprint({ command: 'SUBMIT', correctionId });
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      if (idempotencyKey) {
        const replay = await this.completedCommand(transaction, context, {
          action: 'ATTENDANCE_CORRECTION_SUBMITTED',
          idempotencyKey,
          command,
        });
        if (replay) return this.findByIdInTransaction(transaction, context, replay);
      }
      await this.lockCorrection(transaction, context.agencyId, correctionId);
      const record = await this.requireCorrection(transaction, context, correctionId);
      this.assertActorMayPrepare(context, record);
      if (!['DRAFT', 'NEEDS_INFORMATION'].includes(record.status)) {
        throw this.invalidState(record.status, 'submit');
      }
      const evidenceCount = await transaction.attendanceCorrectionEvidence.count({
        where: { agencyId: context.agencyId, attendanceCorrectionId: record.id },
      });
      if (evidenceCount === 0) throw this.evidenceRequired();
      const preview = await this.computePreviewFromRecord(transaction, context, record);
      const locked = preview.lockedPeriodVersionIds.length > 0;
      const route = await this.resolveCorrectionRoute(
        transaction,
        context,
        locked ? 'LOCKED' : 'OPEN',
      );
      await transaction.attendanceCorrection.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: record.id } },
        data: {
          impactPreview: preview as unknown as Prisma.InputJsonValue,
          approvalRouteVersionId: route.id,
          updatedAt: new Date(),
        },
      });
      const routeCode = CORRECTION_ROUTES[locked ? 'LOCKED' : 'OPEN'].code;
      await this.cancelOpenApprovalWork(
        transaction,
        context,
        record.id,
        'The Attendance Correction was resubmitted.',
      );
      const request = await this.approvals.createRequestInTransaction(
        transaction,
        context,
        {
          routeCode,
          subjectType: ATTENDANCE_CORRECTION_APPROVAL_SUBJECT_TYPE,
          subjectId: record.id,
          effectiveDate: manilaToday(),
        },
        idempotencyKey ? `${idempotencyKey}:approval-create` : undefined,
        route.id,
      );
      await this.approvals.submitInTransaction(
        transaction,
        context,
        request.id,
        idempotencyKey ? `${idempotencyKey}:approval-submit` : undefined,
      );
      await transaction.attendanceCorrection.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: record.id } },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'ATTENDANCE_CORRECTION_SUBMITTED',
        entityType: 'AttendanceCorrection',
        entityId: record.id,
        previousStatus: record.status,
        newStatus: 'SUBMITTED',
        reason: record.reason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          command,
          approvalRequestId: request.id,
          approvalRouteVersionId: route.id,
          lockedImpact: locked,
          affectedWorkDates: preview.days.map((day) => day.workDate),
          previewFingerprint: preview.fingerprint,
        },
      });
      return this.findByIdInTransaction(transaction, context, correctionId);
    });
  }

  async returnForInformation(
    context: RequestContext,
    correctionId: string,
    rawComments: string,
    rawIdempotencyKey?: string,
  ): Promise<AttendanceCorrectionDetail> {
    this.assertPermission(
      context,
      'attendance.corrections.return',
      'ATTENDANCE_CORRECTION_RETURN_FORBIDDEN',
    );
    const comments = rawComments.trim();
    if (!comments) throw this.reasonRequired();
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      await this.lockCorrection(transaction, context.agencyId, correctionId);
      const record = await this.requireCorrection(transaction, context, correctionId);
      await this.assertDecisionSeparation(transaction, context, record);
      if (record.status !== 'SUBMITTED')
        throw this.invalidState(record.status, 'return for information');
      const request = await this.requireActiveApprovalRequest(
        transaction,
        context,
        record,
        CORRECTION_REVIEW_PERMISSIONS,
      );
      await this.approvals.decideInTransaction(
        transaction,
        context,
        request.id,
        'RETURN',
        comments,
        idempotencyKey ? `${idempotencyKey}:approval-return` : undefined,
        this.effectContext('RETURN'),
      );
      await transaction.attendanceCorrection.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: record.id } },
        data: {
          status: 'NEEDS_INFORMATION',
          decidedByMembershipId: context.membershipId,
          decidedAt: new Date(),
          decisionReason: comments,
          updatedAt: new Date(),
        },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'ATTENDANCE_CORRECTION_RETURNED',
        entityType: 'AttendanceCorrection',
        entityId: record.id,
        previousStatus: record.status,
        newStatus: 'NEEDS_INFORMATION',
        reason: comments,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: { approvalRequestId: request.id },
      });
      return this.findByIdInTransaction(transaction, context, correctionId);
    });
  }

  async reject(
    context: RequestContext,
    correctionId: string,
    rawComments: string,
    rawIdempotencyKey?: string,
  ): Promise<AttendanceCorrectionDetail> {
    this.assertPermission(
      context,
      'attendance.corrections.reject',
      'ATTENDANCE_CORRECTION_REJECT_FORBIDDEN',
    );
    const comments = rawComments.trim();
    if (!comments) throw this.reasonRequired();
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      await this.lockCorrection(transaction, context.agencyId, correctionId);
      const record = await this.requireCorrection(transaction, context, correctionId);
      await this.assertDecisionSeparation(transaction, context, record);
      if (record.status !== 'SUBMITTED') throw this.invalidState(record.status, 'reject');
      const request = await this.requireActiveApprovalRequest(
        transaction,
        context,
        record,
        CORRECTION_REVIEW_PERMISSIONS,
      );
      await this.approvals.decideInTransaction(
        transaction,
        context,
        request.id,
        'REJECT',
        comments,
        idempotencyKey ? `${idempotencyKey}:approval-reject` : undefined,
        this.effectContext('REJECT'),
      );
      await transaction.attendanceCorrection.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: record.id } },
        data: {
          status: 'REJECTED',
          decidedByMembershipId: context.membershipId,
          decidedAt: new Date(),
          decisionReason: comments,
          updatedAt: new Date(),
        },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'ATTENDANCE_CORRECTION_REJECTED',
        entityType: 'AttendanceCorrection',
        entityId: record.id,
        previousStatus: record.status,
        newStatus: 'REJECTED',
        reason: comments,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: { approvalRequestId: request.id },
      });
      return this.findByIdInTransaction(transaction, context, correctionId);
    });
  }

  async approve(
    context: RequestContext,
    correctionId: string,
    rawComments: string | undefined,
    rawIdempotencyKey?: string,
  ): Promise<AttendanceCorrectionDetail> {
    this.assertPermission(
      context,
      'attendance.corrections.approve',
      'ATTENDANCE_CORRECTION_APPROVE_FORBIDDEN',
    );
    const comments = rawComments?.trim() ?? '';
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      await this.lockCorrection(transaction, context.agencyId, correctionId);
      const record = await this.requireCorrection(transaction, context, correctionId);
      await this.assertDecisionSeparation(transaction, context, record);
      if (record.status !== 'SUBMITTED') throw this.invalidState(record.status, 'approve');
      const request = await this.requireActiveApprovalRequest(
        transaction,
        context,
        record,
        CORRECTION_REVIEW_PERMISSIONS,
      );
      await this.assertPreviewUnchanged(
        record,
        await this.computePreviewFromRecord(transaction, context, record),
      );
      const summary = await this.approvals.decideInTransaction(
        transaction,
        context,
        request.id,
        'APPROVE',
        comments || undefined,
        idempotencyKey ? `${idempotencyKey}:approval-approve` : undefined,
        this.effectContext('APPROVE'),
      );
      if (summary.status === 'APPROVED') {
        return this.findByIdInTransaction(transaction, context, correctionId);
      }
      if (summary.status !== 'IN_PROGRESS') throw this.routeInvalid();
      await transaction.attendanceCorrection.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: record.id } },
        data: {
          status: 'FOR_AUTHORIZATION',
          decidedByMembershipId: context.membershipId,
          decidedAt: new Date(),
          decisionReason: comments || 'Factual Attendance Correction approved.',
          updatedAt: new Date(),
        },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'ATTENDANCE_CORRECTION_FOR_AUTHORIZATION',
        entityType: 'AttendanceCorrection',
        entityId: record.id,
        previousStatus: record.status,
        newStatus: 'FOR_AUTHORIZATION',
        reason: comments || 'Factual Attendance Correction approved.',
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: { approvalRequestId: request.id },
      });
      return this.findByIdInTransaction(transaction, context, correctionId);
    });
  }

  async authorizeLocked(
    context: RequestContext,
    correctionId: string,
    rawComments: string | undefined,
    rawIdempotencyKey?: string,
  ): Promise<AttendanceCorrectionDetail> {
    this.assertPermission(
      context,
      'attendance.corrections.authorize_locked',
      'ATTENDANCE_CORRECTION_AUTHORIZE_FORBIDDEN',
    );
    const comments = rawComments?.trim() ?? '';
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      await this.lockCorrection(transaction, context.agencyId, correctionId);
      const record = await this.requireCorrection(transaction, context, correctionId);
      if (record.status !== 'FOR_AUTHORIZATION')
        throw this.invalidState(record.status, 'authorize');
      await this.assertMayAuthorize(transaction, context, record);
      const request = await this.requireActiveApprovalRequest(
        transaction,
        context,
        record,
        CORRECTION_AUTHORIZE_PERMISSIONS,
      );
      const summary = await this.approvals.decideInTransaction(
        transaction,
        context,
        request.id,
        'APPROVE',
        comments || undefined,
        idempotencyKey ? `${idempotencyKey}:approval-authorize` : undefined,
        this.effectContext('AUTHORIZE'),
      );
      if (summary.status !== 'APPROVED') throw this.routeInvalid();
      return this.findByIdInTransaction(transaction, context, correctionId);
    });
  }

  /**
   * The authorizer of a Leave handoff cannot change the Leave fact. When it
   * cannot be authorized, they record why; the correction stays pending at
   * FOR_AUTHORIZATION and the Leave workspace shows the reason.
   */
  async recordBlockingReason(
    context: RequestContext,
    correctionId: string,
    rawReason: string,
    rawIdempotencyKey?: string,
  ): Promise<AttendanceCorrectionDetail> {
    this.assertPermission(
      context,
      'attendance.corrections.authorize_locked',
      'ATTENDANCE_CORRECTION_AUTHORIZE_FORBIDDEN',
    );
    const reason = rawReason.trim();
    if (!reason) throw this.reasonRequired();
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const command = fingerprint({ command: 'BLOCK', correctionId, reason });
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      if (idempotencyKey) {
        const replay = await this.completedCommand(transaction, context, {
          action: 'ATTENDANCE_CORRECTION_AUTHORIZATION_BLOCKED',
          idempotencyKey,
          command,
        });
        if (replay) return this.findByIdInTransaction(transaction, context, replay);
      }
      await this.lockCorrection(transaction, context.agencyId, correctionId);
      const record = await this.requireCorrection(transaction, context, correctionId);
      if (record.targetType !== 'POSTED_LEAVE_INPUT' || record.status !== 'FOR_AUTHORIZATION') {
        throw this.invalidState(record.status, 'record a blocking reason');
      }
      await this.assertMayAuthorize(transaction, context, record);
      const request = await this.requireActiveApprovalRequest(
        transaction,
        context,
        record,
        CORRECTION_AUTHORIZE_PERMISSIONS,
      );
      // Only the authority who could authorize may record why they cannot.
      await this.approvals.assertCurrentStepAuthorityInTransaction(
        transaction,
        context,
        request.id,
        'APPROVE',
      );
      await transaction.attendanceCorrection.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: record.id } },
        data: {
          blockingReason: reason,
          blockedByMembershipId: context.membershipId,
          blockedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'ATTENDANCE_CORRECTION_AUTHORIZATION_BLOCKED',
        entityType: 'AttendanceCorrection',
        entityId: record.id,
        previousStatus: record.status,
        newStatus: record.status,
        reason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: { command, approvalRequestId: request.id },
      });
      return this.findByIdInTransaction(transaction, context, correctionId);
    });
  }

  /**
   * Leave's handoff when an applied Leave Cancellation changes posted leave,
   * inside Leave's transaction. Without a finalized Attendance Period across
   * the predecessor's dates, Attendance supersedes the input and recalculates
   * now. Otherwise it accepts a POSTED_LEAVE_INPUT correction at
   * FOR_AUTHORIZATION: the approved cancellation is its factual review, and a
   * different HR Administrator authorizes the Locked Attendance Adjustment.
   */
  async handOffPostedLeaveInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: PostedLeaveHandoffInput,
  ): Promise<PostedLeaveHandoff> {
    const { cancellation, ...posted } = input;
    const predecessor = await transaction.attendancePostedLeaveInput.findFirst({
      where: {
        agencyId: context.agencyId,
        employeeId: posted.employeeId,
        id: posted.predecessorInputId,
      },
      select: { dateFrom: true, dateTo: true },
    });
    if (!predecessor) {
      throw new AttendancePostedLeaveInputError(
        'The predecessor is not a posted-leave input for this Employee.',
        404,
        'POSTED_LEAVE_INPUT_PREDECESSOR_NOT_FOUND',
      );
    }
    // Hold every overlapping period so a concurrent lock waits for this handoff.
    const periods = await transaction.$queryRaw<Array<{ status: string }>>(
      Prisma.sql`SELECT "status" FROM "attendance_periods"
        WHERE "agency_id" = CAST(${context.agencyId} AS uuid)
          AND "date_from" <= CAST(${formatDate(predecessor.dateTo)} AS date)
          AND "date_to" >= CAST(${formatDate(predecessor.dateFrom)} AS date)
        ORDER BY "id"
        FOR UPDATE`,
    );
    if (!periods.some(({ status }) => status === 'FINALIZED')) {
      const successor = await this.days.supersedePostedLeaveInTransaction(
        transaction,
        context,
        posted,
      );
      return { kind: 'RECALCULATED', id: successor.id };
    }
    const requestedAction = posted.quantity > 0 ? 'REPLACE' : 'VOID';
    const fact: RequestedAttendanceFact =
      requestedAction === 'REPLACE'
        ? {
            dateFrom: posted.dateFrom,
            dateTo: posted.dateTo,
            unitCode: posted.unitCode,
            quantity: posted.quantity,
            allocationKind: posted.allocationKind,
          }
        : VOID_FACT;
    const preview = await this.computePreview(
      transaction,
      context,
      posted.employeeId,
      'POSTED_LEAVE_INPUT',
      requestedAction,
      posted.predecessorInputId,
      fact,
    );
    if (
      preview.lockedPeriodVersionIds.length === 0 ||
      preview.days.some((day) => day.periodStatus === 'FINALIZED' && !day.lockedPeriodVersionId)
    ) {
      throw new AttendanceCorrectionServiceError(
        'An affected finalized Attendance Period has no locked version for this Employee to adjust.',
        409,
        'ATTENDANCE_CORRECTION_LOCKED_VERSION_REQUIRED',
      );
    }
    const route = await this.resolveCorrectionRoute(transaction, context, 'POSTED_LEAVE');
    const now = new Date();
    const created = await transaction.attendanceCorrection.create({
      data: {
        agencyId: context.agencyId,
        employeeId: posted.employeeId,
        initiatedByMembershipId: cancellation.requestedByMembershipId,
        recordedByMembershipId: context.membershipId,
        targetType: 'POSTED_LEAVE_INPUT',
        requestedAction,
        targetId: posted.predecessorInputId,
        status: 'FOR_AUTHORIZATION',
        ...(requestedAction === 'REPLACE'
          ? { requestedRecord: this.factRecordJson('POSTED_LEAVE_INPUT', fact) }
          : {}),
        reason: cancellation.reason,
        approvalRouteVersionId: route.id,
        impactPreview: preview as unknown as Prisma.InputJsonValue,
        submittedAt: now,
        decidedByMembershipId: cancellation.approvedByMembershipId,
        decidedAt: cancellation.approvedAt,
        decisionReason: LEAVE_CANCELLATION_DECISION_REASON,
        excludedDeciderMembershipIds: unique([
          cancellation.requestedByMembershipId,
          ...cancellation.deciderMembershipIds,
        ]),
        updatedAt: now,
      },
      select: { id: true },
    });
    await transaction.attendanceCorrectionEvidence.create({
      data: {
        agencyId: context.agencyId,
        attendanceCorrectionId: created.id,
        documentVersionId: null,
        sourceType: posted.sourceType,
        sourceId: posted.sourceId,
      },
    });
    const request = await this.approvals.createRequestInTransaction(
      transaction,
      context,
      {
        routeCode: CORRECTION_ROUTES.POSTED_LEAVE.code,
        subjectType: ATTENDANCE_CORRECTION_APPROVAL_SUBJECT_TYPE,
        subjectId: created.id,
        effectiveDate: manilaToday(),
      },
      undefined,
      route.id,
    );
    await this.approvals.submitInTransaction(transaction, context, request.id);
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action: 'ATTENDANCE_CORRECTION_FOR_AUTHORIZATION',
      entityType: 'AttendanceCorrection',
      entityId: created.id,
      previousStatus: null,
      newStatus: 'FOR_AUTHORIZATION',
      reason: cancellation.reason,
      requestId: context.requestId,
      metadata: {
        source: 'LEAVE_CANCELLATION',
        leaveCancellationId: posted.sourceId,
        predecessorInputId: posted.predecessorInputId,
        approvalRequestId: request.id,
        approvalRouteVersionId: route.id,
        affectedWorkDates: preview.days.map((day) => day.workDate),
        lockedPeriodVersionIds: preview.lockedPeriodVersionIds,
        previewFingerprint: preview.fingerprint,
      },
    });
    return { kind: 'FOR_AUTHORIZATION', id: created.id };
  }

  /** Live status of the corrections Leave handed off, keyed by correction id. */
  async postedLeaveHandoffStatusesInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    correctionIds: readonly string[],
  ): Promise<Map<string, PostedLeaveHandoffStatus>> {
    if (correctionIds.length === 0) return new Map();
    const rows = await transaction.attendanceCorrection.findMany({
      where: { agencyId, id: { in: [...correctionIds] }, targetType: 'POSTED_LEAVE_INPUT' },
      select: { id: true, status: true, blockingReason: true, blockedAt: true },
    });
    return new Map(
      rows.map((row) => [
        row.id,
        {
          correctionId: row.id,
          status: row.status as AttendanceCorrectionState,
          blockingReason: row.blockingReason,
          blockedAt: row.blockedAt ? row.blockedAt.toISOString() : null,
        },
      ]),
    );
  }

  async cancel(
    context: RequestContext,
    correctionId: string,
    rawReason: string,
    rawIdempotencyKey?: string,
  ): Promise<AttendanceCorrectionDetail> {
    this.assertPermission(
      context,
      'attendance.corrections.cancel',
      'ATTENDANCE_CORRECTION_CANCEL_FORBIDDEN',
    );
    const reason = rawReason.trim();
    if (!reason) throw this.reasonRequired();
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      await this.lockCorrection(transaction, context.agencyId, correctionId);
      const record = await this.requireCorrection(transaction, context, correctionId);
      if (!['DRAFT', 'SUBMITTED'].includes(record.status))
        throw this.invalidState(record.status, 'cancel');
      const agencyWide = this.hasAgencyScope(context, 'attendance.corrections.cancel');
      const isPreparer =
        context.membershipId === record.initiatedByMembershipId ||
        context.membershipId === record.recordedByMembershipId;
      if (!agencyWide && !isPreparer) {
        throw this.separationRequired(
          'Only the initiator or a scoped HR Administrator can cancel this Attendance Correction.',
        );
      }
      if (record.status === 'SUBMITTED') {
        await this.cancelOpenApprovalWork(transaction, context, record.id, reason);
      }
      await transaction.attendanceCorrection.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: record.id } },
        data: { status: 'CANCELLED', updatedAt: new Date() },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'ATTENDANCE_CORRECTION_CANCELLED',
        entityType: 'AttendanceCorrection',
        entityId: record.id,
        previousStatus: record.status,
        newStatus: 'CANCELLED',
        reason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {},
      });
      return this.findByIdInTransaction(transaction, context, correctionId);
    });
  }

  async list(
    context: RequestContext,
    filters: AttendanceCorrectionListFilters = {},
  ): Promise<AttendanceCorrectionSummary[]> {
    const scope = await this.days.readScope(context);
    if (
      scope.kind === 'SCOPED' &&
      filters.employeeId &&
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
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const records = await transaction.attendanceCorrection.findMany({
        where: {
          agencyId: context.agencyId,
          ...employeeFilter,
          ...(filters.status ? { status: filters.status } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        select: correctionSelect,
      });
      return records.map(correctionSummary);
    });
  }

  async findById(
    context: RequestContext,
    correctionId: string,
  ): Promise<AttendanceCorrectionDetail> {
    await this.days.readScope(context);
    return withDatabaseContext(databaseContext(context), (transaction) =>
      this.findByIdInTransaction(transaction, context, correctionId),
    );
  }

  private async completeApproval(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    request: ApprovalCompletionRequest,
  ): Promise<void> {
    if (
      request.subjectType !== ATTENDANCE_CORRECTION_APPROVAL_SUBJECT_TYPE ||
      request.effectContext?.kind !== ATTENDANCE_CORRECTION_APPROVAL_EFFECT_KIND
    ) {
      throw this.approvalEffectRequired();
    }
    const command = (request.effectContext.payload as { command?: string } | null)?.command;
    await this.lockCorrection(transaction, context.agencyId, request.subjectId);
    const record = await this.requireCorrection(transaction, context, request.subjectId);
    if (record.approvalRouteVersionId !== request.routeVersionId) throw this.routeInvalid();
    // Serialize against a concurrent Attendance Period lock before refreshing
    // the impact preview, so the preview cannot be computed against a period
    // that is locking at the same moment.
    const storedPreview = parseImpactPreview(record.impactPreview);
    await this.periods.lockAttendancePeriodsInTransaction(
      transaction,
      context.agencyId,
      unique(storedPreview.days.map((day) => day.attendancePeriodId)),
    );
    const preview = await this.computePreviewFromRecord(transaction, context, record);
    // A posted-leave correction rests on the approved Leave Cancellation, not
    // on a reviewer's reading of the preview. An earlier authorization over
    // the same locked period moves its versions forward, so the authorizer
    // applies against the current locked versions and the applied preview is
    // recorded instead.
    if (record.targetType !== 'POSTED_LEAVE_INPUT')
      await this.assertPreviewUnchanged(record, preview);
    const locked = preview.lockedPeriodVersionIds.length > 0;
    if (locked && command !== 'AUTHORIZE') {
      throw this.approvalEffectRequired();
    }
    if (!locked && command !== 'APPROVE') {
      throw this.approvalEffectRequired();
    }
    if (locked) {
      if (record.status !== 'FOR_AUTHORIZATION')
        throw this.invalidState(record.status, 'authorize');
    } else if (record.status !== 'SUBMITTED') {
      throw this.invalidState(record.status, 'approve');
    }
    await this.applyCorrection(transaction, context, record, preview, command === 'AUTHORIZE');
  }

  private async applyCorrection(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    record: CorrectionRecord,
    preview: AttendanceCorrectionImpactPreview,
    locked: boolean,
  ): Promise<void> {
    const now = new Date();
    const fact = await this.normalizedFactFromRecord(record);
    const replacementRecord =
      record.requestedAction === 'VOID'
        ? null
        : this.factRecordJson(record.targetType as AttendanceCorrectionTargetType, fact);
    const effect = await transaction.attendanceCorrectionEffect.create({
      data: {
        agencyId: context.agencyId,
        attendanceCorrectionId: record.id,
        effectAction: record.requestedAction,
        targetType: record.targetType,
        originalTargetId: record.targetId,
        ...(replacementRecord ? { replacementRecord } : {}),
        appliedByMembershipId: context.membershipId,
        appliedAt: now,
      },
      select: { id: true },
    });
    const successorInputId =
      record.targetType === 'POSTED_LEAVE_INPUT'
        ? await this.createPostedLeaveSuccessor(transaction, context, record, fact)
        : null;
    const daysByPeriod = new Map<string, string[]>();
    for (const day of preview.days) {
      const dates = daysByPeriod.get(day.attendancePeriodId) ?? [];
      dates.push(day.workDate);
      daysByPeriod.set(day.attendancePeriodId, dates);
    }
    for (const [attendancePeriodId, workDates] of daysByPeriod) {
      await this.days.recalculateCorrectedWorkDates(transaction, context, {
        attendancePeriodId,
        employeeId: record.employeeId,
        workDates: unique(workDates),
      });
    }
    const successorDayIds = new Map<string, string>();
    for (const day of preview.days) {
      const current = await transaction.attendanceDay.findFirst({
        where: {
          agencyId: context.agencyId,
          employeeId: record.employeeId,
          workDate: toDatabaseDate(day.workDate),
          isCurrent: true,
        },
        select: { id: true },
      });
      if (current) successorDayIds.set(day.workDate, current.id);
    }
    const staleSubmissionIds = await this.markSubmissionsStale(transaction, context, preview);
    let adjustment: { id: string; successorVersionIds: string[] } | null = null;
    if (locked) {
      adjustment = await this.createLockedAdjustment(
        transaction,
        context,
        record,
        preview,
        successorDayIds,
        staleSubmissionIds,
        now,
      );
    }
    const finalizedDtrDocumentIds: string[] = [];
    const payrollPublicationIds: string[] = [];
    for (const successorVersionId of adjustment?.successorVersionIds ?? []) {
      const generated = await this.dtrs.materializeForLockedVersionInTransaction(
        transaction,
        context,
        successorVersionId,
      );
      finalizedDtrDocumentIds.push(...generated.dtrDocumentIds);
      const publication = await this.periods.materializePublicationForLockedVersionInTransaction(
        transaction,
        context,
        successorVersionId,
      );
      payrollPublicationIds.push(publication.publication.id);
    }
    await transaction.attendanceCorrection.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: record.id } },
      data: {
        status: 'APPLIED',
        appliedByMembershipId: context.membershipId,
        appliedAt: now,
        ...(record.targetType === 'POSTED_LEAVE_INPUT'
          ? { impactPreview: preview as unknown as Prisma.InputJsonValue }
          : {}),
        ...(locked
          ? { authorizedByMembershipId: context.membershipId, authorizedAt: now }
          : {
              decidedByMembershipId: context.membershipId,
              decidedAt: now,
              decisionReason: record.decisionReason ?? 'Factual Attendance Correction approved.',
            }),
        updatedAt: now,
      },
    });
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action: 'ATTENDANCE_CORRECTION_APPLIED',
      entityType: 'AttendanceCorrection',
      entityId: record.id,
      previousStatus: record.status,
      newStatus: 'APPLIED',
      reason: record.reason,
      requestId: context.requestId,
      metadata: {
        effectId: effect.id,
        effectAction: record.requestedAction,
        targetType: record.targetType,
        originalTargetId: record.targetId,
        successorPostedLeaveInputId: successorInputId,
        locked,
        affectedWorkDates: preview.days.map((day) => day.workDate),
        successorAttendanceDayIds: [...successorDayIds.values()],
        staleSubmissionIds,
        lockedAttendanceAdjustmentId: adjustment?.id ?? null,
        successorPeriodVersionIds: adjustment?.successorVersionIds ?? [],
        finalizedDtrDocumentIds,
        payrollPublicationIds,
      },
    });
  }

  /**
   * The authorized posted-leave successor. A VOID withdraws the predecessor's
   * coverage with a zero-quantity successor over the same dates.
   */
  private async createPostedLeaveSuccessor(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    record: CorrectionRecord,
    fact: RequestedAttendanceFact,
  ): Promise<string> {
    const [evidence, predecessor] = await Promise.all([
      transaction.attendanceCorrectionEvidence.findFirst({
        where: {
          agencyId: context.agencyId,
          attendanceCorrectionId: record.id,
          sourceType: LEAVE_CANCELLATION_SOURCE_TYPE,
        },
        select: { sourceId: true },
      }),
      transaction.attendancePostedLeaveInput.findFirst({
        where: {
          agencyId: context.agencyId,
          id: record.targetId ?? '',
          employeeId: record.employeeId,
        },
        select: { id: true, dateFrom: true, dateTo: true, unitCode: true, allocationKind: true },
      }),
    ]);
    if (!evidence?.sourceId || !predecessor) throw this.factInvalid();
    const successorFact: RequestedPostedLeaveFact =
      record.requestedAction === 'VOID'
        ? {
            dateFrom: formatDate(predecessor.dateFrom),
            dateTo: formatDate(predecessor.dateTo),
            unitCode: predecessor.unitCode as RequestedPostedLeaveFact['unitCode'],
            quantity: 0,
            allocationKind:
              predecessor.allocationKind as RequestedPostedLeaveFact['allocationKind'],
          }
        : (fact as RequestedPostedLeaveFact);
    const successor = await this.days.createPostedLeaveSuccessorInTransaction(
      transaction,
      context,
      {
        sourceKey: `attendance-correction:${record.id}`,
        employeeId: record.employeeId,
        sourceType: LEAVE_CANCELLATION_SOURCE_TYPE,
        sourceId: evidence.sourceId,
        ...successorFact,
        predecessorInputId: predecessor.id,
      },
    );
    return successor.id;
  }

  private async markSubmissionsStale(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    preview: AttendanceCorrectionImpactPreview,
  ): Promise<string[]> {
    const supersededDayIds = preview.days
      .map((day) => day.attendanceDayId)
      .filter((id): id is string => id !== null);
    if (supersededDayIds.length === 0) return [];
    const links = await transaction.employeeAttendanceSubmissionDay.findMany({
      where: { agencyId: context.agencyId, attendanceDayId: { in: supersededDayIds } },
      select: { employeeAttendanceSubmissionId: true },
    });
    const submissionIds = unique(links.map((link) => link.employeeAttendanceSubmissionId));
    if (submissionIds.length === 0) return [];
    await transaction.employeeAttendanceSubmission.updateMany({
      where: {
        agencyId: context.agencyId,
        id: { in: submissionIds },
        status: { in: ['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED'] },
      },
      data: { status: 'STALE' },
    });
    return submissionIds;
  }

  private async createLockedAdjustment(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    record: CorrectionRecord,
    preview: AttendanceCorrectionImpactPreview,
    successorDayIds: ReadonlyMap<string, string>,
    staleSubmissionIds: readonly string[],
    now: Date,
  ): Promise<{ id: string; successorVersionIds: string[] }> {
    const adjustment = await transaction.lockedAttendanceAdjustment.create({
      data: {
        agencyId: context.agencyId,
        attendanceCorrectionId: record.id,
        authorizedByMembershipId: context.membershipId,
        authorizedAt: now,
      },
      select: { id: true },
    });
    const successorVersionIds: string[] = [];
    for (const lockedVersionId of unique(preview.lockedPeriodVersionIds)) {
      const predecessor = await transaction.attendancePeriodVersion.findFirst({
        where: { agencyId: context.agencyId, id: lockedVersionId },
        select: {
          id: true,
          attendancePeriodId: true,
          versionNo: true,
          days: {
            select: {
              employeeAttendanceSubmissionId: true,
              attendanceDayId: true,
              attendanceDay: { select: { employeeId: true, workDate: true } },
            },
          },
        },
      });
      if (!predecessor) throw this.routeInvalid();
      const maxVersion = await transaction.attendancePeriodVersion.aggregate({
        where: {
          agencyId: context.agencyId,
          attendancePeriodId: predecessor.attendancePeriodId,
        },
        _max: { versionNo: true },
      });
      const affectedWorkDates = new Set(
        preview.days
          .filter((day) => day.lockedPeriodVersionId === lockedVersionId)
          .map((day) => day.workDate),
      );
      const successor = await transaction.attendancePeriodVersion.create({
        data: {
          agencyId: context.agencyId,
          attendancePeriodId: predecessor.attendancePeriodId,
          versionNo: (maxVersion._max.versionNo ?? predecessor.versionNo) + 1,
          predecessorVersionId: predecessor.id,
          status: 'LOCKED',
          approvalRouteVersionId: record.approvalRouteVersionId,
          submittedByMembershipId: context.membershipId,
          submittedAt: now,
          reviewedByMembershipId: record.decidedByMembershipId,
          reviewedAt: record.decidedAt,
          reviewReason: record.decisionReason ?? 'Factual Attendance Correction approved.',
          lockedByMembershipId: context.membershipId,
          lockedAt: now,
          reconciliation: {
            source: 'LOCKED_ATTENDANCE_ADJUSTMENT',
            attendanceCorrectionId: record.id,
            predecessorPeriodVersionId: predecessor.id,
            affectedWorkDates: [...affectedWorkDates].sort(),
            staleSubmissionIds: [...staleSubmissionIds].sort(),
            // A stale Employee Attendance Submission must be resubmitted and
            // approved before the successor can be treated as fully current;
            // the submission workflow belongs to #168.
            requiresResubmission: staleSubmissionIds.length > 0,
          } as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      successorVersionIds.push(successor.id);
      const membershipRows: Prisma.AttendancePeriodVersionDayCreateManyInput[] = [];
      for (const row of predecessor.days) {
        const workDate = formatDate(row.attendanceDay.workDate);
        const isAffected =
          row.attendanceDay.employeeId === record.employeeId && affectedWorkDates.has(workDate);
        membershipRows.push({
          agencyId: context.agencyId,
          attendancePeriodVersionId: successor.id,
          employeeAttendanceSubmissionId: row.employeeAttendanceSubmissionId,
          attendanceDayId: isAffected
            ? (successorDayIds.get(workDate) ?? row.attendanceDayId)
            : row.attendanceDayId,
        });
      }
      if (membershipRows.length > 0) {
        await transaction.attendancePeriodVersionDay.createMany({ data: membershipRows });
      }
      await transaction.lockedAttendanceAdjustmentPeriod.create({
        data: {
          agencyId: context.agencyId,
          lockedAttendanceAdjustmentId: adjustment.id,
          predecessorPeriodVersionId: predecessor.id,
          successorPeriodVersionId: successor.id,
        },
      });
    }
    return { id: adjustment.id, successorVersionIds };
  }

  private async findByIdInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    correctionId: string,
  ): Promise<AttendanceCorrectionDetail> {
    const record = await this.requireCorrection(transaction, context, correctionId);
    await this.assertWithinReadScope(transaction, context, record);
    const [evidence, effect, lockedAdjustment, approval] = await Promise.all([
      transaction.attendanceCorrectionEvidence.findMany({
        where: { agencyId: context.agencyId, attendanceCorrectionId: record.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          documentVersionId: true,
          sourceType: true,
          sourceId: true,
          createdAt: true,
          documentVersion: {
            select: {
              id: true,
              versionNo: true,
              document: { select: { id: true, documentNo: true, documentType: true } },
            },
          },
        },
      }),
      transaction.attendanceCorrectionEffect.findUnique({
        where: { attendanceCorrectionId: record.id },
        select: {
          id: true,
          effectAction: true,
          targetType: true,
          originalTargetId: true,
          replacementRecord: true,
          appliedByMembershipId: true,
          appliedAt: true,
        },
      }),
      transaction.lockedAttendanceAdjustment.findUnique({
        where: { attendanceCorrectionId: record.id },
        select: {
          id: true,
          authorizedByMembershipId: true,
          authorizedAt: true,
          periods: {
            select: {
              predecessorPeriodVersionId: true,
              successorPeriodVersionId: true,
            },
          },
        },
      }),
      transaction.approvalRequest.findFirst({
        where: {
          agencyId: context.agencyId,
          subjectType: ATTENDANCE_CORRECTION_APPROVAL_SUBJECT_TYPE,
          subjectId: record.id,
        },
        orderBy: { requestedAt: 'desc' },
        select: { id: true, routeVersionId: true, status: true, currentStepNo: true },
      }),
    ]);
    return {
      correction: correctionSummary(record),
      impactPreview: parseImpactPreview(record.impactPreview),
      evidence: evidence.map((row) => ({
        id: row.id,
        documentVersionId: row.documentVersionId,
        documentId: row.documentVersion?.document.id ?? null,
        documentNo: row.documentVersion?.document.documentNo ?? null,
        documentType: row.documentVersion?.document.documentType ?? null,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        createdAt: row.createdAt.toISOString(),
      })),
      effect: effect
        ? {
            id: effect.id,
            effectAction: effect.effectAction as AttendanceCorrectionAction,
            targetType: effect.targetType as AttendanceCorrectionTargetType,
            originalTargetId: effect.originalTargetId,
            replacementRecord: effect.replacementRecord,
            appliedByMembershipId: effect.appliedByMembershipId,
            appliedAt: effect.appliedAt.toISOString(),
          }
        : null,
      lockedAdjustment: lockedAdjustment
        ? {
            id: lockedAdjustment.id,
            authorizedByMembershipId: lockedAdjustment.authorizedByMembershipId,
            authorizedAt: lockedAdjustment.authorizedAt.toISOString(),
            periods: lockedAdjustment.periods,
          }
        : null,
      approval: approval
        ? {
            approvalRequestId: approval.id,
            routeVersionId: approval.routeVersionId,
            status: approval.status,
            currentStepNo: approval.currentStepNo,
          }
        : null,
    };
  }

  private async computePreviewFromRecord(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    record: CorrectionRecord,
  ): Promise<AttendanceCorrectionImpactPreview> {
    const fact = await this.normalizedFactFromRecord(record);
    return this.computePreview(
      transaction,
      context,
      record.employeeId,
      record.targetType as AttendanceCorrectionTargetType,
      record.requestedAction as AttendanceCorrectionAction,
      record.targetId,
      fact,
    );
  }

  private async normalizedFactFromRecord(
    record: CorrectionRecord,
  ): Promise<RequestedAttendanceFact> {
    if (record.requestedAction === 'VOID') return VOID_FACT;
    if (record.targetType === 'POSTED_LEAVE_INPUT') {
      const parsed = attendanceCorrectionPostedLeaveFactSchema.safeParse(record.requestedRecord);
      if (!parsed.success) throw this.factInvalid();
      return parsed.data;
    }
    if (record.targetType === 'ATTENDANCE_EVENT') {
      const parsed = attendanceCorrectionEventFactSchema.safeParse(record.requestedRecord);
      if (!parsed.success) throw this.factInvalid();
      return {
        eventType: parsed.data.eventType,
        eventTime: parsed.data.eventTime,
        sourceReference: parsed.data.sourceReference ?? null,
        reason: parsed.data.reason ?? null,
      };
    }
    const parsed = attendanceCorrectionContextFactSchema.safeParse(record.requestedRecord);
    if (!parsed.success) throw this.factInvalid();
    if (parsed.data.coverageMode === 'WHOLE_WORK_DATE') {
      return {
        contextType: parsed.data.contextType,
        coverageMode: 'WHOLE_WORK_DATE',
        workDate: parsed.data.workDate,
        startsAt: null,
        endsAt: null,
        reason: parsed.data.reason,
        sourceType: parsed.data.sourceType ?? null,
        sourceId: parsed.data.sourceId ?? null,
        evidenceDocumentVersionId: parsed.data.evidenceDocumentVersionId ?? null,
      };
    }
    return {
      contextType: parsed.data.contextType,
      coverageMode: 'TIMED',
      workDate: null,
      startsAt: parsed.data.startsAt,
      endsAt: parsed.data.endsAt,
      reason: parsed.data.reason,
      sourceType: parsed.data.sourceType ?? null,
      sourceId: parsed.data.sourceId ?? null,
      evidenceDocumentVersionId: parsed.data.evidenceDocumentVersionId ?? null,
    };
  }

  private async computePreview(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    employeeId: string,
    targetType: AttendanceCorrectionTargetType,
    requestedAction: AttendanceCorrectionAction,
    targetId: string | null,
    fact: RequestedAttendanceFact,
  ): Promise<AttendanceCorrectionImpactPreview> {
    const timezone = await this.agencyTimezone(transaction, context.agencyId);
    const targetWorkDates =
      targetId && requestedAction !== 'ADD'
        ? await this.targetWorkDates(
            transaction,
            context,
            employeeId,
            targetType,
            targetId,
            timezone,
          )
        : [];
    // A posted-leave successor never covers a date outside its predecessor.
    const proposedWorkDates =
      requestedAction !== 'VOID' && targetType !== 'POSTED_LEAVE_INPUT'
        ? await this.proposedWorkDates(transaction, context, employeeId, targetType, fact, timezone)
        : [];
    const affectedDates = unique([...targetWorkDates, ...proposedWorkDates]).sort();
    const days: AttendanceCorrectionImpactPreviewDay[] = [];
    const periods = new Map<string, AttendanceCorrectionImpactPreview['periods'][number]>();
    const lockedPeriodVersionIds = new Set<string>();
    for (const workDate of affectedDates) {
      const current = await transaction.attendanceDay.findFirst({
        where: {
          agencyId: context.agencyId,
          employeeId,
          workDate: toDatabaseDate(workDate),
          isCurrent: true,
        },
        select: {
          id: true,
          calculationVersion: true,
          status: true,
          attendancePeriodId: true,
        },
      });
      const period = current
        ? await transaction.attendancePeriod.findFirst({
            where: { agencyId: context.agencyId, id: current.attendancePeriodId },
            select: { id: true, code: true, dateFrom: true, dateTo: true, status: true },
          })
        : await transaction.attendancePeriod.findFirst({
            where: {
              agencyId: context.agencyId,
              dateFrom: { lte: toDatabaseDate(workDate) },
              dateTo: { gte: toDatabaseDate(workDate) },
            },
            orderBy: { dateFrom: 'desc' },
            select: { id: true, code: true, dateFrom: true, dateTo: true, status: true },
          });
      if (!period) throw this.dateUncovered(workDate);
      periods.set(period.id, {
        id: period.id,
        code: period.code,
        dateFrom: formatDate(period.dateFrom),
        dateTo: formatDate(period.dateTo),
        status: period.status,
      });
      const lockedVersion = await transaction.attendancePeriodVersion.findFirst({
        where: { agencyId: context.agencyId, attendancePeriodId: period.id, status: 'LOCKED' },
        orderBy: { versionNo: 'desc' },
        select: { id: true },
      });
      if (lockedVersion) lockedPeriodVersionIds.add(lockedVersion.id);
      days.push({
        employeeId,
        workDate,
        attendanceDayId: current?.id ?? null,
        calculationVersion: current?.calculationVersion ?? null,
        status: current?.status ?? null,
        attendancePeriodId: period.id,
        periodCode: period.code,
        periodStatus: period.status,
        lockedPeriodVersionId: lockedVersion?.id ?? null,
      });
    }
    const preview = {
      computedAt: new Date().toISOString(),
      targetType,
      requestedAction,
      targetWorkDates: [...targetWorkDates].sort(),
      proposedWorkDates: [...proposedWorkDates].sort(),
      days,
      periods: [...periods.values()],
      lockedPeriodVersionIds: [...lockedPeriodVersionIds].sort(),
    };
    return {
      ...preview,
      fingerprint: fingerprint({
        targetType,
        requestedAction,
        targetId,
        fact,
        // Leave's handoff waits for authorization while open Work Dates keep
        // recalculating, so only the locked days bind its preview.
        days:
          targetType === 'POSTED_LEAVE_INPUT'
            ? preview.days.filter((day) => day.lockedPeriodVersionId !== null)
            : preview.days,
        lockedPeriodVersionIds: preview.lockedPeriodVersionIds,
      }),
    };
  }

  private async targetWorkDates(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    employeeId: string,
    targetType: AttendanceCorrectionTargetType,
    targetId: string,
    timezone: string,
  ): Promise<string[]> {
    if (targetType === 'POSTED_LEAVE_INPUT') {
      const input = await transaction.attendancePostedLeaveInput.findFirst({
        where: { agencyId: context.agencyId, id: targetId, employeeId },
        select: { dateFrom: true, dateTo: true },
      });
      if (!input) throw this.targetNotFound();
      // Only a calculated Attendance Day changes when posted leave changes.
      const days = await transaction.attendanceDay.findMany({
        where: {
          agencyId: context.agencyId,
          employeeId,
          isCurrent: true,
          workDate: { gte: input.dateFrom, lte: input.dateTo },
        },
        select: { workDate: true },
      });
      return days.map(({ workDate }) => formatDate(workDate));
    }
    if (targetType === 'ATTENDANCE_EVENT') {
      const event = await transaction.attendanceEvent.findFirst({
        where: { agencyId: context.agencyId, id: targetId, employeeId },
        select: { eventTime: true },
      });
      if (!event) throw this.targetNotFound();
      const match = await this.attendance.matchEventWorkDateInTransaction(
        transaction,
        context.agencyId,
        employeeId,
        event.eventTime,
      );
      return match.workDate ? [match.workDate] : [];
    }
    const record = await transaction.attendanceContext.findFirst({
      where: { agencyId: context.agencyId, id: targetId, employeeId },
      select: { coverageMode: true, workDate: true, startsAt: true, endsAt: true },
    });
    if (!record) throw this.targetNotFound();
    if (record.coverageMode === 'WHOLE_WORK_DATE') {
      return record.workDate ? [formatDate(record.workDate)] : [];
    }
    return this.contextOverlappingWorkDates(
      transaction,
      context,
      employeeId,
      {
        contextType: 'OFFICIAL_BUSINESS',
        coverageMode: 'TIMED',
        workDate: null,
        startsAt: record.startsAt ? record.startsAt.toISOString() : null,
        endsAt: record.endsAt ? record.endsAt.toISOString() : null,
        reason: '',
        sourceType: null,
        sourceId: null,
        evidenceDocumentVersionId: null,
      },
      timezone,
    );
  }

  private async proposedWorkDates(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    employeeId: string,
    targetType: AttendanceCorrectionTargetType,
    fact: RequestedAttendanceFact,
    timezone: string,
  ): Promise<string[]> {
    if (targetType === 'ATTENDANCE_EVENT') {
      const eventFact = fact as RequestedAttendanceEventFact;
      const match = await this.attendance.matchEventWorkDateInTransaction(
        transaction,
        context.agencyId,
        employeeId,
        new Date(eventFact.eventTime),
      );
      return match.workDate ? [match.workDate] : [];
    }
    const contextFact = fact as RequestedAttendanceContextFact;
    if (contextFact.coverageMode === 'WHOLE_WORK_DATE') {
      return contextFact.workDate ? [contextFact.workDate] : [];
    }
    return this.contextOverlappingWorkDates(
      transaction,
      context,
      employeeId,
      contextFact,
      timezone,
    );
  }

  private async contextOverlappingWorkDates(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    employeeId: string,
    fact: RequestedAttendanceContextFact,
    timezone: string,
  ): Promise<string[]> {
    if (fact.coverageMode === 'WHOLE_WORK_DATE') {
      return fact.workDate ? [fact.workDate] : [];
    }
    if (!fact.startsAt || !fact.endsAt) return [];
    const startsAt = new Date(fact.startsAt);
    const endsAt = new Date(fact.endsAt);
    if (endsAt.getTime() <= startsAt.getTime()) throw this.factInvalid();
    const firstDate = addDateValueDays(localDateValue(startsAt, timezone), -1);
    const lastDate = addDateValueDays(localDateValue(endsAt, timezone), 1);
    const dates: string[] = [];
    let cursor = firstDate;
    let guard = 0;
    while (cursor <= lastDate) {
      guard += 1;
      if (guard > MAX_CONTEXT_ENUMERATION_DAYS) throw this.rangeInvalid();
      try {
        const resolution = await this.assignments.resolveForWorkDateInTransaction(
          transaction,
          context.agencyId,
          employeeId,
          cursor,
        );
        const window = this.coverageWindow(
          resolution.dayRule,
          cursor,
          resolution.workScheduleVersion.timezone,
        );
        if (
          startsAt.getTime() < window.endsAt.getTime() &&
          endsAt.getTime() > window.startsAt.getTime()
        ) {
          dates.push(cursor);
        }
      } catch {
        // A date without complete applicability has no calculable Attendance Day.
      }
      cursor = addDateValueDays(cursor, 1);
    }
    return dates;
  }

  private coverageWindow(
    dayRule: { ruleType: string },
    workDate: string,
    timezone: string,
  ): { startsAt: Date; endsAt: Date } {
    const window = eventCollectionWindow(
      dayRule as Parameters<typeof eventCollectionWindow>[0],
      workDate,
      timezone,
    );
    if (window) return { startsAt: window.start, endsAt: window.end };
    return {
      startsAt: zonedTimeToInstant(workDate, '00:00', timezone),
      endsAt: zonedTimeToInstant(addDateValueDays(workDate, 1), '00:00', timezone),
    };
  }

  private async validateTargetFact(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    employeeId: string,
    targetType: AttendanceCorrectionTargetType,
    requestedAction: AttendanceCorrectionAction,
    targetId: string | undefined,
  ): Promise<void> {
    if (requestedAction === 'ADD') return;
    if (!targetId) throw this.targetNotFound();
    if (targetType === 'ATTENDANCE_EVENT') {
      const event = await transaction.attendanceEvent.findFirst({
        where: { agencyId: context.agencyId, id: targetId, employeeId },
        select: { id: true },
      });
      if (!event) throw this.targetNotFound();
      return;
    }
    const record = await transaction.attendanceContext.findFirst({
      where: { agencyId: context.agencyId, id: targetId, employeeId },
      select: { id: true },
    });
    if (!record) throw this.targetNotFound();
  }

  private validateRequestedFact(input: AttendanceCorrectionCreateInput): void {
    if (input.requestedAction === 'VOID') return;
    if (input.targetType === 'ATTENDANCE_EVENT') {
      const eventTime = new Date(input.requestedRecord!.eventTime);
      if (Number.isNaN(eventTime.getTime())) throw this.factInvalid();
      if (eventTime.getTime() > Date.now() + 60_000) throw this.factInvalid();
      return;
    }
    const record = input.requestedRecord!;
    if (
      record.coverageMode === 'TIMED' &&
      new Date(record.endsAt).getTime() <= new Date(record.startsAt).getTime()
    ) {
      throw this.factInvalid();
    }
  }

  private requestedRecordJson(
    input: AttendanceCorrectionCreateInput,
  ): Prisma.InputJsonValue | null {
    if (input.requestedAction === 'VOID') return null;
    return this.factRecordJson(input.targetType, normalizeFact(input));
  }

  private factRecordJson(
    targetType: AttendanceCorrectionTargetType,
    fact: RequestedAttendanceFact,
  ): Prisma.InputJsonValue {
    if (targetType === 'POSTED_LEAVE_INPUT') return { ...(fact as RequestedPostedLeaveFact) };
    if (targetType === 'ATTENDANCE_EVENT') {
      const record = fact as RequestedAttendanceEventFact;
      return {
        eventType: record.eventType,
        eventTime: record.eventTime,
        ...(record.sourceReference ? { sourceReference: record.sourceReference } : {}),
        ...(record.reason ? { reason: record.reason } : {}),
      };
    }
    const record = fact as RequestedAttendanceContextFact;
    return {
      contextType: record.contextType,
      coverageMode: record.coverageMode,
      ...(record.workDate ? { workDate: record.workDate } : {}),
      ...(record.startsAt ? { startsAt: record.startsAt } : {}),
      ...(record.endsAt ? { endsAt: record.endsAt } : {}),
      reason: record.reason,
      ...(record.sourceType ? { sourceType: record.sourceType } : {}),
      ...(record.sourceId ? { sourceId: record.sourceId } : {}),
      ...(record.evidenceDocumentVersionId
        ? { evidenceDocumentVersionId: record.evidenceDocumentVersionId }
        : {}),
    };
  }

  private async resolveCorrectionRoute(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    kind: CorrectionRouteKind,
  ): Promise<ApprovalRouteSummary> {
    const { code, steps: expected } = CORRECTION_ROUTES[kind];
    const route = await this.approvals.resolveActiveRouteInTransaction(
      transaction,
      context,
      code,
      manilaToday(),
    );
    const steps = route.stepDefinition.steps;
    if (
      steps.length !== expected.length ||
      steps.some(
        (step, index) => step.stepNo !== index + 1 || step.requiredPermission !== expected[index],
      )
    ) {
      throw this.routeInvalid();
    }
    return route;
  }

  private async resolveSubjectEmployee(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    requestedEmployeeId?: string,
  ): Promise<{ id: string; ownEmployeeId: string | null }> {
    const membership = await transaction.agencyMembership.findFirst({
      where: { agencyId: context.agencyId, id: context.membershipId },
      select: { employeeId: true },
    });
    const ownEmployeeId = membership?.employeeId ?? null;
    const employeeId = requestedEmployeeId ?? ownEmployeeId;
    if (!employeeId) {
      throw new AttendanceCorrectionServiceError(
        'An HR Administrator creating on behalf must name the Employee subject.',
        400,
        'ATTENDANCE_CORRECTION_SUBJECT_REQUIRED',
      );
    }
    const employee = await transaction.employee.findFirst({
      where: { agencyId: context.agencyId, id: employeeId },
      select: { id: true },
    });
    if (!employee) throw this.employeeNotFound();
    if (
      employeeId !== ownEmployeeId &&
      !this.hasAgencyScope(context, 'attendance.corrections.create')
    ) {
      throw this.createForbidden();
    }
    return { id: employee.id, ownEmployeeId };
  }

  private assertActorMayPrepare(context: RequestContext, record: CorrectionRecord): void {
    const isPreparer =
      context.membershipId === record.initiatedByMembershipId ||
      context.membershipId === record.recordedByMembershipId;
    if (!isPreparer && !this.hasAgencyScope(context, 'attendance.corrections.submit')) {
      throw this.separationRequired(
        'Only the initiator, recorder, or a scoped HR Administrator can prepare this Attendance Correction.',
      );
    }
  }

  private async assertDecisionSeparation(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    record: CorrectionRecord,
  ): Promise<void> {
    if (
      context.membershipId === record.initiatedByMembershipId ||
      context.membershipId === record.recordedByMembershipId
    ) {
      throw this.separationRequired(
        'The initiator or recorder cannot decide the same Attendance Correction.',
      );
    }
    if (record.excludedDeciderMembershipIds.includes(context.membershipId)) {
      throw this.separationRequired(
        'The Leave Cancellation requester or approvers cannot authorize its Attendance Correction.',
      );
    }
    const subjectMembership = await transaction.agencyMembership.findFirst({
      where: {
        agencyId: context.agencyId,
        id: context.membershipId,
        employeeId: record.employeeId,
      },
      select: { id: true },
    });
    if (subjectMembership) {
      throw this.separationRequired(
        'The Employee subject cannot decide their own Attendance Correction.',
      );
    }
  }

  private async assertMayAuthorize(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    record: CorrectionRecord,
  ): Promise<void> {
    await this.assertDecisionSeparation(transaction, context, record);
    if (record.decidedByMembershipId === context.membershipId) {
      throw this.separationRequired(
        'The factual approver cannot authorize the same Attendance Correction.',
      );
    }
  }

  private async assertWithinReadScope(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    record: CorrectionRecord,
  ): Promise<void> {
    const scope = await this.days.readScope(context);
    if (scope.kind === 'SCOPED' && !scope.employeeIds.includes(record.employeeId)) {
      throw this.notFound();
    }
    void transaction;
  }

  private async requireActiveApprovalRequest(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    record: CorrectionRecord,
    allowedPermissions: readonly string[],
  ): Promise<{ id: string; status: string; currentStepNo: number | null }> {
    const request = await transaction.approvalRequest.findFirst({
      where: {
        agencyId: context.agencyId,
        subjectType: ATTENDANCE_CORRECTION_APPROVAL_SUBJECT_TYPE,
        subjectId: record.id,
      },
      orderBy: { requestedAt: 'desc' },
      select: {
        id: true,
        status: true,
        currentStepNo: true,
        steps: {
          where: { status: 'ACTIVE' },
          select: { stepNo: true, requiredPermission: true, assignedMembershipId: true },
        },
      },
    });
    const step = request?.steps.find((candidate) => candidate.stepNo === request.currentStepNo);
    if (
      !request ||
      request.status !== 'IN_PROGRESS' ||
      !step ||
      !allowedPermissions.includes(step.requiredPermission)
    ) {
      throw this.routeInvalid();
    }
    return { id: request.id, status: request.status, currentStepNo: request.currentStepNo };
  }

  private async cancelOpenApprovalWork(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    correctionId: string,
    reason: string,
  ): Promise<void> {
    const request = await transaction.approvalRequest.findFirst({
      where: {
        agencyId: context.agencyId,
        subjectType: ATTENDANCE_CORRECTION_APPROVAL_SUBJECT_TYPE,
        subjectId: correctionId,
        status: { in: ['PENDING', 'IN_PROGRESS', 'RETURNED'] },
      },
      orderBy: { requestedAt: 'desc' },
      select: { id: true },
    });
    if (request) {
      await this.approvals.cancelInTransaction(transaction, context, request.id, reason);
    }
  }

  private async assertPreviewUnchanged(
    record: CorrectionRecord,
    preview: AttendanceCorrectionImpactPreview,
  ): Promise<void> {
    const stored = parseImpactPreview(record.impactPreview);
    if (stored.fingerprint !== preview.fingerprint) {
      throw new AttendanceCorrectionServiceError(
        'The Attendance Correction Impact Preview is stale. Refresh and submit the correction again.',
        409,
        'ATTENDANCE_CORRECTION_STALE_PREVIEW',
      );
    }
  }

  private async requireCorrection(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    correctionId: string,
  ): Promise<CorrectionRecord> {
    const record = await transaction.attendanceCorrection.findFirst({
      where: { agencyId: context.agencyId, id: correctionId },
      select: correctionSelect,
    });
    if (!record) throw this.notFound();
    return record;
  }

  private async lockCorrection(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    correctionId: string,
  ): Promise<void> {
    await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "attendance_corrections" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${correctionId} AS uuid) FOR UPDATE`,
    );
  }

  private async completedCommand(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: { action: string; idempotencyKey: string; command: string },
  ): Promise<string | null> {
    const completed = await transaction.auditEvent.findFirst({
      where: {
        agencyId: context.agencyId,
        action: input.action,
        idempotencyKey: input.idempotencyKey,
      },
      select: { entityId: true, metadata: true },
    });
    if (!completed) return null;
    if (metadataString(completed.metadata, 'command') !== input.command) {
      throw this.idempotencyConflict();
    }
    return completed.entityId;
  }

  private async agencyTimezone(
    transaction: Prisma.TransactionClient,
    agencyId: string,
  ): Promise<string> {
    const agency = await transaction.agency.findFirst({
      where: { id: agencyId },
      select: { defaultTimezone: true },
    });
    return agency?.defaultTimezone ?? 'Asia/Manila';
  }

  private effectContext(
    command: 'APPROVE' | 'AUTHORIZE' | 'RETURN' | 'REJECT',
  ): ApprovalEffectContext {
    return { kind: ATTENDANCE_CORRECTION_APPROVAL_EFFECT_KIND, payload: { command } };
  }

  private hasAgencyScope(context: RequestContext, permission: string): boolean {
    return context.permissions.some(
      (grant) => grant.code === permission && grant.scopePolicy === 'AGENCY',
    );
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (
      !context.agencyId ||
      !context.userId ||
      !context.membershipId ||
      !hasPermission(context, permission)
    ) {
      throw new AttendanceCorrectionServiceError(
        'The current Agency Membership lacks the required permission.',
        403,
        code,
      );
    }
  }

  private notFound(): AttendanceCorrectionServiceError {
    return new AttendanceCorrectionServiceError(
      'The requested Attendance Correction could not be found.',
      404,
      'ATTENDANCE_CORRECTION_NOT_FOUND',
    );
  }

  private createForbidden(): AttendanceCorrectionServiceError {
    return new AttendanceCorrectionServiceError(
      'The attendance.corrections.create permission is required.',
      403,
      'ATTENDANCE_CORRECTION_CREATE_FORBIDDEN',
    );
  }

  private employeeNotFound(): AttendanceCorrectionServiceError {
    return new AttendanceCorrectionServiceError(
      'The Employee subject could not be found in this Agency.',
      404,
      'ATTENDANCE_CORRECTION_EMPLOYEE_NOT_FOUND',
    );
  }

  private targetNotFound(): AttendanceCorrectionServiceError {
    return new AttendanceCorrectionServiceError(
      'The corrected Attendance Event or Attendance Context could not be found for this Employee.',
      404,
      'ATTENDANCE_CORRECTION_TARGET_NOT_FOUND',
    );
  }

  private evidenceInvalid(): AttendanceCorrectionServiceError {
    return new AttendanceCorrectionServiceError(
      'Attendance Correction evidence must reference a finalized Document Version.',
      409,
      'ATTENDANCE_CORRECTION_EVIDENCE_INVALID',
    );
  }

  private evidenceRequired(): AttendanceCorrectionServiceError {
    return new AttendanceCorrectionServiceError(
      'An Attendance Correction needs at least one immutable evidence reference before submission.',
      409,
      'ATTENDANCE_CORRECTION_EVIDENCE_REQUIRED',
    );
  }

  private factInvalid(): AttendanceCorrectionServiceError {
    return new AttendanceCorrectionServiceError(
      'The requested Attendance Correction fact is invalid.',
      400,
      'ATTENDANCE_CORRECTION_FACT_INVALID',
    );
  }

  private rangeInvalid(): AttendanceCorrectionServiceError {
    return new AttendanceCorrectionServiceError(
      'The requested Attendance Context spans more Work Dates than one correction may cover.',
      400,
      'ATTENDANCE_CORRECTION_RANGE_INVALID',
    );
  }

  private onBehalfReasonRequired(): AttendanceCorrectionServiceError {
    return new AttendanceCorrectionServiceError(
      'An HR Administrator creating on behalf must record why the correction was raised for the Employee.',
      400,
      'ATTENDANCE_CORRECTION_ON_BEHALF_REASON_REQUIRED',
    );
  }

  private reasonRequired(): AttendanceCorrectionServiceError {
    return new AttendanceCorrectionServiceError(
      'A reason is required.',
      400,
      'ATTENDANCE_CORRECTION_REASON_REQUIRED',
    );
  }

  private dateUncovered(workDate: string): AttendanceCorrectionServiceError {
    return new AttendanceCorrectionServiceError(
      'An affected Work Date is not covered by an Attendance Period.',
      409,
      'ATTENDANCE_CORRECTION_DATE_UNCOVERED',
      [`WORK_DATE:${workDate}`],
    );
  }

  private boundPreview(): AttendanceCorrectionServiceError {
    return new AttendanceCorrectionServiceError(
      'The Attendance Correction Impact Preview is bound once submitted.',
      409,
      'ATTENDANCE_CORRECTION_PREVIEW_BOUND',
    );
  }

  private invalidState(status: string, action: string): AttendanceCorrectionServiceError {
    return new AttendanceCorrectionServiceError(
      `The Attendance Correction cannot ${action} from its current state.`,
      409,
      'ATTENDANCE_CORRECTION_STATE_INVALID',
      [`STATE:${status}`],
    );
  }

  private separationRequired(message: string): AttendanceCorrectionServiceError {
    return new AttendanceCorrectionServiceError(
      message,
      403,
      'ATTENDANCE_CORRECTION_SEPARATION_REQUIRED',
    );
  }

  private routeInvalid(): AttendanceCorrectionServiceError {
    return new AttendanceCorrectionServiceError(
      'The Attendance Correction Approval Route is not the required factual and authorization sequence.',
      409,
      'ATTENDANCE_CORRECTION_ROUTE_INVALID',
    );
  }

  private approvalEffectRequired(): AttendanceCorrectionServiceError {
    return new AttendanceCorrectionServiceError(
      'Attendance Correction decisions must be recorded through the Attendance Correction authority.',
      409,
      'ATTENDANCE_CORRECTION_APPROVAL_EFFECT_REQUIRED',
    );
  }

  private idempotencyConflict(): AttendanceCorrectionServiceError {
    return new AttendanceCorrectionServiceError(
      'The Idempotency-Key was already used with different Attendance Correction input.',
      409,
      'ATTENDANCE_CORRECTION_IDEMPOTENCY_CONFLICT',
    );
  }
}
