import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import { PlantillaPositionsService } from '../plantilla-positions/plantilla-positions.service';
import { QualificationStandardsService } from '../qualification-standards/qualification-standards.service';
import { SelectionService } from '../recruitment/selection.service';
import {
  APPOINTMENT_EMPLOYMENT_STATUSES,
  APPOINTMENT_LINK_ROLES,
  APPOINTMENT_NATURES,
  APPOINTMENT_REGULATORY_STATUSES,
  APPOINTMENT_SIGNATURE_METHODS,
  APPOINTMENT_WORKFLOW_STATUSES,
  type appointmentCancelSchema,
  type appointmentCorrectionSchema,
  type appointmentCreateSchema,
  type appointmentListSchema,
  type appointmentReasonSchema,
  type appointmentSettingsSchema,
  type appointmentUpdateSchema,
} from './appointments.schemas';
import type { z } from 'zod';

export type AppointmentWorkflowStatus = (typeof APPOINTMENT_WORKFLOW_STATUSES)[number];
export type AppointmentEmploymentStatus = (typeof APPOINTMENT_EMPLOYMENT_STATUSES)[number];
export type AppointmentNature = (typeof APPOINTMENT_NATURES)[number];
export type AppointmentSignatureMethod = (typeof APPOINTMENT_SIGNATURE_METHODS)[number];
export type AppointmentLinkRole = (typeof APPOINTMENT_LINK_ROLES)[number];
export type AppointmentRegulatoryStatus = (typeof APPOINTMENT_REGULATORY_STATUSES)[number];
export type AppointmentFormVariant = 'CS_FORM_33_A_2025' | 'CS_FORM_33_B_2025';

export const REQUIRED_APPOINTMENT_LINK_ROLES: readonly AppointmentLinkRole[] = [
  'PDS',
  'WORK_EXPERIENCE_SHEET',
  'ELIGIBILITY_PROOF',
  'POSITION_DESCRIPTION_FORM',
  'SELECTION_CERTIFICATION',
  'PUBLICATION_CERTIFICATION',
  'AUTHORITY_OR_DELEGATION',
];

export interface AppointmentEvidenceSummary {
  id: string;
  linkRole: AppointmentLinkRole;
  documentVersionId: string;
  documentId: string;
  documentNo: string | null;
  documentType: string;
  classification: string;
  versionNo: number;
  issuedAt: string;
}

export interface AppointmentVersionSummary {
  id: string;
  versionNo: number;
  status: 'DRAFT' | 'ISSUED' | 'SUPERSEDED';
  employmentStatus: AppointmentEmploymentStatus;
  natureOfAppointment: AppointmentNature;
  salaryGrade: number;
  salaryStep: number;
  effectivityDate: string;
  appointingAuthorityMembershipId: string;
  formVariant: AppointmentFormVariant;
  signatureMethod: AppointmentSignatureMethod;
  signatureEvidenceDocumentVersionId: string | null;
  appointmentDocumentVersionId: string;
  issuedAt: string | null;
  issuedByMembershipId: string | null;
  replacesVersionId: string | null;
  correctionReason: string | null;
  correctionAuthorityDocumentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentVersionDetail extends AppointmentVersionSummary {
  evidence: AppointmentEvidenceSummary[];
}

export interface AppointmentSummary {
  id: string;
  workflowStatus: AppointmentWorkflowStatus;
  recruitmentHandoffId: string;
  position: {
    id: string;
    itemNumber: string;
    title: string | null;
    salaryGrade: number | null;
    organizationUnitId: string | null;
  };
  appointee: {
    personKey: string;
    fullName: string;
    applicationNo: string;
  };
  currentVersion: AppointmentVersionSummary | null;
  issuedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentHistoryEntry {
  id: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  actorMembershipId: string | null;
  occurredAt: string;
}

export interface AppointmentDetail extends AppointmentSummary {
  selectionPackage: unknown;
  versions: AppointmentVersionDetail[];
  history: AppointmentHistoryEntry[];
  settings: AppointmentSettingsSummary | null;
}

export interface AppointmentSettingsSummary {
  id: string;
  regulatoryStatus: AppointmentRegulatoryStatus;
  formVariant: AppointmentFormVariant;
  statusEvidenceDocumentVersionId: string;
  updatedAt: string;
}

export interface EligibleSelectionSummary {
  handoffId: string;
  selectionDecisionId: string;
  applicationId: string;
  positionId: string;
  handedOffAt: string;
  applicant: { personKey: string; fullName: string; applicationNo: string };
  position: {
    id: string;
    itemNumber: string;
    title: string | null;
    salaryGrade: number | null;
    organizationUnitId: string | null;
  };
  appointment: { id: string; workflowStatus: AppointmentWorkflowStatus } | null;
}

export class AppointmentServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'AppointmentServiceError';
  }
}

const versionCoreSelect = {
  id: true,
  appointmentId: true,
  versionNo: true,
  status: true,
  employmentStatus: true,
  natureOfAppointment: true,
  salaryGrade: true,
  salaryStep: true,
  effectivityDate: true,
  appointingAuthorityMembershipId: true,
  formVariant: true,
  signatureMethod: true,
  signatureEvidenceDocumentVersionId: true,
  appointmentDocumentVersionId: true,
  issuedAt: true,
  issuedByMembershipId: true,
  replacesVersionId: true,
  correctionReason: true,
  correctionAuthorityDocumentVersionId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AppointmentVersionSelect;

const versionDetailSelect = {
  ...versionCoreSelect,
  links: {
    select: {
      id: true,
      linkRole: true,
      documentVersionId: true,
      documentVersion: {
        select: {
          documentId: true,
          versionNo: true,
          issuedAt: true,
          createdAt: true,
          document: {
            select: { documentNo: true, documentType: true, classification: true },
          },
        },
      },
    },
  },
} satisfies Prisma.AppointmentVersionSelect;

const appointmentSelect = {
  id: true,
  recruitmentHandoffId: true,
  recruitmentSelectionPackage: true,
  positionId: true,
  appointeePersonKey: true,
  workflowStatus: true,
  currentVersionId: true,
  issuedAt: true,
  createdAt: true,
  updatedAt: true,
  position: { select: { id: true, itemNumber: true } },
  currentVersion: { select: versionCoreSelect },
} satisfies Prisma.AppointmentSelect;

const appointmentDetailSelect = {
  ...appointmentSelect,
  versions: { select: versionDetailSelect, orderBy: { versionNo: 'asc' as const } },
} satisfies Prisma.AppointmentSelect;

const settingsSelect = {
  id: true,
  regulatoryStatus: true,
  statusEvidenceDocumentVersionId: true,
  updatedAt: true,
} satisfies Prisma.AppointmentAgencySettingsSelect;

type AppointmentRecord = Prisma.AppointmentGetPayload<{ select: typeof appointmentSelect }>;
type AppointmentDetailRecord = Prisma.AppointmentGetPayload<{
  select: typeof appointmentDetailSelect;
}>;
type AppointmentVersionRecord = Prisma.AppointmentVersionGetPayload<{
  select: typeof versionCoreSelect;
}>;
type AppointmentVersionDetailRecord = Prisma.AppointmentVersionGetPayload<{
  select: typeof versionDetailSelect;
}>;
type SettingsRecord = Prisma.AppointmentAgencySettingsGetPayload<{ select: typeof settingsSelect }>;

const AUDIT_METADATA_KEYS = new Set([
  'selectionDecisionId',
  'handoffId',
  'positionId',
  'versionId',
  'predecessorVersionId',
  'formVariant',
  'regulatoryStatus',
  'signatureMethod',
  'salaryGrade',
  'salaryStep',
  'effectivityDate',
  'evidenceCount',
  'documentVersionId',
  'reservationReleased',
  'versionNo',
]);

function safeAuditMetadata(value: Prisma.InputJsonObject): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => AUDIT_METADATA_KEYS.has(key)),
  ) as Prisma.InputJsonObject;
}

