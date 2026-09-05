import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import {
  DocumentsService,
  type DocumentClassification,
  type DocumentSummary,
} from '../documents/documents.service';
import { PlantillaPositionsService } from '../plantilla-positions/plantilla-positions.service';

export const PERSONNEL_BASELINE_STATUSES = [
  'DRAFT',
  'FOR_REVIEW',
  'APPROVED',
  'RETURNED',
  'REJECTED',
  'EFFECTIVE',
  'SUPERSEDED',
  'VOIDED',
] as const;

export type PersonnelBaselineStatus = (typeof PERSONNEL_BASELINE_STATUSES)[number];

export interface PersonnelBaselineInput {
  employeeId: string;
  authorityDocumentId: string;
  authorityEvidenceVersionId: string;
  firstGovernmentServiceDate: string;
  agencyServiceStartDate: string;
  organizationUnitId: string;
  appointmentStatus: string;
  salaryGrade?: number | null | undefined;
  salaryStep?: number | null | undefined;
  positionId?: string | null | undefined;
  reason: string;
}

export interface PersonnelBaselineReviewInput {
  decision: 'APPROVE' | 'RETURN' | 'REJECT';
  reason: string;
}

export interface PersonnelBaselineSummary {
  id: string;
  employee: {
    id: string;
    employeeNumber: string;
    legalName: string;
    serviceStatus: string;
  };
  authorityEvidence: {
    documentId: string;
    documentNo: string | null;
    documentType: string;
    classification: DocumentClassification;
    status: string;
    versionId: string;
    versionNo: number;
  };
  firstGovernmentServiceDate: string;
  agencyServiceStartDate: string;
  organizationUnit: { id: string; code: string; name: string };
  appointmentStatus: string;
  salaryGrade: number | null;
  salaryStep: number | null;
  position: {
    id: string;
    itemNumber: string;
    status: string;
    title: string | null;
    salaryGrade: number | null;
  } | null;
  status: PersonnelBaselineStatus;
  reason: string;
  reviewedAt: string | null;
  effectuatedAt: string | null;
  serviceSegment: PersonnelBaselineServiceSegment | null;
  positionIncumbency: PersonnelBaselinePositionIncumbency | null;
  supersedesBaselineId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonnelBaselineServiceSegment {
  id: string;
  positionId: string | null;
  organizationUnitId: string;
  appointmentStatus: string;
  salaryGrade: number | null;
  salaryStep: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
}

export interface PersonnelBaselinePositionIncumbency {
  id: string;
  positionId: string;
  employeeId: string;
  serviceSegmentId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
}

export interface PersonnelBaselineHistoryEntry {
  id: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  idempotencyKey: string | null;
  metadata: Prisma.JsonValue;
  occurredAt: string;
}

export interface PersonnelBaselineHistory {
  baseline: PersonnelBaselineSummary;
  entries: PersonnelBaselineHistoryEntry[];
}

export interface PersonnelBaselineAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const PERSONNEL_BASELINE_AUDIT_WRITER = Symbol('PERSONNEL_BASELINE_AUDIT_WRITER');

export const personnelBaselineAuditWriter: PersonnelBaselineAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};

export class PersonnelBaselineServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PersonnelBaselineServiceError';
  }
}

const BASELINE_LIST_LIMIT = 200;

const serviceSegmentSelect = {
  id: true,
  positionId: true,
  organizationUnitId: true,
  appointmentStatus: true,
  salaryGrade: true,
  salaryStep: true,
  effectiveFrom: true,
  effectiveTo: true,
  status: true,
} as const;

const positionIncumbencySelect = {
  id: true,
  positionId: true,
  employeeId: true,
  serviceSegmentId: true,
  effectiveFrom: true,
  effectiveTo: true,
  status: true,
} as const;

const baselineSelect = {
  id: true,
  agencyId: true,
  employeeId: true,
  authorityDocumentId: true,
  authorityEvidenceVersionId: true,
  firstGovernmentServiceDate: true,
  agencyServiceStartDate: true,
  organizationUnitId: true,
  appointmentStatus: true,
  salaryGrade: true,
  salaryStep: true,
  positionId: true,
  status: true,
  reason: true,
  reviewedAt: true,
  effectuatedAt: true,
  serviceSegmentId: true,
  positionIncumbencyId: true,
  supersedesBaselineId: true,
  createdAt: true,
  updatedAt: true,
  rowVersion: true,
  employee: {
    select: {
      id: true,
      employeeNumber: true,
      legalName: true,
      serviceStatus: true,
    },
  },
  authorityDocument: {
    select: {
      id: true,
      documentNo: true,
      documentType: true,
      classification: true,
      status: true,
    },
  },
  authorityEvidenceVersion: {
    select: { id: true, versionNo: true },
  },
  organizationUnit: {
    select: {
      id: true,
      code: true,
      currentVersion: { select: { name: true } },
    },
  },
  position: {
    select: {
      id: true,
      itemNumber: true,
      status: true,
      currentVersion: { select: { positionTitle: true, salaryGrade: true } },
    },
  },
  serviceSegment: { select: serviceSegmentSelect },
  positionIncumbency: { select: positionIncumbencySelect },
} as const;

type BaselineRecord = Prisma.PersonnelBaselineGetPayload<{ select: typeof baselineSelect }>;

type ValidatedReferences = {
  employee: { id: string; serviceStatus: string; currentServiceSegmentId: string | null };
  evidence: DocumentSummary;
  organizationUnit: { id: string; code: string };
  position: {
    id: string;
    itemNumber: string;
    status: string;
    version: {
      id: string;
      salaryGrade: number;
      organizationUnitId: string;
      domainStatus: string;
    };
  } | null;
};

