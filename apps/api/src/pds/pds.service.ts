import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import {
  PDS_FORM_VERSION,
  PDS_CITIZENSHIP_COUNTRIES,
  pdsPersonalDetailsSchema,
  type PdsCreateInput,
  type PdsFamilyInput,
  type PdsPersonalDetailsInput,
  type PdsUpdateInput,
} from './pds.schemas';

export type PdsVersionState = 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'CERTIFIED' | 'SUPERSEDED';

export type PdsFieldScope = 'FULL' | 'REDACTED';

export interface PdsPersonalDetailsView {
  surname: string | null;
  firstName: string | null;
  nameExtension: string | null;
  middleName: string | null;
  birthDate: string | null;
  birthPlace: string | null;
  sex: string | null;
  civilStatus: string | null;
  civilStatusDetail: string | null;
  heightMeters: number | null;
  weightKilograms: number | null;
  bloodType: string | null;
  umidIdNumber: string | null;
  pagibigIdNumber: string | null;
  philhealthNumber: string | null;
  philSysCardNumber: string | null;
  tinNumber: string | null;
  agencyEmployeeNumber: string | null;
  citizenship: string | null;
  dualCitizenshipType: string | null;
  dualCitizenshipCountry: string | null;
  residentialAddress: Record<string, unknown> | null;
  permanentAddress: Record<string, unknown> | null;
  telephoneNumber: string | null;
  mobileNumber: string | null;
  emailAddress: string | null;
}

export interface PdsFamilyRecordView {
  id: string;
  relationshipType: 'SPOUSE' | 'CHILD' | 'FATHER' | 'MOTHER';
  sequenceNo: number;
  fullName: string | null;
  surname: string | null;
  firstName: string | null;
  middleName: string | null;
  nameExtension: string | null;
  birthDate: string | null;
  occupation: string | null;
  employerBusinessName: string | null;
  businessAddress: Record<string, unknown> | null;
  telephoneNumber: string | null;
}

export interface PdsFamilyView {
  spouse: PdsFamilyRecordView | null;
  children: PdsFamilyRecordView[];
  father: PdsFamilyRecordView | null;
  mother: PdsFamilyRecordView | null;
}

export interface PdsVersionSummary {
  id: string;
  employeeId: string;
  versionNo: number;
  formVersion: string;
  asOfDate: string;
  status: PdsVersionState;
  supersedesVersionId: string | null;
  correctionReason: string | null;
  createdByMembershipId: string;
  createdAt: string;
  updatedByMembershipId: string;
  updatedAt: string;
  rowVersion: number;
  fieldScope: PdsFieldScope;
}

export interface PdsVersionDetail extends PdsVersionSummary {
  personal: PdsPersonalDetailsView | null;
  family: PdsFamilyView;
}

export interface PdsVersionList {
  employeeId: string;
  citizenshipCountries: readonly string[];
  current: PdsVersionSummary | null;
  draft: PdsVersionSummary | null;
  versions: PdsVersionSummary[];
}

export interface PdsAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const PDS_AUDIT_WRITER = Symbol('PDS_AUDIT_WRITER');

export const pdsAuditWriter: PdsAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};

const PDS_VERSION_LIST_LIMIT = 200;

export class PdsServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PdsServiceError';
  }
}

const pdsSummarySelect = {
  id: true,
  agencyId: true,
  employeeId: true,
  versionNo: true,
  formVersion: true,
  asOfDate: true,
  status: true,
  supersedesVersionId: true,
  correctionReason: true,
  createdByMembershipId: true,
  createdAt: true,
  updatedByMembershipId: true,
  updatedAt: true,
  rowVersion: true,
} satisfies Prisma.PdsVersionSelect;

const pdsSummaryWithOwnerSelect = {
  ...pdsSummarySelect,
  employee: { select: { memberships: { select: { userId: true } } } },
} satisfies Prisma.PdsVersionSelect;

