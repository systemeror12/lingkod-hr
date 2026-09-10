import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import { RecruitmentServiceError } from './recruitment.service';
import {
  assessmentSelect,
  assessmentSummary,
  interviewSelect,
  interviewSummary,
  selectionPlanSummary,
  completedStageCodes,
  type AssessmentSummary,
  type InterviewSummary,
  type SelectionPlanSummary,
} from './evaluations.summary';
import { parseSelectionPlan, type SelectionPlan } from './selection-plan';
import {
  APPLICATION_SCREENING_RESULTS,
  APPLICATION_STATUSES,
  SCREENING_AREAS,
  type ScreeningArea,
  type ScreeningAreaResult,
  applicationCreateSchema,
  applicationListSchema,
  applicationScreeningCorrectionSchema,
  applicationScreeningSchema,
  applicationWithdrawalSchema,
  type applicationDocumentLinkSchema,
} from './applications.schemas';

type ApplicationListInput = Partial<typeof applicationListSchema._output>;
type ApplicationCreateInput = typeof applicationCreateSchema._output;
type ApplicationDocumentLinkInput = typeof applicationDocumentLinkSchema._output;
type ApplicationScreeningInput = typeof applicationScreeningSchema._output;
type ApplicationScreeningCorrectionInput = typeof applicationScreeningCorrectionSchema._output;
type ApplicationWithdrawalInput = typeof applicationWithdrawalSchema._output;

export interface ApplicantSummary {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  fullName: string;
  email: string | null;
  mobileNumber: string | null;
  privacyNoticeVersion: string;
  consentedAt: string;
  createdAt: string;
}

export interface ApplicationQualificationSummary {
  id: string;
  versionNo: number;
  code: string;
  name: string;
  effectiveFrom: string;
  educationRequirement: string | null;
  trainingHoursRequired: number | null;
  experienceMonthsRequired: number | null;
  eligibilityRequirement: string | null;
  licenseRequirements: Prisma.JsonValue;
  competencyRequirements: Prisma.JsonValue;
  specialRequirements: string | null;
  applicableAreas: ScreeningArea[];
}

export interface ApplicationDocumentSummary {
  id: string;
  documentId: string;
  documentNo: string | null;
  documentType: string;
  classification: string;
  documentVersionId: string;
  versionNo: number;
  purpose: string;
  note: string | null;
  linkedAt: string;
}

export interface ApplicationScreeningSummary {
  id: string;
  versionNo: number;
  result: (typeof APPLICATION_SCREENING_RESULTS)[number];
  reason: string;
  areaResults: Array<{
    area: ScreeningArea;
    result: ScreeningAreaResult;
    evidenceDocumentVersionIds: string[];
    note: string | null;
  }>;
  screenedByMembershipId: string;
  screenedAt: string;
  replacesScreeningId: string | null;
  correctionReason: string | null;
  correctionAuthorityDocumentVersionId: string | null;
}

