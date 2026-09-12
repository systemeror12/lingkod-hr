import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService, type DocumentSummary } from '../documents/documents.service';

export const QUALIFICATION_STANDARD_VERSION_STATES = [
  'DRAFT',
  'ACTIVE',
  'SUPERSEDED',
  'VOIDED',
] as const;

export type QualificationStandardVersionState =
  (typeof QUALIFICATION_STANDARD_VERSION_STATES)[number];
export type QualificationStandardStatus = 'ACTIVE' | 'INACTIVE';
export type QualificationStandardLifecycleStatus = 'ACTIVE' | 'INACTIVE';
export type QualificationEvidenceKind = 'SOURCE' | 'APPROVAL';

export interface QualificationStandardVersionInput {
  effectiveDate: string;
  educationRequirement?: string | null | undefined;
  trainingHoursRequired?: number | null | undefined;
  experienceMonthsRequired?: number | null | undefined;
  eligibilityRequirement?: string | null | undefined;
  competencyRequirements?: unknown[] | undefined;
  licenseRequirements?: unknown[] | undefined;
  specialRequirements?: string | null | undefined;
}

export interface CreateQualificationStandardInput extends QualificationStandardVersionInput {
  code: string;
  name: string;
}

export interface UpdateQualificationStandardDraftInput extends QualificationStandardVersionInput {
  rowVersion?: number | undefined;
}

export interface QualificationStandardCorrectionInput extends Omit<
  QualificationStandardVersionInput,
  'effectiveDate'
> {
  reason: string;
}

export interface QualificationStandardEvidenceInput {
  kind: QualificationEvidenceKind;
  documentId: string;
  validationReason: string;
}

export interface QualificationStandardEvidenceSummary {
  documentId: string;
  documentNo: string | null;
  documentType: string;
  classification: string;
  status: string;
  versionNo: number;
  mimeType: string;
  sizeBytes: number;
  validatedAt: string;
  validationReason: string;
}

export interface QualificationStandardVersionSummary {
  id: string;
  qualificationStandardId: string;
  versionNo: number;
  educationRequirement: string | null;
  trainingHoursRequired: number | null;
  experienceMonthsRequired: number | null;
  eligibilityRequirement: string | null;
  competencyRequirements: unknown[];
  licenseRequirements: unknown[];
  specialRequirements: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  versionState: QualificationStandardVersionState;
  lifecycleStatus: QualificationStandardLifecycleStatus;
  sourceEvidence: QualificationStandardEvidenceSummary | null;
  approvalEvidence: QualificationStandardEvidenceSummary | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface QualificationStandardSummary {
  id: string;
  code: string;
  name: string;
  status: QualificationStandardStatus;
  currentVersion: QualificationStandardVersionSummary | null;
  draft: QualificationStandardVersionSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface QualificationStandardHistoryEntry {
  id: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  effectiveDate: string | null;
  occurredAt: string;
}

export interface QualificationStandardDetail {
  standard: QualificationStandardSummary;
  asOf: string;
  effective: QualificationStandardVersionSummary | null;
  versions: QualificationStandardVersionSummary[];
  history: QualificationStandardHistoryEntry[];
}

export interface QualificationStandardSuccessor {
  current: QualificationStandardVersionSummary;
  draft: QualificationStandardVersionSummary;
}

export interface QualificationStandardAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const QUALIFICATION_STANDARD_AUDIT_WRITER = Symbol('QUALIFICATION_STANDARD_AUDIT_WRITER');

export const qualificationStandardAuditWriter: QualificationStandardAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};

export class QualificationStandardServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'QualificationStandardServiceError';
  }
}

const documentSelect = {
  id: true,
  documentNo: true,
  documentType: true,
  classification: true,
  status: true,
  currentVersion: {
    select: {
      id: true,
      versionNo: true,
      mimeType: true,
      sizeBytes: true,
    },
  },
} as const;

const evidenceVersionSelect = {
  id: true,
  versionNo: true,
  mimeType: true,
  sizeBytes: true,
} as const;

const versionSelect = {
  id: true,
  agencyId: true,
  qualificationStandardId: true,
  versionNo: true,
  educationRequirement: true,
  trainingHoursRequired: true,
  experienceMonthsRequired: true,
  eligibilityRequirement: true,
  competencyRequirements: true,
  licenseRequirements: true,
  specialRequirements: true,
  sourceDocumentId: true,
  sourceEvidenceVersionId: true,
  sourceEvidenceValidatedAt: true,
  sourceEvidenceValidatedByMembershipId: true,
  sourceEvidenceValidationReason: true,
  approvalDocumentId: true,
  approvalEvidenceVersionId: true,
  approvalEvidenceValidatedAt: true,
  approvalEvidenceValidatedByMembershipId: true,
  approvalEvidenceValidationReason: true,
  effectiveFrom: true,
  effectiveTo: true,
  status: true,
  domainStatus: true,
  rowVersion: true,
  createdAt: true,
  updatedAt: true,
  sourceDocument: { select: documentSelect },
  sourceEvidenceVersion: { select: evidenceVersionSelect },
  approvalDocument: { select: documentSelect },
  approvalEvidenceVersion: { select: evidenceVersionSelect },
} as const;

const standardSelect = {
  id: true,
  agencyId: true,
  code: true,
  name: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  currentVersion: { select: versionSelect },
  versions: {
    where: { status: 'DRAFT' },
    orderBy: { versionNo: 'desc' as const },
    take: 1,
    select: versionSelect,
  },
} as const;

