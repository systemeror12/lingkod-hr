import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { ownEmployeeId, resolveEmployeeScope, scopeCovers } from '../employee-scope';
import {
  DocumentsService,
  DocumentsServiceError,
  type DocumentAccess,
  type DocumentClassification,
  type UploadedDocumentFile,
} from '../documents/documents.service';

export const PERSONNEL_DOCUMENT_CLASSIFICATIONS = [
  'PDS',
  'WES',
  'APPOINTMENT',
  'OATH_OF_OFFICE',
  'ASSUMPTION_TO_DUTY',
  'MEDICAL',
  'CLEARANCE',
  'ELIGIBILITY',
  'EDUCATION',
  'TRAINING',
  'LICENSE',
  'PERFORMANCE',
  'SALARY_ADJUSTMENT',
  'SEPARATION',
  'GOVERNMENT_IDENTIFIER',
  'BANK_ACCOUNT',
] as const;

export type PersonnelDocumentClassification = (typeof PERSONNEL_DOCUMENT_CLASSIFICATIONS)[number];

export const PERSONNEL_DOCUMENT_PURPOSES = [
  'PDS_SUPPORT',
  'WES_SUPPORT',
  'APPOINTMENT_SUPPORT',
  'PERSONNEL_ACTION_SUPPORT',
  'SERVICE_RECORD_SUPPORT',
  'PAYROLL_SUPPORT',
  'LEAVE_SUPPORT',
  'PERFORMANCE_SUPPORT',
  'COMPLIANCE_SUPPORT',
  'OWN_RECORD_UPLOAD',
] as const;

export type PersonnelDocumentPurpose = (typeof PERSONNEL_DOCUMENT_PURPOSES)[number];

export const PERSONNEL_DOCUMENT_RELEASE_STATES = ['PENDING', 'RELEASED', 'WITHHELD'] as const;
export type PersonnelDocumentReleaseState = (typeof PERSONNEL_DOCUMENT_RELEASE_STATES)[number];

export interface EmployeeDocumentLinkInput {
  documentId: string;
  documentVersionId: string;
  personnelClassification: PersonnelDocumentClassification;
  purpose: PersonnelDocumentPurpose;
  releaseState?: PersonnelDocumentReleaseState | undefined;
}

export interface EmployeeDocumentUploadInput {
  classification: DocumentClassification;
  personnelClassification: PersonnelDocumentClassification;
  purpose: PersonnelDocumentPurpose;
  file: UploadedDocumentFile;
  idempotencyKey: string;
}

export interface EmployeeDocumentSummary {
  id: string;
  employeeId: string;
  documentId: string;
  documentVersionId: string;
  documentNo: string | null;
  documentType: string;
  classification: DocumentClassification;
  status: string;
  personnelClassification: PersonnelDocumentClassification;
  purpose: PersonnelDocumentPurpose;
  releaseState: PersonnelDocumentReleaseState;
  versionNo: number;
  mimeType: string;
  sizeBytes: number;
  issuedAt: string | null;
  createdAt: string;
}

export interface EmployeeDocumentAccess extends EmployeeDocumentSummary {
  accessUrl: string;
  expiresAt: string;
}

export interface EmployeeDocumentAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const EMPLOYEE_DOCUMENT_AUDIT_WRITER = Symbol('EMPLOYEE_DOCUMENT_AUDIT_WRITER');

const AUDIT_METADATA_KEYS = new Set([
  'classification',
  'documentId',
  'documentVersionId',
  'employeeId',
  'personnelClassification',
  'purpose',
  'releaseState',
  'versionNo',
]);

function safeAuditMetadata(value: unknown): Prisma.InputJsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => AUDIT_METADATA_KEYS.has(key)),
  ) as Prisma.InputJsonObject;
}