export interface ApplicationSummary {
  id: string;
  applicationNo: string;
  publicationId: string;
  publicationNo: string;
  publicationStatus: string;
  openingDate: string;
  closingDate: string;
  requestToFillId: string;
  requestNo: string;
  position: {
    id: string;
    itemNumber: string;
    title: string;
    parentheticalTitle: string | null;
    salaryGrade: number;
    organizationUnitId: string;
    organizationUnitCode: string;
    organizationUnitName: string;
  };
  applicant: ApplicantSummary;
  qualificationStandard: ApplicationQualificationSummary;
  status: (typeof APPLICATION_STATUSES)[number];
  receivedAt: string;
  receivedByMembershipId: string;
  lateAcceptance: { reason: string; authorityDocumentVersionId: string } | null;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
  closedAt: string | null;
  closureReason: string | null;
  documents: ApplicationDocumentSummary[];
  screenings: ApplicationScreeningSummary[];
  latestScreening: ApplicationScreeningSummary | null;
  selectionPlan: SelectionPlanSummary | null;
  selectionPlanIssue: string | null;
  assessments: AssessmentSummary[];
  interviews: InterviewSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationPage {
  items: ApplicationSummary[];
  hasMore: boolean;
  nextOffset: number | null;
}

const SCREENING_MANAGED_STATUSES = [
  'RECEIVED',
  'INCOMPLETE',
  'QUALIFIED',
  'NOT_QUALIFIED',
] as const;

const WITHDRAWABLE_STATUSES = [
  ...SCREENING_MANAGED_STATUSES,
  'FOR_ASSESSMENT',
  'FOR_INTERVIEW',
] as const;

function isScreeningManaged(status: string): boolean {
  return SCREENING_MANAGED_STATUSES.includes(status as (typeof SCREENING_MANAGED_STATUSES)[number]);
}

function isWithdrawable(status: string): boolean {
  return WITHDRAWABLE_STATUSES.includes(status as (typeof WITHDRAWABLE_STATUSES)[number]);
}

export const applicationSelect = {
  id: true,
  agencyId: true,
  applicationNo: true,
  vacancyPublicationId: true,
  applicantId: true,
  qualificationStandardVersionId: true,
  status: true,
  receivedAt: true,
  receivedByMembershipId: true,
  lateAcceptanceReason: true,
  lateAcceptanceAuthorityDocumentVersionId: true,
  withdrawnAt: true,
  withdrawalReason: true,
  closedAt: true,
  closureReason: true,
  createdAt: true,
  updatedAt: true,
  applicant: {
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      suffix: true,
      emailNormalized: true,
      mobileNumber: true,
      privacyNoticeVersion: true,
      consentedAt: true,
      createdAt: true,
    },
  },
  qualificationStandard: {
    select: {
      id: true,
      versionNo: true,
      effectiveFrom: true,
      educationRequirement: true,
      trainingHoursRequired: true,
      experienceMonthsRequired: true,
      eligibilityRequirement: true,
      licenseRequirements: true,
      competencyRequirements: true,
      specialRequirements: true,
      qualificationStandard: { select: { code: true, name: true } },
    },
  },
  publication: {
    select: {
      id: true,
      publicationNo: true,
      status: true,
      openingDate: true,
      closingDate: true,
      qualificationStandardVersionId: true,
      requestToFillId: true,
      request: {
        select: {
          requestNo: true,
          criteriaSetId: true,
          criteriaSet: {
            select: {
              id: true,
              criteriaCode: true,
              planVersionId: true,
              criteriaDefinition: true,
            },
          },
          position: {
            select: {
              id: true,
              itemNumber: true,
              currentVersion: {
                select: {
                  positionTitle: true,
                  parentheticalTitle: true,
                  salaryGrade: true,
                  organizationUnitId: true,
                  organizationUnit: {
                    select: {
                      code: true,
                      currentVersion: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  documents: {
    orderBy: { linkedAt: 'asc' as const },
    select: {
      id: true,
      documentId: true,
      documentVersionId: true,
      purpose: true,
      note: true,
      linkedAt: true,
      document: { select: { documentNo: true, documentType: true, classification: true } },
      documentVersion: { select: { versionNo: true } },
    },
  },
  screenings: {
    orderBy: { versionNo: 'asc' as const },
    select: {
      id: true,
      versionNo: true,
      result: true,
      reason: true,
      areaResults: true,
      screenedByMembershipId: true,
      screenedAt: true,
      replacesScreeningId: true,
      correctionReason: true,
      correctionAuthorityDocumentVersionId: true,
      evidence: {
        select: {
          area: true,
          applicationDocumentId: true,
          applicationDocument: { select: { documentVersionId: true } },
        },
      },
    },
  },
  assessments: {
    orderBy: { createdAt: 'asc' as const },
    select: assessmentSelect,
  },
  interviews: {
    orderBy: { createdAt: 'asc' as const },
    select: interviewSelect,
  },
} as const;

export type ApplicationRecord = Prisma.ApplicationGetPayload<{ select: typeof applicationSelect }>;

function manilaToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date())
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, value]);
  const values = Object.fromEntries(parts) as Record<string, string>;
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatDateTime(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function applicationStatus(value: string): (typeof APPLICATION_STATUSES)[number] {
  if (APPLICATION_STATUSES.includes(value as (typeof APPLICATION_STATUSES)[number])) {
    return value as (typeof APPLICATION_STATUSES)[number];
  }
  throw new RecruitmentServiceError(
    'The stored Application status is invalid.',
    500,
    'RECRUITMENT_DATA_INVALID',
  );
}

function screeningResult(value: string): (typeof APPLICATION_SCREENING_RESULTS)[number] {
  if (
    APPLICATION_SCREENING_RESULTS.includes(value as (typeof APPLICATION_SCREENING_RESULTS)[number])
  ) {
    return value as (typeof APPLICATION_SCREENING_RESULTS)[number];
  }
  throw new RecruitmentServiceError(
    'The stored screening result is invalid.',
    500,
    'RECRUITMENT_DATA_INVALID',
  );
}

function jsonArrayHasItems(value: Prisma.JsonValue): boolean {
  return Array.isArray(value) && value.length > 0;
}

function jsonObject(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, Prisma.JsonValue>;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function storedAreaResults(
  value: Prisma.JsonValue,
): Array<{ area: ScreeningArea; result: ScreeningAreaResult; note: string | null }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const object = jsonObject(entry);
    if (!object) return [];
    const area = object.area;
    const result = object.result;
    if (
      typeof area !== 'string' ||
      !SCREENING_AREAS.includes(area as ScreeningArea) ||
      typeof result !== 'string'
    ) {
      return [];
    }
    return [
      {
        area: area as ScreeningArea,
        result: result as ScreeningAreaResult,
        note: typeof object.note === 'string' ? object.note : null,
      },
    ];
  });
}

function applicableScreeningAreas(
  record: ApplicationRecord['qualificationStandard'],
): ScreeningArea[] {
  const areas: ScreeningArea[] = [];
  if (record.educationRequirement?.trim()) areas.push('EDUCATION');
  if (record.trainingHoursRequired !== null) areas.push('TRAINING');
  if (record.experienceMonthsRequired !== null) areas.push('EXPERIENCE');
  if (record.eligibilityRequirement?.trim()) areas.push('ELIGIBILITY');
  if (jsonArrayHasItems(record.licenseRequirements)) areas.push('LICENSES');
  if (jsonArrayHasItems(record.competencyRequirements)) areas.push('COMPETENCIES');
  if (record.specialRequirements?.trim()) areas.push('SPECIAL_REQUIREMENTS');
  return areas;
}

function applicantSummary(record: ApplicationRecord): ApplicantSummary {
  const middle = record.applicant.middleName?.trim();
  const suffix = record.applicant.suffix?.trim();
  return {
    id: record.applicant.id,
    firstName: record.applicant.firstName,
    middleName: record.applicant.middleName,
    lastName: record.applicant.lastName,
    suffix: record.applicant.suffix,
    fullName: [record.applicant.firstName, middle, record.applicant.lastName, suffix]
      .filter(Boolean)
      .join(' '),
    email: record.applicant.emailNormalized,
    mobileNumber: record.applicant.mobileNumber,
    privacyNoticeVersion: record.applicant.privacyNoticeVersion,
    consentedAt: record.applicant.consentedAt.toISOString(),
    createdAt: record.applicant.createdAt.toISOString(),
  };
}

function qualificationSummary(record: ApplicationRecord): ApplicationQualificationSummary {
  return {
    id: record.qualificationStandard.id,
    versionNo: record.qualificationStandard.versionNo,
    code: record.qualificationStandard.qualificationStandard.code,
    name: record.qualificationStandard.qualificationStandard.name,
    effectiveFrom: formatDate(record.qualificationStandard.effectiveFrom),
    educationRequirement: record.qualificationStandard.educationRequirement,
    trainingHoursRequired:
      record.qualificationStandard.trainingHoursRequired === null
        ? null
        : Number(record.qualificationStandard.trainingHoursRequired),
    experienceMonthsRequired: record.qualificationStandard.experienceMonthsRequired,
    eligibilityRequirement: record.qualificationStandard.eligibilityRequirement,
    licenseRequirements: record.qualificationStandard.licenseRequirements,
    competencyRequirements: record.qualificationStandard.competencyRequirements,
    specialRequirements: record.qualificationStandard.specialRequirements,
    applicableAreas: applicableScreeningAreas(record.qualificationStandard),
  };
}

function screeningSummary(
  record: ApplicationRecord['screenings'][number],
): ApplicationScreeningSummary {
  const evidenceByArea = new Map<string, string[]>();
  for (const evidence of record.evidence) {
    const values = evidenceByArea.get(evidence.area) ?? [];
    values.push(evidence.applicationDocument.documentVersionId);
    evidenceByArea.set(evidence.area, values);
  }
  return {
    id: record.id,
    versionNo: record.versionNo,
    result: screeningResult(record.result),
    reason: record.reason,
    areaResults: storedAreaResults(record.areaResults).map((area) => ({
      ...area,
      evidenceDocumentVersionIds: evidenceByArea.get(area.area) ?? [],
    })),
    screenedByMembershipId: record.screenedByMembershipId,
    screenedAt: record.screenedAt.toISOString(),
    replacesScreeningId: record.replacesScreeningId,
    correctionReason: record.correctionReason,
    correctionAuthorityDocumentVersionId: record.correctionAuthorityDocumentVersionId,
  };
}

function resolveSelectionPlan(record: ApplicationRecord): {
  plan: SelectionPlan | null;
  summary: SelectionPlanSummary | null;
  issue: string | null;
} {
  const criteriaSet = record.publication.request.criteriaSet;
  if (!criteriaSet) {
    return {
      plan: null,
      summary: null,
      issue: 'The Recruitment Case has no bound Merit Selection Criteria Set.',
    };
  }
  const plan = parseSelectionPlan(criteriaSet.criteriaDefinition);
  if (!plan) {
    return {
      plan: null,
      summary: null,
      issue: 'The bound Merit Selection Criteria Set is not a supported configuration.',
    };
  }
  return {
    plan,
    summary: selectionPlanSummary(
      criteriaSet,
      plan,
      completedStageCodes(record.assessments, record.interviews),
    ),
    issue: null,
  };
}

export function applicationSummary(record: ApplicationRecord): ApplicationSummary {
  const version = record.publication.request.position.currentVersion;
  if (!version) {
    throw new RecruitmentServiceError(
      'The Application has no current Plantilla Position version.',
      409,
      'RECRUITMENT_POSITION_VERSION_MISSING',
    );
  }
  const screenings = record.screenings.map(screeningSummary);
  const selectionPlan = resolveSelectionPlan(record);
  return {
    id: record.id,
    applicationNo: `APP-${String(record.applicationNo).padStart(6, '0')}`,
    publicationId: record.publication.id,
    publicationNo: `PUB-${String(record.publication.publicationNo).padStart(6, '0')}`,
    publicationStatus: record.publication.status,
    openingDate: formatDate(record.publication.openingDate),
    closingDate: formatDate(record.publication.closingDate),
    requestToFillId: record.publication.requestToFillId,
    requestNo: `RTF-${String(record.publication.request.requestNo).padStart(6, '0')}`,
    position: {
      id: record.publication.request.position.id,
      itemNumber: record.publication.request.position.itemNumber,
      title: version.positionTitle,
      parentheticalTitle: version.parentheticalTitle,
      salaryGrade: version.salaryGrade,
      organizationUnitId: version.organizationUnitId,
      organizationUnitCode: version.organizationUnit.code,
      organizationUnitName:
        version.organizationUnit.currentVersion?.name ?? version.organizationUnit.code,
    },
    applicant: applicantSummary(record),
    qualificationStandard: qualificationSummary(record),
    status: applicationStatus(record.status),
    receivedAt: record.receivedAt.toISOString(),
    receivedByMembershipId: record.receivedByMembershipId,
    lateAcceptance:
      record.lateAcceptanceReason && record.lateAcceptanceAuthorityDocumentVersionId
        ? {
            reason: record.lateAcceptanceReason,
            authorityDocumentVersionId: record.lateAcceptanceAuthorityDocumentVersionId,
          }
        : null,
    withdrawnAt: formatDateTime(record.withdrawnAt),
    withdrawalReason: record.withdrawalReason,
    closedAt: formatDateTime(record.closedAt),
    closureReason: record.closureReason,
    documents: record.documents.map((document) => ({
      id: document.id,
      documentId: document.documentId,
      documentNo: document.document.documentNo,
      documentType: document.document.documentType,
      classification: document.document.classification,
      documentVersionId: document.documentVersionId,
      versionNo: document.documentVersion.versionNo,
      purpose: document.purpose,
      note: document.note,
      linkedAt: document.linkedAt.toISOString(),
    })),
    screenings,
    latestScreening: screenings.at(-1) ?? null,
    selectionPlan: selectionPlan.summary,
    selectionPlanIssue: selectionPlan.issue,
    assessments: record.assessments.map((assessment) =>
      assessmentSummary(assessment, selectionPlan.plan),
    ),
    interviews: record.interviews.map((interview) =>
      interviewSummary(interview, selectionPlan.plan),
    ),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function safeApplicationAuditMetadata(value: Prisma.InputJsonObject): Prisma.InputJsonObject {
  const allowed = new Set([
    'publicationId',
    'publicationNo',
    'requestToFillId',
    'applicationId',
    'applicationNo',
    'applicantId',
    'qualificationStandardVersionId',
    'documentVersionId',
    'purpose',
    'screeningId',
    'replacesScreeningId',
    'versionNo',
    'result',
    'deduplicated',
    'lateAcceptance',
  ]);
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => allowed.has(key)),
  ) as Prisma.InputJsonObject;
}

interface NormalizedAreaResult {
  area: ScreeningArea;
  result: ScreeningAreaResult;
  evidenceDocumentVersionIds: string[];
  note: string | null;
}

@Injectable()
export class ApplicationsService {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  async listApplications(
    context: RequestContext,
    filter: ApplicationListInput = {},
  ): Promise<ApplicationPage> {
    this.assertPermission(
      context,
      'recruitment.applications.read',
      'RECRUITMENT_APPLICATION_READ_FORBIDDEN',
    );
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;
    const records = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      transaction.application.findMany({
        where: {
          agencyId: context.agencyId,
          ...(filter.vacancyPublicationId
            ? { vacancyPublicationId: filter.vacancyPublicationId }
            : {}),
          ...(filter.applicantId ? { applicantId: filter.applicantId } : {}),
          ...(filter.status ? { status: filter.status } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit + 1,
        select: applicationSelect,
      }),
    );
    const hasMore = records.length > limit;
    return {
      items: records.slice(0, limit).map(applicationSummary),
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
    };
  }

  async findApplication(
    context: RequestContext,
    applicationId: string,
  ): Promise<ApplicationSummary | null> {
    this.assertPermission(
      context,
      'recruitment.applications.read',
      'RECRUITMENT_APPLICATION_READ_FORBIDDEN',
    );
    const record = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      transaction.application.findFirst({
        where: { agencyId: context.agencyId, id: applicationId },
        select: applicationSelect,
      }),
    );
    return record ? applicationSummary(record) : null;
  }

  async createApplication(
    context: RequestContext,
    input: ApplicationCreateInput,
    rawIdempotencyKey?: string,
  ): Promise<ApplicationSummary> {
    this.assertPermission(
      context,
      'recruitment.applications.create',
      'RECRUITMENT_APPLICATION_CREATE_FORBIDDEN',
    );
    return withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const previous = await this.idempotentEvent(
          transaction,
          context,
          'APPLICATION_RECEIVED',
          rawIdempotencyKey,
        );
        if (previous) {
          if (jsonObject(previous.metadata)?.publicationId !== input.vacancyPublicationId) {
            throw this.idempotencyConflict();
          }
          return applicationSummary(
            await this.requireApplication(transaction, context.agencyId, previous.entityId),
          );
        }
        const publication = await this.lockPublication(
          transaction,
          context.agencyId,
          input.vacancyPublicationId,
        );
        if (!publication) throw this.notFound('Vacancy Publication');
        if (publication.status !== 'PUBLISHED') {
          throw new RecruitmentServiceError(
            'Normal intake is accepted only while the Vacancy Publication is open.',
            409,
            'RECRUITMENT_PUBLICATION_NOT_OPEN',
          );
        }
        const today = manilaToday();
        const opening = formatDate(publication.openingDate);
        const closing = formatDate(publication.closingDate);
        if (today < opening) {
          throw new RecruitmentServiceError(
            'The Vacancy Publication has not opened for intake.',
            409,
            'RECRUITMENT_PUBLICATION_NOT_YET_OPEN',
          );
        }
        const open = today <= closing;
        if (!open) {
          if (
            input.lateAcceptanceReason === undefined ||
            input.lateAcceptanceAuthorityDocumentVersionId === undefined
          ) {
            throw new RecruitmentServiceError(
              'Intake beyond the publication period requires an explicit reason and finalized authority evidence.',
              409,
              'RECRUITMENT_LATE_ACCEPTANCE_EVIDENCE_REQUIRED',
            );
          }
          await this.requireFinalizedDocumentVersion(
            transaction,
            context,
            input.lateAcceptanceAuthorityDocumentVersionId,
            'RECRUITMENT_LATE_ACCEPTANCE_AUTHORITY_INVALID',
          );
        } else if (input.lateAcceptanceReason !== undefined) {
          throw new RecruitmentServiceError(
            'Authorized late handling cannot be recorded while the publication period is open.',
            409,
            'RECRUITMENT_LATE_ACCEPTANCE_NOT_ALLOWED',
          );
        }
        const { applicantId, createdApplicant } = await this.resolveApplicant(
          transaction,
          context,
          input,
        );
        let application: { id: string };
        try {
          application = await transaction.application.create({
            data: {
              agencyId: context.agencyId,
              vacancyPublicationId: publication.id,
              applicantId,
              qualificationStandardVersionId: publication.qualificationStandardVersionId,
              status: 'RECEIVED',
              receivedAt: new Date(),
              receivedByMembershipId: context.membershipId,
              ...(input.lateAcceptanceReason
                ? { lateAcceptanceReason: input.lateAcceptanceReason }
                : {}),
              ...(input.lateAcceptanceAuthorityDocumentVersionId
                ? {
                    lateAcceptanceAuthorityDocumentVersionId:
                      input.lateAcceptanceAuthorityDocumentVersionId,
                  }
                : {}),
              createdByMembershipId: context.membershipId,
              updatedByMembershipId: context.membershipId,
            },
            select: { id: true },
          });
        } catch (error) {
          if (this.isPrismaError(error, 'P2002')) {
            throw new RecruitmentServiceError(
              'This Applicant already has an Application for the Vacancy Publication.',
              409,
              'RECRUITMENT_APPLICATION_DUPLICATE',
            );
          }
          throw error;
        }
        if (createdApplicant) {
          await this.writeAudit(transaction, context, {
            action: 'APPLICANT_RECORDED',
            entityType: 'Applicant',
            entityId: applicantId,
            previousStatus: null,
            newStatus: null,
            reason: 'Applicant identity recorded with privacy notice consent.',
            metadata: safeApplicationAuditMetadata({
              applicantId,
              publicationId: publication.id,
            }),
            idempotencyKey: null,
          });
        }
        for (const document of input.documents) {
          await this.linkDocumentInTransaction(
            transaction,
            context,
            application.id,
            document,
            null,
          );
        }
        await this.writeAudit(transaction, context, {
          action: 'APPLICATION_RECEIVED',
          entityType: 'Application',
          entityId: application.id,
          previousStatus: null,
          newStatus: 'RECEIVED',
          reason: 'Application received for the open Vacancy Publication.',
          metadata: safeApplicationAuditMetadata({
            publicationId: publication.id,
            publicationNo: `PUB-${String(publication.publicationNo).padStart(6, '0')}`,
            requestToFillId: publication.requestToFillId,
            applicationId: application.id,
            applicantId,
            qualificationStandardVersionId: publication.qualificationStandardVersionId,
            deduplicated: createdApplicant === false,
            lateAcceptance: input.lateAcceptanceReason !== undefined,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
        return applicationSummary(
          await this.requireApplication(transaction, context.agencyId, application.id),
        );
      },
    );
  }

  async linkDocument(
    context: RequestContext,
    applicationId: string,
    input: ApplicationDocumentLinkInput,
    rawIdempotencyKey?: string,
  ): Promise<ApplicationSummary> {
    this.assertPermission(
      context,
      'recruitment.applications.update',
      'RECRUITMENT_APPLICATION_UPDATE_FORBIDDEN',
    );
    return withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const current = await this.lockApplication(transaction, context.agencyId, applicationId);
        if (!current) throw this.notFound('Application');
        const previous = await this.idempotentEvent(
          transaction,
          context,
          'APPLICATION_DOCUMENT_LINKED',
          rawIdempotencyKey,
          applicationId,
        );
        if (previous) {
          const metadata = previous.metadata ? jsonObject(previous.metadata) : null;
          if (
            metadata?.documentVersionId !== input.documentVersionId ||
            metadata?.purpose !== input.purpose
          ) {
            throw this.idempotencyConflict();
          }
          return applicationSummary(
            await this.requireApplication(transaction, context.agencyId, applicationId),
          );
        }
        if (!isScreeningManaged(current.status)) {
          throw this.workflowError('link evidence', current.status);
        }
        await this.linkDocumentInTransaction(
          transaction,
          context,
          applicationId,
          input,
          rawIdempotencyKey,
        );
        return applicationSummary(
          await this.requireApplication(transaction, context.agencyId, applicationId),
        );
      },
    );
  }

  async unlinkDocument(
    context: RequestContext,
    applicationId: string,
    applicationDocumentId: string,
    rawIdempotencyKey?: string,
  ): Promise<ApplicationSummary> {
    this.assertPermission(
      context,
      'recruitment.applications.update',
      'RECRUITMENT_APPLICATION_UPDATE_FORBIDDEN',
    );
    return withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const current = await this.lockApplication(transaction, context.agencyId, applicationId);
        if (!current) throw this.notFound('Application');
        if (current.status !== 'RECEIVED' && current.status !== 'INCOMPLETE') {
          throw this.workflowError('remove evidence', current.status);
        }
        const document = await transaction.applicationDocument.findFirst({
          where: { agencyId: context.agencyId, applicationId, id: applicationDocumentId },
          select: { id: true, documentVersionId: true, purpose: true },
        });
        if (!document) throw this.notFound('Application document');
        const used = await transaction.applicationScreeningEvidence.findFirst({
          where: { agencyId: context.agencyId, applicationDocumentId },
          select: { id: true },
        });
        if (used) {
          throw new RecruitmentServiceError(
            'A document already used as screening evidence cannot be removed.',
            409,
            'RECRUITMENT_APPLICATION_DOCUMENT_IN_USE',
          );
        }
        await transaction.applicationDocument.delete({
          where: { agencyId_id: { agencyId: context.agencyId, id: applicationDocumentId } },
        });
        await this.writeAudit(transaction, context, {
          action: 'APPLICATION_DOCUMENT_REMOVED',
          entityType: 'Application',
          entityId: applicationId,
          previousStatus: current.status,
          newStatus: current.status,
          reason: 'Linked application evidence was removed before screening completed.',
          metadata: safeApplicationAuditMetadata({
            applicationId,
            documentVersionId: document.documentVersionId,
            purpose: document.purpose,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
        return applicationSummary(
          await this.requireApplication(transaction, context.agencyId, applicationId),
        );
      },
    );
  }

  async screenApplication(
    context: RequestContext,
    applicationId: string,
    input: ApplicationScreeningInput,
    rawIdempotencyKey?: string,
  ): Promise<ApplicationSummary> {
    this.assertPermission(
      context,
      'recruitment.applications.screen',
      'RECRUITMENT_APPLICATION_SCREEN_FORBIDDEN',
    );
    this.assertScreeningOutcomePermission(context, input.result);
    return withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const current = await this.lockApplication(transaction, context.agencyId, applicationId);
        if (!current) throw this.notFound('Application');
        const previous = await this.idempotentEvent(
          transaction,
          context,
          'APPLICATION_SCREENING_RECORDED',
          rawIdempotencyKey,
          applicationId,
        );
        if (previous) {
          const metadata = previous.metadata ? jsonObject(previous.metadata) : null;
          if (metadata?.result !== input.result) throw this.idempotencyConflict();
          return applicationSummary(
            await this.requireApplication(transaction, context.agencyId, applicationId),
          );
        }
        if (!isScreeningManaged(current.status)) {
          throw this.workflowError('screen', current.status);
        }
        if (current.screenings.length > 0) {
          throw new RecruitmentServiceError(
            'Completed screening results are corrected through a linked replacement.',
            409,
            'RECRUITMENT_SCREENING_CORRECTION_REQUIRED',
          );
        }
        const normalized = this.validateScreeningAreaResults(
          current,
          input.result,
          input.areaResults,
        );
        const screening = await transaction.applicationScreening.create({
          data: {
            agencyId: context.agencyId,
            applicationId,
            qualificationStandardVersionId: current.qualificationStandardVersionId,
            versionNo: 1,
            result: input.result,
            reason: input.reason,
            areaResults: jsonInput(
              normalized.map(({ area, result, note }) => ({
                area,
                result,
                ...(note ? { note } : {}),
              })),
            ),
            screenedByMembershipId: context.membershipId,
          },
          select: { id: true },
        });
        await this.createScreeningEvidence(transaction, context, screening.id, normalized, current);
        await this.applyScreeningOutcome(transaction, context, current, input.result);
        await this.writeAudit(transaction, context, {
          action: 'APPLICATION_SCREENING_RECORDED',
          entityType: 'ApplicationScreening',
          entityId: screening.id,
          previousStatus: current.status,
          newStatus: input.result,
          reason: input.reason,
          metadata: safeApplicationAuditMetadata({
            applicationId,
            applicantId: current.applicantId,
            qualificationStandardVersionId: current.qualificationStandardVersionId,
            screeningId: screening.id,
            versionNo: 1,
            result: input.result,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
        return applicationSummary(
          await this.requireApplication(transaction, context.agencyId, applicationId),
        );
      },
    );
  }

  async correctScreening(
    context: RequestContext,
    applicationId: string,
    screeningId: string,
    input: ApplicationScreeningCorrectionInput,
    rawIdempotencyKey?: string,
  ): Promise<ApplicationSummary> {
    this.assertPermission(
      context,
      'recruitment.applications.screen',
      'RECRUITMENT_APPLICATION_SCREEN_FORBIDDEN',
    );
    this.assertScreeningOutcomePermission(context, input.result);
    return withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const current = await this.lockApplication(transaction, context.agencyId, applicationId);
        if (!current) throw this.notFound('Application');
        const previous = await this.idempotentEvent(
          transaction,
          context,
          'APPLICATION_SCREENING_CORRECTED',
          rawIdempotencyKey,
          applicationId,
        );
        if (previous) {
          const metadata = previous.metadata ? jsonObject(previous.metadata) : null;
          if (metadata?.result !== input.result || metadata?.replacesScreeningId !== screeningId) {
            throw this.idempotencyConflict();
          }
          return applicationSummary(
            await this.requireApplication(transaction, context.agencyId, applicationId),
          );
        }
        if (!isScreeningManaged(current.status)) {
          throw this.workflowError('correct screening', current.status);
        }
        const latest = current.screenings.at(-1);
        if (!latest || latest.id !== screeningId) {
          throw new RecruitmentServiceError(
            'Only the latest completed screening result can be corrected.',
            409,
            'RECRUITMENT_SCREENING_SOURCE_INVALID',
          );
        }
        if (input.correctionAuthorityDocumentVersionId) {
          await this.requireFinalizedDocumentVersion(
            transaction,
            context,
            input.correctionAuthorityDocumentVersionId,
            'RECRUITMENT_SCREENING_CORRECTION_AUTHORITY_INVALID',
          );
        }
        const normalized = this.validateScreeningAreaResults(
          current,
          input.result,
          input.areaResults,
        );
        const screening = await transaction.applicationScreening.create({
          data: {
            agencyId: context.agencyId,
            applicationId,
            qualificationStandardVersionId: current.qualificationStandardVersionId,
            versionNo: latest.versionNo + 1,
            result: input.result,
            reason: input.reason,
            areaResults: jsonInput(
              normalized.map(({ area, result, note }) => ({
                area,
                result,
                ...(note ? { note } : {}),
              })),
            ),
            screenedByMembershipId: context.membershipId,
            replacesScreeningId: latest.id,
            correctionReason: input.correctionReason,
            ...(input.correctionAuthorityDocumentVersionId
              ? {
                  correctionAuthorityDocumentVersionId: input.correctionAuthorityDocumentVersionId,
                }
              : {}),
          },
          select: { id: true },
        });
        await this.createScreeningEvidence(transaction, context, screening.id, normalized, current);
        await this.applyScreeningOutcome(transaction, context, current, input.result);
        await this.writeAudit(transaction, context, {
          action: 'APPLICATION_SCREENING_CORRECTED',
          entityType: 'ApplicationScreening',
          entityId: screening.id,
          previousStatus: current.status,
          newStatus: input.result,
          reason: input.correctionReason,
          metadata: safeApplicationAuditMetadata({
            applicationId,
            applicantId: current.applicantId,
            qualificationStandardVersionId: current.qualificationStandardVersionId,
            screeningId: screening.id,
            replacesScreeningId: latest.id,
            versionNo: latest.versionNo + 1,
            result: input.result,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
        return applicationSummary(
          await this.requireApplication(transaction, context.agencyId, applicationId),
        );
      },
    );
  }

  async reopenApplication(
    context: RequestContext,
    applicationId: string,
    reason: string,
    rawIdempotencyKey?: string,
  ): Promise<ApplicationSummary> {
    this.assertPermission(
      context,
      'recruitment.applications.update',
      'RECRUITMENT_APPLICATION_UPDATE_FORBIDDEN',
    );
    return withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const current = await this.lockApplication(transaction, context.agencyId, applicationId);
        if (!current) throw this.notFound('Application');
        if (current.status !== 'INCOMPLETE') throw this.workflowError('reopen', current.status);
        if (current.publication.status !== 'PUBLISHED') {
          throw new RecruitmentServiceError(
            'Missing documents can only be completed while the Vacancy Publication is open.',
            409,
            'RECRUITMENT_PUBLICATION_NOT_OPEN',
          );
        }
        const today = manilaToday();
        if (today > formatDate(current.publication.closingDate)) {
          throw new RecruitmentServiceError(
            'The allowed cutoff for completing the Application has passed.',
            409,
            'RECRUITMENT_APPLICATION_CUTOFF_PASSED',
          );
        }
        await transaction.application.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: applicationId } },
          data: {
            status: 'RECEIVED',
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'APPLICATION_REOPENED',
          entityType: 'Application',
          entityId: applicationId,
          previousStatus: 'INCOMPLETE',
          newStatus: 'RECEIVED',
          reason,
          metadata: safeApplicationAuditMetadata({
            applicationId,
            applicantId: current.applicantId,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
        return applicationSummary(
          await this.requireApplication(transaction, context.agencyId, applicationId),
        );
      },
    );
  }

  async withdrawApplication(
    context: RequestContext,
    applicationId: string,
    input: ApplicationWithdrawalInput,
    rawIdempotencyKey?: string,
  ): Promise<ApplicationSummary> {
    this.assertPermission(
      context,
      'recruitment.applications.withdraw',
      'RECRUITMENT_APPLICATION_WITHDRAW_FORBIDDEN',
    );
    return withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const current = await this.lockApplication(transaction, context.agencyId, applicationId);
        if (!current) throw this.notFound('Application');
        const previous = await this.idempotentEvent(
          transaction,
          context,
          'APPLICATION_WITHDRAWN',
          rawIdempotencyKey,
          applicationId,
        );
        if (previous) {
          return applicationSummary(
            await this.requireApplication(transaction, context.agencyId, applicationId),
          );
        }
        if (!isWithdrawable(current.status)) {
          throw this.workflowError('withdraw', current.status);
        }
        await this.linkDocumentInTransaction(
          transaction,
          context,
          applicationId,
          {
            documentVersionId: input.evidenceDocumentVersionId,
            purpose: 'OTHER',
            note: 'Withdrawal evidence',
          },
          null,
        );
        await transaction.application.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: applicationId } },
          data: {
            status: 'WITHDRAWN',
            withdrawnAt: new Date(),
            withdrawalReason: input.reason,
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'APPLICATION_WITHDRAWN',
          entityType: 'Application',
          entityId: applicationId,
          previousStatus: current.status,
          newStatus: 'WITHDRAWN',
          reason: input.reason,
          metadata: safeApplicationAuditMetadata({
            applicationId,
            applicantId: current.applicantId,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
        return applicationSummary(
          await this.requireApplication(transaction, context.agencyId, applicationId),
        );
      },
    );
  }

  async closeApplication(
    context: RequestContext,
    applicationId: string,
    reason: string,
    rawIdempotencyKey?: string,
  ): Promise<ApplicationSummary> {
    this.assertPermission(
      context,
      'recruitment.applications.close',
      'RECRUITMENT_APPLICATION_CLOSE_FORBIDDEN',
    );
    return withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const current = await this.lockApplication(transaction, context.agencyId, applicationId);
        if (!current) throw this.notFound('Application');
        const previous = await this.idempotentEvent(
          transaction,
          context,
          'APPLICATION_CLOSED',
          rawIdempotencyKey,
          applicationId,
        );
        if (previous) {
          return applicationSummary(
            await this.requireApplication(transaction, context.agencyId, applicationId),
          );
        }
        if (current.status !== 'NOT_QUALIFIED') {
          throw this.workflowError('close', current.status);
        }
        await transaction.application.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: applicationId } },
          data: {
            status: 'CLOSED',
            closedAt: new Date(),
            closureReason: reason,
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'APPLICATION_CLOSED',
          entityType: 'Application',
          entityId: applicationId,
          previousStatus: 'NOT_QUALIFIED',
          newStatus: 'CLOSED',
          reason,
          metadata: safeApplicationAuditMetadata({
            applicationId,
            applicantId: current.applicantId,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
        return applicationSummary(
          await this.requireApplication(transaction, context.agencyId, applicationId),
        );
      },
    );
  }

  private async resolveApplicant(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: ApplicationCreateInput,
  ): Promise<{ applicantId: string; createdApplicant: boolean }> {
    if (input.applicantId) {
      const applicant = await transaction.applicant.findFirst({
        where: { agencyId: context.agencyId, id: input.applicantId },
        select: { id: true },
      });
      if (!applicant) throw this.notFound('Applicant');
      return { applicantId: applicant.id, createdApplicant: false };
    }
    const applicant = input.applicant;
    if (!applicant) {
      throw new RecruitmentServiceError(
        'An Applicant identity is required.',
        400,
        'RECRUITMENT_APPLICANT_REQUIRED',
      );
    }
    const email = applicant.email?.trim().toLowerCase() ?? null;
    const mobile = applicant.mobileNumber?.replace(/[^0-9+]/g, '') ?? null;
    const deduplicationKey = this.deduplicationKey(applicant, email, mobile);
    const existing = await transaction.applicant.findFirst({
      where: { agencyId: context.agencyId, deduplicationKey },
      select: { id: true },
    });
    if (existing) return { applicantId: existing.id, createdApplicant: false };
    try {
      const created = await transaction.applicant.create({
        data: {
          agencyId: context.agencyId,
          firstName: applicant.firstName,
          middleName: applicant.middleName ?? null,
          lastName: applicant.lastName,
          suffix: applicant.suffix ?? null,
          emailNormalized: email,
          mobileNumber: mobile,
          privacyNoticeVersion: applicant.privacyNoticeVersion,
          consentedAt: new Date(applicant.consentedAt),
          deduplicationKey,
          createdByMembershipId: context.membershipId,
        },
        select: { id: true },
      });
      return { applicantId: created.id, createdApplicant: true };
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) {
        const raced = await transaction.applicant.findFirst({
          where: { agencyId: context.agencyId, deduplicationKey },
          select: { id: true },
        });
        if (raced) return { applicantId: raced.id, createdApplicant: false };
      }
      throw error;
    }
  }

  private deduplicationKey(
    applicant: NonNullable<ApplicationCreateInput['applicant']>,
    email: string | null,
    mobile: string | null,
  ): string {
    const contact = email ?? mobile;
    if (!contact) {
      return `applicant:${globalThis.crypto.randomUUID()}`;
    }
    const normalized = [
      applicant.lastName.trim().toLowerCase(),
      applicant.firstName.trim().toLowerCase(),
      applicant.middleName?.trim().toLowerCase() ?? '',
      applicant.suffix?.trim().toLowerCase() ?? '',
      contact,
    ].join('|');
    return `sha256:${createHash('sha256').update(normalized).digest('hex')}`;
  }

  private async linkDocumentInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    applicationId: string,
    input: ApplicationDocumentLinkInput,
    rawIdempotencyKey: string | null | undefined,
  ): Promise<void> {
    const version = await this.requireFinalizedDocumentVersion(
      transaction,
      context,
      input.documentVersionId,
      'RECRUITMENT_APPLICATION_EVIDENCE_INVALID',
    );
    try {
      await transaction.applicationDocument.create({
        data: {
          agencyId: context.agencyId,
          applicationId,
          documentId: version.documentId,
          documentVersionId: version.id,
          purpose: input.purpose,
          note: input.note ?? null,
          linkedByMembershipId: context.membershipId,
        },
        select: { id: true },
      });
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) {
        throw new RecruitmentServiceError(
          'This document version is already linked to the Application for that purpose.',
          409,
          'RECRUITMENT_APPLICATION_DOCUMENT_DUPLICATE',
        );
      }
      throw error;
    }
    await this.writeAudit(transaction, context, {
      action: 'APPLICATION_DOCUMENT_LINKED',
      entityType: 'Application',
      entityId: applicationId,
      previousStatus: null,
      newStatus: null,
      reason: 'Finalized Agency Document Version linked as Application evidence.',
      metadata: safeApplicationAuditMetadata({
        applicationId,
        documentVersionId: version.id,
        purpose: input.purpose,
      }),
      idempotencyKey: rawIdempotencyKey,
    });
  }

  private validateScreeningAreaResults(
    record: ApplicationRecord,
    requestedResult: (typeof APPLICATION_SCREENING_RESULTS)[number],
    input: ApplicationScreeningInput['areaResults'],
  ): NormalizedAreaResult[] {
    const applicable = applicableScreeningAreas(record.qualificationStandard);
    if (applicable.length === 0) {
      throw new RecruitmentServiceError(
        'The bound Qualification Standard Version states no requirements to screen against.',
        409,
        'RECRUITMENT_QUALIFICATION_STANDARD_EMPTY',
      );
    }
    const linkedVersions = new Map<string, string>();
    for (const document of record.documents) {
      linkedVersions.set(document.documentVersionId, document.id);
    }
    const byArea = new Map(input.map((area) => [area.area, area]));
    const normalized: NormalizedAreaResult[] = [];
    for (const area of SCREENING_AREAS) {
      const entry = byArea.get(area);
      if (!applicable.includes(area)) {
        if (entry && entry.result !== 'NOT_APPLICABLE') {
          throw new RecruitmentServiceError(
            `The ${area} requirement is not stated in the bound Qualification Standard Version.`,
            409,
            'RECRUITMENT_SCREENING_AREA_NOT_APPLICABLE',
          );
        }
        if (entry?.evidenceDocumentVersionIds.length) {
          throw new RecruitmentServiceError(
            'Evidence cannot be recorded for a non-applicable screening area.',
            409,
            'RECRUITMENT_SCREENING_AREA_NOT_APPLICABLE',
          );
        }
        normalized.push({
          area,
          result: 'NOT_APPLICABLE',
          evidenceDocumentVersionIds: [],
          note: null,
        });
        continue;
      }
      if (!entry) {
        throw new RecruitmentServiceError(
          `Every applicable screening area must be recorded. Missing: ${area}.`,
          409,
          'RECRUITMENT_SCREENING_AREA_MISSING',
        );
      }
      if (entry.result === 'NOT_APPLICABLE') {
        throw new RecruitmentServiceError(
          `The ${area} requirement is stated in the bound Qualification Standard Version and cannot be marked not applicable.`,
          409,
          'RECRUITMENT_SCREENING_AREA_REQUIRED',
        );
      }
      if (
        (entry.result === 'MEETS' || entry.result === 'DOES_NOT_MEET') &&
        entry.evidenceDocumentVersionIds.length === 0
      ) {
        throw new RecruitmentServiceError(
          `The ${area} result requires at least one linked evidence document.`,
          409,
          'RECRUITMENT_SCREENING_EVIDENCE_REQUIRED',
        );
      }
      if (entry.result === 'UNVERIFIED' && entry.evidenceDocumentVersionIds.length > 0) {
        throw new RecruitmentServiceError(
          `The ${area} result cannot cite evidence while marked unverified.`,
          409,
          'RECRUITMENT_SCREENING_EVIDENCE_UNVERIFIED',
        );
      }
      for (const documentVersionId of entry.evidenceDocumentVersionIds) {
        if (!linkedVersions.has(documentVersionId)) {
          throw new RecruitmentServiceError(
            'Screening evidence must be a document already linked to the Application.',
            409,
            'RECRUITMENT_SCREENING_EVIDENCE_UNLINKED',
          );
        }
      }
      normalized.push({
        area,
        result: entry.result,
        evidenceDocumentVersionIds: [...new Set(entry.evidenceDocumentVersionIds)],
        note: entry.note ?? null,
      });
    }
    const hasUnverified = applicable.some(
      (area) => normalized.find((entry) => entry.area === area)?.result === 'UNVERIFIED',
    );
    const hasFailure = applicable.some(
      (area) => normalized.find((entry) => entry.area === area)?.result === 'DOES_NOT_MEET',
    );
    const derived: (typeof APPLICATION_SCREENING_RESULTS)[number] = hasUnverified
      ? 'INCOMPLETE'
      : hasFailure
        ? 'NOT_QUALIFIED'
        : 'QUALIFIED';
    if (derived !== requestedResult) {
      throw new RecruitmentServiceError(
        `The recorded screening result must be ${derived} for the entered area results.`,
        409,
        'RECRUITMENT_SCREENING_RESULT_MISMATCH',
      );
    }
    return normalized;
  }

  private async createScreeningEvidence(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    screeningId: string,
    normalized: NormalizedAreaResult[],
    record: ApplicationRecord,
  ): Promise<void> {
    const linkedByVersion = new Map<string, string>();
    for (const document of record.documents) {
      linkedByVersion.set(document.documentVersionId, document.id);
    }
    const rows = normalized.flatMap((area) =>
      area.evidenceDocumentVersionIds.map((documentVersionId) => ({
        agencyId: context.agencyId,
        screeningId,
        applicationDocumentId: linkedByVersion.get(documentVersionId) as string,
        area: area.area,
      })),
    );
    if (rows.length) {
      await transaction.applicationScreeningEvidence.createMany({ data: rows });
    }
  }

  private async applyScreeningOutcome(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    record: ApplicationRecord,
    result: string,
  ): Promise<void> {
    await transaction.application.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: record.id } },
      data: {
        status: result,
        updatedByMembershipId: context.membershipId,
        rowVersion: { increment: 1 },
      },
    });
  }

  private assertScreeningOutcomePermission(
    context: RequestContext,
    result: (typeof APPLICATION_SCREENING_RESULTS)[number],
  ): void {
    if (result !== 'NOT_QUALIFIED') return;
    this.assertPermission(
      context,
      'recruitment.applications.disqualify',
      'RECRUITMENT_APPLICATION_DISQUALIFY_FORBIDDEN',
    );
  }

  private async requireApplication(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    applicationId: string,
  ): Promise<ApplicationRecord> {
    const record = await transaction.application.findUnique({
      where: { agencyId_id: { agencyId, id: applicationId } },
      select: applicationSelect,
    });
    if (!record) throw this.notFound('Application');
    return record;
  }

  private async lockApplication(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    applicationId: string,
  ): Promise<ApplicationRecord | null> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "applications" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${applicationId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) return null;
    return this.requireApplication(transaction, agencyId, applicationId);
  }

  private async lockPublication(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    publicationId: string,
  ) {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "vacancy_publications" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${publicationId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) return null;
    return transaction.vacancyPublication.findUnique({
      where: { agencyId_id: { agencyId, id: publicationId } },
      select: {
        id: true,
        agencyId: true,
        publicationNo: true,
        requestToFillId: true,
        qualificationStandardVersionId: true,
        openingDate: true,
        closingDate: true,
        status: true,
      },
    });
  }

  private async requireFinalizedDocumentVersion(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    documentVersionId: string,
    errorCode: string,
  ) {
    const version = await this.documents.resolveFinalizedVersionInTransaction(
      transaction,
      context,
      documentVersionId,
    );
    if (!version) {
      throw new RecruitmentServiceError(
        'A finalized Agency Document Version is required as evidence.',
        409,
        errorCode,
      );
    }
    return version;
  }

  private async idempotentEvent(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    action: string,
    idempotencyKey?: string,
    entityId?: string,
  ): Promise<{ entityId: string; metadata: Prisma.JsonValue } | null> {
    const key = idempotencyKey?.trim();
    if (!key) return null;
    return transaction.auditEvent.findFirst({
      where: {
        agencyId: context.agencyId,
        action,
        idempotencyKey: key,
        ...(entityId ? { entityId } : {}),
      },
      select: { entityId: true, metadata: true },
    });
  }

  private async writeAudit(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: {
      action: string;
      entityType: string;
      entityId: string;
      previousStatus: string | null;
      newStatus: string | null;
      reason: string;
      metadata: Prisma.InputJsonObject;
      idempotencyKey?: string | null | undefined;
    },
  ): Promise<void> {
    await transaction.auditEvent.create({
      data: {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        previousStatus: input.previousStatus,
        newStatus: input.newStatus,
        reason: input.reason,
        requestId: context.requestId,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        metadata: input.metadata,
      },
    });
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (
      !context.agencyId ||
      !context.userId ||
      !context.membershipId ||
      !hasPermission(context, permission, { agencyId: context.agencyId })
    )
      throw new RecruitmentServiceError(
        'The current Agency Membership lacks the required permission.',
        403,
        code,
      );
  }

  private notFound(entity: string): RecruitmentServiceError {
    return new RecruitmentServiceError(
      `The ${entity} could not be found.`,
      404,
      'RECRUITMENT_NOT_FOUND',
    );
  }

  private workflowError(action: string, status: string): RecruitmentServiceError {
    return new RecruitmentServiceError(
      `The Recruitment record cannot ${action} from ${status}.`,
      409,
      'RECRUITMENT_INVALID_TRANSITION',
    );
  }

  private idempotencyConflict(): RecruitmentServiceError {
    return new RecruitmentServiceError(
      'The Idempotency-Key was already used for a different Recruitment command.',
      409,
      'RECRUITMENT_IDEMPOTENCY_CONFLICT',
    );
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
  }
}
