import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import {
  coverageEligibleParentIds,
  hasEligibleParentCoverage,
  wouldCreateHierarchyCycle,
} from './organization.queries';

export const ORGANIZATION_UNIT_TYPES = [
  'DEPARTMENT',
  'BUREAU',
  'SERVICE',
  'DIVISION',
  'SECTION',
  'OFFICE',
  'OTHER',
] as const;

export type OrganizationUnitType = (typeof ORGANIZATION_UNIT_TYPES)[number];

export interface CreateOrganizationUnitInput {
  officialName: string;
  code: string;
  unitType: OrganizationUnitType;
  effectiveDate: string;
  costCenterCode?: string | null | undefined;
  responsibilityCenterCode?: string | null | undefined;
}

export interface ActivateOrganizationUnitInput {
  parentUnitId: string | null;
  reason: string;
  idempotencyKey?: string | undefined;
}

export interface UpdateOrganizationUnitDraftInput {
  officialName: string;
  parentUnitId: string | null;
  headPositionId?: string | null | undefined;
  costCenterCode: string | null;
  responsibilityCenterCode: string | null;
  effectiveDate: string;
}

export interface ActivateOrganizationUnitSuccessorInput {
  reason: string;
  authorityReference?: string | null | undefined;
  migrationPlan?: string | null | undefined;
  idempotencyKey?: string | undefined;
}

export interface OrganizationUnitCorrectionInput extends Omit<
  UpdateOrganizationUnitDraftInput,
  'effectiveDate' | 'headPositionId'
> {
  reason: string;
}

export interface OrganizationUnitTransitionInput {
  effectiveDate: string;
  reason: string;
  authorityReference?: string | null | undefined;
  migrationPlan?: string | null | undefined;
  idempotencyKey?: string | undefined;
}

export type OrganizationUnitVersionState = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' | 'VOIDED';
export type OrganizationUnitLifecycleStatus = 'ACTIVE' | 'INACTIVE' | 'ABOLISHED';

export interface OrganizationUnitSummary {
  id: string;
  code: string;
  officialName: string;
  unitType: OrganizationUnitType;
  effectiveDate: string;
  effectiveTo: string | null;
  parentUnitId: string | null;
  versionState: OrganizationUnitVersionState;
  lifecycleStatus: OrganizationUnitLifecycleStatus;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ABOLISHED';
}

export interface OrganizationUnitList {
  units: OrganizationUnitSummary[];
  drafts?: OrganizationUnitVersionSummary[];
}

export interface OrganizationUnitVersionSummary {
  id: string;
  organizationUnitId: string;
  versionNo: number;
  code: string;
  unitType: OrganizationUnitType;
  officialName: string;
  parentUnitId: string | null;
  headPositionId: string | null;
  costCenterCode: string | null;
  responsibilityCenterCode: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  versionState: OrganizationUnitVersionState;
  lifecycleStatus: OrganizationUnitLifecycleStatus;
}

export interface OrganizationUnitSuccessor {
  current: OrganizationUnitVersionSummary;
  draft: OrganizationUnitVersionSummary;
}

export interface OrganizationUnitTransition {
  id: string;
  action: string;
  previousStatus: string;
  newStatus: string;
  actorDisplayName: string | null;
  reason: string | null;
  effectiveDate: string | null;
  authorityReference: string | null;
  migrationPlan: string | null;
  before: Prisma.JsonValue;
  after: Prisma.JsonValue;
  occurredAt: string;
}

export interface OrganizationUnitHistory {
  unit: {
    id: string;
    code: string;
    unitType: OrganizationUnitType;
  };
  asOf: string;
  effective: OrganizationUnitVersionSummary | null;
  current: OrganizationUnitVersionSummary | null;
  draft: OrganizationUnitVersionSummary | null;
  versions: OrganizationUnitVersionSummary[];
  transitions: OrganizationUnitTransition[];
}

export interface OrganizationHierarchyUnit {
  id: string;
  code: string;
  officialName: string;
  unitType: OrganizationUnitType;
  parentUnitId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  lifecycleStatus: OrganizationUnitLifecycleStatus;
  childCount: number;
}

export interface OrganizationHierarchy {
  asOf: string;
  units: OrganizationHierarchyUnit[];
  eligibleParentIds: string[];
}

export class OrganizationServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'OrganizationServiceError';
  }
}

export interface OrganizationAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const ORGANIZATION_AUDIT_WRITER = Symbol('ORGANIZATION_AUDIT_WRITER');

export const organizationAuditWriter: OrganizationAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};

const DRAFT_STATUS = 'DRAFT' as const;
const ACTIVE_STATUS = 'ACTIVE' as const;
const PUBLISHED_STATES = [ACTIVE_STATUS, 'SUPERSEDED'] as const;
const ORGANIZATION_UNIT_LIST_LIMIT = 100;

const unitVersionSelect = {
  id: true,
  organizationUnitId: true,
  versionNo: true,
  name: true,
  parentUnitId: true,
  headPositionId: true,
  costCenterCode: true,
  responsibilityCenterCode: true,
  effectiveFrom: true,
  effectiveTo: true,
  status: true,
  domainStatus: true,
  organizationUnit: { select: { code: true, unitType: true } },
} as const;

type OrganizationUnitVersionRecord = Prisma.OrganizationUnitVersionGetPayload<{
  select: typeof unitVersionSelect;
}>;

function toDatabaseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new OrganizationServiceError(
      'The effective date is invalid.',
      400,
      'ORGANIZATION_UNIT_EFFECTIVE_DATE_INVALID',
    );
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new OrganizationServiceError(
      'The effective date is invalid.',
      400,
      'ORGANIZATION_UNIT_EFFECTIVE_DATE_INVALID',
    );
  }
  return date;
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
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

function normalizeOptional(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeIdempotencyKey(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    throw new OrganizationServiceError(
      'The Idempotency-Key is invalid.',
      400,
      'INVALID_IDEMPOTENCY_KEY',
    );
  }
  return normalized;
}

function toDatabaseContext(context: RequestContext) {
  return {
    agencyId: context.agencyId,
    userId: context.userId,
    membershipId: context.membershipId,
  };
}

function summaryFromRecord(record: {
  id: string;
  code: string;
  unitType: string;
  status: string;
  currentVersion: {
    name: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    parentUnitId: string | null;
    status: string;
    domainStatus: string;
  } | null;
}): OrganizationUnitSummary {
  return {
    id: record.id,
    code: record.code,
    officialName: record.currentVersion?.name ?? '',
    unitType: record.unitType as OrganizationUnitType,
    effectiveDate: record.currentVersion ? formatDate(record.currentVersion.effectiveFrom) : '',
    effectiveTo: record.currentVersion?.effectiveTo
      ? formatDate(record.currentVersion.effectiveTo)
      : null,
    parentUnitId: record.currentVersion?.parentUnitId ?? null,
    versionState: (record.currentVersion?.status ?? DRAFT_STATUS) as OrganizationUnitVersionState,
    lifecycleStatus: (record.currentVersion?.domainStatus ??
      ACTIVE_STATUS) as OrganizationUnitLifecycleStatus,
    status: record.status as OrganizationUnitSummary['status'],
  };
}

