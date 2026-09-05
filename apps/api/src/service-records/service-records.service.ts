import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canAccessRecord, hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';

const RENDERING_CONTRACT_VERSION = 'service-record-printable-v1';

export interface ServiceRecordGenerationInput {
  employeeId: string;
  asOfDate: string;
}

export interface ServiceRecordReplacementInput {
  reason: string;
  evidenceDocumentId: string;
  evidenceDocumentVersionId: string;
}

export interface ServiceRecordData {
  label: 'Printable System View';
  disclaimer: string;
  renderingContractVersion: string;
  asOfDate: string;
  employee: { id: string; employeeNumber: string; legalName: string };
  serviceSegments: Array<{
    id: string;
    personnelActionId: string | null;
    segmentType: string;
    appointmentStatus: string;
    position: {
      id: string;
      versionId: string | null;
      itemNumber: string;
      title: string | null;
    } | null;
    organizationUnit: { id: string; versionId: string | null; code: string; name: string | null };
    salaryGrade: number | null;
    salaryStep: number | null;
    effectiveFrom: string;
    effectiveTo: string | null;
    status: string;
  }>;
  personnelActions: Array<{
    id: string;
    actionType: string;
    status: string;
    versionId: string;
    proposedEffectivity: string;
    evidenceVersionIds: string[];
  }>;
  sourceReferences: {
    serviceSegmentIds: string[];
    personnelActionIds: string[];
    personnelActionVersionIds: string[];
    evidenceVersionIds: string[];
    organizationUnitVersionIds: string[];
    positionVersionIds: string[];
  };
}

export interface ServiceRecordSummary {
  id: string;
  asOfDate: string;
  renderingContractVersion: string;
  snapshot: ServiceRecordData;
  employee: { id: string; employeeNumber: string; legalName: string };
  generatedBy: { id: string; displayName: string };
  generatedAt: string;
  supersedesSnapshotId: string | null;
  replacementSnapshotId: string | null;
  correctionReason: string | null;
  correctionEvidence: {
    documentId: string;
    documentVersionId: string;
    documentNo: string | null;
    versionNo: number;
  } | null;
}

export interface ServiceRecordAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const SERVICE_RECORD_AUDIT_WRITER = Symbol('SERVICE_RECORD_AUDIT_WRITER');

export const serviceRecordAuditWriter: ServiceRecordAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};

export class ServiceRecordServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ServiceRecordServiceError';
  }
}

const serviceRecordSelect = {
  id: true,
  agencyId: true,
  asOfDate: true,
  renderingContractVersion: true,
  snapshot: true,
  generatedAt: true,
  supersedesSnapshotId: true,
  correctionReason: true,
  employee: {
    select: {
      id: true,
      employeeNumber: true,
      legalName: true,
      memberships: { select: { userId: true } },
    },
  },
  generatedBy: { select: { id: true, user: { select: { displayName: true } } } },
  replacementSnapshot: { select: { id: true } },
  correctionEvidence: { select: { id: true, documentNo: true } },
  correctionEvidenceVersion: { select: { id: true, versionNo: true } },
} as const;

type ServiceRecordRow = Prisma.ServiceRecordSnapshotGetPayload<{
  select: typeof serviceRecordSelect;
}>;

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function databaseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw dateInvalid();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatDate(date) !== value) throw dateInvalid();
  return date;
}

function dateInvalid(): ServiceRecordServiceError {
  return new ServiceRecordServiceError(
    'Enter a valid Service Record as-of date.',
    400,
    'SERVICE_RECORD_DATE_INVALID',
  );
}

function versionAt<T extends { effectiveFrom: Date; effectiveTo: Date | null }>(
  versions: T[],
  date: Date,
): T | undefined {
  return versions.find(
    ({ effectiveFrom, effectiveTo }) =>
      effectiveFrom <= date && (!effectiveTo || effectiveTo >= date),
  );
}

