import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canAccessRecord, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import type { z } from 'zod';
import type {
  salnComplianceCorrectionSchema,
  salnComplianceCreateSchema,
} from './saln-compliance.schemas';

export type SalnComplianceInput = z.infer<typeof salnComplianceCreateSchema>;
export type SalnComplianceCorrectionInput = z.infer<typeof salnComplianceCorrectionSchema>;

export interface SalnComplianceOwnSummary {
  id: string;
  filingYear: number;
  filingType: string;
  status: string;
  submittedAt: string | null;
  createdAt: string;
}

export interface SalnComplianceSummary extends SalnComplianceOwnSummary {
  employeeId: string;
  requirementReference: string;
  repositoryReference: string | null;
  acknowledgmentDocumentId: string | null;
  acknowledgmentDocumentVersionId: string | null;
  correctsRecordId: string | null;
  correctionReason: string | null;
  actorDisplayName: string | null;
}

export class SalnComplianceServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'SalnComplianceServiceError';
  }
}

export interface SalnComplianceAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const SALN_COMPLIANCE_AUDIT_WRITER = Symbol('SALN_COMPLIANCE_AUDIT_WRITER');
const safeAuditKeys = new Set([
  'employeeId',
  'filingYear',
  'filingType',
  'status',
  'correctsRecordId',
]);

export const salnComplianceAuditWriter: SalnComplianceAuditWriter = {
  async write(transaction, event): Promise<void> {
    const { metadata, ...rest } = event;
    const safeMetadata =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? Object.fromEntries(Object.entries(metadata).filter(([key]) => safeAuditKeys.has(key)))
        : {};
    await transaction.auditEvent.create({
      data: { ...rest, metadata: safeMetadata as Prisma.InputJsonObject },
    });
  },
};

const recordSelect = {
  id: true,
  agencyId: true,
  employeeId: true,
  requirementReference: true,
  filingYear: true,
  filingType: true,
  status: true,
  submittedAt: true,
  repositoryReference: true,
  acknowledgmentDocumentId: true,
  acknowledgmentDocumentVersionId: true,
  correctsRecordId: true,
  correctionReason: true,
  createdAt: true,
  createdBy: { select: { user: { select: { displayName: true } } } },
  correctedByRecord: { select: { id: true } },
} as const;

const employeeSelect = {
  agencyId: true,
  memberships: { where: { status: 'ACTIVE' }, select: { userId: true } },
  currentServiceSegment: { select: { organizationUnitId: true } },
} as const;

type RecordRow = Prisma.SalnComplianceRecordGetPayload<{ select: typeof recordSelect }>;
type EmployeeRow = Prisma.EmployeeGetPayload<{ select: typeof employeeSelect }>;

