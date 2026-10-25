import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import { MandatoryLeaveAssessmentsService } from '../mandatory-leave-assessments/mandatory-leave-assessments.service';
import {
  LEAVE_CATALOGUE,
  LEAVE_EVIDENCE_KINDS,
  LEAVE_PERSONNEL_PROFILES,
  type LeaveAuthorityCitation,
  type LeaveAuthorityClass,
  type LeaveCalendarBasis,
  type LeaveEntitlementBasis,
  type LeaveEvaluatorKind,
  type LeaveEvidenceKind,
  type LeavePersonnelProfile,
  type LeaveRuleParameters,
  findLeaveCatalogueEntry,
  parseLeaveRuleParameters,
} from './leave-catalogue';

export const LEAVE_POLICY_VERSION_STATES = ['DRAFT', 'ACTIVE', 'SUPERSEDED'] as const;
export type LeavePolicyVersionState = (typeof LEAVE_POLICY_VERSION_STATES)[number];
export type LeaveTypeStatus = 'ACTIVE' | 'INACTIVE';
export type LeaveActivationPolicy =
  'FIXED_NATIONAL' | 'REQUIRES_AGENCY_CONFIGURATION' | 'FAIL_CLOSED_PLACEHOLDER';
export type LeaveConfigurationResult = 'RESOLVED' | 'INDETERMINATE';

/** Reasons why a Leave Policy Version cannot deterministically drive assessment. */
export const LEAVE_INDETERMINATE_REASONS = [
  'FAIL_CLOSED_PLACEHOLDER',
  'NATIONAL_RULE_PARAMETERS_INVALID',
  'APPLICABILITY_INVALID',
  'UNSUPPORTED_PERSONNEL_PROFILE',
  'APPLICABILITY_CONFLICT',
  'DOCUMENT_REQUIREMENTS_INVALID',
  'MISSING_NATIONAL_RULE_AUTHORITY',
  'MISSING_AGENCY_CONFIGURATION_AUTHORITY',
  'MISSING_CHARGED_LEAVE_TYPE',
  'INVALID_CHARGED_LEAVE_TYPE',
  'NO_EFFECTIVE_POLICY_VERSION',
] as const;
export type LeaveIndeterminateReason =
  (typeof LEAVE_INDETERMINATE_REASONS)[number] | `UNSUPPORTED_PERSONNEL_PROFILE:${string}`;

export interface LeaveCatalogueEntrySummary {
  code: string;
  name: string;
  evaluatorKind: LeaveEvaluatorKind;
  entitlementBasis: LeaveEntitlementBasis;
  calendarBasis: LeaveCalendarBasis;
  chargedLeaveTypeCode: string | null;
  activationPolicy: LeaveActivationPolicy;
  personnelProfiles: readonly LeavePersonnelProfile[];
  requiredEvidenceKinds: readonly LeaveEvidenceKind[];
  ruleParameters: LeaveRuleParameters;
  authorityCitations: readonly LeaveAuthorityCitation[];
  failClosed: boolean;
}

export interface LeavePolicyAuthoritySummary {
  id: string;
  authorityClass: LeaveAuthorityClass;
  documentId: string;
  documentNo: string | null;
  documentType: string;
  classification: string;
  documentStatus: string;
  documentVersionId: string;
  documentVersionNo: number;
  citation: string;
  validationReason: string | null;
  createdAt: string;
}

export interface LeavePolicyVersionSummary {
  id: string;
  leaveTypeId: string;
  versionNo: number;
  entitlementBasis: LeaveEntitlementBasis;
  calendarBasis: LeaveCalendarBasis;
  chargedLeaveTypeId: string | null;
  chargedLeaveTypeCode: string | null;
  evaluatorKind: LeaveEvaluatorKind;
  ruleParameters: LeaveRuleParameters;
  applicability: {
    profiles: LeavePersonnelProfile[];
    excludedProfiles: LeavePersonnelProfile[];
  };
  documentRequirements: {
    required: LeaveEvidenceKind[];
    additional: LeaveEvidenceKind[];
  };
  approvalRouteCode: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: LeavePolicyVersionState;
  authorities: LeavePolicyAuthoritySummary[];
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveTypeSummary {
  id: string;
  code: string;
  name: string;
  status: LeaveTypeStatus;
  catalogue: LeaveCatalogueEntrySummary;
  currentVersion: LeavePolicyVersionSummary | null;
  draft: LeavePolicyVersionSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveConfigurationAssessment {
  result: LeaveConfigurationResult;
  reasons: string[];
}

export interface LeaveTypeDetail {
  leaveType: LeaveTypeSummary;
  asOf: string;
  effective: LeavePolicyVersionSummary | null;
  configuration: LeaveConfigurationAssessment;
  versions: LeavePolicyVersionSummary[];
  history: LeaveHistoryEntry[];
}

export interface LeaveHistoryEntry {
  id: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  effectiveDate: string | null;
  occurredAt: string;
}

export interface CreateLeaveTypeInput {
  catalogueCode: string;
}

export interface UpdateLeaveTypeInput {
  name?: string | undefined;
  status?: LeaveTypeStatus | undefined;
  rowVersion?: number | undefined;
}

export interface LeaveApplicabilityInput {
  profiles: LeavePersonnelProfile[];
  excludedProfiles?: LeavePersonnelProfile[] | undefined;
}

export interface LeaveDocumentRequirementsInput {
  additional?: LeaveEvidenceKind[] | undefined;
}

export interface CreateLeavePolicyVersionInput {
  effectiveDate: string;
  approvalRouteCode: string;
  applicability: LeaveApplicabilityInput;
  documentRequirements: LeaveDocumentRequirementsInput;
  reason: string;
}

export interface UpdateLeavePolicyDraftInput extends CreateLeavePolicyVersionInput {
  rowVersion?: number | undefined;
}

export interface LinkLeaveAuthorityInput {
  authorityClass: LeaveAuthorityClass;
  documentId: string;
  citation: string;
  validationReason?: string | undefined;
}

export interface LeavePolicyConfigurationInput {
  status: LeavePolicyVersionState;
  ruleParameters: unknown;
  applicabilityRules: unknown;
  documentRequirements: unknown;
  authorities: readonly { authorityClass: string }[];
  chargedLeaveType: { code: string; status: string } | null;
}

export interface LeaveCatalogueRuleSource {
  failClosed: boolean;
  requiresAgencyConfigurationEvidence: boolean;
  chargedLeaveTypeCode: string | null;
  ruleParameters: LeaveRuleParameters;
  personnelProfiles: readonly LeavePersonnelProfile[];
  requiredEvidenceKinds: readonly LeaveEvidenceKind[];
}

export interface LeavePolicyAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const LEAVE_POLICY_AUDIT_WRITER = Symbol('LEAVE_POLICY_AUDIT_WRITER');

export const leavePolicyAuditWriter: LeavePolicyAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};

export class LeavePolicyServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly reasons: string[] = [],
  ) {
    super(message);
    this.name = 'LeavePolicyServiceError';
  }
}