function toSummary(row: ServiceRecordRow): ServiceRecordSummary {
  return {
    id: row.id,
    asOfDate: formatDate(row.asOfDate),
    renderingContractVersion: row.renderingContractVersion,
    snapshot: row.snapshot as unknown as ServiceRecordData,
    employee: {
      id: row.employee.id,
      employeeNumber: row.employee.employeeNumber,
      legalName: row.employee.legalName,
    },
    generatedBy: { id: row.generatedBy.id, displayName: row.generatedBy.user.displayName },
    generatedAt: row.generatedAt.toISOString(),
    supersedesSnapshotId: row.supersedesSnapshotId,
    replacementSnapshotId: row.replacementSnapshot?.id ?? null,
    correctionReason: row.correctionReason,
    correctionEvidence:
      row.correctionEvidence && row.correctionEvidenceVersion
        ? {
            documentId: row.correctionEvidence.id,
            documentVersionId: row.correctionEvidenceVersion.id,
            documentNo: row.correctionEvidence.documentNo,
            versionNo: row.correctionEvidenceVersion.versionNo,
          }
        : null,
  };
}

@Injectable()
export class ServiceRecordsService {
  constructor(
    @Inject(SERVICE_RECORD_AUDIT_WRITER)
    private readonly auditWriter: ServiceRecordAuditWriter,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
  ) {}

  async list(
    context: RequestContext,
    input: { cursor?: string | undefined; limit: number } = { limit: 50 },
  ): Promise<{ records: ServiceRecordSummary[]; nextCursor: string | null }> {
    this.assertAnyReadPermission(context);
    const agencyWide = hasPermission(context, 'personnel.service_records.read', {
      agencyId: context.agencyId,
    });
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const rows = await transaction.serviceRecordSnapshot.findMany({
        where: {
          agencyId: context.agencyId,
          ...(!agencyWide
            ? { employee: { memberships: { some: { userId: context.userId } } } }
            : {}),
        },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        select: serviceRecordSelect,
      });
      const page = rows.slice(0, input.limit);
      return {
        records: page.map(toSummary),
        nextCursor: rows.length > input.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  async findById(
    context: RequestContext,
    snapshotId: string,
    accessKind: 'DETAIL' | 'PRINTABLE' | 'STRUCTURED' = 'DETAIL',
  ): Promise<ServiceRecordSummary | null> {
    this.assertAnyReadPermission(context);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const row = await transaction.serviceRecordSnapshot.findUnique({
        where: { agencyId_id: { agencyId: context.agencyId, id: snapshotId } },
        select: serviceRecordSelect,
      });
      if (!row) return null;
      this.assertRecordRead(context, row);
      await this.writeAudit(transaction, context, {
        action: 'SERVICE_RECORD_ACCESSED',
        entityId: row.id,
        metadata: { accessKind },
      });
      return toSummary(row);
    });
  }

  async generate(
    context: RequestContext,
    input: ServiceRecordGenerationInput,
  ): Promise<ServiceRecordSummary> {
    this.assertPermission(
      context,
      'personnel.service_records.generate',
      'SERVICE_RECORD_GENERATE_FORBIDDEN',
    );
    const asOfDate = databaseDate(input.asOfDate);
    return withDatabaseContext(
      requestDatabaseContext(context, 'service-record-transition'),
      async (transaction) => this.createSnapshot(transaction, context, input.employeeId, asOfDate),
    );
  }

  async replace(
    context: RequestContext,
    snapshotId: string,
    input: ServiceRecordReplacementInput,
  ): Promise<ServiceRecordSummary> {
    this.assertPermission(
      context,
      'personnel.service_records.replace',
      'SERVICE_RECORD_REPLACE_FORBIDDEN',
    );
    const reason = input.reason.trim();
    if (!reason) {
      throw new ServiceRecordServiceError(
        'A Service Record replacement reason is required.',
        400,
        'SERVICE_RECORD_REPLACEMENT_REASON_REQUIRED',
      );
    }
    return withDatabaseContext(
      requestDatabaseContext(context, 'service-record-transition'),
      async (transaction) => {
        const source = await transaction.serviceRecordSnapshot.findUnique({
          where: { agencyId_id: { agencyId: context.agencyId, id: snapshotId } },
          select: {
            id: true,
            employeeId: true,
            asOfDate: true,
            replacementSnapshot: { select: { id: true } },
          },
        });
        if (!source) throw this.notFound();
        if (source.replacementSnapshot) {
          throw new ServiceRecordServiceError(
            'This Service Record already has a replacement.',
            409,
            'SERVICE_RECORD_ALREADY_REPLACED',
          );
        }
        const evidence = await this.documentsService.resolveExternalEvidenceInTransaction(
          transaction,
          context,
          {
            documentId: input.evidenceDocumentId,
            versionId: input.evidenceDocumentVersionId,
            allowSensitive: hasPermission(context, 'documents.evidence.read_sensitive', {
              agencyId: context.agencyId,
            }),
            requirement: 'FINALIZED_VERSION',
          },
        );
        if (!evidence.ok) {
          throw new ServiceRecordServiceError(
            'The exact correction evidence version is unavailable or not final.',
            404,
            'SERVICE_RECORD_CORRECTION_EVIDENCE_NOT_FOUND',
          );
        }
        return this.createSnapshot(transaction, context, source.employeeId, source.asOfDate, {
          supersedesSnapshotId: source.id,
          correctionReason: reason,
          correctionEvidenceDocumentId: input.evidenceDocumentId,
          correctionEvidenceDocumentVersionId: input.evidenceDocumentVersionId,
        });
      },
    );
  }

