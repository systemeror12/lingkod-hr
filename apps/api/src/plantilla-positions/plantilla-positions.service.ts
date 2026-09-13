import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import {
  DocumentsService,
  LINKABLE_EXTERNAL_EVIDENCE_STATUSES,
  type DocumentClassification,
} from '../documents/documents.service';

export const PLANTILLA_POSITION_VERSION_STATES = [
  'DRAFT',
  'ACTIVE',
  'SUPERSEDED',
  'VOIDED',
] as const;
export const PLANTILLA_POSITION_LIFECYCLE_STATUSES = [
  'PROPOSED',
  'AUTHORIZED',
  'VACANT',
  'RESERVED',
  'OCCUPIED',
  'FROZEN',
  'ABOLISHED',
] as const;
export const PLANTILLA_POSITION_EMPLOYMENT_CATEGORIES = [
  'PLANTILLA',
  'CASUAL',
  'CONTRACTUAL',
  'OTHER',
] as const;
export const PLANTILLA_POSITION_EVIDENCE_PURPOSES = [
  'POSITION_DESCRIPTION',
  'CREATION',
  'RECLASSIFICATION',
  'TRANSFER',
  'FREEZE',
  'ABOLITION',
  'OTHER',
] as const;

export type PlantillaPositionVersionState = (typeof PLANTILLA_POSITION_VERSION_STATES)[number];
export type PlantillaPositionLifecycleStatus =
  (typeof PLANTILLA_POSITION_LIFECYCLE_STATUSES)[number];
export type PlantillaPositionEmploymentCategory =
  (typeof PLANTILLA_POSITION_EMPLOYMENT_CATEGORIES)[number];
export type PlantillaPositionEvidencePurpose =
  (typeof PLANTILLA_POSITION_EVIDENCE_PURPOSES)[number];

export interface PlantillaPositionInput {
  title: string;
  parentheticalTitle?: string | null | undefined;
  salaryGrade: number;
  organizationUnitId: string;
  fundingSource: string;
  employmentCategory: PlantillaPositionEmploymentCategory;
  qualificationStandardVersionId: string;
  staffingAuthorityId: string;
  effectiveDate: string;
}

export interface CreatePlantillaPositionInput extends PlantillaPositionInput {
  itemNumber: string;
}

export interface UpdatePlantillaPositionDraftInput extends PlantillaPositionInput {
  rowVersion?: number | undefined;
}

export interface PlantillaPositionCorrectionInput extends Omit<
  PlantillaPositionInput,
  'effectiveDate'
> {
  reason: string;
}

export interface PlantillaPositionTransitionInput {
  effectiveDate: string;
  reason: string;
}

export interface PlantillaPositionVersionSummary {
  id: string;
  positionId: string;
  versionNo: number;
  title: string;
  parentheticalTitle: string | null;
  salaryGrade: number;
  organizationUnit: { id: string; code: string; name: string };
  fundingSource: string;
  employmentCategory: PlantillaPositionEmploymentCategory;
  qualificationStandard: {
    id: string;
    versionNo: number;
    code: string;
    name: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  };
  staffingAuthority: {
    id: string;
    referenceNo: string;
    authorityType: string;
    effectiveDate: string;
  };
  effectiveFrom: string;
  effectiveTo: string | null;
  versionState: PlantillaPositionVersionState;
  lifecycleStatus: PlantillaPositionLifecycleStatus;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlantillaPositionSummary {
  id: string;
  itemNumber: string;
  status: PlantillaPositionLifecycleStatus;
  currentVersion: PlantillaPositionVersionSummary | null;
  draft: PlantillaPositionVersionSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlantillaPositionHistoryEntry {
  id: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  effectiveDate: string | null;
  occurredAt: string;
}

export interface PlantillaPositionEvidence {
  id: string;
  positionId: string;
  documentId: string;
  documentNo: string | null;
  documentType: string;
  classification: DocumentClassification;
  status: string;
  purpose: PlantillaPositionEvidencePurpose;
  versionNo: number;
  mimeType: string;
  sizeBytes: number;
  effectiveFrom: string | null;
  createdAt: string;
}

export interface PlantillaPositionEvidenceLinkInput {
  documentId: string;
  purpose: PlantillaPositionEvidencePurpose;
  effectiveDate?: string | null | undefined;
}

export interface PlantillaPositionEvidenceAccess extends PlantillaPositionEvidence {
  accessUrl: string;
  expiresAt: string;
}

export interface PlantillaPositionDetail {
  position: PlantillaPositionSummary;
  asOf: string;
  effective: PlantillaPositionVersionSummary | null;
  versions: PlantillaPositionVersionSummary[];
  history: PlantillaPositionHistoryEntry[];
  evidence: PlantillaPositionEvidence[];
}

export interface PlantillaPositionSuccessor {
  current: PlantillaPositionVersionSummary;
  draft: PlantillaPositionVersionSummary;
}

export interface ReservedAssignmentFacts {
  organizationUnitId: string;
  salaryGrade: number;
}

export interface CompleteReservedAssignmentInput {
  employeeId: string;
  serviceSegmentId: string;
  appointmentId: string;
  appointmentVersionId: string;
  effectiveDate: string;
  expectedOrganizationUnitId: string;
  expectedSalaryGrade: number;
  reason: string;
}

export interface CompletedAssignment {
  versionId: string;
  positionIncumbencyId: string;
}

export type RecruitableVacancyRejectionReason =
  | 'POSITION_NOT_VACANT'
  | 'POSITION_NOT_AUTHORIZED'
  | 'POSITION_NOT_PLANTILLA'
  | 'POSITION_FROZEN'
  | 'POSITION_ABOLISHED'
  | 'POSITION_VERSION_MISSING'
  | 'POSITION_AUTHORITY_INVALID'
  | 'POSITION_QUALIFICATION_INVALID';

export type RecruitableVacancyResolution =
  | {
      eligible: true;
      positionId: string;
      itemNumber: string;
      positionVersionId: string;
      positionVersionNo: number;
      title: string;
      parentheticalTitle: string | null;
      salaryGrade: number;
      organizationUnitId: string;
      organizationUnitCode: string;
      organizationUnitName: string;
      qualificationStandardVersionId: string;
      staffingAuthorityId: string;
      effectiveFrom: string;
      employmentCategory: PlantillaPositionEmploymentCategory;
    }
  | {
      eligible: false;
      positionId: string;
      reason: RecruitableVacancyRejectionReason;
    };

export interface PlantillaPositionAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const PLANTILLA_POSITION_AUDIT_WRITER = Symbol('PLANTILLA_POSITION_AUDIT_WRITER');

export const plantillaPositionAuditWriter: PlantillaPositionAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};

export class PlantillaPositionServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PlantillaPositionServiceError';
  }
}

const versionSelect = {
  id: true,
  agencyId: true,
  positionId: true,
  versionNo: true,
  positionTitle: true,
  parentheticalTitle: true,
  salaryGrade: true,
  fundingSource: true,
  employmentCategory: true,
  effectiveFrom: true,
  effectiveTo: true,
  status: true,
  domainStatus: true,
  rowVersion: true,
  createdAt: true,
  updatedAt: true,
  organizationUnit: {
    select: {
      id: true,
      code: true,
      currentVersion: { select: { name: true, status: true, domainStatus: true } },
      status: true,
    },
  },
  qualificationStandardVersion: {
    select: {
      id: true,
      versionNo: true,
      effectiveFrom: true,
      effectiveTo: true,
      status: true,
      domainStatus: true,
      qualificationStandard: { select: { code: true, name: true, status: true } },
    },
  },
  staffingAuthority: {
    select: {
      id: true,
      referenceNo: true,
      authorityType: true,
      effectiveDate: true,
      status: true,
      supersededEffectiveDate: true,
      revokedEffectiveDate: true,
    },
  },
} as const;

const positionVersionStates = ['DRAFT', 'ACTIVE', 'SUPERSEDED', 'VOIDED'];
const PLANTILLA_POSITION_LIST_LIMIT = 200;
const PLANTILLA_POSITION_EVIDENCE_LIST_LIMIT = 200;
const positionVersionOrderBy: Prisma.PlantillaPositionVersionOrderByWithRelationInput[] = [
  { effectiveFrom: 'desc' },
  { versionNo: 'desc' },
];

const positionSelect = {
  id: true,
  agencyId: true,
  itemNumber: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  versions: {
    where: { status: { in: positionVersionStates } },
    orderBy: positionVersionOrderBy,
    select: versionSelect,
  },
} as const;

const positionEvidenceSelect = {
  id: true,
  positionId: true,
  documentId: true,
  documentType: true,
  effectiveFrom: true,
  createdAt: true,
  document: {
    select: {
      id: true,
      documentNo: true,
      documentType: true,
      classification: true,
      status: true,
      currentVersion: {
        select: {
          versionNo: true,
          mimeType: true,
          sizeBytes: true,
        },
      },
    },
  },
} as const;

type PositionRecord = Prisma.PlantillaPositionGetPayload<{ select: typeof positionSelect }>;
type VersionRecord = Prisma.PlantillaPositionVersionGetPayload<{ select: typeof versionSelect }>;
type PositionEvidenceRecord = Prisma.PositionDocumentGetPayload<{
  select: typeof positionEvidenceSelect;
}>;

function databaseContext(context: RequestContext, transition = false) {
  return requestDatabaseContext(
    context,
    ...(transition ? (['plantilla-position-transition'] as const) : []),
  );
}

function evidenceDatabaseContext(context: RequestContext) {
  return requestDatabaseContext(context, 'plantilla-position-evidence-transition');
}

function toDatabaseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw dateInvalid();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw dateInvalid();
  }
  return date;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatDateTime(value: Date): string {
  return value.toISOString();
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function manilaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function normalizeInput(input: PlantillaPositionInput): PlantillaPositionInput {
  return {
    ...input,
    title: input.title.trim(),
    parentheticalTitle: input.parentheticalTitle?.trim() || null,
    fundingSource: input.fundingSource.trim(),
  };
}

function inputDate(input: PlantillaPositionInput): Date {
  return toDatabaseDate(input.effectiveDate);
}

function versionSummary(record: VersionRecord): PlantillaPositionVersionSummary {
  return {
    id: record.id,
    positionId: record.positionId,
    versionNo: record.versionNo,
    title: record.positionTitle,
    parentheticalTitle: record.parentheticalTitle,
    salaryGrade: record.salaryGrade,
    organizationUnit: {
      id: record.organizationUnit.id,
      code: record.organizationUnit.code,
      name: record.organizationUnit.currentVersion?.name ?? record.organizationUnit.code,
    },
    fundingSource: record.fundingSource,
    employmentCategory: record.employmentCategory as PlantillaPositionEmploymentCategory,
    qualificationStandard: {
      id: record.qualificationStandardVersion.id,
      versionNo: record.qualificationStandardVersion.versionNo,
      code: record.qualificationStandardVersion.qualificationStandard.code,
      name: record.qualificationStandardVersion.qualificationStandard.name,
      effectiveFrom: formatDate(record.qualificationStandardVersion.effectiveFrom),
      effectiveTo: record.qualificationStandardVersion.effectiveTo
        ? formatDate(record.qualificationStandardVersion.effectiveTo)
        : null,
    },
    staffingAuthority: {
      id: record.staffingAuthority.id,
      referenceNo: record.staffingAuthority.referenceNo,
      authorityType: record.staffingAuthority.authorityType,
      effectiveDate: formatDate(record.staffingAuthority.effectiveDate),
    },
    effectiveFrom: formatDate(record.effectiveFrom),
    effectiveTo: record.effectiveTo ? formatDate(record.effectiveTo) : null,
    versionState: record.status as PlantillaPositionVersionState,
    lifecycleStatus: record.domainStatus as PlantillaPositionLifecycleStatus,
    rowVersion: record.rowVersion,
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt),
  };
}

function effectiveVersion(versions: readonly VersionRecord[], asOf: Date): VersionRecord | null {
  return (
    versions.find(
      (version) =>
        (version.status === 'ACTIVE' || version.status === 'SUPERSEDED') &&
        version.effectiveFrom <= asOf &&
        (version.effectiveTo === null || version.effectiveTo >= asOf),
    ) ?? null
  );
}

function draftVersion(versions: readonly VersionRecord[]): VersionRecord | null {
  return versions.find((version) => version.status === 'DRAFT') ?? null;
}

function positionSummary(record: PositionRecord, asOf: Date): PlantillaPositionSummary {
  const current = effectiveVersion(record.versions, asOf);
  const draft = draftVersion(record.versions);
  return {
    id: record.id,
    itemNumber: record.itemNumber,
    status: (current?.domainStatus ?? record.status) as PlantillaPositionLifecycleStatus,
    currentVersion: current ? versionSummary(current) : null,
    draft: draft ? versionSummary(draft) : null,
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt),
  };
}

function evidenceSummary(record: PositionEvidenceRecord): PlantillaPositionEvidence | null {
  const version = record.document.currentVersion;
  if (!version) return null;
  return {
    id: record.id,
    positionId: record.positionId,
    documentId: record.documentId,
    documentNo: record.document.documentNo,
    documentType: record.document.documentType,
    classification: record.document.classification as DocumentClassification,
    status: record.document.status,
    purpose: record.documentType as PlantillaPositionEvidencePurpose,
    versionNo: version.versionNo,
    mimeType: version.mimeType,
    sizeBytes: Number(version.sizeBytes),
    effectiveFrom: record.effectiveFrom ? formatDate(record.effectiveFrom) : null,
    createdAt: formatDateTime(record.createdAt),
  };
}

function evidenceAuditMetadata(record: PositionEvidenceRecord): Prisma.InputJsonObject {
  return {
    evidenceId: record.id,
    documentId: record.documentId,
    evidencePurpose: record.documentType,
    documentType: record.document.documentType,
    classification: record.document.classification,
    effectiveDate: record.effectiveFrom ? formatDate(record.effectiveFrom) : null,
    versionNo: record.document.currentVersion?.versionNo ?? null,
  };
}

function auditVersionData(value: PlantillaPositionVersionSummary): Prisma.InputJsonObject {
  return {
    id: value.id,
    versionNo: value.versionNo,
    title: value.title,
    parentheticalTitle: value.parentheticalTitle,
    salaryGrade: value.salaryGrade,
    organizationUnitId: value.organizationUnit.id,
    fundingSource: value.fundingSource,
    employmentCategory: value.employmentCategory,
    qualificationStandardVersionId: value.qualificationStandard.id,
    staffingAuthorityId: value.staffingAuthority.id,
    effectiveFrom: value.effectiveFrom,
    effectiveTo: value.effectiveTo,
    versionState: value.versionState,
    lifecycleStatus: value.lifecycleStatus,
  };
}

function dateInvalid(): PlantillaPositionServiceError {
  return new PlantillaPositionServiceError(
    'The Plantilla Position effective date is invalid.',
    400,
    'PLANTILLA_POSITION_DATE_INVALID',
  );
}