const pdsSelect = {
  ...pdsSummaryWithOwnerSelect,
  personalDetails: {
    select: {
      surname: true,
      firstName: true,
      nameExtension: true,
      middleName: true,
      birthDate: true,
      birthPlace: true,
      sex: true,
      civilStatus: true,
      civilStatusDetail: true,
      heightMeters: true,
      weightKilograms: true,
      bloodType: true,
      umidIdNumber: true,
      pagibigIdNumber: true,
      philhealthNumber: true,
      philSysCardNumber: true,
      tinNumber: true,
      agencyEmployeeNumber: true,
      citizenship: true,
      dualCitizenshipType: true,
      dualCitizenshipCountry: true,
      residentialAddress: true,
      permanentAddress: true,
      telephoneNumber: true,
      mobileNumber: true,
      emailAddress: true,
    },
  },
  familyRecords: {
    orderBy: [{ relationshipType: 'asc' }, { sequenceNo: 'asc' }],
    select: {
      id: true,
      relationshipType: true,
      sequenceNo: true,
      fullName: true,
      surname: true,
      firstName: true,
      middleName: true,
      nameExtension: true,
      birthDate: true,
      occupation: true,
      employerBusinessName: true,
      businessAddress: true,
      telephoneNumber: true,
    },
  },
} satisfies Prisma.PdsVersionSelect;

type PdsRecord = Prisma.PdsVersionGetPayload<{ select: typeof pdsSelect }>;
type PdsSummaryRecord = Prisma.PdsVersionGetPayload<{ select: typeof pdsSummarySelect }>;

function formatDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function formatDateTime(value: Date): string {
  return value.toISOString();
}

function jsonObject(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  return normalized || null;
}

function databaseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new PdsServiceError('The PDS date is invalid.', 400, 'PDS_DATE_INVALID');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new PdsServiceError('The PDS date is invalid.', 400, 'PDS_DATE_INVALID');
  }
  return date;
}

function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function address(value: { [key: string]: string | null | undefined } | null | undefined) {
  if (!value) return Prisma.JsonNull;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, item ?? null]),
  ) as Prisma.InputJsonValue;
}

function displayName(value: {
  surname: string;
  firstName: string;
  middleName?: string | null | undefined;
  nameExtension?: string | null | undefined;
}): string {
  return [value.firstName, value.middleName, value.surname, value.nameExtension]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(' ');
}

function personalCreateData(
  agencyId: string,
  pdsVersionId: string,
  input: PdsPersonalDetailsInput | undefined,
): Prisma.PdsPersonalDetailsUncheckedCreateInput {
  return {
    agencyId,
    pdsVersionId,
    surname: text(input?.surname),
    firstName: text(input?.firstName),
    nameExtension: text(input?.nameExtension),
    middleName: text(input?.middleName),
    birthDate: input?.birthDate ? databaseDate(input.birthDate) : null,
    birthPlace: text(input?.birthPlace),
    sex: input?.sex ?? null,
    civilStatus: input?.civilStatus ?? null,
    civilStatusDetail: text(input?.civilStatusDetail),
    heightMeters:
      input?.heightMeters === undefined || input.heightMeters === null
        ? null
        : new Prisma.Decimal(input.heightMeters),
    weightKilograms:
      input?.weightKilograms === undefined || input.weightKilograms === null
        ? null
        : new Prisma.Decimal(input.weightKilograms),
    bloodType: text(input?.bloodType),
    umidIdNumber: text(input?.umidIdNumber),
    pagibigIdNumber: text(input?.pagibigIdNumber),
    philhealthNumber: text(input?.philhealthNumber),
    philSysCardNumber: text(input?.philSysCardNumber),
    tinNumber: text(input?.tinNumber),
    agencyEmployeeNumber: text(input?.agencyEmployeeNumber),
    citizenship: input?.citizenship ?? null,
    dualCitizenshipType: input?.dualCitizenshipType ?? null,
    dualCitizenshipCountry: input?.dualCitizenshipCountry ?? null,
    residentialAddress: address(input?.residentialAddress),
    permanentAddress: address(input?.permanentAddress),
    telephoneNumber: text(input?.telephoneNumber),
    mobileNumber: text(input?.mobileNumber),
    emailAddress: text(input?.emailAddress),
  };
}