const versionSelect = {
  id: true,
  agencyId: true,
  leaveTypeId: true,
  versionNo: true,
  entitlementBasis: true,
  calendarBasis: true,
  chargedLeaveTypeId: true,
  evaluatorKind: true,
  ruleParameters: true,
  applicabilityRules: true,
  documentRequirements: true,
  approvalRouteCode: true,
  effectiveFrom: true,
  effectiveTo: true,
  status: true,
  rowVersion: true,
  createdAt: true,
  updatedAt: true,
  chargedLeaveType: { select: { code: true, status: true } },
  authorities: {
    select: {
      id: true,
      authorityClass: true,
      documentId: true,
      documentVersionId: true,
      citation: true,
      validationReason: true,
      createdAt: true,
      document: {
        select: { documentNo: true, documentType: true, classification: true, status: true },
      },
      documentVersion: { select: { versionNo: true } },
    },
  },
} as const;

const leaveTypeSelect = {
  id: true,
  agencyId: true,
  code: true,
  name: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  rowVersion: true,
  currentPolicyVersion: { select: versionSelect },
  versions: { select: versionSelect },
} as const;

type LeavePolicyVersionRecord = Prisma.LeavePolicyVersionGetPayload<{
  select: typeof versionSelect;
}>;
type LeaveTypeRecord = Prisma.LeaveTypeGetPayload<{ select: typeof leaveTypeSelect }>;