type QualificationVersionRecord = Prisma.QualificationStandardVersionGetPayload<{
  select: typeof versionSelect;
}>;
type QualificationStandardRecord = Prisma.QualificationStandardGetPayload<{
  select: typeof standardSelect;
}>;

function databaseContext(context: RequestContext, transition = false) {
  return requestDatabaseContext(
    context,
    ...(transition ? (['qualification-standard-transition'] as const) : []),
  );
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

function todayDate(): Date {
  return toDatabaseDate(manilaToday());
}

function normalizeText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeJsonList(value: unknown): Prisma.InputJsonArray {
  return Array.isArray(value) ? (value as Prisma.InputJsonArray) : [];
}

function readJsonList(value: Prisma.JsonValue): unknown[] {
  return Array.isArray(value) ? value : [];
}

function inputJsonList(value: Prisma.JsonValue): Prisma.InputJsonArray {
  return Array.isArray(value) ? (value as Prisma.InputJsonArray) : [];
}

interface NormalizedRequirements {
  effectiveDate: string;
  educationRequirement: string | null;
  trainingHoursRequired: number | null;
  experienceMonthsRequired: number | null;
  eligibilityRequirement: string | null;
  competencyRequirements: Prisma.InputJsonArray;
  licenseRequirements: Prisma.InputJsonArray;
  specialRequirements: string | null;
}

function normalizeRequirements(input: QualificationStandardVersionInput): NormalizedRequirements {
  const trainingHoursRequired = input.trainingHoursRequired ?? null;
  const experienceMonthsRequired = input.experienceMonthsRequired ?? null;
  if (
    (trainingHoursRequired !== null &&
      (!Number.isFinite(trainingHoursRequired) || trainingHoursRequired < 0)) ||
    (experienceMonthsRequired !== null &&
      (!Number.isInteger(experienceMonthsRequired) || experienceMonthsRequired < 0))
  ) {
    throw new QualificationStandardServiceError(
      'Training hours and experience months must be nonnegative.',
      400,
      'QUALIFICATION_STANDARD_REQUIREMENT_INVALID',
    );
  }
  return {
    effectiveDate: input.effectiveDate,
    educationRequirement: normalizeText(input.educationRequirement),
    trainingHoursRequired,
    experienceMonthsRequired,
    eligibilityRequirement: normalizeText(input.eligibilityRequirement),
    competencyRequirements: normalizeJsonList(input.competencyRequirements),
    licenseRequirements: normalizeJsonList(input.licenseRequirements),
    specialRequirements: normalizeText(input.specialRequirements),
  };
}

function periodsOverlap(aFrom: Date, aTo: Date | null, bFrom: Date, bTo: Date | null): boolean {
  const aEnd = aTo?.getTime() ?? Number.POSITIVE_INFINITY;
  const bEnd = bTo?.getTime() ?? Number.POSITIVE_INFINITY;
  return aFrom.getTime() <= bEnd && bFrom.getTime() <= aEnd;
}

function canExposeEvidence(context: RequestContext, classification: string): boolean {
  return (
    hasPermission(context, 'documents.evidence.read', { agencyId: context.agencyId }) &&
    (classification !== 'HIGHLY_SENSITIVE' ||
      hasPermission(context, 'documents.evidence.read_sensitive', { agencyId: context.agencyId }))
  );
}

function isEvidenceUsable(document: DocumentSummary | null): document is DocumentSummary & {
  currentVersion: NonNullable<DocumentSummary['currentVersion']>;
} {
  return Boolean(document && document.status !== 'VOIDED' && document.currentVersion);
}

function evidenceSummary(
  document:
    QualificationVersionRecord['sourceDocument'] | QualificationVersionRecord['approvalDocument'],
  version:
    | QualificationVersionRecord['sourceEvidenceVersion']
    | QualificationVersionRecord['approvalEvidenceVersion'],
  validatedAt: Date | null,
  validationReason: string | null,
  context: RequestContext,
): QualificationStandardEvidenceSummary | null {
  if (!document || !version || !validatedAt || !validationReason) return null;
  if (!canExposeEvidence(context, document.classification)) return null;
  return {
    documentId: document.id,
    documentNo: document.documentNo,
    documentType: document.documentType,
    classification: document.classification,
    status: document.status,
    versionNo: version.versionNo,
    mimeType: version.mimeType,
    sizeBytes: Number(version.sizeBytes),
    validatedAt: formatDateTime(validatedAt),
    validationReason,
  };
}

function versionSummary(
  record: QualificationVersionRecord,
  context: RequestContext,
): QualificationStandardVersionSummary {
  return {
    id: record.id,
    qualificationStandardId: record.qualificationStandardId,
    versionNo: record.versionNo,
    educationRequirement: record.educationRequirement,
    trainingHoursRequired:
      record.trainingHoursRequired === null ? null : Number(record.trainingHoursRequired),
    experienceMonthsRequired: record.experienceMonthsRequired,
    eligibilityRequirement: record.eligibilityRequirement,
    competencyRequirements: readJsonList(record.competencyRequirements),
    licenseRequirements: readJsonList(record.licenseRequirements),
    specialRequirements: record.specialRequirements,
    effectiveFrom: formatDate(record.effectiveFrom),
    effectiveTo: record.effectiveTo ? formatDate(record.effectiveTo) : null,
    versionState: record.status as QualificationStandardVersionState,
    lifecycleStatus: record.domainStatus as QualificationStandardLifecycleStatus,
    sourceEvidence: evidenceSummary(
      record.sourceDocument,
      record.sourceEvidenceVersion,
      record.sourceEvidenceValidatedAt,
      record.sourceEvidenceValidationReason,
      context,
    ),
    approvalEvidence: evidenceSummary(
      record.approvalDocument,
      record.approvalEvidenceVersion,
      record.approvalEvidenceValidatedAt,
      record.approvalEvidenceValidationReason,
      context,
    ),
    rowVersion: record.rowVersion,
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt),
  };
}