function normalizeIdempotencyKey(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

@Injectable()
export class PlantillaPositionsService {
  constructor(
    @Inject(PLANTILLA_POSITION_AUDIT_WRITER)
    private readonly auditWriter: PlantillaPositionAuditWriter,
    @Inject(DocumentsService)
    private readonly documentsService: DocumentsService,
  ) {}

  async list(
    context: RequestContext,
    asOfValue = manilaToday(),
  ): Promise<PlantillaPositionSummary[]> {
    this.assertPermission(context, 'positions.items.read', 'PLANTILLA_POSITION_READ_FORBIDDEN');
    const asOf = toDatabaseDate(asOfValue);
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const records = await transaction.plantillaPosition.findMany({
        where: { agencyId: context.agencyId },
        orderBy: { itemNumber: 'asc' },
        take: PLANTILLA_POSITION_LIST_LIMIT,
        select: positionSelect,
      });
      return records.map((record) => positionSummary(record, asOf));
    });
  }

  /** Internal contract: Recruitment may open a case only from this resolved vacancy. */
  async resolveRecruitableVacancy(
    context: RequestContext,
    positionId: string,
    asOfValue = manilaToday(),
  ): Promise<RecruitableVacancyResolution | null> {
    this.assertPermission(context, 'positions.items.read', 'PLANTILLA_POSITION_READ_FORBIDDEN');
    return withDatabaseContext(databaseContext(context), (transaction) =>
      this.resolveRecruitableVacancyInTransaction(transaction, context, positionId, asOfValue),
    );
  }

  /** Internal contract: an owning workflow may revalidate the same vacancy inside its transaction. */
  async resolveRecruitableVacancyInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    positionId: string,
    asOfValue = manilaToday(),
  ): Promise<RecruitableVacancyResolution | null> {
    const asOf = toDatabaseDate(asOfValue);
    const locked = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "plantilla_positions" WHERE "agency_id" = CAST(${context.agencyId} AS uuid) AND "id" = CAST(${positionId} AS uuid) FOR UPDATE`,
    );
    if (locked.length !== 1) return null;
    const record = await transaction.plantillaPosition.findFirst({
      where: { agencyId: context.agencyId, id: positionId },
      select: positionSelect,
    });
    if (!record) return null;

    const current = effectiveVersion(record.versions, asOf);
    if (!current) return { eligible: false, positionId, reason: 'POSITION_VERSION_MISSING' };
    if (record.status === 'FROZEN' || current.domainStatus === 'FROZEN') {
      return { eligible: false, positionId, reason: 'POSITION_FROZEN' };
    }
    if (record.status === 'ABOLISHED' || current.domainStatus === 'ABOLISHED') {
      return { eligible: false, positionId, reason: 'POSITION_ABOLISHED' };
    }
    if (record.status !== 'VACANT' || current.domainStatus !== 'VACANT') {
      return { eligible: false, positionId, reason: 'POSITION_NOT_VACANT' };
    }
    if (current.employmentCategory !== 'PLANTILLA') {
      return { eligible: false, positionId, reason: 'POSITION_NOT_PLANTILLA' };
    }
    if (
      current.organizationUnit.status !== 'ACTIVE' ||
      current.organizationUnit.currentVersion?.status !== 'ACTIVE' ||
      current.organizationUnit.currentVersion.domainStatus !== 'ACTIVE'
    ) {
      return { eligible: false, positionId, reason: 'POSITION_NOT_AUTHORIZED' };
    }
    if (
      current.staffingAuthority.status !== 'ACTIVE' ||
      current.staffingAuthority.effectiveDate > asOf ||
      (current.staffingAuthority.supersededEffectiveDate !== null &&
        current.staffingAuthority.supersededEffectiveDate <= asOf) ||
      (current.staffingAuthority.revokedEffectiveDate !== null &&
        current.staffingAuthority.revokedEffectiveDate <= asOf)
    ) {
      return { eligible: false, positionId, reason: 'POSITION_AUTHORITY_INVALID' };
    }
    if (
      current.qualificationStandardVersion.status !== 'ACTIVE' ||
      current.qualificationStandardVersion.domainStatus !== 'ACTIVE' ||
      current.qualificationStandardVersion.qualificationStandard.status !== 'ACTIVE'
    ) {
      return { eligible: false, positionId, reason: 'POSITION_QUALIFICATION_INVALID' };
    }
    return {
      eligible: true,
      positionId: record.id,
      itemNumber: record.itemNumber,
      positionVersionId: current.id,
      positionVersionNo: current.versionNo,
      title: current.positionTitle,
      parentheticalTitle: current.parentheticalTitle,
      salaryGrade: current.salaryGrade,
      organizationUnitId: current.organizationUnit.id,
      organizationUnitCode: current.organizationUnit.code,
      organizationUnitName:
        current.organizationUnit.currentVersion?.name ?? current.organizationUnit.code,
      qualificationStandardVersionId: current.qualificationStandardVersion.id,
      staffingAuthorityId: current.staffingAuthority.id,
      effectiveFrom: formatDate(current.effectiveFrom),
      employmentCategory: current.employmentCategory as PlantillaPositionEmploymentCategory,
    };
  }

  async findById(
    context: RequestContext,
    positionId: string,
    asOfValue = manilaToday(),
  ): Promise<PlantillaPositionDetail | null> {
    this.assertPermission(context, 'positions.items.read', 'PLANTILLA_POSITION_READ_FORBIDDEN');
    this.assertPermission(
      context,
      'positions.history.read',
      'PLANTILLA_POSITION_HISTORY_READ_FORBIDDEN',
    );
    const asOf = toDatabaseDate(asOfValue);
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const canReadEvidence = hasPermission(context, 'documents.evidence.read', {
        agencyId: context.agencyId,
      });
      const record = await transaction.plantillaPosition.findFirst({
        where: { id: positionId, agencyId: context.agencyId },
        select: positionSelect,
      });
      if (!record) return null;
      const events = await transaction.auditEvent.findMany({
        where: {
          agencyId: context.agencyId,
          entityType: 'PlantillaPosition',
          entityId: positionId,
          action: { startsWith: 'PLANTILLA_POSITION_' },
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
      const summary = positionSummary(record, asOf);
      return {
        position: summary,
        asOf: asOfValue,
        effective: summary.currentVersion,
        versions: record.versions.map(versionSummary),
        evidence: canReadEvidence
          ? await this.positionEvidenceRecords(transaction, context, positionId)
          : [],
        history: events
          .filter(
            (event) => canReadEvidence || !event.action.startsWith('PLANTILLA_POSITION_EVIDENCE_'),
          )
          .map((event) => ({
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

  async listEvidence(
    context: RequestContext,
    positionId: string,
  ): Promise<PlantillaPositionEvidence[] | null> {
    this.assertPermission(context, 'positions.items.read', 'PLANTILLA_POSITION_READ_FORBIDDEN');
    this.assertEvidenceReadPermission(context);
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const position = await transaction.plantillaPosition.findFirst({
        where: { id: positionId, agencyId: context.agencyId },
        select: { id: true },
      });
      if (!position) return null;
      return this.positionEvidenceRecords(transaction, context, positionId);
    });
  }

  async linkEvidence(
    context: RequestContext,
    positionId: string,
    input: PlantillaPositionEvidenceLinkInput,
  ): Promise<PlantillaPositionEvidence> {
    this.assertPermission(context, 'positions.items.update', 'PLANTILLA_POSITION_UPDATE_FORBIDDEN');
    this.assertEvidenceReadPermission(context);
    if (!PLANTILLA_POSITION_EVIDENCE_PURPOSES.includes(input.purpose)) {
      throw this.evidencePurposeInvalid();
    }
    const effectiveFrom = input.effectiveDate ? this.evidenceDate(input.effectiveDate) : null;
    try {
      return await withDatabaseContext(evidenceDatabaseContext(context), async (transaction) => {
        await this.lockPosition(transaction, context.agencyId, positionId);
        const evidenceResult = await this.documentsService.resolveExternalEvidenceInTransaction(
          transaction,
          context,
          {
            documentId: input.documentId,
            allowSensitive: hasPermission(context, 'documents.evidence.read_sensitive', {
              agencyId: context.agencyId,
            }),
            requirement: 'LINKABLE_STATUS',
          },
        );
        if (evidenceResult.ok === false && evidenceResult.reason === 'DOCUMENT_NOT_FOUND') {
          throw this.evidenceDocumentNotFound();
        }
        if (evidenceResult.ok === false && evidenceResult.reason === 'SENSITIVE_FORBIDDEN') {
          throw this.evidenceSensitiveForbidden();
        }
        if (!evidenceResult.ok) throw this.evidenceDocumentIneligible();
        const link = await transaction.positionDocument.create({
          data: {
            agencyId: context.agencyId,
            positionId,
            documentId: input.documentId,
            documentType: input.purpose,
            effectiveFrom,
          },
          select: { id: true },
        });
        const record = await this.positionEvidenceRecord(
          transaction,
          context.agencyId,
          positionId,
          link.id,
        );
        if (!record) throw this.evidenceNotFound();
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'PLANTILLA_POSITION_EVIDENCE_LINKED',
          entityType: 'PlantillaPosition',
          entityId: positionId,
          previousStatus: 'UNLINKED',
          newStatus: 'LINKED',
          requestId: context.requestId,
          occurredAt: new Date(),
          metadata: evidenceAuditMetadata(record),
        });
        const summary = evidenceSummary(record);
        if (!summary) throw this.evidenceDocumentUnavailable();
        return summary;
      });
    } catch (error: unknown) {
      if (this.isKnownPrismaError(error, 'P2002')) throw this.evidenceDuplicate();
      throw error;
    }
  }

  async removeEvidence(
    context: RequestContext,
    positionId: string,
    evidenceId: string,
    reason: string,
  ): Promise<{ removed: true }> {
    this.assertPermission(context, 'positions.items.update', 'PLANTILLA_POSITION_UPDATE_FORBIDDEN');
    this.assertEvidenceReadPermission(context);
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw this.evidenceRemovalReasonRequired();
    return withDatabaseContext(evidenceDatabaseContext(context), async (transaction) => {
      await this.lockPosition(transaction, context.agencyId, positionId);
      const record = await transaction.positionDocument.findFirst({
        where: { id: evidenceId, agencyId: context.agencyId, positionId },
        select: positionEvidenceSelect,
      });
      if (!record) throw this.evidenceNotFound();
      await transaction.positionDocument.delete({
        where: { agencyId_id: { agencyId: context.agencyId, id: evidenceId } },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'PLANTILLA_POSITION_EVIDENCE_REMOVED',
        entityType: 'PlantillaPosition',
        entityId: positionId,
        previousStatus: 'LINKED',
        newStatus: 'UNLINKED',
        reason: normalizedReason,
        requestId: context.requestId,
        occurredAt: new Date(),
        metadata: evidenceAuditMetadata(record),
      });
      return { removed: true as const };
    });
  }

  async accessEvidence(
    context: RequestContext,
    positionId: string,
    evidenceId: string,
  ): Promise<PlantillaPositionEvidenceAccess | null> {
    this.assertPermission(context, 'positions.items.read', 'PLANTILLA_POSITION_READ_FORBIDDEN');
    this.assertEvidenceReadPermission(context);
    const record = await withDatabaseContext(databaseContext(context), (transaction) =>
      transaction.positionDocument.findFirst({
        where: { id: evidenceId, agencyId: context.agencyId, positionId },
        select: positionEvidenceSelect,
      }),
    );
    if (!record) return null;
    const summary = evidenceSummary(record);
    if (!summary) throw this.evidenceDocumentUnavailable();
    const access = await this.documentsService.issueAccessLink(context, record.documentId);
    if (!access) throw this.evidenceDocumentUnavailable();
    return { ...summary, accessUrl: access.accessUrl, expiresAt: access.expiresAt };
  }

  async create(
    context: RequestContext,
    rawInput: CreatePlantillaPositionInput,
  ): Promise<PlantillaPositionSummary> {
    this.assertPermission(context, 'positions.items.create', 'PLANTILLA_POSITION_CREATE_FORBIDDEN');
    const itemNumber = rawInput.itemNumber.trim();
    const input = normalizeInput(rawInput);
    const effectiveFrom = inputDate(input);
    try {
      return await withDatabaseContext(databaseContext(context, true), async (transaction) => {
        await this.validateReferences(transaction, context, input, effectiveFrom);
        const position = await transaction.plantillaPosition.create({
          data: {
            agencyId: context.agencyId,
            itemNumber,
            status: 'PROPOSED',
            createdFromAuthorityId: input.staffingAuthorityId,
            createdByMembershipId: context.membershipId,
            updatedByMembershipId: context.membershipId,
          },
        });
        const version = await transaction.plantillaPositionVersion.create({
          data: this.versionData(context, position.id, input, effectiveFrom, {
            versionNo: 1,
            status: 'ACTIVE',
            domainStatus: 'PROPOSED',
          }),
          select: { id: true },
        });
        const result = await this.positionRecord(transaction, context.agencyId, position.id);
        if (!result) throw this.notFound();
        const current = effectiveVersion(result.versions, toDatabaseDate(manilaToday()));
        await transaction.plantillaPosition.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: position.id } },
          data: {
            currentVersionId: current?.id ?? null,
            status: current?.domainStatus ?? 'PROPOSED',
          },
        });
        const summary = positionSummary(result, toDatabaseDate(manilaToday()));
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'PLANTILLA_POSITION_CREATED',
          entityType: 'PlantillaPosition',
          entityId: position.id,
          previousStatus: 'None',
          newStatus: 'PROPOSED',
          requestId: context.requestId,
          occurredAt: new Date(),
          metadata: {
            itemNumber,
            versionId: version.id,
            effectiveDate: input.effectiveDate,
          },
        });
        return summary;
      });
    } catch (error: unknown) {
      if (this.isKnownPrismaError(error, 'P2002')) throw this.itemNumberConflict();
      throw error;
    }
  }

  async createSuccessor(
    context: RequestContext,
    positionId: string,
  ): Promise<PlantillaPositionSuccessor> {
    this.assertPermission(context, 'positions.items.update', 'PLANTILLA_POSITION_UPDATE_FORBIDDEN');
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockPosition(transaction, context.agencyId, positionId);
      const record = await this.positionRecord(transaction, context.agencyId, positionId);
      if (!record) throw this.notFound();
      const current = effectiveVersion(record.versions, toDatabaseDate(manilaToday()));
      if (!current || current.status === 'DRAFT') throw this.successorNotAllowed();
      const existingDraft = draftVersion(record.versions);
      if (existingDraft) {
        return { current: versionSummary(current), draft: versionSummary(existingDraft) };
      }
      const effectiveFrom = new Date(
        Math.max(
          addDays(current.effectiveFrom, 1).getTime(),
          addDays(toDatabaseDate(manilaToday()), 1).getTime(),
        ),
      );
      const input = this.inputFromVersion(current, effectiveFrom);
      await this.validateReferences(transaction, context, input, effectiveFrom);
      const latestVersion = record.versions.reduce(
        (latest, version) => Math.max(latest, version.versionNo),
        current.versionNo,
      );
      const draft = await transaction.plantillaPositionVersion.create({
        data: this.versionData(context, positionId, input, effectiveFrom, {
          versionNo: latestVersion + 1,
          status: 'DRAFT',
          domainStatus: current.domainStatus as PlantillaPositionLifecycleStatus,
        }),
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'PLANTILLA_POSITION_SUCCESSOR_CREATED',
        entityType: 'PlantillaPosition',
        entityId: positionId,
        previousStatus: current.status,
        newStatus: 'DRAFT',
        requestId: context.requestId,
        occurredAt: new Date(),
        metadata: {
          predecessorId: current.id,
          versionId: draft.id,
          effectiveDate: formatDate(effectiveFrom),
        },
      });
      return {
        current: versionSummary(current),
        draft: versionSummary(await this.versionRecord(transaction, draft.id)),
      };
    });
  }

  async updateDraft(
    context: RequestContext,
    positionId: string,
    draftId: string,
    rawInput: UpdatePlantillaPositionDraftInput,
  ): Promise<PlantillaPositionVersionSummary> {
    this.assertPermission(context, 'positions.items.update', 'PLANTILLA_POSITION_UPDATE_FORBIDDEN');
    const input = normalizeInput(rawInput);
    const effectiveFrom = inputDate(input);
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockPosition(transaction, context.agencyId, positionId);
      const draft = await transaction.plantillaPositionVersion.findFirst({
        where: { id: draftId, agencyId: context.agencyId, positionId, status: 'DRAFT' },
        select: versionSelect,
      });
      if (!draft) throw this.draftNotFound();
      const predecessor = effectiveVersion(
        (await this.positionRecord(transaction, context.agencyId, positionId))?.versions ?? [],
        toDatabaseDate(manilaToday()),
      );
      if (predecessor && effectiveFrom <= predecessor.effectiveFrom) {
        throw this.successorDateInvalid();
      }
      await this.validateReferences(transaction, context, input, effectiveFrom);
      const result = await transaction.plantillaPositionVersion.updateMany({
        where: {
          id: draftId,
          agencyId: context.agencyId,
          positionId,
          status: 'DRAFT',
          ...(rawInput.rowVersion === undefined ? {} : { rowVersion: rawInput.rowVersion }),
        },
        data: {
          positionTitle: input.title,
          parentheticalTitle: input.parentheticalTitle ?? null,
          salaryGrade: input.salaryGrade,
          organizationUnitId: input.organizationUnitId,
          fundingSource: input.fundingSource,
          employmentCategory: input.employmentCategory,
          qualificationStandardVersionId: input.qualificationStandardVersionId,
          staffingAuthorityId: input.staffingAuthorityId,
          effectiveFrom,
          updatedByMembershipId: context.membershipId,
        },
      });
      if (result.count !== 1) throw this.draftConflict();
      const updated = await this.versionRecord(transaction, draftId);
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'PLANTILLA_POSITION_DRAFT_UPDATED',
        entityType: 'PlantillaPosition',
        entityId: positionId,
        previousStatus: 'DRAFT',
        newStatus: 'DRAFT',
        requestId: context.requestId,
        occurredAt: new Date(),
        metadata: {
          before: auditVersionData(versionSummary(draft)),
          after: auditVersionData(versionSummary(updated)),
        },
      });
      return versionSummary(updated);
    });
  }

  async activate(
    context: RequestContext,
    positionId: string,
    draftId: string,
    reason: string,
  ): Promise<PlantillaPositionSummary> {
    this.assertPermission(context, 'positions.items.update', 'PLANTILLA_POSITION_UPDATE_FORBIDDEN');
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw this.activationReasonRequired();
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockPosition(transaction, context.agencyId, positionId);
      const draft = await transaction.plantillaPositionVersion.findFirst({
        where: { id: draftId, agencyId: context.agencyId, positionId, status: 'DRAFT' },
        select: versionSelect,
      });
      if (!draft) throw this.draftNotFound();
      const record = await this.positionRecord(transaction, context.agencyId, positionId);
      if (!record) throw this.notFound();
      const current = effectiveVersion(record.versions, toDatabaseDate(manilaToday()));
      if (!current || draft.effectiveFrom <= current.effectiveFrom)
        throw this.successorDateInvalid();
      await this.validateReferences(
        transaction,
        context,
        this.inputFromVersion(draft, draft.effectiveFrom),
        draft.effectiveFrom,
      );
      await transaction.plantillaPositionVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: current.id } },
        data: { status: 'SUPERSEDED', effectiveTo: addDays(draft.effectiveFrom, -1) },
      });
      await transaction.plantillaPositionVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: draft.id } },
        data: { status: 'ACTIVE' },
      });
      const refreshed = await this.refreshProjection(transaction, context.agencyId, positionId);
      if (!refreshed) throw this.notFound();
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'PLANTILLA_POSITION_VERSION_ACTIVATED',
        entityType: 'PlantillaPosition',
        entityId: positionId,
        previousStatus: current.domainStatus,
        newStatus: draft.domainStatus,
        reason: normalizedReason,
        requestId: context.requestId,
        occurredAt: new Date(),
        metadata: {
          predecessorId: current.id,
          versionId: draft.id,
          effectiveDate: formatDate(draft.effectiveFrom),
        },
      });
      return positionSummary(refreshed, toDatabaseDate(manilaToday()));
    });
  }

  async correct(
    context: RequestContext,
    positionId: string,
    versionId: string,
    rawInput: PlantillaPositionCorrectionInput,
  ): Promise<PlantillaPositionVersionSummary> {
    this.assertPermission(context, 'positions.items.update', 'PLANTILLA_POSITION_UPDATE_FORBIDDEN');
    const reason = rawInput.reason.trim();
    if (!reason) throw this.correctionReasonRequired();
    const input = normalizeInput({ ...rawInput, effectiveDate: manilaToday() });
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockPosition(transaction, context.agencyId, positionId);
      const source = await transaction.plantillaPositionVersion.findFirst({
        where: {
          id: versionId,
          agencyId: context.agencyId,
          positionId,
          status: { in: ['ACTIVE', 'SUPERSEDED'] },
        },
        select: versionSelect,
      });
      if (!source) throw this.versionNotFound();
      const effectiveFrom = source.effectiveFrom;
      await this.validateReferences(
        transaction,
        context,
        { ...input, effectiveDate: formatDate(effectiveFrom) },
        effectiveFrom,
      );
      const latest = await transaction.plantillaPositionVersion.findFirst({
        where: { agencyId: context.agencyId, positionId },
        orderBy: { versionNo: 'desc' },
        select: { versionNo: true },
      });
      await transaction.plantillaPositionVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: source.id } },
        data: { status: 'VOIDED' },
      });
      const replacement = await transaction.plantillaPositionVersion.create({
        data: this.versionData(context, positionId, input, effectiveFrom, {
          versionNo: (latest?.versionNo ?? source.versionNo) + 1,
          status: 'ACTIVE',
          domainStatus: source.domainStatus as PlantillaPositionLifecycleStatus,
          effectiveTo: source.effectiveTo,
        }),
      });
      const refreshed = await this.refreshProjection(transaction, context.agencyId, positionId);
      if (!refreshed) throw this.notFound();
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'PLANTILLA_POSITION_VERSION_CORRECTED',
        entityType: 'PlantillaPosition',
        entityId: positionId,
        previousStatus: source.status,
        newStatus: 'ACTIVE',
        reason,
        requestId: context.requestId,
        occurredAt: new Date(),
        metadata: {
          voidedVersionId: source.id,
          replacementVersionId: replacement.id,
          effectiveDate: formatDate(effectiveFrom),
        },
      });
      return versionSummary(await this.versionRecord(transaction, replacement.id));
    });
  }

  async authorize(
    context: RequestContext,
    positionId: string,
    input: PlantillaPositionTransitionInput,
    rawIdempotencyKey?: string,
  ): Promise<PlantillaPositionSummary> {
    this.assertPermission(
      context,
      'positions.items.authorize',
      'PLANTILLA_POSITION_AUTHORIZE_FORBIDDEN',
    );
    return this.transition(
      context,
      positionId,
      input,
      {
        action: 'PLANTILLA_POSITION_AUTHORIZED',
        from: ['PROPOSED'],
        to: 'AUTHORIZED',
        evidencePurpose: 'CREATION',
      },
      rawIdempotencyKey,
    );
  }

  async declareVacant(
    context: RequestContext,
    positionId: string,
    input: PlantillaPositionTransitionInput,
    rawIdempotencyKey?: string,
  ): Promise<PlantillaPositionSummary> {
    this.assertPermission(
      context,
      'positions.items.declare_vacant',
      'PLANTILLA_POSITION_DECLARE_VACANT_FORBIDDEN',
    );
    return this.transition(
      context,
      positionId,
      input,
      {
        action: 'PLANTILLA_POSITION_DECLARED_VACANT',
        from: ['AUTHORIZED'],
        to: 'VACANT',
      },
      rawIdempotencyKey,
    );
  }

  async freeze(
    context: RequestContext,
    positionId: string,
    input: PlantillaPositionTransitionInput,
    rawIdempotencyKey?: string,
  ): Promise<PlantillaPositionSummary> {
    this.assertPermission(context, 'positions.items.freeze', 'PLANTILLA_POSITION_FREEZE_FORBIDDEN');
    return this.transition(
      context,
      positionId,
      input,
      {
        action: 'PLANTILLA_POSITION_FROZEN',
        from: ['AUTHORIZED', 'VACANT'],
        to: 'FROZEN',
        evidencePurpose: 'FREEZE',
      },
      rawIdempotencyKey,
    );
  }

  async unfreeze(
    context: RequestContext,
    positionId: string,
    input: PlantillaPositionTransitionInput,
    rawIdempotencyKey?: string,
  ): Promise<PlantillaPositionSummary> {
    this.assertPermission(
      context,
      'positions.items.unfreeze',
      'PLANTILLA_POSITION_UNFREEZE_FORBIDDEN',
    );
    return this.transition(
      context,
      positionId,
      input,
      {
        action: 'PLANTILLA_POSITION_UNFROZEN',
        from: ['FROZEN'],
        to: 'VACANT',
      },
      rawIdempotencyKey,
    );
  }

  async cancel(
    context: RequestContext,
    positionId: string,
    input: PlantillaPositionTransitionInput,
    rawIdempotencyKey?: string,
  ): Promise<PlantillaPositionSummary> {
    this.assertPermission(context, 'positions.items.cancel', 'PLANTILLA_POSITION_CANCEL_FORBIDDEN');
    return this.transition(
      context,
      positionId,
      input,
      {
        action: 'PLANTILLA_POSITION_CANCELLED',
        from: ['PROPOSED'],
        to: 'ABOLISHED',
        skipReferenceValidation: true,
      },
      rawIdempotencyKey,
    );
  }

  async abolish(
    context: RequestContext,
    positionId: string,
    input: PlantillaPositionTransitionInput,
    rawIdempotencyKey?: string,
  ): Promise<PlantillaPositionSummary> {
    this.assertPermission(
      context,
      'positions.items.abolish',
      'PLANTILLA_POSITION_ABOLISH_FORBIDDEN',
    );
    return this.transition(
      context,
      positionId,
      input,
      {
        action: 'PLANTILLA_POSITION_ABOLISHED',
        from: ['AUTHORIZED', 'VACANT'],
        to: 'ABOLISHED',
        evidencePurpose: 'ABOLITION',
      },
      rawIdempotencyKey,
    );
  }

  /** Internal contract: Personnel Baselines own the transaction; Plantilla owns this transition. */
  async occupyInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    positionId: string,
    effectiveDate: string,
    reason: string,
    rawIdempotencyKey?: string,
  ): Promise<PlantillaPositionSummary> {
    return this.transitionInTransaction(
      transaction,
      context,
      positionId,
      { effectiveDate, reason },
      {
        action: 'PLANTILLA_POSITION_OCCUPIED',
        from: ['VACANT'],
        to: 'OCCUPIED',
      },
      rawIdempotencyKey,
    );
  }

  /** Internal contract: Recruitment owns the transaction; Plantilla owns this reservation. */
  async reserveInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    positionId: string,
    effectiveDate: string,
    reason: string,
    rawIdempotencyKey?: string,
  ): Promise<PlantillaPositionSummary> {
    return this.transitionInTransaction(
      transaction,
      context,
      positionId,
      { effectiveDate, reason },
      {
        action: 'PLANTILLA_POSITION_RESERVED',
        from: ['VACANT'],
        to: 'RESERVED',
      },
      rawIdempotencyKey,
    );
  }

  /** Internal contract: Appointment revalidates the Recruitment reservation through Plantilla. */
  async resolveReservationInTransaction(
    transaction: Prisma.TransactionClient,
    context: Pick<RequestContext, 'agencyId'>,
    positionId: string,
  ): Promise<PlantillaPositionSummary | null> {
    const record = await this.positionRecord(transaction, context.agencyId, positionId);
    return record ? positionSummary(record, toDatabaseDate(manilaToday())) : null;
  }

  /**
   * Internal contract: Appointment owns the transaction; Plantilla owns this release.
   * Cancellation must always be able to free the item, so the release does not
   * revalidate staffing authority or qualification of a reservation made earlier.
   * A same-day release voids the never-effective reservation instead of dating a
   * zero-day successor.
   */
  async releaseReservationInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    positionId: string,
    effectiveDate: string,
    reason: string,
    rawIdempotencyKey?: string,
  ): Promise<PlantillaPositionSummary> {
    const effectiveFrom = toDatabaseDate(effectiveDate);
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    await this.lockPosition(transaction, context.agencyId, positionId);
    const record = await this.positionRecord(transaction, context.agencyId, positionId);
    if (!record) throw this.notFound();
    if (idempotencyKey) {
      const completed = await transaction.auditEvent.findFirst({
        where: {
          agencyId: context.agencyId,
          action: 'PLANTILLA_POSITION_RESERVATION_RELEASED',
          entityId: positionId,
          idempotencyKey,
        },
        select: { id: true },
      });
      if (completed) return positionSummary(record, toDatabaseDate(manilaToday()));
    }
    const current = effectiveVersion(record.versions, effectiveFrom);
    if (
      current?.status !== 'ACTIVE' ||
      current.domainStatus !== 'RESERVED' ||
      current.effectiveFrom.getTime() !== effectiveFrom.getTime()
    ) {
      return this.transitionInTransaction(
        transaction,
        context,
        positionId,
        { effectiveDate, reason },
        {
          action: 'PLANTILLA_POSITION_RESERVATION_RELEASED',
          from: ['RESERVED'],
          to: 'VACANT',
          skipReferenceValidation: true,
        },
        rawIdempotencyKey,
      );
    }
    const latest = record.versions.reduce(
      (maxVersion, version) => Math.max(maxVersion, version.versionNo),
      current.versionNo,
    );
    await transaction.plantillaPositionVersion.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: current.id } },
      data: { status: 'VOIDED' },
    });
    const replacement = await transaction.plantillaPositionVersion.create({
      data: this.versionData(
        context,
        positionId,
        this.inputFromVersion(current, effectiveFrom),
        effectiveFrom,
        {
          versionNo: latest + 1,
          status: 'ACTIVE',
          domainStatus: 'VACANT',
          effectiveTo: current.effectiveTo,
        },
      ),
      select: { id: true },
    });
    const refreshed = await this.refreshProjection(transaction, context.agencyId, positionId);
    if (!refreshed) throw this.notFound();
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action: 'PLANTILLA_POSITION_RESERVATION_RELEASED',
      entityType: 'PlantillaPosition',
      entityId: positionId,
      previousStatus: 'RESERVED',
      newStatus: 'VACANT',
      reason,
      requestId: context.requestId,
      occurredAt: new Date(),
      ...(idempotencyKey ? { idempotencyKey } : {}),
      metadata: {
        before: {
          lifecycleStatus: current.domainStatus,
          versionState: current.status,
          versionId: current.id,
          effectiveDate: formatDate(current.effectiveFrom),
        },
        after: {
          lifecycleStatus: 'VACANT',
          versionState: 'ACTIVE',
          versionId: replacement.id,
          effectiveDate: formatDate(effectiveFrom),
        },
        predecessorId: current.id,
        versionId: replacement.id,
        effectiveDate: formatDate(effectiveFrom),
        sameDayRelease: true,
      },
    });
    return positionSummary(refreshed, toDatabaseDate(manilaToday()));
  }

  /** Internal contract: Appointment resolves the reserved assignment it will consume. */
  async resolveReservedAssignmentInTransaction(
    transaction: Prisma.TransactionClient,
    context: Pick<RequestContext, 'agencyId'>,
    positionId: string,
    effectiveDate: string,
  ): Promise<ReservedAssignmentFacts | null> {
    const effectiveFrom = toDatabaseDate(effectiveDate);
    const record = await this.positionRecord(transaction, context.agencyId, positionId);
    if (!record) return null;
    const current = effectiveVersion(record.versions, effectiveFrom);
    if (!current || current.status !== 'ACTIVE' || current.domainStatus !== 'RESERVED') {
      return null;
    }
    return {
      organizationUnitId: current.organizationUnit.id,
      salaryGrade: current.salaryGrade,
    };
  }

  /**
   * Internal contract: Appointment owns the transaction; Plantilla owns the
   * occupancy and the Position Incumbency. The reserved version is revalidated
   * at the assumption date, then consumed: a same-day consumption voids the
   * never-effective reservation, a later assumption supersedes it like any
   * other transition. The Service Segment is Personnel-owned; this method only
   * links the incumbency to it.
   */
  async completeReservedAssignmentInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    positionId: string,
    input: CompleteReservedAssignmentInput,
    rawIdempotencyKey?: string,
  ): Promise<CompletedAssignment> {
    const reason = input.reason.trim();
    if (!reason) throw this.transitionReasonRequired();
    const effectiveFrom = toDatabaseDate(input.effectiveDate);
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    await this.lockPosition(transaction, context.agencyId, positionId);
    const record = await this.positionRecord(transaction, context.agencyId, positionId);
    if (!record) throw this.notFound();
    if (idempotencyKey) {
      const completed = await transaction.auditEvent.findFirst({
        where: {
          agencyId: context.agencyId,
          action: 'PLANTILLA_POSITION_OCCUPIED',
          entityId: positionId,
          idempotencyKey,
        },
        select: { metadata: true },
      });
      if (completed) {
        if (
          this.metadataString(completed.metadata, 'appointmentId') !== input.appointmentId ||
          this.metadataString(completed.metadata, 'effectiveDate') !== input.effectiveDate
        ) {
          throw this.idempotencyConflict();
        }
        const incumbent = await transaction.positionIncumbency.findFirst({
          where: { agencyId: context.agencyId, serviceSegmentId: input.serviceSegmentId },
          select: { id: true },
        });
        const versionId = this.metadataString(completed.metadata, 'versionId');
        if (!incumbent || !versionId) throw this.idempotencyConflict();
        return {
          versionId,
          positionIncumbencyId: incumbent.id,
        };
      }
    }
    if (draftVersion(record.versions)) throw this.transitionDraftConflict();
    const current = effectiveVersion(record.versions, effectiveFrom);
    if (
      !current ||
      current.status !== 'ACTIVE' ||
      current.domainStatus !== 'RESERVED' ||
      current.effectiveFrom.getTime() > effectiveFrom.getTime()
    ) {
      throw this.assignmentInvalid();
    }
    if (
      current.organizationUnit.id !== input.expectedOrganizationUnitId ||
      current.salaryGrade !== input.expectedSalaryGrade
    ) {
      throw this.assignmentMismatch();
    }
    const overlap = await transaction.positionIncumbency.findFirst({
      where: {
        agencyId: context.agencyId,
        positionId,
        status: { not: 'VOIDED' },
        effectiveFrom: { lte: effectiveFrom },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
      },
      select: { id: true },
    });
    if (overlap) throw this.incumbencyConflict();
    const latest = record.versions.reduce(
      (maxVersion, version) => Math.max(maxVersion, version.versionNo),
      current.versionNo,
    );
    const sameDay = current.effectiveFrom.getTime() === effectiveFrom.getTime();
    await transaction.plantillaPositionVersion.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: current.id } },
      data: sameDay
        ? { status: 'VOIDED' }
        : { status: 'SUPERSEDED', effectiveTo: addDays(effectiveFrom, -1) },
    });
    const replacement = await transaction.plantillaPositionVersion.create({
      data: this.versionData(
        context,
        positionId,
        this.inputFromVersion(current, effectiveFrom),
        effectiveFrom,
        {
          versionNo: latest + 1,
          status: 'ACTIVE',
          domainStatus: 'OCCUPIED',
          effectiveTo: sameDay ? current.effectiveTo : null,
        },
      ),
      select: { id: true },
    });
    const refreshed = await this.refreshProjection(transaction, context.agencyId, positionId);
    if (!refreshed) throw this.notFound();
    const incumbency = await transaction.positionIncumbency.create({
      data: {
        agencyId: context.agencyId,
        positionId,
        employeeId: input.employeeId,
        serviceSegmentId: input.serviceSegmentId,
        effectiveFrom,
        effectiveTo: null,
        status: 'ACTIVE',
        createdByMembershipId: context.membershipId,
      },
      select: { id: true },
    });
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action: 'PLANTILLA_POSITION_OCCUPIED',
      entityType: 'PlantillaPosition',
      entityId: positionId,
      previousStatus: 'RESERVED',
      newStatus: 'OCCUPIED',
      reason,
      requestId: context.requestId,
      occurredAt: new Date(),
      ...(idempotencyKey ? { idempotencyKey } : {}),
      metadata: {
        before: {
          lifecycleStatus: current.domainStatus,
          versionState: current.status,
          versionId: current.id,
          effectiveDate: formatDate(current.effectiveFrom),
        },
        after: {
          lifecycleStatus: 'OCCUPIED',
          versionState: 'ACTIVE',
          versionId: replacement.id,
          effectiveDate: formatDate(effectiveFrom),
        },
        predecessorId: current.id,
        versionId: replacement.id,
        effectiveDate: formatDate(effectiveFrom),
        positionIncumbencyId: incumbency.id,
        appointmentId: input.appointmentId,
        appointmentVersionId: input.appointmentVersionId,
        serviceSegmentId: input.serviceSegmentId,
        employeeId: input.employeeId,
        sameDayAssignment: sameDay,
      },
    });
    return {
      versionId: replacement.id,
      positionIncumbencyId: incumbency.id,
    };
  }

  /** Internal contract: Personnel Actions own the transaction; Plantilla owns this transition. */
  async lockInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    positionId: string,
  ): Promise<void> {
    await this.lockPosition(transaction, context.agencyId, positionId);
  }

  /** Internal contract: Personnel Actions own the transaction; Plantilla owns this transition. */
  async vacateInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    positionId: string,
    effectiveDate: string,
    reason: string,
    rawIdempotencyKey?: string,
  ): Promise<PlantillaPositionSummary> {
    return this.transitionInTransaction(
      transaction,
      context,
      positionId,
      { effectiveDate, reason },
      {
        action: 'PLANTILLA_POSITION_VACATED',
        from: ['OCCUPIED'],
        to: 'VACANT',
      },
      rawIdempotencyKey,
    );
  }

  /** Internal contract: same-item reinstatement corrects the invalid vacancy in place. */
  async restoreOccupancyInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    positionId: string,
    effectiveDate: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<PlantillaPositionSummary> {
    const effectiveFrom = toDatabaseDate(effectiveDate);
    await this.lockPosition(transaction, context.agencyId, positionId);
    const record = await this.positionRecord(transaction, context.agencyId, positionId);
    if (!record) throw this.notFound();
    const completed = await transaction.auditEvent.findFirst({
      where: {
        agencyId: context.agencyId,
        action: 'PLANTILLA_POSITION_OCCUPANCY_RESTORED',
        entityId: positionId,
        idempotencyKey,
      },
      select: { id: true },
    });
    if (completed) return positionSummary(record, toDatabaseDate(manilaToday()));
    const source = record.versions.find(
      (version) =>
        version.status === 'ACTIVE' &&
        version.domainStatus === 'VACANT' &&
        version.effectiveFrom.getTime() === effectiveFrom.getTime(),
    );
    if (!source) throw this.transitionNotAllowed(record.status);
    const input = this.inputFromVersion(source, effectiveFrom);
    await this.validateReferences(transaction, context, input, effectiveFrom, {
      requireActiveAuthority: true,
    });
    const latest = Math.max(...record.versions.map(({ versionNo }) => versionNo));
    await transaction.plantillaPositionVersion.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: source.id } },
      data: { status: 'VOIDED' },
    });
    const replacement = await transaction.plantillaPositionVersion.create({
      data: this.versionData(context, positionId, input, effectiveFrom, {
        versionNo: latest + 1,
        status: 'ACTIVE',
        domainStatus: 'OCCUPIED',
        effectiveTo: source.effectiveTo,
      }),
      select: { id: true },
    });
    const refreshed = await this.refreshProjection(transaction, context.agencyId, positionId);
    if (!refreshed) throw this.notFound();
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action: 'PLANTILLA_POSITION_OCCUPANCY_RESTORED',
      entityType: 'PlantillaPosition',
      entityId: positionId,
      previousStatus: 'VACANT',
      newStatus: 'OCCUPIED',
      reason,
      requestId: context.requestId,
      idempotencyKey,
      metadata: {
        voidedVersionId: source.id,
        replacementVersionId: replacement.id,
        effectiveDate,
      },
    });
    return positionSummary(refreshed, toDatabaseDate(manilaToday()));
  }

  private async transition(
    context: RequestContext,
    positionId: string,
    input: PlantillaPositionTransitionInput,
    options: {
      action: string;
      from: readonly PlantillaPositionLifecycleStatus[];
      to: PlantillaPositionLifecycleStatus;
      evidencePurpose?: PlantillaPositionEvidencePurpose;
      skipReferenceValidation?: boolean;
    },
    rawIdempotencyKey?: string,
  ): Promise<PlantillaPositionSummary> {
    const reason = input.reason.trim();
    if (!reason) throw this.transitionReasonRequired();
    toDatabaseDate(input.effectiveDate);
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);

    return withDatabaseContext(databaseContext(context, true), (transaction) =>
      this.transitionInTransaction(
        transaction,
        context,
        positionId,
        input,
        options,
        idempotencyKey,
      ),
    );
  }

  private async transitionInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    positionId: string,
    input: PlantillaPositionTransitionInput,
    options: {
      action: string;
      from: readonly PlantillaPositionLifecycleStatus[];
      to: PlantillaPositionLifecycleStatus;
      evidencePurpose?: PlantillaPositionEvidencePurpose;
      skipReferenceValidation?: boolean;
    },
    rawIdempotencyKey?: string | null,
  ): Promise<PlantillaPositionSummary> {
    const reason = input.reason.trim();
    if (!reason) throw this.transitionReasonRequired();
    const effectiveFrom = toDatabaseDate(input.effectiveDate);
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey ?? undefined);

    await this.lockPosition(transaction, context.agencyId, positionId);
    const record = await this.positionRecord(transaction, context.agencyId, positionId);
    if (!record) throw this.notFound();
    if (idempotencyKey) {
      const completed = await transaction.auditEvent.findFirst({
        where: {
          agencyId: context.agencyId,
          action: options.action,
          entityId: positionId,
          idempotencyKey,
        },
        select: { reason: true, metadata: true },
      });
      if (completed) {
        if (
          completed.reason !== reason ||
          this.metadataString(completed.metadata, 'effectiveDate') !== input.effectiveDate
        ) {
          throw this.idempotencyConflict();
        }
        return positionSummary(record, toDatabaseDate(manilaToday()));
      }
    }
    if (draftVersion(record.versions)) throw this.transitionDraftConflict();

    const current = effectiveVersion(record.versions, effectiveFrom);
    if (
      !current ||
      current.status !== 'ACTIVE' ||
      !options.from.includes(current.domainStatus as PlantillaPositionLifecycleStatus)
    ) {
      throw this.transitionNotAllowed(current?.domainStatus ?? null);
    }
    if (effectiveFrom <= current.effectiveFrom) throw this.transitionDateInvalid();

    if (!options.skipReferenceValidation) {
      const versionInput = this.inputFromVersion(current, effectiveFrom);
      await this.validateReferences(transaction, context, versionInput, effectiveFrom, {
        requireActiveAuthority: true,
      });
    }

    const evidence = options.evidencePurpose
      ? await this.requiredEvidence(
          transaction,
          context,
          positionId,
          options.evidencePurpose,
          effectiveFrom,
        )
      : null;
    const latest = record.versions.reduce(
      (maxVersion, version) => Math.max(maxVersion, version.versionNo),
      current.versionNo,
    );

    await transaction.plantillaPositionVersion.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: current.id } },
      data: { status: 'SUPERSEDED', effectiveTo: addDays(effectiveFrom, -1) },
    });
    const next = await transaction.plantillaPositionVersion.create({
      data: this.versionData(
        context,
        positionId,
        this.inputFromVersion(current, effectiveFrom),
        effectiveFrom,
        {
          versionNo: latest + 1,
          status: 'ACTIVE',
          domainStatus: options.to,
        },
      ),
      select: { id: true },
    });
    const refreshed = await this.refreshProjection(transaction, context.agencyId, positionId);
    if (!refreshed) throw this.notFound();
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action: options.action,
      entityType: 'PlantillaPosition',
      entityId: positionId,
      previousStatus: current.domainStatus,
      newStatus: options.to,
      reason,
      requestId: context.requestId,
      occurredAt: new Date(),
      ...(idempotencyKey ? { idempotencyKey } : {}),
      metadata: {
        before: {
          lifecycleStatus: current.domainStatus,
          versionState: current.status,
          versionId: current.id,
          effectiveDate: formatDate(current.effectiveFrom),
        },
        after: {
          lifecycleStatus: options.to,
          versionState: 'ACTIVE',
          versionId: next.id,
          effectiveDate: formatDate(effectiveFrom),
        },
        predecessorId: current.id,
        versionId: next.id,
        effectiveDate: formatDate(effectiveFrom),
        staffingAuthorityId: current.staffingAuthority.id,
        authorityReference: current.staffingAuthority.referenceNo,
        ...(evidence ? { evidence: evidenceAuditMetadata(evidence) } : {}),
      },
    });
    return positionSummary(refreshed, toDatabaseDate(manilaToday()));
  }

  private versionData(
    context: RequestContext,
    positionId: string,
    input: PlantillaPositionInput,
    effectiveFrom: Date,
    state: {
      versionNo: number;
      status: PlantillaPositionVersionState;
      domainStatus: PlantillaPositionLifecycleStatus;
      effectiveTo?: Date | null;
    },
  ): Prisma.PlantillaPositionVersionUncheckedCreateInput {
    return {
      agencyId: context.agencyId,
      positionId,
      organizationUnitId: input.organizationUnitId,
      qualificationStandardVersionId: input.qualificationStandardVersionId,
      staffingAuthorityId: input.staffingAuthorityId,
      versionNo: state.versionNo,
      positionTitle: input.title,
      parentheticalTitle: input.parentheticalTitle ?? null,
      salaryGrade: input.salaryGrade,
      fundingSource: input.fundingSource,
      employmentCategory: input.employmentCategory,
      effectiveFrom,
      effectiveTo: state.effectiveTo ?? null,
      status: state.status,
      domainStatus: state.domainStatus,
      createdByMembershipId: context.membershipId,
      updatedByMembershipId: context.membershipId,
    };
  }

  private inputFromVersion(
    version: Pick<
      VersionRecord,
      | 'positionTitle'
      | 'parentheticalTitle'
      | 'salaryGrade'
      | 'organizationUnit'
      | 'fundingSource'
      | 'employmentCategory'
      | 'qualificationStandardVersion'
      | 'staffingAuthority'
    > & { effectiveFrom: Date },
    effectiveFrom: Date,
  ): PlantillaPositionInput {
    return {
      title: version.positionTitle,
      parentheticalTitle: version.parentheticalTitle,
      salaryGrade: version.salaryGrade,
      organizationUnitId: version.organizationUnit.id,
      fundingSource: version.fundingSource,
      employmentCategory: version.employmentCategory as PlantillaPositionEmploymentCategory,
      qualificationStandardVersionId: version.qualificationStandardVersion.id,
      staffingAuthorityId: version.staffingAuthority.id,
      effectiveDate: formatDate(effectiveFrom),
    };
  }

  private async validateReferences(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: PlantillaPositionInput,
    effectiveDate: Date,
    options: { requireActiveAuthority?: boolean } = {},
  ): Promise<void> {
    const unitVersion = await transaction.organizationUnitVersion.findFirst({
      where: {
        agencyId: context.agencyId,
        organizationUnitId: input.organizationUnitId,
        status: { in: ['ACTIVE', 'SUPERSEDED'] },
        domainStatus: 'ACTIVE',
        effectiveFrom: { lte: effectiveDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveDate } }],
      },
      select: { id: true },
    });
    if (!unitVersion) throw this.organizationUnitInvalid();

    const standardVersion = await transaction.qualificationStandardVersion.findFirst({
      where: {
        id: input.qualificationStandardVersionId,
        agencyId: context.agencyId,
        status: { in: ['ACTIVE', 'SUPERSEDED'] },
        domainStatus: 'ACTIVE',
        effectiveFrom: { lte: effectiveDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveDate } }],
      },
      select: { id: true },
    });
    if (!standardVersion) throw this.qualificationStandardInvalid();

    const authority = await transaction.staffingAuthority.findFirst({
      where: { id: input.staffingAuthorityId, agencyId: context.agencyId },
      select: {
        id: true,
        status: true,
        effectiveDate: true,
        supersededEffectiveDate: true,
        revokedEffectiveDate: true,
        documentId: true,
        evidenceVersionId: true,
        evidenceValidatedAt: true,
        evidenceValidationReason: true,
      },
    });
    if (
      !authority ||
      authority.status === 'DRAFT' ||
      authority.status === 'REVOKED' ||
      (options.requireActiveAuthority && authority.status !== 'ACTIVE') ||
      authority.effectiveDate > effectiveDate ||
      (authority.supersededEffectiveDate !== null &&
        authority.supersededEffectiveDate <= effectiveDate) ||
      (authority.revokedEffectiveDate !== null && authority.revokedEffectiveDate <= effectiveDate)
    ) {
      throw this.staffingAuthorityInvalid();
    }
    if (
      !authority.documentId ||
      !authority.evidenceVersionId ||
      !authority.evidenceValidatedAt ||
      !authority.evidenceValidationReason
    )
      throw this.staffingAuthorityEvidenceRequired();
    const evidence = await this.documentsService.resolveExternalEvidenceInTransaction(
      transaction,
      context,
      {
        documentId: authority.documentId,
        versionId: authority.evidenceVersionId,
        allowSensitive: true,
        requirement: 'NOT_VOIDED',
      },
    );
    if (!evidence.ok) throw this.staffingAuthorityEvidenceRequired();
  }

  private async requiredEvidence(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    positionId: string,
    purpose: PlantillaPositionEvidencePurpose,
    effectiveDate: Date,
  ): Promise<PositionEvidenceRecord> {
    this.assertEvidenceReadPermission(context);
    const record = await transaction.positionDocument.findFirst({
      where: {
        agencyId: context.agencyId,
        positionId,
        documentType: purpose,
        OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: effectiveDate } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      select: positionEvidenceSelect,
    });
    if (!record || !record.document.currentVersion) throw this.positionEvidenceRequired(purpose);
    if (
      record.document.classification === 'HIGHLY_SENSITIVE' &&
      !hasPermission(context, 'documents.evidence.read_sensitive', {
        agencyId: context.agencyId,
      })
    ) {
      throw this.evidenceSensitiveForbidden();
    }
    if (
      !LINKABLE_EXTERNAL_EVIDENCE_STATUSES.includes(
        record.document.status as (typeof LINKABLE_EXTERNAL_EVIDENCE_STATUSES)[number],
      )
    ) {
      throw this.positionEvidenceRequired(purpose);
    }
    return record;
  }

  private async positionRecord(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    positionId: string,
  ): Promise<PositionRecord | null> {
    return transaction.plantillaPosition.findFirst({
      where: { id: positionId, agencyId },
      select: positionSelect,
    });
  }

  private async positionEvidenceRecords(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    positionId: string,
  ): Promise<PlantillaPositionEvidence[]> {
    const records = await transaction.positionDocument.findMany({
      where: { agencyId: context.agencyId, positionId },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      take: PLANTILLA_POSITION_EVIDENCE_LIST_LIMIT,
      select: positionEvidenceSelect,
    });
    return records.flatMap((record) => {
      const summary = evidenceSummary(record);
      return summary && this.canExposeEvidenceRecord(context, summary) ? [summary] : [];
    });
  }

  private async positionEvidenceRecord(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    positionId: string,
    evidenceId: string,
  ): Promise<PositionEvidenceRecord | null> {
    return transaction.positionDocument.findFirst({
      where: { id: evidenceId, agencyId, positionId },
      select: positionEvidenceSelect,
    });
  }

  private evidenceDate(value: string): Date {
    try {
      return toDatabaseDate(value);
    } catch {
      throw this.evidenceDateInvalid();
    }
  }

  private async versionRecord(
    transaction: Prisma.TransactionClient,
    versionId: string,
  ): Promise<VersionRecord> {
    return transaction.plantillaPositionVersion.findFirstOrThrow({
      where: { id: versionId },
      select: versionSelect,
    });
  }

  private async refreshProjection(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    positionId: string,
  ): Promise<PositionRecord | null> {
    const record = await this.positionRecord(transaction, agencyId, positionId);
    if (!record) return null;
    const current = effectiveVersion(record.versions, toDatabaseDate(manilaToday()));
    await transaction.plantillaPosition.update({
      where: { agencyId_id: { agencyId, id: positionId } },
      data: {
        currentVersionId: current?.id ?? null,
        status: current?.domainStatus ?? record.status,
      },
    });
    return this.positionRecord(transaction, agencyId, positionId);
  }

  private async lockPosition(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    positionId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "plantilla_positions" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${positionId} AS uuid) FOR UPDATE`,
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
      throw new PlantillaPositionServiceError(
        'The current Agency Membership lacks the required permission.',
        403,
        code,
      );
    }
  }

  private assertEvidenceReadPermission(context: RequestContext): void {
    if (!hasPermission(context, 'documents.evidence.read', { agencyId: context.agencyId })) {
      throw new PlantillaPositionServiceError(
        'The current Agency Membership lacks permission to inspect External Evidence.',
        403,
        'PLANTILLA_POSITION_EVIDENCE_READ_FORBIDDEN',
      );
    }
  }

  private canExposeEvidenceRecord(
    context: RequestContext,
    record: PlantillaPositionEvidence,
  ): boolean {
    return (
      record.classification !== 'HIGHLY_SENSITIVE' ||
      hasPermission(context, 'documents.evidence.read_sensitive', {
        agencyId: context.agencyId,
      })
    );
  }

  private isKnownPrismaError(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
  }

  private metadataString(value: Prisma.JsonValue, key: string): string | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const item = value[key];
    return typeof item === 'string' ? item : null;
  }

  private notFound(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'The Plantilla Position could not be found.',
      404,
      'PLANTILLA_POSITION_NOT_FOUND',
    );
  }

  private itemNumberConflict(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'That Item Number is already reserved in this Agency.',
      409,
      'PLANTILLA_POSITION_ITEM_NUMBER_CONFLICT',
    );
  }

  private organizationUnitInvalid(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'The Organization Unit is not active for the effective date.',
      409,
      'PLANTILLA_POSITION_ORGANIZATION_UNIT_INVALID',
    );
  }

  private qualificationStandardInvalid(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'The Qualification Standard Version is not active for the effective date.',
      409,
      'PLANTILLA_POSITION_QUALIFICATION_STANDARD_INVALID',
    );
  }

  private staffingAuthorityInvalid(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'The Staffing Authority is not applicable for the effective date.',
      409,
      'PLANTILLA_POSITION_STAFFING_AUTHORITY_INVALID',
    );
  }

  private staffingAuthorityEvidenceRequired(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'The Staffing Authority must have usable validated evidence.',
      409,
      'PLANTILLA_POSITION_STAFFING_AUTHORITY_EVIDENCE_REQUIRED',
    );
  }

  private successorNotAllowed(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'A successor requires an active Plantilla Position version.',
      409,
      'PLANTILLA_POSITION_SUCCESSOR_NOT_ALLOWED',
    );
  }

  private successorDateInvalid(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'A successor effective date must follow the current version.',
      409,
      'PLANTILLA_POSITION_SUCCESSOR_DATE_INVALID',
    );
  }

  private assignmentInvalid(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'The Plantilla Position is no longer reserved for this activation.',
      409,
      'PLANTILLA_POSITION_ASSIGNMENT_INVALID',
    );
  }

  private assignmentMismatch(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'The reserved Plantilla Position changed before service activation.',
      409,
      'PLANTILLA_POSITION_ASSIGNMENT_MISMATCH',
    );
  }

  private incumbencyConflict(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'The Plantilla Position already has a conflicting Position Incumbency.',
      409,
      'PLANTILLA_POSITION_INCUMBENCY_CONFLICT',
    );
  }

  private draftNotFound(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'The Plantilla Position Draft could not be found.',
      404,
      'PLANTILLA_POSITION_DRAFT_NOT_FOUND',
    );
  }

  private draftConflict(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'The Plantilla Position Draft changed; reload and try again.',
      409,
      'PLANTILLA_POSITION_DRAFT_CONFLICT',
    );
  }

  private versionNotFound(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'The Plantilla Position Version could not be found.',
      404,
      'PLANTILLA_POSITION_VERSION_NOT_FOUND',
    );
  }

  private activationReasonRequired(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'A reason is required to activate a successor.',
      400,
      'PLANTILLA_POSITION_ACTIVATION_REASON_REQUIRED',
    );
  }

  private correctionReasonRequired(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'A reason is required to correct a Plantilla Position version.',
      400,
      'PLANTILLA_POSITION_CORRECTION_REASON_REQUIRED',
    );
  }

  private transitionReasonRequired(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'A reason is required for a Plantilla Position lifecycle transition.',
      400,
      'PLANTILLA_POSITION_TRANSITION_REASON_REQUIRED',
    );
  }

  private transitionDateInvalid(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'A lifecycle transition must take effect after the current effective version.',
      409,
      'PLANTILLA_POSITION_TRANSITION_DATE_INVALID',
    );
  }

  private transitionNotAllowed(currentStatus: string | null): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      currentStatus
        ? `The Plantilla Position cannot transition from ${currentStatus}.`
        : 'The Plantilla Position has no effective version for the requested date.',
      409,
      'PLANTILLA_POSITION_TRANSITION_NOT_ALLOWED',
    );
  }

  private transitionDraftConflict(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'Complete or discard the existing Draft successor before changing lifecycle state.',
      409,
      'PLANTILLA_POSITION_TRANSITION_DRAFT_CONFLICT',
    );
  }

  private idempotencyConflict(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'The Idempotency-Key was already used for a different Plantilla Position transition.',
      409,
      'PLANTILLA_POSITION_IDEMPOTENCY_CONFLICT',
    );
  }

  private positionEvidenceRequired(
    purpose: PlantillaPositionEvidencePurpose,
  ): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      `Link approved External Evidence for the ${purpose.toLowerCase().replaceAll('_', ' ')} action before continuing.`,
      409,
      'PLANTILLA_POSITION_EVIDENCE_REQUIRED',
    );
  }

  private evidencePurposeInvalid(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'Choose a supported Plantilla Position evidence purpose.',
      400,
      'PLANTILLA_POSITION_EVIDENCE_PURPOSE_INVALID',
    );
  }

  private evidenceDateInvalid(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'The Plantilla Position evidence effective date is invalid.',
      400,
      'PLANTILLA_POSITION_EVIDENCE_DATE_INVALID',
    );
  }

  private evidenceDocumentNotFound(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'The External Evidence Document could not be found in the active Agency.',
      404,
      'PLANTILLA_POSITION_EVIDENCE_DOCUMENT_NOT_FOUND',
    );
  }

  private evidenceDocumentIneligible(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'Only approved, issued, or superseded External Evidence with a current version can be linked.',
      409,
      'PLANTILLA_POSITION_EVIDENCE_DOCUMENT_INELIGIBLE',
    );
  }

  private evidenceSensitiveForbidden(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'The current Agency Membership cannot link highly sensitive External Evidence.',
      403,
      'PLANTILLA_POSITION_EVIDENCE_SENSITIVE_FORBIDDEN',
    );
  }

  private evidenceDuplicate(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'That External Evidence is already linked to this Plantilla Position for the selected purpose.',
      409,
      'PLANTILLA_POSITION_EVIDENCE_DUPLICATE',
    );
  }

  private evidenceNotFound(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'The Plantilla Position evidence link could not be found.',
      404,
      'PLANTILLA_POSITION_EVIDENCE_NOT_FOUND',
    );
  }

  private evidenceRemovalReasonRequired(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'A reason is required when removing a Plantilla Position evidence link.',
      400,
      'PLANTILLA_POSITION_EVIDENCE_REMOVAL_REASON_REQUIRED',
    );
  }

  private evidenceDocumentUnavailable(): PlantillaPositionServiceError {
    return new PlantillaPositionServiceError(
      'The linked External Evidence version is no longer available.',
      409,
      'PLANTILLA_POSITION_EVIDENCE_DOCUMENT_UNAVAILABLE',
    );
  }
}