function jsonObject(value: Prisma.JsonValue | undefined): Record<string, Prisma.JsonValue> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, Prisma.JsonValue>;
}

function stringField(value: Record<string, Prisma.JsonValue> | null, key: string): string | null {
  const item = value?.[key];
  return typeof item === 'string' ? item : null;
}

function nullableStringField(
  value: Record<string, Prisma.JsonValue> | null,
  key: string,
): string | null {
  const item = value?.[key];
  return typeof item === 'string' ? item : null;
}

function nullableNumberField(
  value: Record<string, Prisma.JsonValue> | null,
  key: string,
): number | null {
  const item = value?.[key];
  return typeof item === 'number' ? item : null;
}

function manilaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function toDatabaseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw dateInvalid();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw dateInvalid();
  }
  return date;
}

function dateInvalid(): AppointmentServiceError {
  return new AppointmentServiceError('Enter a valid date.', 400, 'APPOINTMENT_DATE_INVALID');
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatDateTime(value: Date): string {
  return value.toISOString();
}

function normalizeIdempotencyKey(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function appointmentFormVariant(
  regulatoryStatus: AppointmentRegulatoryStatus,
): AppointmentFormVariant {
  return regulatoryStatus === 'REGULATED' ? 'CS_FORM_33_A_2025' : 'CS_FORM_33_B_2025';
}

function workflowStatus(value: string): AppointmentWorkflowStatus {
  if (APPOINTMENT_WORKFLOW_STATUSES.includes(value as AppointmentWorkflowStatus)) {
    return value as AppointmentWorkflowStatus;
  }
  throw new AppointmentServiceError(
    'The stored Appointment workflow status is invalid.',
    500,
    'APPOINTMENT_DATA_INVALID',
  );
}

function versionStatus(value: string): 'DRAFT' | 'ISSUED' | 'SUPERSEDED' {
  if (value === 'DRAFT' || value === 'ISSUED' || value === 'SUPERSEDED') return value;
  throw new AppointmentServiceError(
    'The stored Appointment version status is invalid.',
    500,
    'APPOINTMENT_DATA_INVALID',
  );
}

function settingsSummary(record: SettingsRecord): AppointmentSettingsSummary {
  const regulatoryStatus = APPOINTMENT_REGULATORY_STATUSES.includes(
    record.regulatoryStatus as AppointmentRegulatoryStatus,
  )
    ? (record.regulatoryStatus as AppointmentRegulatoryStatus)
    : 'REGULATED';
  return {
    id: record.id,
    regulatoryStatus,
    formVariant: appointmentFormVariant(regulatoryStatus),
    statusEvidenceDocumentVersionId: record.statusEvidenceDocumentVersionId,
    updatedAt: formatDateTime(record.updatedAt),
  };
}

function versionSummary(record: AppointmentVersionRecord): AppointmentVersionSummary {
  return {
    id: record.id,
    versionNo: record.versionNo,
    status: versionStatus(record.status),
    employmentStatus: record.employmentStatus as AppointmentEmploymentStatus,
    natureOfAppointment: record.natureOfAppointment as AppointmentNature,
    salaryGrade: record.salaryGrade,
    salaryStep: record.salaryStep,
    effectivityDate: formatDate(record.effectivityDate),
    appointingAuthorityMembershipId: record.appointingAuthorityMembershipId,
    formVariant: record.formVariant as AppointmentFormVariant,
    signatureMethod: record.signatureMethod as AppointmentSignatureMethod,
    signatureEvidenceDocumentVersionId: record.signatureEvidenceDocumentVersionId,
    appointmentDocumentVersionId: record.appointmentDocumentVersionId,
    issuedAt: record.issuedAt ? formatDateTime(record.issuedAt) : null,
    issuedByMembershipId: record.issuedByMembershipId,
    replacesVersionId: record.replacesVersionId,
    correctionReason: record.correctionReason,
    correctionAuthorityDocumentVersionId: record.correctionAuthorityDocumentVersionId,
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt),
  };
}

function versionDetail(record: AppointmentVersionDetailRecord): AppointmentVersionDetail {
  return {
    ...versionSummary(record),
    evidence: record.links.map((link) => ({
      id: link.id,
      linkRole: link.linkRole as AppointmentLinkRole,
      documentVersionId: link.documentVersionId,
      documentId: link.documentVersion.documentId,
      documentNo: link.documentVersion.document.documentNo,
      documentType: link.documentVersion.document.documentType,
      classification: link.documentVersion.document.classification,
      versionNo: link.documentVersion.versionNo,
      issuedAt: formatDateTime(link.documentVersion.issuedAt ?? link.documentVersion.createdAt),
    })),
  };
}

interface SelectionPackageView {
  raw: Prisma.JsonValue;
  applicantId: string;
  applicantName: string;
  applicationNo: string;
  qualificationStandardVersionId: string;
  position: {
    id: string;
    itemNumber: string;
    positionVersionId: string | null;
    title: string | null;
    salaryGrade: number | null;
    organizationUnitId: string | null;
  };
}

function selectionPackageView(raw: Prisma.JsonValue): SelectionPackageView {
  const value = jsonObject(raw);
  const applicant = value ? jsonObject(value.applicant) : null;
  const position = value ? jsonObject(value.position) : null;
  const applicantId = stringField(applicant, 'id');
  const applicantName = stringField(applicant, 'fullName');
  const applicationNo = stringField(value, 'applicationNo');
  const qualificationStandardVersionId = stringField(value, 'qualificationStandardVersionId');
  const positionId = stringField(position, 'id');
  const itemNumber = stringField(position, 'itemNumber');
  if (
    !applicantId ||
    !applicantName ||
    !applicationNo ||
    !qualificationStandardVersionId ||
    !positionId ||
    !itemNumber
  ) {
    throw new AppointmentServiceError(
      'The Recruitment selection package is invalid.',
      500,
      'APPOINTMENT_DATA_INVALID',
    );
  }
  return {
    raw,
    applicantId,
    applicantName,
    applicationNo,
    qualificationStandardVersionId,
    position: {
      id: positionId,
      itemNumber,
      positionVersionId: nullableStringField(position, 'positionVersionId'),
      title: nullableStringField(position, 'title'),
      salaryGrade: nullableNumberField(position, 'salaryGrade'),
      organizationUnitId: nullableStringField(position, 'organizationUnitId'),
    },
  };
}

function appointmentSummary(record: AppointmentRecord): AppointmentSummary {
  const view = selectionPackageView(record.recruitmentSelectionPackage);
  return {
    id: record.id,
    workflowStatus: workflowStatus(record.workflowStatus),
    recruitmentHandoffId: record.recruitmentHandoffId,
    position: view.position,
    appointee: {
      personKey: record.appointeePersonKey,
      fullName: view.applicantName,
      applicationNo: view.applicationNo,
    },
    currentVersion: record.currentVersion ? versionSummary(record.currentVersion) : null,
    issuedAt: record.issuedAt ? formatDateTime(record.issuedAt) : null,
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt),
  };
}