function auditData(unit: OrganizationUnitSummary) {
  return {
    officialName: unit.officialName,
    code: unit.code,
    unitType: unit.unitType,
    effectiveDate: unit.effectiveDate,
    parentUnitId: unit.parentUnitId,
    versionState: unit.versionState,
    lifecycleStatus: unit.lifecycleStatus,
  };
}

function versionAuditData(version: OrganizationUnitVersionSummary) {
  return {
    officialName: version.officialName,
    code: version.code,
    unitType: version.unitType,
    parentUnitId: version.parentUnitId,
    headPositionId: version.headPositionId,
    costCenterCode: version.costCenterCode,
    responsibilityCenterCode: version.responsibilityCenterCode,
    effectiveFrom: version.effectiveFrom,
    effectiveTo: version.effectiveTo,
    versionState: version.versionState,
    lifecycleStatus: version.lifecycleStatus,
  };
}

function versionSummaryFromRecord(
  record: OrganizationUnitVersionRecord,
): OrganizationUnitVersionSummary {
  return {
    id: record.id,
    organizationUnitId: record.organizationUnitId,
    versionNo: record.versionNo,
    code: record.organizationUnit.code,
    unitType: record.organizationUnit.unitType as OrganizationUnitType,
    officialName: record.name,
    parentUnitId: record.parentUnitId,
    headPositionId: record.headPositionId,
    costCenterCode: record.costCenterCode,
    responsibilityCenterCode: record.responsibilityCenterCode,
    effectiveFrom: formatDate(record.effectiveFrom),
    effectiveTo: record.effectiveTo ? formatDate(record.effectiveTo) : null,
    versionState: record.status as OrganizationUnitVersionState,
    lifecycleStatus: record.domainStatus as OrganizationUnitLifecycleStatus,
  };
}

function metadataObject(metadata: Prisma.JsonValue): Prisma.JsonObject {
  return typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
    ? metadata
    : {};
}

function metadataString(metadata: Prisma.JsonValue, key: string): string | null {
  const value = metadataObject(metadata)[key];
  return typeof value === 'string' ? value : null;
}

function metadataData(metadata: Prisma.JsonValue, key: string): Prisma.JsonValue {
  return metadataObject(metadata)[key] ?? null;
}

function periodsOverlap(
  leftStart: Date,
  leftEnd: Date | null,
  rightStart: Date,
  rightEnd: Date | null,
): boolean {
  return (
    leftStart <= (rightEnd ?? new Date('9999-12-31T00:00:00.000Z')) &&
    rightStart <= (leftEnd ?? new Date('9999-12-31T00:00:00.000Z'))
  );
}

function transitionAuditAction(
  before: OrganizationUnitLifecycleStatus,
  after: OrganizationUnitLifecycleStatus,
): string {
  if (after === 'ABOLISHED') return 'ORGANIZATION_UNIT_ABOLISHED';
  if (before === ACTIVE_STATUS && after === 'INACTIVE') {
    return 'ORGANIZATION_UNIT_INACTIVATED';
  }
  if (before === 'INACTIVE' && after === ACTIVE_STATUS) {
    return 'ORGANIZATION_UNIT_REACTIVATED';
  }
  return 'ORGANIZATION_UNIT_CHANGED';
}

function activationParentFromMetadata(metadata: Prisma.JsonValue): string | null | undefined {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))
    return undefined;
  const value = metadata.activationParentUnitId;
  return typeof value === 'string' || value === null ? value : undefined;
}

async function completedIdempotentActivation(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  unitId: string,
  idempotencyKey: string,
  parentUnitId: string | null,
  reason: string,
): Promise<OrganizationUnitSummary | null> {
  const event = await transaction.auditEvent.findFirst({
    where: {
      agencyId,
      action: 'ORGANIZATION_UNIT_ACTIVATED',
      entityId: unitId,
      idempotencyKey,
    },
    select: { reason: true, metadata: true },
  });
  if (!event) return null;
  if (event.reason !== reason || activationParentFromMetadata(event.metadata) !== parentUnitId) {
    throw new OrganizationServiceError(
      'The Idempotency-Key was already used for a different activation request.',
      409,
      'ORGANIZATION_UNIT_IDEMPOTENCY_CONFLICT',
    );
  }
  const unit = await transaction.organizationUnit.findFirst({
    where: { id: unitId, agencyId, status: ACTIVE_STATUS },
    include: { currentVersion: true },
  });
  if (!unit || unit.currentVersion?.status !== ACTIVE_STATUS) {
    throw new OrganizationServiceError(
      'The prior activation result is no longer available.',
      409,
      'ORGANIZATION_UNIT_IDEMPOTENCY_CONFLICT',
    );
  }
  return summaryFromRecord(unit);
}

async function completedIdempotentTransition(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  unitId: string,
  idempotencyKey: string,
  reason: string,
  authorityReference: string | null,
  migrationPlan: string | null,
): Promise<OrganizationUnitSummary | null> {
  const event = await transaction.auditEvent.findFirst({
    where: {
      agencyId,
      entityId: unitId,
      idempotencyKey,
      action: {
        in: [
          'ORGANIZATION_UNIT_CHANGED',
          'ORGANIZATION_UNIT_INACTIVATED',
          'ORGANIZATION_UNIT_REACTIVATED',
          'ORGANIZATION_UNIT_ABOLISHED',
        ],
      },
    },
    select: { reason: true, metadata: true },
  });
  if (!event) return null;
  if (
    event.reason !== reason ||
    metadataString(event.metadata, 'authorityReference') !== authorityReference ||
    metadataString(event.metadata, 'migrationPlan') !== migrationPlan
  ) {
    throw new OrganizationServiceError(
      'The Idempotency-Key was already used for a different Organization Unit transition.',
      409,
      'ORGANIZATION_UNIT_IDEMPOTENCY_CONFLICT',
    );
  }
  const versionId = metadataString(event.metadata, 'versionId');
  const version = versionId
    ? await transaction.organizationUnitVersion.findFirst({
        where: { agencyId, id: versionId },
        select: unitVersionSelect,
      })
    : null;
  if (!version || version.status !== ACTIVE_STATUS) {
    throw new OrganizationServiceError(
      'The prior Organization Unit transition result is no longer available.',
      409,
      'ORGANIZATION_UNIT_IDEMPOTENCY_CONFLICT',
    );
  }
  return summaryFromRecord({
    id: unitId,
    code: version.organizationUnit.code,
    unitType: version.organizationUnit.unitType,
    status: version.domainStatus,
    currentVersion: version,
  });
}

@Injectable()
export class OrganizationService {
  constructor(
    @Inject(ORGANIZATION_AUDIT_WRITER)
    private readonly auditWriter: OrganizationAuditWriter,
  ) {}