function personalUpdateData(
  input: PdsPersonalDetailsInput,
): Prisma.PdsPersonalDetailsUncheckedUpdateInput {
  const data: Prisma.PdsPersonalDetailsUncheckedUpdateInput = {};
  if ('surname' in input) data.surname = text(input.surname);
  if ('firstName' in input) data.firstName = text(input.firstName);
  if ('nameExtension' in input) data.nameExtension = text(input.nameExtension);
  if ('middleName' in input) data.middleName = text(input.middleName);
  if ('birthDate' in input) data.birthDate = input.birthDate ? databaseDate(input.birthDate) : null;
  if ('birthPlace' in input) data.birthPlace = text(input.birthPlace);
  if ('sex' in input) data.sex = input.sex ?? null;
  if ('civilStatus' in input) {
    data.civilStatus = input.civilStatus ?? null;
    if (input.civilStatus !== 'OTHER') data.civilStatusDetail = null;
  }
  if ('civilStatusDetail' in input) data.civilStatusDetail = text(input.civilStatusDetail);
  if ('heightMeters' in input && input.heightMeters !== undefined) {
    data.heightMeters = input.heightMeters === null ? null : new Prisma.Decimal(input.heightMeters);
  }
  if ('weightKilograms' in input && input.weightKilograms !== undefined) {
    data.weightKilograms =
      input.weightKilograms === null ? null : new Prisma.Decimal(input.weightKilograms);
  }
  if ('bloodType' in input) data.bloodType = text(input.bloodType);
  if ('umidIdNumber' in input) data.umidIdNumber = text(input.umidIdNumber);
  if ('pagibigIdNumber' in input) data.pagibigIdNumber = text(input.pagibigIdNumber);
  if ('philhealthNumber' in input) data.philhealthNumber = text(input.philhealthNumber);
  if ('philSysCardNumber' in input) data.philSysCardNumber = text(input.philSysCardNumber);
  if ('tinNumber' in input) data.tinNumber = text(input.tinNumber);
  if ('agencyEmployeeNumber' in input) data.agencyEmployeeNumber = text(input.agencyEmployeeNumber);
  if ('citizenship' in input) {
    data.citizenship = input.citizenship ?? null;
    if (input.citizenship !== 'DUAL_CITIZENSHIP') {
      data.dualCitizenshipType = null;
      data.dualCitizenshipCountry = null;
    }
  }
  if ('dualCitizenshipType' in input) data.dualCitizenshipType = input.dualCitizenshipType ?? null;
  if ('dualCitizenshipCountry' in input)
    data.dualCitizenshipCountry = input.dualCitizenshipCountry ?? null;
  if ('residentialAddress' in input) data.residentialAddress = address(input.residentialAddress);
  if ('permanentAddress' in input) data.permanentAddress = address(input.permanentAddress);
  if ('telephoneNumber' in input) data.telephoneNumber = text(input.telephoneNumber);
  if ('mobileNumber' in input) data.mobileNumber = text(input.mobileNumber);
  if ('emailAddress' in input) data.emailAddress = text(input.emailAddress);
  return data;
}

function familyCreateData(
  agencyId: string,
  pdsVersionId: string,
  input: PdsFamilyInput,
): Prisma.PdsFamilyRecordCreateManyInput[] {
  const records: Prisma.PdsFamilyRecordCreateManyInput[] = [];
  const sequences = new Set<string>();
  const add = (record: Prisma.PdsFamilyRecordCreateManyInput) => {
    const key = `${record.relationshipType}:${record.sequenceNo}`;
    if (sequences.has(key)) {
      throw new PdsServiceError(
        'Family record sequence numbers must be unique within this PDS.',
        400,
        'PDS_FAMILY_SEQUENCE_CONFLICT',
      );
    }
    sequences.add(key);
    records.push(record);
  };

  if (input.spouse) {
    add({
      agencyId,
      pdsVersionId,
      relationshipType: 'SPOUSE',
      sequenceNo: 1,
      fullName: displayName(input.spouse),
      surname: text(input.spouse.surname),
      firstName: text(input.spouse.firstName),
      middleName: text(input.spouse.middleName),
      nameExtension: text(input.spouse.nameExtension),
      occupation: text(input.spouse.occupation),
      employerBusinessName: text(input.spouse.employerBusinessName),
      businessAddress: address(input.spouse.businessAddress),
      telephoneNumber: text(input.spouse.telephoneNumber),
    });
  }
  for (const [index, child] of (input.children ?? []).entries()) {
    add({
      agencyId,
      pdsVersionId,
      relationshipType: 'CHILD',
      sequenceNo: child.sequenceNo ?? index + 1,
      fullName: text(child.fullName),
      birthDate: databaseDate(child.birthDate),
    });
  }
  if (input.father) {
    add({
      agencyId,
      pdsVersionId,
      relationshipType: 'FATHER',
      sequenceNo: 1,
      fullName: displayName(input.father),
      surname: text(input.father.surname),
      firstName: text(input.father.firstName),
      middleName: text(input.father.middleName),
      nameExtension: text(input.father.nameExtension),
    });
  }
  if (input.mother) {
    add({
      agencyId,
      pdsVersionId,
      relationshipType: 'MOTHER',
      sequenceNo: 1,
      fullName: displayName(input.mother),
      surname: text(input.mother.surname),
      firstName: text(input.mother.firstName),
      middleName: text(input.mother.middleName),
    });
  }
  return records;
}