@Injectable()
export class AppointmentsService {
  constructor(
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
    @Inject(PlantillaPositionsService)
    private readonly plantillaPositions: PlantillaPositionsService,
    @Inject(QualificationStandardsService)
    private readonly qualificationStandards: QualificationStandardsService,
    @Inject(SelectionService) private readonly selectionService: SelectionService,
  ) {}

  async list(
    context: RequestContext,
    filter: z.infer<typeof appointmentListSchema>,
  ): Promise<{ items: AppointmentSummary[]; hasMore: boolean; nextOffset: number | null }> {
    this.assertPermission(context, 'appointments.records.read', 'APPOINTMENT_READ_FORBIDDEN');
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const records = await transaction.appointment.findMany({
        where: {
          agencyId: context.agencyId,
          ...(filter.status ? { workflowStatus: filter.status } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: filter.limit + 1,
        skip: filter.offset,
        select: appointmentSelect,
      });
      const hasMore = records.length > filter.limit;
      const page = hasMore ? records.slice(0, filter.limit) : records;
      return {
        items: page.map(appointmentSummary),
        hasMore,
        nextOffset: hasMore ? filter.offset + filter.limit : null,
      };
    });
  }

  async listEligibleSelections(
    context: RequestContext,
  ): Promise<{ selections: EligibleSelectionSummary[]; hasMore: boolean }> {
    this.assertPermission(context, 'appointments.records.read', 'APPOINTMENT_READ_FORBIDDEN');
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const { packages: handoffs, hasMore } =
        await this.selectionService.listHandoffPackagesInTransaction(transaction, context);
      const appointments =
        handoffs.length === 0
          ? []
          : await transaction.appointment.findMany({
              where: {
                agencyId: context.agencyId,
                recruitmentHandoffId: { in: handoffs.map((handoff) => handoff.handoffId) },
              },
              select: { id: true, recruitmentHandoffId: true, workflowStatus: true },
            });
      const byHandoff = new Map(
        appointments.map((appointment) => [appointment.recruitmentHandoffId, appointment]),
      );
      return {
        selections: handoffs.map((handoff) => {
          const view = selectionPackageView(handoff.selectionPackage);
          const existing = byHandoff.get(handoff.handoffId);
          return {
            handoffId: handoff.handoffId,
            selectionDecisionId: handoff.selectionDecisionId,
            applicationId: handoff.applicationId,
            positionId: handoff.positionId,
            handedOffAt: formatDateTime(handoff.handedOffAt),
            applicant: {
              personKey: view.applicantId,
              fullName: view.applicantName,
              applicationNo: view.applicationNo,
            },
            position: view.position,
            appointment: existing
              ? { id: existing.id, workflowStatus: workflowStatus(existing.workflowStatus) }
              : null,
          };
        }),
        hasMore,
      };
    });
  }

  async findById(context: RequestContext, appointmentId: string): Promise<AppointmentDetail> {
    this.assertPermission(context, 'appointments.records.read', 'APPOINTMENT_READ_FORBIDDEN');
    return withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      this.detailInTransaction(transaction, context, appointmentId),
    );
  }

  async create(
    context: RequestContext,
    input: z.infer<typeof appointmentCreateSchema>,
    rawIdempotencyKey?: string,
  ): Promise<AppointmentDetail> {
    this.assertPermission(context, 'appointments.records.create', 'APPOINTMENT_CREATE_FORBIDDEN');
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'appointment-transition'),
      async (transaction) => {
        if (idempotencyKey) {
          const completed = await this.idempotentEvent(
            transaction,
            context,
            'APPOINTMENT_PREPARED',
            idempotencyKey,
          );
          if (completed) return this.detailInTransaction(transaction, context, completed.entityId);
        }
        const handoff = await this.selectionService.resolveHandoffPackageInTransaction(
          transaction,
          context,
          input.selectionDecisionId,
        );
        if (!handoff) {
          throw new AppointmentServiceError(
            'The selected candidate package could not be found.',
            404,
            'APPOINTMENT_SELECTION_NOT_FOUND',
          );
        }
        const existing = await transaction.appointment.findFirst({
          where: { agencyId: context.agencyId, recruitmentHandoffId: handoff.handoffId },
          select: { id: true },
        });
        if (existing) {
          throw new AppointmentServiceError(
            'An Appointment already exists for this Selection Decision.',
            409,
            'APPOINTMENT_ALREADY_PREPARED',
          );
        }
        const settings = await this.requireSettings(transaction, context);
        const view = selectionPackageView(handoff.selectionPackage);
        await this.requireReservedPosition(
          transaction,
          context,
          handoff.positionId,
          input.salaryGrade,
        );
        const prepared = await this.resolvePreparation(transaction, context, input, settings);
        const appointment = await transaction.appointment.create({
          data: {
            agencyId: context.agencyId,
            recruitmentHandoffId: handoff.handoffId,
            recruitmentSelectionPackage: view.raw as Prisma.InputJsonValue,
            positionId: handoff.positionId,
            appointeePersonKey: view.applicantId,
            workflowStatus: 'DRAFT',
            createdByMembershipId: context.membershipId,
            updatedByMembershipId: context.membershipId,
          },
          select: { id: true },
        });
        const version = await transaction.appointmentVersion.create({
          data: {
            agencyId: context.agencyId,
            appointmentId: appointment.id,
            versionNo: 1,
            employmentStatus: input.employmentStatus,
            natureOfAppointment: input.natureOfAppointment,
            salaryGrade: input.salaryGrade,
            salaryStep: input.salaryStep,
            effectivityDate: prepared.effectivityDate,
            appointingAuthorityMembershipId: input.appointingAuthorityMembershipId,
            formVariant: prepared.formVariant,
            signatureMethod: input.signatureMethod,
            signatureEvidenceDocumentVersionId: prepared.signatureEvidenceDocumentVersionId,
            appointmentDocumentVersionId: prepared.appointmentDocumentVersionId,
            status: 'DRAFT',
            createdByMembershipId: context.membershipId,
            updatedByMembershipId: context.membershipId,
          },
          select: { id: true },
        });
        await this.replaceEvidenceLinks(transaction, context, version.id, prepared.evidence);
        await transaction.appointment.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: appointment.id } },
          data: {
            currentVersionId: version.id,
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'APPOINTMENT_PREPARED',
          entityId: appointment.id,
          previousStatus: null,
          newStatus: 'DRAFT',
          reason: 'Appointment prepared from the selected candidate package.',
          metadata: {
            selectionDecisionId: handoff.selectionDecisionId,
            handoffId: handoff.handoffId,
            positionId: handoff.positionId,
            versionId: version.id,
            formVariant: prepared.formVariant,
            signatureMethod: input.signatureMethod,
            salaryGrade: input.salaryGrade,
            salaryStep: input.salaryStep,
            effectivityDate: input.effectivityDate,
            evidenceCount: prepared.evidence.length,
          },
          idempotencyKey,
        });
        return this.detailInTransaction(transaction, context, appointment.id);
      },
    );
  }

  async updateDraft(
    context: RequestContext,
    appointmentId: string,
    input: z.infer<typeof appointmentUpdateSchema>,
    rawIdempotencyKey?: string,
  ): Promise<AppointmentDetail> {
    this.assertPermission(context, 'appointments.records.create', 'APPOINTMENT_CREATE_FORBIDDEN');
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'appointment-transition'),
      async (transaction) => {
        if (idempotencyKey) {
          const completed = await this.idempotentEvent(
            transaction,
            context,
            'APPOINTMENT_DRAFT_UPDATED',
            idempotencyKey,
          );
          if (completed) return this.detailInTransaction(transaction, context, completed.entityId);
        }
        const record = await this.requireEditableAppointment(transaction, context, appointmentId);
        const settings = await this.requireSettings(transaction, context);
        await this.requireReservedPosition(
          transaction,
          context,
          record.positionId,
          input.salaryGrade,
        );
        const prepared = await this.resolvePreparation(transaction, context, input, settings);
        const version = record.currentVersion;
        if (!version) throw this.versionNotFound();
        await transaction.appointmentVersion.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: version.id } },
          data: {
            employmentStatus: input.employmentStatus,
            natureOfAppointment: input.natureOfAppointment,
            salaryGrade: input.salaryGrade,
            salaryStep: input.salaryStep,
            effectivityDate: prepared.effectivityDate,
            appointingAuthorityMembershipId: input.appointingAuthorityMembershipId,
            formVariant: prepared.formVariant,
            signatureMethod: input.signatureMethod,
            signatureEvidenceDocumentVersionId: prepared.signatureEvidenceDocumentVersionId,
            appointmentDocumentVersionId: prepared.appointmentDocumentVersionId,
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.replaceEvidenceLinks(transaction, context, version.id, prepared.evidence);
        await transaction.appointment.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: appointmentId } },
          data: { updatedByMembershipId: context.membershipId, rowVersion: { increment: 1 } },
        });
        await this.writeAudit(transaction, context, {
          action: 'APPOINTMENT_DRAFT_UPDATED',
          entityId: appointmentId,
          previousStatus: 'DRAFT',
          newStatus: 'DRAFT',
          reason: 'Draft Appointment version updated.',
          metadata: {
            positionId: record.positionId,
            versionId: version.id,
            formVariant: prepared.formVariant,
            signatureMethod: input.signatureMethod,
            salaryGrade: input.salaryGrade,
            salaryStep: input.salaryStep,
            effectivityDate: input.effectivityDate,
            evidenceCount: prepared.evidence.length,
          },
          idempotencyKey,
        });
        return this.detailInTransaction(transaction, context, appointmentId);
      },
    );
  }

  async submit(
    context: RequestContext,
    appointmentId: string,
    rawIdempotencyKey?: string,
  ): Promise<AppointmentDetail> {
    this.assertPermission(context, 'appointments.records.submit', 'APPOINTMENT_SUBMIT_FORBIDDEN');
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'appointment-transition'),
      async (transaction) => {
        if (idempotencyKey) {
          const completed = await this.idempotentEvent(
            transaction,
            context,
            'APPOINTMENT_SUBMITTED',
            idempotencyKey,
          );
          if (completed) return this.detailInTransaction(transaction, context, completed.entityId);
        }
        const record = await this.requireEditableAppointment(transaction, context, appointmentId);
        const settings = await this.requireSettings(transaction, context);
        await this.requireReservedPosition(
          transaction,
          context,
          record.positionId,
          record.currentVersion?.salaryGrade ?? 0,
        );
        const evidence = await this.requireCompleteEvidence(
          transaction,
          context,
          record.currentVersion,
          settings,
        );
        await transaction.appointment.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: appointmentId } },
          data: {
            workflowStatus: 'FOR_REVIEW',
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'APPOINTMENT_SUBMITTED',
          entityId: appointmentId,
          previousStatus: 'DRAFT',
          newStatus: 'FOR_REVIEW',
          reason: 'Draft Appointment submitted for review.',
          metadata: {
            positionId: record.positionId,
            versionId: record.currentVersion?.id ?? null,
            evidenceCount: evidence.length,
          },
          idempotencyKey,
        });
        return this.detailInTransaction(transaction, context, appointmentId);
      },
    );
  }

  async returnForCorrection(
    context: RequestContext,
    appointmentId: string,
    input: z.infer<typeof appointmentReasonSchema>,
    rawIdempotencyKey?: string,
  ): Promise<AppointmentDetail> {
    this.assertPermission(context, 'appointments.records.return', 'APPOINTMENT_RETURN_FORBIDDEN');
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'appointment-transition'),
      async (transaction) => {
        if (idempotencyKey) {
          const completed = await this.idempotentEvent(
            transaction,
            context,
            'APPOINTMENT_RETURNED',
            idempotencyKey,
          );
          if (completed) return this.detailInTransaction(transaction, context, completed.entityId);
        }
        const record = await this.requireAppointment(transaction, context, appointmentId);
        if (record.workflowStatus !== 'FOR_REVIEW') throw this.transitionNotAllowed(record);
        await transaction.appointment.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: appointmentId } },
          data: {
            workflowStatus: 'DRAFT',
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'APPOINTMENT_RETURNED',
          entityId: appointmentId,
          previousStatus: 'FOR_REVIEW',
          newStatus: 'DRAFT',
          reason: input.reason,
          metadata: {
            positionId: record.positionId,
            versionId: record.currentVersion?.id ?? null,
          },
          idempotencyKey,
        });
        return this.detailInTransaction(transaction, context, appointmentId);
      },
    );
  }

  async endorse(
    context: RequestContext,
    appointmentId: string,
    rawIdempotencyKey?: string,
  ): Promise<AppointmentDetail> {
    this.assertPermission(context, 'appointments.records.endorse', 'APPOINTMENT_ENDORSE_FORBIDDEN');
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'appointment-transition'),
      async (transaction) => {
        if (idempotencyKey) {
          const completed = await this.idempotentEvent(
            transaction,
            context,
            'APPOINTMENT_ENDORSED',
            idempotencyKey,
          );
          if (completed) return this.detailInTransaction(transaction, context, completed.entityId);
        }
        const record = await this.requireAppointment(transaction, context, appointmentId);
        if (record.workflowStatus !== 'FOR_REVIEW') throw this.transitionNotAllowed(record);
        const settings = await this.requireSettings(transaction, context);
        await this.requireReservedPosition(
          transaction,
          context,
          record.positionId,
          record.currentVersion?.salaryGrade ?? 0,
        );
        const evidence = await this.requireCompleteEvidence(
          transaction,
          context,
          record.currentVersion,
          settings,
        );
        const version = record.currentVersion;
        if (!version) throw this.versionNotFound();
        const view = selectionPackageView(record.recruitmentSelectionPackage);
        const qualification = await this.qualificationStandards.resolveUsableInTransaction(
          transaction,
          context,
          view.qualificationStandardVersionId,
          formatDate(version.effectivityDate),
        );
        if (!qualification.usable) {
          throw new AppointmentServiceError(
            'The Qualification Standard Version is not usable for this Appointment.',
            409,
            'APPOINTMENT_QUALIFICATION_INVALID',
          );
        }
        await transaction.appointment.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: appointmentId } },
          data: {
            workflowStatus: 'FOR_SIGNATURE',
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'APPOINTMENT_ENDORSED',
          entityId: appointmentId,
          previousStatus: 'FOR_REVIEW',
          newStatus: 'FOR_SIGNATURE',
          reason: 'Appointment endorsed for signature.',
          metadata: {
            positionId: record.positionId,
            versionId: version.id,
            evidenceCount: evidence.length,
          },
          idempotencyKey,
        });
        return this.detailInTransaction(transaction, context, appointmentId);
      },
    );
  }

  async issue(
    context: RequestContext,
    appointmentId: string,
    rawIdempotencyKey?: string,
  ): Promise<AppointmentDetail> {
    this.assertPermission(context, 'appointments.records.issue', 'APPOINTMENT_ISSUE_FORBIDDEN');
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'appointment-transition'),
      async (transaction) => {
        if (idempotencyKey) {
          const completed = await this.idempotentEvent(
            transaction,
            context,
            'APPOINTMENT_ISSUED',
            idempotencyKey,
          );
          if (completed) return this.detailInTransaction(transaction, context, completed.entityId);
        }
        const record = await this.requireAppointment(transaction, context, appointmentId);
        if (record.workflowStatus !== 'FOR_SIGNATURE') throw this.transitionNotAllowed(record);
        const version = record.currentVersion;
        if (!version) throw this.versionNotFound();
        if (version.appointingAuthorityMembershipId !== context.membershipId) {
          throw new AppointmentServiceError(
            'Only the recorded Appointing Authority can issue this Appointment.',
            403,
            'APPOINTMENT_ISSUER_FORBIDDEN',
          );
        }
        const settings = await this.requireSettings(transaction, context);
        const formVariant = appointmentFormVariant(settingsSummary(settings).regulatoryStatus);
        if (version.formVariant !== formVariant) {
          throw new AppointmentServiceError(
            'The Agency form path changed after this version was prepared.',
            409,
            'APPOINTMENT_FORM_VARIANT_INVALID',
          );
        }
        await this.requireReservedPosition(
          transaction,
          context,
          record.positionId,
          version.salaryGrade,
        );
        const evidence = await this.requireCompleteEvidence(
          transaction,
          context,
          version,
          settings,
        );
        const issuedAt = new Date();
        if (version.replacesVersionId) {
          await transaction.appointmentVersion.update({
            where: {
              agencyId_id: { agencyId: context.agencyId, id: version.replacesVersionId },
            },
            data: { status: 'SUPERSEDED' },
          });
        }
        await transaction.appointmentVersion.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: version.id } },
          data: {
            status: 'ISSUED',
            issuedAt,
            issuedByMembershipId: context.membershipId,
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await transaction.appointment.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: appointmentId } },
          data: {
            workflowStatus: 'ISSUED',
            issuedAt,
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'APPOINTMENT_ISSUED',
          entityId: appointmentId,
          previousStatus: 'FOR_SIGNATURE',
          newStatus: 'ISSUED',
          reason: 'Appointment issued by the recorded Appointing Authority.',
          metadata: {
            positionId: record.positionId,
            versionId: version.id,
            formVariant: version.formVariant,
            signatureMethod: version.signatureMethod,
            salaryGrade: version.salaryGrade,
            salaryStep: version.salaryStep,
            effectivityDate: formatDate(version.effectivityDate),
            evidenceCount: evidence.length,
          },
          idempotencyKey,
        });
        return this.detailInTransaction(transaction, context, appointmentId);
      },
    );
  }

  async cancel(
    context: RequestContext,
    appointmentId: string,
    input: z.infer<typeof appointmentCancelSchema>,
    rawIdempotencyKey?: string,
  ): Promise<AppointmentDetail> {
    this.assertPermission(context, 'appointments.records.cancel', 'APPOINTMENT_CANCEL_FORBIDDEN');
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'appointment-transition', 'plantilla-position-transition'),
      async (transaction) => {
        if (idempotencyKey) {
          const completed = await this.idempotentEvent(
            transaction,
            context,
            'APPOINTMENT_CANCELLED',
            idempotencyKey,
          );
          if (completed) return this.detailInTransaction(transaction, context, completed.entityId);
        }
        const record = await this.requireAppointment(transaction, context, appointmentId);
        if (record.workflowStatus !== 'FOR_SIGNATURE' && record.workflowStatus !== 'ISSUED') {
          throw this.transitionNotAllowed(record);
        }
        const authority = await this.documentsService.resolveFinalizedVersionInTransaction(
          transaction,
          context,
          input.authorityDocumentVersionId,
        );
        if (!authority) {
          throw new AppointmentServiceError(
            'The cancellation authority must be a finalized Document Version.',
            409,
            'APPOINTMENT_CANCELLATION_AUTHORITY_INVALID',
          );
        }
        const reservation = await this.plantillaPositions.resolveReservationInTransaction(
          transaction,
          context,
          record.positionId,
        );
        const reservationReleased = reservation?.status === 'RESERVED';
        if (reservationReleased) {
          await this.plantillaPositions.releaseReservationInTransaction(
            transaction,
            context,
            record.positionId,
            manilaToday(),
            `Appointment cancelled: ${input.reason}`,
            idempotencyKey ? `${idempotencyKey}:position` : undefined,
          );
        }
        await transaction.appointment.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: appointmentId } },
          data: {
            workflowStatus: 'CANCELLED',
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'APPOINTMENT_CANCELLED',
          entityId: appointmentId,
          previousStatus: record.workflowStatus,
          newStatus: 'CANCELLED',
          reason: input.reason,
          metadata: {
            positionId: record.positionId,
            versionId: record.currentVersion?.id ?? null,
            reservationReleased,
            documentVersionId: input.authorityDocumentVersionId,
          },
          idempotencyKey,
        });
        return this.detailInTransaction(transaction, context, appointmentId);
      },
    );
  }

  async correct(
    context: RequestContext,
    appointmentId: string,
    input: z.infer<typeof appointmentCorrectionSchema>,
    rawIdempotencyKey?: string,
  ): Promise<AppointmentDetail> {
    this.assertPermission(context, 'appointments.records.create', 'APPOINTMENT_CREATE_FORBIDDEN');
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'appointment-transition'),
      async (transaction) => {
        if (idempotencyKey) {
          const completed = await this.idempotentEvent(
            transaction,
            context,
            'APPOINTMENT_CORRECTED',
            idempotencyKey,
          );
          if (completed) return this.detailInTransaction(transaction, context, completed.entityId);
        }
        const record = await this.requireAppointment(transaction, context, appointmentId);
        if (record.workflowStatus !== 'ISSUED') throw this.transitionNotAllowed(record);
        const predecessor = record.currentVersion;
        if (!predecessor || predecessor.status !== 'ISSUED') throw this.versionNotFound();
        const settings = await this.requireSettings(transaction, context);
        await this.requireReservedPosition(
          transaction,
          context,
          record.positionId,
          input.salaryGrade,
        );
        const prepared = await this.resolvePreparation(transaction, context, input, settings);
        const authority = await this.documentsService.resolveFinalizedVersionInTransaction(
          transaction,
          context,
          input.authorityDocumentVersionId,
        );
        if (!authority) {
          throw new AppointmentServiceError(
            'The correction authority must be a finalized Document Version.',
            409,
            'APPOINTMENT_CORRECTION_AUTHORITY_INVALID',
          );
        }
        const successor = await transaction.appointmentVersion.create({
          data: {
            agencyId: context.agencyId,
            appointmentId,
            versionNo: predecessor.versionNo + 1,
            employmentStatus: input.employmentStatus,
            natureOfAppointment: input.natureOfAppointment,
            salaryGrade: input.salaryGrade,
            salaryStep: input.salaryStep,
            effectivityDate: prepared.effectivityDate,
            appointingAuthorityMembershipId: input.appointingAuthorityMembershipId,
            formVariant: prepared.formVariant,
            signatureMethod: input.signatureMethod,
            signatureEvidenceDocumentVersionId: prepared.signatureEvidenceDocumentVersionId,
            appointmentDocumentVersionId: prepared.appointmentDocumentVersionId,
            status: 'DRAFT',
            replacesVersionId: predecessor.id,
            correctionReason: input.reason,
            correctionAuthorityDocumentVersionId: input.authorityDocumentVersionId,
            createdByMembershipId: context.membershipId,
            updatedByMembershipId: context.membershipId,
          },
          select: { id: true },
        });
        await this.replaceEvidenceLinks(transaction, context, successor.id, prepared.evidence);
        await transaction.appointment.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: appointmentId } },
          data: {
            workflowStatus: 'DRAFT',
            currentVersionId: successor.id,
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'APPOINTMENT_CORRECTED',
          entityId: appointmentId,
          previousStatus: 'ISSUED',
          newStatus: 'DRAFT',
          reason: input.reason,
          metadata: {
            positionId: record.positionId,
            predecessorVersionId: predecessor.id,
            versionId: successor.id,
            versionNo: predecessor.versionNo + 1,
            formVariant: prepared.formVariant,
            salaryGrade: input.salaryGrade,
            salaryStep: input.salaryStep,
            effectivityDate: input.effectivityDate,
            evidenceCount: prepared.evidence.length,
            documentVersionId: input.authorityDocumentVersionId,
          },
          idempotencyKey,
        });
        return this.detailInTransaction(transaction, context, appointmentId);
      },
    );
  }

  async getSettings(context: RequestContext): Promise<AppointmentSettingsSummary | null> {
    this.assertPermission(context, 'appointments.records.read', 'APPOINTMENT_READ_FORBIDDEN');
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const settings = await transaction.appointmentAgencySettings.findFirst({
        where: { agencyId: context.agencyId },
        select: settingsSelect,
      });
      return settings ? settingsSummary(settings) : null;
    });
  }

  async configureSettings(
    context: RequestContext,
    input: z.infer<typeof appointmentSettingsSchema>,
    rawIdempotencyKey?: string,
  ): Promise<AppointmentSettingsSummary> {
    this.assertPermission(
      context,
      'appointments.settings.manage',
      'APPOINTMENT_SETTINGS_FORBIDDEN',
    );
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'appointment-transition'),
      async (transaction) => {
        if (idempotencyKey) {
          const completed = await this.idempotentEvent(
            transaction,
            context,
            'APPOINTMENT_SETTINGS_CONFIGURED',
            idempotencyKey,
          );
          if (completed) {
            const settings = await transaction.appointmentAgencySettings.findFirst({
              where: { agencyId: context.agencyId, id: completed.entityId },
              select: settingsSelect,
            });
            if (settings) return settingsSummary(settings);
          }
        }
        const evidence = await this.documentsService.resolveFinalizedVersionInTransaction(
          transaction,
          context,
          input.statusEvidenceDocumentVersionId,
        );
        if (!evidence) {
          throw new AppointmentServiceError(
            'The regulatory status evidence must be a finalized Document Version.',
            409,
            'APPOINTMENT_SETTINGS_EVIDENCE_INVALID',
          );
        }
        const existing = await transaction.appointmentAgencySettings.findFirst({
          where: { agencyId: context.agencyId },
          select: { id: true },
        });
        const settings = existing
          ? await transaction.appointmentAgencySettings.update({
              where: { agencyId_id: { agencyId: context.agencyId, id: existing.id } },
              data: {
                regulatoryStatus: input.regulatoryStatus,
                statusEvidenceDocumentVersionId: input.statusEvidenceDocumentVersionId,
                updatedByMembershipId: context.membershipId,
                rowVersion: { increment: 1 },
              },
              select: settingsSelect,
            })
          : await transaction.appointmentAgencySettings.create({
              data: {
                agencyId: context.agencyId,
                regulatoryStatus: input.regulatoryStatus,
                statusEvidenceDocumentVersionId: input.statusEvidenceDocumentVersionId,
                configuredByMembershipId: context.membershipId,
                updatedByMembershipId: context.membershipId,
              },
              select: settingsSelect,
            });
        await this.writeAudit(transaction, context, {
          action: 'APPOINTMENT_SETTINGS_CONFIGURED',
          entityId: settings.id,
          previousStatus: null,
          newStatus: input.regulatoryStatus,
          reason: 'Agency Appointment configuration recorded from evidenced regulatory status.',
          metadata: {
            regulatoryStatus: input.regulatoryStatus,
            formVariant: appointmentFormVariant(input.regulatoryStatus),
            documentVersionId: input.statusEvidenceDocumentVersionId,
          },
          idempotencyKey,
        });
        return settingsSummary(settings);
      },
    );
  }

  private async detailInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    appointmentId: string,
  ): Promise<AppointmentDetail> {
    const record = await transaction.appointment.findFirst({
      where: { agencyId: context.agencyId, id: appointmentId },
      select: appointmentDetailSelect,
    });
    if (!record) throw this.notFound();
    const settings = await transaction.appointmentAgencySettings.findFirst({
      where: { agencyId: context.agencyId },
      select: settingsSelect,
    });
    const history = await transaction.auditEvent.findMany({
      where: { agencyId: context.agencyId, entityType: 'Appointment', entityId: appointmentId },
      orderBy: { occurredAt: 'asc' },
      select: {
        id: true,
        action: true,
        previousStatus: true,
        newStatus: true,
        reason: true,
        actorMembershipId: true,
        occurredAt: true,
      },
    });
    return this.detail(record, settings, history);
  }

  private detail(
    record: AppointmentDetailRecord,
    settings: SettingsRecord | null,
    history: Array<{
      id: string;
      action: string;
      previousStatus: string | null;
      newStatus: string | null;
      reason: string | null;
      actorMembershipId: string | null;
      occurredAt: Date;
    }>,
  ): AppointmentDetail {
    return {
      ...appointmentSummary(record),
      selectionPackage: record.recruitmentSelectionPackage,
      versions: record.versions.map(versionDetail),
      history: history.map((event) => ({
        id: event.id,
        action: event.action,
        previousStatus: event.previousStatus,
        newStatus: event.newStatus,
        reason: event.reason,
        actorMembershipId: event.actorMembershipId,
        occurredAt: formatDateTime(event.occurredAt),
      })),
      settings: settings ? settingsSummary(settings) : null,
    };
  }

  private async requireAppointment(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    appointmentId: string,
  ): Promise<AppointmentDetailRecord> {
    const locked = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "appointments" WHERE "agency_id" = CAST(${context.agencyId} AS uuid) AND "id" = CAST(${appointmentId} AS uuid) FOR UPDATE`,
    );
    if (locked.length !== 1) throw this.notFound();
    const record = await transaction.appointment.findFirst({
      where: { agencyId: context.agencyId, id: appointmentId },
      select: appointmentDetailSelect,
    });
    if (!record) throw this.notFound();
    return record;
  }

  private async requireEditableAppointment(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    appointmentId: string,
  ): Promise<AppointmentDetailRecord> {
    const record = await this.requireAppointment(transaction, context, appointmentId);
    if (record.workflowStatus !== 'DRAFT') throw this.transitionNotAllowed(record);
    if (!record.currentVersion || record.currentVersion.status !== 'DRAFT') {
      throw this.versionNotFound();
    }
    return record;
  }

  private async requireSettings(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
  ): Promise<SettingsRecord> {
    const settings = await transaction.appointmentAgencySettings.findFirst({
      where: { agencyId: context.agencyId },
      select: settingsSelect,
    });
    if (!settings) {
      throw new AppointmentServiceError(
        'The Agency Appointment configuration is missing.',
        409,
        'APPOINTMENT_AGENCY_CONFIGURATION_REQUIRED',
      );
    }
    return settings;
  }

  private async requireReservedPosition(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    positionId: string,
    salaryGrade: number,
  ): Promise<void> {
    const reservation = await this.plantillaPositions.resolveReservationInTransaction(
      transaction,
      context,
      positionId,
    );
    if (!reservation) {
      throw new AppointmentServiceError(
        'The reserved Plantilla Position could not be found.',
        409,
        'APPOINTMENT_POSITION_NOT_FOUND',
      );
    }
    if (reservation.status !== 'RESERVED') {
      throw new AppointmentServiceError(
        'The Plantilla Position is not currently reserved for this Appointment.',
        409,
        'APPOINTMENT_POSITION_NOT_RESERVED',
      );
    }
    if (reservation.currentVersion?.salaryGrade !== salaryGrade) {
      throw new AppointmentServiceError(
        'The salary grade does not match the reserved Plantilla Position.',
        409,
        'APPOINTMENT_SALARY_GRADE_MISMATCH',
      );
    }
  }

  private async resolvePreparation(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: {
      employmentStatus: AppointmentEmploymentStatus;
      natureOfAppointment: AppointmentNature;
      salaryGrade: number;
      salaryStep: number;
      effectivityDate: string;
      appointingAuthorityMembershipId: string;
      signatureMethod: AppointmentSignatureMethod;
      signatureEvidenceDocumentVersionId?: string | undefined;
      appointmentDocumentVersionId: string;
      evidence: Array<{ linkRole: AppointmentLinkRole; documentVersionId: string }>;
    },
    settings: SettingsRecord,
  ): Promise<{
    effectivityDate: Date;
    formVariant: AppointmentFormVariant;
    signatureEvidenceDocumentVersionId: string | null;
    appointmentDocumentVersionId: string;
    evidence: Array<{ linkRole: AppointmentLinkRole; documentVersionId: string }>;
  }> {
    const effectivityDate = toDatabaseDate(input.effectivityDate);
    const authority = await transaction.agencyMembership.findFirst({
      where: {
        agencyId: context.agencyId,
        id: input.appointingAuthorityMembershipId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (!authority) {
      throw new AppointmentServiceError(
        'The Appointing Authority is not an active Agency Membership.',
        409,
        'APPOINTMENT_AUTHORITY_INVALID',
      );
    }
    const byRole = new Map<string, string[]>();
    for (const link of input.evidence) {
      byRole.set(link.linkRole, [...(byRole.get(link.linkRole) ?? []), link.documentVersionId]);
    }
    for (const role of REQUIRED_APPOINTMENT_LINK_ROLES) {
      if (!(byRole.get(role)?.length ?? 0)) {
        throw new AppointmentServiceError(
          `The Appointment requires ${role} evidence.`,
          409,
          'APPOINTMENT_EVIDENCE_REQUIRED',
        );
      }
    }
    const resolvedEvidence: Array<{ linkRole: AppointmentLinkRole; documentVersionId: string }> =
      [];
    for (const link of input.evidence) {
      const version = await this.documentsService.resolveFinalizedVersionInTransaction(
        transaction,
        context,
        link.documentVersionId,
      );
      if (!version) {
        throw new AppointmentServiceError(
          `The ${link.linkRole} evidence must be a finalized Document Version.`,
          409,
          'APPOINTMENT_EVIDENCE_INVALID',
        );
      }
      resolvedEvidence.push({ linkRole: link.linkRole, documentVersionId: version.id });
    }
    const appointmentDocument = await this.documentsService.resolveFinalizedVersionInTransaction(
      transaction,
      context,
      input.appointmentDocumentVersionId,
    );
    if (!appointmentDocument) {
      throw new AppointmentServiceError(
        'The Appointment form must be a finalized Document Version.',
        409,
        'APPOINTMENT_FORM_INVALID',
      );
    }
    let signatureEvidenceDocumentVersionId: string | null = null;
    if (input.signatureMethod !== 'WET_INK') {
      const evidenceVersionId = input.signatureEvidenceDocumentVersionId;
      if (!evidenceVersionId) {
        throw new AppointmentServiceError(
          'Electronic and digital signatures require their evidenced certification.',
          409,
          'APPOINTMENT_SIGNATURE_EVIDENCE_REQUIRED',
        );
      }
      const signatureEvidence = await this.documentsService.resolveFinalizedVersionInTransaction(
        transaction,
        context,
        evidenceVersionId,
      );
      if (!signatureEvidence) {
        throw new AppointmentServiceError(
          'The signature evidence must be a finalized Document Version.',
          409,
          'APPOINTMENT_SIGNATURE_EVIDENCE_INVALID',
        );
      }
      signatureEvidenceDocumentVersionId = signatureEvidence.id;
    }
    return {
      effectivityDate,
      formVariant: appointmentFormVariant(settingsSummary(settings).regulatoryStatus),
      signatureEvidenceDocumentVersionId,
      appointmentDocumentVersionId: appointmentDocument.id,
      evidence: resolvedEvidence,
    };
  }

  private async requireCompleteEvidence(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    version: AppointmentVersionRecord | null,
    settings: SettingsRecord,
  ): Promise<Array<{ linkRole: string; documentVersionId: string }>> {
    if (!version) throw this.versionNotFound();
    const links = await transaction.appointmentDocumentVersionLink.findMany({
      where: { agencyId: context.agencyId, appointmentVersionId: version.id },
      select: { linkRole: true, documentVersionId: true },
    });
    const byRole = new Map<string, number>();
    for (const link of links) {
      byRole.set(link.linkRole, (byRole.get(link.linkRole) ?? 0) + 1);
      const resolved = await this.documentsService.resolveFinalizedVersionInTransaction(
        transaction,
        context,
        link.documentVersionId,
      );
      if (!resolved) {
        throw new AppointmentServiceError(
          `The ${link.linkRole} evidence must be a finalized Document Version.`,
          409,
          'APPOINTMENT_EVIDENCE_INVALID',
        );
      }
    }
    for (const role of REQUIRED_APPOINTMENT_LINK_ROLES) {
      if (!byRole.get(role)) {
        throw new AppointmentServiceError(
          `The Appointment requires ${role} evidence.`,
          409,
          'APPOINTMENT_EVIDENCE_REQUIRED',
        );
      }
    }
    const formVariant = appointmentFormVariant(settingsSummary(settings).regulatoryStatus);
    if (version.formVariant !== formVariant) {
      throw new AppointmentServiceError(
        'The Agency form path changed after this version was prepared.',
        409,
        'APPOINTMENT_FORM_VARIANT_INVALID',
      );
    }
    if (version.signatureMethod !== 'WET_INK') {
      if (!version.signatureEvidenceDocumentVersionId) {
        throw new AppointmentServiceError(
          'Electronic and digital signatures require their evidenced certification.',
          409,
          'APPOINTMENT_SIGNATURE_EVIDENCE_REQUIRED',
        );
      }
      const signatureEvidence = await this.documentsService.resolveFinalizedVersionInTransaction(
        transaction,
        context,
        version.signatureEvidenceDocumentVersionId,
      );
      if (!signatureEvidence) {
        throw new AppointmentServiceError(
          'The signature evidence must be a finalized Document Version.',
          409,
          'APPOINTMENT_SIGNATURE_EVIDENCE_INVALID',
        );
      }
    }
    const appointmentDocument = await this.documentsService.resolveFinalizedVersionInTransaction(
      transaction,
      context,
      version.appointmentDocumentVersionId,
    );
    if (!appointmentDocument) {
      throw new AppointmentServiceError(
        'The Appointment form must be a finalized Document Version.',
        409,
        'APPOINTMENT_FORM_INVALID',
      );
    }
    return links;
  }

  private async replaceEvidenceLinks(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    appointmentVersionId: string,
    evidence: Array<{ linkRole: AppointmentLinkRole; documentVersionId: string }>,
  ): Promise<void> {
    await transaction.appointmentDocumentVersionLink.deleteMany({
      where: { agencyId: context.agencyId, appointmentVersionId },
    });
    if (evidence.length === 0) return;
    await transaction.appointmentDocumentVersionLink.createMany({
      data: evidence.map((link) => ({
        agencyId: context.agencyId,
        appointmentVersionId,
        documentVersionId: link.documentVersionId,
        linkRole: link.linkRole,
      })),
    });
  }

  private async idempotentEvent(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    action: string,
    idempotencyKey: string,
  ): Promise<{ entityId: string } | null> {
    return transaction.auditEvent.findFirst({
      where: { agencyId: context.agencyId, action, idempotencyKey },
      select: { entityId: true },
    });
  }

  private async writeAudit(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: {
      action: string;
      entityId: string;
      previousStatus: string | null;
      newStatus: string | null;
      reason: string;
      metadata: Prisma.InputJsonObject;
      idempotencyKey?: string | undefined;
    },
  ): Promise<void> {
    await transaction.auditEvent.create({
      data: {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: input.action,
        entityType: 'Appointment',
        entityId: input.entityId,
        previousStatus: input.previousStatus,
        newStatus: input.newStatus,
        reason: input.reason,
        requestId: context.requestId,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        metadata: safeAuditMetadata(input.metadata),
      },
    });
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (
      !context.agencyId ||
      !context.userId ||
      !context.membershipId ||
      !hasPermission(context, permission, { agencyId: context.agencyId })
    ) {
      throw new AppointmentServiceError(
        'The current Agency Membership cannot perform this Appointment action.',
        403,
        code,
      );
    }
  }

  private notFound(): AppointmentServiceError {
    return new AppointmentServiceError(
      'The Appointment could not be found.',
      404,
      'APPOINTMENT_NOT_FOUND',
    );
  }

  private versionNotFound(): AppointmentServiceError {
    return new AppointmentServiceError(
      'The Appointment version could not be found.',
      404,
      'APPOINTMENT_VERSION_NOT_FOUND',
    );
  }

  private transitionNotAllowed(record: { workflowStatus: string }): AppointmentServiceError {
    return new AppointmentServiceError(
      `The Appointment cannot perform this action from ${record.workflowStatus}.`,
      409,
      'APPOINTMENT_TRANSITION_NOT_ALLOWED',
    );
  }
}
