import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import {
  personnelActionCreateSchema,
  type PersonnelActionEvidenceInput,
  type PersonnelActionInput,
} from './personnel-actions.schemas';

export const PERSONNEL_ACTION_STATUSES = [
  'DRAFT',
  'FOR_REVIEW',
  'FOR_APPROVAL',
  'APPROVED',
  'EFFECTIVE',
  'RETURNED',
  'REJECTED',
  'CANCELLED',
  'SUPERSEDED',
] as const;

export type PersonnelActionStatus = (typeof PERSONNEL_ACTION_STATUSES)[number];

export interface PersonnelActionSummary {
  id: string;
  actionType: PersonnelActionInput['actionType'];
  status: PersonnelActionStatus;
  employee: {
    id: string;
    employeeNumber: string;
    legalName: string;
    serviceStatus: string;
  };
  currentVersion: PersonnelActionVersionSummary;
  preparedBy: { id: string; displayName: string };
  approvedBy: { id: string; displayName: string } | null;
  approvalDelegationId: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  effectuatedAt: string | null;
  effect: {
    serviceSegmentId: string;
    salaryGrade: number | null;
    salaryStep: number | null;
  } | null;
  supersedesActionId: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export interface PersonnelActionVersionSummary {
  id: string;
  versionNo: number;
  proposedEffectivity: string;
  fromServiceSegment: {
    id: string;
    positionId: string | null;
    organizationUnitId: string;
    appointmentStatus: string;
    salaryGrade: number | null;
    salaryStep: number | null;
    effectiveFrom: string;
    effectiveTo: string | null;
    status: string;
  };
  targetPositionId: string | null;
  targetOrganizationUnitId: string | null;
  targetFacts: Prisma.JsonValue;
  reason: string;
  evidence: PersonnelActionEvidenceSummary[];
  createdAt: string;
}

export interface PersonnelActionEvidenceSummary {
  id: string;
  evidenceType: PersonnelActionEvidenceInput['evidenceType'];
  sourceDate: string;
  document: {
    id: string;
    documentNo: string | null;
    documentType: string;
    classification: string;
    status: string;
    versionId: string;
    versionNo: number;
  };
}

export interface PersonnelActionHistoryEntry {
  id: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  requestId: string | null;
  metadata: Prisma.JsonValue;
  actor: { membershipId: string | null; displayName: string | null };
  occurredAt: string;
}

export interface PersonnelActionHistory {
  action: PersonnelActionSummary;
  versions: PersonnelActionVersionSummary[];
  entries: PersonnelActionHistoryEntry[];
}

export interface PersonnelActionAuthority {
  canApprove: boolean;
  canReject: boolean;
  canCancelApproved: boolean;
}

export interface PersonnelActionAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const PERSONNEL_ACTION_AUDIT_WRITER = Symbol('PERSONNEL_ACTION_AUDIT_WRITER');

export const personnelActionAuditWriter: PersonnelActionAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};

export class PersonnelActionServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PersonnelActionServiceError';
  }
}

const REQUIRED_EVIDENCE: Record<
  PersonnelActionInput['actionType'],
  readonly PersonnelActionEvidenceInput['evidenceType'][]
> = {
  REASSIGNMENT: [
    'OFFICE_ORDER',
    'AUTHORITY',
    'CURRENT_APPOINTMENT_STATION',
    'RECEIVING_DUTIES',
    'APPEAL_STATE',
  ],
  DETAIL: ['DETAIL_ORDER', 'INTER_AGENCY_AGREEMENT', 'AUTHORITY', 'LEAVE_CERTIFICATION'],
  DESIGNATION: ['OFFICE_ORDER', 'AUTHORITY', 'PERMANENT_APPOINTMENT', 'QUALIFICATION'],
  SECONDMENT: [
    'SIGNED_MOA',
    'AUTHORITY',
    'ELIGIBILITY',
    'PERFORMANCE_RATING',
    'EXPERIENCE',
    'CSC_SUBMISSION',
  ],
  SAME_ITEM_REINSTATEMENT: [
    'EXECUTORY_DECISION',
    'PRIOR_SEPARATION',
    'NO_MISCONDUCT',
    'ORIGINAL_ITEM',
    'BACK_PAY_DETERMINATION',
  ],
  SEPARATION_RESIGNATION: ['WRITTEN_RESIGNATION', 'ACCEPTANCE', 'NOTICE', 'WITHDRAWAL_STATE'],
  SEPARATION_DISMISSAL: ['EXECUTORY_DECISION', 'CSC_SUBMISSION', 'APPEAL_STATE'],
  SEPARATION_DROPPING_FROM_ROLLS: ['DROPPING_ORDER', 'ABSENCE_RECORD', 'NOTICE', 'DUE_PROCESS'],
  SEPARATION_EXPIRATION: ['APPOINTMENT_TERM', 'CSC_SUBMISSION'],
  SEPARATION_TERMINATION: ['APPOINTMENT_TERM', 'TERMINATION_ORDER', 'CSC_SUBMISSION'],
  SEPARATION_RETIREMENT: ['GSIS_COVERAGE', 'ELIGIBILITY', 'RETIREMENT_NOTICE'],
  SEPARATION_DEATH: ['DEATH_CERTIFICATE', 'CSC_SUBMISSION'],
  SALARY_ADJUSTMENT: [
    'PAY_AUTHORITY',
    'SALARY_ADJUSTMENT_NOTICE',
    'CURRENT_COMPENSATION',
    'PAY_TABLE_VERSION',
  ],
  STEP_INCREMENT: ['NOSI', 'CURRENT_COMPENSATION', 'PERFORMANCE_OR_SERVICE', 'SERVICE_CONTINUITY'],
};

const APPROVABLE_ACTIONS = new Set<PersonnelActionInput['actionType']>([
  'SAME_ITEM_REINSTATEMENT',
  'SEPARATION_RESIGNATION',
  'SEPARATION_DISMISSAL',
  'SEPARATION_DROPPING_FROM_ROLLS',
  'SEPARATION_EXPIRATION',
  'SEPARATION_TERMINATION',
  'SEPARATION_RETIREMENT',
  'SEPARATION_DEATH',
  'SALARY_ADJUSTMENT',
  'STEP_INCREMENT',
]);

export function personnelActionCanBeApproved(
  actionType: PersonnelActionInput['actionType'],
): boolean {
  return APPROVABLE_ACTIONS.has(actionType);
}

const evidenceSelect = {
  id: true,
  evidenceType: true,
  sourceDate: true,
  document: {
    select: {
      id: true,
      documentNo: true,
      documentType: true,
      classification: true,
      status: true,
    },
  },
  documentVersion: { select: { id: true, versionNo: true } },
} as const;

const versionSelect = {
  id: true,
  versionNo: true,
  proposedEffectivity: true,
  fromServiceSegmentId: true,
  targetPositionId: true,
  targetOrganizationUnitId: true,
  targetFacts: true,
  reason: true,
  createdAt: true,
  fromServiceSegment: {
    select: {
      id: true,
      appointmentId: true,
      positionId: true,
      organizationUnitId: true,
      segmentType: true,
      appointmentStatus: true,
      salaryGrade: true,
      salaryStep: true,
      effectiveFrom: true,
      effectiveTo: true,
      status: true,
    },
  },
  evidence: { orderBy: { evidenceType: 'asc' as const }, select: evidenceSelect },
} as const;