export const employeeDocumentAuditWriter: EmployeeDocumentAuditWriter = {
  async write(transaction, event): Promise<void> {
    const { metadata, ...eventWithoutMetadata } = event;
    await transaction.auditEvent.create({
      data: { ...eventWithoutMetadata, metadata: safeAuditMetadata(metadata) },
    });
  },
};

export class EmployeeDocumentsServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'EmployeeDocumentsServiceError';
  }
}

const restrictedPersonnelClassifications = new Set<PersonnelDocumentClassification>([
  'MEDICAL',
  'GOVERNMENT_IDENTIFIER',
  'BANK_ACCOUNT',
]);

/** What the acting Agency Membership may do with one Employee's Personnel Documents. */
interface EmployeeAccess {
  /** The Employee is the one linked to the acting Agency Membership. */
  own: boolean;
  /** The `personnel.documents.read` Employee Scope covers the Employee. */
  read: boolean;
  /** The `personnel.documents.upload` Employee Scope covers the Employee. */
  upload: boolean;
  /** The `personnel.documents.read_sensitive` Employee Scope covers the Employee. */
  readSensitive: boolean;
}

const employeeDocumentSelect = {
  id: true,
  employeeId: true,
  documentId: true,
  documentVersionId: true,
  personnelClassification: true,
  purpose: true,
  releaseState: true,
  createdByMembershipId: true,
  createdAt: true,
  document: {
    select: {
      documentNo: true,
      documentType: true,
      classification: true,
      status: true,
    },
  },
  documentVersion: {
    select: { versionNo: true, mimeType: true, sizeBytes: true, issuedAt: true },
  },
} as const;

type EmployeeDocumentRecord = Prisma.EmployeeDocumentGetPayload<{
  select: typeof employeeDocumentSelect;
}>;
function databaseContext(context: RequestContext, transition = false) {
  return requestDatabaseContext(
    context,
    ...(transition ? (['employee-document-transition'] as const) : []),
  );
}

function formatDateTime(value: Date): string {
  return value.toISOString();
}

function isRestricted(
  personnelClassification: PersonnelDocumentClassification,
  classification: DocumentClassification,
): boolean {
  return (
    classification === 'HIGHLY_SENSITIVE' ||
    restrictedPersonnelClassifications.has(personnelClassification)
  );
}

function employeeDocumentSummary(record: EmployeeDocumentRecord): EmployeeDocumentSummary {
  return {
    id: record.id,
    employeeId: record.employeeId,
    documentId: record.documentId,
    documentVersionId: record.documentVersionId,
    documentNo: record.document.documentNo,
    documentType: record.document.documentType,
    classification: record.document.classification as DocumentClassification,
    status: record.document.status,
    personnelClassification: record.personnelClassification as PersonnelDocumentClassification,
    purpose: record.purpose as PersonnelDocumentPurpose,
    releaseState: record.releaseState as PersonnelDocumentReleaseState,
    versionNo: record.documentVersion.versionNo,
    mimeType: record.documentVersion.mimeType,
    sizeBytes: Number(record.documentVersion.sizeBytes),
    issuedAt: record.documentVersion.issuedAt
      ? formatDateTime(record.documentVersion.issuedAt)
      : null,
    createdAt: formatDateTime(record.createdAt),
  };
}

@Injectable()
export class EmployeeDocumentsService {
  constructor(
    @Inject(EMPLOYEE_DOCUMENT_AUDIT_WRITER)
    private readonly auditWriter: EmployeeDocumentAuditWriter,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
  ) {}