function ownSummary(record: RecordRow): SalnComplianceOwnSummary {
  return {
    id: record.id,
    filingYear: record.filingYear,
    filingType: record.filingType,
    status: record.status,
    submittedAt: record.submittedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

function fullSummary(record: RecordRow): SalnComplianceSummary {
  return {
    ...ownSummary(record),
    employeeId: record.employeeId,
    requirementReference: record.requirementReference,
    repositoryReference: record.repositoryReference,
    acknowledgmentDocumentId: record.acknowledgmentDocumentId,
    acknowledgmentDocumentVersionId: record.acknowledgmentDocumentVersionId,
    correctsRecordId: record.correctsRecordId,
    correctionReason: record.correctionReason,
    actorDisplayName: record.createdBy.user.displayName,
  };
}

@Injectable()
export class SalnComplianceService {
  constructor(
    @Inject(SALN_COMPLIANCE_AUDIT_WRITER)
    private readonly auditWriter: SalnComplianceAuditWriter,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
  ) {}

  async findOwnEmployeeId(context: RequestContext): Promise<string | null> {
    this.assertPermission(context, 'personnel.saln_compliance.read');
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const employee = await transaction.employee.findFirst({
        where: {
          agencyId: context.agencyId,
          memberships: {
            some: { id: context.membershipId, userId: context.userId, status: 'ACTIVE' },
          },
        },
        select: { id: true },
      });
      return employee?.id ?? null;
    });
  }

  async list(
    context: RequestContext,
    employeeId: string,
  ): Promise<Array<SalnComplianceSummary | SalnComplianceOwnSummary> | null> {
    this.assertPermission(context, 'personnel.saln_compliance.read');
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const employee = await this.employee(transaction, context, employeeId);
      if (!employee || !this.canAccess(context, 'personnel.saln_compliance.read', employee))
        return null;
      const records = await transaction.salnComplianceRecord.findMany({
        where: { agencyId: context.agencyId, employeeId, correctedByRecord: null },
        orderBy: [{ filingYear: 'desc' }, { createdAt: 'desc' }],
        take: 100,
        select: recordSelect,
      });
      return records.map(this.hasAgencyRead(context) ? fullSummary : ownSummary);
    });
  }

  async findById(
    context: RequestContext,
    employeeId: string,
    recordId: string,
  ): Promise<SalnComplianceSummary | SalnComplianceOwnSummary | null> {
    this.assertPermission(context, 'personnel.saln_compliance.read');
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const employee = await this.employee(transaction, context, employeeId);
      if (!employee || !this.canAccess(context, 'personnel.saln_compliance.read', employee))
        return null;
      const record = await transaction.salnComplianceRecord.findFirst({
        where: { agencyId: context.agencyId, employeeId, id: recordId },
        select: recordSelect,
      });
      return record
        ? this.hasAgencyRead(context)
          ? fullSummary(record)
          : ownSummary(record)
        : null;
    });
  }

  async history(
    context: RequestContext,
    employeeId: string,
  ): Promise<SalnComplianceSummary[] | null> {
    this.assertPermission(context, 'personnel.saln_compliance.read');
    if (!this.hasAgencyRead(context)) return null;
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const employee = await this.employee(transaction, context, employeeId);
      if (!employee || !this.canAccess(context, 'personnel.saln_compliance.read', employee))
        return null;
      const records = await transaction.salnComplianceRecord.findMany({
        where: { agencyId: context.agencyId, employeeId },
        orderBy: [{ filingYear: 'desc' }, { createdAt: 'desc' }],
        take: 200,
        select: recordSelect,
      });
      return records.map(fullSummary);
    });
  }

  async create(
    context: RequestContext,
    employeeId: string,
    input: SalnComplianceInput,
  ): Promise<SalnComplianceSummary> {
    this.assertPermission(context, 'personnel.saln_compliance.update');
    return this.insert(context, employeeId, input, null, null);
  }

  async correct(
    context: RequestContext,
    employeeId: string,
    recordId: string,
    input: SalnComplianceCorrectionInput,
  ): Promise<SalnComplianceSummary> {
    this.assertPermission(context, 'personnel.saln_compliance.update');
    const { reason, ...metadata } = input;
    return this.insert(context, employeeId, metadata, recordId, reason.trim(), 'CORRECTED');
  }

  async update(
    context: RequestContext,
    employeeId: string,
    recordId: string,
    input: SalnComplianceInput,
  ): Promise<SalnComplianceSummary> {
    this.assertPermission(context, 'personnel.saln_compliance.update');
    return this.insert(context, employeeId, input, recordId, 'Filing metadata updated.', 'UPDATED');
  }

  private async insert(
    context: RequestContext,
    employeeId: string,
    input: SalnComplianceInput,
    correctsRecordId: string | null,
    correctionReason: string | null,
    transition: 'CORRECTED' | 'UPDATED' = 'CORRECTED',
  ): Promise<SalnComplianceSummary> {
    const submittedAt = input.submittedAt ? new Date(input.submittedAt) : null;
    return withDatabaseContext(
      requestDatabaseContext(context, 'saln-compliance-transition'),
      async (transaction) => {
        await this.lockEmployee(transaction, context.agencyId, employeeId);
        const employee = await this.employee(transaction, context, employeeId);
        const permission = 'personnel.saln_compliance.update';
        let previousStatus = 'NONE';
        if (!employee || !this.canAccess(context, permission, employee)) throw this.notFound();
        if (correctsRecordId) {
          const source = await transaction.salnComplianceRecord.findFirst({
            where: {
              agencyId: context.agencyId,
              employeeId,
              id: correctsRecordId,
              correctedByRecord: null,
            },
            select: { id: true, status: true },
          });
          if (!source) throw this.notFound();
          previousStatus = source.status;
        }
        await this.assertAcknowledgment(transaction, context, input);
        const created = await transaction.salnComplianceRecord.create({
          data: {
            agencyId: context.agencyId,
            employeeId,
            requirementReference: input.requirementReference.trim(),
            filingYear: input.filingYear,
            filingType: input.filingType.trim(),
            status: input.status,
            submittedAt,
            repositoryReference: input.repositoryReference?.trim() || null,
            acknowledgmentDocumentId: input.acknowledgmentDocumentId ?? null,
            acknowledgmentDocumentVersionId: input.acknowledgmentDocumentVersionId ?? null,
            correctsRecordId,
            correctionReason,
            createdByMembershipId: context.membershipId,
          },
          select: recordSelect,
        });
        const value = fullSummary(created);
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: correctsRecordId ? `SALN_COMPLIANCE_${transition}` : 'SALN_COMPLIANCE_RECORDED',
          entityType: 'SalnComplianceRecord',
          entityId: created.id,
          previousStatus,
          newStatus: input.status,
          reason: correctionReason,
          requestId: context.requestId,
          metadata: {
            employeeId,
            filingYear: input.filingYear,
            filingType: input.filingType,
            status: input.status,
            ...(correctsRecordId ? { correctsRecordId } : {}),
          },
        });
        return value;
      },
    );
  }

  private async assertAcknowledgment(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: SalnComplianceInput,
  ): Promise<void> {
    if (!input.acknowledgmentDocumentId || !input.acknowledgmentDocumentVersionId) return;
    const evidence = await this.documentsService.resolveExternalEvidenceInTransaction(
      transaction,
      context,
      {
        documentId: input.acknowledgmentDocumentId,
        versionId: input.acknowledgmentDocumentVersionId,
        allowSensitive: context.permissions.some(
          ({ code }) => code === 'documents.evidence.read_sensitive',
        ),
        requirement: 'FINALIZED_VERSION',
      },
    );
    if (evidence.ok) return;
    if (evidence.reason === 'STATUS_INELIGIBLE') {
      throw new SalnComplianceServiceError(
        'Only a finalized Document Version can be used as acknowledgment evidence.',
        400,
        'SALN_ACKNOWLEDGMENT_INELIGIBLE',
      );
    }
    throw this.notFound();
  }

  private employee(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    employeeId: string,
  ): Promise<EmployeeRow | null> {
    return transaction.employee.findUnique({
      where: { agencyId_id: { agencyId: context.agencyId, id: employeeId } },
      select: employeeSelect,
    });
  }

  private canAccess(context: RequestContext, permission: string, employee: EmployeeRow): boolean {
    return canAccessRecord(context, permission, {
      agencyId: employee.agencyId,
      ...(employee.memberships[0]?.userId ? { ownerUserId: employee.memberships[0].userId } : {}),
      ...(employee.currentServiceSegment
        ? { organizationUnitId: employee.currentServiceSegment.organizationUnitId }
        : {}),
    });
  }

  private hasAgencyRead(context: RequestContext): boolean {
    return context.permissions.some(
      ({ code, scopePolicy }) =>
        code === 'personnel.saln_compliance.read' && scopePolicy === 'AGENCY',
    );
  }

  private async lockEmployee(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "employees" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${employeeId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) throw this.notFound();
  }

  private assertPermission(context: RequestContext, permission: string): void {
    if (!context.permissions.some(({ code }) => code === permission)) {
      throw new SalnComplianceServiceError(
        'The current Agency Membership lacks the required SALN compliance permission.',
        403,
        'SALN_COMPLIANCE_FORBIDDEN',
      );
    }
  }

  private notFound(): SalnComplianceServiceError {
    return new SalnComplianceServiceError(
      'The SALN compliance record could not be found.',
      404,
      'SALN_COMPLIANCE_NOT_FOUND',
    );
  }
}