const actionSelect = {
  id: true,
  agencyId: true,
  employeeId: true,
  actionType: true,
  status: true,
  currentVersionId: true,
  preparedByMembershipId: true,
  approvedByMembershipId: true,
  approvalDelegationId: true,
  approvedAt: true,
  cancelledAt: true,
  effectuatedAt: true,
  effectuationKey: true,
  supersedesActionId: true,
  createdAt: true,
  updatedAt: true,
  rowVersion: true,
  employee: {
    select: { id: true, employeeNumber: true, legalName: true, serviceStatus: true },
  },
  currentVersion: { select: versionSelect },
  preparedBy: { select: { id: true, user: { select: { displayName: true } } } },
  approvedBy: { select: { id: true, user: { select: { displayName: true } } } },
  serviceSegments: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { id: true, salaryGrade: true, salaryStep: true },
  },
} as const;

type ActionRecord = Prisma.PersonnelActionGetPayload<{ select: typeof actionSelect }>;
type VersionRecord = Prisma.PersonnelActionVersionGetPayload<{ select: typeof versionSelect }>;

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatDateTime(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function databaseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatDate(date) !== value) {
    throw new PersonnelActionServiceError(
      'Enter a valid Personnel Action date.',
      400,
      'PERSONNEL_ACTION_DATE_INVALID',
    );
  }
  return date;
}

function daysBetween(start: string, end: string): number {
  return Math.round((databaseDate(end).getTime() - databaseDate(start).getTime()) / 86_400_000);
}

function manilaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function versionSummary(record: VersionRecord): PersonnelActionVersionSummary {
  return {
    id: record.id,
    versionNo: record.versionNo,
    proposedEffectivity: formatDate(record.proposedEffectivity),
    fromServiceSegment: {
      ...record.fromServiceSegment,
      effectiveFrom: formatDate(record.fromServiceSegment.effectiveFrom),
      effectiveTo: record.fromServiceSegment.effectiveTo
        ? formatDate(record.fromServiceSegment.effectiveTo)
        : null,
    },
    targetPositionId: record.targetPositionId,
    targetOrganizationUnitId: record.targetOrganizationUnitId,
    targetFacts: record.targetFacts,
    reason: record.reason,
    evidence: record.evidence.map((item) => ({
      id: item.id,
      evidenceType: item.evidenceType as PersonnelActionEvidenceInput['evidenceType'],
      sourceDate: formatDate(item.sourceDate),
      document: {
        ...item.document,
        versionId: item.documentVersion.id,
        versionNo: item.documentVersion.versionNo,
      },
    })),
    createdAt: record.createdAt.toISOString(),
  };
}

function actionSummary(record: ActionRecord): PersonnelActionSummary {
  if (!record.currentVersion) {
    throw new PersonnelActionServiceError(
      'The Personnel Action has no current version.',
      409,
      'PERSONNEL_ACTION_VERSION_MISSING',
    );
  }
  return {
    id: record.id,
    actionType: record.actionType as PersonnelActionInput['actionType'],
    status: record.status as PersonnelActionStatus,
    employee: record.employee,
    currentVersion: versionSummary(record.currentVersion),
    preparedBy: { id: record.preparedBy.id, displayName: record.preparedBy.user.displayName },
    approvedBy: record.approvedBy
      ? { id: record.approvedBy.id, displayName: record.approvedBy.user.displayName }
      : null,
    approvalDelegationId: record.approvalDelegationId,
    approvedAt: formatDateTime(record.approvedAt),
    cancelledAt: formatDateTime(record.cancelledAt),
    effectuatedAt: formatDateTime(record.effectuatedAt),
    effect: record.serviceSegments[0]
      ? {
          serviceSegmentId: record.serviceSegments[0].id,
          salaryGrade: record.serviceSegments[0].salaryGrade,
          salaryStep: record.serviceSegments[0].salaryStep,
        }
      : null,
    supersedesActionId: record.supersedesActionId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    rowVersion: record.rowVersion,
  };
}

function inputFromAction(record: ActionRecord): PersonnelActionInput {
  if (!record.currentVersion) {
    throw new PersonnelActionServiceError(
      'The Personnel Action has no current version.',
      409,
      'PERSONNEL_ACTION_VERSION_MISSING',
    );
  }
  return personnelActionCreateSchema.parse({
    employeeId: record.employeeId,
    actionType: record.actionType,
    proposedEffectivity: formatDate(record.currentVersion.proposedEffectivity),
    targetFacts: record.currentVersion.targetFacts,
    reason: record.currentVersion.reason,
    evidence: record.currentVersion.evidence.map((item) => ({
      evidenceType: item.evidenceType,
      documentId: item.document.id,
      documentVersionId: item.documentVersion.id,
      sourceDate: formatDate(item.sourceDate),
    })),
  });
}

function targetReferences(input: PersonnelActionInput): {
  targetPositionId: string | null;
  targetOrganizationUnitId: string | null;
} {
  if (input.actionType === 'REASSIGNMENT') {
    return {
      targetPositionId: null,
      targetOrganizationUnitId: input.targetFacts.organizationUnitId,
    };
  }
  if (input.actionType === 'DESIGNATION') {
    return { targetPositionId: input.targetFacts.targetPositionId, targetOrganizationUnitId: null };
  }
  if (input.actionType === 'SAME_ITEM_REINSTATEMENT') {
    return {
      targetPositionId: input.targetFacts.originalPositionId,
      targetOrganizationUnitId: null,
    };
  }
  return { targetPositionId: null, targetOrganizationUnitId: null };
}

@Injectable()
export class PersonnelActionsService {
  constructor(
    @Inject(PERSONNEL_ACTION_AUDIT_WRITER)
    private readonly auditWriter: PersonnelActionAuditWriter,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
  ) {}