  async list(context: RequestContext): Promise<OrganizationUnitList> {
    this.assertPermission(context, 'organization.units.read', 'ORGANIZATION_UNIT_READ_FORBIDDEN');
    return withDatabaseContext(toDatabaseContext(context), async (transaction) => {
      const records = await transaction.organizationUnit.findMany({
        where: { agencyId: context.agencyId },
        orderBy: [{ createdAt: 'desc' }, { code: 'asc' }],
        take: ORGANIZATION_UNIT_LIST_LIMIT,
        select: {
          id: true,
          code: true,
          unitType: true,
          status: true,
          currentVersion: {
            select: {
              name: true,
              effectiveFrom: true,
              effectiveTo: true,
              parentUnitId: true,
              status: true,
              domainStatus: true,
            },
          },
        },
      });
      const publishedUnitIds = records
        .filter((record) => record.status !== DRAFT_STATUS)
        .map((record) => record.id);
      const effectiveVersions = publishedUnitIds.length
        ? await transaction.organizationUnitVersion.findMany({
            where: {
              agencyId: context.agencyId,
              organizationUnitId: { in: publishedUnitIds },
              status: { in: [...PUBLISHED_STATES] },
              effectiveFrom: { lte: todayDate() },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: todayDate() } }],
            },
            orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
            select: unitVersionSelect,
          })
        : [];
      const effectiveVersionByUnitId = new Map<string, OrganizationUnitVersionRecord>();
      for (const version of effectiveVersions) {
        if (!effectiveVersionByUnitId.has(version.organizationUnitId)) {
          effectiveVersionByUnitId.set(version.organizationUnitId, version);
        }
      }
      const successorUnitIds = records
        .filter((record) => record.status !== DRAFT_STATUS)
        .map((record) => record.id);
      const draftRecords = successorUnitIds.length
        ? await transaction.organizationUnitVersion.findMany({
            where: {
              agencyId: context.agencyId,
              organizationUnitId: { in: successorUnitIds },
              status: DRAFT_STATUS,
            },
            select: unitVersionSelect,
            orderBy: { versionNo: 'desc' },
          })
        : [];
      const units = records.map((record) => {
        const currentVersion =
          record.status === DRAFT_STATUS
            ? record.currentVersion
            : (effectiveVersionByUnitId.get(record.id) ?? record.currentVersion);
        return summaryFromRecord({
          ...record,
          status:
            record.status === DRAFT_STATUS
              ? DRAFT_STATUS
              : (currentVersion?.domainStatus ?? record.status),
          currentVersion,
        });
      });
      const drafts = draftRecords.map(versionSummaryFromRecord);
      return drafts.length ? { units, drafts } : { units };
    });
  }

  async findById(context: RequestContext, id: string): Promise<OrganizationUnitSummary | null> {
    this.assertPermission(context, 'organization.units.read', 'ORGANIZATION_UNIT_READ_FORBIDDEN');
    return withDatabaseContext(toDatabaseContext(context), async (transaction) => {
      const record = await transaction.organizationUnit.findFirst({
        where: { id, agencyId: context.agencyId },
        include: {
          currentVersion: {
            select: {
              name: true,
              effectiveFrom: true,
              effectiveTo: true,
              parentUnitId: true,
              status: true,
              domainStatus: true,
            },
          },
        },
      });
      if (!record) return null;
      const currentVersion =
        record.status === DRAFT_STATUS
          ? record.currentVersion
          : await this.currentPublished(transaction, context.agencyId, id, todayDate());
      return summaryFromRecord({
        ...record,
        status:
          record.status === DRAFT_STATUS
            ? DRAFT_STATUS
            : (currentVersion?.domainStatus ?? record.status),
        currentVersion,
      });
    });
  }

  async create(
    context: RequestContext,
    input: CreateOrganizationUnitInput,
  ): Promise<OrganizationUnitSummary> {
    this.assertPermission(
      context,
      'organization.units.create',
      'ORGANIZATION_UNIT_CREATE_FORBIDDEN',
    );
    const officialName = input.officialName.trim();
    const code = input.code.trim();
    const effectiveFrom = toDatabaseDate(input.effectiveDate);
    const costCenterCode = normalizeOptional(input.costCenterCode);
    const responsibilityCenterCode = normalizeOptional(input.responsibilityCenterCode);

    try {
      return await withDatabaseContext(toDatabaseContext(context), async (transaction) => {
        const now = new Date();
        const unit = await transaction.organizationUnit.create({
          data: {
            agencyId: context.agencyId,
            code,
            unitType: input.unitType,
            status: DRAFT_STATUS,
          },
        });
        const version = await transaction.organizationUnitVersion.create({
          data: {
            agencyId: context.agencyId,
            organizationUnitId: unit.id,
            versionNo: 1,
            name: officialName,
            costCenterCode,
            responsibilityCenterCode,
            effectiveFrom,
            status: DRAFT_STATUS,
            domainStatus: ACTIVE_STATUS,
          },
        });
        await transaction.organizationUnit.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: unit.id } },
          data: { currentVersionId: version.id },
        });
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'ORGANIZATION_UNIT_CREATED',
          entityType: 'OrganizationUnit',
          entityId: unit.id,
          previousStatus: 'None',
          newStatus: DRAFT_STATUS,
          requestId: context.requestId,
          occurredAt: now,
          metadata: {
            officialName,
            code,
            unitType: input.unitType,
            effectiveDate: input.effectiveDate,
            costCenterCode,
            responsibilityCenterCode,
          },
        });
        return {
          id: unit.id,
          code,
          officialName,
          unitType: input.unitType,
          effectiveDate: input.effectiveDate,
          effectiveTo: null,
          parentUnitId: null,
          versionState: DRAFT_STATUS,
          lifecycleStatus: ACTIVE_STATUS,
          status: DRAFT_STATUS,
        };
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new OrganizationServiceError(
          'An Organization Unit with this code already exists in the active Agency.',
          409,
          'ORGANIZATION_UNIT_CODE_CONFLICT',
        );
      }
      throw error;
    }
  }

  async hierarchy(
    context: RequestContext,
    asOf: string,
    parentForUnitId?: string,
  ): Promise<OrganizationHierarchy> {
    this.assertPermission(context, 'organization.units.read', 'ORGANIZATION_UNIT_READ_FORBIDDEN');
    const date = toDatabaseDate(asOf);
    return withDatabaseContext(toDatabaseContext(context), async (transaction) => {
      const records = await transaction.organizationUnitVersion.findMany({
        where: {
          agencyId: context.agencyId,
          status: { in: [...PUBLISHED_STATES] },
          effectiveFrom: { lte: date },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
        },
        orderBy: [{ name: 'asc' }, { organizationUnitId: 'asc' }],
        select: {
          organizationUnitId: true,
          name: true,
          parentUnitId: true,
          effectiveFrom: true,
          effectiveTo: true,
          domainStatus: true,
          organizationUnit: { select: { code: true, unitType: true } },
        },
      });
      const childCounts = new Map<string, number>();
      for (const record of records) {
        if (record.parentUnitId) {
          childCounts.set(record.parentUnitId, (childCounts.get(record.parentUnitId) ?? 0) + 1);
        }
      }
      let parentIds: string[] = [];
      if (parentForUnitId) {
        const target = await transaction.organizationUnit.findFirst({
          where: { id: parentForUnitId, agencyId: context.agencyId },
          select: {
            status: true,
            currentVersion: { select: { status: true, effectiveFrom: true, effectiveTo: true } },
          },
        });
        if (target) {
          const targetVersion = target.currentVersion;
          const targetIsInitialDraft =
            target.status === DRAFT_STATUS && targetVersion?.status === DRAFT_STATUS;
          parentIds = await coverageEligibleParentIds(
            transaction,
            context.agencyId,
            parentForUnitId,
            targetIsInitialDraft && targetVersion ? targetVersion.effectiveFrom : date,
            targetIsInitialDraft && targetVersion ? targetVersion.effectiveTo : null,
          );
        }
      }
      return {
        asOf,
        eligibleParentIds: parentIds,
        units: records.map((record) => ({
          id: record.organizationUnitId,
          code: record.organizationUnit.code,
          officialName: record.name,
          unitType: record.organizationUnit.unitType as OrganizationUnitType,
          parentUnitId: record.parentUnitId,
          effectiveFrom: formatDate(record.effectiveFrom),
          effectiveTo: record.effectiveTo ? formatDate(record.effectiveTo) : null,
          lifecycleStatus: record.domainStatus as OrganizationUnitLifecycleStatus,
          childCount: childCounts.get(record.organizationUnitId) ?? 0,
        })),
      };
    });
  }

  async activate(
    context: RequestContext,
    id: string,
    input: ActivateOrganizationUnitInput,
  ): Promise<OrganizationUnitSummary> {
    this.assertPermission(
      context,
      'organization.units.activate',
      'ORGANIZATION_UNIT_ACTIVATE_FORBIDDEN',
    );
    const reason = input.reason.trim();
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!reason) {
      throw new OrganizationServiceError(
        'An activation reason is required.',
        400,
        'ORGANIZATION_UNIT_ACTIVATION_REASON_REQUIRED',
      );
    }
    if (input.idempotencyKey !== undefined && (!idempotencyKey || idempotencyKey.length > 200)) {
      throw new OrganizationServiceError(
        'The Idempotency-Key is invalid.',
        400,
        'INVALID_IDEMPOTENCY_KEY',
      );
    }

    return withDatabaseContext(toDatabaseContext(context), async (transaction) => {
      const unit = await transaction.organizationUnit.findFirst({
        where: { id, agencyId: context.agencyId },
        include: { currentVersion: true },
      });
      if (!unit) {
        throw new OrganizationServiceError(
          'The Organization Unit could not be found.',
          404,
          'ORGANIZATION_UNIT_NOT_FOUND',
        );
      }
      if (idempotencyKey) {
        const completed = await completedIdempotentActivation(
          transaction,
          context.agencyId,
          id,
          idempotencyKey,
          input.parentUnitId,
          reason,
        );
        if (completed) return completed;
      }
      const draft = unit.currentVersion;
      if (unit.status !== DRAFT_STATUS || draft?.status !== DRAFT_STATUS) {
        throw new OrganizationServiceError(
          'Only a Draft Organization Unit can be activated.',
          409,
          'ORGANIZATION_UNIT_NOT_DRAFT',
        );
      }
      if (
        !unit.code.trim() ||
        !draft.name.trim() ||
        !ORGANIZATION_UNIT_TYPES.includes(unit.unitType as OrganizationUnitType)
      ) {
        throw new OrganizationServiceError(
          'The Draft Organization Unit is incomplete.',
          409,
          'ORGANIZATION_UNIT_INCOMPLETE',
        );
      }
      if (formatDate(draft.effectiveFrom) > manilaToday()) {
        throw new OrganizationServiceError(
          'The Organization Unit can be activated on or after its effective date.',
          409,
          'ORGANIZATION_UNIT_NOT_EFFECTIVE',
        );
      }
      if (input.parentUnitId === id) {
        throw new OrganizationServiceError(
          'An Organization Unit cannot report to itself.',
          409,
          'ORGANIZATION_UNIT_HIERARCHY_CYCLE',
        );
      }

      if (input.parentUnitId) {
        if (
          !(await hasEligibleParentCoverage(
            transaction,
            context.agencyId,
            input.parentUnitId,
            draft.effectiveFrom,
            draft.effectiveTo,
          ))
        ) {
          throw new OrganizationServiceError(
            'Choose a parent that remains active throughout the affected effective period.',
            422,
            'ORGANIZATION_UNIT_PARENT_INVALID',
          );
        }

        if (
          await wouldCreateHierarchyCycle(
            transaction,
            context.agencyId,
            id,
            input.parentUnitId,
            draft.effectiveFrom,
            draft.effectiveTo,
          )
        ) {
          throw new OrganizationServiceError(
            'This parent would create a cycle in the effective Organization hierarchy.',
            409,
            'ORGANIZATION_UNIT_HIERARCHY_CYCLE',
          );
        }
      }

      const before = summaryFromRecord({ ...unit, currentVersion: draft });
      const activatedCount = await transaction.organizationUnitVersion.updateMany({
        where: { id: draft.id, agencyId: context.agencyId, status: DRAFT_STATUS },
        data: {
          parentUnitId: input.parentUnitId,
          status: ACTIVE_STATUS,
          domainStatus: ACTIVE_STATUS,
        },
      });
      if (activatedCount.count !== 1) {
        if (idempotencyKey) {
          const completed = await completedIdempotentActivation(
            transaction,
            context.agencyId,
            id,
            idempotencyKey,
            input.parentUnitId,
            reason,
          );
          if (completed) return completed;
        }
        throw new OrganizationServiceError(
          'Only a Draft Organization Unit can be activated.',
          409,
          'ORGANIZATION_UNIT_NOT_DRAFT',
        );
      }
      const updated = await transaction.organizationUnit.update({
        where: { agencyId_id: { agencyId: context.agencyId, id } },
        data: { status: ACTIVE_STATUS, currentVersionId: draft.id },
        include: { currentVersion: true },
      });
      const activated = summaryFromRecord(updated);
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'ORGANIZATION_UNIT_ACTIVATED',
        entityType: 'OrganizationUnit',
        entityId: id,
        previousStatus: DRAFT_STATUS,
        newStatus: ACTIVE_STATUS,
        reason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          versionId: draft.id,
          effectiveDate: activated.effectiveDate,
          activationParentUnitId: input.parentUnitId,
          before: auditData(before),
          after: auditData(activated),
        },
      });
      return activated;
    });
  }

  async createSuccessor(context: RequestContext, id: string): Promise<OrganizationUnitSuccessor> {
    this.assertPermission(
      context,
      'organization.units.update',
      'ORGANIZATION_UNIT_UPDATE_FORBIDDEN',
    );
    return withDatabaseContext(toDatabaseContext(context), async (transaction) => {
      if (!(await this.lockOrganizationUnit(transaction, context.agencyId, id))) {
        throw this.unitNotFound();
      }
      const unit = await transaction.organizationUnit.findFirst({
        where: { id, agencyId: context.agencyId },
        select: { id: true, status: true },
      });
      if (!unit) throw this.unitNotFound();
      if (unit.status === DRAFT_STATUS || unit.status === 'ABOLISHED') {
        throw new OrganizationServiceError(
          'Only an active or inactive Organization Unit can have a successor.',
          409,
          'ORGANIZATION_UNIT_SUCCESSOR_NOT_ALLOWED',
        );
      }

      const current = await this.latestPublished(transaction, context.agencyId, id);
      if (
        !current ||
        current.status !== ACTIVE_STATUS ||
        ![ACTIVE_STATUS, 'INACTIVE'].includes(
          current.domainStatus as OrganizationUnitLifecycleStatus,
        )
      ) {
        throw new OrganizationServiceError(
          'The current Organization Unit version cannot have a successor.',
          409,
          'ORGANIZATION_UNIT_SUCCESSOR_NOT_ALLOWED',
        );
      }

      const existingDraft = await transaction.organizationUnitVersion.findFirst({
        where: { agencyId: context.agencyId, organizationUnitId: id, status: DRAFT_STATUS },
        select: unitVersionSelect,
      });
      if (existingDraft) {
        return {
          current: versionSummaryFromRecord(current),
          draft: versionSummaryFromRecord(existingDraft),
        };
      }

      const effectiveFrom = new Date(
        Math.max(addDays(current.effectiveFrom, 1).getTime(), addDays(todayDate(), 1).getTime()),
      );
      const draft = await transaction.organizationUnitVersion.create({
        data: {
          agencyId: context.agencyId,
          organizationUnitId: id,
          versionNo: current.versionNo + 1,
          name: current.name,
          parentUnitId: current.parentUnitId,
          headPositionId: current.headPositionId,
          costCenterCode: current.costCenterCode,
          responsibilityCenterCode: current.responsibilityCenterCode,
          effectiveFrom,
          status: DRAFT_STATUS,
          domainStatus: current.domainStatus,
        },
        select: unitVersionSelect,
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'ORGANIZATION_UNIT_SUCCESSOR_CREATED',
        entityType: 'OrganizationUnit',
        entityId: id,
        previousStatus: current.domainStatus,
        newStatus: DRAFT_STATUS,
        requestId: context.requestId,
        metadata: {
          versionId: draft.id,
          predecessorId: current.id,
          before: versionAuditData(versionSummaryFromRecord(current)),
          after: versionAuditData(versionSummaryFromRecord(draft)),
        },
      });
      return {
        current: versionSummaryFromRecord(current),
        draft: versionSummaryFromRecord(draft),
      };
    });
  }

  async updateDraft(
    context: RequestContext,
    unitId: string,
    draftId: string,
    input: UpdateOrganizationUnitDraftInput,
  ): Promise<OrganizationUnitVersionSummary> {
    this.assertPermission(
      context,
      'organization.units.update',
      'ORGANIZATION_UNIT_UPDATE_FORBIDDEN',
    );
    const officialName = input.officialName.trim();
    const effectiveFrom = toDatabaseDate(input.effectiveDate);
    if (!officialName) {
      throw new OrganizationServiceError(
        'An official Organization Unit name is required.',
        400,
        'ORGANIZATION_UNIT_NAME_REQUIRED',
      );
    }
    const costCenterCode = normalizeOptional(input.costCenterCode);
    const responsibilityCenterCode = normalizeOptional(input.responsibilityCenterCode);

    return withDatabaseContext(toDatabaseContext(context), async (transaction) => {
      if (!(await this.lockOrganizationUnit(transaction, context.agencyId, unitId))) {
        throw this.unitNotFound();
      }
      const draft = await transaction.organizationUnitVersion.findFirst({
        where: {
          id: draftId,
          agencyId: context.agencyId,
          organizationUnitId: unitId,
          status: DRAFT_STATUS,
        },
        select: unitVersionSelect,
      });
      if (!draft) throw this.successorDraftNotFound();
      const current = await this.latestPublished(transaction, context.agencyId, unitId);
      if (!current || current.status !== ACTIVE_STATUS) {
        throw new OrganizationServiceError(
          'The current Organization Unit version cannot be edited through a successor.',
          409,
          'ORGANIZATION_UNIT_SUCCESSOR_NOT_ALLOWED',
        );
      }
      this.assertSuccessorDate(effectiveFrom, current.effectiveFrom);
      await this.validateParent(
        transaction,
        context.agencyId,
        unitId,
        input.parentUnitId,
        effectiveFrom,
        null,
      );
      const headPositionId =
        input.headPositionId === undefined ? draft.headPositionId : input.headPositionId;
      await this.validateHeadPosition(transaction, context.agencyId, headPositionId, effectiveFrom);

      const before = versionSummaryFromRecord(draft);
      const updated = await transaction.organizationUnitVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: draftId } },
        data: {
          name: officialName,
          parentUnitId: input.parentUnitId,
          headPositionId,
          costCenterCode,
          responsibilityCenterCode,
          effectiveFrom,
        },
        select: unitVersionSelect,
      });
      const after = versionSummaryFromRecord(updated);
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'ORGANIZATION_UNIT_DRAFT_UPDATED',
        entityType: 'OrganizationUnit',
        entityId: unitId,
        previousStatus: DRAFT_STATUS,
        newStatus: DRAFT_STATUS,
        requestId: context.requestId,
        metadata: {
          versionId: draftId,
          before: versionAuditData(before),
          after: versionAuditData(after),
        },
      });
      return after;
    });
  }

  async activateSuccessor(
    context: RequestContext,
    unitId: string,
    draftId: string,
    input: ActivateOrganizationUnitSuccessorInput,
  ): Promise<OrganizationUnitSummary> {
    this.assertPermission(
      context,
      'organization.units.activate',
      'ORGANIZATION_UNIT_ACTIVATE_FORBIDDEN',
    );
    const reason = input.reason.trim();
    if (!reason) {
      throw new OrganizationServiceError(
        'A reason for the Organization Unit change is required.',
        400,
        'ORGANIZATION_UNIT_CHANGE_REASON_REQUIRED',
      );
    }
    const authorityReference = normalizeOptional(input.authorityReference);
    const migrationPlan = normalizeOptional(input.migrationPlan);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);

    return withDatabaseContext(toDatabaseContext(context), async (transaction) => {
      if (!(await this.lockOrganizationUnit(transaction, context.agencyId, unitId))) {
        throw this.unitNotFound();
      }
      if (idempotencyKey) {
        const completed = await completedIdempotentTransition(
          transaction,
          context.agencyId,
          unitId,
          idempotencyKey,
          reason,
          authorityReference,
          migrationPlan,
        );
        if (completed) return completed;
      }
      const draft = await transaction.organizationUnitVersion.findFirst({
        where: {
          id: draftId,
          agencyId: context.agencyId,
          organizationUnitId: unitId,
          status: DRAFT_STATUS,
        },
        select: unitVersionSelect,
      });
      if (!draft) throw this.successorDraftNotFound();
      return this.activateDraftInTransaction(transaction, context, unitId, draft, reason, {
        authorityReference,
        migrationPlan,
        idempotencyKey,
      });
    });
  }

  async correct(
    context: RequestContext,
    unitId: string,
    versionId: string,
    input: OrganizationUnitCorrectionInput,
  ): Promise<OrganizationUnitVersionSummary> {
    this.assertPermission(
      context,
      'organization.units.update',
      'ORGANIZATION_UNIT_UPDATE_FORBIDDEN',
    );
    const reason = input.reason.trim();
    const officialName = input.officialName.trim();
    if (!reason) {
      throw new OrganizationServiceError(
        'A reason for the Organization Unit correction is required.',
        400,
        'ORGANIZATION_UNIT_CORRECTION_REASON_REQUIRED',
      );
    }
    if (!officialName) {
      throw new OrganizationServiceError(
        'An official Organization Unit name is required.',
        400,
        'ORGANIZATION_UNIT_NAME_REQUIRED',
      );
    }
    const costCenterCode = normalizeOptional(input.costCenterCode);
    const responsibilityCenterCode = normalizeOptional(input.responsibilityCenterCode);

    return withDatabaseContext(toDatabaseContext(context), async (transaction) => {
      if (!(await this.lockOrganizationUnit(transaction, context.agencyId, unitId))) {
        throw this.unitNotFound();
      }
      const source = await transaction.organizationUnitVersion.findFirst({
        where: {
          id: versionId,
          agencyId: context.agencyId,
          organizationUnitId: unitId,
          status: { in: [...PUBLISHED_STATES] },
        },
        select: unitVersionSelect,
      });
      if (!source) {
        throw new OrganizationServiceError(
          'Only an activated Organization Unit version can be corrected.',
          409,
          'ORGANIZATION_UNIT_CORRECTION_NOT_ALLOWED',
        );
      }
      await this.validateParent(
        transaction,
        context.agencyId,
        unitId,
        input.parentUnitId,
        source.effectiveFrom,
        source.effectiveTo,
      );
      const latest = await transaction.organizationUnitVersion.findFirst({
        where: { agencyId: context.agencyId, organizationUnitId: unitId },
        orderBy: { versionNo: 'desc' },
        select: { versionNo: true },
      });
      await transaction.$executeRaw(
        Prisma.sql`SELECT set_config('app.organization_unit_correction', 'on', true)`,
      );
      await transaction.organizationUnitVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: source.id } },
        data: { status: 'VOIDED' },
      });
      const replacement = await transaction.organizationUnitVersion.create({
        data: {
          agencyId: context.agencyId,
          organizationUnitId: unitId,
          versionNo: (latest?.versionNo ?? source.versionNo) + 1,
          name: officialName,
          parentUnitId: input.parentUnitId,
          headPositionId: source.headPositionId,
          costCenterCode,
          responsibilityCenterCode,
          effectiveFrom: source.effectiveFrom,
          effectiveTo: source.effectiveTo,
          status: source.status,
          domainStatus: source.domainStatus,
        },
        select: unitVersionSelect,
      });
      await this.refreshCurrentProjection(transaction, context.agencyId, unitId);
      const before = versionSummaryFromRecord(source);
      const after = versionSummaryFromRecord(replacement);
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'ORGANIZATION_UNIT_CORRECTED',
        entityType: 'OrganizationUnit',
        entityId: unitId,
        previousStatus: source.status,
        newStatus: replacement.status,
        reason,
        requestId: context.requestId,
        metadata: {
          voidedVersionId: source.id,
          replacementVersionId: replacement.id,
          before: versionAuditData(before),
          after: versionAuditData(after),
        },
      });
      return after;
    });
  }

  async history(
    context: RequestContext,
    unitId: string,
    asOfValue = manilaToday(),
  ): Promise<OrganizationUnitHistory> {
    this.assertPermission(context, 'organization.units.read', 'ORGANIZATION_UNIT_READ_FORBIDDEN');
    const asOf = toDatabaseDate(asOfValue);
    return withDatabaseContext(toDatabaseContext(context), async (transaction) => {
      const unit = await transaction.organizationUnit.findFirst({
        where: { id: unitId, agencyId: context.agencyId },
        select: { id: true, code: true, unitType: true },
      });
      if (!unit) throw this.unitNotFound();
      const [versions, current, effective, draft, events] = await Promise.all([
        transaction.organizationUnitVersion.findMany({
          where: { agencyId: context.agencyId, organizationUnitId: unitId },
          select: unitVersionSelect,
          orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
        }),
        this.currentPublished(transaction, context.agencyId, unitId, todayDate()),
        this.currentPublished(transaction, context.agencyId, unitId, asOf),
        transaction.organizationUnitVersion.findFirst({
          where: { agencyId: context.agencyId, organizationUnitId: unitId, status: DRAFT_STATUS },
          select: unitVersionSelect,
        }),
        transaction.auditEvent.findMany({
          where: {
            agencyId: context.agencyId,
            entityType: 'OrganizationUnit',
            entityId: unitId,
            action: { startsWith: 'ORGANIZATION_UNIT_' },
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
            actorUser: { select: { displayName: true } },
          },
        }),
      ]);
      return {
        unit: {
          id: unit.id,
          code: unit.code,
          unitType: unit.unitType as OrganizationUnitType,
        },
        asOf: asOfValue,
        effective: effective ? versionSummaryFromRecord(effective) : null,
        current: current ? versionSummaryFromRecord(current) : null,
        draft: draft ? versionSummaryFromRecord(draft) : null,
        versions: versions.map(versionSummaryFromRecord),
        transitions: events.map((event) => ({
          id: event.id,
          action: event.action,
          previousStatus: event.previousStatus ?? 'None',
          newStatus: event.newStatus ?? 'Unknown',
          actorDisplayName: event.actorUser?.displayName ?? null,
          reason: event.reason,
          effectiveDate: metadataString(event.metadata, 'effectiveDate'),
          authorityReference: metadataString(event.metadata, 'authorityReference'),
          migrationPlan: metadataString(event.metadata, 'migrationPlan'),
          before: metadataData(event.metadata, 'before'),
          after: metadataData(event.metadata, 'after'),
          occurredAt: event.occurredAt.toISOString(),
        })),
      };
    });
  }

  async inactivate(
    context: RequestContext,
    unitId: string,
    input: OrganizationUnitTransitionInput,
  ): Promise<OrganizationUnitSummary> {
    this.assertPermission(
      context,
      'organization.units.inactivate',
      'ORGANIZATION_UNIT_INACTIVATE_FORBIDDEN',
    );
    return this.transition(context, unitId, 'INACTIVE', input);
  }

  async reactivate(
    context: RequestContext,
    unitId: string,
    input: OrganizationUnitTransitionInput,
  ): Promise<OrganizationUnitSummary> {
    this.assertPermission(
      context,
      'organization.units.activate',
      'ORGANIZATION_UNIT_ACTIVATE_FORBIDDEN',
    );
    return this.transition(context, unitId, ACTIVE_STATUS, input);
  }

  async abolish(
    context: RequestContext,
    unitId: string,
    input: OrganizationUnitTransitionInput,
  ): Promise<OrganizationUnitSummary> {
    this.assertPermission(
      context,
      'organization.units.abolish',
      'ORGANIZATION_UNIT_ABOLISH_FORBIDDEN',
    );
    return this.transition(context, unitId, 'ABOLISHED', input);
  }

  private async transition(
    context: RequestContext,
    unitId: string,
    targetStatus: OrganizationUnitLifecycleStatus,
    input: OrganizationUnitTransitionInput,
  ): Promise<OrganizationUnitSummary> {
    const effectiveFrom = toDatabaseDate(input.effectiveDate);
    const reason = input.reason.trim();
    const authorityReference = normalizeOptional(input.authorityReference);
    const migrationPlan = normalizeOptional(input.migrationPlan);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    if (!reason) {
      throw new OrganizationServiceError(
        'A reason for the Organization Unit transition is required.',
        400,
        'ORGANIZATION_UNIT_CHANGE_REASON_REQUIRED',
      );
    }
    if (targetStatus === 'ABOLISHED' && !authorityReference) {
      throw new OrganizationServiceError(
        'An authority reference is required to abolish an Organization Unit.',
        400,
        'ORGANIZATION_UNIT_AUTHORITY_REQUIRED',
      );
    }
    if (targetStatus === ACTIVE_STATUS && !authorityReference) {
      throw new OrganizationServiceError(
        'An authority reference is required to reactivate an Organization Unit.',
        400,
        'ORGANIZATION_UNIT_AUTHORITY_REQUIRED',
      );
    }

    return withDatabaseContext(toDatabaseContext(context), async (transaction) => {
      if (!(await this.lockOrganizationUnit(transaction, context.agencyId, unitId))) {
        throw this.unitNotFound();
      }
      if (idempotencyKey) {
        const completed = await completedIdempotentTransition(
          transaction,
          context.agencyId,
          unitId,
          idempotencyKey,
          reason,
          authorityReference,
          migrationPlan,
        );
        if (completed) return completed;
      }
      const unit = await transaction.organizationUnit.findFirst({
        where: { id: unitId, agencyId: context.agencyId },
        select: { id: true, status: true },
      });
      if (!unit) throw this.unitNotFound();
      const current = await this.latestPublished(transaction, context.agencyId, unitId);
      if (!current || current.status !== ACTIVE_STATUS) {
        throw new OrganizationServiceError(
          'The current Organization Unit version cannot transition.',
          409,
          'ORGANIZATION_UNIT_TRANSITION_NOT_ALLOWED',
        );
      }
      if (
        (targetStatus === 'INACTIVE' && current.domainStatus !== ACTIVE_STATUS) ||
        (targetStatus === ACTIVE_STATUS && current.domainStatus !== 'INACTIVE') ||
        (targetStatus === 'ABOLISHED' &&
          ![ACTIVE_STATUS, 'INACTIVE'].includes(
            current.domainStatus as OrganizationUnitLifecycleStatus,
          ))
      ) {
        throw new OrganizationServiceError(
          `The Organization Unit cannot transition from ${current.domainStatus}.`,
          409,
          'ORGANIZATION_UNIT_TRANSITION_NOT_ALLOWED',
        );
      }
      this.assertSuccessorDate(effectiveFrom, current.effectiveFrom);

      if (targetStatus !== ACTIVE_STATUS) {
        const dependencies = await this.unresolvedDependencyCount(
          transaction,
          context.agencyId,
          unitId,
          effectiveFrom,
        );
        if (dependencies > 0 && !migrationPlan) {
          throw new OrganizationServiceError(
            `The Organization Unit has ${dependencies} unresolved dependent assignment(s). Record a migration plan before this transition.`,
            409,
            'ORGANIZATION_UNIT_DEPENDENCIES_UNRESOLVED',
          );
        }
      }

      const draft = await transaction.organizationUnitVersion.create({
        data: {
          agencyId: context.agencyId,
          organizationUnitId: unitId,
          versionNo: current.versionNo + 1,
          name: current.name,
          parentUnitId: current.parentUnitId,
          headPositionId: current.headPositionId,
          costCenterCode: current.costCenterCode,
          responsibilityCenterCode: current.responsibilityCenterCode,
          effectiveFrom,
          status: DRAFT_STATUS,
          domainStatus: targetStatus,
        },
        select: unitVersionSelect,
      });
      return this.activateDraftInTransaction(transaction, context, unitId, draft, reason, {
        authorityReference,
        migrationPlan,
        idempotencyKey,
      });
    });
  }

  private async activateDraftInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    unitId: string,
    draft: OrganizationUnitVersionRecord,
    reason: string,
    evidence: {
      authorityReference: string | null;
      migrationPlan: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<OrganizationUnitSummary> {
    const predecessor = await this.latestPublishedBefore(
      transaction,
      context.agencyId,
      unitId,
      draft.effectiveFrom,
    );
    if (
      !predecessor ||
      predecessor.status !== ACTIVE_STATUS ||
      predecessor.domainStatus === 'ABOLISHED'
    ) {
      throw new OrganizationServiceError(
        'The Organization Unit has no active predecessor for this successor date.',
        409,
        'ORGANIZATION_UNIT_PREDECESSOR_INVALID',
      );
    }
    if (predecessor.effectiveTo && predecessor.effectiveTo < draft.effectiveFrom) {
      throw new OrganizationServiceError(
        'The successor date is outside the current Organization Unit period.',
        409,
        'ORGANIZATION_UNIT_PREDECESSOR_INVALID',
      );
    }
    await this.validateParent(
      transaction,
      context.agencyId,
      unitId,
      draft.parentUnitId,
      draft.effectiveFrom,
      draft.effectiveTo,
    );
    await this.validateHeadPosition(
      transaction,
      context.agencyId,
      draft.headPositionId,
      draft.effectiveFrom,
    );
    const published = await transaction.organizationUnitVersion.findMany({
      where: {
        agencyId: context.agencyId,
        organizationUnitId: unitId,
        status: { in: [...PUBLISHED_STATES] },
      },
      select: { id: true, effectiveFrom: true, effectiveTo: true },
    });
    if (
      published.some(
        (version) =>
          version.id !== predecessor.id &&
          periodsOverlap(
            version.effectiveFrom,
            version.effectiveTo,
            draft.effectiveFrom,
            draft.effectiveTo,
          ),
      )
    ) {
      throw new OrganizationServiceError(
        'Organization Unit effective periods cannot overlap.',
        409,
        'ORGANIZATION_UNIT_PERIOD_OVERLAP',
      );
    }

    const before = versionSummaryFromRecord(predecessor);
    await transaction.organizationUnitVersion.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: predecessor.id } },
      data: { status: 'SUPERSEDED', effectiveTo: addDays(draft.effectiveFrom, -1) },
    });
    const activated = await transaction.organizationUnitVersion.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: draft.id } },
      data: { status: ACTIVE_STATUS, effectiveTo: null },
      select: unitVersionSelect,
    });
    await this.refreshCurrentProjection(transaction, context.agencyId, unitId);
    const after = versionSummaryFromRecord(activated);
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action: transitionAuditAction(before.lifecycleStatus, after.lifecycleStatus),
      entityType: 'OrganizationUnit',
      entityId: unitId,
      previousStatus: before.lifecycleStatus,
      newStatus: after.lifecycleStatus,
      reason,
      requestId: context.requestId,
      ...(evidence.idempotencyKey ? { idempotencyKey: evidence.idempotencyKey } : {}),
      metadata: {
        predecessorId: predecessor.id,
        versionId: activated.id,
        effectiveDate: after.effectiveFrom,
        ...(evidence.authorityReference ? { authorityReference: evidence.authorityReference } : {}),
        ...(evidence.migrationPlan ? { migrationPlan: evidence.migrationPlan } : {}),
        before: versionAuditData(before),
        after: versionAuditData(after),
      },
    });
    return summaryFromRecord({
      id: unitId,
      code: activated.organizationUnit.code,
      unitType: activated.organizationUnit.unitType,
      status: activated.domainStatus,
      currentVersion: activated,
    });
  }

  private async latestPublished(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    unitId: string,
  ): Promise<OrganizationUnitVersionRecord | null> {
    return transaction.organizationUnitVersion.findFirst({
      where: { agencyId, organizationUnitId: unitId, status: { in: [...PUBLISHED_STATES] } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: unitVersionSelect,
    });
  }

  private async latestPublishedBefore(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    unitId: string,
    date: Date,
  ): Promise<OrganizationUnitVersionRecord | null> {
    return transaction.organizationUnitVersion.findFirst({
      where: {
        agencyId,
        organizationUnitId: unitId,
        status: { in: [...PUBLISHED_STATES] },
        effectiveFrom: { lt: date },
      },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: unitVersionSelect,
    });
  }

  private async currentPublished(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    unitId: string,
    asOf: Date,
  ): Promise<OrganizationUnitVersionRecord | null> {
    return transaction.organizationUnitVersion.findFirst({
      where: {
        agencyId,
        organizationUnitId: unitId,
        status: { in: [...PUBLISHED_STATES] },
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: unitVersionSelect,
    });
  }

  private async refreshCurrentProjection(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    unitId: string,
  ): Promise<void> {
    const current = await this.currentPublished(transaction, agencyId, unitId, todayDate());
    if (!current) {
      throw new OrganizationServiceError(
        'The Organization Unit has no version effective today.',
        409,
        'ORGANIZATION_UNIT_CURRENT_VERSION_MISSING',
      );
    }
    await transaction.organizationUnit.update({
      where: { agencyId_id: { agencyId, id: unitId } },
      data: { status: current.domainStatus, currentVersionId: current.id },
    });
  }

  private async validateParent(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    unitId: string,
    parentUnitId: string | null,
    effectiveFrom: Date,
    effectiveTo: Date | null,
  ): Promise<void> {
    if (!parentUnitId) return;
    if (parentUnitId === unitId) {
      throw new OrganizationServiceError(
        'An Organization Unit cannot report to itself.',
        409,
        'ORGANIZATION_UNIT_HIERARCHY_CYCLE',
      );
    }
    if (
      !(await hasEligibleParentCoverage(
        transaction,
        agencyId,
        parentUnitId,
        effectiveFrom,
        effectiveTo,
      ))
    ) {
      throw new OrganizationServiceError(
        'Choose a parent that remains active throughout the affected effective period.',
        422,
        'ORGANIZATION_UNIT_PARENT_INVALID',
      );
    }
    if (
      await wouldCreateHierarchyCycle(
        transaction,
        agencyId,
        unitId,
        parentUnitId,
        effectiveFrom,
        effectiveTo,
      )
    ) {
      throw new OrganizationServiceError(
        'This parent would create a cycle in the effective Organization hierarchy.',
        409,
        'ORGANIZATION_UNIT_HIERARCHY_CYCLE',
      );
    }
  }

  private async validateHeadPosition(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    headPositionId: string | null,
    effectiveFrom: Date,
  ): Promise<void> {
    if (!headPositionId) return;
    const position = await transaction.plantillaPositionVersion.findFirst({
      where: {
        agencyId,
        positionId: headPositionId,
        status: { in: [...PUBLISHED_STATES] },
        domainStatus: { not: 'ABOLISHED' },
        effectiveFrom: { lte: effectiveFrom },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
      },
      select: { id: true },
    });
    if (!position) {
      throw new OrganizationServiceError(
        'Choose a same-agency Plantilla Position that is effective for the Organization Unit change.',
        409,
        'ORGANIZATION_UNIT_HEAD_POSITION_INVALID',
      );
    }
  }

  private async unresolvedDependencyCount(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    unitId: string,
    effectiveDate: Date,
  ): Promise<number> {
    const [memberships, delegations, children] = await Promise.all([
      transaction.agencyMembership.count({
        where: { agencyId, primaryOrganizationUnitId: unitId, status: 'ACTIVE' },
      }),
      transaction.delegatedAuthority.count({
        where: { agencyId, organizationUnitId: unitId, status: 'ACTIVE' },
      }),
      transaction.organizationUnitVersion.count({
        where: {
          agencyId,
          parentUnitId: unitId,
          status: { in: [...PUBLISHED_STATES] },
          domainStatus: ACTIVE_STATUS,
          effectiveFrom: { lte: effectiveDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveDate } }],
        },
      }),
    ]);
    return memberships + delegations + children;
  }

  private assertSuccessorDate(value: Date, predecessorStart: Date): void {
    if (value < todayDate() || value <= predecessorStart) {
      throw new OrganizationServiceError(
        'The successor must take effect after the current Organization Unit version starts.',
        409,
        'ORGANIZATION_UNIT_EFFECTIVE_DATE_INVALID',
      );
    }
  }

  private async lockOrganizationUnit(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    unitId: string,
  ): Promise<boolean> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT "id"
        FROM "organization_units"
        WHERE "agency_id" = ${agencyId}::uuid
          AND "id" = ${unitId}::uuid
        FOR UPDATE
      `,
    );
    return rows.length > 0;
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (!hasPermission(context, permission, { agencyId: context.agencyId })) {
      throw new OrganizationServiceError(
        'The current Agency Membership lacks the required permission.',
        403,
        code,
      );
    }
  }

  private unitNotFound(): OrganizationServiceError {
    return new OrganizationServiceError(
      'The Organization Unit could not be found.',
      404,
      'ORGANIZATION_UNIT_NOT_FOUND',
    );
  }

  private successorDraftNotFound(): OrganizationServiceError {
    return new OrganizationServiceError(
      'The Draft Organization Unit successor could not be found.',
      404,
      'ORGANIZATION_UNIT_DRAFT_NOT_FOUND',
    );
  }
}
