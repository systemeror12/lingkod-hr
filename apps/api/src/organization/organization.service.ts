import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';

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

export interface OrganizationUnitSummary {
  id: string;
  code: string;
  officialName: string;
  unitType: OrganizationUnitType;
  effectiveDate: string;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ABOLISHED';
}

export interface OrganizationUnitList {
  units: OrganizationUnitSummary[];
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
const ORGANIZATION_UNIT_LIST_LIMIT = 100;

function toDatabaseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
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
  currentVersion: { name: string; effectiveFrom: Date } | null;
}): OrganizationUnitSummary {
  return {
    id: record.id,
    code: record.code,
    officialName: record.currentVersion?.name ?? '',
    unitType: record.unitType as OrganizationUnitType,
    effectiveDate: record.currentVersion ? formatDate(record.currentVersion.effectiveFrom) : '',
    status: record.status as OrganizationUnitSummary['status'],
  };
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
            select: { name: true, effectiveFrom: true },
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
            select: { name: true, effectiveFrom: true },
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