function standardSummary(
  record: QualificationStandardRecord,
  context: RequestContext,
): QualificationStandardSummary {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    status: record.status as QualificationStandardStatus,
    currentVersion: record.currentVersion ? versionSummary(record.currentVersion, context) : null,
    draft: record.versions[0] ? versionSummary(record.versions[0], context) : null,
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt),
  };
}

function auditVersionData(value: QualificationStandardVersionSummary): Prisma.InputJsonObject {
  return {
    versionId: value.id,
    versionNo: value.versionNo,
    effectiveFrom: value.effectiveFrom,
    effectiveTo: value.effectiveTo,
    versionState: value.versionState,
    lifecycleStatus: value.lifecycleStatus,
    educationRequirement: value.educationRequirement,
    trainingHoursRequired: value.trainingHoursRequired,
    experienceMonthsRequired: value.experienceMonthsRequired,
    eligibilityRequirement: value.eligibilityRequirement,
    competencyCount: value.competencyRequirements.length,
    licenseCount: value.licenseRequirements.length,
    specialRequirementsPresent: Boolean(value.specialRequirements),
    sourceEvidenceVersionNo: value.sourceEvidence?.versionNo ?? null,
    approvalEvidenceVersionNo: value.approvalEvidence?.versionNo ?? null,
  };
}

function auditStandardData(value: QualificationStandardSummary): Prisma.InputJsonObject {
  return {
    code: value.code,
    name: value.name,
    status: value.status,
    currentVersionId: value.currentVersion?.id ?? null,
    draftVersionId: value.draft?.id ?? null,
  };
}

function dateInvalid(): QualificationStandardServiceError {
  return new QualificationStandardServiceError(
    'The Qualification Standard effective date is invalid.',
    400,
    'QUALIFICATION_STANDARD_DATE_INVALID',
  );
}

@Injectable()
export class QualificationStandardsService {
  constructor(
    @Inject(QUALIFICATION_STANDARD_AUDIT_WRITER)
    private readonly auditWriter: QualificationStandardAuditWriter,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
  ) {}