  private async createSnapshot(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    employeeId: string,
    asOfDate: Date,
    correction: {
      supersedesSnapshotId: string;
      correctionReason: string;
      correctionEvidenceDocumentId: string;
      correctionEvidenceDocumentVersionId: string;
    } | null = null,
  ): Promise<ServiceRecordSummary> {
    const employee = await transaction.employee.findUnique({
      where: { agencyId_id: { agencyId: context.agencyId, id: employeeId } },
      select: { id: true, employeeNumber: true, legalName: true },
    });
    if (!employee) throw this.employeeNotFound();

    const segments = await transaction.serviceSegment.findMany({
      where: {
        agencyId: context.agencyId,
        employeeId,
        effectiveFrom: { lte: asOfDate },
        status: { in: ['ACTIVE', 'CLOSED'] },
      },
      orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        personnelActionId: true,
        segmentType: true,
        appointmentStatus: true,
        salaryGrade: true,
        salaryStep: true,
        effectiveFrom: true,
        effectiveTo: true,
        status: true,
        organizationUnit: {
          select: {
            id: true,
            code: true,
            versions: {
              where: { effectiveFrom: { lte: asOfDate } },
              orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
              select: { id: true, name: true, effectiveFrom: true, effectiveTo: true },
            },
          },
        },
        position: {
          select: {
            id: true,
            itemNumber: true,
            versions: {
              where: { effectiveFrom: { lte: asOfDate } },
              orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
              select: {
                id: true,
                positionTitle: true,
                effectiveFrom: true,
                effectiveTo: true,
              },
            },
          },
        },
      },
    });
    if (segments.length === 0) {
      throw new ServiceRecordServiceError(
        'No authoritative Service Segment exists on or before the as-of date.',
        409,
        'SERVICE_RECORD_HISTORY_EMPTY',
      );
    }

    const actions = await transaction.personnelAction.findMany({
      where: {
        agencyId: context.agencyId,
        employeeId,
        status: { in: ['APPROVED', 'EFFECTIVE', 'SUPERSEDED'] },
        currentVersion: { is: { proposedEffectivity: { lte: asOfDate } } },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        actionType: true,
        status: true,
        currentVersion: {
          select: {
            id: true,
            proposedEffectivity: true,
            evidence: { orderBy: { id: 'asc' }, select: { documentVersionId: true } },
          },
        },
      },
    });