function databaseContext(context: RequestContext, transition = false) {
  return requestDatabaseContext(
    context,
    ...(transition ? (['leave-policy-transition'] as const) : []),
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

function periodsOverlap(aFrom: Date, aTo: Date | null, bFrom: Date, bTo: Date | null): boolean {
  const aEnd = aTo ?? new Date(8640000000000000);
  const bEnd = bTo ?? new Date(8640000000000000);
  return aFrom <= bEnd && bFrom <= aEnd;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function readStringArray(value: unknown, key: string): string[] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = (value as Record<string, unknown>)[key];
  if (entry === undefined || entry === null) return [];
  if (!Array.isArray(entry) || entry.some((item) => typeof item !== 'string')) return null;
  return entry as string[];
}

/**
 * Deterministically assesses a stored Leave Policy Version against its fixed
 * catalogue entry. Anything the accepted national sources do not settle, or
 * that would replace a national value, fails closed as INDETERMINATE. Only the
 * version active today requires its charged Leave Type to still be ACTIVE; a
 * superseded version keeps the charge recorded at activation.
 */
export function evaluateLeavePolicyConfiguration(
  entry: LeaveCatalogueRuleSource,
  version: LeavePolicyConfigurationInput,
): LeaveConfigurationAssessment {
  const reasons = new Set<string>();
  if (entry.failClosed) reasons.add('FAIL_CLOSED_PLACEHOLDER');

  const parsedParameters = parseLeaveRuleParameters(version.ruleParameters);
  if (
    !parsedParameters.success ||
    canonicalJson(parsedParameters.data) !== canonicalJson(entry.ruleParameters)
  ) {
    reasons.add('NATIONAL_RULE_PARAMETERS_INVALID');
  }

  const profiles = readStringArray(version.applicabilityRules, 'profiles');
  const excluded = readStringArray(version.applicabilityRules, 'excludedProfiles');
  if (profiles === null || excluded === null || profiles.length === 0) {
    reasons.add('APPLICABILITY_INVALID');
  } else {
    for (const profile of [...profiles, ...excluded]) {
      if (!(LEAVE_PERSONNEL_PROFILES as readonly string[]).includes(profile)) {
        reasons.add('APPLICABILITY_INVALID');
      } else if (!entry.personnelProfiles.includes(profile as LeavePersonnelProfile)) {
        reasons.add(`UNSUPPORTED_PERSONNEL_PROFILE:${profile}`);
      }
    }
    if (profiles.some((profile) => excluded.includes(profile))) {
      reasons.add('APPLICABILITY_CONFLICT');
    }
  }

  const requiredEvidence = readStringArray(version.documentRequirements, 'required');
  const additionalEvidence = readStringArray(version.documentRequirements, 'additional');
  const vocabulary = LEAVE_EVIDENCE_KINDS as readonly string[];
  if (
    requiredEvidence === null ||
    additionalEvidence === null ||
    canonicalJson([...requiredEvidence].sort()) !==
      canonicalJson([...entry.requiredEvidenceKinds].sort()) ||
    [...requiredEvidence, ...additionalEvidence].some((kind) => !vocabulary.includes(kind)) ||
    new Set([...requiredEvidence, ...additionalEvidence]).size !==
      requiredEvidence.length + additionalEvidence.length
  ) {
    reasons.add('DOCUMENT_REQUIREMENTS_INVALID');
  }

  if (!version.authorities.some((authority) => authority.authorityClass === 'NATIONAL_RULE')) {
    reasons.add('MISSING_NATIONAL_RULE_AUTHORITY');
  }
  if (
    entry.requiresAgencyConfigurationEvidence &&
    !version.authorities.some((authority) => authority.authorityClass === 'AGENCY_CONFIGURATION')
  ) {
    reasons.add('MISSING_AGENCY_CONFIGURATION_AUTHORITY');
  }

  if (entry.chargedLeaveTypeCode !== null) {
    if (!version.chargedLeaveType) {
      reasons.add('MISSING_CHARGED_LEAVE_TYPE');
    } else if (version.chargedLeaveType.code !== entry.chargedLeaveTypeCode) {
      reasons.add('INVALID_CHARGED_LEAVE_TYPE');
    } else if (version.status === 'ACTIVE' && version.chargedLeaveType.status !== 'ACTIVE') {
      reasons.add('MISSING_CHARGED_LEAVE_TYPE');
    }
  }

  const ordered = [...reasons].sort();
  return { result: ordered.length === 0 ? 'RESOLVED' : 'INDETERMINATE', reasons: ordered };
}

function activationPolicyFor(entry: {
  failClosed: boolean;
  requiresAgencyConfigurationEvidence: boolean;
}): LeaveActivationPolicy {
  if (entry.failClosed) return 'FAIL_CLOSED_PLACEHOLDER';
  return entry.requiresAgencyConfigurationEvidence
    ? 'REQUIRES_AGENCY_CONFIGURATION'
    : 'FIXED_NATIONAL';
}

function catalogueSummary(code: string): LeaveCatalogueEntrySummary {
  const entry = findLeaveCatalogueEntry(code);
  if (!entry) throw catalogueEntryUnknown();
  return {
    code: entry.code,
    name: entry.name,
    evaluatorKind: entry.evaluatorKind,
    entitlementBasis: entry.entitlementBasis,
    calendarBasis: entry.calendarBasis,
    chargedLeaveTypeCode: entry.chargedLeaveTypeCode,
    activationPolicy: activationPolicyFor(entry),
    personnelProfiles: entry.personnelProfiles,
    requiredEvidenceKinds: entry.requiredEvidenceKinds,
    ruleParameters: entry.ruleParameters,
    authorityCitations: entry.authorityCitations,
    failClosed: entry.failClosed,
  };
}

function authoritySummary(
  record: LeavePolicyVersionRecord['authorities'][number],
): LeavePolicyAuthoritySummary {
  return {
    id: record.id,
    authorityClass: record.authorityClass as LeaveAuthorityClass,
    documentId: record.documentId,
    documentNo: record.document.documentNo,
    documentType: record.document.documentType,
    classification: record.document.classification,
    documentStatus: record.document.status,
    documentVersionId: record.documentVersionId,
    documentVersionNo: record.documentVersion.versionNo,
    citation: record.citation,
    validationReason: record.validationReason,
    createdAt: formatDateTime(record.createdAt),
  };
}

function versionSummary(record: LeavePolicyVersionRecord): LeavePolicyVersionSummary {
  return {
    id: record.id,
    leaveTypeId: record.leaveTypeId,
    versionNo: record.versionNo,
    entitlementBasis: record.entitlementBasis as LeaveEntitlementBasis,
    calendarBasis: record.calendarBasis as LeaveCalendarBasis,
    chargedLeaveTypeId: record.chargedLeaveTypeId,
    chargedLeaveTypeCode: record.chargedLeaveType?.code ?? null,
    evaluatorKind: record.evaluatorKind as LeaveEvaluatorKind,
    ruleParameters: record.ruleParameters as LeaveRuleParameters,
    applicability: {
      profiles: (readStringArray(record.applicabilityRules, 'profiles') ??
        []) as LeavePersonnelProfile[],
      excludedProfiles: (readStringArray(record.applicabilityRules, 'excludedProfiles') ??
        []) as LeavePersonnelProfile[],
    },
    documentRequirements: {
      required: (readStringArray(record.documentRequirements, 'required') ??
        []) as LeaveEvidenceKind[],
      additional: (readStringArray(record.documentRequirements, 'additional') ??
        []) as LeaveEvidenceKind[],
    },
    approvalRouteCode: record.approvalRouteCode,
    effectiveFrom: formatDate(record.effectiveFrom),
    effectiveTo: record.effectiveTo ? formatDate(record.effectiveTo) : null,
    status: record.status as LeavePolicyVersionState,
    authorities: record.authorities.map((authority) => authoritySummary(authority)),
    rowVersion: record.rowVersion,
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt),
  };
}

function sortVersions(records: readonly LeavePolicyVersionRecord[]): LeavePolicyVersionRecord[] {
  return [...records].sort(
    (a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || b.versionNo - a.versionNo,
  );
}

function leaveTypeSummary(record: LeaveTypeRecord): LeaveTypeSummary {
  const versions = sortVersions(record.versions);
  const draft = versions.find((version) => version.status === 'DRAFT') ?? null;
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    status: record.status as LeaveTypeStatus,
    catalogue: catalogueSummary(record.code),
    currentVersion: record.currentPolicyVersion
      ? versionSummary(record.currentPolicyVersion)
      : null,
    draft: draft ? versionSummary(draft) : null,
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt),
  };
}