  async list(context: RequestContext): Promise<QualificationStandardSummary[]> {
    this.assertPermission(
      context,
      'qualification.standards.read',
      'QUALIFICATION_STANDARD_READ_FORBIDDEN',
    );
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const records = await transaction.qualificationStandard.findMany({
        where: { agencyId: context.agencyId },
        orderBy: [{ code: 'asc' }],
        select: standardSelect,
      });
      return records.map((record) => standardSummary(record, context));
    });
  }

  async findById(
    context: RequestContext,
    standardId: string,
    asOfValue = manilaToday(),
  ): Promise<QualificationStandardDetail | null> {
    this.assertPermission(
      context,
      'qualification.standards.read',
      'QUALIFICATION_STANDARD_READ_FORBIDDEN',
    );
    const asOf = toDatabaseDate(asOfValue);
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const record = await transaction.qualificationStandard.findFirst({
        where: { id: standardId, agencyId: context.agencyId },
        select: {
          ...standardSelect,
          versions: {
            orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
            select: versionSelect,
          },
        },
      });
      if (!record) return null;
      const effective = await this.currentPublished(
        transaction,
        context.agencyId,
        standardId,
        asOf,
      );
      const events = await transaction.auditEvent.findMany({
        where: {
          agencyId: context.agencyId,
          entityType: 'QualificationStandard',
          entityId: standardId,
          action: { startsWith: 'QUALIFICATION_STANDARD_' },
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
      return {
        standard: standardSummary(record, context),
        asOf: asOfValue,
        effective: effective ? versionSummary(effective, context) : null,
        versions: record.versions.map((version) => versionSummary(version, context)),
        history: events.map((event) => ({
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

  async create(
    context: RequestContext,
    rawInput: CreateQualificationStandardInput,
  ): Promise<QualificationStandardSummary> {
    this.assertPermission(
      context,
      'qualification.standards.create',
      'QUALIFICATION_STANDARD_CREATE_FORBIDDEN',
    );
    const code = rawInput.code.trim();
    const name = rawInput.name.trim();
    if (!code)
      throw new QualificationStandardServiceError(
        'A Qualification Standard code is required.',
        400,
        'QUALIFICATION_STANDARD_CODE_REQUIRED',
      );
    if (!name)
      throw new QualificationStandardServiceError(
        'A Qualification Standard name is required.',
        400,
        'QUALIFICATION_STANDARD_NAME_REQUIRED',
      );
    const input = normalizeRequirements(rawInput);
    const effectiveFrom = toDatabaseDate(input.effectiveDate);
    try {
      return await withDatabaseContext(databaseContext(context), async (transaction) => {
        const now = new Date();
        const standard = await transaction.qualificationStandard.create({
          data: {
            agencyId: context.agencyId,
            code,
            name,
            status: 'INACTIVE',
            createdByMembershipId: context.membershipId,
            updatedByMembershipId: context.membershipId,
          },
        });
        await transaction.qualificationStandardVersion.create({
          data: {
            agencyId: context.agencyId,
            qualificationStandardId: standard.id,
            versionNo: 1,
            educationRequirement: input.educationRequirement,
            trainingHoursRequired:
              input.trainingHoursRequired === null
                ? null
                : new Prisma.Decimal(input.trainingHoursRequired),
            experienceMonthsRequired: input.experienceMonthsRequired,
            eligibilityRequirement: input.eligibilityRequirement,
            competencyRequirements: input.competencyRequirements,
            licenseRequirements: input.licenseRequirements,
            specialRequirements: input.specialRequirements,
            effectiveFrom,
            status: 'DRAFT',
            domainStatus: 'INACTIVE',
            createdByMembershipId: context.membershipId,
            updatedByMembershipId: context.membershipId,
          },
        });
        const result = await transaction.qualificationStandard.findFirstOrThrow({
          where: { id: standard.id, agencyId: context.agencyId },
          select: standardSelect,
        });
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'QUALIFICATION_STANDARD_CREATED',
          entityType: 'QualificationStandard',
          entityId: standard.id,
          previousStatus: 'None',
          newStatus: 'INACTIVE',
          requestId: context.requestId,
          occurredAt: now,
          metadata: {
            code,
            name,
            versionNo: 1,
            effectiveDate: input.effectiveDate,
            versionState: 'DRAFT',
          },
        });
        return standardSummary(result, context);
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = error.meta?.target;
        if (Array.isArray(target) && target.includes('name')) throw this.nameConflict();
        throw this.codeConflict();
      }
      throw error;
    }
  }

  async createSuccessor(
    context: RequestContext,
    standardId: string,
  ): Promise<QualificationStandardSuccessor> {
    this.assertPermission(
      context,
      'qualification.standards.update',
      'QUALIFICATION_STANDARD_UPDATE_FORBIDDEN',
    );
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      await this.lockStandard(transaction, context.agencyId, standardId);
      const standard = await transaction.qualificationStandard.findFirst({
        where: { id: standardId, agencyId: context.agencyId },
        select: { id: true, status: true },
      });
      if (!standard) throw this.notFound();
      const current = await this.latestPublished(transaction, context.agencyId, standardId);
      if (!current) throw this.successorNotAllowed();
      const existingDraft = await transaction.qualificationStandardVersion.findFirst({
        where: { agencyId: context.agencyId, qualificationStandardId: standardId, status: 'DRAFT' },
        select: versionSelect,
      });
      if (existingDraft) {
        return {
          current: versionSummary(current, context),
          draft: versionSummary(existingDraft, context),
        };
      }
      const latest = await transaction.qualificationStandardVersion.findFirst({
        where: { agencyId: context.agencyId, qualificationStandardId: standardId },
        orderBy: { versionNo: 'desc' },
        select: { versionNo: true },
      });
      const effectiveFrom = new Date(
        Math.max(addDays(current.effectiveFrom, 1).getTime(), addDays(todayDate(), 1).getTime()),
      );
      const draft = await transaction.qualificationStandardVersion.create({
        data: {
          agencyId: context.agencyId,
          qualificationStandardId: standardId,
          versionNo: (latest?.versionNo ?? current.versionNo) + 1,
          educationRequirement: current.educationRequirement,
          trainingHoursRequired: current.trainingHoursRequired,
          experienceMonthsRequired: current.experienceMonthsRequired,
          eligibilityRequirement: current.eligibilityRequirement,
          competencyRequirements: inputJsonList(current.competencyRequirements),
          licenseRequirements: inputJsonList(current.licenseRequirements),
          specialRequirements: current.specialRequirements,
          effectiveFrom,
          status: 'DRAFT',
          domainStatus: current.domainStatus,
          createdByMembershipId: context.membershipId,
          updatedByMembershipId: context.membershipId,
        },
        select: versionSelect,
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'QUALIFICATION_STANDARD_SUCCESSOR_CREATED',
        entityType: 'QualificationStandard',
        entityId: standardId,
        previousStatus: current.status,
        newStatus: 'DRAFT',
        requestId: context.requestId,
        metadata: {
          predecessorId: current.id,
          versionId: draft.id,
          effectiveDate: formatDate(effectiveFrom),
        },
      });
      return {
        current: versionSummary(current, context),
        draft: versionSummary(draft, context),
      };
    });
  }

  async updateDraft(
    context: RequestContext,
    standardId: string,
    draftId: string,
    rawInput: UpdateQualificationStandardDraftInput,
  ): Promise<QualificationStandardVersionSummary> {
    this.assertPermission(
      context,
      'qualification.standards.update',
      'QUALIFICATION_STANDARD_UPDATE_FORBIDDEN',
    );
    const input = normalizeRequirements(rawInput);
    const effectiveFrom = toDatabaseDate(input.effectiveDate);
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      await this.lockStandard(transaction, context.agencyId, standardId);
      const draft = await transaction.qualificationStandardVersion.findFirst({
        where: {
          id: draftId,
          agencyId: context.agencyId,
          qualificationStandardId: standardId,
          status: 'DRAFT',
        },
        select: versionSelect,
      });
      if (!draft) throw this.draftNotFound();
      const result = await transaction.qualificationStandardVersion.updateMany({
        where: {
          id: draftId,
          agencyId: context.agencyId,
          status: 'DRAFT',
          ...(rawInput.rowVersion === undefined ? {} : { rowVersion: rawInput.rowVersion }),
        },
        data: {
          educationRequirement: input.educationRequirement,
          trainingHoursRequired:
            input.trainingHoursRequired === null
              ? null
              : new Prisma.Decimal(input.trainingHoursRequired),
          experienceMonthsRequired: input.experienceMonthsRequired,
          eligibilityRequirement: input.eligibilityRequirement,
          competencyRequirements: input.competencyRequirements,
          licenseRequirements: input.licenseRequirements,
          specialRequirements: input.specialRequirements,
          effectiveFrom,
          updatedByMembershipId: context.membershipId,
        },
      });
      if (result.count !== 1) throw this.draftConflict();
      const updated = await transaction.qualificationStandardVersion.findFirstOrThrow({
        where: { id: draftId, agencyId: context.agencyId },
        select: versionSelect,
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'QUALIFICATION_STANDARD_DRAFT_UPDATED',
        entityType: 'QualificationStandard',
        entityId: standardId,
        previousStatus: 'DRAFT',
        newStatus: 'DRAFT',
        requestId: context.requestId,
        metadata: {
          before: auditVersionData(versionSummary(draft, context)),
          after: auditVersionData(versionSummary(updated, context)),
        },
      });
      return versionSummary(updated, context);
    });
  }

  async linkEvidence(
    context: RequestContext,
    standardId: string,
    draftId: string,
    input: QualificationStandardEvidenceInput,
  ): Promise<QualificationStandardVersionSummary> {
    this.assertPermission(
      context,
      'qualification.standards.evidence.validate',
      'QUALIFICATION_STANDARD_EVIDENCE_FORBIDDEN',
    );
    this.assertDocumentReadPermission(context);
    const reason = input.validationReason.trim();
    if (!reason) throw this.evidenceReasonRequired();
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const draft = await transaction.qualificationStandardVersion.findFirst({
        where: {
          id: draftId,
          agencyId: context.agencyId,
          qualificationStandardId: standardId,
          status: 'DRAFT',
        },
        select: versionSelect,
      });
      if (!draft) throw this.draftNotFound();
      const document = await this.documentForValidation(transaction, context, input.documentId);
      if (!isEvidenceUsable(document)) throw this.evidenceInvalid();
      const validatedAt = new Date();
      const data: Prisma.QualificationStandardVersionUncheckedUpdateInput =
        input.kind === 'SOURCE'
          ? {
              sourceDocumentId: document.id,
              sourceEvidenceVersionId: document.currentVersion.id,
              sourceEvidenceValidatedAt: validatedAt,
              sourceEvidenceValidatedByMembershipId: context.membershipId,
              sourceEvidenceValidationReason: reason,
              updatedByMembershipId: context.membershipId,
            }
          : {
              approvalDocumentId: document.id,
              approvalEvidenceVersionId: document.currentVersion.id,
              approvalEvidenceValidatedAt: validatedAt,
              approvalEvidenceValidatedByMembershipId: context.membershipId,
              approvalEvidenceValidationReason: reason,
              updatedByMembershipId: context.membershipId,
            };
      await transaction.qualificationStandardVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: draftId } },
        data,
      });
      const updated = await transaction.qualificationStandardVersion.findFirstOrThrow({
        where: { id: draftId, agencyId: context.agencyId },
        select: versionSelect,
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'QUALIFICATION_STANDARD_EVIDENCE_LINKED',
        entityType: 'QualificationStandard',
        entityId: standardId,
        previousStatus: 'DRAFT',
        newStatus: 'DRAFT',
        reason,
        requestId: context.requestId,
        metadata: {
          versionId: draftId,
          evidenceKind: input.kind,
          documentId: document.id,
          evidenceVersionId: document.currentVersion.id,
        },
      });
      return versionSummary(updated, context);
    });
  }

  async activate(
    context: RequestContext,
    standardId: string,
    draftId: string,
    reason: string,
    rawIdempotencyKey?: string,
  ): Promise<QualificationStandardSummary> {
    this.assertPermission(
      context,
      'qualification.standards.activate',
      'QUALIFICATION_STANDARD_ACTIVATE_FORBIDDEN',
    );
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw this.activationReasonRequired();
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockStandard(transaction, context.agencyId, standardId);
      if (idempotencyKey) {
        const completed = await transaction.auditEvent.findFirst({
          where: {
            agencyId: context.agencyId,
            action: 'QUALIFICATION_STANDARD_VERSION_ACTIVATED',
            entityId: standardId,
            idempotencyKey,
          },
          select: { reason: true, metadata: true },
        });
        if (completed) {
          if (
            completed.reason !== normalizedReason ||
            this.metadataString(completed.metadata, 'versionId') !== draftId
          )
            throw this.idempotencyConflict();
          const existing = await this.standardRecord(transaction, context.agencyId, standardId);
          if (!existing) throw this.idempotencyConflict();
          return standardSummary(existing, context);
        }
      }
      const draft = await transaction.qualificationStandardVersion.findFirst({
        where: {
          id: draftId,
          agencyId: context.agencyId,
          qualificationStandardId: standardId,
          status: 'DRAFT',
        },
        select: versionSelect,
      });
      if (!draft) throw this.draftNotFound();
      const source = await this.validatedEvidence(
        transaction,
        context,
        draft.sourceDocumentId,
        draft.sourceEvidenceVersionId,
        draft.sourceEvidenceValidatedAt,
        draft.sourceEvidenceValidationReason,
      );
      const approval = await this.validatedEvidence(
        transaction,
        context,
        draft.approvalDocumentId,
        draft.approvalEvidenceVersionId,
        draft.approvalEvidenceValidatedAt,
        draft.approvalEvidenceValidationReason,
      );
      if (!source || !approval) throw this.evidenceRequired();
      const published = await transaction.qualificationStandardVersion.findMany({
        where: {
          agencyId: context.agencyId,
          qualificationStandardId: standardId,
          status: { in: ['ACTIVE', 'SUPERSEDED'] },
        },
        select: { id: true, effectiveFrom: true, effectiveTo: true, status: true, versionNo: true },
      });
      const predecessor = published
        .filter((version) => version.effectiveFrom < draft.effectiveFrom)
        .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
      if (published.length > 0 && !predecessor) throw this.periodOverlap();
      if (predecessor && predecessor.status !== 'ACTIVE') {
        throw this.predecessorInvalid();
      }
      if (
        predecessor &&
        predecessor.effectiveTo &&
        predecessor.effectiveTo < addDays(draft.effectiveFrom, -1)
      ) {
        throw this.predecessorInvalid();
      }
      if (
        published.some(
          (version) =>
            version.id !== predecessor?.id &&
            periodsOverlap(
              version.effectiveFrom,
              version.effectiveTo,
              draft.effectiveFrom,
              draft.effectiveTo,
            ),
        )
      ) {
        throw this.periodOverlap();
      }
      if (predecessor) {
        await transaction.qualificationStandardVersion.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: predecessor.id } },
          data: {
            status: 'SUPERSEDED',
            effectiveTo: addDays(draft.effectiveFrom, -1),
            updatedByMembershipId: context.membershipId,
          },
        });
      }
      await transaction.qualificationStandardVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: draft.id } },
        data: {
          status: 'ACTIVE',
          domainStatus: 'ACTIVE',
          effectiveTo: null,
          updatedByMembershipId: context.membershipId,
        },
      });
      await this.refreshCurrentProjection(transaction, context.agencyId, standardId);
      const result = await this.standardRecord(transaction, context.agencyId, standardId);
      if (!result) throw this.notFound();
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'QUALIFICATION_STANDARD_VERSION_ACTIVATED',
        entityType: 'QualificationStandard',
        entityId: standardId,
        previousStatus: predecessor?.status ?? 'DRAFT',
        newStatus: 'ACTIVE',
        reason: normalizedReason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          versionId: draft.id,
          predecessorId: predecessor?.id ?? null,
          effectiveDate: formatDate(draft.effectiveFrom),
          sourceEvidenceVersionId: source.id,
          approvalEvidenceVersionId: approval.id,
          after: auditStandardData(standardSummary(result, context)),
        },
      });
      return standardSummary(result, context);
    });
  }

  async correct(
    context: RequestContext,
    standardId: string,
    versionId: string,
    rawInput: QualificationStandardCorrectionInput,
  ): Promise<QualificationStandardVersionSummary> {
    this.assertPermission(
      context,
      'qualification.standards.update',
      'QUALIFICATION_STANDARD_UPDATE_FORBIDDEN',
    );
    const reason = rawInput.reason.trim();
    if (!reason) throw this.correctionReasonRequired();
    const input = normalizeRequirements({ ...rawInput, effectiveDate: manilaToday() });
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockStandard(transaction, context.agencyId, standardId);
      const source = await transaction.qualificationStandardVersion.findFirst({
        where: {
          id: versionId,
          agencyId: context.agencyId,
          qualificationStandardId: standardId,
          status: { in: ['ACTIVE', 'SUPERSEDED'] },
        },
        select: versionSelect,
      });
      if (!source) throw this.correctionNotAllowed();
      const existingDraft = await transaction.qualificationStandardVersion.findFirst({
        where: { agencyId: context.agencyId, qualificationStandardId: standardId, status: 'DRAFT' },
        select: { id: true },
      });
      if (existingDraft) throw this.draftConflict();
      const latest = await transaction.qualificationStandardVersion.findFirst({
        where: { agencyId: context.agencyId, qualificationStandardId: standardId },
        orderBy: { versionNo: 'desc' },
        select: { versionNo: true },
      });
      await transaction.qualificationStandardVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: source.id } },
        data: { status: 'VOIDED', updatedByMembershipId: context.membershipId },
      });
      const replacement = await transaction.qualificationStandardVersion.create({
        data: {
          agencyId: context.agencyId,
          qualificationStandardId: standardId,
          versionNo: (latest?.versionNo ?? source.versionNo) + 1,
          educationRequirement: input.educationRequirement,
          trainingHoursRequired:
            input.trainingHoursRequired === null
              ? null
              : new Prisma.Decimal(input.trainingHoursRequired),
          experienceMonthsRequired: input.experienceMonthsRequired,
          eligibilityRequirement: input.eligibilityRequirement,
          competencyRequirements: input.competencyRequirements,
          licenseRequirements: input.licenseRequirements,
          specialRequirements: input.specialRequirements,
          sourceDocumentId: source.sourceDocumentId,
          sourceEvidenceVersionId: source.sourceEvidenceVersionId,
          sourceEvidenceValidatedAt: source.sourceEvidenceValidatedAt,
          sourceEvidenceValidatedByMembershipId: source.sourceEvidenceValidatedByMembershipId,
          sourceEvidenceValidationReason: source.sourceEvidenceValidationReason,
          approvalDocumentId: source.approvalDocumentId,
          approvalEvidenceVersionId: source.approvalEvidenceVersionId,
          approvalEvidenceValidatedAt: source.approvalEvidenceValidatedAt,
          approvalEvidenceValidatedByMembershipId: source.approvalEvidenceValidatedByMembershipId,
          approvalEvidenceValidationReason: source.approvalEvidenceValidationReason,
          effectiveFrom: source.effectiveFrom,
          effectiveTo: source.effectiveTo,
          status: source.status,
          domainStatus: source.domainStatus,
          createdByMembershipId: context.membershipId,
          updatedByMembershipId: context.membershipId,
        },
        select: versionSelect,
      });
      await this.refreshCurrentProjection(transaction, context.agencyId, standardId);
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'QUALIFICATION_STANDARD_VERSION_CORRECTED',
        entityType: 'QualificationStandard',
        entityId: standardId,
        previousStatus: source.status,
        newStatus: replacement.status,
        reason,
        requestId: context.requestId,
        metadata: {
          voidedVersionId: source.id,
          replacementVersionId: replacement.id,
          effectiveDate: formatDate(replacement.effectiveFrom),
          before: auditVersionData(versionSummary(source, context)),
          after: auditVersionData(versionSummary(replacement, context)),
        },
      });
      return versionSummary(replacement, context);
    });
  }

  async assertUsableForAction(
    context: RequestContext,
    versionId: string,
    actionDateValue: string,
  ): Promise<QualificationStandardVersionSummary> {
    this.assertPermission(
      context,
      'qualification.standards.read',
      'QUALIFICATION_STANDARD_READ_FORBIDDEN',
    );
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const result = await this.resolveUsableInTransaction(
        transaction,
        context,
        versionId,
        actionDateValue,
      );
      if (!result.usable) {
        if (result.reason === 'NOT_FOUND') throw this.versionNotFound();
        if (result.reason === 'NOT_EFFECTIVE') {
          throw new QualificationStandardServiceError(
            'The Qualification Standard Version is not effective for this date.',
            409,
            'QUALIFICATION_STANDARD_NOT_EFFECTIVE',
          );
        }
        throw this.evidenceRequired();
      }
      return result.version;
    });
  }

  /**
   * Internal contract: an owning workflow may revalidate a standard inside its
   * transaction without holding Qualification Standard permissions.
   */
  async resolveUsableInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    versionId: string,
    actionDateValue: string,
  ): Promise<
    | { usable: true; version: QualificationStandardVersionSummary }
    | { usable: false; reason: 'NOT_FOUND' | 'NOT_EFFECTIVE' | 'EVIDENCE_REQUIRED' }
  > {
    const actionDate = toDatabaseDate(actionDateValue);
    const version = await transaction.qualificationStandardVersion.findFirst({
      where: {
        id: versionId,
        agencyId: context.agencyId,
        status: { in: ['ACTIVE', 'SUPERSEDED'] },
      },
      select: versionSelect,
    });
    if (!version) return { usable: false, reason: 'NOT_FOUND' };
    if (
      version.effectiveFrom > actionDate ||
      (version.effectiveTo !== null && version.effectiveTo < actionDate)
    ) {
      return { usable: false, reason: 'NOT_EFFECTIVE' };
    }
    const source = await this.validatedEvidence(
      transaction,
      context,
      version.sourceDocumentId,
      version.sourceEvidenceVersionId,
      version.sourceEvidenceValidatedAt,
      version.sourceEvidenceValidationReason,
    );
    const approval = await this.validatedEvidence(
      transaction,
      context,
      version.approvalDocumentId,
      version.approvalEvidenceVersionId,
      version.approvalEvidenceValidatedAt,
      version.approvalEvidenceValidationReason,
    );
    if (!source || !approval) return { usable: false, reason: 'EVIDENCE_REQUIRED' };
    return { usable: true, version: versionSummary(version, context) };
  }

  private async standardRecord(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    standardId: string,
  ): Promise<QualificationStandardRecord | null> {
    return transaction.qualificationStandard.findFirst({
      where: { id: standardId, agencyId },
      select: standardSelect,
    });
  }

  private async latestPublished(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    standardId: string,
  ): Promise<QualificationVersionRecord | null> {
    return transaction.qualificationStandardVersion.findFirst({
      where: {
        agencyId,
        qualificationStandardId: standardId,
        status: { in: ['ACTIVE', 'SUPERSEDED'] },
      },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: versionSelect,
    });
  }

  private async currentPublished(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    standardId: string,
    asOf: Date,
  ): Promise<QualificationVersionRecord | null> {
    return transaction.qualificationStandardVersion.findFirst({
      where: {
        agencyId,
        qualificationStandardId: standardId,
        status: { in: ['ACTIVE', 'SUPERSEDED'] },
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: versionSelect,
    });
  }

  private async refreshCurrentProjection(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    standardId: string,
  ): Promise<void> {
    const current = await this.currentPublished(transaction, agencyId, standardId, todayDate());
    await transaction.qualificationStandard.update({
      where: { agencyId_id: { agencyId, id: standardId } },
      data: {
        status: current?.domainStatus ?? 'INACTIVE',
        currentVersionId: current?.id ?? null,
      },
    });
  }

  private async lockStandard(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    standardId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "qualification_standards" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${standardId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) throw this.notFound();
  }

  private async validatedEvidence(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    documentId: string | null,
    versionId: string | null,
    validatedAt: Date | null,
    validationReason: string | null,
  ): Promise<DocumentSummary | null> {
    if (!documentId || !versionId || !validatedAt || !validationReason) return null;
    const evidenceResult = await this.documentsService.resolveExternalEvidenceInTransaction(
      transaction,
      context,
      {
        documentId,
        versionId,
        allowSensitive: true,
        requirement: 'NOT_VOIDED',
      },
    );
    return evidenceResult.ok ? evidenceResult.document : null;
  }

  private async documentForValidation(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    documentId: string,
  ): Promise<DocumentSummary | null> {
    const evidenceResult = await this.documentsService.resolveExternalEvidenceInTransaction(
      transaction,
      context,
      {
        documentId,
        allowSensitive: hasPermission(context, 'documents.evidence.read_sensitive', {
          agencyId: context.agencyId,
        }),
        requirement: 'NOT_VOIDED',
      },
    );
    if (evidenceResult.ok === false && evidenceResult.reason === 'DOCUMENT_NOT_FOUND') {
      throw this.evidenceNotFound();
    }
    if (evidenceResult.ok === false && evidenceResult.reason === 'SENSITIVE_FORBIDDEN') {
      throw new QualificationStandardServiceError(
        'The current Agency Membership cannot inspect this External Evidence.',
        403,
        'QUALIFICATION_STANDARD_EVIDENCE_SENSITIVE_FORBIDDEN',
      );
    }
    return evidenceResult.ok ? evidenceResult.document : null;
  }

  private assertDocumentReadPermission(context: RequestContext): void {
    this.assertPermission(
      context,
      'documents.evidence.read',
      'QUALIFICATION_STANDARD_EVIDENCE_FORBIDDEN',
    );
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (
      !context.agencyId ||
      !context.userId ||
      !context.membershipId ||
      !hasPermission(context, permission, { agencyId: context.agencyId })
    ) {
      throw new QualificationStandardServiceError(
        'The current Agency Membership lacks the required permission.',
        403,
        code,
      );
    }
  }

  private metadataString(value: Prisma.JsonValue, key: string): string | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const item = value[key];
    return typeof item === 'string' ? item : null;
  }

  private codeConflict(): QualificationStandardServiceError {
    return new QualificationStandardServiceError(
      'A Qualification Standard with this Agency code already exists.',
      409,
      'QUALIFICATION_STANDARD_CODE_CONFLICT',
    );
  }

  private nameConflict(): QualificationStandardServiceError {
    return new QualificationStandardServiceError(
      'A Qualification Standard with this Agency name already exists.',
      409,
      'QUALIFICATION_STANDARD_NAME_CONFLICT',
    );
  }

  private draftConflict(): QualificationStandardServiceError {
    return new QualificationStandardServiceError(
      'The Draft Qualification Standard changed or already exists. Reload and try again.',
      409,
      'QUALIFICATION_STANDARD_DRAFT_CONFLICT',
    );
  }

  private draftNotFound(): QualificationStandardServiceError {
    return new QualificationStandardServiceError(
      'The Draft Qualification Standard Version could not be found.',
      404,
      'QUALIFICATION_STANDARD_DRAFT_NOT_FOUND',
    );
  }

  private notFound(): QualificationStandardServiceError {
    return new QualificationStandardServiceError(
      'The Qualification Standard could not be found.',
      404,
      'QUALIFICATION_STANDARD_NOT_FOUND',
    );
  }

  private versionNotFound(): QualificationStandardServiceError {
    return new QualificationStandardServiceError(
      'The Qualification Standard Version could not be found.',
      404,
      'QUALIFICATION_STANDARD_VERSION_NOT_FOUND',
    );
  }

  private successorNotAllowed(): QualificationStandardServiceError {
    return new QualificationStandardServiceError(
      'Only an activated Qualification Standard can have a successor.',
      409,
      'QUALIFICATION_STANDARD_SUCCESSOR_NOT_ALLOWED',
    );
  }

  private predecessorInvalid(): QualificationStandardServiceError {
    return new QualificationStandardServiceError(
      'The successor date does not follow the current Qualification Standard period.',
      409,
      'QUALIFICATION_STANDARD_PREDECESSOR_INVALID',
    );
  }

  private periodOverlap(): QualificationStandardServiceError {
    return new QualificationStandardServiceError(
      'Qualification Standard effective periods cannot overlap.',
      409,
      'QUALIFICATION_STANDARD_PERIOD_OVERLAP',
    );
  }

  private evidenceReasonRequired(): QualificationStandardServiceError {
    return new QualificationStandardServiceError(
      'A reason for External Evidence validation is required.',
      400,
      'QUALIFICATION_STANDARD_EVIDENCE_REASON_REQUIRED',
    );
  }

  private evidenceRequired(): QualificationStandardServiceError {
    return new QualificationStandardServiceError(
      'Source and approval External Evidence are required before activation.',
      409,
      'QUALIFICATION_STANDARD_EVIDENCE_REQUIRED',
    );
  }

  private evidenceInvalid(): QualificationStandardServiceError {
    return new QualificationStandardServiceError(
      'The selected External Evidence must have a usable version and cannot be voided.',
      409,
      'QUALIFICATION_STANDARD_EVIDENCE_INVALID',
    );
  }

  private evidenceNotFound(): QualificationStandardServiceError {
    return new QualificationStandardServiceError(
      'The External Evidence could not be found in this Agency Context.',
      404,
      'QUALIFICATION_STANDARD_EVIDENCE_NOT_FOUND',
    );
  }

  private activationReasonRequired(): QualificationStandardServiceError {
    return new QualificationStandardServiceError(
      'A reason for Qualification Standard activation is required.',
      400,
      'QUALIFICATION_STANDARD_ACTIVATION_REASON_REQUIRED',
    );
  }

  private correctionReasonRequired(): QualificationStandardServiceError {
    return new QualificationStandardServiceError(
      'A reason for the Qualification Standard correction is required.',
      400,
      'QUALIFICATION_STANDARD_CORRECTION_REASON_REQUIRED',
    );
  }

  private correctionNotAllowed(): QualificationStandardServiceError {
    return new QualificationStandardServiceError(
      'Only an activated Qualification Standard Version can be corrected.',
      409,
      'QUALIFICATION_STANDARD_CORRECTION_NOT_ALLOWED',
    );
  }

  private idempotencyConflict(): QualificationStandardServiceError {
    return new QualificationStandardServiceError(
      'The Idempotency-Key was already used for a different Qualification Standard request.',
      409,
      'QUALIFICATION_STANDARD_IDEMPOTENCY_CONFLICT',
    );
  }
}