function personalView(record: PdsRecord['personalDetails']): PdsPersonalDetailsView | null {
  if (!record) return null;
  return {
    surname: record.surname,
    firstName: record.firstName,
    nameExtension: record.nameExtension,
    middleName: record.middleName,
    birthDate: formatDate(record.birthDate),
    birthPlace: record.birthPlace,
    sex: record.sex,
    civilStatus: record.civilStatus,
    civilStatusDetail: record.civilStatusDetail,
    heightMeters: record.heightMeters?.toNumber() ?? null,
    weightKilograms: record.weightKilograms?.toNumber() ?? null,
    bloodType: record.bloodType,
    umidIdNumber: record.umidIdNumber,
    pagibigIdNumber: record.pagibigIdNumber,
    philhealthNumber: record.philhealthNumber,
    philSysCardNumber: record.philSysCardNumber,
    tinNumber: record.tinNumber,
    agencyEmployeeNumber: record.agencyEmployeeNumber,
    citizenship: record.citizenship,
    dualCitizenshipType: record.dualCitizenshipType,
    dualCitizenshipCountry: record.dualCitizenshipCountry,
    residentialAddress: jsonObject(record.residentialAddress),
    permanentAddress: jsonObject(record.permanentAddress),
    telephoneNumber: record.telephoneNumber,
    mobileNumber: record.mobileNumber,
    emailAddress: record.emailAddress,
  };
}

function familyRecordView(record: PdsRecord['familyRecords'][number]): PdsFamilyRecordView {
  return {
    id: record.id,
    relationshipType: record.relationshipType as PdsFamilyRecordView['relationshipType'],
    sequenceNo: record.sequenceNo,
    fullName: record.fullName,
    surname: record.surname,
    firstName: record.firstName,
    middleName: record.middleName,
    nameExtension: record.nameExtension,
    birthDate: formatDate(record.birthDate),
    occupation: record.occupation,
    employerBusinessName: record.employerBusinessName,
    businessAddress: jsonObject(record.businessAddress),
    telephoneNumber: record.telephoneNumber,
  };
}

function familyView(records: PdsRecord['familyRecords']): PdsFamilyView {
  const views = records.map(familyRecordView);
  return {
    spouse: views.find((record) => record.relationshipType === 'SPOUSE') ?? null,
    children: views.filter((record) => record.relationshipType === 'CHILD'),
    father: views.find((record) => record.relationshipType === 'FATHER') ?? null,
    mother: views.find((record) => record.relationshipType === 'MOTHER') ?? null,
  };
}

function summary(record: PdsSummaryRecord, fieldScope: PdsFieldScope): PdsVersionSummary {
  return {
    id: record.id,
    employeeId: record.employeeId,
    versionNo: record.versionNo,
    formVersion: record.formVersion,
    asOfDate: formatDate(record.asOfDate) as string,
    status: record.status as PdsVersionState,
    supersedesVersionId: record.supersedesVersionId,
    correctionReason: record.correctionReason,
    createdByMembershipId: record.createdByMembershipId,
    createdAt: formatDateTime(record.createdAt),
    updatedByMembershipId: record.updatedByMembershipId,
    updatedAt: formatDateTime(record.updatedAt),
    rowVersion: record.rowVersion,
    fieldScope,
  };
}

function currentVersion(versions: readonly PdsVersionSummary[]): PdsVersionSummary | null {
  return (
    versions.find((version) => version.status === 'CERTIFIED') ??
    versions.find((version) => version.status !== 'SUPERSEDED') ??
    versions[0] ??
    null
  );
}

function detail(record: PdsRecord, fieldScope: PdsFieldScope): PdsVersionDetail {
  return {
    ...summary(record, fieldScope),
    personal: fieldScope === 'FULL' ? personalView(record.personalDetails) : null,
    family:
      fieldScope === 'FULL'
        ? familyView(record.familyRecords)
        : { spouse: null, children: [], father: null, mother: null },
  };
}