function versionConfigurationInput(
  version: LeavePolicyVersionRecord,
  status: LeavePolicyVersionState = version.status as LeavePolicyVersionState,
): LeavePolicyConfigurationInput {
  return {
    status,
    ruleParameters: version.ruleParameters,
    applicabilityRules: version.applicabilityRules,
    documentRequirements: version.documentRequirements,
    authorities: version.authorities,
    chargedLeaveType: version.chargedLeaveType,
  };
}

function normalizeApplicability(input: LeaveApplicabilityInput): {
  profiles: LeavePersonnelProfile[];
  excludedProfiles: LeavePersonnelProfile[];
} {
  return {
    profiles: [...new Set(input.profiles)],
    excludedProfiles: [...new Set(input.excludedProfiles ?? [])],
  };
}

@Injectable()
export class LeavePoliciesService {
  constructor(
    @Inject(LEAVE_POLICY_AUDIT_WRITER)
    private readonly auditWriter: LeavePolicyAuditWriter,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
    @Inject(MandatoryLeaveAssessmentsService)
    private readonly mandatoryLeave: MandatoryLeaveAssessmentsService,
  ) {}

  listCatalogue(context: RequestContext): LeaveCatalogueEntrySummary[] {
    this.assertPermission(context, 'leave.types.read', 'LEAVE_TYPE_READ_FORBIDDEN');
    return LEAVE_CATALOGUE.map((entry) => catalogueSummary(entry.code));
  }