function databaseContext(context: RequestContext, transition = false) {
  return requestDatabaseContext(
    context,
    ...(transition ? (['personnel-baseline-transition'] as const) : []),
  );
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatDateTime(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toDatabaseDate(value: string, code = 'PERSONNEL_BASELINE_DATE_INVALID'): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new PersonnelBaselineServiceError(
      'Personnel Baseline dates must use YYYY-MM-DD.',
      400,
      code,
    );
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new PersonnelBaselineServiceError(
      'Personnel Baseline dates must use a real calendar date.',
      400,
      code,
    );
  }
  return date;
}

function normalizeIdempotencyKey(value: string | undefined): string {
  return value?.trim() || '';
}

function normalizeInput(input: PersonnelBaselineInput): PersonnelBaselineInput {
  return {
    ...input,
    authorityDocumentId: input.authorityDocumentId.trim(),
    authorityEvidenceVersionId: input.authorityEvidenceVersionId.trim(),
    firstGovernmentServiceDate: input.firstGovernmentServiceDate.trim(),
    agencyServiceStartDate: input.agencyServiceStartDate.trim(),
    appointmentStatus: input.appointmentStatus.trim(),
    salaryGrade: input.salaryGrade ?? null,
    salaryStep: input.salaryStep ?? null,
    positionId: input.positionId ?? null,
    reason: input.reason.trim(),
  };
}

