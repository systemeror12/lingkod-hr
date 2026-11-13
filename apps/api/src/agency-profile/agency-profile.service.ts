import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { AGENCY_PROFILE_TYPES, type agencyProfileDraftSchema } from './agency-profile.schemas';

export type AgencyProfileType = (typeof AGENCY_PROFILE_TYPES)[number];
export type AgencyProfileVersionState = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' | 'VOIDED';
export type AgencyProfileDomainStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

type AgencyProfileInput = Omit<typeof agencyProfileDraftSchema._output, 'agencyType'> & {
  agencyType: AgencyProfileType;
};

export type AgencyProfileDraftInput = AgencyProfileInput;

export interface AgencyProfileCorrectionInput extends Omit<AgencyProfileInput, 'effectiveFrom'> {
  reason: string;
}

export interface AgencyProfileVersionSummary {
  id: string;
  versionNo: number;
  versionState: AgencyProfileVersionState;
  domainStatus: AgencyProfileDomainStatus;
  officialName: string;
  acronym: string | null;
  agencyType: AgencyProfileType;
  parentOrganization: string | null;
  reportingIdentifiers: string | null;
  appointingAuthorityTitle: string | null;
  defaultTimezone: string;
  defaultCurrency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface AgencyProfileList {
  current: AgencyProfileVersionSummary | null;
  draft: AgencyProfileVersionSummary | null;
  versions: AgencyProfileVersionSummary[];
}

export class AgencyProfileServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'AgencyProfileServiceError';
  }
}

export interface AgencyProfileAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const AGENCY_PROFILE_AUDIT_WRITER = Symbol('AGENCY_PROFILE_AUDIT_WRITER');

export const agencyProfileAuditWriter: AgencyProfileAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};

const PUBLISHED_STATES: AgencyProfileVersionState[] = ['ACTIVE', 'SUPERSEDED'];

const profileSelect = {
  id: true,
  agencyId: true,
  versionNo: true,
  officialName: true,
  acronym: true,
  agencyType: true,
  parentOrganization: true,
  reportingIdentifiers: true,
  appointingAuthorityTitle: true,
  defaultTimezone: true,
  defaultCurrency: true,
  deploymentProfile: true,
  effectiveFrom: true,
  effectiveTo: true,
  configuration: true,
  status: true,
  domainStatus: true,
  createdAt: true,
} as const;

type ProfileRecord = Prisma.AgencyProfileVersionGetPayload<{ select: typeof profileSelect }>;

function toDatabaseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AgencyProfileServiceError(
      'The effective date is invalid.',
      400,
      'AGENCY_PROFILE_EFFECTIVE_DATE_INVALID',
    );
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AgencyProfileServiceError(
      'The effective date is invalid.',
      400,
      'AGENCY_PROFILE_EFFECTIVE_DATE_INVALID',
    );
  }
  return date;
}