  async list(context: RequestContext): Promise<LeaveTypeSummary[]> {
    this.assertPermission(context, 'leave.types.read', 'LEAVE_TYPE_READ_FORBIDDEN');
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const records = await transaction.leaveType.findMany({
        where: { agencyId: context.agencyId },
        orderBy: [{ code: 'asc' }],
        select: leaveTypeSelect,
      });
      return records.map((record) => leaveTypeSummary(record));
    });
  }

  async findById(
    context: RequestContext,
    leaveTypeId: string,
    asOfValue = manilaToday(),
  ): Promise<LeaveTypeDetail | null> {
    this.assertPermission(context, 'leave.types.read', 'LEAVE_TYPE_READ_FORBIDDEN');
    const asOf = toDatabaseDate(asOfValue);
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const record = await transaction.leaveType.findFirst({
        where: { id: leaveTypeId, agencyId: context.agencyId },
        select: leaveTypeSelect,
      });
      if (!record) return null;
      const entry = findLeaveCatalogueEntry(record.code);
      if (!entry) throw catalogueEntryUnknown();
      const versions = sortVersions(record.versions);
      const effective =
        versions.find(
          (version) =>
            (version.status === 'ACTIVE' || version.status === 'SUPERSEDED') &&
            version.effectiveFrom <= asOf &&
            (version.effectiveTo === null || version.effectiveTo >= asOf),
        ) ?? null;
      const configuration = effective
        ? evaluateLeavePolicyConfiguration(entry, versionConfigurationInput(effective))
        : { result: 'INDETERMINATE' as const, reasons: ['NO_EFFECTIVE_POLICY_VERSION'] };
      const events = await transaction.auditEvent.findMany({
        where: {
          agencyId: context.agencyId,
          entityType: 'LeaveType',
          entityId: leaveTypeId,
          action: { startsWith: 'LEAVE_' },
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
        leaveType: leaveTypeSummary(record),
        asOf: asOfValue,
        effective: effective ? versionSummary(effective) : null,
        configuration,
        versions: versions.map((version) => versionSummary(version)),
        history: events.map((event) => ({
          id: event.id,
          action: event.action,
          previousStatus: event.previousStatus,
          newStatus: event.newStatus,
          reason: event.reason,
          effectiveDate: metadataString(event.metadata, 'effectiveDate'),
          occurredAt: formatDateTime(event.occurredAt),
        })),
      };
    });
  }

  async create(context: RequestContext, input: CreateLeaveTypeInput): Promise<LeaveTypeSummary> {
    this.assertPermission(context, 'leave.types.manage', 'LEAVE_TYPE_MANAGE_FORBIDDEN');
    const entry = findLeaveCatalogueEntry(input.catalogueCode);
    if (!entry) throw catalogueEntryUnknown();
    try {
      return await withDatabaseContext(databaseContext(context), async (transaction) => {
        const existing = await transaction.leaveType.findFirst({
          where: { agencyId: context.agencyId, code: entry.code },
          select: { id: true },
        });
        if (existing) throw leaveTypeExists();
        const created = await transaction.leaveType.create({
          data: {
            agencyId: context.agencyId,
            code: entry.code,
            name: entry.name,
            status: 'ACTIVE',
            createdByMembershipId: context.membershipId,
            updatedByMembershipId: context.membershipId,
          },
          select: leaveTypeSelect,
        });
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'LEAVE_TYPE_CREATED',
          entityType: 'LeaveType',
          entityId: created.id,
          newStatus: 'ACTIVE',
          requestId: context.requestId,
          metadata: { catalogueCode: entry.code },
        });
        return leaveTypeSummary(created);
      });
    } catch (error: unknown) {
      if (error instanceof LeavePolicyServiceError) throw error;
      if (isUniqueViolation(error)) throw leaveTypeExists();
      throw error;
    }
  }

  async update(
    context: RequestContext,
    leaveTypeId: string,
    input: UpdateLeaveTypeInput,
  ): Promise<LeaveTypeSummary> {
    this.assertPermission(context, 'leave.types.manage', 'LEAVE_TYPE_MANAGE_FORBIDDEN');
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      const existing = await this.leaveTypeRecord(transaction, context.agencyId, leaveTypeId);
      if (!existing) throw leaveTypeNotFound();
      if (input.rowVersion !== undefined && input.rowVersion !== existing.rowVersion) {
        throw rowVersionConflict();
      }
      const name = input.name?.trim() || existing.name;
      const status = input.status ?? (existing.status as LeaveTypeStatus);
      const updated = await transaction.leaveType.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: leaveTypeId } },
        data: { name, status, updatedByMembershipId: context.membershipId },
        select: leaveTypeSelect,
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'LEAVE_TYPE_UPDATED',
        entityType: 'LeaveType',
        entityId: leaveTypeId,
        previousStatus: existing.status,
        newStatus: status,
        requestId: context.requestId,
        metadata: { previousName: existing.name, name },
      });
      return leaveTypeSummary(updated);
    });
  }

  async createPolicyVersion(
    context: RequestContext,
    leaveTypeId: string,
    input: CreateLeavePolicyVersionInput,
  ): Promise<LeavePolicyVersionSummary> {
    this.assertPermission(context, 'leave.types.manage', 'LEAVE_TYPE_MANAGE_FORBIDDEN');
    const effectiveFrom = toDatabaseDate(input.effectiveDate);
    const approvalRouteCode = input.approvalRouteCode.trim();
    if (!approvalRouteCode) throw approvalRouteRequired();
    const applicability = normalizeApplicability(input.applicability);
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      await this.lockLeaveType(transaction, context.agencyId, leaveTypeId);
      const leaveType = await this.leaveTypeRecord(transaction, context.agencyId, leaveTypeId);
      if (!leaveType) throw leaveTypeNotFound();
      const entry = findLeaveCatalogueEntry(leaveType.code);
      if (!entry) throw catalogueEntryUnknown();
      const draft = leaveType.versions.find((version) => version.status === 'DRAFT');
      if (draft) throw draftExists();
      const chargedLeaveTypeId = await this.resolveChargedLeaveTypeId(
        transaction,
        context.agencyId,
        entry.chargedLeaveTypeCode,
      );
      const versionNo =
        leaveType.versions.reduce((max, version) => Math.max(max, version.versionNo), 0) + 1;
      const created = await transaction.leavePolicyVersion.create({
        data: {
          agencyId: context.agencyId,
          leaveTypeId,
          versionNo,
          entitlementBasis: entry.entitlementBasis,
          calendarBasis: entry.calendarBasis,
          chargedLeaveTypeId,
          evaluatorKind: entry.evaluatorKind,
          ruleParameters: entry.ruleParameters as unknown as Prisma.InputJsonValue,
          applicabilityRules: applicability as unknown as Prisma.InputJsonValue,
          documentRequirements: this.documentRequirements(
            entry.requiredEvidenceKinds,
            input.documentRequirements,
          ) as unknown as Prisma.InputJsonValue,
          approvalRouteCode,
          effectiveFrom,
          status: 'DRAFT',
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
        action: 'LEAVE_POLICY_VERSION_CREATED',
        entityType: 'LeaveType',
        entityId: leaveTypeId,
        reason: input.reason.trim(),
        requestId: context.requestId,
        metadata: {
          versionId: created.id,
          versionNo,
          effectiveDate: input.effectiveDate,
          evaluatorKind: entry.evaluatorKind,
        },
      });
      return versionSummary(created);
    });
  }

  async updatePolicyDraft(
    context: RequestContext,
    leaveTypeId: string,
    versionId: string,
    input: UpdateLeavePolicyDraftInput,
  ): Promise<LeavePolicyVersionSummary> {
    this.assertPermission(context, 'leave.types.manage', 'LEAVE_TYPE_MANAGE_FORBIDDEN');
    const effectiveFrom = toDatabaseDate(input.effectiveDate);
    const approvalRouteCode = input.approvalRouteCode.trim();
    if (!approvalRouteCode) throw approvalRouteRequired();
    const applicability = normalizeApplicability(input.applicability);
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      await this.lockLeaveType(transaction, context.agencyId, leaveTypeId);
      const leaveType = await this.leaveTypeRecord(transaction, context.agencyId, leaveTypeId);
      if (!leaveType) throw leaveTypeNotFound();
      const entry = findLeaveCatalogueEntry(leaveType.code);
      if (!entry) throw catalogueEntryUnknown();
      const draft = leaveType.versions.find(
        (version) => version.id === versionId && version.status === 'DRAFT',
      );
      if (!draft) throw draftNotFound();
      if (input.rowVersion !== undefined && input.rowVersion !== draft.rowVersion) {
        throw rowVersionConflict();
      }
      const updated = await transaction.leavePolicyVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: versionId } },
        data: {
          effectiveFrom,
          approvalRouteCode,
          applicabilityRules: applicability as unknown as Prisma.InputJsonValue,
          documentRequirements: this.documentRequirements(
            entry.requiredEvidenceKinds,
            input.documentRequirements,
          ) as unknown as Prisma.InputJsonValue,
          updatedByMembershipId: context.membershipId,
        },
        select: versionSelect,
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'LEAVE_POLICY_VERSION_UPDATED',
        entityType: 'LeaveType',
        entityId: leaveTypeId,
        previousStatus: 'DRAFT',
        newStatus: 'DRAFT',
        reason: input.reason.trim(),
        requestId: context.requestId,
        metadata: { versionId, effectiveDate: input.effectiveDate },
      });
      return versionSummary(updated);
    });
  }

  async linkAuthority(
    context: RequestContext,
    leaveTypeId: string,
    versionId: string,
    input: LinkLeaveAuthorityInput,
  ): Promise<LeavePolicyVersionSummary> {
    this.assertPermission(context, 'leave.types.manage', 'LEAVE_TYPE_MANAGE_FORBIDDEN');
    this.assertPermission(context, 'documents.evidence.read', 'LEAVE_POLICY_AUTHORITY_FORBIDDEN');
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      await this.lockLeaveType(transaction, context.agencyId, leaveTypeId);
      const draft = await this.draftVersion(transaction, context.agencyId, leaveTypeId, versionId);
      if (!draft) throw draftNotFound();
      const evidence = await this.documentsService.resolveExternalEvidenceInTransaction(
        transaction,
        context,
        {
          documentId: input.documentId,
          allowSensitive: false,
          requirement: 'FINALIZED_VERSION',
        },
      );
      if (!evidence.ok) {
        throw new LeavePolicyServiceError(
          'The authority must be an exact finalized Document Version in this Agency.',
          400,
          'LEAVE_POLICY_AUTHORITY_INELIGIBLE',
          [evidence.reason],
        );
      }
      const version = evidence.document.currentVersion;
      const duplicate = draft.authorities.find(
        (authority) =>
          authority.documentVersionId === version.id &&
          authority.citation === input.citation.trim(),
      );
      if (duplicate) throw authorityExists();
      await transaction.leavePolicyAuthority.create({
        data: {
          agencyId: context.agencyId,
          leavePolicyVersionId: versionId,
          authorityClass: input.authorityClass,
          documentId: evidence.document.id,
          documentVersionId: version.id,
          citation: input.citation.trim(),
          validationReason: input.validationReason?.trim() || null,
          createdByMembershipId: context.membershipId,
        },
      });
      const updated = await this.versionRecord(transaction, context.agencyId, versionId);
      if (!updated) throw draftNotFound();
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'LEAVE_POLICY_AUTHORITY_LINKED',
        entityType: 'LeaveType',
        entityId: leaveTypeId,
        requestId: context.requestId,
        metadata: {
          versionId,
          authorityClass: input.authorityClass,
          documentId: evidence.document.id,
          documentVersionId: version.id,
          documentVersionNo: version.versionNo,
          citation: input.citation.trim(),
        },
      });
      return versionSummary(updated);
    });
  }

  async unlinkAuthority(
    context: RequestContext,
    leaveTypeId: string,
    versionId: string,
    authorityId: string,
  ): Promise<LeavePolicyVersionSummary> {
    this.assertPermission(context, 'leave.types.manage', 'LEAVE_TYPE_MANAGE_FORBIDDEN');
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      await this.lockLeaveType(transaction, context.agencyId, leaveTypeId);
      const draft = await this.draftVersion(transaction, context.agencyId, leaveTypeId, versionId);
      if (!draft) throw draftNotFound();
      const authority = draft.authorities.find((record) => record.id === authorityId);
      if (!authority) throw authorityNotFound();
      await transaction.leavePolicyAuthority.delete({
        where: { agencyId_id: { agencyId: context.agencyId, id: authorityId } },
      });
      const updated = await this.versionRecord(transaction, context.agencyId, versionId);
      if (!updated) throw draftNotFound();
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'LEAVE_POLICY_AUTHORITY_UNLINKED',
        entityType: 'LeaveType',
        entityId: leaveTypeId,
        requestId: context.requestId,
        metadata: {
          versionId,
          authorityId,
          authorityClass: authority.authorityClass,
          documentVersionId: authority.documentVersionId,
        },
      });
      return versionSummary(updated);
    });
  }

  async activate(
    context: RequestContext,
    leaveTypeId: string,
    versionId: string,
    reason: string,
    rawIdempotencyKey?: string,
  ): Promise<LeaveTypeSummary> {
    this.assertPermission(context, 'leave.types.manage', 'LEAVE_TYPE_MANAGE_FORBIDDEN');
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw activationReasonRequired();
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockLeaveType(transaction, context.agencyId, leaveTypeId);
      if (idempotencyKey) {
        const completed = await transaction.auditEvent.findFirst({
          where: {
            agencyId: context.agencyId,
            action: 'LEAVE_POLICY_VERSION_ACTIVATED',
            entityId: leaveTypeId,
            idempotencyKey,
          },
          select: { reason: true, metadata: true },
        });
        if (completed) {
          if (
            completed.reason !== normalizedReason ||
            metadataString(completed.metadata, 'versionId') !== versionId
          ) {
            throw idempotencyConflict();
          }
          const existing = await this.leaveTypeRecord(transaction, context.agencyId, leaveTypeId);
          if (!existing) throw idempotencyConflict();
          return leaveTypeSummary(existing);
        }
      }
      const leaveType = await this.leaveTypeRecord(transaction, context.agencyId, leaveTypeId);
      if (!leaveType) throw leaveTypeNotFound();
      const entry = findLeaveCatalogueEntry(leaveType.code);
      if (!entry) throw catalogueEntryUnknown();
      const draft = leaveType.versions.find(
        (version) => version.id === versionId && version.status === 'DRAFT',
      );
      if (!draft) throw draftNotFound();
      const assessment = evaluateLeavePolicyConfiguration(
        entry,
        versionConfigurationInput(draft, 'ACTIVE'),
      );
      if (assessment.result === 'INDETERMINATE') {
        throw new LeavePolicyServiceError(
          'The Leave Policy Version cannot deterministically drive leave assessment.',
          409,
          'LEAVE_POLICY_INDETERMINATE',
          assessment.reasons,
        );
      }
      const published = leaveType.versions.filter(
        (version) => version.status === 'ACTIVE' || version.status === 'SUPERSEDED',
      );
      const predecessor = published
        .filter((version) => version.effectiveFrom < draft.effectiveFrom)
        .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
      if (published.length > 0 && !predecessor) throw periodOverlap();
      if (predecessor && predecessor.status !== 'ACTIVE') throw predecessorInvalid();
      if (
        predecessor &&
        predecessor.effectiveTo &&
        predecessor.effectiveTo < addDays(draft.effectiveFrom, -1)
      ) {
        throw predecessorInvalid();
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
        throw periodOverlap();
      }
      if (predecessor) {
        await transaction.leavePolicyVersion.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: predecessor.id } },
          data: {
            status: 'SUPERSEDED',
            effectiveTo: addDays(draft.effectiveFrom, -1),
            updatedByMembershipId: context.membershipId,
          },
        });
      }
      await transaction.leavePolicyVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: draft.id } },
        data: {
          status: 'ACTIVE',
          effectiveTo: null,
          updatedByMembershipId: context.membershipId,
        },
      });
      await this.refreshCurrentProjection(transaction, context.agencyId, leaveTypeId);
      if (leaveType.code === 'MANDATORY_LEAVE') {
        await this.mandatoryLeave.reevaluateAgency(transaction, context, draft.effectiveFrom);
      }
      const result = await this.leaveTypeRecord(transaction, context.agencyId, leaveTypeId);
      if (!result) throw leaveTypeNotFound();
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'LEAVE_POLICY_VERSION_ACTIVATED',
        entityType: 'LeaveType',
        entityId: leaveTypeId,
        previousStatus: 'DRAFT',
        newStatus: 'ACTIVE',
        reason: normalizedReason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          versionId: draft.id,
          predecessorId: predecessor?.id ?? null,
          effectiveDate: formatDate(draft.effectiveFrom),
          nationalRuleAuthorityCount: draft.authorities.filter(
            (authority) => authority.authorityClass === 'NATIONAL_RULE',
          ).length,
          agencyConfigurationAuthorityCount: draft.authorities.filter(
            (authority) => authority.authorityClass === 'AGENCY_CONFIGURATION',
          ).length,
        },
      });
      return leaveTypeSummary(result);
    });
  }

  private documentRequirements(
    required: readonly LeaveEvidenceKind[],
    input: LeaveDocumentRequirementsInput,
  ): { required: LeaveEvidenceKind[]; additional: LeaveEvidenceKind[] } {
    const additional = [...new Set(input.additional ?? [])].filter(
      (kind) => !required.includes(kind),
    );
    return { required: [...required], additional };
  }

  private async resolveChargedLeaveTypeId(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    code: string | null,
  ): Promise<string | null> {
    if (code === null) return null;
    const charged = await transaction.leaveType.findFirst({
      where: { agencyId, code },
      select: { id: true },
    });
    if (!charged) {
      throw new LeavePolicyServiceError(
        `Create the ${code} Leave Type before this Leave Policy Version.`,
        409,
        'LEAVE_POLICY_CHARGED_TYPE_REQUIRED',
        [`CHARGED_LEAVE_TYPE_REQUIRED:${code}`],
      );
    }
    return charged.id;
  }

  private async refreshCurrentProjection(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    leaveTypeId: string,
  ): Promise<void> {
    const today = todayDate();
    const current = await transaction.leavePolicyVersion.findFirst({
      where: {
        agencyId,
        leaveTypeId,
        status: { in: ['ACTIVE', 'SUPERSEDED'] },
        effectiveFrom: { lte: today },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: { id: true },
    });
    await transaction.leaveType.update({
      where: { agencyId_id: { agencyId, id: leaveTypeId } },
      data: { currentPolicyVersionId: current?.id ?? null },
    });
  }

  private async lockLeaveType(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    leaveTypeId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "leave_types" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${leaveTypeId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) throw leaveTypeNotFound();
  }

  private async leaveTypeRecord(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    leaveTypeId: string,
  ): Promise<LeaveTypeRecord | null> {
    return transaction.leaveType.findFirst({
      where: { agencyId, id: leaveTypeId },
      select: leaveTypeSelect,
    });
  }

  private async draftVersion(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    leaveTypeId: string,
    versionId: string,
  ): Promise<LeavePolicyVersionRecord | null> {
    return transaction.leavePolicyVersion.findFirst({
      where: { agencyId, id: versionId, leaveTypeId, status: 'DRAFT' },
      select: versionSelect,
    });
  }

  private async versionRecord(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    versionId: string,
  ): Promise<LeavePolicyVersionRecord | null> {
    return transaction.leavePolicyVersion.findFirst({
      where: { agencyId, id: versionId },
      select: versionSelect,
    });
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (!hasPermission(context, permission)) {
      throw new LeavePolicyServiceError(`The ${permission} permission is required.`, 403, code);
    }
  }
}