  async list(
    context: RequestContext,
    employeeId: string,
  ): Promise<EmployeeDocumentSummary[] | null> {
    this.assertAnyPermission(
      context,
      'personnel.documents.read',
      'EMPLOYEE_DOCUMENT_READ_FORBIDDEN',
    );
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const access = await this.employeeAccess(transaction, context, employeeId);
      if (!access) return null;
      this.assertRead(access);
      const records = await transaction.employeeDocument.findMany({
        where: { agencyId: context.agencyId, employeeId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: employeeDocumentSelect,
      });
      return records.flatMap((record) =>
        this.canExpose(context, access, record) ? [employeeDocumentSummary(record)] : [],
      );
    });
  }

  async link(
    context: RequestContext,
    employeeId: string,
    input: EmployeeDocumentLinkInput,
  ): Promise<EmployeeDocumentSummary> {
    this.assertContext(context);
    const agencyClassifier = this.hasAgencyPermission(context, 'personnel.documents.classify');
    if (!agencyClassifier && !this.hasAnyPermission(context, 'personnel.documents.upload')) {
      throw this.error(
        'The current Agency Membership cannot link Personnel Documents.',
        'EMPLOYEE_DOCUMENT_LINK_FORBIDDEN',
      );
    }
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      const access = await this.employeeAccess(transaction, context, employeeId);
      if (!access) throw this.employeeNotFound();
      const ownWorkflow = !agencyClassifier;
      if (ownWorkflow && (!access.own || !access.upload)) {
        throw this.error(
          'Only the Employee can link evidence through the own-record workflow.',
          'EMPLOYEE_DOCUMENT_LINK_FORBIDDEN',
        );
      }
      const evidenceResult = await this.documentsService.resolveExternalEvidenceInTransaction(
        transaction,
        context,
        {
          documentId: input.documentId,
          versionId: input.documentVersionId,
          allowSensitive:
            ownWorkflow || this.hasAgencyPermission(context, 'documents.evidence.read_sensitive'),
          requirement: ownWorkflow ? 'ANY_STATUS' : 'FINALIZED_VERSION',
        },
      );
      if (
        evidenceResult.ok === false &&
        (evidenceResult.reason === 'DOCUMENT_NOT_FOUND' ||
          evidenceResult.reason === 'VERSION_NOT_FOUND')
      ) {
        throw new EmployeeDocumentsServiceError(
          'The selected Document Version could not be found in this Agency.',
          404,
          'EMPLOYEE_DOCUMENT_SOURCE_NOT_FOUND',
        );
      }
      if (!ownWorkflow && !this.hasAgencyPermission(context, 'documents.evidence.read')) {
        throw this.error(
          'The current Agency Membership cannot inspect shared Agency Documents.',
          'EMPLOYEE_DOCUMENT_SOURCE_READ_FORBIDDEN',
        );
      }
      if (evidenceResult.ok === false && evidenceResult.reason === 'SENSITIVE_FORBIDDEN') {
        throw this.error(
          'The current Agency Membership cannot inspect highly sensitive shared Documents.',
          'EMPLOYEE_DOCUMENT_SOURCE_SENSITIVE_FORBIDDEN',
        );
      }
      if (evidenceResult.ok === false && evidenceResult.reason === 'STATUS_INELIGIBLE') {
        throw this.error(
          'Only an approved, issued, or otherwise finalized Document Version can be linked.',
          'EMPLOYEE_DOCUMENT_SOURCE_INELIGIBLE',
        );
      }
      if (!evidenceResult.ok) throw new Error('Unexpected External Evidence resolution result.');
      const document = evidenceResult.document;
      const restricted = isRestricted(input.personnelClassification, document.classification);
      if (ownWorkflow) {
        const ownVersion = await this.documentsService.isVersionCreatedByMembershipInTransaction(
          transaction,
          context,
          input.documentId,
          input.documentVersionId,
          context.membershipId,
        );
        if (!ownVersion) {
          throw this.error(
            'An Employee can link only evidence uploaded through the own-record workflow.',
            'EMPLOYEE_DOCUMENT_OWN_SOURCE_FORBIDDEN',
          );
        }
        if (input.releaseState && input.releaseState !== 'PENDING') {
          throw this.error(
            'Employee-uploaded evidence remains pending until an authorized release.',
            'EMPLOYEE_DOCUMENT_RELEASE_STATE_INVALID',
          );
        }
      }

      const releaseState =
        input.releaseState ?? (ownWorkflow ? 'PENDING' : restricted ? 'WITHHELD' : 'RELEASED');
      if (
        releaseState === 'RELEASED' &&
        restricted &&
        !this.hasSensitivePermission(context, access)
      ) {
        throw this.sensitiveForbidden();
      }
      try {
        const link = await transaction.employeeDocument.create({
          data: {
            agencyId: context.agencyId,
            employeeId,
            documentId: input.documentId,
            documentVersionId: input.documentVersionId,
            personnelClassification: input.personnelClassification,
            purpose: input.purpose,
            releaseState,
            createdByMembershipId: context.membershipId,
          },
          select: { id: true },
        });
        const record = await this.findRecord(transaction, context.agencyId, employeeId, link.id);
        if (!record) throw this.linkNotFound();
        const summary = employeeDocumentSummary(record);
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'EMPLOYEE_DOCUMENT_LINKED',
          entityType: 'EmployeeDocument',
          entityId: link.id,
          previousStatus: 'UNLINKED',
          newStatus: releaseState,
          requestId: context.requestId,
          occurredAt: new Date(),
          metadata: this.auditMetadata(summary),
        });
        return summary;
      } catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw this.duplicateLink();
        }
        throw error;
      }
    });
  }

  async upload(
    context: RequestContext,
    employeeId: string,
    input: EmployeeDocumentUploadInput,
  ): Promise<EmployeeDocumentSummary> {
    this.assertAnyPermission(
      context,
      'personnel.documents.upload',
      'EMPLOYEE_DOCUMENT_UPLOAD_FORBIDDEN',
    );
    await withDatabaseContext(databaseContext(context), async (transaction) => {
      const access = await this.employeeAccess(transaction, context, employeeId);
      if (!access || !access.own || !access.upload) {
        throw access
          ? this.error(
              'Only the Employee can upload through the own-record workflow.',
              'EMPLOYEE_DOCUMENT_UPLOAD_FORBIDDEN',
            )
          : this.employeeNotFound();
      }
    });
    const document = await this.documentsService.createForPersonnel(context, {
      documentNo: null,
      documentType: input.personnelClassification,
      classification: input.classification,
      file: input.file,
      idempotencyKey: input.idempotencyKey,
    });
    const documentVersionId = document.currentVersion?.id;
    if (!documentVersionId) throw this.linkNotFound();
    const existing = await withDatabaseContext(databaseContext(context), (transaction) =>
      this.findRecordByVersion(
        transaction,
        context.agencyId,
        employeeId,
        document.id,
        documentVersionId,
        input.personnelClassification,
        input.purpose,
      ),
    );
    if (existing) return employeeDocumentSummary(existing);
    return this.link(context, employeeId, {
      documentId: document.id,
      documentVersionId,
      personnelClassification: input.personnelClassification,
      purpose: input.purpose,
      releaseState: 'PENDING',
    });
  }

  async remove(
    context: RequestContext,
    employeeId: string,
    linkId: string,
    reason: string,
  ): Promise<{ removed: true }> {
    this.assertContext(context);
    const agencyClassifier = this.hasAgencyPermission(context, 'personnel.documents.classify');
    if (!agencyClassifier && !this.hasAnyPermission(context, 'personnel.documents.upload')) {
      throw this.error(
        'The current Agency Membership cannot remove Personnel Document links.',
        'EMPLOYEE_DOCUMENT_UNLINK_FORBIDDEN',
      );
    }
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw this.reasonRequired();
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      const access = await this.employeeAccess(transaction, context, employeeId);
      if (!access) throw this.employeeNotFound();
      const record = await this.findRecord(transaction, context.agencyId, employeeId, linkId);
      if (!record) throw this.linkNotFound();
      if (!agencyClassifier) {
        if (
          !access.own ||
          !access.upload ||
          record.createdByMembershipId !== context.membershipId
        ) {
          throw this.error(
            'Only the authorized uploader can remove this own-record link.',
            'EMPLOYEE_DOCUMENT_UNLINK_FORBIDDEN',
          );
        }
      }
      await transaction.employeeDocument.delete({
        where: { agencyId_id: { agencyId: context.agencyId, id: linkId } },
      });
      const summary = employeeDocumentSummary(record);
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'EMPLOYEE_DOCUMENT_UNLINKED',
        entityType: 'EmployeeDocument',
        entityId: linkId,
        previousStatus: summary.releaseState,
        newStatus: 'UNLINKED',
        reason: normalizedReason,
        requestId: context.requestId,
        occurredAt: new Date(),
        metadata: this.auditMetadata(summary),
      });
      return { removed: true as const };
    });
  }

  async access(
    context: RequestContext,
    employeeId: string,
    linkId: string,
  ): Promise<EmployeeDocumentAccess | null> {
    this.assertAnyPermission(
      context,
      'personnel.documents.read',
      'EMPLOYEE_DOCUMENT_READ_FORBIDDEN',
    );
    const value = await withDatabaseContext(databaseContext(context), async (transaction) => {
      const access = await this.employeeAccess(transaction, context, employeeId);
      if (!access) return null;
      this.assertRead(access);
      const record = await this.findRecord(transaction, context.agencyId, employeeId, linkId);
      if (!record || !this.canExpose(context, access, record)) return null;
      return {
        summary: employeeDocumentSummary(record),
        allowSensitive: this.hasSensitivePermission(context, access),
      };
    });
    if (!value) return null;
    let documentAccess: DocumentAccess | null;
    try {
      documentAccess = await this.documentsService.issueAccessLinkForPersonnel(
        context,
        value.summary.documentId,
        value.summary.documentVersionId,
        value.allowSensitive,
      );
    } catch (error: unknown) {
      if (
        error instanceof DocumentsServiceError &&
        error.code === 'DOCUMENT_SENSITIVE_READ_FORBIDDEN'
      ) {
        return null;
      }
      throw error;
    }
    if (!documentAccess) return null;
    return {
      ...value.summary,
      accessUrl: documentAccess.accessUrl,
      expiresAt: documentAccess.expiresAt,
    };
  }

  private async employeeAccess(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    employeeId: string,
  ): Promise<EmployeeAccess | null> {
    const employee = await transaction.employee.findUnique({
      where: { agencyId_id: { agencyId: context.agencyId, id: employeeId } },
      select: { id: true },
    });
    if (!employee) return null;
    const covers = async (permission: string) =>
      scopeCovers(await resolveEmployeeScope(transaction, context, permission), employeeId);
    return {
      own: (await ownEmployeeId(transaction, context)) === employeeId,
      read: await covers('personnel.documents.read'),
      upload: await covers('personnel.documents.upload'),
      readSensitive: await covers('personnel.documents.read_sensitive'),
    };
  }

  private async findRecord(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    linkId: string,
  ): Promise<EmployeeDocumentRecord | null> {
    return transaction.employeeDocument.findFirst({
      where: { id: linkId, agencyId, employeeId },
      select: employeeDocumentSelect,
    });
  }

  private async findRecordByVersion(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    documentId: string,
    documentVersionId: string,
    personnelClassification: PersonnelDocumentClassification,
    purpose: PersonnelDocumentPurpose,
  ): Promise<EmployeeDocumentRecord | null> {
    return transaction.employeeDocument.findFirst({
      where: {
        agencyId,
        employeeId,
        documentId,
        documentVersionId,
        personnelClassification,
        purpose,
      },
      select: employeeDocumentSelect,
    });
  }

  private canExpose(
    context: RequestContext,
    access: EmployeeAccess,
    record: EmployeeDocumentRecord,
  ): boolean {
    const classification = record.document.classification as DocumentClassification;
    const personnelClassification =
      record.personnelClassification as PersonnelDocumentClassification;
    if (record.personnelClassification === 'SALN') return false;
    if (record.document.status === 'VOIDED') return false;
    if (!access.read) return false;
    if (
      record.releaseState === 'WITHHELD' &&
      !this.hasAgencyPermission(context, 'personnel.documents.read')
    ) {
      return false;
    }
    if (
      record.releaseState !== 'RELEASED' &&
      !this.hasAgencyPermission(context, 'personnel.documents.read')
    ) {
      return false;
    }
    return (
      !isRestricted(personnelClassification, classification) ||
      this.hasSensitivePermission(context, access)
    );
  }

  private hasSensitivePermission(context: RequestContext, access: EmployeeAccess): boolean {
    return (
      access.own ||
      access.readSensitive ||
      this.hasAgencyPermission(context, 'documents.evidence.read_sensitive')
    );
  }

  private assertRead(access: EmployeeAccess): void {
    if (!access.read) {
      throw this.error(
        'The current Agency Membership lacks the required Personnel Document permission.',
        'EMPLOYEE_DOCUMENT_READ_FORBIDDEN',
      );
    }
  }

  private hasAgencyPermission(context: RequestContext, permission: string): boolean {
    return holdsAgencyWide(context, permission);
  }

  private hasAnyPermission(context: RequestContext, permission: string): boolean {
    return context.permissions.some((grant) => grant.code === permission);
  }

  private assertAnyPermission(context: RequestContext, permission: string, code: string): void {
    this.assertContext(context);
    if (!this.hasAnyPermission(context, permission)) {
      throw this.error(
        'The current Agency Membership lacks the required Personnel Document permission.',
        code,
      );
    }
  }

  private assertContext(context: RequestContext): void {
    if (!context.agencyId || !context.userId || !context.membershipId) {
      throw this.error(
        'The active Agency Context is required.',
        'EMPLOYEE_DOCUMENT_CONTEXT_INVALID',
      );
    }
  }

  private auditMetadata(summary: EmployeeDocumentSummary): Prisma.InputJsonObject {
    return {
      employeeId: summary.employeeId,
      documentId: summary.documentId,
      documentVersionId: summary.documentVersionId,
      classification: summary.classification,
      personnelClassification: summary.personnelClassification,
      purpose: summary.purpose,
      releaseState: summary.releaseState,
      versionNo: summary.versionNo,
    };
  }

  private error(message: string, code: string, statusCode = 403): EmployeeDocumentsServiceError {
    return new EmployeeDocumentsServiceError(message, statusCode, code);
  }

  private employeeNotFound(): EmployeeDocumentsServiceError {
    return this.error(
      'The Employee record could not be found in this Agency.',
      'EMPLOYEE_DOCUMENT_EMPLOYEE_NOT_FOUND',
      404,
    );
  }

  private linkNotFound(): EmployeeDocumentsServiceError {
    return this.error(
      'The Personnel Document link could not be found.',
      'EMPLOYEE_DOCUMENT_LINK_NOT_FOUND',
      404,
    );
  }

  private duplicateLink(): EmployeeDocumentsServiceError {
    return this.error(
      'That Document Version is already linked to this Employee for the selected purpose.',
      'EMPLOYEE_DOCUMENT_DUPLICATE',
      409,
    );
  }

  private sensitiveForbidden(): EmployeeDocumentsServiceError {
    return this.error(
      'The current Agency Membership cannot release restricted Personnel Documents.',
      'EMPLOYEE_DOCUMENT_SENSITIVE_FORBIDDEN',
    );
  }

  private reasonRequired(): EmployeeDocumentsServiceError {
    return this.error(
      'A reason is required when removing a Personnel Document link.',
      'EMPLOYEE_DOCUMENT_REMOVAL_REASON_REQUIRED',
      400,
    );
  }
}
