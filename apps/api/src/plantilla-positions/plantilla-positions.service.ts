import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { DocumentsService } from '../documents/documents.service';

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

export type PlantillaPositionVersionState = (typeof PLANTILLA_POSITION_VERSION_STATES)[number];
export type PlantillaPositionLifecycleStatus =
  (typeof PLANTILLA_POSITION_LIFECYCLE_STATUSES)[number];
export type PlantillaPositionEmploymentCategory =
  (typeof PLANTILLA_POSITION_EMPLOYMENT_CATEGORIES)[number];

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

export interface PlantillaPositionDetail {
  position: PlantillaPositionSummary;
  asOf: string;
  effective: PlantillaPositionVersionSummary | null;
  versions: PlantillaPositionVersionSummary[];
  history: PlantillaPositionHistoryEntry[];
}

export interface PlantillaPositionSuccessor {
  current: PlantillaPositionVersionSummary;
  draft: PlantillaPositionVersionSummary;
}

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
      currentVersion: { select: { name: true } },
    },
  },
  qualificationStandardVersion: {
    select: {
      id: true,
      versionNo: true,
      effectiveFrom: true,
      effectiveTo: true,
      qualificationStandard: { select: { code: true, name: true } },
    },
  },
  staffingAuthority: {
    select: {
      id: true,
      referenceNo: true,
      authorityType: true,
      effectiveDate: true,
    },
  },
} as const;

const positionVersionStates = ['DRAFT', 'ACTIVE', 'SUPERSEDED', 'VOIDED'];
const PLANTILLA_POSITION_LIST_LIMIT = 200;
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

type PositionRecord = Prisma.PlantillaPositionGetPayload<{ select: typeof positionSelect }>;
type VersionRecord = Prisma.PlantillaPositionVersionGetPayload<{ select: typeof versionSelect }>;

function databaseContext(context: RequestContext, transition = false) {
  return {
    agencyId: context.agencyId,
    userId: context.userId,
    membershipId: context.membershipId,
    ...(transition ? { plantillaPositionTransition: true } : {}),
  };
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
    const evidence = await this.documentsService.findEvidenceForAuthorityInTransaction(
      transaction,
      context,
      authority.documentId,
      authority.evidenceVersionId,
    );
    if (!evidence || evidence.status === 'VOIDED' || !evidence.currentVersion) {
      throw this.staffingAuthorityEvidenceRequired();
    }
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
}