function baselineSummary(record: BaselineRecord): PersonnelBaselineSummary {
  return {
    id: record.id,
    employee: record.employee,
    authorityEvidence: {
      documentId: record.authorityDocument.id,
      documentNo: record.authorityDocument.documentNo,
      documentType: record.authorityDocument.documentType,
      classification: record.authorityDocument.classification as DocumentClassification,
      status: record.authorityDocument.status,
      versionId: record.authorityEvidenceVersion.id,
      versionNo: record.authorityEvidenceVersion.versionNo,
    },
    firstGovernmentServiceDate: formatDate(record.firstGovernmentServiceDate),
    agencyServiceStartDate: formatDate(record.agencyServiceStartDate),
    organizationUnit: {
      id: record.organizationUnit.id,
      code: record.organizationUnit.code,
      name: record.organizationUnit.currentVersion?.name ?? record.organizationUnit.code,
    },
    appointmentStatus: record.appointmentStatus,
    salaryGrade: record.salaryGrade,
    salaryStep: record.salaryStep,
    position: record.position
      ? {
          id: record.position.id,
          itemNumber: record.position.itemNumber,
          status: record.position.status,
          title: record.position.currentVersion?.positionTitle ?? null,
          salaryGrade: record.position.currentVersion?.salaryGrade ?? null,
        }
      : null,
    status: record.status as PersonnelBaselineStatus,
    reason: record.reason,
    reviewedAt: formatDateTime(record.reviewedAt),
    effectuatedAt: formatDateTime(record.effectuatedAt),
    serviceSegment: record.serviceSegment
      ? {
          id: record.serviceSegment.id,
          positionId: record.serviceSegment.positionId,
          organizationUnitId: record.serviceSegment.organizationUnitId,
          appointmentStatus: record.serviceSegment.appointmentStatus,
          salaryGrade: record.serviceSegment.salaryGrade,
          salaryStep: record.serviceSegment.salaryStep,
          effectiveFrom: formatDate(record.serviceSegment.effectiveFrom),
          effectiveTo: record.serviceSegment.effectiveTo
            ? formatDate(record.serviceSegment.effectiveTo)
            : null,
          status: record.serviceSegment.status,
        }
      : null,
    positionIncumbency: record.positionIncumbency
      ? {
          id: record.positionIncumbency.id,
          positionId: record.positionIncumbency.positionId,
          employeeId: record.positionIncumbency.employeeId,
          serviceSegmentId: record.positionIncumbency.serviceSegmentId,
          effectiveFrom: formatDate(record.positionIncumbency.effectiveFrom),
          effectiveTo: record.positionIncumbency.effectiveTo
            ? formatDate(record.positionIncumbency.effectiveTo)
            : null,
          status: record.positionIncumbency.status,
        }
      : null,
    supersedesBaselineId: record.supersedesBaselineId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function baselineInput(record: BaselineRecord): PersonnelBaselineInput {
  return {
    employeeId: record.employeeId,
    authorityDocumentId: record.authorityDocumentId,
    authorityEvidenceVersionId: record.authorityEvidenceVersionId,
    firstGovernmentServiceDate: formatDate(record.firstGovernmentServiceDate),
    agencyServiceStartDate: formatDate(record.agencyServiceStartDate),
    organizationUnitId: record.organizationUnitId,
    appointmentStatus: record.appointmentStatus,
    salaryGrade: record.salaryGrade,
    salaryStep: record.salaryStep,
    positionId: record.positionId,
    reason: record.reason,
  };
}

@Injectable()
export class PersonnelBaselinesService {
  constructor(
    @Inject(PERSONNEL_BASELINE_AUDIT_WRITER)
    private readonly auditWriter: PersonnelBaselineAuditWriter,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
    @Inject(PlantillaPositionsService)
    private readonly plantillaPositionsService: PlantillaPositionsService,
  ) {}

  async list(context: RequestContext): Promise<PersonnelBaselineSummary[]> {
    this.assertPermission(context, 'personnel.baselines.read', 'PERSONNEL_BASELINE_READ_FORBIDDEN');
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const records = await transaction.personnelBaseline.findMany({
        where: { agencyId: context.agencyId },
        orderBy: { createdAt: 'desc' },
        take: BASELINE_LIST_LIMIT,
        select: baselineSelect,
      });
      return records.map(baselineSummary);
    });
  }

  async findById(
    context: RequestContext,
    baselineId: string,
  ): Promise<PersonnelBaselineSummary | null> {
    this.assertPermission(context, 'personnel.baselines.read', 'PERSONNEL_BASELINE_READ_FORBIDDEN');
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const record = await this.baselineRecord(transaction, context.agencyId, baselineId);
      return record ? baselineSummary(record) : null;
    });
  }

  async history(
    context: RequestContext,
    baselineId: string,
  ): Promise<PersonnelBaselineHistory | null> {
    this.assertPermission(context, 'personnel.baselines.read', 'PERSONNEL_BASELINE_READ_FORBIDDEN');
    this.assertPermission(
      context,
      'personnel.baselines.audit.read',
      'PERSONNEL_BASELINE_HISTORY_READ_FORBIDDEN',
    );
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const record = await this.baselineRecord(transaction, context.agencyId, baselineId);
      if (!record) return null;
      const entries = await transaction.auditEvent.findMany({
        where: {
          agencyId: context.agencyId,
          entityType: 'PersonnelBaseline',
          entityId: baselineId,
        },
        orderBy: { occurredAt: 'desc' },
        take: BASELINE_LIST_LIMIT,
        select: {
          id: true,
          action: true,
          previousStatus: true,
          newStatus: true,
          reason: true,
          idempotencyKey: true,
          metadata: true,
          occurredAt: true,
        },
      });
      return {
        baseline: baselineSummary(record),
        entries: entries.map((entry) => ({ ...entry, occurredAt: entry.occurredAt.toISOString() })),
      };
    });
  }

  async create(
    context: RequestContext,
    rawInput: PersonnelBaselineInput,
  ): Promise<PersonnelBaselineSummary> {
    this.assertPermission(
      context,
      'personnel.baselines.prepare',
      'PERSONNEL_BASELINE_PREPARE_FORBIDDEN',
    );
    const input = normalizeInput(rawInput);
    const dates = this.inputDates(input);
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.validateReferences(transaction, context, input, dates);
      const record = await transaction.personnelBaseline.create({
        data: this.baselineData(context, input, dates),
        select: baselineSelect,
      });
      await this.writeAudit(transaction, context, {
        action: 'PERSONNEL_BASELINE_PREPARED',
        entityId: record.id,
        previousStatus: 'None',
        newStatus: 'DRAFT',
        reason: input.reason,
        metadata: this.inputMetadata(input),
      });
      return baselineSummary(record);
    });
  }

  async updateDraft(
    context: RequestContext,
    baselineId: string,
    rawInput: PersonnelBaselineInput,
    rowVersion?: number,
  ): Promise<PersonnelBaselineSummary> {
    this.assertPermission(
      context,
      'personnel.baselines.prepare',
      'PERSONNEL_BASELINE_PREPARE_FORBIDDEN',
    );
    const input = normalizeInput(rawInput);
    const dates = this.inputDates(input);
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockBaseline(transaction, context.agencyId, baselineId);
      const current = await this.baselineRecord(transaction, context.agencyId, baselineId);
      if (!current) throw this.notFound();
      if (!['DRAFT', 'RETURNED'].includes(current.status))
        throw this.editNotAllowed(current.status);
      await this.validateReferences(transaction, context, input, dates);
      const result = await transaction.personnelBaseline.updateMany({
        where: {
          agencyId: context.agencyId,
          id: baselineId,
          status: current.status,
          ...(rowVersion === undefined ? {} : { rowVersion }),
        },
        data: {
          authorityDocumentId: input.authorityDocumentId,
          authorityEvidenceVersionId: input.authorityEvidenceVersionId,
          firstGovernmentServiceDate: dates.firstGovernmentServiceDate,
          agencyServiceStartDate: dates.agencyServiceStartDate,
          organizationUnitId: input.organizationUnitId,
          appointmentStatus: input.appointmentStatus,
          salaryGrade: input.salaryGrade ?? null,
          salaryStep: input.salaryStep ?? null,
          positionId: input.positionId ?? null,
          reason: input.reason,
          updatedByMembershipId: context.membershipId,
        },
      });
      if (result.count !== 1) throw this.versionConflict();
      const updated = await this.baselineRecord(transaction, context.agencyId, baselineId);
      if (!updated) throw this.notFound();
      await this.writeAudit(transaction, context, {
        action: 'PERSONNEL_BASELINE_UPDATED',
        entityId: baselineId,
        previousStatus: current.status,
        newStatus: current.status,
        reason: input.reason,
        metadata: this.inputMetadata(input),
      });
      return baselineSummary(updated);
    });
  }

  async submit(context: RequestContext, baselineId: string): Promise<PersonnelBaselineSummary> {
    this.assertPermission(
      context,
      'personnel.baselines.prepare',
      'PERSONNEL_BASELINE_PREPARE_FORBIDDEN',
    );
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockBaseline(transaction, context.agencyId, baselineId);
      const current = await this.baselineRecord(transaction, context.agencyId, baselineId);
      if (!current) throw this.notFound();
      if (!['DRAFT', 'RETURNED'].includes(current.status))
        throw this.submitNotAllowed(current.status);
      const input = normalizeInput(baselineInput(current));
      const dates = this.inputDates(input);
      await this.validateReferences(transaction, context, input, dates);
      const updated = await transaction.personnelBaseline.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: baselineId } },
        data: { status: 'FOR_REVIEW', updatedByMembershipId: context.membershipId },
        select: baselineSelect,
      });
      await this.writeAudit(transaction, context, {
        action: 'PERSONNEL_BASELINE_SUBMITTED',
        entityId: baselineId,
        previousStatus: current.status,
        newStatus: 'FOR_REVIEW',
        reason: current.reason,
        metadata: this.inputMetadata(input),
      });
      return baselineSummary(updated);
    });
  }

  async review(
    context: RequestContext,
    baselineId: string,
    input: PersonnelBaselineReviewInput,
  ): Promise<PersonnelBaselineSummary> {
    this.assertPermission(
      context,
      'personnel.baselines.review',
      'PERSONNEL_BASELINE_REVIEW_FORBIDDEN',
    );
    const reason = input.reason.trim();
    if (!reason) throw this.reviewReasonRequired();
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockBaseline(transaction, context.agencyId, baselineId);
      const current = await this.baselineRecord(transaction, context.agencyId, baselineId);
      if (!current) throw this.notFound();
      if (current.status !== 'FOR_REVIEW') throw this.reviewNotAllowed(current.status);
      if (input.decision === 'APPROVE') {
        const baseline = normalizeInput(baselineInput(current));
        await this.validateReferences(transaction, context, baseline, this.inputDates(baseline));
      }
      const status =
        input.decision === 'APPROVE'
          ? 'APPROVED'
          : input.decision === 'RETURN'
            ? 'RETURNED'
            : 'REJECTED';
      const updated = await transaction.personnelBaseline.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: baselineId } },
        data: {
          status,
          reason,
          reviewedByMembershipId: context.membershipId,
          reviewedAt: new Date(),
          updatedByMembershipId: context.membershipId,
        },
        select: baselineSelect,
      });
      await this.writeAudit(transaction, context, {
        action: 'PERSONNEL_BASELINE_REVIEWED',
        entityId: baselineId,
        previousStatus: current.status,
        newStatus: status,
        reason,
        metadata: { decision: input.decision },
      });
      return baselineSummary(updated);
    });
  }

  async effectuate(
    context: RequestContext,
    baselineId: string,
    rawIdempotencyKey?: string,
  ): Promise<PersonnelBaselineSummary> {
    this.assertPermission(
      context,
      'personnel.baselines.effectuate',
      'PERSONNEL_BASELINE_EFFECTUATE_FORBIDDEN',
    );
    const idempotencyKey =
      normalizeIdempotencyKey(rawIdempotencyKey) || `personnel-baseline:${baselineId}`;
    return withDatabaseContext(
      requestDatabaseContext(
        context,
        'personnel-baseline-transition',
        'plantilla-position-transition',
      ),
      async (transaction) => {
        await this.lockBaseline(transaction, context.agencyId, baselineId);
        const current = await this.baselineRecord(transaction, context.agencyId, baselineId);
        if (!current) throw this.notFound();
        if (current.status === 'EFFECTIVE') return baselineSummary(current);
        if (current.status !== 'APPROVED') throw this.effectuationNotAllowed(current.status);

        const source = current.supersedesBaselineId
          ? await this.lockedSource(transaction, context.agencyId, current.supersedesBaselineId)
          : null;
        if (current.supersedesBaselineId && (!source || source.status !== 'EFFECTIVE')) {
          throw this.correctionSourceInvalid();
        }
        if (source && source.positionId !== current.positionId) {
          throw this.correctionPositionUnsupported();
        }

        await this.lockEmployee(transaction, context.agencyId, current.employeeId);
        if (current.positionId)
          await this.lockPosition(transaction, context.agencyId, current.positionId);
        const input = normalizeInput(baselineInput(current));
        const dates = this.inputDates(input);
        const references = await this.validateReferences(transaction, context, input, dates, {
          employeeStatuses: source ? ['ACTIVE'] : ['PREBOARDING'],
          ...(source?.positionId ? { allowOccupiedPositionId: source.positionId } : {}),
        });
        await this.assertNoOverlaps(transaction, context.agencyId, input, dates, source);

        if (source?.serviceSegmentId) {
          await transaction.serviceSegment.update({
            where: { agencyId_id: { agencyId: context.agencyId, id: source.serviceSegmentId } },
            data: { status: 'VOIDED' },
          });
        }
        if (source?.positionIncumbencyId) {
          await transaction.positionIncumbency.update({
            where: {
              agencyId_id: { agencyId: context.agencyId, id: source.positionIncumbencyId },
            },
            data: { status: 'VOIDED' },
          });
        }
        if (source) {
          await transaction.personnelBaseline.update({
            where: { agencyId_id: { agencyId: context.agencyId, id: source.id } },
            data: { status: 'SUPERSEDED', updatedByMembershipId: context.membershipId },
          });
          await this.writeAudit(transaction, context, {
            action: 'PERSONNEL_BASELINE_SUPERSEDED',
            entityId: source.id,
            previousStatus: source.status,
            newStatus: 'SUPERSEDED',
            reason: input.reason,
            metadata: { replacementBaselineId: current.id },
          });
        }

        const serviceSegment = await transaction.serviceSegment.create({
          data: {
            agencyId: context.agencyId,
            employeeId: current.employeeId,
            appointmentId: null,
            personnelActionId: null,
            positionId: input.positionId ?? null,
            organizationUnitId: input.organizationUnitId,
            segmentType: 'PRIMARY',
            appointmentStatus: input.appointmentStatus,
            salaryGrade: input.salaryGrade ?? null,
            salaryStep: input.salaryStep ?? null,
            effectiveFrom: dates.agencyServiceStartDate,
            effectiveTo: null,
            status: 'ACTIVE',
            createdByMembershipId: context.membershipId,
          },
          select: { id: true },
        });
        const positionIncumbency = input.positionId
          ? await transaction.positionIncumbency.create({
              data: {
                agencyId: context.agencyId,
                positionId: input.positionId ?? null,
                employeeId: current.employeeId,
                serviceSegmentId: serviceSegment.id,
                effectiveFrom: dates.agencyServiceStartDate,
                effectiveTo: null,
                status: 'ACTIVE',
                createdByMembershipId: context.membershipId,
              },
              select: { id: true },
            })
          : null;

        if (!source && references.position) {
          await this.plantillaPositionsService.occupyInTransaction(
            transaction,
            context,
            references.position.id,
            input.agencyServiceStartDate,
            input.reason,
            `${idempotencyKey}:position`,
          );
        }

        await transaction.employee.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: current.employeeId } },
          data: {
            serviceStatus: 'ACTIVE',
            firstGovernmentServiceDate: dates.firstGovernmentServiceDate,
            agencyServiceStartDate: dates.agencyServiceStartDate,
            currentServiceSegmentId: serviceSegment.id,
            updatedByMembershipId: context.membershipId,
          },
        });
        const effectuated = await transaction.personnelBaseline.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: current.id } },
          data: {
            status: 'EFFECTIVE',
            effectuatedByMembershipId: context.membershipId,
            effectuatedAt: new Date(),
            serviceSegmentId: serviceSegment.id,
            positionIncumbencyId: positionIncumbency?.id ?? null,
            updatedByMembershipId: context.membershipId,
          },
          select: baselineSelect,
        });
        await this.writeAudit(transaction, context, {
          action: 'PERSONNEL_BASELINE_EFFECTUATED',
          entityId: current.id,
          previousStatus: current.status,
          newStatus: 'EFFECTIVE',
          reason: input.reason,
          idempotencyKey,
          metadata: {
            employeeId: current.employeeId,
            serviceSegmentId: serviceSegment.id,
            positionIncumbencyId: positionIncumbency?.id ?? null,
            positionId: input.positionId ?? null,
            agencyServiceStartDate: input.agencyServiceStartDate,
            authorityDocumentId: input.authorityDocumentId,
            authorityEvidenceVersionId: input.authorityEvidenceVersionId,
          },
        });
        await transaction.outboxEvent.create({
          data: {
            agencyId: context.agencyId,
            eventType: 'PERSONNEL_BASELINE_EFFECTUATED',
            aggregateType: 'PersonnelBaseline',
            aggregateId: current.id,
            idempotencyKey,
            payload: {
              baselineId: current.id,
              employeeId: current.employeeId,
              serviceSegmentId: serviceSegment.id,
              positionIncumbencyId: positionIncumbency?.id ?? null,
              positionId: input.positionId ?? null,
              agencyServiceStartDate: input.agencyServiceStartDate,
            },
          },
        });
        return baselineSummary(effectuated);
      },
    );
  }

  async correct(
    context: RequestContext,
    baselineId: string,
    rawInput: PersonnelBaselineInput,
  ): Promise<PersonnelBaselineSummary> {
    this.assertPermission(
      context,
      'personnel.baselines.correct',
      'PERSONNEL_BASELINE_CORRECT_FORBIDDEN',
    );
    const input = normalizeInput(rawInput);
    const dates = this.inputDates(input);
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockBaseline(transaction, context.agencyId, baselineId);
      const source = await this.baselineRecord(transaction, context.agencyId, baselineId);
      if (!source) throw this.notFound();
      if (source.status !== 'EFFECTIVE') throw this.correctionNotAllowed(source.status);
      if (source.employeeId !== input.employeeId) throw this.correctionEmployeeUnsupported();
      if (source.positionId !== input.positionId) throw this.correctionPositionUnsupported();
      if (source.agencyServiceStartDate.getTime() !== dates.agencyServiceStartDate.getTime()) {
        throw this.correctionServiceStartUnsupported();
      }
      await this.lockEmployee(transaction, context.agencyId, source.employeeId);
      if (source.positionId)
        await this.lockPosition(transaction, context.agencyId, source.positionId);
      await this.validateReferences(transaction, context, input, dates, {
        employeeStatuses: ['ACTIVE'],
        ...(source.positionId ? { allowOccupiedPositionId: source.positionId } : {}),
      });
      const replacement = await transaction.personnelBaseline.create({
        data: {
          ...this.baselineData(context, input, dates),
          supersedesBaselineId: source.id,
        },
        select: baselineSelect,
      });
      await this.writeAudit(transaction, context, {
        action: 'PERSONNEL_BASELINE_CORRECTION_PREPARED',
        entityId: replacement.id,
        previousStatus: 'None',
        newStatus: 'DRAFT',
        reason: input.reason,
        metadata: { supersedesBaselineId: source.id },
      });
      return baselineSummary(replacement);
    });
  }

  async void(
    context: RequestContext,
    baselineId: string,
    reason: string,
  ): Promise<PersonnelBaselineSummary> {
    this.assertPermission(
      context,
      'personnel.baselines.correct',
      'PERSONNEL_BASELINE_CORRECT_FORBIDDEN',
    );
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw this.voidReasonRequired();
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockBaseline(transaction, context.agencyId, baselineId);
      const current = await this.baselineRecord(transaction, context.agencyId, baselineId);
      if (!current) throw this.notFound();
      if (current.status === 'EFFECTIVE' || current.status === 'SUPERSEDED') {
        throw this.voidNotAllowed(current.status);
      }
      const updated = await transaction.personnelBaseline.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: baselineId } },
        data: {
          status: 'VOIDED',
          reason: normalizedReason,
          updatedByMembershipId: context.membershipId,
        },
        select: baselineSelect,
      });
      await this.writeAudit(transaction, context, {
        action: 'PERSONNEL_BASELINE_VOIDED',
        entityId: baselineId,
        previousStatus: current.status,
        newStatus: 'VOIDED',
        reason: normalizedReason,
        metadata: {},
      });
      return baselineSummary(updated);
    });
  }

  private async validateReferences(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: PersonnelBaselineInput,
    dates: { firstGovernmentServiceDate: Date; agencyServiceStartDate: Date },
    options: {
      employeeStatuses?: readonly string[];
      allowOccupiedPositionId?: string;
    } = {},
  ): Promise<ValidatedReferences> {
    if (!input.reason) throw this.reasonRequired();
    if (!input.appointmentStatus) throw this.appointmentStatusRequired();
    if ((input.salaryGrade === null) !== (input.salaryStep === null)) {
      throw this.salaryPairRequired();
    }
    const employee = await transaction.employee.findUnique({
      where: { agencyId_id: { agencyId: context.agencyId, id: input.employeeId } },
      select: { id: true, serviceStatus: true, currentServiceSegmentId: true },
    });
    if (!employee) throw this.employeeNotFound();
    const employeeStatuses = options.employeeStatuses ?? ['PREBOARDING'];
    if (!employeeStatuses.includes(employee.serviceStatus)) {
      throw this.employeeStatusInvalid(employee.serviceStatus);
    }

    this.assertPermission(
      context,
      'documents.evidence.read',
      'PERSONNEL_BASELINE_EVIDENCE_READ_FORBIDDEN',
    );
    const evidenceResult = await this.documentsService.resolveExternalEvidenceInTransaction(
      transaction,
      context,
      {
        documentId: input.authorityDocumentId,
        versionId: input.authorityEvidenceVersionId,
        allowSensitive: hasPermission(context, 'documents.evidence.read_sensitive', {
          agencyId: context.agencyId,
        }),
        requirement: 'LINKABLE_STATUS',
      },
    );
    if (evidenceResult.ok === false && evidenceResult.reason === 'DOCUMENT_NOT_FOUND') {
      throw this.evidenceNotFound();
    }
    if (evidenceResult.ok === false && evidenceResult.reason === 'SENSITIVE_FORBIDDEN') {
      throw this.evidenceSensitiveForbidden();
    }
    if (!evidenceResult.ok) throw this.evidenceIneligible();
    const evidence = evidenceResult.document;

    const organizationVersion = await transaction.organizationUnitVersion.findFirst({
      where: {
        agencyId: context.agencyId,
        organizationUnitId: input.organizationUnitId,
        status: { in: ['ACTIVE', 'SUPERSEDED'] },
        domainStatus: 'ACTIVE',
        effectiveFrom: { lte: dates.agencyServiceStartDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: dates.agencyServiceStartDate } }],
      },
      orderBy: { effectiveFrom: 'desc' },
      select: { organizationUnit: { select: { id: true, code: true } } },
    });
    if (!organizationVersion) throw this.organizationUnitInvalid();

    let position: ValidatedReferences['position'] = null;
    if (input.positionId) {
      const positionRecord = await transaction.plantillaPosition.findFirst({
        where: { agencyId: context.agencyId, id: input.positionId },
        select: {
          id: true,
          itemNumber: true,
          status: true,
          versions: {
            where: {
              status: { in: ['ACTIVE', 'SUPERSEDED'] },
              effectiveFrom: { lte: dates.agencyServiceStartDate },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: dates.agencyServiceStartDate } }],
            },
            orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
            take: 1,
            select: { id: true, salaryGrade: true, organizationUnitId: true, domainStatus: true },
          },
        },
      });
      const version = positionRecord?.versions[0];
      if (!positionRecord || !version) throw this.positionInvalid();
      const occupiedByCorrection = options.allowOccupiedPositionId === positionRecord.id;
      if (!occupiedByCorrection && positionRecord.status !== 'VACANT') {
        throw this.positionIneligible(positionRecord.status);
      }
      if (
        version.domainStatus !== 'VACANT' &&
        !(occupiedByCorrection && version.domainStatus === 'OCCUPIED')
      ) {
        throw this.positionIneligible(version.domainStatus);
      }
      if (version.organizationUnitId !== input.organizationUnitId) {
        throw this.positionOrganizationMismatch();
      }
      if (input.salaryGrade !== version.salaryGrade) throw this.positionSalaryMismatch();
      if (input.salaryStep === null) throw this.salaryStepRequired();
      position = {
        id: positionRecord.id,
        itemNumber: positionRecord.itemNumber,
        status: positionRecord.status,
        version,
      };
    }
    return {
      employee,
      evidence,
      organizationUnit: organizationVersion.organizationUnit,
      position,
    };
  }

  private inputDates(input: PersonnelBaselineInput) {
    const firstGovernmentServiceDate = toDatabaseDate(input.firstGovernmentServiceDate);
    const agencyServiceStartDate = toDatabaseDate(input.agencyServiceStartDate);
    if (firstGovernmentServiceDate > agencyServiceStartDate) {
      throw this.serviceDatesInvalid();
    }
    return { firstGovernmentServiceDate, agencyServiceStartDate };
  }

  private baselineData(
    context: RequestContext,
    input: PersonnelBaselineInput,
    dates: { firstGovernmentServiceDate: Date; agencyServiceStartDate: Date },
  ): Prisma.PersonnelBaselineUncheckedCreateInput {
    return {
      agencyId: context.agencyId,
      employeeId: input.employeeId,
      authorityDocumentId: input.authorityDocumentId,
      authorityEvidenceVersionId: input.authorityEvidenceVersionId,
      firstGovernmentServiceDate: dates.firstGovernmentServiceDate,
      agencyServiceStartDate: dates.agencyServiceStartDate,
      organizationUnitId: input.organizationUnitId,
      appointmentStatus: input.appointmentStatus,
      salaryGrade: input.salaryGrade ?? null,
      salaryStep: input.salaryStep ?? null,
      positionId: input.positionId ?? null,
      status: 'DRAFT',
      reason: input.reason,
      createdByMembershipId: context.membershipId,
      updatedByMembershipId: context.membershipId,
    };
  }

  private inputMetadata(input: PersonnelBaselineInput): Prisma.InputJsonObject {
    return {
      employeeId: input.employeeId,
      authorityDocumentId: input.authorityDocumentId,
      authorityEvidenceVersionId: input.authorityEvidenceVersionId,
      firstGovernmentServiceDate: input.firstGovernmentServiceDate,
      agencyServiceStartDate: input.agencyServiceStartDate,
      organizationUnitId: input.organizationUnitId,
      appointmentStatus: input.appointmentStatus,
      salaryGrade: input.salaryGrade ?? null,
      salaryStep: input.salaryStep ?? null,
      positionId: input.positionId ?? null,
    };
  }

  private async assertNoOverlaps(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    input: PersonnelBaselineInput,
    dates: { agencyServiceStartDate: Date },
    source: BaselineRecord | null,
  ): Promise<void> {
    const serviceSegment = await transaction.serviceSegment.findFirst({
      where: {
        agencyId,
        employeeId: input.employeeId,
        segmentType: 'PRIMARY',
        status: { not: 'VOIDED' },
        ...(source?.serviceSegmentId ? { id: { not: source.serviceSegmentId } } : {}),
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: dates.agencyServiceStartDate } }],
      },
      select: { id: true },
    });
    if (serviceSegment) throw this.serviceSegmentOverlap();
    if (!input.positionId) return;
    const incumbency = await transaction.positionIncumbency.findFirst({
      where: {
        agencyId,
        positionId: input.positionId ?? null,
        status: { not: 'VOIDED' },
        ...(source?.positionIncumbencyId ? { id: { not: source.positionIncumbencyId } } : {}),
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: dates.agencyServiceStartDate } }],
      },
      select: { id: true },
    });
    if (incumbency) throw this.positionIncumbencyOverlap();
  }

  private async baselineRecord(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    baselineId: string,
  ): Promise<BaselineRecord | null> {
    return transaction.personnelBaseline.findFirst({
      where: { agencyId, id: baselineId },
      select: baselineSelect,
    });
  }

  private async lockedSource(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    baselineId: string,
  ): Promise<BaselineRecord | null> {
    await this.lockBaseline(transaction, agencyId, baselineId);
    return this.baselineRecord(transaction, agencyId, baselineId);
  }

  private async lockBaseline(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    baselineId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "personnel_baselines" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${baselineId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) throw this.notFound();
  }

  private async lockEmployee(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "employees" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${employeeId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) throw this.employeeNotFound();
  }

  private async lockPosition(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    positionId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "plantilla_positions" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${positionId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) throw this.positionInvalid();
  }

  private async writeAudit(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    event: {
      action: string;
      entityId: string;
      previousStatus: string;
      newStatus: string;
      reason: string;
      metadata: Prisma.InputJsonObject;
      idempotencyKey?: string;
    },
  ): Promise<void> {
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action: event.action,
      entityType: 'PersonnelBaseline',
      entityId: event.entityId,
      previousStatus: event.previousStatus,
      newStatus: event.newStatus,
      reason: event.reason,
      requestId: context.requestId,
      occurredAt: new Date(),
      ...(event.idempotencyKey ? { idempotencyKey: event.idempotencyKey } : {}),
      metadata: event.metadata,
    });
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (
      !context.agencyId ||
      !context.userId ||
      !context.membershipId ||
      !hasPermission(context, permission, { agencyId: context.agencyId })
    ) {
      throw new PersonnelBaselineServiceError(
        'The current Agency Membership lacks the required permission.',
        403,
        code,
      );
    }
  }

  private notFound(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'The Personnel Baseline could not be found.',
      404,
      'PERSONNEL_BASELINE_NOT_FOUND',
    );
  }

  private reasonRequired(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'A reason is required for a Personnel Baseline.',
      400,
      'PERSONNEL_BASELINE_REASON_REQUIRED',
    );
  }

  private appointmentStatusRequired(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'Appointment status is required.',
      400,
      'PERSONNEL_BASELINE_APPOINTMENT_STATUS_REQUIRED',
    );
  }

  private salaryPairRequired(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'Salary grade and salary step must be supplied together.',
      400,
      'PERSONNEL_BASELINE_SALARY_PAIR_REQUIRED',
    );
  }

  private salaryStepRequired(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'A salary step is required when a Plantilla Position is selected.',
      409,
      'PERSONNEL_BASELINE_SALARY_STEP_REQUIRED',
    );
  }

  private serviceDatesInvalid(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'The first government service date cannot follow the Agency service start date.',
      400,
      'PERSONNEL_BASELINE_SERVICE_DATES_INVALID',
    );
  }

  private employeeNotFound(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'The Employee is not available in this Agency.',
      404,
      'PERSONNEL_BASELINE_EMPLOYEE_NOT_FOUND',
    );
  }

  private employeeStatusInvalid(status: string): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      `The Employee is ${status} and cannot receive this Personnel Baseline.`,
      409,
      'PERSONNEL_BASELINE_EMPLOYEE_STATUS_INVALID',
    );
  }

  private evidenceNotFound(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'The authority evidence is not available in this Agency.',
      404,
      'PERSONNEL_BASELINE_EVIDENCE_NOT_FOUND',
    );
  }

  private evidenceIneligible(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'The authority evidence must be approved, issued, or superseded.',
      409,
      'PERSONNEL_BASELINE_EVIDENCE_INELIGIBLE',
    );
  }

  private evidenceSensitiveForbidden(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'The authority evidence is highly sensitive for the current Agency Membership.',
      403,
      'PERSONNEL_BASELINE_EVIDENCE_SENSITIVE_FORBIDDEN',
    );
  }

  private organizationUnitInvalid(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'The Organization Unit is not active for the Agency service start date.',
      409,
      'PERSONNEL_BASELINE_ORGANIZATION_UNIT_INVALID',
    );
  }

  private positionInvalid(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'The Plantilla Position is not available in this Agency.',
      409,
      'PERSONNEL_BASELINE_POSITION_INVALID',
    );
  }

  private positionIneligible(status: string): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      `The Plantilla Position is ${status} and cannot be occupied by this baseline.`,
      409,
      'PERSONNEL_BASELINE_POSITION_INELIGIBLE',
    );
  }

  private positionOrganizationMismatch(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'The selected Plantilla Position belongs to another Organization Unit for the effective date.',
      409,
      'PERSONNEL_BASELINE_POSITION_ORGANIZATION_MISMATCH',
    );
  }

  private positionSalaryMismatch(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'The salary grade must match the selected Plantilla Position.',
      409,
      'PERSONNEL_BASELINE_POSITION_SALARY_MISMATCH',
    );
  }

  private serviceSegmentOverlap(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'The Employee already has an overlapping primary Service Segment.',
      409,
      'PERSONNEL_BASELINE_SERVICE_SEGMENT_OVERLAP',
    );
  }

  private positionIncumbencyOverlap(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'The Plantilla Position already has a conflicting Position Incumbency.',
      409,
      'PERSONNEL_BASELINE_POSITION_INCUMBENCY_OVERLAP',
    );
  }

  private editNotAllowed(status: string): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      `A Personnel Baseline in ${status} cannot be edited.`,
      409,
      'PERSONNEL_BASELINE_EDIT_NOT_ALLOWED',
    );
  }

  private submitNotAllowed(status: string): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      `A Personnel Baseline in ${status} cannot be submitted for review.`,
      409,
      'PERSONNEL_BASELINE_SUBMIT_NOT_ALLOWED',
    );
  }

  private reviewReasonRequired(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'A review decision requires a reason.',
      400,
      'PERSONNEL_BASELINE_REVIEW_REASON_REQUIRED',
    );
  }

  private reviewNotAllowed(status: string): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      `A Personnel Baseline in ${status} is not awaiting review.`,
      409,
      'PERSONNEL_BASELINE_REVIEW_NOT_ALLOWED',
    );
  }

  private effectuationNotAllowed(status: string): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      `A Personnel Baseline in ${status} cannot be effectuated.`,
      409,
      'PERSONNEL_BASELINE_EFFECTUATION_NOT_ALLOWED',
    );
  }

  private correctionNotAllowed(status: string): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      `A Personnel Baseline in ${status} cannot be corrected.`,
      409,
      'PERSONNEL_BASELINE_CORRECTION_NOT_ALLOWED',
    );
  }

  private correctionSourceInvalid(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'The effective Personnel Baseline being corrected is no longer current.',
      409,
      'PERSONNEL_BASELINE_CORRECTION_SOURCE_INVALID',
    );
  }

  private correctionPositionUnsupported(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'A baseline correction must keep the existing Plantilla Position.',
      409,
      'PERSONNEL_BASELINE_CORRECTION_POSITION_UNSUPPORTED',
    );
  }

  private correctionServiceStartUnsupported(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'A baseline correction cannot move the Plantilla occupancy effective date.',
      409,
      'PERSONNEL_BASELINE_CORRECTION_SERVICE_START_UNSUPPORTED',
    );
  }

  private correctionEmployeeUnsupported(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'A baseline correction must keep the existing Employee.',
      409,
      'PERSONNEL_BASELINE_CORRECTION_EMPLOYEE_UNSUPPORTED',
    );
  }

  private voidReasonRequired(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'A reason is required to void a Personnel Baseline.',
      400,
      'PERSONNEL_BASELINE_VOID_REASON_REQUIRED',
    );
  }

  private voidNotAllowed(status: string): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      `A Personnel Baseline in ${status} cannot be voided.`,
      409,
      'PERSONNEL_BASELINE_VOID_NOT_ALLOWED',
    );
  }

  private versionConflict(): PersonnelBaselineServiceError {
    return new PersonnelBaselineServiceError(
      'The Personnel Baseline changed; reload and try again.',
      409,
      'PERSONNEL_BASELINE_VERSION_CONFLICT',
    );
  }
}