    const personnelActions = actions.flatMap((action) =>
      action.currentVersion
        ? [
            {
              id: action.id,
              actionType: action.actionType,
              status: action.status,
              versionId: action.currentVersion.id,
              proposedEffectivity: formatDate(action.currentVersion.proposedEffectivity),
              evidenceVersionIds: action.currentVersion.evidence.map(
                ({ documentVersionId }) => documentVersionId,
              ),
            },
          ]
        : [],
    );
    const snapshot: ServiceRecordData = {
      label: 'Printable System View',
      disclaimer:
        'This is a Printable System View of HRIS history. It is not an Exact Versioned Form, certification, Agency approval, or external filing.',
      renderingContractVersion: RENDERING_CONTRACT_VERSION,
      asOfDate: formatDate(asOfDate),
      employee,
      serviceSegments: segments.map((segment) => {
        const unitVersion = versionAt(segment.organizationUnit.versions, segment.effectiveFrom);
        const positionVersion = segment.position
          ? versionAt(segment.position.versions, segment.effectiveFrom)
          : undefined;
        return {
          id: segment.id,
          personnelActionId: segment.personnelActionId,
          segmentType: segment.segmentType,
          appointmentStatus: segment.appointmentStatus,
          position: segment.position
            ? {
                id: segment.position.id,
                versionId: positionVersion?.id ?? null,
                itemNumber: segment.position.itemNumber,
                title: positionVersion?.positionTitle ?? null,
              }
            : null,
          organizationUnit: {
            id: segment.organizationUnit.id,
            versionId: unitVersion?.id ?? null,
            code: segment.organizationUnit.code,
            name: unitVersion?.name ?? null,
          },
          salaryGrade: segment.salaryGrade,
          salaryStep: segment.salaryStep,
          effectiveFrom: formatDate(segment.effectiveFrom),
          effectiveTo: segment.effectiveTo ? formatDate(segment.effectiveTo) : null,
          status: segment.status,
        };
      }),
      personnelActions,
      sourceReferences: {
        serviceSegmentIds: segments.map(({ id }) => id),
        personnelActionIds: personnelActions.map(({ id }) => id),
        personnelActionVersionIds: personnelActions.map(({ versionId }) => versionId),
        evidenceVersionIds: personnelActions.flatMap(
          ({ evidenceVersionIds }) => evidenceVersionIds,
        ),
        organizationUnitVersionIds: segments.flatMap((segment) => {
          const version = versionAt(segment.organizationUnit.versions, segment.effectiveFrom);
          return version ? [version.id] : [];
        }),
        positionVersionIds: segments.flatMap((segment) => {
          const version = segment.position
            ? versionAt(segment.position.versions, segment.effectiveFrom)
            : undefined;
          return version ? [version.id] : [];
        }),
      },
    };
    const row = await transaction.serviceRecordSnapshot.create({
      data: {
        agencyId: context.agencyId,
        employeeId,
        asOfDate,
        renderingContractVersion: RENDERING_CONTRACT_VERSION,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        generatedByMembershipId: context.membershipId,
        ...correction,
      },
      select: serviceRecordSelect,
    });
    await this.writeAudit(transaction, context, {
      action: correction ? 'SERVICE_RECORD_REPLACED' : 'SERVICE_RECORD_GENERATED',
      entityId: row.id,
      ...(correction ? { reason: correction.correctionReason } : {}),
      metadata: {
        employeeId,
        asOfDate: snapshot.asOfDate,
        renderingContractVersion: RENDERING_CONTRACT_VERSION,
        sourceReferences: snapshot.sourceReferences,
        ...(correction ? { supersedesSnapshotId: correction.supersedesSnapshotId } : {}),
      },
    });
    return toSummary(row);
  }

  private assertAnyReadPermission(context: RequestContext): void {
    if (!context.permissions.some(({ code }) => code === 'personnel.service_records.read')) {
      throw new ServiceRecordServiceError(
        'You do not have permission to read Service Records.',
        403,
        'SERVICE_RECORD_READ_FORBIDDEN',
      );
    }
  }

  private assertRecordRead(context: RequestContext, row: ServiceRecordRow): void {
    if (
      !canAccessRecord(context, 'personnel.service_records.read', {
        agencyId: row.agencyId,
        ...(row.employee.memberships[0] ? { ownerUserId: row.employee.memberships[0].userId } : {}),
      })
    ) {
      throw new ServiceRecordServiceError(
        'This Service Record is outside your permitted record scope.',
        403,
        'SERVICE_RECORD_READ_FORBIDDEN',
      );
    }
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (!hasPermission(context, permission, { agencyId: context.agencyId })) {
      throw new ServiceRecordServiceError(
        'You do not have permission to perform this Service Record operation.',
        403,
        code,
      );
    }
  }

  private employeeNotFound(): ServiceRecordServiceError {
    return new ServiceRecordServiceError(
      'The Employee was not found.',
      404,
      'SERVICE_RECORD_EMPLOYEE_NOT_FOUND',
    );
  }

  private notFound(): ServiceRecordServiceError {
    return new ServiceRecordServiceError(
      'The Service Record was not found.',
      404,
      'SERVICE_RECORD_NOT_FOUND',
    );
  }

  private writeAudit(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: {
      action: string;
      entityId: string;
      reason?: string;
      metadata: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    return this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action: input.action,
      entityType: 'ServiceRecordSnapshot',
      entityId: input.entityId,
      previousStatus: null,
      newStatus: 'ISSUED',
      reason: input.reason ?? null,
      requestId: context.requestId,
      metadata: input.metadata,
    });
  }
}