function redactedDetail(record: PdsSummaryRecord, fieldScope: PdsFieldScope): PdsVersionDetail {
  return {
    ...summary(record, fieldScope),
    personal: null,
    family: { spouse: null, children: [], father: null, mother: null },
  };
}

function ownerUserId(record: Pick<PdsRecord, 'employee'>): string | null {
  return record.employee.memberships[0]?.userId ?? null;
}

function hasPermissionGrant(context: RequestContext, permission: string): boolean {
  return context.permissions.some((grant) => grant.code === permission);
}

function permissionScope(context: RequestContext, permission: string): 'AGENCY' | 'OWN' | null {
  if (
    context.permissions.some(
      (candidate) => candidate.code === permission && candidate.scopePolicy === 'AGENCY',
    )
  ) {
    return 'AGENCY';
  }
  return context.permissions.some(
    (candidate) => candidate.code === permission && candidate.scopePolicy === 'OWN',
  )
    ? 'OWN'
    : null;
}

function readFieldScope(
  context: RequestContext,
  employeeOwnerUserId: string | null,
): PdsFieldScope | null {
  if (!hasPermissionGrant(context, 'personnel.pds.read')) return null;
  const scope = permissionScope(context, 'personnel.pds.read');
  if (scope === 'AGENCY') return 'FULL';
  if (scope === 'OWN' && employeeOwnerUserId === context.userId) return 'FULL';
  if (scope === 'OWN' && !hasNonOwnReadScope(context)) return null;
  return 'REDACTED';
}

function hasNonOwnReadScope(context: RequestContext): boolean {
  return context.permissions.some(
    (candidate) =>
      candidate.code === 'personnel.pds.read' &&
      candidate.scopePolicy !== 'AGENCY' &&
      candidate.scopePolicy !== 'OWN',
  );
}

function canAccess(
  context: RequestContext,
  permission: string,
  employeeOwnerUserId: string | null,
): boolean {
  const scope = permissionScope(context, permission);
  return scope === 'AGENCY' || (scope === 'OWN' && employeeOwnerUserId === context.userId);
}

function databaseContext(context: RequestContext, pdsMutation = false) {
  return {
    agencyId: context.agencyId,
    userId: context.userId,
    membershipId: context.membershipId,
    pdsMutation,
  };
}

@Injectable()
export class PdsService {
  constructor(@Inject(PDS_AUDIT_WRITER) private readonly auditWriter: PdsAuditWriter) {}

