import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import {
  EmployeesService,
  EmployeeServiceError,
  type EmployeeActivationSummary,
} from '../employees/employees.service';
import {
  PlantillaPositionsService,
  PlantillaPositionServiceError,
} from '../plantilla-positions/plantilla-positions.service';
import { QualificationStandardsService } from '../qualification-standards/qualification-standards.service';
import { ApplicationsService } from '../recruitment/applications.service';
import { RecruitmentService, RecruitmentServiceError } from '../recruitment/recruitment.service';
import { SelectionService } from '../recruitment/selection.service';
import {
  APPOINTMENT_ASSUMPTION_OUTCOMES,
  APPOINTMENT_ASSUMPTION_STATUSES,
  APPOINTMENT_EMPLOYMENT_STATUSES,
  APPOINTMENT_EXTERNAL_ACTIONS,
  APPOINTMENT_EXTERNAL_SUBMISSION_EVENT_TYPES,
  APPOINTMENT_LINK_ROLES,
  APPOINTMENT_NATURES,
  APPOINTMENT_REGULATORY_STATUSES,
  APPOINTMENT_SIGNATURE_METHODS,
  APPOINTMENT_WORKFLOW_STATUSES,
  type appointmentActivationSchema,
  type appointmentAssumptionCancellationSchema,
  type appointmentAssumptionCorrectionSchema,
  type appointmentAssumptionFailureSchema,
  type appointmentAssumptionSchema,
  type appointmentCancelSchema,
  type appointmentCorrectionSchema,
  type appointmentCreateSchema,
  type appointmentExternalActionSchema,
  type appointmentExternalSubmissionSchema,
  type appointmentListSchema,
  type appointmentOathCorrectionSchema,
  type appointmentOathSchema,
  type appointmentReasonSchema,
  type appointmentReceiptSchema,
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
export type AppointmentExternalSubmissionEventType =
  (typeof APPOINTMENT_EXTERNAL_SUBMISSION_EVENT_TYPES)[number];
export type AppointmentExternalAction = (typeof APPOINTMENT_EXTERNAL_ACTIONS)[number];
export type AppointmentExternalStanding =
  'NOT_SUBMITTED' | AppointmentExternalSubmissionEventType | AppointmentExternalAction;
export type AppointmentAssumptionStatus = (typeof APPOINTMENT_ASSUMPTION_STATUSES)[number];
export type AppointmentAssumptionOutcome = (typeof APPOINTMENT_ASSUMPTION_OUTCOMES)[number];

const ASSUMPTION_LIFECYCLE_ACTIONS = [
  'APPOINTMENT_RECEIPT_RECORDED',
  'APPOINTMENT_OATH_RECORDED',
  'APPOINTMENT_OATH_CORRECTED',
  'APPOINTMENT_ASSUMPTION_RECORDED',
  'APPOINTMENT_ASSUMPTION_CORRECTED',
  'APPOINTMENT_ASSUMPTION_FAILED',
  'APPOINTMENT_ASSUMPTION_CANCELLED',
] as const;

export const REQUIRED_APPOINTMENT_LINK_ROLES: readonly AppointmentLinkRole[] = [
  'PDS',
  'WORK_EXPERIENCE_SHEET',
  'ELIGIBILITY_PROOF',
  'POSITION_DESCRIPTION_FORM',
  'SELECTION_CERTIFICATION',
  'PUBLICATION_CERTIFICATION',
  'AUTHORITY_OR_DELEGATION',
];

export const MOVEMENT_APPOINTMENT_NATURES: readonly AppointmentNature[] = [
  'PROMOTION',
  'TRANSFER',
  'DEMOTION',
  'RECLASSIFICATION',
  'REINSTATEMENT',
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
  acknowledgment: AppointmentAcknowledgmentSummary | null;
  oath: AppointmentOathSummary | null;
  assumption: AppointmentAssumptionSummary | null;
}

export interface AppointmentSummary {
  id: string;
  workflowStatus: AppointmentWorkflowStatus;
  externalStanding: AppointmentExternalStanding;
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

export interface AppointmentExternalEvidenceSummary {
  documentVersionId: string;
  documentId: string;
  documentNo: string | null;
  documentType: string;
  classification: string;
  versionNo: number;
  issuedAt: string;
}

export interface AppointmentExternalSubmissionSummary {
  id: string;
  appointmentVersionId: string;
  eventType: AppointmentExternalSubmissionEventType;
  externalReference: string | null;
  occurredAt: string;
  receivingOffice: string;
  recordedByMembershipId: string;
  reason: string | null;
  evidence: AppointmentExternalEvidenceSummary;
}

export interface AppointmentExternalActionSummary {
  id: string;
  appointmentVersionId: string;
  action: AppointmentExternalAction;
  externalReference: string;
  actionAt: string;
  recordedByMembershipId: string;
  reason: string | null;
  evidence: AppointmentExternalEvidenceSummary;
}

export interface AppointmentRecordedEvidenceSummary {
  documentVersionId: string;
  documentId: string;
  documentNo: string | null;
  documentType: string;
  classification: string;
  versionNo: number;
  issuedAt: string;
}

export interface AppointmentAcknowledgmentSummary {
  acknowledgedAt: string;
  evidence: AppointmentRecordedEvidenceSummary;
}

export interface AppointmentOathVersionSummary {
  id: string;
  versionNo: number;
  oathDate: string;
  administeredByMembershipId: string;
  authority: string;
  place: string | null;
  permittedVirtualMethod: string | null;
  replacesOathVersionId: string | null;
  correctionReason: string | null;
  correctionAuthorityDocumentVersionId: string | null;
  recordedAt: string;
  evidence: AppointmentRecordedEvidenceSummary;
}

export interface AppointmentOathSummary {
  id: string;
  currentVersion: AppointmentOathVersionSummary | null;
  versions: AppointmentOathVersionSummary[];
}

export interface AppointmentAssumptionVersionSummary {
  id: string;
  versionNo: number;
  oathVersionId: string;
  actualAssumptionDate: string;
  certifiedByMembershipId: string;
  certifyingAuthority: string;
  certifiedAt: string;
  replacesAssumptionVersionId: string | null;
  correctionReason: string | null;
  correctionAuthorityDocumentVersionId: string | null;
  recordedAt: string;
  evidence: AppointmentRecordedEvidenceSummary;
}

export interface AppointmentAssumptionOutcomeSummary {
  id: string;
  outcome: AppointmentAssumptionOutcome;
  noticeDate: string | null;
  deadlineDate: string | null;
  outcomeDate: string;
  reason: string;
  authorizedByMembershipId: string;
  authorityDocumentVersionId: string;
  evidenceDocumentVersionId: string;
  recordedAt: string;
}

export interface AppointmentAssumptionSummary {
  id: string;
  appointmentVersionId: string;
  status: AppointmentAssumptionStatus;
  currentVersion: AppointmentAssumptionVersionSummary | null;
  versions: AppointmentAssumptionVersionSummary[];
  outcome: AppointmentAssumptionOutcomeSummary | null;
}

export interface AppointmentContractPosition {
  id: string;
  itemNumber: string;
  title: string | null;
  salaryGrade: number | null;
  organizationUnitId: string | null;
}

export interface IssuedAppointmentContract {
  contractSchemaVersion: number;
  appointmentId: string;
  appointmentVersionId: string;
  personKey: string;
  fullName: string;
  applicationNo: string;
  employmentStatus: AppointmentEmploymentStatus;
  natureOfAppointment: AppointmentNature;
  formVariant: AppointmentFormVariant;
  signatureMethod: AppointmentSignatureMethod;
  issuedAt: string;
  effectivityDate: string;
  position: AppointmentContractPosition;
  reservation: { id: string; status: string } | null;
  compensation: { salaryGrade: number; salaryStep: number };
  externalStanding: AppointmentExternalStanding;
  acknowledgment: AppointmentAcknowledgmentSummary | null;
  oath: AppointmentOathSummary | null;
}

export interface AssumedAppointmentContract extends IssuedAppointmentContract {
  acknowledgment: AppointmentAcknowledgmentSummary;
  oath: AppointmentOathSummary;
  assumption: AppointmentAssumptionSummary;
}

export const APPOINTMENT_CONTRACT_SCHEMA_VERSION = 1;

export interface AppointmentDetail extends AppointmentSummary {
  selectionPackage: unknown;
  versions: AppointmentVersionDetail[];
  history: AppointmentHistoryEntry[];
  settings: AppointmentSettingsSummary | null;
  externalSubmissions: AppointmentExternalSubmissionSummary[];
  externalActions: AppointmentExternalActionSummary[];
  activation: EmployeeActivationSummary | null;
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

export interface MovementAppointmentCandidateSummary {
  appointmentId: string;
  appointmentVersionId: string;
  applicationNo: string;
  appointee: { personKey: string; fullName: string };
  natureOfAppointment: AppointmentNature;
  employmentStatus: AppointmentEmploymentStatus;
  effectivityDate: string;
  issuedAt: string | null;
  actualAssumptionDate: string;
  position: AppointmentContractPosition;
  compensation: { salaryGrade: number; salaryStep: number };
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

const evidenceDocumentVersionSelect = {
  documentId: true,
  versionNo: true,
  issuedAt: true,
  createdAt: true,
  document: {
    select: { documentNo: true, documentType: true, classification: true },
  },
};

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

const acknowledgmentSelect = {
  id: true,
  appointmentVersionId: true,
  acknowledgedAt: true,
  evidenceDocumentVersionId: true,
  evidenceDocumentVersion: { select: evidenceDocumentVersionSelect },
} satisfies Prisma.AppointmentAcknowledgmentSelect;

const oathVersionSelect = {
  id: true,
  oathId: true,
  versionNo: true,
  oathDate: true,
  administeredByMembershipId: true,
  authority: true,
  place: true,
  permittedVirtualMethod: true,
  documentVersionId: true,
  replacesOathVersionId: true,
  correctionReason: true,
  correctionAuthorityDocumentVersionId: true,
  recordedAt: true,
  documentVersion: { select: evidenceDocumentVersionSelect },
} satisfies Prisma.OathVersionSelect;

const oathSelect = {
  id: true,
  appointmentVersionId: true,
  currentVersionId: true,
  currentVersion: { select: oathVersionSelect },
  versions: { select: oathVersionSelect, orderBy: { versionNo: 'asc' as const } },
} satisfies Prisma.OathOfOfficeSelect;

const assumptionVersionSelect = {
  id: true,
  assumptionId: true,
  versionNo: true,
  oathVersionId: true,
  actualAssumptionDate: true,
  certifiedByMembershipId: true,
  certifyingAuthority: true,
  certifiedAt: true,
  documentVersionId: true,
  replacesAssumptionVersionId: true,
  correctionReason: true,
  correctionAuthorityDocumentVersionId: true,
  recordedAt: true,
  documentVersion: { select: evidenceDocumentVersionSelect },
} satisfies Prisma.AssumptionVersionSelect;

const assumptionOutcomeSelect = {
  id: true,
  outcome: true,
  noticeDate: true,
  deadlineDate: true,
  outcomeDate: true,
  reason: true,
  authorizedByMembershipId: true,
  authorityDocumentVersionId: true,
  evidenceDocumentVersionId: true,
  recordedAt: true,
} satisfies Prisma.AssumptionOutcomeEventSelect;

const assumptionSelect = {
  id: true,
  appointmentVersionId: true,
  status: true,
  currentVersionId: true,
  currentVersion: { select: assumptionVersionSelect },
  versions: { select: assumptionVersionSelect, orderBy: { versionNo: 'asc' as const } },
  outcome: { select: assumptionOutcomeSelect },
} satisfies Prisma.AssumptionToDutySelect;

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
  acknowledgment: { select: acknowledgmentSelect },
  oath: { select: oathSelect },
  assumption: { select: assumptionSelect },
} satisfies Prisma.AppointmentVersionSelect;

const contractVersionSelect = {
  ...versionCoreSelect,
  appointment: {
    select: {
      id: true,
      positionId: true,
      appointeePersonKey: true,
      workflowStatus: true,
      currentVersionId: true,
      recruitmentSelectionPackage: true,
    },
  },
  acknowledgment: { select: acknowledgmentSelect },
  oath: { select: oathSelect },
  assumption: { select: assumptionSelect },
} satisfies Prisma.AppointmentVersionSelect;

const externalSubmissionSelect = {
  id: true,
  appointmentVersionId: true,
  eventType: true,
  externalReference: true,
  occurredAt: true,
  receivingOffice: true,
  recordedByMembershipId: true,
  reason: true,
  evidenceDocumentVersionId: true,
  evidenceDocumentVersion: { select: evidenceDocumentVersionSelect },
} satisfies Prisma.AppointmentExternalSubmissionEventSelect;

const externalActionSelect = {
  id: true,
  appointmentVersionId: true,
  action: true,
  externalReference: true,
  actionAt: true,
  recordedByMembershipId: true,
  reason: true,
  evidenceDocumentVersionId: true,
  evidenceDocumentVersion: { select: evidenceDocumentVersionSelect },
} satisfies Prisma.AppointmentExternalActionSelect;

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
type ExternalSubmissionRecord = Prisma.AppointmentExternalSubmissionEventGetPayload<{
  select: typeof externalSubmissionSelect;
}>;
type ExternalActionRecord = Prisma.AppointmentExternalActionGetPayload<{
  select: typeof externalActionSelect;
}>;
type AcknowledgmentRecord = Prisma.AppointmentAcknowledgmentGetPayload<{
  select: typeof acknowledgmentSelect;
}>;
type OathVersionRecord = Prisma.OathVersionGetPayload<{ select: typeof oathVersionSelect }>;
type OathRecord = Prisma.OathOfOfficeGetPayload<{ select: typeof oathSelect }>;
type AssumptionVersionRecord = Prisma.AssumptionVersionGetPayload<{
  select: typeof assumptionVersionSelect;
}>;
type AssumptionOutcomeRecord = Prisma.AssumptionOutcomeEventGetPayload<{
  select: typeof assumptionOutcomeSelect;
}>;
type AssumptionRecord = Prisma.AssumptionToDutyGetPayload<{ select: typeof assumptionSelect }>;
type ContractVersionRecord = Prisma.AppointmentVersionGetPayload<{
  select: typeof contractVersionSelect;
}>;

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
  'externalReference',
  'receivingOffice',
  'externalStanding',
  'oathId',
  'oathVersionId',
  'oathDate',
  'predecessorOathVersionId',
  'assumptionId',
  'assumptionVersionId',
  'predecessorAssumptionVersionId',
  'actualAssumptionDate',
  'outcome',
  'outcomeDate',
  'noticeDate',
  'deadlineDate',
  'authorityDocumentVersionId',
  'employeeId',
  'employeeNumber',
  'serviceSegmentId',
  'positionIncumbencyId',
  'positionVersionId',
  'appointmentVersionId',
  'applicationId',
  'publicationId',
  'requestId',
]);

// External events are the source of truth: the standing is whichever supported
// event happened last, so a resubmission after an adverse action stands until a
// newer official action arrives. An action wins only a same-instant tie.
export function deriveAppointmentExternalStanding(
  submissions: ReadonlyArray<{ eventType: string; occurredAt: string }>,
  actions: ReadonlyArray<{ action: string; actionAt: string }>,
): AppointmentExternalStanding {
  const latestAction = actions.reduce<{ action: string; actionAt: string } | null>(
    (latest, item) => (!latest || item.actionAt >= latest.actionAt ? item : latest),
    null,
  );
  const latestSubmission = submissions.reduce<{ eventType: string; occurredAt: string } | null>(
    (latest, item) => (!latest || item.occurredAt >= latest.occurredAt ? item : latest),
    null,
  );
  if (
    latestAction &&
    APPOINTMENT_EXTERNAL_ACTIONS.includes(latestAction.action as AppointmentExternalAction) &&
    (!latestSubmission || latestAction.actionAt >= latestSubmission.occurredAt)
  ) {
    return latestAction.action as AppointmentExternalAction;
  }
  if (
    latestSubmission &&
    APPOINTMENT_EXTERNAL_SUBMISSION_EVENT_TYPES.includes(
      latestSubmission.eventType as AppointmentExternalSubmissionEventType,
    )
  ) {
    return latestSubmission.eventType as AppointmentExternalSubmissionEventType;
  }
  return 'NOT_SUBMITTED';
}

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

function manilaDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function manilaToday(): string {
  return manilaDate(new Date());
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

function assumptionStatus(value: string): AppointmentAssumptionStatus {
  if (APPOINTMENT_ASSUMPTION_STATUSES.includes(value as AppointmentAssumptionStatus)) {
    return value as AppointmentAssumptionStatus;
  }
  throw new AppointmentServiceError(
    'The stored Assumption to Duty status is invalid.',
    500,
    'APPOINTMENT_DATA_INVALID',
  );
}

function assumptionOutcome(value: string): AppointmentAssumptionOutcome {
  if (APPOINTMENT_ASSUMPTION_OUTCOMES.includes(value as AppointmentAssumptionOutcome)) {
    return value as AppointmentAssumptionOutcome;
  }
  throw new AppointmentServiceError(
    'The stored Assumption to Duty outcome is invalid.',
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
    acknowledgment: record.acknowledgment ? acknowledgmentSummary(record.acknowledgment) : null,
    oath: oathSummary(record.oath),
    assumption: assumptionSummary(record.assumption),
  };
}

function recordedEvidence(
  documentVersionId: string,
  version: {
    documentId: string;
    versionNo: number;
    issuedAt: Date | null;
    createdAt: Date;
    document: { documentNo: string | null; documentType: string; classification: string };
  },
): AppointmentRecordedEvidenceSummary {
  return {
    documentVersionId,
    documentId: version.documentId,
    documentNo: version.document.documentNo,
    documentType: version.document.documentType,
    classification: version.document.classification,
    versionNo: version.versionNo,
    issuedAt: formatDateTime(version.issuedAt ?? version.createdAt),
  };
}

function externalEvidence(
  record: ExternalSubmissionRecord | ExternalActionRecord,
): AppointmentExternalEvidenceSummary {
  return recordedEvidence(record.evidenceDocumentVersionId, record.evidenceDocumentVersion);
}

function externalSubmissionSummary(
  record: ExternalSubmissionRecord,
): AppointmentExternalSubmissionSummary {
  return {
    id: record.id,
    appointmentVersionId: record.appointmentVersionId,
    eventType: record.eventType as AppointmentExternalSubmissionEventType,
    externalReference: record.externalReference,
    occurredAt: formatDateTime(record.occurredAt),
    receivingOffice: record.receivingOffice,
    recordedByMembershipId: record.recordedByMembershipId,
    reason: record.reason,
    evidence: externalEvidence(record),
  };
}

function externalActionSummary(record: ExternalActionRecord): AppointmentExternalActionSummary {
  return {
    id: record.id,
    appointmentVersionId: record.appointmentVersionId,
    action: record.action as AppointmentExternalAction,
    externalReference: record.externalReference,
    actionAt: formatDateTime(record.actionAt),
    recordedByMembershipId: record.recordedByMembershipId,
    reason: record.reason,
    evidence: externalEvidence(record),
  };
}

function acknowledgmentSummary(record: AcknowledgmentRecord): AppointmentAcknowledgmentSummary {
  return {
    acknowledgedAt: formatDateTime(record.acknowledgedAt),
    evidence: recordedEvidence(record.evidenceDocumentVersionId, record.evidenceDocumentVersion),
  };
}

function oathVersionSummary(record: OathVersionRecord): AppointmentOathVersionSummary {
  return {
    id: record.id,
    versionNo: record.versionNo,
    oathDate: formatDate(record.oathDate),
    administeredByMembershipId: record.administeredByMembershipId,
    authority: record.authority,
    place: record.place,
    permittedVirtualMethod: record.permittedVirtualMethod,
    replacesOathVersionId: record.replacesOathVersionId,
    correctionReason: record.correctionReason,
    correctionAuthorityDocumentVersionId: record.correctionAuthorityDocumentVersionId,
    recordedAt: formatDateTime(record.recordedAt),
    evidence: recordedEvidence(record.documentVersionId, record.documentVersion),
  };
}

function oathSummary(record: OathRecord | null): AppointmentOathSummary | null {
  if (!record) return null;
  return {
    id: record.id,
    currentVersion: record.currentVersion ? oathVersionSummary(record.currentVersion) : null,
    versions: record.versions.map(oathVersionSummary),
  };
}

function assumptionVersionSummary(
  record: AssumptionVersionRecord,
): AppointmentAssumptionVersionSummary {
  return {
    id: record.id,
    versionNo: record.versionNo,
    oathVersionId: record.oathVersionId,
    actualAssumptionDate: formatDate(record.actualAssumptionDate),
    certifiedByMembershipId: record.certifiedByMembershipId,
    certifyingAuthority: record.certifyingAuthority,
    certifiedAt: formatDateTime(record.certifiedAt),
    replacesAssumptionVersionId: record.replacesAssumptionVersionId,
    correctionReason: record.correctionReason,
    correctionAuthorityDocumentVersionId: record.correctionAuthorityDocumentVersionId,
    recordedAt: formatDateTime(record.recordedAt),
    evidence: recordedEvidence(record.documentVersionId, record.documentVersion),
  };
}

function assumptionOutcomeSummary(
  record: AssumptionOutcomeRecord,
): AppointmentAssumptionOutcomeSummary {
  return {
    id: record.id,
    outcome: assumptionOutcome(record.outcome),
    noticeDate: record.noticeDate ? formatDate(record.noticeDate) : null,
    deadlineDate: record.deadlineDate ? formatDate(record.deadlineDate) : null,
    outcomeDate: formatDate(record.outcomeDate),
    reason: record.reason,
    authorizedByMembershipId: record.authorizedByMembershipId,
    authorityDocumentVersionId: record.authorityDocumentVersionId,
    evidenceDocumentVersionId: record.evidenceDocumentVersionId,
    recordedAt: formatDateTime(record.recordedAt),
  };
}

function assumptionSummary(record: AssumptionRecord | null): AppointmentAssumptionSummary | null {
  if (!record) return null;
  return {
    id: record.id,
    appointmentVersionId: record.appointmentVersionId,
    status: assumptionStatus(record.status),
    currentVersion: record.currentVersion ? assumptionVersionSummary(record.currentVersion) : null,
    versions: record.versions.map(assumptionVersionSummary),
    outcome: record.outcome ? assumptionOutcomeSummary(record.outcome) : null,
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

function appointmentSummary(
  record: AppointmentRecord,
  externalStanding: AppointmentExternalStanding,
): AppointmentSummary {
  const view = selectionPackageView(record.recruitmentSelectionPackage);
  return {
    id: record.id,
    workflowStatus: workflowStatus(record.workflowStatus),
    externalStanding,
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
    @Inject(EmployeesService) private readonly employeesService: EmployeesService,
    @Inject(PlantillaPositionsService)
    private readonly plantillaPositions: PlantillaPositionsService,
    @Inject(QualificationStandardsService)
    private readonly qualificationStandards: QualificationStandardsService,
    @Inject(ApplicationsService) private readonly applicationsService: ApplicationsService,
    @Inject(RecruitmentService) private readonly recruitmentService: RecruitmentService,
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
      const standings = await this.externalStandingsInTransaction(
        transaction,
        context,
        page.map((record) => record.id),
      );
      return {
        items: page.map((record) =>
          appointmentSummary(record, standings.get(record.id) ?? 'NOT_SUBMITTED'),
        ),
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

  /**
   * Internal selection surface for Personnel Action preparation: issued
   * Appointments with a valid Assumption to Duty whose reserved item is still
   * unconsumed. The projection carries only the facts the movement contract owns.
   */
  async listMovementCandidates(
    context: RequestContext,
  ): Promise<MovementAppointmentCandidateSummary[]> {
    this.assertPermission(context, 'appointments.records.read', 'APPOINTMENT_READ_FORBIDDEN');
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const records = await transaction.appointmentVersion.findMany({
        where: {
          agencyId: context.agencyId,
          status: 'ISSUED',
          natureOfAppointment: { in: [...MOVEMENT_APPOINTMENT_NATURES] },
          assumption: { status: 'ASSUMED' },
          appointment: { workflowStatus: 'ISSUED', position: { status: 'RESERVED' } },
        },
        orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
        take: 100,
        select: contractVersionSelect,
      });
      return records.flatMap((record): MovementAppointmentCandidateSummary[] => {
        const assumption = record.assumption?.currentVersion;
        if (!assumption) return [];
        const view = selectionPackageView(record.appointment.recruitmentSelectionPackage);
        return [
          {
            appointmentId: record.appointmentId,
            appointmentVersionId: record.id,
            applicationNo: view.applicationNo,
            appointee: {
              personKey: record.appointment.appointeePersonKey,
              fullName: view.applicantName,
            },
            natureOfAppointment: record.natureOfAppointment as AppointmentNature,
            employmentStatus: record.employmentStatus as AppointmentEmploymentStatus,
            effectivityDate: formatDate(record.effectivityDate),
            issuedAt: record.issuedAt ? formatDateTime(record.issuedAt) : null,
            actualAssumptionDate: formatDate(assumption.actualAssumptionDate),
            position: view.position,
            compensation: { salaryGrade: record.salaryGrade, salaryStep: record.salaryStep },
          },
        ];
      });
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
        const reservationReleased = await this.releaseReservationForAppointmentInTransaction(
          transaction,
          context,
          record,
          `Appointment cancelled: ${input.reason}`,
          idempotencyKey,
        );
        await this.cancelAppointmentRecordInTransaction(
          transaction,
          context,
          appointmentId,
          record.workflowStatus,
          input.reason,
          {
            positionId: record.positionId,
            versionId: record.currentVersion?.id ?? null,
            reservationReleased,
            documentVersionId: input.authorityDocumentVersionId,
          },
          idempotencyKey,
        );
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

  async recordExternalSubmission(
    context: RequestContext,
    appointmentId: string,
    input: z.infer<typeof appointmentExternalSubmissionSchema>,
    rawIdempotencyKey?: string,
  ): Promise<AppointmentDetail> {
    this.assertPermission(
      context,
      'appointments.external_events.record',
      'APPOINTMENT_EXTERNAL_EVENT_FORBIDDEN',
    );
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'appointment-transition'),
      async (transaction) => {
        if (idempotencyKey) {
          const completed = await this.idempotentEvent(
            transaction,
            context,
            'APPOINTMENT_EXTERNAL_SUBMISSION_RECORDED',
            idempotencyKey,
          );
          if (completed) return this.detailInTransaction(transaction, context, completed.entityId);
        }
        const record = await this.requireAppointment(transaction, context, appointmentId);
        const version = this.requireIssuedExternalVersion(record, input.appointmentVersionId);
        await this.requireSettings(transaction, context);
        const evidence = await this.documentsService.resolveFinalizedVersionInTransaction(
          transaction,
          context,
          input.evidenceDocumentVersionId,
        );
        if (!evidence) {
          throw new AppointmentServiceError(
            'The external submission evidence must be a finalized Document Version.',
            409,
            'APPOINTMENT_EXTERNAL_EVIDENCE_INVALID',
          );
        }
        await transaction.appointmentExternalSubmissionEvent.create({
          data: {
            agencyId: context.agencyId,
            appointmentVersionId: version.id,
            eventType: input.eventType,
            externalReference: input.externalReference ?? null,
            occurredAt: new Date(input.occurredAt),
            receivingOffice: input.receivingOffice,
            recordedByMembershipId: context.membershipId,
            reason: input.reason ?? null,
            evidenceDocumentVersionId: evidence.id,
          },
          select: { id: true },
        });
        const standing = await this.standingInTransaction(transaction, context, appointmentId);
        await this.writeAudit(transaction, context, {
          action: 'APPOINTMENT_EXTERNAL_SUBMISSION_RECORDED',
          entityId: appointmentId,
          previousStatus: null,
          newStatus: input.eventType,
          reason: input.reason ?? `External ${input.eventType.toLowerCase()} event recorded.`,
          metadata: {
            versionId: version.id,
            documentVersionId: input.evidenceDocumentVersionId,
            ...(input.externalReference ? { externalReference: input.externalReference } : {}),
            receivingOffice: input.receivingOffice,
            externalStanding: standing,
          },
          idempotencyKey,
        });
        return this.detailInTransaction(transaction, context, appointmentId);
      },
    );
  }

  async recordExternalAction(
    context: RequestContext,
    appointmentId: string,
    input: z.infer<typeof appointmentExternalActionSchema>,
    rawIdempotencyKey?: string,
  ): Promise<AppointmentDetail> {
    this.assertPermission(
      context,
      'appointments.external_actions.record',
      'APPOINTMENT_EXTERNAL_ACTION_FORBIDDEN',
    );
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'appointment-transition'),
      async (transaction) => {
        if (idempotencyKey) {
          const completed = await this.idempotentEvent(
            transaction,
            context,
            'APPOINTMENT_EXTERNAL_ACTION_RECORDED',
            idempotencyKey,
          );
          if (completed) return this.detailInTransaction(transaction, context, completed.entityId);
        }
        const record = await this.requireAppointment(transaction, context, appointmentId);
        const version = this.requireIssuedExternalVersion(record, input.appointmentVersionId);
        const settings = await this.requireSettings(transaction, context);
        const regulatoryStatus = settingsSummary(settings).regulatoryStatus;
        const allowed: readonly AppointmentExternalAction[] =
          regulatoryStatus === 'REGULATED'
            ? ['APPROVED', 'DISAPPROVED']
            : ['VALIDATED', 'INVALIDATED'];
        if (!allowed.includes(input.action)) {
          throw new AppointmentServiceError(
            regulatoryStatus === 'REGULATED'
              ? 'A regulated Agency records approval or disapproval.'
              : 'An accredited or deregulated Agency records validation or invalidation.',
            409,
            'APPOINTMENT_EXTERNAL_ACTION_INVALID',
          );
        }
        const evidence = await this.documentsService.resolveFinalizedVersionInTransaction(
          transaction,
          context,
          input.evidenceDocumentVersionId,
        );
        if (!evidence) {
          throw new AppointmentServiceError(
            'The official action evidence must be a finalized Document Version.',
            409,
            'APPOINTMENT_EXTERNAL_EVIDENCE_INVALID',
          );
        }
        await transaction.appointmentExternalAction.create({
          data: {
            agencyId: context.agencyId,
            appointmentVersionId: version.id,
            action: input.action,
            externalReference: input.externalReference,
            actionAt: new Date(input.actionAt),
            recordedByMembershipId: context.membershipId,
            reason: input.reason ?? null,
            evidenceDocumentVersionId: evidence.id,
          },
          select: { id: true },
        });
        const standing = await this.standingInTransaction(transaction, context, appointmentId);
        await this.writeAudit(transaction, context, {
          action: 'APPOINTMENT_EXTERNAL_ACTION_RECORDED',
          entityId: appointmentId,
          previousStatus: null,
          newStatus: input.action,
          reason:
            input.reason ?? `Official external ${input.action.toLowerCase()} action recorded.`,
          metadata: {
            versionId: version.id,
            documentVersionId: input.evidenceDocumentVersionId,
            externalReference: input.externalReference,
            regulatoryStatus,
            externalStanding: standing,
          },
          idempotencyKey,
        });
        return this.detailInTransaction(transaction, context, appointmentId);
      },
    );
  }

  async recordReceipt(
    context: RequestContext,
    appointmentId: string,
    input: z.infer<typeof appointmentReceiptSchema>,
    rawIdempotencyKey?: string,
  ): Promise<AppointmentDetail> {
    this.assertPermission(
      context,
      'appointments.assumption.create',
      'APPOINTMENT_RECEIPT_FORBIDDEN',
    );
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'appointment-transition'),
      async (transaction) => {
        if (idempotencyKey) {
          const completed = await this.idempotentEvent(
            transaction,
            context,
            'APPOINTMENT_RECEIPT_RECORDED',
            idempotencyKey,
          );
          if (completed) return this.detailInTransaction(transaction, context, completed.entityId);
        }
        const record = await this.requireAppointment(transaction, context, appointmentId);
        const version = this.requireIssuedAppointment(record);
        if (version.acknowledgment || version.assumption) {
          throw new AppointmentServiceError(
            'The issued Appointment already has a recorded acknowledgment.',
            409,
            'APPOINTMENT_RECEIPT_ALREADY_RECORDED',
          );
        }
        const acknowledgedAt = new Date(input.acknowledgedAt);
        if (!version.issuedAt || acknowledgedAt.getTime() < version.issuedAt.getTime()) {
          throw new AppointmentServiceError(
            'The acknowledgment cannot precede issuance of the Appointment.',
            409,
            'APPOINTMENT_RECEIPT_DATE_INVALID',
          );
        }
        const evidence = await this.requireFinalizedEvidence(
          transaction,
          context,
          input.evidenceDocumentVersionId,
          'The acknowledgment evidence must be a finalized Document Version.',
          'APPOINTMENT_RECEIPT_EVIDENCE_INVALID',
        );
        await transaction.appointmentAcknowledgment.create({
          data: {
            agencyId: context.agencyId,
            appointmentVersionId: version.id,
            acknowledgedAt,
            evidenceDocumentVersionId: evidence.id,
          },
          select: { id: true },
        });
        const assumption = await transaction.assumptionToDuty.create({
          data: {
            agencyId: context.agencyId,
            appointmentVersionId: version.id,
            status: 'PENDING',
            createdByMembershipId: context.membershipId,
            updatedByMembershipId: context.membershipId,
          },
          select: { id: true },
        });
        await this.writeAudit(transaction, context, {
          action: 'APPOINTMENT_RECEIPT_RECORDED',
          entityId: appointmentId,
          previousStatus: 'ISSUED',
          newStatus: 'PENDING',
          reason:
            'The appointee acknowledged the issued Appointment and the pending Assumption to Duty opened.',
          metadata: {
            versionId: version.id,
            assumptionId: assumption.id,
            documentVersionId: evidence.id,
          },
          idempotencyKey,
        });
        return this.detailInTransaction(transaction, context, appointmentId);
      },
    );
  }

  async recordOath(
    context: RequestContext,
    appointmentId: string,
    input: z.infer<typeof appointmentOathSchema>,
    rawIdempotencyKey?: string,
  ): Promise<AppointmentDetail> {
    this.assertPermission(context, 'appointments.oath.record', 'APPOINTMENT_OATH_FORBIDDEN');
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'appointment-transition'),
      async (transaction) => {
        if (idempotencyKey) {
          const completed = await this.idempotentEvent(
            transaction,
            context,
            'APPOINTMENT_OATH_RECORDED',
            idempotencyKey,
          );
          if (completed) return this.detailInTransaction(transaction, context, completed.entityId);
        }
        const record = await this.requireAppointment(transaction, context, appointmentId);
        const version = this.requireIssuedAppointment(record);
        this.requirePendingAssumption(version);
        if (version.oath) {
          throw new AppointmentServiceError(
            'The Appointment already has a recorded oath of office.',
            409,
            'APPOINTMENT_OATH_ALREADY_RECORDED',
          );
        }
        const oathDate = this.resolveOathDate(input.oathDate, version);
        const evidence = await this.requireFinalizedEvidence(
          transaction,
          context,
          input.documentVersionId,
          'The oath evidence must be a finalized Document Version.',
          'APPOINTMENT_OATH_EVIDENCE_INVALID',
        );
        await this.requireActiveMembership(
          transaction,
          context,
          input.administeredByMembershipId,
          'APPOINTMENT_OATH_ADMINISTRATOR_INVALID',
          'The oath administrator is not an active Agency Membership.',
        );
        const oath = await transaction.oathOfOffice.create({
          data: {
            agencyId: context.agencyId,
            appointmentVersionId: version.id,
            createdByMembershipId: context.membershipId,
            updatedByMembershipId: context.membershipId,
          },
          select: { id: true },
        });
        const recorded = await transaction.oathVersion.create({
          data: {
            agencyId: context.agencyId,
            oathId: oath.id,
            versionNo: 1,
            oathDate,
            administeredByMembershipId: input.administeredByMembershipId,
            authority: input.authority,
            place: input.place ?? null,
            permittedVirtualMethod: input.permittedVirtualMethod ?? null,
            documentVersionId: evidence.id,
          },
          select: { id: true },
        });
        await transaction.oathOfOffice.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: oath.id } },
          data: {
            currentVersionId: recorded.id,
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'APPOINTMENT_OATH_RECORDED',
          entityId: appointmentId,
          previousStatus: 'PENDING',
          newStatus: 'PENDING',
          reason: 'The oath of office was recorded from its exact evidence.',
          metadata: {
            versionId: version.id,
            oathId: oath.id,
            oathVersionId: recorded.id,
            oathDate: input.oathDate,
            documentVersionId: evidence.id,
          },
          idempotencyKey,
        });
        return this.detailInTransaction(transaction, context, appointmentId);
      },
    );
  }

  async correctOath(
    context: RequestContext,
    appointmentId: string,
    input: z.infer<typeof appointmentOathCorrectionSchema>,
    rawIdempotencyKey?: string,
  ): Promise<AppointmentDetail> {
    this.assertPermission(context, 'appointments.oath.record', 'APPOINTMENT_OATH_FORBIDDEN');
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'appointment-transition'),
      async (transaction) => {
        if (idempotencyKey) {
          const completed = await this.idempotentEvent(
            transaction,
            context,
            'APPOINTMENT_OATH_CORRECTED',
            idempotencyKey,
          );
          if (completed) return this.detailInTransaction(transaction, context, completed.entityId);
        }
        const record = await this.requireAppointment(transaction, context, appointmentId);
        const version = this.requireIssuedAppointment(record);
        this.requirePendingAssumption(version);
        const oath = version.oath;
        const predecessor = oath?.currentVersion;
        if (!oath || !predecessor) {
          throw new AppointmentServiceError(
            'The Appointment has no recorded oath to correct.',
            409,
            'APPOINTMENT_OATH_NOT_RECORDED',
          );
        }
        const oathDate = this.resolveOathDate(input.oathDate, version);
        const authority = await this.requireFinalizedEvidence(
          transaction,
          context,
          input.authorityDocumentVersionId,
          'The oath correction authority must be a finalized Document Version.',
          'APPOINTMENT_OATH_CORRECTION_AUTHORITY_INVALID',
        );
        const evidence = await this.requireFinalizedEvidence(
          transaction,
          context,
          input.documentVersionId,
          'The oath evidence must be a finalized Document Version.',
          'APPOINTMENT_OATH_EVIDENCE_INVALID',
        );
        await this.requireActiveMembership(
          transaction,
          context,
          input.administeredByMembershipId,
          'APPOINTMENT_OATH_ADMINISTRATOR_INVALID',
          'The oath administrator is not an active Agency Membership.',
        );
        const recorded = await transaction.oathVersion.create({
          data: {
            agencyId: context.agencyId,
            oathId: oath.id,
            versionNo: predecessor.versionNo + 1,
            oathDate,
            administeredByMembershipId: input.administeredByMembershipId,
            authority: input.authority,
            place: input.place ?? null,
            permittedVirtualMethod: input.permittedVirtualMethod ?? null,
            documentVersionId: evidence.id,
            replacesOathVersionId: predecessor.id,
            correctionReason: input.reason,
            correctionAuthorityDocumentVersionId: authority.id,
          },
          select: { id: true },
        });
        await transaction.oathOfOffice.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: oath.id } },
          data: {
            currentVersionId: recorded.id,
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'APPOINTMENT_OATH_CORRECTED',
          entityId: appointmentId,
          previousStatus: 'PENDING',
          newStatus: 'PENDING',
          reason: input.reason,
          metadata: {
            versionId: version.id,
            oathId: oath.id,
            oathVersionId: recorded.id,
            predecessorOathVersionId: predecessor.id,
            oathDate: input.oathDate,
            documentVersionId: evidence.id,
          },
          idempotencyKey,
        });
        return this.detailInTransaction(transaction, context, appointmentId);
      },
    );
  }

  async recordAssumption(
    context: RequestContext,
    appointmentId: string,
    input: z.infer<typeof appointmentAssumptionSchema>,
    rawIdempotencyKey?: string,
  ): Promise<AppointmentDetail> {
    this.assertPermission(
      context,
      'appointments.assumption.certify',
      'APPOINTMENT_ASSUMPTION_FORBIDDEN',
    );
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'appointment-transition'),
      async (transaction) => {
        if (idempotencyKey) {
          const completed = await this.idempotentEvent(
            transaction,
            context,
            'APPOINTMENT_ASSUMPTION_RECORDED',
            idempotencyKey,
          );
          if (completed) return this.detailInTransaction(transaction, context, completed.entityId);
        }
        const record = await this.requireAppointment(transaction, context, appointmentId);
        const version = this.requireIssuedAppointment(record);
        const assumption = this.requirePendingAssumption(version);
        const oath = version.oath?.currentVersion;
        if (!oath) {
          throw new AppointmentServiceError(
            'Record the oath of office before the Assumption to Duty.',
            409,
            'APPOINTMENT_ASSUMPTION_OATH_REQUIRED',
          );
        }
        if (input.oathVersionId !== oath.id) {
          throw new AppointmentServiceError(
            'The Assumption to Duty must link the current oath version.',
            409,
            'APPOINTMENT_ASSUMPTION_OATH_MISMATCH',
          );
        }
        const prepared = await this.resolveAssumptionFacts(
          transaction,
          context,
          version,
          oath.oathDate,
          input,
        );
        const recorded = await transaction.assumptionVersion.create({
          data: {
            agencyId: context.agencyId,
            assumptionId: assumption.id,
            versionNo: 1,
            oathVersionId: oath.id,
            actualAssumptionDate: prepared.actualAssumptionDate,
            certifiedByMembershipId: input.certifiedByMembershipId,
            certifyingAuthority: input.certifyingAuthority,
            certifiedAt: prepared.certifiedAt,
            documentVersionId: prepared.evidenceDocumentVersionId,
          },
          select: { id: true },
        });
        await transaction.assumptionToDuty.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: assumption.id } },
          data: {
            status: 'ASSUMED',
            currentVersionId: recorded.id,
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'APPOINTMENT_ASSUMPTION_RECORDED',
          entityId: appointmentId,
          previousStatus: 'PENDING',
          newStatus: 'ASSUMED',
          reason: 'The actual Assumption to Duty was certified from its exact evidence.',
          metadata: {
            versionId: version.id,
            assumptionId: assumption.id,
            assumptionVersionId: recorded.id,
            oathVersionId: oath.id,
            actualAssumptionDate: input.actualAssumptionDate,
            documentVersionId: prepared.evidenceDocumentVersionId,
          },
          idempotencyKey,
        });
        return this.detailInTransaction(transaction, context, appointmentId);
      },
    );
  }

  async correctAssumption(
    context: RequestContext,
    appointmentId: string,
    input: z.infer<typeof appointmentAssumptionCorrectionSchema>,
    rawIdempotencyKey?: string,
  ): Promise<AppointmentDetail> {
    this.assertPermission(
      context,
      'appointments.assumption.correct',
      'APPOINTMENT_ASSUMPTION_FORBIDDEN',
    );
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'appointment-transition'),
      async (transaction) => {
        if (idempotencyKey) {
          const completed = await this.idempotentEvent(
            transaction,
            context,
            'APPOINTMENT_ASSUMPTION_CORRECTED',
            idempotencyKey,
          );
          if (completed) return this.detailInTransaction(transaction, context, completed.entityId);
        }
        const record = await this.requireAppointment(transaction, context, appointmentId);
        const version = this.requireIssuedAppointment(record);
        const assumption = version.assumption;
        const predecessor = assumption?.currentVersion;
        if (!assumption || assumption.status !== 'ASSUMED' || !predecessor) {
          throw new AppointmentServiceError(
            'Only an assumed Assumption to Duty can be corrected.',
            409,
            'APPOINTMENT_ASSUMPTION_NOT_ASSUMED',
          );
        }
        const oath = version.oath?.currentVersion;
        if (!oath || input.oathVersionId !== oath.id) {
          throw new AppointmentServiceError(
            'The Assumption to Duty must link the current oath version.',
            409,
            'APPOINTMENT_ASSUMPTION_OATH_MISMATCH',
          );
        }
        const activeService = await transaction.serviceSegment.findFirst({
          where: { agencyId: context.agencyId, appointmentId },
          select: { id: true },
        });
        if (activeService) {
          throw new AppointmentServiceError(
            'Active service already references this Appointment; correct the service through its owning contract.',
            409,
            'APPOINTMENT_ASSUMPTION_ACTIVATED',
          );
        }
        const prepared = await this.resolveAssumptionFacts(
          transaction,
          context,
          version,
          oath.oathDate,
          input,
          input.authorityDocumentVersionId,
        );
        const recorded = await transaction.assumptionVersion.create({
          data: {
            agencyId: context.agencyId,
            assumptionId: assumption.id,
            versionNo: predecessor.versionNo + 1,
            oathVersionId: oath.id,
            actualAssumptionDate: prepared.actualAssumptionDate,
            certifiedByMembershipId: input.certifiedByMembershipId,
            certifyingAuthority: input.certifyingAuthority,
            certifiedAt: prepared.certifiedAt,
            documentVersionId: prepared.evidenceDocumentVersionId,
            replacesAssumptionVersionId: predecessor.id,
            correctionReason: input.reason,
            correctionAuthorityDocumentVersionId: prepared.authorityDocumentVersionId,
          },
          select: { id: true },
        });
        await transaction.assumptionToDuty.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: assumption.id } },
          data: {
            currentVersionId: recorded.id,
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'APPOINTMENT_ASSUMPTION_CORRECTED',
          entityId: appointmentId,
          previousStatus: 'ASSUMED',
          newStatus: 'ASSUMED',
          reason: input.reason,
          metadata: {
            versionId: version.id,
            assumptionId: assumption.id,
            assumptionVersionId: recorded.id,
            predecessorAssumptionVersionId: predecessor.id,
            actualAssumptionDate: input.actualAssumptionDate,
            documentVersionId: prepared.evidenceDocumentVersionId,
          },
          idempotencyKey,
        });
        return this.detailInTransaction(transaction, context, appointmentId);
      },
    );
  }

  /**
   * The activation orchestrator: one transaction consumes the reserved
   * Plantilla Position, activates the Employee service through Personnel,
   * creates the Plantilla Position Incumbency, and closes the Recruitment
   * chain. Retrying with the same Idempotency-Key replays; a different key
   * after activation is a conflict.
   */
  async activateService(
    context: RequestContext,
    appointmentId: string,
    input: z.infer<typeof appointmentActivationSchema>,
    rawIdempotencyKey?: string,
  ): Promise<AppointmentDetail> {
    this.assertPermission(
      context,
      'personnel.employees.activate',
      'APPOINTMENT_SERVICE_ACTIVATE_FORBIDDEN',
    );
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    try {
      return await withDatabaseContext(
        requestDatabaseContext(
          context,
          'appointment-transition',
          'plantilla-position-transition',
          'recruitment-transition',
          'personnel-baseline-transition',
        ),
        async (transaction) => {
          const record = await this.requireAppointment(transaction, context, appointmentId);
          const completed = await transaction.auditEvent.findFirst({
            where: {
              agencyId: context.agencyId,
              action: 'APPOINTMENT_SERVICE_ACTIVATED',
              entityId: appointmentId,
            },
            select: { idempotencyKey: true },
          });
          if (completed) {
            if (
              idempotencyKey &&
              completed.idempotencyKey &&
              completed.idempotencyKey !== idempotencyKey
            ) {
              throw new AppointmentServiceError(
                'The Appointment service is already activated.',
                409,
                'APPOINTMENT_SERVICE_ALREADY_ACTIVATED',
              );
            }
            return this.detailInTransaction(transaction, context, appointmentId);
          }
          const version = this.requireIssuedAppointment(record);
          const assumption = version.assumption;
          if (!assumption || assumption.status !== 'ASSUMED' || !assumption.currentVersion) {
            throw new AppointmentServiceError(
              'Only an assumed Appointment Contract can activate service.',
              409,
              'APPOINTMENT_SERVICE_ASSUMPTION_REQUIRED',
            );
          }
          const contract = await this.resolveAssumedAppointmentContractInTransaction(
            transaction,
            context,
            version.id,
          );
          if (!contract) {
            throw new AppointmentServiceError(
              'The Assumed Appointment Contract is no longer valid.',
              409,
              'APPOINTMENT_SERVICE_ASSUMPTION_REQUIRED',
            );
          }
          const effectiveDate = formatDate(assumption.currentVersion.actualAssumptionDate);
          const reservation = await this.plantillaPositions.resolveReservedAssignmentInTransaction(
            transaction,
            context,
            record.positionId,
            effectiveDate,
          );
          if (!reservation) {
            throw new AppointmentServiceError(
              'The Plantilla Position is not reserved at the assumption date.',
              409,
              'APPOINTMENT_POSITION_NOT_RESERVED',
            );
          }
          if (reservation.salaryGrade !== version.salaryGrade) {
            throw new AppointmentServiceError(
              'The salary grade does not match the reserved Plantilla Position.',
              409,
              'APPOINTMENT_SALARY_GRADE_MISMATCH',
            );
          }
          const employeeSource = input.employeeId
            ? { employeeId: input.employeeId }
            : input.employee
              ? { employee: { ...input.employee, legalName: contract.fullName } }
              : {};
          const personnel = await this.employeesService.activateFromAssumptionInTransaction(
            transaction,
            context,
            {
              appointmentId,
              appointmentVersionId: version.id,
              ...employeeSource,
              organizationUnitId: reservation.organizationUnitId,
              positionId: record.positionId,
              appointmentStatus: contract.employmentStatus,
              salaryGrade: version.salaryGrade,
              salaryStep: version.salaryStep,
              effectiveFrom: effectiveDate,
            },
            idempotencyKey ? `${idempotencyKey}:personnel` : undefined,
          );
          const assignment = await this.plantillaPositions.completeReservedAssignmentInTransaction(
            transaction,
            context,
            record.positionId,
            {
              employeeId: personnel.employeeId,
              serviceSegmentId: personnel.serviceSegmentId,
              appointmentId,
              appointmentVersionId: version.id,
              effectiveDate,
              expectedOrganizationUnitId: reservation.organizationUnitId,
              expectedSalaryGrade: reservation.salaryGrade,
              reason: `The assumed Appointment activated service effective ${effectiveDate}.`,
            },
            idempotencyKey ? `${idempotencyKey}:plantilla` : undefined,
          );
          const closureReason = `The assumed Appointment activated service effective ${effectiveDate}.`;
          const handoff = record.recruitmentHandoffId
            ? await this.selectionService.resolveHandoffApplicationInTransaction(
                transaction,
                context,
                record.recruitmentHandoffId,
              )
            : null;
          const applicationClosure = handoff
            ? await this.applicationsService.closeAfterActivationInTransaction(
                transaction,
                context,
                {
                  applicationId: handoff.applicationId,
                  appointmentId,
                  serviceSegmentId: personnel.serviceSegmentId,
                  reason: closureReason,
                },
                idempotencyKey ? `${idempotencyKey}:application` : undefined,
              )
            : null;
          const publicationClosure = applicationClosure
            ? await this.recruitmentService.closePublicationAndRequestAfterActivationInTransaction(
                transaction,
                context,
                {
                  publicationId: applicationClosure.publicationId,
                  appointmentId,
                  serviceSegmentId: personnel.serviceSegmentId,
                  reason: closureReason,
                },
                idempotencyKey ? `${idempotencyKey}:recruitment` : undefined,
              )
            : null;
          await this.writeAudit(transaction, context, {
            action: 'APPOINTMENT_SERVICE_ACTIVATED',
            entityId: appointmentId,
            previousStatus: record.workflowStatus,
            newStatus: record.workflowStatus,
            reason: closureReason,
            metadata: {
              appointmentVersionId: version.id,
              employeeId: personnel.employeeId,
              employeeNumber: personnel.employeeNumber,
              serviceSegmentId: personnel.serviceSegmentId,
              positionId: record.positionId,
              positionVersionId: assignment.versionId,
              positionIncumbencyId: assignment.positionIncumbencyId,
              actualAssumptionDate: effectiveDate,
              handoffId: record.recruitmentHandoffId,
              applicationId: applicationClosure?.applicationId ?? null,
              publicationId: publicationClosure?.publicationId ?? null,
              requestId: publicationClosure?.requestToFillId ?? null,
            },
            idempotencyKey,
          });
          await transaction.outboxEvent.create({
            data: {
              agencyId: context.agencyId,
              eventType: 'APPOINTMENT_SERVICE_ACTIVATED',
              aggregateType: 'Appointment',
              aggregateId: appointmentId,
              idempotencyKey: idempotencyKey ?? `appointment-service:${appointmentId}`,
              payload: {
                appointmentId,
                appointmentVersionId: version.id,
                employeeId: personnel.employeeId,
                serviceSegmentId: personnel.serviceSegmentId,
                positionId: record.positionId,
                positionIncumbencyId: assignment.positionIncumbencyId,
                actualAssumptionDate: effectiveDate,
              },
            },
          });
          return this.detailInTransaction(transaction, context, appointmentId);
        },
      );
    } catch (error: unknown) {
      if (error instanceof AppointmentServiceError) throw error;
      if (
        error instanceof EmployeeServiceError ||
        error instanceof PlantillaPositionServiceError ||
        error instanceof RecruitmentServiceError
      ) {
        throw new AppointmentServiceError(error.message, error.statusCode, error.code);
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppointmentServiceError(
          'The Appointment service is already activated.',
          409,
          'APPOINTMENT_SERVICE_ALREADY_ACTIVATED',
        );
      }
      throw error;
    }
  }

  async recordAssumptionFailure(
    context: RequestContext,
    appointmentId: string,
    input: z.infer<typeof appointmentAssumptionFailureSchema>,
    rawIdempotencyKey?: string,
  ): Promise<AppointmentDetail> {
    this.assertPermission(
      context,
      'appointments.assumption.fail',
      'APPOINTMENT_ASSUMPTION_OUTCOME_FORBIDDEN',
    );
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'appointment-transition', 'plantilla-position-transition'),
      async (transaction) => {
        if (idempotencyKey) {
          const completed = await this.idempotentEvent(
            transaction,
            context,
            'APPOINTMENT_ASSUMPTION_FAILED',
            idempotencyKey,
          );
          if (completed) return this.detailInTransaction(transaction, context, completed.entityId);
        }
        return this.recordAssumptionOutcomeInTransaction(
          transaction,
          context,
          appointmentId,
          'DID_NOT_ASSUME',
          input,
          idempotencyKey,
        );
      },
    );
  }

  async recordAssumptionCancellation(
    context: RequestContext,
    appointmentId: string,
    input: z.infer<typeof appointmentAssumptionCancellationSchema>,
    rawIdempotencyKey?: string,
  ): Promise<AppointmentDetail> {
    this.assertPermission(
      context,
      'appointments.assumption.cancel',
      'APPOINTMENT_ASSUMPTION_OUTCOME_FORBIDDEN',
    );
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'appointment-transition', 'plantilla-position-transition'),
      async (transaction) => {
        if (idempotencyKey) {
          const completed = await this.idempotentEvent(
            transaction,
            context,
            'APPOINTMENT_ASSUMPTION_CANCELLED',
            idempotencyKey,
          );
          if (completed) return this.detailInTransaction(transaction, context, completed.entityId);
        }
        return this.recordAssumptionOutcomeInTransaction(
          transaction,
          context,
          appointmentId,
          'CANCELLED',
          input,
          idempotencyKey,
        );
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

  /**
   * Internal contract: Personnel and downstream owners read the frozen issued
   * Appointment facts through Appointment without touching its tables. The
   * contract never asserts a caller permission; the owning command already did.
   */
  async resolveIssuedAppointmentContractInTransaction(
    transaction: Prisma.TransactionClient,
    context: Pick<RequestContext, 'agencyId'>,
    appointmentVersionId: string,
  ): Promise<IssuedAppointmentContract | null> {
    const record = await transaction.appointmentVersion.findFirst({
      where: { agencyId: context.agencyId, id: appointmentVersionId, status: 'ISSUED' },
      select: contractVersionSelect,
    });
    if (!record) return null;
    return this.contractBase(transaction, context, record);
  }

  /**
   * Internal contract: the assumed-Appointment contract publishes only after a
   * valid Assumption to Duty and only while the version remains the Appointment's
   * current issued version. A corrected or cancelled Appointment leaves its old
   * version ISSUED, so callers must never consume it. Favorable CSC action is
   * never required, and the external standing is recorded as derived context,
   * not as a precondition.
   */
  async resolveAssumedAppointmentContractInTransaction(
    transaction: Prisma.TransactionClient,
    context: Pick<RequestContext, 'agencyId'>,
    appointmentVersionId: string,
  ): Promise<AssumedAppointmentContract | null> {
    const record = await transaction.appointmentVersion.findFirst({
      where: { agencyId: context.agencyId, id: appointmentVersionId, status: 'ISSUED' },
      select: contractVersionSelect,
    });
    if (
      !record ||
      record.appointment.workflowStatus !== 'ISSUED' ||
      record.appointment.currentVersionId !== record.id ||
      record.assumption?.status !== 'ASSUMED'
    ) {
      return null;
    }
    const base = await this.contractBase(transaction, context, record);
    const assumption = assumptionSummary(record.assumption);
    if (!base.acknowledgment || !base.oath || !assumption) {
      throw new AppointmentServiceError(
        'The stored Assumption to Duty is incomplete.',
        500,
        'APPOINTMENT_DATA_INVALID',
      );
    }
    return { ...base, acknowledgment: base.acknowledgment, oath: base.oath, assumption };
  }

  private async contractBase(
    transaction: Prisma.TransactionClient,
    context: Pick<RequestContext, 'agencyId'>,
    record: ContractVersionRecord,
  ): Promise<IssuedAppointmentContract> {
    if (!record.issuedAt) {
      throw new AppointmentServiceError(
        'The issued Appointment has no issue date.',
        500,
        'APPOINTMENT_DATA_INVALID',
      );
    }
    const view = selectionPackageView(record.appointment.recruitmentSelectionPackage);
    const reservation = await this.plantillaPositions.resolveReservationInTransaction(
      transaction,
      context,
      record.appointment.positionId,
    );
    const versions = await transaction.appointmentVersion.findMany({
      where: { agencyId: context.agencyId, appointmentId: record.appointmentId },
      select: { id: true },
    });
    const externalStanding = await this.standingForVersionsInTransaction(
      transaction,
      context.agencyId,
      versions.map((version) => version.id),
    );
    return {
      contractSchemaVersion: APPOINTMENT_CONTRACT_SCHEMA_VERSION,
      appointmentId: record.appointmentId,
      appointmentVersionId: record.id,
      personKey: record.appointment.appointeePersonKey,
      fullName: view.applicantName,
      applicationNo: view.applicationNo,
      employmentStatus: record.employmentStatus as AppointmentEmploymentStatus,
      natureOfAppointment: record.natureOfAppointment as AppointmentNature,
      formVariant: record.formVariant as AppointmentFormVariant,
      signatureMethod: record.signatureMethod as AppointmentSignatureMethod,
      issuedAt: formatDateTime(record.issuedAt),
      effectivityDate: formatDate(record.effectivityDate),
      position: view.position,
      reservation: reservation ? { id: reservation.id, status: reservation.status } : null,
      compensation: { salaryGrade: record.salaryGrade, salaryStep: record.salaryStep },
      externalStanding,
      acknowledgment: record.acknowledgment ? acknowledgmentSummary(record.acknowledgment) : null,
      oath: oathSummary(record.oath),
    };
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
      where: {
        agencyId: context.agencyId,
        entityType: 'Appointment',
        entityId: appointmentId,
        NOT: [
          { action: { startsWith: 'APPOINTMENT_EXTERNAL_' } },
          { action: { in: [...ASSUMPTION_LIFECYCLE_ACTIONS] } },
        ],
      },
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
    const [externalSubmissions, externalActions] = await Promise.all([
      transaction.appointmentExternalSubmissionEvent.findMany({
        where: { agencyId: context.agencyId, appointmentVersion: { appointmentId } },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        select: externalSubmissionSelect,
      }),
      transaction.appointmentExternalAction.findMany({
        where: { agencyId: context.agencyId, appointmentVersion: { appointmentId } },
        orderBy: [{ actionAt: 'asc' }, { id: 'asc' }],
        select: externalActionSelect,
      }),
    ]);
    const activation = await this.employeesService.resolveActivationForAppointmentInTransaction(
      transaction,
      context,
      appointmentId,
    );
    return this.detail(record, settings, history, externalSubmissions, externalActions, activation);
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
    externalSubmissions: ExternalSubmissionRecord[],
    externalActions: ExternalActionRecord[],
    activation: EmployeeActivationSummary | null,
  ): AppointmentDetail {
    const submissions = externalSubmissions.map(externalSubmissionSummary);
    const actions = externalActions.map(externalActionSummary);
    return {
      ...appointmentSummary(
        record,
        deriveAppointmentExternalStanding(
          submissions.map((submission) => ({
            eventType: submission.eventType,
            occurredAt: submission.occurredAt,
          })),
          actions.map((action) => ({
            action: action.action,
            actionAt: action.actionAt,
          })),
        ),
      ),
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
      externalSubmissions: submissions,
      externalActions: actions,
      activation,
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

  // External tracking advances independently of the Appointment workflow
  // status, so it needs at least one issued version rather than an issued
  // workflow: corrections and cancellations never reopen the frozen version.
  private requireIssuedExternalVersion(
    record: AppointmentDetailRecord,
    appointmentVersionId: string,
  ): AppointmentVersionDetailRecord {
    if (!record.versions.some((item) => item.status === 'ISSUED')) {
      throw new AppointmentServiceError(
        'External tracking is only available for an issued Appointment.',
        409,
        'APPOINTMENT_EXTERNAL_NOT_ISSUED',
      );
    }
    const version = record.versions.find((item) => item.id === appointmentVersionId);
    if (!version || version.status !== 'ISSUED') {
      throw new AppointmentServiceError(
        'External tracking must reference an issued Appointment Version.',
        409,
        'APPOINTMENT_EXTERNAL_VERSION_INVALID',
      );
    }
    return version;
  }

  private requireIssuedAppointment(
    record: AppointmentDetailRecord,
  ): AppointmentVersionDetailRecord {
    if (record.workflowStatus !== 'ISSUED') throw this.transitionNotAllowed(record);
    const version = record.currentVersionId
      ? record.versions.find((item) => item.id === record.currentVersionId)
      : undefined;
    if (!version || version.status !== 'ISSUED') throw this.versionNotFound();
    return version;
  }

  private requirePendingAssumption(version: AppointmentVersionDetailRecord): AssumptionRecord {
    const assumption = version.assumption;
    if (!version.acknowledgment || !assumption) {
      throw new AppointmentServiceError(
        'Record the appointee acknowledgment before the oath or Assumption to Duty.',
        409,
        'APPOINTMENT_ASSUMPTION_NOT_READY',
      );
    }
    if (assumption.status !== 'PENDING') {
      throw new AppointmentServiceError(
        `The Assumption to Duty is already ${assumption.status}.`,
        409,
        'APPOINTMENT_ASSUMPTION_NOT_PENDING',
      );
    }
    return assumption;
  }

  private resolveOathDate(value: string, version: AppointmentVersionDetailRecord): Date {
    const acknowledgedAt = version.acknowledgment?.acknowledgedAt;
    if (!acknowledgedAt) {
      throw new AppointmentServiceError(
        'Record the appointee acknowledgment before the oath.',
        409,
        'APPOINTMENT_ASSUMPTION_NOT_READY',
      );
    }
    const oathDate = toDatabaseDate(value);
    if (manilaDate(oathDate) < manilaDate(acknowledgedAt)) {
      throw new AppointmentServiceError(
        'The oath cannot precede the appointee acknowledgment.',
        409,
        'APPOINTMENT_OATH_DATE_INVALID',
      );
    }
    return oathDate;
  }

  private async resolveAssumptionFacts(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    version: AppointmentVersionDetailRecord,
    oathDate: Date,
    input: {
      actualAssumptionDate: string;
      certifiedByMembershipId: string;
      certifyingAuthority: string;
      certifiedAt: string;
      documentVersionId: string;
    },
    authorityDocumentVersionId?: string,
  ): Promise<{
    actualAssumptionDate: Date;
    certifiedAt: Date;
    evidenceDocumentVersionId: string;
    authorityDocumentVersionId: string | null;
  }> {
    if (!version.issuedAt) {
      throw new AppointmentServiceError(
        'The issued Appointment has no issue date.',
        500,
        'APPOINTMENT_DATA_INVALID',
      );
    }
    const actualAssumptionDate = toDatabaseDate(input.actualAssumptionDate);
    const certifiedAt = new Date(input.certifiedAt);
    if (manilaDate(actualAssumptionDate) < manilaDate(version.issuedAt)) {
      throw new AppointmentServiceError(
        'The actual assumption date cannot precede issuance of the Appointment.',
        409,
        'APPOINTMENT_ASSUMPTION_DATE_INVALID',
      );
    }
    if (manilaDate(actualAssumptionDate) < manilaDate(oathDate)) {
      throw new AppointmentServiceError(
        'The actual assumption date cannot precede the oath.',
        409,
        'APPOINTMENT_ASSUMPTION_DATE_INVALID',
      );
    }
    if (certifiedAt.getTime() < version.issuedAt.getTime()) {
      throw new AppointmentServiceError(
        'The certification time cannot precede issuance of the Appointment.',
        409,
        'APPOINTMENT_ASSUMPTION_CERTIFICATION_INVALID',
      );
    }
    await this.requireActiveMembership(
      transaction,
      context,
      input.certifiedByMembershipId,
      'APPOINTMENT_ASSUMPTION_CERTIFIER_INVALID',
      'The certifying officer is not an active Agency Membership.',
    );
    const evidence = await this.requireFinalizedEvidence(
      transaction,
      context,
      input.documentVersionId,
      'The assumption evidence must be a finalized Document Version.',
      'APPOINTMENT_ASSUMPTION_EVIDENCE_INVALID',
    );
    const authority = authorityDocumentVersionId
      ? await this.requireFinalizedEvidence(
          transaction,
          context,
          authorityDocumentVersionId,
          'The assumption correction authority must be a finalized Document Version.',
          'APPOINTMENT_ASSUMPTION_CORRECTION_AUTHORITY_INVALID',
        )
      : null;
    return {
      actualAssumptionDate,
      certifiedAt,
      evidenceDocumentVersionId: evidence.id,
      authorityDocumentVersionId: authority?.id ?? null,
    };
  }

  private async recordAssumptionOutcomeInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    appointmentId: string,
    outcome: AppointmentAssumptionOutcome,
    input: {
      noticeDate?: string | undefined;
      deadlineDate?: string | undefined;
      outcomeDate: string;
      reason: string;
      authorizedByMembershipId: string;
      authorityDocumentVersionId: string;
      evidenceDocumentVersionId: string;
    },
    idempotencyKey: string | undefined,
  ): Promise<AppointmentDetail> {
    const record = await this.requireAppointment(transaction, context, appointmentId);
    const version = this.requireIssuedAppointment(record);
    const assumption = this.requirePendingAssumption(version);
    if (outcome === 'CANCELLED') {
      this.assertPermission(context, 'appointments.records.cancel', 'APPOINTMENT_CANCEL_FORBIDDEN');
    }
    if (!version.issuedAt) {
      throw new AppointmentServiceError(
        'The issued Appointment has no issue date.',
        500,
        'APPOINTMENT_DATA_INVALID',
      );
    }
    await this.requireActiveMembership(
      transaction,
      context,
      input.authorizedByMembershipId,
      'APPOINTMENT_ASSUMPTION_OUTCOME_AUTHORIZER_INVALID',
      'The outcome authorizer is not an active Agency Membership.',
    );
    const authority = await this.requireFinalizedEvidence(
      transaction,
      context,
      input.authorityDocumentVersionId,
      'The outcome authority must be a finalized Document Version.',
      'APPOINTMENT_ASSUMPTION_OUTCOME_AUTHORITY_INVALID',
    );
    const evidence = await this.requireFinalizedEvidence(
      transaction,
      context,
      input.evidenceDocumentVersionId,
      'The outcome evidence must be a finalized Document Version.',
      'APPOINTMENT_ASSUMPTION_OUTCOME_EVIDENCE_INVALID',
    );
    const outcomeDate = toDatabaseDate(input.outcomeDate);
    if (manilaDate(outcomeDate) < manilaDate(version.issuedAt)) {
      throw new AppointmentServiceError(
        'The outcome date cannot precede issuance of the Appointment.',
        409,
        'APPOINTMENT_ASSUMPTION_OUTCOME_DATE_INVALID',
      );
    }
    await transaction.assumptionOutcomeEvent.create({
      data: {
        agencyId: context.agencyId,
        assumptionId: assumption.id,
        outcome,
        noticeDate: input.noticeDate ? toDatabaseDate(input.noticeDate) : null,
        deadlineDate: input.deadlineDate ? toDatabaseDate(input.deadlineDate) : null,
        outcomeDate,
        reason: input.reason,
        authorizedByMembershipId: input.authorizedByMembershipId,
        authorityDocumentVersionId: authority.id,
        evidenceDocumentVersionId: evidence.id,
      },
      select: { id: true },
    });
    const reservationReleased = await this.releaseReservationForAppointmentInTransaction(
      transaction,
      context,
      record,
      outcome === 'CANCELLED'
        ? `Appointment cancelled: ${input.reason}`
        : `Failure to assume: ${input.reason}`,
      idempotencyKey,
    );
    const outcomeMetadata = {
      versionId: version.id,
      assumptionId: assumption.id,
      outcome,
      outcomeDate: input.outcomeDate,
      ...(input.noticeDate ? { noticeDate: input.noticeDate } : {}),
      ...(input.deadlineDate ? { deadlineDate: input.deadlineDate } : {}),
      authorityDocumentVersionId: authority.id,
      documentVersionId: evidence.id,
      reservationReleased,
    };
    if (outcome === 'CANCELLED') {
      await this.cancelAppointmentRecordInTransaction(
        transaction,
        context,
        appointmentId,
        record.workflowStatus,
        input.reason,
        {
          positionId: record.positionId,
          versionId: version.id,
          assumptionId: assumption.id,
          reservationReleased,
          documentVersionId: authority.id,
        },
        idempotencyKey,
      );
    }
    await transaction.assumptionToDuty.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: assumption.id } },
      data: {
        status: outcome,
        updatedByMembershipId: context.membershipId,
        rowVersion: { increment: 1 },
      },
    });
    await this.writeAudit(transaction, context, {
      action:
        outcome === 'CANCELLED'
          ? 'APPOINTMENT_ASSUMPTION_CANCELLED'
          : 'APPOINTMENT_ASSUMPTION_FAILED',
      entityId: appointmentId,
      previousStatus: 'PENDING',
      newStatus: outcome,
      reason: input.reason,
      metadata: outcomeMetadata,
      idempotencyKey,
    });
    return this.detailInTransaction(transaction, context, appointmentId);
  }

  private async requireActiveMembership(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    membershipId: string,
    code: string,
    message: string,
  ): Promise<void> {
    const membership = await transaction.agencyMembership.findFirst({
      where: { agencyId: context.agencyId, id: membershipId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!membership) throw new AppointmentServiceError(message, 409, code);
  }

  private async requireFinalizedEvidence(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    documentVersionId: string,
    message: string,
    code: string,
  ): Promise<{ id: string }> {
    const evidence = await this.documentsService.resolveFinalizedVersionInTransaction(
      transaction,
      context,
      documentVersionId,
    );
    if (!evidence) throw new AppointmentServiceError(message, 409, code);
    return evidence;
  }

  private async standingInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    appointmentId: string,
  ): Promise<AppointmentExternalStanding> {
    const versions = await transaction.appointmentVersion.findMany({
      where: { agencyId: context.agencyId, appointmentId },
      select: { id: true },
    });
    return this.standingForVersionsInTransaction(
      transaction,
      context.agencyId,
      versions.map((version) => version.id),
    );
  }

  private async standingForVersionsInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    versionIds: readonly string[],
  ): Promise<AppointmentExternalStanding> {
    if (versionIds.length === 0) return 'NOT_SUBMITTED';
    const [submissions, actions] = await Promise.all([
      transaction.appointmentExternalSubmissionEvent.findMany({
        where: { agencyId, appointmentVersionId: { in: [...versionIds] } },
        select: { eventType: true, occurredAt: true },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      }),
      transaction.appointmentExternalAction.findMany({
        where: { agencyId, appointmentVersionId: { in: [...versionIds] } },
        select: { action: true, actionAt: true },
        orderBy: [{ actionAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return deriveAppointmentExternalStanding(
      submissions.map((submission) => ({
        eventType: submission.eventType,
        occurredAt: submission.occurredAt.toISOString(),
      })),
      actions.map((action) => ({
        action: action.action,
        actionAt: action.actionAt.toISOString(),
      })),
    );
  }

  private async externalStandingsInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    appointmentIds: readonly string[],
  ): Promise<Map<string, AppointmentExternalStanding>> {
    const standings = new Map<string, AppointmentExternalStanding>();
    if (appointmentIds.length === 0) return standings;
    const versions = await transaction.appointmentVersion.findMany({
      where: { agencyId: context.agencyId, appointmentId: { in: [...appointmentIds] } },
      select: { id: true, appointmentId: true },
    });
    const appointmentByVersion = new Map(
      versions.map((version) => [version.id, version.appointmentId]),
    );
    const versionIds = versions.map((version) => version.id);
    if (versionIds.length === 0) return standings;
    const [submissions, actions] = await Promise.all([
      transaction.appointmentExternalSubmissionEvent.findMany({
        where: { agencyId: context.agencyId, appointmentVersionId: { in: versionIds } },
        select: { appointmentVersionId: true, eventType: true, occurredAt: true },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      }),
      transaction.appointmentExternalAction.findMany({
        where: { agencyId: context.agencyId, appointmentVersionId: { in: versionIds } },
        select: { appointmentVersionId: true, action: true, actionAt: true },
        orderBy: [{ actionAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const byAppointment = new Map<
      string,
      {
        submissions: Array<{ eventType: string; occurredAt: string }>;
        actions: Array<{ action: string; actionAt: string }>;
      }
    >();
    const bucket = (appointmentId: string) => {
      const existing = byAppointment.get(appointmentId);
      if (existing) return existing;
      const created = { submissions: [], actions: [] };
      byAppointment.set(appointmentId, created);
      return created;
    };
    for (const submission of submissions) {
      const appointmentId = appointmentByVersion.get(submission.appointmentVersionId);
      if (!appointmentId) continue;
      bucket(appointmentId).submissions.push({
        eventType: submission.eventType,
        occurredAt: submission.occurredAt.toISOString(),
      });
    }
    for (const action of actions) {
      const appointmentId = appointmentByVersion.get(action.appointmentVersionId);
      if (!appointmentId) continue;
      bucket(appointmentId).actions.push({
        action: action.action,
        actionAt: action.actionAt.toISOString(),
      });
    }
    for (const appointmentId of appointmentIds) {
      const entry = byAppointment.get(appointmentId);
      standings.set(
        appointmentId,
        deriveAppointmentExternalStanding(entry?.submissions ?? [], entry?.actions ?? []),
      );
    }
    return standings;
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

  private async releaseReservationForAppointmentInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    appointment: { positionId: string },
    reason: string,
    idempotencyKey: string | undefined,
  ): Promise<boolean> {
    const reservation = await this.plantillaPositions.resolveReservationInTransaction(
      transaction,
      context,
      appointment.positionId,
    );
    if (reservation?.status !== 'RESERVED') return false;
    await this.plantillaPositions.releaseReservationInTransaction(
      transaction,
      context,
      appointment.positionId,
      manilaToday(),
      reason,
      idempotencyKey ? `${idempotencyKey}:position` : undefined,
    );
    return true;
  }

  private async cancelAppointmentRecordInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    appointmentId: string,
    previousStatus: string,
    reason: string,
    metadata: Prisma.InputJsonObject,
    idempotencyKey: string | undefined,
  ): Promise<void> {
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
      previousStatus,
      newStatus: 'CANCELLED',
      reason,
      metadata,
      idempotencyKey,
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