function metadataString(metadata: Prisma.JsonValue, key: string): string | null {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function catalogueEntryUnknown(): LeavePolicyServiceError {
  return new LeavePolicyServiceError(
    'The request does not match a government leave catalogue entry.',
    400,
    'LEAVE_CATALOGUE_ENTRY_UNKNOWN',
  );
}

function leaveTypeExists(): LeavePolicyServiceError {
  return new LeavePolicyServiceError(
    'This Agency already maintains a Leave Type for the catalogue entry.',
    409,
    'LEAVE_TYPE_EXISTS',
  );
}

function leaveTypeNotFound(): LeavePolicyServiceError {
  return new LeavePolicyServiceError(
    'The Leave Type could not be found.',
    404,
    'LEAVE_TYPE_NOT_FOUND',
  );
}

function draftExists(): LeavePolicyServiceError {
  return new LeavePolicyServiceError(
    'A Leave Policy Version draft already exists for this Leave Type.',
    409,
    'LEAVE_POLICY_DRAFT_EXISTS',
  );
}

function draftNotFound(): LeavePolicyServiceError {
  return new LeavePolicyServiceError(
    'The draft Leave Policy Version could not be found.',
    404,
    'LEAVE_POLICY_DRAFT_NOT_FOUND',
  );
}

function authorityExists(): LeavePolicyServiceError {
  return new LeavePolicyServiceError(
    'That exact Document Version is already linked to this Leave Policy Version.',
    409,
    'LEAVE_POLICY_AUTHORITY_EXISTS',
  );
}

function authorityNotFound(): LeavePolicyServiceError {
  return new LeavePolicyServiceError(
    'The Leave Policy authority could not be found.',
    404,
    'LEAVE_POLICY_AUTHORITY_NOT_FOUND',
  );
}

function rowVersionConflict(): LeavePolicyServiceError {
  return new LeavePolicyServiceError(
    'The record changed since it was loaded. Reload and retry.',
    409,
    'ROW_VERSION_CONFLICT',
  );
}

function periodOverlap(): LeavePolicyServiceError {
  return new LeavePolicyServiceError(
    'Leave Policy Version effective periods cannot overlap.',
    409,
    'LEAVE_POLICY_PERIOD_OVERLAP',
  );
}

function predecessorInvalid(): LeavePolicyServiceError {
  return new LeavePolicyServiceError(
    'The new Leave Policy Version does not follow the current published period.',
    409,
    'LEAVE_POLICY_PREDECESSOR_INVALID',
  );
}

function activationReasonRequired(): LeavePolicyServiceError {
  return new LeavePolicyServiceError(
    'A reason for Leave Policy Version activation is required.',
    400,
    'LEAVE_POLICY_ACTIVATION_REASON_REQUIRED',
  );
}

function idempotencyConflict(): LeavePolicyServiceError {
  return new LeavePolicyServiceError(
    'The Idempotency-Key was already used with different input.',
    409,
    'IDEMPOTENCY_CONFLICT',
  );
}

function dateInvalid(): LeavePolicyServiceError {
  return new LeavePolicyServiceError(
    'Enter a valid calendar date.',
    400,
    'LEAVE_POLICY_DATE_INVALID',
  );
}

function approvalRouteRequired(): LeavePolicyServiceError {
  return new LeavePolicyServiceError(
    'Enter the Approval Route code this Leave Policy Version follows.',
    400,
    'LEAVE_POLICY_ROUTE_REQUIRED',
  );
}