  async list(context: RequestContext, employeeId: string): Promise<PdsVersionList> {
    this.assertContext(context, 'personnel.pds.read', 'PDS_READ_FORBIDDEN');
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      return this.listInTransaction(transaction, context, employeeId);
    });
  }

  async listOwn(context: RequestContext): Promise<PdsVersionList> {
    this.assertContext(context, 'personnel.pds.read', 'PDS_READ_FORBIDDEN');
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const employeeId = await this.ownEmployeeId(transaction, context);
      if (!employeeId) throw this.notFound();
      return this.listInTransaction(transaction, context, employeeId);
    });
  }

  async findById(context: RequestContext, pdsVersionId: string): Promise<PdsVersionDetail | null> {
    this.assertContext(context, 'personnel.pds.read', 'PDS_READ_FORBIDDEN');
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const summaryRecord = await transaction.pdsVersion.findFirst({
        where: { agencyId: context.agencyId, id: pdsVersionId },
        select: pdsSummaryWithOwnerSelect,
      });
      if (!summaryRecord) return null;
      const fieldScope = readFieldScope(context, ownerUserId(summaryRecord));
      if (!fieldScope) return null;
      await this.auditRead(transaction, context, pdsVersionId, fieldScope, 'DETAIL');
      if (fieldScope === 'REDACTED') return redactedDetail(summaryRecord, fieldScope);
      const record = await transaction.pdsVersion.findFirst({
        where: { agencyId: context.agencyId, id: pdsVersionId },
        select: pdsSelect,
      });
      return record ? detail(record, fieldScope) : null;
    });
  }

  async create(context: RequestContext, input: PdsCreateInput): Promise<PdsVersionDetail> {
    this.assertContext(context, 'personnel.pds.update', 'PDS_UPDATE_FORBIDDEN');
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      const employeeId = input.employeeId ?? (await this.ownEmployeeId(transaction, context));
      if (!employeeId) throw this.employeeRequired();
      await this.lockEmployee(transaction, context.agencyId, employeeId);
      const employee = await transaction.employee.findUnique({
        where: { agencyId_id: { agencyId: context.agencyId, id: employeeId } },
        select: { id: true, memberships: { select: { userId: true } } },
      });
      if (!employee) throw this.notFound();
      if (!canAccess(context, 'personnel.pds.update', employee.memberships[0]?.userId ?? null)) {
        throw this.notFound();
      }
      const existing = await transaction.pdsVersion.findFirst({
        where: { agencyId: context.agencyId, employeeId, status: { in: ['DRAFT', 'RETURNED'] } },
        select: pdsSelect,
      });
      if (existing) return detail(existing, 'FULL');

      const latest = await transaction.pdsVersion.findFirst({
        where: { agencyId: context.agencyId, employeeId },
        orderBy: { versionNo: 'desc' },
        select: { id: true, versionNo: true },
      });
      const created = await transaction.pdsVersion.create({
        data: {
          agencyId: context.agencyId,
          employeeId,
          versionNo: (latest?.versionNo ?? 0) + 1,
          formVersion: PDS_FORM_VERSION,
          asOfDate: databaseDate(input.asOfDate ?? today()),
          status: 'DRAFT',
          supersedesVersionId: latest?.id ?? null,
          createdByMembershipId: context.membershipId,
          updatedByMembershipId: context.membershipId,
        },
        select: { id: true },
      });
      await transaction.pdsPersonalDetails.create({
        data: personalCreateData(context.agencyId, created.id, input.personal),
      });
      if (input.family) {
        const records = familyCreateData(context.agencyId, created.id, input.family);
        if (records.length) await transaction.pdsFamilyRecord.createMany({ data: records });
      }
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'PDS_VERSION_CREATED',
        entityType: 'PdsVersion',
        entityId: created.id,
        previousStatus: 'None',
        newStatus: 'DRAFT',
        requestId: context.requestId,
        metadata: {
          employeeId,
          formVersion: PDS_FORM_VERSION,
          versionNo: (latest?.versionNo ?? 0) + 1,
          asOfDate: input.asOfDate ?? today(),
        },
      });
      const record = await this.record(transaction, context.agencyId, created.id);
      if (!record) throw this.notFound();
      return detail(record, 'FULL');
    });
  }

  async update(
    context: RequestContext,
    pdsVersionId: string,
    input: PdsUpdateInput,
  ): Promise<PdsVersionDetail> {
    this.assertContext(context, 'personnel.pds.update', 'PDS_UPDATE_FORBIDDEN');
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockVersion(transaction, context.agencyId, pdsVersionId);
      const existing = await this.record(transaction, context.agencyId, pdsVersionId);
      if (!existing) throw this.notFound();
      if (!canAccess(context, 'personnel.pds.update', ownerUserId(existing))) throw this.notFound();
      if (!['DRAFT', 'RETURNED'].includes(existing.status)) throw this.immutable();
      if (input.rowVersion !== undefined && input.rowVersion !== existing.rowVersion) {
        throw new PdsServiceError(
          'This PDS Draft changed. Reload it before saving.',
          409,
          'PDS_STALE_VERSION',
        );
      }

      const versionData: Prisma.PdsVersionUncheckedUpdateInput = {
        updatedByMembershipId: context.membershipId,
      };
      if (input.asOfDate !== undefined) versionData.asOfDate = databaseDate(input.asOfDate);
      await transaction.pdsVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: pdsVersionId } },
        data: versionData,
      });

      if (input.personal) {
        const currentPersonal = personalView(existing.personalDetails);
        const parsedPersonal = pdsPersonalDetailsSchema.safeParse({
          ...(currentPersonal ?? {}),
          ...input.personal,
        });
        if (!parsedPersonal.success) {
          throw new PdsServiceError(
            parsedPersonal.error.issues[0]?.message ?? 'The PDS personal details are invalid.',
            400,
            'PDS_PERSONAL_INVALID',
          );
        }
        await transaction.pdsPersonalDetails.upsert({
          where: { pdsVersionId },
          create: personalCreateData(context.agencyId, pdsVersionId, input.personal),
          update: personalUpdateData(input.personal),
        });
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'PDS_PERSONAL_DETAILS_UPDATED',
          entityType: 'PdsVersion',
          entityId: pdsVersionId,
          previousStatus: existing.status,
          newStatus: existing.status,
          requestId: context.requestId,
          metadata: { section: 'personal', changedFieldCount: Object.keys(input.personal).length },
        });
      }
      if (input.family) {
        await transaction.pdsFamilyRecord.deleteMany({
          where: { agencyId: context.agencyId, pdsVersionId },
        });
        const records = familyCreateData(context.agencyId, pdsVersionId, input.family);
        if (records.length) await transaction.pdsFamilyRecord.createMany({ data: records });
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'PDS_FAMILY_DETAILS_UPDATED',
          entityType: 'PdsVersion',
          entityId: pdsVersionId,
          previousStatus: existing.status,
          newStatus: existing.status,
          requestId: context.requestId,
          metadata: {
            section: 'family',
            childCount: input.family.children?.length ?? 0,
            hasSpouse: Boolean(input.family.spouse),
            hasFather: Boolean(input.family.father),
            hasMother: Boolean(input.family.mother),
          },
        });
      }
      const updated = await this.record(transaction, context.agencyId, pdsVersionId);
      if (!updated) throw this.notFound();
      return detail(updated, 'FULL');
    });
  }

  private async record(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    id: string,
  ): Promise<PdsRecord | null> {
    return transaction.pdsVersion.findFirst({ where: { agencyId, id }, select: pdsSelect });
  }

  private async auditRead(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    entityId: string,
    fieldScope: PdsFieldScope,
    access: 'LIST' | 'DETAIL',
    versionCount?: number,
    entityType = 'PdsVersion',
  ): Promise<void> {
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action: access === 'LIST' ? 'PDS_VERSIONS_READ' : 'PDS_VERSION_READ',
      entityType,
      entityId,
      requestId: context.requestId,
      metadata: {
        access,
        fieldScope,
        ...(versionCount === undefined ? {} : { versionCount }),
      },
    });
  }

  private async listInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    employeeId: string,
  ): Promise<PdsVersionList> {
    const employee = await transaction.employee.findUnique({
      where: { agencyId_id: { agencyId: context.agencyId, id: employeeId } },
      select: { id: true, memberships: { select: { userId: true } } },
    });
    if (!employee) throw this.notFound();
    const fieldScope = readFieldScope(context, employee.memberships[0]?.userId ?? null);
    if (!fieldScope) throw this.notFound();
    const records = await transaction.pdsVersion.findMany({
      where: { agencyId: context.agencyId, employeeId },
      orderBy: { versionNo: 'desc' },
      take: PDS_VERSION_LIST_LIMIT,
      select: pdsSummarySelect,
    });
    const versions = records.map((record) => summary(record, fieldScope));
    if (records.length) {
      await this.auditRead(
        transaction,
        context,
        employeeId,
        fieldScope,
        'LIST',
        records.length,
        'Employee',
      );
    }
    return {
      employeeId,
      citizenshipCountries: PDS_CITIZENSHIP_COUNTRIES,
      current: currentVersion(versions),
      draft: versions.find((version) => ['DRAFT', 'RETURNED'].includes(version.status)) ?? null,
      versions,
    };
  }

  private async ownEmployeeId(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
  ): Promise<string | null> {
    const membership = await transaction.agencyMembership.findUnique({
      where: { agencyId_id: { agencyId: context.agencyId, id: context.membershipId } },
      select: { userId: true, employeeId: true },
    });
    return membership && membership.userId === context.userId
      ? (membership.employeeId ?? null)
      : null;
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

  private async lockVersion(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    versionId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "pds_versions" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${versionId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) throw this.notFound();
  }

  private assertContext(context: RequestContext, permission: string, code: string): void {
    if (
      !context.agencyId ||
      !context.userId ||
      !context.membershipId ||
      !hasPermissionGrant(context, permission)
    ) {
      throw new PdsServiceError(
        'The current Agency Membership lacks the required PDS permission.',
        403,
        code,
      );
    }
  }

  private notFound(): PdsServiceError {
    return new PdsServiceError('The PDS Version could not be found.', 404, 'PDS_NOT_FOUND');
  }

  private employeeRequired(): PdsServiceError {
    return new PdsServiceError(
      'Select an Employee or link the current Membership to an Employee.',
      400,
      'PDS_EMPLOYEE_REQUIRED',
    );
  }

  private immutable(): PdsServiceError {
    return new PdsServiceError(
      'Submitted, certified, or superseded PDS Versions cannot be edited.',
      409,
      'PDS_VERSION_IMMUTABLE',
    );
  }
}
