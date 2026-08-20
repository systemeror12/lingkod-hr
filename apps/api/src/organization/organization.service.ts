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
}

export interface ActivateOrganizationUnitInput {
  parentUnitId: string | null;
  reason: string;
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

function toDatabaseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
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
      return { units: records.map(summaryFromRecord) };
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
      return record ? summaryFromRecord(record) : null;
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
          where: { id: parentForUnitId, agencyId: context.agencyId, status: DRAFT_STATUS },
          select: { currentVersion: true },
        });
        if (target?.currentVersion?.status === DRAFT_STATUS) {
          parentIds = await coverageEligibleParentIds(
            transaction,
            context.agencyId,
            parentForUnitId,
            target.currentVersion.effectiveFrom,
            target.currentVersion.effectiveTo,
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

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (!hasPermission(context, permission, { agencyId: context.agencyId })) {
      throw new OrganizationServiceError(
        'The current Agency Membership lacks the required permission.',
        403,
        code,
      );
    }
  }
}