function today(): Date {
  const value = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return new Date(`${value}T00:00:00.000Z`);
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function normalizeOptional(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeInput(input: AgencyProfileDraftInput): AgencyProfileDraftInput {
  return {
    officialName: input.officialName.trim(),
    acronym: normalizeOptional(input.acronym)?.toUpperCase() ?? null,
    agencyType: input.agencyType,
    parentOrganization: normalizeOptional(input.parentOrganization),
    reportingIdentifiers: normalizeOptional(input.reportingIdentifiers),
    appointingAuthorityTitle: normalizeOptional(input.appointingAuthorityTitle),
    defaultTimezone: input.defaultTimezone.trim(),
    defaultCurrency: input.defaultCurrency.trim().toUpperCase(),
    effectiveFrom: input.effectiveFrom,
  };
}

function normalizeCorrection(input: AgencyProfileCorrectionInput): AgencyProfileCorrectionInput {
  return {
    ...normalizeInput({ ...input, effectiveFrom: '2000-01-01' }),
    reason: input.reason.trim(),
  };
}

function toSummary(record: ProfileRecord): AgencyProfileVersionSummary {
  return {
    id: record.id,
    versionNo: record.versionNo,
    versionState: record.status as AgencyProfileVersionState,
    domainStatus: record.domainStatus as AgencyProfileDomainStatus,
    officialName: record.officialName,
    acronym: record.acronym,
    agencyType: record.agencyType as AgencyProfileType,
    parentOrganization: record.parentOrganization,
    reportingIdentifiers: record.reportingIdentifiers,
    appointingAuthorityTitle: record.appointingAuthorityTitle,
    defaultTimezone: record.defaultTimezone,
    defaultCurrency: record.defaultCurrency.trim(),
    effectiveFrom: formatDate(record.effectiveFrom),
    effectiveTo: record.effectiveTo ? formatDate(record.effectiveTo) : null,
  };
}

function profileDataFromInput(input: AgencyProfileDraftInput) {
  return {
    officialName: input.officialName,
    acronym: input.acronym,
    agencyType: input.agencyType,
    parentOrganization: input.parentOrganization,
    reportingIdentifiers: input.reportingIdentifiers,
    appointingAuthorityTitle: input.appointingAuthorityTitle,
    defaultTimezone: input.defaultTimezone,
    defaultCurrency: input.defaultCurrency,
  };
}

function profileAuditData(record: ProfileRecord | AgencyProfileDraftInput) {
  if ('id' in record) {
    return {
      officialName: record.officialName,
      acronym: record.acronym,
      agencyType: record.agencyType,
      parentOrganization: record.parentOrganization,
      reportingIdentifiers: record.reportingIdentifiers,
      appointingAuthorityTitle: record.appointingAuthorityTitle,
      defaultTimezone: record.defaultTimezone,
      defaultCurrency: record.defaultCurrency,
      effectiveFrom: formatDate(record.effectiveFrom),
      effectiveTo: record.effectiveTo ? formatDate(record.effectiveTo) : null,
      versionState: record.status,
      domainStatus: record.domainStatus,
    };
  }
  return {
    officialName: record.officialName,
    acronym: record.acronym,
    agencyType: record.agencyType,
    parentOrganization: record.parentOrganization,
    reportingIdentifiers: record.reportingIdentifiers,
    appointingAuthorityTitle: record.appointingAuthorityTitle,
    defaultTimezone: record.defaultTimezone,
    defaultCurrency: record.defaultCurrency,
    effectiveFrom: record.effectiveFrom,
  };
}

function profileWhere(agencyId: string, statuses: readonly string[] = PUBLISHED_STATES) {
  return { agencyId, status: { in: [...statuses] } };
}

function currentWhere(agencyId: string, asOf: Date) {
  return {
    ...profileWhere(agencyId),
    effectiveFrom: { lte: asOf },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
  };
}

@Injectable()
export class AgencyProfileService {
  constructor(
    @Inject(AGENCY_PROFILE_AUDIT_WRITER)
    private readonly auditWriter: AgencyProfileAuditWriter,
  ) {}

  async list(context: RequestContext, asOfValue?: string): Promise<AgencyProfileList> {
    this.assertPermission(context, 'organization.agency.read', 'AGENCY_PROFILE_READ_FORBIDDEN');
    const asOf = asOfValue ? toDatabaseDate(asOfValue) : today();

    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const [current, records] = await Promise.all([
        transaction.agencyProfileVersion.findFirst({
          where: currentWhere(context.agencyId, asOf),
          orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
          select: profileSelect,
        }),
        transaction.agencyProfileVersion.findMany({
          where: { agencyId: context.agencyId },
          orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
          select: profileSelect,
        }),
      ]);
      const draft = records.find((record) => record.status === 'DRAFT') ?? null;
      const ordered = [
        ...(draft ? [draft] : []),
        ...records.filter((record) => record.id !== draft?.id),
      ];
      return {
        current: current ? toSummary(current) : null,
        draft: draft ? toSummary(draft) : null,
        versions: ordered.map(toSummary),
      };
    });
  }

  async createDraft(context: RequestContext): Promise<AgencyProfileVersionSummary> {
    this.assertPermission(context, 'organization.agency.update', 'AGENCY_PROFILE_UPDATE_FORBIDDEN');
    try {
      return await withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
        const existingDraft = await transaction.agencyProfileVersion.findFirst({
          where: { agencyId: context.agencyId, status: 'DRAFT' },
          select: profileSelect,
        });
        if (existingDraft) return toSummary(existingDraft);

        const latest = await this.latestPublished(transaction, context.agencyId);
        if (!latest) throw this.missingProfile();
        const proposedDate = new Date(
          Math.max(addDays(latest.effectiveFrom, 1).getTime(), addDays(today(), 1).getTime()),
        );
        const draft = await transaction.agencyProfileVersion.create({
          data: {
            agencyId: context.agencyId,
            versionNo: latest.versionNo + 1,
            officialName: latest.officialName,
            acronym: latest.acronym,
            agencyType: latest.agencyType,
            parentOrganization: latest.parentOrganization,
            reportingIdentifiers: latest.reportingIdentifiers,
            appointingAuthorityTitle: latest.appointingAuthorityTitle,
            defaultTimezone: latest.defaultTimezone,
            defaultCurrency: latest.defaultCurrency,
            deploymentProfile: latest.deploymentProfile,
            effectiveFrom: proposedDate,
            status: 'DRAFT',
            domainStatus: latest.domainStatus,
          },
          select: profileSelect,
        });
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'AGENCY_PROFILE_DRAFT_CREATED',
          entityType: 'AgencyProfileVersion',
          entityId: draft.id,
          previousStatus: 'None',
          newStatus: 'DRAFT',
          requestId: context.requestId,
          metadata: { after: profileAuditData(draft) },
        });
        return toSummary(draft);
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.findDraft(context);
        if (existing) return existing;
      }
      throw error;
    }
  }

  async updateDraft(
    context: RequestContext,
    draftId: string,
    rawInput: AgencyProfileDraftInput,
  ): Promise<AgencyProfileVersionSummary> {
    this.assertPermission(context, 'organization.agency.update', 'AGENCY_PROFILE_UPDATE_FORBIDDEN');
    const input = normalizeInput(rawInput);
    const effectiveFrom = toDatabaseDate(input.effectiveFrom);

    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const draft = await transaction.agencyProfileVersion.findFirst({
        where: { id: draftId, agencyId: context.agencyId, status: 'DRAFT' },
        select: profileSelect,
      });
      if (!draft) throw this.draftNotFound();
      const latest = await this.latestPublished(transaction, context.agencyId);
      if (!latest) throw this.missingProfile();
      this.assertSuccessorDate(effectiveFrom, latest.effectiveFrom);

      const updated = await transaction.agencyProfileVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: draft.id } },
        data: { ...profileDataFromInput(input), effectiveFrom },
        select: profileSelect,
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'AGENCY_PROFILE_DRAFT_UPDATED',
        entityType: 'AgencyProfileVersion',
        entityId: updated.id,
        previousStatus: 'DRAFT',
        newStatus: 'DRAFT',
        requestId: context.requestId,
        metadata: { before: profileAuditData(draft), after: profileAuditData(updated) },
      });
      return toSummary(updated);
    });
  }

  async activate(
    context: RequestContext,
    draftId: string,
    effectiveDate: string,
    reason: string,
  ): Promise<AgencyProfileVersionSummary> {
    this.assertPermission(context, 'organization.agency.update', 'AGENCY_PROFILE_UPDATE_FORBIDDEN');
    const effectiveFrom = toDatabaseDate(effectiveDate);
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      throw new AgencyProfileServiceError(
        'A reason for activation is required.',
        400,
        'AGENCY_PROFILE_ACTIVATION_REASON_REQUIRED',
      );
    }

    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const draft = await transaction.agencyProfileVersion.findFirst({
        where: { id: draftId, agencyId: context.agencyId, status: 'DRAFT' },
        select: profileSelect,
      });
      if (!draft) throw this.draftNotFound();
      const predecessor = await this.latestPublished(transaction, context.agencyId);
      if (!predecessor) throw this.missingProfile();
      this.assertSuccessorDate(effectiveFrom, predecessor.effectiveFrom);
      if (predecessor.status !== 'ACTIVE') {
        throw new AgencyProfileServiceError(
          'The latest Agency Profile version cannot be superseded.',
          409,
          'AGENCY_PROFILE_PREDECESSOR_IMMUTABLE',
        );
      }

      const closedAt = addDays(effectiveFrom, -1);
      await transaction.agencyProfileVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: predecessor.id } },
        data: { status: 'SUPERSEDED', effectiveTo: closedAt },
      });
      const activated = await transaction.agencyProfileVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: draft.id } },
        data: { status: 'ACTIVE', effectiveFrom, effectiveTo: null },
        select: profileSelect,
      });
      const current = await transaction.agencyProfileVersion.findFirst({
        where: currentWhere(context.agencyId, today()),
        orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
        select: profileSelect,
      });
      if (!current) throw this.missingProfile();
      await transaction.agency.update({
        where: { id: context.agencyId },
        data: {
          name: current.officialName,
          acronym: current.acronym,
          agencyType: current.agencyType,
          defaultTimezone: current.defaultTimezone,
          defaultCurrency: current.defaultCurrency,
          status: current.domainStatus,
          currentProfileVersionId: current.id,
        },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'AGENCY_PROFILE_ACTIVATED',
        entityType: 'AgencyProfileVersion',
        entityId: activated.id,
        previousStatus: 'DRAFT',
        newStatus: 'ACTIVE',
        reason: normalizedReason,
        requestId: context.requestId,
        metadata: {
          predecessorId: predecessor.id,
          effectiveDate,
          before: profileAuditData(draft),
          after: profileAuditData(activated),
        },
      });
      return toSummary(activated);
    });
  }

  async correct(
    context: RequestContext,
    versionId: string,
    rawInput: AgencyProfileCorrectionInput,
  ): Promise<AgencyProfileVersionSummary> {
    this.assertPermission(context, 'organization.agency.update', 'AGENCY_PROFILE_UPDATE_FORBIDDEN');
    const input = normalizeCorrection(rawInput);
    if (!input.reason) {
      throw new AgencyProfileServiceError(
        'A reason for correction is required.',
        400,
        'AGENCY_PROFILE_CORRECTION_REASON_REQUIRED',
      );
    }

    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const source = await transaction.agencyProfileVersion.findFirst({
        where: { id: versionId, agencyId: context.agencyId, status: { in: PUBLISHED_STATES } },
        select: profileSelect,
      });
      if (!source) {
        throw new AgencyProfileServiceError(
          'Only an activated Agency Profile version can be corrected.',
          409,
          'AGENCY_PROFILE_CORRECTION_NOT_ALLOWED',
        );
      }
      const latest = await transaction.agencyProfileVersion.findFirst({
        where: { agencyId: context.agencyId },
        orderBy: { versionNo: 'desc' },
        select: { versionNo: true },
      });
      const replacement = await transaction.agencyProfileVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: source.id } },
        data: { status: 'VOIDED' },
        select: profileSelect,
      });
      const corrected = await transaction.agencyProfileVersion.create({
        data: {
          agencyId: context.agencyId,
          versionNo: (latest?.versionNo ?? source.versionNo) + 1,
          ...profileDataFromInput({ ...input, effectiveFrom: formatDate(source.effectiveFrom) }),
          deploymentProfile: source.deploymentProfile,
          effectiveFrom: source.effectiveFrom,
          effectiveTo: source.effectiveTo,
          status: source.status,
          domainStatus: source.domainStatus,
        },
        select: profileSelect,
      });
      const current = await transaction.agencyProfileVersion.findFirst({
        where: currentWhere(context.agencyId, today()),
        orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
        select: profileSelect,
      });
      if (!current) throw this.missingProfile();
      await transaction.agency.update({
        where: { id: context.agencyId },
        data: {
          name: current.officialName,
          acronym: current.acronym,
          agencyType: current.agencyType,
          defaultTimezone: current.defaultTimezone,
          defaultCurrency: current.defaultCurrency,
          status: current.domainStatus,
          currentProfileVersionId: current.id,
        },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'AGENCY_PROFILE_CORRECTED',
        entityType: 'AgencyProfileVersion',
        entityId: corrected.id,
        previousStatus: source.status,
        newStatus: source.status,
        reason: input.reason,
        requestId: context.requestId,
        metadata: {
          voidedVersionId: replacement.id,
          before: profileAuditData(source),
          after: profileAuditData(corrected),
        },
      });
      return toSummary(corrected);
    });
  }

  private async latestPublished(
    transaction: Prisma.TransactionClient,
    agencyId: string,
  ): Promise<ProfileRecord | null> {
    return transaction.agencyProfileVersion.findFirst({
      where: profileWhere(agencyId),
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: profileSelect,
    });
  }

  private async findDraft(context: RequestContext): Promise<AgencyProfileVersionSummary | null> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const draft = await transaction.agencyProfileVersion.findFirst({
        where: { agencyId: context.agencyId, status: 'DRAFT' },
        select: profileSelect,
      });
      return draft ? toSummary(draft) : null;
    });
  }

  private assertSuccessorDate(value: Date, predecessorStart: Date): void {
    if (value <= predecessorStart) {
      throw new AgencyProfileServiceError(
        'The successor must take effect after the latest published version starts.',
        409,
        'AGENCY_PROFILE_EFFECTIVE_DATE_INVALID',
      );
    }
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (!holdsAgencyWide(context, permission)) {
      throw new AgencyProfileServiceError(
        'The current Agency Membership lacks the required permission.',
        403,
        code,
      );
    }
  }

  private missingProfile(): AgencyProfileServiceError {
    return new AgencyProfileServiceError(
      'The Agency Profile could not be found.',
      404,
      'AGENCY_PROFILE_NOT_FOUND',
    );
  }

  private draftNotFound(): AgencyProfileServiceError {
    return new AgencyProfileServiceError(
      'The Draft Agency Profile successor could not be found.',
      404,
      'AGENCY_PROFILE_DRAFT_NOT_FOUND',
    );
  }
}