  async list(
    context: RequestContext,
    input: { cursor?: string | undefined; limit: number } = { limit: 50 },
  ): Promise<{ actions: PersonnelActionSummary[]; nextCursor: string | null }> {
    this.assertPermission(context, 'personnel.actions.read', 'PERSONNEL_ACTION_READ_FORBIDDEN');
    const records = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      transaction.personnelAction.findMany({
        where: { agencyId: context.agencyId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        select: actionSelect,
      }),
    );
    const hasMore = records.length > input.limit;
    const page = records.slice(0, input.limit);
    return {
      actions: page.map(actionSummary),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async findById(
    context: RequestContext,
    actionId: string,
  ): Promise<PersonnelActionSummary | null> {
    this.assertPermission(context, 'personnel.actions.read', 'PERSONNEL_ACTION_READ_FORBIDDEN');
    const record = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      this.actionRecord(transaction, context.agencyId, actionId),
    );
    return record ? actionSummary(record) : null;
  }

  async history(context: RequestContext, actionId: string): Promise<PersonnelActionHistory | null> {
    this.assertPermission(
      context,
      'personnel.actions.audit.read',
      'PERSONNEL_ACTION_AUDIT_READ_FORBIDDEN',
    );
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const record = await this.actionRecord(transaction, context.agencyId, actionId);
      if (!record) return null;
      const [versions, entries] = await Promise.all([
        transaction.personnelActionVersion.findMany({
          where: { agencyId: context.agencyId, actionId },
          orderBy: { versionNo: 'desc' },
          select: versionSelect,
        }),
        transaction.auditEvent.findMany({
          where: { agencyId: context.agencyId, entityType: 'PersonnelAction', entityId: actionId },
          orderBy: { occurredAt: 'desc' },
          select: {
            id: true,
            action: true,
            previousStatus: true,
            newStatus: true,
            reason: true,
            requestId: true,
            metadata: true,
            actorMembershipId: true,
            actorMembership: { select: { user: { select: { displayName: true } } } },
            occurredAt: true,
          },
        }),
      ]);
      return {
        action: actionSummary(record),
        versions: versions.map(versionSummary),
        entries: entries.map((entry) => ({
          id: entry.id,
          action: entry.action,
          previousStatus: entry.previousStatus,
          newStatus: entry.newStatus,
          reason: entry.reason,
          requestId: entry.requestId,
          metadata: entry.metadata,
          actor: {
            membershipId: entry.actorMembershipId,
            displayName: entry.actorMembership?.user.displayName ?? null,
          },
          occurredAt: entry.occurredAt.toISOString(),
        })),
      };
    });
  }

  async authority(
    context: RequestContext,
    actionId: string,
  ): Promise<PersonnelActionAuthority | null> {
    this.assertPermission(context, 'personnel.actions.read', 'PERSONNEL_ACTION_READ_FORBIDDEN');
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const action = await this.actionRecord(transaction, context.agencyId, actionId);
      if (!action) return null;
      if (action.preparedByMembershipId === context.membershipId) {
        return { canApprove: false, canReject: false, canCancelApproved: false };
      }
      const allowed = async (permission: string): Promise<boolean> => {
        try {
          await this.decisionAuthority(transaction, context, action, permission);
          return true;
        } catch (error: unknown) {
          if (
            error instanceof PersonnelActionServiceError &&
            error.code === 'PERSONNEL_ACTION_AUTHORITY_REQUIRED'
          ) {
            return false;
          }
          throw error;
        }
      };
      return {
        canApprove:
          action.status === 'FOR_APPROVAL' &&
          personnelActionCanBeApproved(action.actionType as PersonnelActionInput['actionType']) &&
          (await allowed('personnel.actions.approve')),
        canReject: action.status === 'FOR_APPROVAL' && (await allowed('personnel.actions.reject')),
        canCancelApproved:
          action.status === 'APPROVED' && (await allowed('personnel.actions.cancel_approved')),
      };
    });
  }

  async create(
    context: RequestContext,
    input: PersonnelActionInput,
  ): Promise<PersonnelActionSummary> {
    this.assertPermission(context, 'personnel.actions.create', 'PERSONNEL_ACTION_CREATE_FORBIDDEN');
    return withDatabaseContext(
      requestDatabaseContext(context, 'personnel-action-transition'),
      async (transaction) => {
        const source = await this.validateInput(transaction, context, input, false);
        const action = await transaction.personnelAction.create({
          data: {
            agencyId: context.agencyId,
            employeeId: input.employeeId,
            actionType: input.actionType,
            status: 'DRAFT',
            preparedByMembershipId: context.membershipId,
          },
          select: { id: true },
        });
        const version = await this.appendVersion(
          transaction,
          context,
          action.id,
          1,
          input,
          source.id,
        );
        const record = await transaction.personnelAction.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: action.id } },
          data: { currentVersionId: version.id },
          select: actionSelect,
        });
        await this.writeAudit(transaction, context, record, {
          action: 'PERSONNEL_ACTION_PREPARED',
          previousStatus: null,
          newStatus: 'DRAFT',
          reason: input.reason,
        });
        return actionSummary(record);
      },
    );
  }

  async updateDraft(
    context: RequestContext,
    actionId: string,
    input: PersonnelActionInput,
    rowVersion?: number,
  ): Promise<PersonnelActionSummary> {
    this.assertPermission(context, 'personnel.actions.create', 'PERSONNEL_ACTION_CREATE_FORBIDDEN');
    return withDatabaseContext(
      requestDatabaseContext(context, 'personnel-action-transition'),
      async (transaction) => {
        const current = await this.lockedAction(transaction, context.agencyId, actionId);
        if (!['DRAFT', 'RETURNED'].includes(current.status))
          throw this.workflowError('edit', current.status);
        if (current.preparedByMembershipId !== context.membershipId) throw this.preparerRequired();
        if (current.employeeId !== input.employeeId || current.actionType !== input.actionType) {
          throw new PersonnelActionServiceError(
            'Employee and action type cannot be changed after preparation.',
            409,
            'PERSONNEL_ACTION_IDENTITY_IMMUTABLE',
          );
        }
        if (rowVersion !== undefined && current.rowVersion !== rowVersion)
          throw this.versionConflict();
        const source = await this.validateInput(transaction, context, input, false);
        const version = await this.appendVersion(
          transaction,
          context,
          actionId,
          (current.currentVersion?.versionNo ?? 0) + 1,
          input,
          source.id,
        );
        const updated = await transaction.personnelAction.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: actionId } },
          data: { currentVersionId: version.id },
          select: actionSelect,
        });
        await this.writeAudit(transaction, context, updated, {
          action: 'PERSONNEL_ACTION_DRAFT_REVISED',
          previousStatus: current.status,
          newStatus: current.status,
          reason: input.reason,
        });
        return actionSummary(updated);
      },
    );
  }

  async submit(context: RequestContext, actionId: string): Promise<PersonnelActionSummary> {
    this.assertPermission(context, 'personnel.actions.submit', 'PERSONNEL_ACTION_SUBMIT_FORBIDDEN');
    return withDatabaseContext(
      requestDatabaseContext(context, 'personnel-action-transition'),
      async (transaction) => {
        const current = await this.lockedAction(transaction, context.agencyId, actionId);
        if (!['DRAFT', 'RETURNED'].includes(current.status))
          throw this.workflowError('submit', current.status);
        if (current.preparedByMembershipId !== context.membershipId) throw this.preparerRequired();
        await this.validateStoredAction(transaction, context, current, true);
        const updated = await this.transition(transaction, context, current, 'FOR_REVIEW');
        await this.writeAudit(transaction, context, updated, {
          action: 'PERSONNEL_ACTION_SUBMITTED',
          previousStatus: current.status,
          newStatus: 'FOR_REVIEW',
          reason: updated.currentVersion?.reason ?? '',
        });
        return actionSummary(updated);
      },
    );
  }

  async review(
    context: RequestContext,
    actionId: string,
    input: { decision: 'RETURN' | 'ENDORSE'; reason: string },
  ): Promise<PersonnelActionSummary> {
    const permission =
      input.decision === 'RETURN' ? 'personnel.actions.return' : 'personnel.actions.endorse';
    this.assertPermission(context, permission, 'PERSONNEL_ACTION_REVIEW_FORBIDDEN');
    this.assertReason(input.reason);
    return withDatabaseContext(
      requestDatabaseContext(context, 'personnel-action-transition'),
      async (transaction) => {
        const current = await this.lockedAction(transaction, context.agencyId, actionId);
        if (current.status !== 'FOR_REVIEW') throw this.workflowError('review', current.status);
        if (input.decision === 'ENDORSE')
          await this.validateStoredAction(transaction, context, current, true);
        const nextStatus = input.decision === 'RETURN' ? 'RETURNED' : 'FOR_APPROVAL';
        const updated = await this.transition(transaction, context, current, nextStatus);
        await this.writeAudit(transaction, context, updated, {
          action:
            input.decision === 'RETURN' ? 'PERSONNEL_ACTION_RETURNED' : 'PERSONNEL_ACTION_ENDORSED',
          previousStatus: current.status,
          newStatus: nextStatus,
          reason: input.reason.trim(),
        });
        return actionSummary(updated);
      },
    );
  }

  async decide(
    context: RequestContext,
    actionId: string,
    input: { decision: 'APPROVE' | 'REJECT'; reason: string },
  ): Promise<PersonnelActionSummary> {
    this.assertReason(input.reason);
    return withDatabaseContext(
      requestDatabaseContext(context, 'personnel-action-transition'),
      async (transaction) => {
        const current = await this.lockedAction(transaction, context.agencyId, actionId);
        if (current.status !== 'FOR_APPROVAL') throw this.workflowError('decide', current.status);
        if (current.preparedByMembershipId === context.membershipId) {
          throw new PersonnelActionServiceError(
            'The preparer cannot approve or reject their own Personnel Action.',
            403,
            'PERSONNEL_ACTION_SEGREGATION_REQUIRED',
          );
        }
        const permission =
          input.decision === 'APPROVE' ? 'personnel.actions.approve' : 'personnel.actions.reject';
        const delegationId = await this.decisionAuthority(
          transaction,
          context,
          current,
          permission,
        );
        if (input.decision === 'APPROVE') {
          if (
            !personnelActionCanBeApproved(current.actionType as PersonnelActionInput['actionType'])
          ) {
            throw new PersonnelActionServiceError(
              'This action remains review-only until its typed assignment effect owner exists.',
              409,
              'PERSONNEL_ACTION_EFFECT_OWNER_MISSING',
            );
          }
          await this.validateStoredAction(transaction, context, current, true);
        }
        const nextStatus = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        const updated = await transaction.personnelAction.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: actionId } },
          data:
            input.decision === 'APPROVE'
              ? {
                  status: nextStatus,
                  approvedByMembershipId: context.membershipId,
                  approvalDelegationId: delegationId,
                  approvedAt: new Date(),
                }
              : { status: nextStatus },
          select: actionSelect,
        });
        await this.writeAudit(transaction, context, updated, {
          action:
            input.decision === 'APPROVE'
              ? 'PERSONNEL_ACTION_APPROVED'
              : 'PERSONNEL_ACTION_REJECTED',
          previousStatus: current.status,
          newStatus: nextStatus,
          reason: input.reason.trim(),
          delegationId,
        });
        if (input.decision === 'APPROVE' && current.supersedesActionId) {
          const source = await this.lockedAction(
            transaction,
            context.agencyId,
            current.supersedesActionId,
          );
          if (!['APPROVED', 'EFFECTIVE'].includes(source.status)) {
            throw new PersonnelActionServiceError(
              'The source action is no longer pending replacement.',
              409,
              'PERSONNEL_ACTION_REPLACEMENT_SOURCE_INVALID',
            );
          }
          if (source.status === 'APPROVED') {
            const superseded = await this.transition(transaction, context, source, 'SUPERSEDED');
            await this.writeAudit(transaction, context, superseded, {
              action: 'PERSONNEL_ACTION_SUPERSEDED',
              previousStatus: source.status,
              newStatus: 'SUPERSEDED',
              reason: input.reason.trim(),
              replacementActionId: current.id,
            });
          }
        }
        return actionSummary(updated);
      },
    );
  }

  async cancel(
    context: RequestContext,
    actionId: string,
    reason: string,
  ): Promise<PersonnelActionSummary> {
    this.assertReason(reason);
    return withDatabaseContext(
      requestDatabaseContext(context, 'personnel-action-transition'),
      async (transaction) => {
        const current = await this.lockedAction(transaction, context.agencyId, actionId);
        if (['DRAFT', 'RETURNED'].includes(current.status)) {
          this.assertPermission(
            context,
            'personnel.actions.cancel',
            'PERSONNEL_ACTION_CANCEL_FORBIDDEN',
          );
          if (current.preparedByMembershipId !== context.membershipId)
            throw this.preparerRequired();
        } else if (current.status === 'APPROVED') {
          const today = manilaToday();
          if (
            !current.currentVersion ||
            today >= formatDate(current.currentVersion.proposedEffectivity)
          ) {
            throw new PersonnelActionServiceError(
              'An effective Personnel Action cannot be cancelled retroactively.',
              409,
              'PERSONNEL_ACTION_CANCELLATION_TOO_LATE',
            );
          }
          await this.decisionAuthority(
            transaction,
            context,
            current,
            'personnel.actions.cancel_approved',
          );
        } else {
          throw this.workflowError('cancel', current.status);
        }
        const updated = await transaction.personnelAction.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: actionId } },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
          select: actionSelect,
        });
        await this.writeAudit(transaction, context, updated, {
          action: 'PERSONNEL_ACTION_CANCELLED',
          previousStatus: current.status,
          newStatus: 'CANCELLED',
          reason: reason.trim(),
        });
        return actionSummary(updated);
      },
    );
  }

  async effectuate(
    context: RequestContext,
    actionId: string,
    rawIdempotencyKey?: string,
  ): Promise<PersonnelActionSummary> {
    this.assertPermission(
      context,
      'personnel.actions.effectuate',
      'PERSONNEL_ACTION_EFFECTUATE_FORBIDDEN',
    );
    return withDatabaseContext(
      requestDatabaseContext(context, 'personnel-action-transition'),
      async (transaction) => {
        const current = await this.lockedAction(transaction, context.agencyId, actionId);
        if (current.status === 'EFFECTIVE') return actionSummary(current);
        if (current.status !== 'APPROVED') throw this.workflowError('effectuate', current.status);
        if (!current.currentVersion) throw this.versionMissing();
        await this.lockEmployee(transaction, context.agencyId, current.employeeId);
        await this.lockServiceSegment(
          transaction,
          context.agencyId,
          current.currentVersion.fromServiceSegmentId,
        );
        if (current.currentVersion.fromServiceSegment.positionId) {
          await transaction.$queryRaw(
            Prisma.sql`SELECT "id" FROM "plantilla_positions" WHERE "agency_id" = CAST(${context.agencyId} AS uuid) AND "id" = CAST(${current.currentVersion.fromServiceSegment.positionId} AS uuid) FOR UPDATE`,
          );
        }

        const input = inputFromAction(current);
        if (input.actionType !== 'SALARY_ADJUSTMENT' && input.actionType !== 'STEP_INCREMENT') {
          throw new PersonnelActionServiceError(
            'Only approved salary adjustments and step increments use this effectuation path.',
            409,
            'PERSONNEL_ACTION_COMPENSATION_EFFECT_UNSUPPORTED',
          );
        }
        const salaryGrade =
          input.actionType === 'SALARY_ADJUSTMENT'
            ? input.targetFacts.newSalaryGrade
            : current.currentVersion.fromServiceSegment.salaryGrade;
        const salaryStep = input.targetFacts.newSalaryStep;
        const effectivity = databaseDate(input.proposedEffectivity);
        if (input.proposedEffectivity > manilaToday()) {
          throw new PersonnelActionServiceError(
            'The Personnel Action cannot be effectuated before its applicable date.',
            409,
            'PERSONNEL_ACTION_NOT_YET_EFFECTIVE',
          );
        }
        if (effectivity <= current.currentVersion.fromServiceSegment.effectiveFrom) {
          throw new PersonnelActionServiceError(
            'Compensation effectivity must follow the current Service Segment start date.',
            409,
            'PERSONNEL_ACTION_EFFECTIVITY_INVALID',
          );
        }
        await this.validateStoredAction(transaction, context, current, true);
        await this.validateApprovalAuthority(transaction, context.agencyId, current);

        const predecessorEnd = new Date(effectivity);
        predecessorEnd.setUTCDate(predecessorEnd.getUTCDate() - 1);
        await transaction.serviceSegment.update({
          where: {
            agencyId_id: {
              agencyId: context.agencyId,
              id: current.currentVersion.fromServiceSegmentId,
            },
          },
          data: { status: 'CLOSED', effectiveTo: predecessorEnd },
        });
        const successor = await transaction.serviceSegment.create({
          data: {
            agencyId: context.agencyId,
            employeeId: current.employeeId,
            appointmentId: current.currentVersion.fromServiceSegment.appointmentId,
            personnelActionId: current.id,
            positionId: current.currentVersion.fromServiceSegment.positionId,
            organizationUnitId: current.currentVersion.fromServiceSegment.organizationUnitId,
            segmentType: current.currentVersion.fromServiceSegment.segmentType,
            appointmentStatus: current.currentVersion.fromServiceSegment.appointmentStatus,
            salaryGrade,
            salaryStep,
            effectiveFrom: effectivity,
            status: 'ACTIVE',
            createdByMembershipId: context.membershipId,
          },
          select: { id: true, salaryGrade: true, salaryStep: true },
        });
        await transaction.employee.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: current.employeeId } },
          data: {
            currentServiceSegmentId: successor.id,
            updatedByMembershipId: context.membershipId,
          },
        });
        const idempotencyKey =
          rawIdempotencyKey?.trim() ||
          `personnel-action:${current.id}:${current.currentVersion.id}`;
        const effective = await transaction.personnelAction.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: current.id } },
          data: {
            status: 'EFFECTIVE',
            effectuatedByMembershipId: context.membershipId,
            effectuatedAt: new Date(),
            effectuationKey: idempotencyKey,
          },
          select: actionSelect,
        });
        await this.writeAudit(transaction, context, effective, {
          action: 'PERSONNEL_ACTION_EFFECTUATED',
          previousStatus: current.status,
          newStatus: 'EFFECTIVE',
          reason: current.currentVersion.reason,
          idempotencyKey,
          serviceSegmentId: successor.id,
        });
        await transaction.outboxEvent.create({
          data: {
            agencyId: context.agencyId,
            eventType: 'PERSONNEL_ACTION_EFFECTUATED',
            aggregateType: 'PersonnelAction',
            aggregateId: current.id,
            idempotencyKey,
            payload: {
              actionId: current.id,
              actionVersionId: current.currentVersion.id,
              employeeId: current.employeeId,
              serviceSegmentId: successor.id,
              effectivity: input.proposedEffectivity,
              salaryGrade: successor.salaryGrade,
              salaryStep: successor.salaryStep,
            },
          },
        });
        return actionSummary(effective);
      },
    );
  }

  async replace(
    context: RequestContext,
    actionId: string,
    input: PersonnelActionInput,
  ): Promise<PersonnelActionSummary> {
    this.assertPermission(
      context,
      'personnel.actions.correct',
      'PERSONNEL_ACTION_CORRECT_FORBIDDEN',
    );
    return withDatabaseContext(
      requestDatabaseContext(context, 'personnel-action-transition'),
      async (transaction) => {
        const sourceAction = await this.lockedAction(transaction, context.agencyId, actionId);
        if (!['APPROVED', 'EFFECTIVE'].includes(sourceAction.status))
          throw this.workflowError('replace', sourceAction.status);
        if (sourceAction.employeeId !== input.employeeId) {
          throw new PersonnelActionServiceError(
            'A replacement must remain linked to the same Employee.',
            409,
            'PERSONNEL_ACTION_REPLACEMENT_EMPLOYEE_INVALID',
          );
        }
        const sourceSegment = await this.validateInput(transaction, context, input, false);
        const replacement = await transaction.personnelAction.create({
          data: {
            agencyId: context.agencyId,
            employeeId: input.employeeId,
            actionType: input.actionType,
            status: 'DRAFT',
            supersedesActionId: actionId,
            preparedByMembershipId: context.membershipId,
          },
          select: { id: true },
        });
        const version = await this.appendVersion(
          transaction,
          context,
          replacement.id,
          1,
          input,
          sourceSegment.id,
        );
        const record = await transaction.personnelAction.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: replacement.id } },
          data: { currentVersionId: version.id },
          select: actionSelect,
        });
        await this.writeAudit(transaction, context, record, {
          action: 'PERSONNEL_ACTION_REPLACEMENT_PREPARED',
          previousStatus: null,
          newStatus: 'DRAFT',
          reason: input.reason,
          replacementActionId: actionId,
        });
        return actionSummary(record);
      },
    );
  }

  private async validateStoredAction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    action: ActionRecord,
    requireCompleteEvidence: boolean,
  ): Promise<void> {
    const input = inputFromAction(action);
    await this.validateInput(
      transaction,
      context,
      input,
      requireCompleteEvidence,
      action.currentVersion?.fromServiceSegmentId,
      action.id,
    );
  }

  private async validateInput(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: PersonnelActionInput,
    requireCompleteEvidence: boolean,
    expectedSourceSegmentId?: string,
    currentActionId?: string,
  ) {
    const effectivity = databaseDate(input.proposedEffectivity);
    const employee = await transaction.employee.findFirst({
      where: { agencyId: context.agencyId, id: input.employeeId },
      select: {
        id: true,
        serviceStatus: true,
        currentServiceSegment: {
          select: {
            id: true,
            positionId: true,
            organizationUnitId: true,
            salaryGrade: true,
            salaryStep: true,
            status: true,
          },
        },
      },
    });
    if (!employee) throw this.notFound('Employee');
    const requiredStatus = input.actionType === 'SAME_ITEM_REINSTATEMENT' ? 'SEPARATED' : 'ACTIVE';
    const sourceSegment =
      employee.currentServiceSegment ??
      (input.actionType === 'SAME_ITEM_REINSTATEMENT'
        ? await transaction.serviceSegment.findFirst({
            where: {
              agencyId: context.agencyId,
              employeeId: input.employeeId,
              status: 'CLOSED',
              effectiveTo: { not: null },
            },
            orderBy: [{ effectiveTo: 'desc' }, { effectiveFrom: 'desc' }],
            select: {
              id: true,
              positionId: true,
              organizationUnitId: true,
              salaryGrade: true,
              salaryStep: true,
              status: true,
            },
          })
        : null);
    if (
      employee.serviceStatus !== requiredStatus ||
      !sourceSegment ||
      (input.actionType !== 'SAME_ITEM_REINSTATEMENT' && sourceSegment.status !== 'ACTIVE')
    ) {
      throw new PersonnelActionServiceError(
        `The Employee must have ${requiredStatus} service and an applicable Service Segment.`,
        409,
        'PERSONNEL_ACTION_EMPLOYEE_STATE_INVALID',
      );
    }
    if (expectedSourceSegmentId && sourceSegment.id !== expectedSourceSegmentId) {
      throw new PersonnelActionServiceError(
        'The Employee source Service Segment changed after this action version was prepared.',
        409,
        'PERSONNEL_ACTION_SOURCE_CHANGED',
      );
    }

    if (requireCompleteEvidence) {
      const supplied = new Set(input.evidence.map(({ evidenceType }) => evidenceType));
      const missing = REQUIRED_EVIDENCE[input.actionType].filter((type) => !supplied.has(type));
      if (missing.length > 0) {
        throw new PersonnelActionServiceError(
          `Required evidence is missing: ${missing.join(', ')}.`,
          409,
          'PERSONNEL_ACTION_EVIDENCE_INCOMPLETE',
        );
      }
      if (input.actionType === 'STEP_INCREMENT') {
        await transaction.$queryRaw(
          Prisma.sql`SELECT "id" FROM "employees" WHERE "agency_id" = CAST(${context.agencyId} AS uuid) AND "id" = CAST(${input.employeeId} AS uuid) FOR UPDATE`,
        );
        const duplicate = await transaction.personnelAction.findFirst({
          where: {
            agencyId: context.agencyId,
            employeeId: input.employeeId,
            actionType: input.actionType,
            ...(currentActionId ? { id: { not: currentActionId } } : {}),
            status: { in: ['FOR_REVIEW', 'FOR_APPROVAL', 'APPROVED'] },
            currentVersion: { is: { proposedEffectivity: effectivity } },
          },
          select: { id: true },
        });
        if (duplicate) {
          throw new PersonnelActionServiceError(
            'A Step Increment for this Employee and effectivity is already pending or approved.',
            409,
            'PERSONNEL_ACTION_DUPLICATE_INCREMENT',
          );
        }
      }
    }
    this.assertPermission(
      context,
      'documents.evidence.read',
      'PERSONNEL_ACTION_EVIDENCE_READ_FORBIDDEN',
    );
    for (const item of input.evidence) {
      if (item.sourceDate > input.proposedEffectivity) {
        throw new PersonnelActionServiceError(
          'Personnel Action effectivity cannot predate its authority evidence.',
          409,
          'PERSONNEL_ACTION_EFFECTIVITY_INVALID',
        );
      }
      const resolved = await this.documentsService.resolveExternalEvidenceInTransaction(
        transaction,
        context,
        {
          documentId: item.documentId,
          versionId: item.documentVersionId,
          allowSensitive: hasPermission(context, 'documents.evidence.read_sensitive', {
            agencyId: context.agencyId,
          }),
          requirement: 'FINALIZED_VERSION',
        },
      );
      if (resolved.ok === false && resolved.reason === 'DOCUMENT_NOT_FOUND') {
        throw this.notFound('Evidence');
      }
      if (resolved.ok === false && resolved.reason === 'SENSITIVE_FORBIDDEN') {
        throw new PersonnelActionServiceError(
          'The current Agency Membership cannot use this sensitive evidence.',
          403,
          'PERSONNEL_ACTION_EVIDENCE_FORBIDDEN',
        );
      }
      if (!resolved.ok) {
        throw new PersonnelActionServiceError(
          'Every Personnel Action evidence link must reference an eligible finalized version.',
          409,
          'PERSONNEL_ACTION_EVIDENCE_INVALID',
        );
      }
      if (resolved.document.documentType !== item.evidenceType) {
        throw new PersonnelActionServiceError(
          'Each evidence link must use a document of the matching canonical evidence type.',
          409,
          'PERSONNEL_ACTION_EVIDENCE_TYPE_INVALID',
        );
      }
      if (
        input.actionType === 'SALARY_ADJUSTMENT' &&
        item.evidenceType === 'PAY_TABLE_VERSION' &&
        resolved.document.documentNo?.trim().toLowerCase() !==
          input.targetFacts.payTableVersion.toLowerCase()
      ) {
        throw new PersonnelActionServiceError(
          'The salary adjustment must reference the exact pay-table document number.',
          409,
          'PERSONNEL_ACTION_PAY_TABLE_INVALID',
        );
      }
    }

    await this.validateTarget(transaction, context.agencyId, input, sourceSegment);
    return sourceSegment;
  }

  private async validateTarget(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    input: PersonnelActionInput,
    source: {
      positionId: string | null;
      organizationUnitId: string;
      salaryGrade: number | null;
      salaryStep: number | null;
    },
  ): Promise<void> {
    const invalid = (message: string) =>
      new PersonnelActionServiceError(message, 409, 'PERSONNEL_ACTION_TARGET_INVALID');
    switch (input.actionType) {
      case 'STEP_INCREMENT':
        if (
          source.salaryGrade === null ||
          source.salaryStep === null ||
          input.targetFacts.newSalaryStep !== source.salaryStep + 1
        ) {
          throw invalid('A Step Increment must advance the current salary step by exactly one.');
        }
        return;
      case 'SALARY_ADJUSTMENT': {
        if (
          source.positionId === null ||
          source.salaryGrade === null ||
          source.salaryStep === null
        ) {
          throw invalid('A Salary Adjustment requires current salary grade and step facts.');
        }
        const authorizedPosition = await transaction.plantillaPositionVersion.findFirst({
          where: {
            agencyId,
            positionId: source.positionId,
            status: 'ACTIVE',
            domainStatus: 'OCCUPIED',
            effectiveFrom: { lte: databaseDate(input.proposedEffectivity) },
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gte: databaseDate(input.proposedEffectivity) } },
            ],
          },
          select: { salaryGrade: true },
        });
        if (
          !authorizedPosition ||
          input.targetFacts.newSalaryGrade !== authorizedPosition.salaryGrade ||
          input.targetFacts.newSalaryGrade === source.salaryGrade ||
          input.targetFacts.newSalaryStep !== source.salaryStep
        ) {
          throw invalid(
            'A Salary Adjustment must match the changed effective Plantilla salary grade.',
          );
        }
        return;
      }
      case 'REASSIGNMENT': {
        if (
          input.targetFacts.endDate &&
          (daysBetween(input.proposedEffectivity, input.targetFacts.endDate) < 0 ||
            (input.targetFacts.stationSpecific &&
              daysBetween(input.proposedEffectivity, input.targetFacts.endDate) > 366))
        ) {
          throw invalid('The reassignment period is outside the source-backed limit.');
        }
        const unit = await transaction.organizationUnitVersion.findFirst({
          where: {
            agencyId,
            organizationUnitId: input.targetFacts.organizationUnitId,
            domainStatus: 'ACTIVE',
            effectiveFrom: { lte: databaseDate(input.proposedEffectivity) },
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gte: databaseDate(input.proposedEffectivity) } },
            ],
          },
          select: { id: true },
        });
        if (!unit || input.targetFacts.organizationUnitId === source.organizationUnitId) {
          throw invalid('Select a different active Organization Unit in this Agency.');
        }
        return;
      }
      case 'DETAIL': {
        const duration = daysBetween(input.proposedEffectivity, input.targetFacts.endDate);
        if (
          duration < 0 ||
          duration > (input.targetFacts.consented ? 3 * 366 : 366) ||
          !input.targetFacts.noDiminutionConfirmed
        ) {
          throw invalid('The detail period and no-diminution terms are inconsistent.');
        }
        return;
      }
      case 'DESIGNATION': {
        const duration = daysBetween(input.proposedEffectivity, input.targetFacts.endDate);
        const position = await transaction.plantillaPosition.findFirst({
          where: { agencyId, id: input.targetFacts.targetPositionId },
          select: { id: true },
        });
        if (!position || duration < 0 || duration > 366) {
          throw invalid('The designation target or period is invalid.');
        }
        return;
      }
      case 'SECONDMENT': {
        const duration = daysBetween(input.proposedEffectivity, input.targetFacts.endDate);
        if (duration < 0 || duration > 3 * 366) {
          throw invalid('The initial secondment period cannot exceed three years.');
        }
        return;
      }
      case 'SAME_ITEM_REINSTATEMENT': {
        const position = await transaction.plantillaPosition.findFirst({
          where: { agencyId, id: input.targetFacts.originalPositionId },
          select: { id: true },
        });
        if (!position || source.positionId !== input.targetFacts.originalPositionId) {
          throw invalid('Same-item reinstatement must name the original same-Agency item.');
        }
        return;
      }
      case 'SEPARATION_RESIGNATION':
        if (
          input.targetFacts.withdrawalState === 'PENDING' ||
          databaseDate(input.targetFacts.acceptanceDate) >
            databaseDate(input.proposedEffectivity) ||
          databaseDate(input.targetFacts.noticeDate) >
            databaseDate(input.targetFacts.acceptanceDate)
        ) {
          throw invalid('The resignation acceptance, notice, or withdrawal state is inconsistent.');
        }
        return;
      case 'SEPARATION_DISMISSAL':
        if (
          input.targetFacts.appealState !== 'FINAL' ||
          databaseDate(input.targetFacts.decisionFinalityDate) >
            databaseDate(input.proposedEffectivity)
        ) {
          throw invalid('Dismissal requires a final executory decision by the effective date.');
        }
        return;
      case 'SEPARATION_DROPPING_FROM_ROLLS':
        if (databaseDate(input.targetFacts.orderDate) > databaseDate(input.proposedEffectivity)) {
          throw invalid('The dropping-from-rolls order cannot postdate effectivity.');
        }
        return;
      case 'SEPARATION_EXPIRATION':
        if (input.targetFacts.appointmentEndDate !== input.proposedEffectivity) {
          throw invalid('Appointment expiration must use the authoritative term end date.');
        }
        return;
      case 'SEPARATION_TERMINATION':
        if (
          databaseDate(input.targetFacts.terminationOrderDate) >
          databaseDate(input.proposedEffectivity)
        ) {
          throw invalid('The termination order cannot postdate effectivity.');
        }
        return;
      case 'SEPARATION_RETIREMENT':
        if (!input.targetFacts.gsisCoverageVerified || !input.targetFacts.eligibilityVerified) {
          throw invalid('Retirement requires verified GSIS coverage and eligibility.');
        }
        return;
      case 'SEPARATION_DEATH':
        if (input.targetFacts.dateOfDeath !== input.proposedEffectivity) {
          throw invalid('Death effectivity must match the documented date of death.');
        }
    }
  }

  private async appendVersion(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    actionId: string,
    versionNo: number,
    input: PersonnelActionInput,
    fromServiceSegmentId: string,
  ) {
    const targets = targetReferences(input);
    const version = await transaction.personnelActionVersion.create({
      data: {
        agencyId: context.agencyId,
        actionId,
        versionNo,
        proposedEffectivity: databaseDate(input.proposedEffectivity),
        fromServiceSegmentId,
        ...targets,
        targetFacts: input.targetFacts as Prisma.InputJsonValue,
        reason: input.reason.trim(),
        createdByMembershipId: context.membershipId,
      },
      select: { id: true },
    });
    if (input.evidence.length > 0) {
      await transaction.personnelActionEvidence.createMany({
        data: input.evidence.map((item) => ({
          agencyId: context.agencyId,
          actionVersionId: version.id,
          evidenceType: item.evidenceType,
          documentId: item.documentId,
          documentVersionId: item.documentVersionId,
          sourceDate: databaseDate(item.sourceDate),
          createdByMembershipId: context.membershipId,
        })),
      });
    }
    return version;
  }

  private async decisionAuthority(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    action: ActionRecord,
    permissionCode: string,
  ): Promise<string | null> {
    if (!action.currentVersion) throw this.versionMissing();
    const now = new Date();
    const effectivity = action.currentVersion.proposedEffectivity;
    const first = now < effectivity ? now : effectivity;
    const last = now > effectivity ? now : effectivity;
    const roleWindow = {
      effectiveFrom: { lte: first },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: last } }],
    };
    const direct = await transaction.membershipRole.findFirst({
      where: {
        agencyId: context.agencyId,
        membershipId: context.membershipId,
        membership: { status: 'ACTIVE' },
        role: {
          status: 'ACTIVE',
          permissions: { some: { permission: { code: permissionCode }, scopePolicy: 'AGENCY' } },
        },
        ...roleWindow,
      },
      select: { id: true },
    });
    if (direct) return null;

    const delegation = await transaction.delegatedAuthority.findFirst({
      where: {
        agencyId: context.agencyId,
        delegateMembershipId: context.membershipId,
        permissionCode,
        status: 'ACTIVE',
        authorityDocumentId: { not: null },
        effectiveFrom: { lte: first },
        effectiveTo: { gt: last },
        OR: [
          { organizationUnitId: null },
          { organizationUnitId: action.currentVersion.fromServiceSegment.organizationUnitId },
        ],
        delegator: {
          status: 'ACTIVE',
          membershipRoles: {
            some: {
              agencyId: context.agencyId,
              role: {
                status: 'ACTIVE',
                permissions: {
                  some: { permission: { code: permissionCode }, scopePolicy: 'AGENCY' },
                },
              },
              ...roleWindow,
            },
          },
        },
      },
      select: { id: true, authorityDocumentId: true },
    });
    if (delegation?.authorityDocumentId) {
      const authorityDocument = await transaction.document.findFirst({
        where: { agencyId: context.agencyId, id: delegation.authorityDocumentId },
        select: { currentVersionId: true },
      });
      const pinnedAuthority = action.currentVersion.evidence.some(
        (item) =>
          item.evidenceType === 'AUTHORITY' &&
          item.document.id === delegation.authorityDocumentId &&
          item.documentVersion.id === authorityDocument?.currentVersionId,
      );
      if (pinnedAuthority) return delegation.id;
    }
    throw new PersonnelActionServiceError(
      'An applicable appointing or delegated authority is required for this decision.',
      403,
      'PERSONNEL_ACTION_AUTHORITY_REQUIRED',
    );
  }

  private async transition(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    current: ActionRecord,
    status: PersonnelActionStatus,
  ): Promise<ActionRecord> {
    return transaction.personnelAction.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: current.id } },
      data: { status },
      select: actionSelect,
    });
  }

  private async actionRecord(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    actionId: string,
  ): Promise<ActionRecord | null> {
    return transaction.personnelAction.findFirst({
      where: { agencyId, id: actionId },
      select: actionSelect,
    });
  }

  private async lockedAction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    actionId: string,
  ): Promise<ActionRecord> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "personnel_actions" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${actionId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) throw this.notFound('Personnel Action');
    const record = await this.actionRecord(transaction, agencyId, actionId);
    if (!record) throw this.notFound('Personnel Action');
    return record;
  }

  private async lockEmployee(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "employees" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${employeeId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) throw this.notFound('Employee');
  }

  private async lockServiceSegment(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    serviceSegmentId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "service_segments" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${serviceSegmentId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) {
      throw new PersonnelActionServiceError(
        'The applicable Service Segment could not be found.',
        404,
        'PERSONNEL_ACTION_SERVICE_SEGMENT_NOT_FOUND',
      );
    }
  }

  private async validateApprovalAuthority(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    action: ActionRecord,
  ): Promise<void> {
    if (!action.currentVersion || !action.approvedByMembershipId || !action.approvedAt) {
      throw new PersonnelActionServiceError(
        'The Personnel Action has no valid approval authority.',
        409,
        'PERSONNEL_ACTION_APPROVAL_INVALID',
      );
    }
    if (action.approvedByMembershipId === action.preparedByMembershipId) {
      throw new PersonnelActionServiceError(
        'The preparer cannot approve their own Personnel Action.',
        409,
        'PERSONNEL_ACTION_SEGREGATION_REQUIRED',
      );
    }
    const effectivity = action.currentVersion.proposedEffectivity;
    let valid = false;
    if (action.approvalDelegationId) {
      const delegation = await transaction.delegatedAuthority.findFirst({
        where: {
          agencyId,
          id: action.approvalDelegationId,
          delegateMembershipId: action.approvedByMembershipId,
          permissionCode: 'personnel.actions.approve',
          status: 'ACTIVE',
          authorityDocumentId: { not: null },
          effectiveFrom: { lte: effectivity },
          effectiveTo: { gt: effectivity },
        },
        select: { authorityDocumentId: true },
      });
      if (delegation?.authorityDocumentId) {
        const authorityDocument = await transaction.document.findFirst({
          where: { agencyId, id: delegation.authorityDocumentId },
          select: { currentVersionId: true },
        });
        valid = action.currentVersion.evidence.some(
          (item) =>
            item.evidenceType === 'AUTHORITY' &&
            item.document.id === delegation.authorityDocumentId &&
            item.documentVersion.id === authorityDocument?.currentVersionId,
        );
      }
    } else {
      valid = Boolean(
        await transaction.membershipRole.findFirst({
          where: {
            agencyId,
            membershipId: action.approvedByMembershipId,
            effectiveFrom: { lte: effectivity },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectivity } }],
            membership: { status: 'ACTIVE' },
            role: {
              status: 'ACTIVE',
              permissions: {
                some: {
                  permission: { code: 'personnel.actions.approve' },
                  scopePolicy: 'AGENCY',
                },
              },
            },
          },
          select: { id: true },
        }),
      );
    }
    if (!valid) {
      throw new PersonnelActionServiceError(
        'The approval authority is not applicable on the action effectivity date.',
        409,
        'PERSONNEL_ACTION_APPROVAL_INVALID',
      );
    }
  }

  private async writeAudit(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    record: ActionRecord,
    event: {
      action: string;
      previousStatus: string | null;
      newStatus: string;
      reason: string;
      delegationId?: string | null;
      replacementActionId?: string;
      idempotencyKey?: string;
      serviceSegmentId?: string;
    },
  ): Promise<void> {
    if (!record.currentVersion) throw this.versionMissing();
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action: event.action,
      entityType: 'PersonnelAction',
      entityId: record.id,
      previousStatus: event.previousStatus,
      newStatus: event.newStatus,
      reason: event.reason,
      requestId: context.requestId,
      metadata: {
        employeeId: record.employeeId,
        actionType: record.actionType,
        versionId: record.currentVersion.id,
        versionNo: record.currentVersion.versionNo,
        proposedEffectivity: formatDate(record.currentVersion.proposedEffectivity),
        fromServiceSegmentId: record.currentVersion.fromServiceSegmentId,
        evidenceTypes: record.currentVersion.evidence.map(({ evidenceType }) => evidenceType),
        ...(event.delegationId ? { delegationId: event.delegationId } : {}),
        ...(event.replacementActionId ? { replacementActionId: event.replacementActionId } : {}),
        ...(event.idempotencyKey ? { idempotencyKey: event.idempotencyKey } : {}),
        ...(event.serviceSegmentId ? { serviceSegmentId: event.serviceSegmentId } : {}),
      },
    });
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (
      !context.agencyId ||
      !context.userId ||
      !context.membershipId ||
      !hasPermission(context, permission, { agencyId: context.agencyId })
    ) {
      throw new PersonnelActionServiceError(
        'The current Agency Membership lacks the required permission.',
        403,
        code,
      );
    }
  }

  private assertReason(reason: string): void {
    if (!reason.trim()) {
      throw new PersonnelActionServiceError(
        'A reason is required for every Personnel Action transition.',
        400,
        'PERSONNEL_ACTION_REASON_REQUIRED',
      );
    }
  }

  private notFound(
    entity: 'Employee' | 'Evidence' | 'Personnel Action',
  ): PersonnelActionServiceError {
    return new PersonnelActionServiceError(
      `${entity} could not be found.`,
      404,
      entity === 'Personnel Action'
        ? 'PERSONNEL_ACTION_NOT_FOUND'
        : `PERSONNEL_ACTION_${entity.toUpperCase()}_NOT_FOUND`,
    );
  }

  private workflowError(operation: string, status: string): PersonnelActionServiceError {
    return new PersonnelActionServiceError(
      `A Personnel Action in ${status} cannot ${operation}.`,
      409,
      'PERSONNEL_ACTION_TRANSITION_INVALID',
    );
  }

  private preparerRequired(): PersonnelActionServiceError {
    return new PersonnelActionServiceError(
      'Only the trusted preparer can change this Personnel Action draft.',
      403,
      'PERSONNEL_ACTION_PREPARER_REQUIRED',
    );
  }

  private versionConflict(): PersonnelActionServiceError {
    return new PersonnelActionServiceError(
      'The Personnel Action changed while it was being edited. Reload and retry.',
      409,
      'PERSONNEL_ACTION_VERSION_CONFLICT',
    );
  }

  private versionMissing(): PersonnelActionServiceError {
    return new PersonnelActionServiceError(
      'The Personnel Action has no current version.',
      409,
      'PERSONNEL_ACTION_VERSION_MISSING',
    );
  }
}
