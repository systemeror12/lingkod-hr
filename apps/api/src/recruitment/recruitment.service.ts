import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { setDatabaseContext, withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import {
  ApprovalCompletionRegistry,
  type ApprovalCompletionRequest,
  ApprovalsService,
} from '../approvals/approval.service';
import {
  PlantillaPositionsService,
  type RecruitableVacancyResolution,
} from '../plantilla-positions/plantilla-positions.service';
import {
  recruitmentDateSchema,
  requestToFillCreateSchema,
  requestToFillRebaselineSchema,
  vacancyPublicationCreateSchema,
  vacancyPublicationCorrectionSchema,
  vacancyPublicationRepublishSchema,
  vacancyPublicationCloseSchema,
  vacancyPublicationCancelSchema,
  type requestToFillListSchema,
  type vacancyPublicationListSchema,
} from './recruitment.schemas';
import { manilaDayEnd, manilaDayStart } from './posting-period';

export const REQUEST_TO_FILL_ROUTE_CODE = 'RECRUITMENT_REQUEST_REVIEW';
export const VACANCY_PUBLICATION_ROUTE_CODE = 'RECRUITMENT_VACANCY_PUBLICATION';

export const REQUEST_TO_FILL_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'FOR_REVIEW',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'CLOSED',
] as const;
export const VACANCY_PUBLICATION_STATUSES = [
  'DRAFT',
  'FOR_APPROVAL',
  'PUBLISHED',
  'CLOSED',
  'CANCELLED',
  'REPUBLISHED',
] as const;

export type RequestToFillStatus = (typeof REQUEST_TO_FILL_STATUSES)[number];
export type VacancyPublicationStatus = (typeof VACANCY_PUBLICATION_STATUSES)[number];

type RequestListInput = Partial<typeof requestToFillListSchema._output>;
type PublicationListInput = Partial<typeof vacancyPublicationListSchema._output>;
type RequestCreateInput = typeof requestToFillCreateSchema._output;
type RequestRebaselineInput = typeof requestToFillRebaselineSchema._output;
type PublicationCreateInput = typeof vacancyPublicationCreateSchema._output;
type PublicationCorrectionInput = typeof vacancyPublicationCorrectionSchema._output;
type PublicationRepublishInput = typeof vacancyPublicationRepublishSchema._output;
type PublicationCloseInput = typeof vacancyPublicationCloseSchema._output;
type PublicationCancelInput = typeof vacancyPublicationCancelSchema._output;

export interface RequestToFillSummary {
  id: string;
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
  requestingUnit: { id: string; code: string; name: string };
  justification: string;
  qualificationStandard: { id: string; versionNo: number; code: string; name: string };
  governingConfiguration: {
    mspPlanVersionId: string | null;
    criteriaSetId: string | null;
    boardDefinitionId: string | null;
    bindingSetNo: number;
    resolvedAt: string | null;
    frozenAt: string | null;
  };
  approvalRequestId: string | null;
  routeBindings: Array<{
    bindingSetNo: number;
    checkpointCode: string;
    routeVersionId: string;
    routeCode: string;
    routeVersionNo: number;
  }>;
  rebaselines: Array<{
    id: string;
    fromMspPlanVersionId: string | null;
    fromCriteriaSetId: string | null;
    fromBoardDefinitionId: string | null;
    toMspPlanVersionId: string | null;
    toCriteriaSetId: string | null;
    toBoardDefinitionId: string | null;
    reason: string;
    authorityDocumentVersionId: string | null;
    authorizedByMembershipId: string;
    createdAt: string;
  }>;
  status: RequestToFillStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VacancyPublicationSummary {
  id: string;
  publicationNo: string;
  requestToFillId: string;
  requestNo: string;
  position: RequestToFillSummary['position'];
  qualificationStandard: { id: string; versionNo: number; code: string; name: string };
  formDocumentVersionId: string;
  approvalRouteVersionId: string;
  approvalRequestId: string | null;
  openingDate: string;
  closingDate: string;
  channels: Prisma.JsonValue;
  positionDetails: Prisma.JsonValue;
  applicationRequirements: Prisma.JsonValue;
  contactDetails: Prisma.JsonValue;
  hrmoCertification: Prisma.JsonValue | null;
  certifiedByMembershipId: string | null;
  certifiedAt: string | null;
  publishedAt: string | null;
  republicationOfId: string | null;
  republicationReason: string | null;
  republicationAuthorityDocumentVersionId: string | null;
  status: VacancyPublicationStatus;
  closedAt: string | null;
  closureReason: string | null;
  closureAuthorityDocumentVersionId: string | null;
  cancellationReason: string | null;
  cancellationAuthorityDocumentVersionId: string | null;
  evidence: Array<{
    id: string;
    channelType: string;
    location: string;
    reference: string | null;
    publishedAt: string;
    removedAt: string | null;
    evidenceDocumentVersionId: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface RecruitmentPage<T> {
  items: T[];
  hasMore: boolean;
  nextOffset: number | null;
}

export interface ActivationPublicationClosure {
  publicationId: string;
  requestToFillId: string;
}

export class RecruitmentServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'RecruitmentServiceError';
  }
}

const requestSelect = {
  id: true,
  agencyId: true,
  requestNo: true,
  positionId: true,
  requestingUnitId: true,
  requestedByMembershipId: true,
  justification: true,
  qualificationStandardVersionId: true,
  mspPlanVersionId: true,
  criteriaSetId: true,
  boardDefinitionId: true,
  bindingSetNo: true,
  bindingsResolvedAt: true,
  bindingFrozenAt: true,
  approvalRequestId: true,
  status: true,
  submittedAt: true,
  approvedAt: true,
  closedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
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
              id: true,
              code: true,
              currentVersion: { select: { name: true } },
            },
          },
        },
      },
    },
  },
  requestingUnit: {
    select: {
      id: true,
      code: true,
      currentVersion: { select: { name: true } },
    },
  },
  qualificationStandard: {
    select: {
      id: true,
      versionNo: true,
      qualificationStandard: { select: { code: true, name: true } },
    },
  },
  routeBindings: {
    orderBy: [
      { bindingSetNo: 'asc' },
      { checkpointCode: 'asc' },
    ] as Prisma.RequestApprovalRouteBindingOrderByWithRelationInput[],
    select: {
      bindingSetNo: true,
      checkpointCode: true,
      approvalRouteVersionId: true,
      routeVersion: { select: { routeCode: true, versionNo: true } },
    },
  },
  rebaselines: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      fromMspPlanVersionId: true,
      fromCriteriaSetId: true,
      fromBoardDefinitionId: true,
      toMspPlanVersionId: true,
      toCriteriaSetId: true,
      toBoardDefinitionId: true,
      reason: true,
      authorityDocumentVersionId: true,
      authorizedByMembershipId: true,
      createdAt: true,
    },
  },
} as const;

const publicationSelect = {
  id: true,
  agencyId: true,
  publicationNo: true,
  requestToFillId: true,
  qualificationStandardVersionId: true,
  formDocumentVersionId: true,
  approvalRouteVersionId: true,
  approvalRequestId: true,
  openingDate: true,
  closingDate: true,
  channels: true,
  positionDetails: true,
  applicationRequirements: true,
  contactDetails: true,
  hrmoCertification: true,
  certifiedByMembershipId: true,
  certifiedAt: true,
  publishedAt: true,
  republicationOfId: true,
  republicationReason: true,
  republicationAuthorityDocumentVersionId: true,
  status: true,
  closedAt: true,
  closureReason: true,
  closureAuthorityDocumentVersionId: true,
  cancellationReason: true,
  cancellationAuthorityDocumentVersionId: true,
  createdAt: true,
  updatedAt: true,
  request: {
    select: {
      id: true,
      requestNo: true,
      status: true,
      bindingSetNo: true,
      bindingFrozenAt: true,
      qualificationStandardVersionId: true,
      mspPlanVersionId: true,
      criteriaSetId: true,
      boardDefinitionId: true,
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
                  id: true,
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
  qualificationStandard: {
    select: {
      id: true,
      versionNo: true,
      qualificationStandard: { select: { code: true, name: true } },
    },
  },
  evidence: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      channelType: true,
      location: true,
      reference: true,
      publishedAt: true,
      removedAt: true,
      evidenceDocumentVersionId: true,
    },
  },
} as const;

type RequestRecord = Prisma.RequestToFillGetPayload<{ select: typeof requestSelect }>;
type PublicationRecord = Prisma.VacancyPublicationGetPayload<{ select: typeof publicationSelect }>;

function date(value: string): Date {
  const parsed = recruitmentDateSchema.safeParse(value);
  if (!parsed.success) {
    throw new RecruitmentServiceError(
      'Enter a valid calendar date.',
      400,
      'RECRUITMENT_DATE_INVALID',
    );
  }
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatDateTime(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

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

function requestStatus(value: string): RequestToFillStatus {
  if (REQUEST_TO_FILL_STATUSES.includes(value as RequestToFillStatus)) {
    return value as RequestToFillStatus;
  }
  throw new RecruitmentServiceError(
    'The stored Request to Fill status is invalid.',
    500,
    'RECRUITMENT_DATA_INVALID',
  );
}

function publicationStatus(value: string): VacancyPublicationStatus {
  if (VACANCY_PUBLICATION_STATUSES.includes(value as VacancyPublicationStatus)) {
    return value as VacancyPublicationStatus;
  }
  throw new RecruitmentServiceError(
    'The stored Vacancy Publication status is invalid.',
    500,
    'RECRUITMENT_DATA_INVALID',
  );
}

function jsonObject(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, Prisma.JsonValue>;
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function dateDifferenceInDays(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function requestSummary(record: RequestRecord): RequestToFillSummary {
  const version = record.position.currentVersion;
  if (!version) {
    throw new RecruitmentServiceError(
      'The Request to Fill has no current Plantilla Position version.',
      409,
      'RECRUITMENT_POSITION_VERSION_MISSING',
    );
  }
  return {
    id: record.id,
    requestNo: `RTF-${String(record.requestNo).padStart(6, '0')}`,
    position: {
      id: record.position.id,
      itemNumber: record.position.itemNumber,
      title: version.positionTitle,
      parentheticalTitle: version.parentheticalTitle,
      salaryGrade: version.salaryGrade,
      organizationUnitId: version.organizationUnitId,
      organizationUnitCode: version.organizationUnit.code,
      organizationUnitName:
        version.organizationUnit.currentVersion?.name ?? version.organizationUnit.code,
    },
    requestingUnit: {
      id: record.requestingUnit.id,
      code: record.requestingUnit.code,
      name: record.requestingUnit.currentVersion?.name ?? record.requestingUnit.code,
    },
    justification: record.justification,
    qualificationStandard: {
      id: record.qualificationStandard.id,
      versionNo: record.qualificationStandard.versionNo,
      code: record.qualificationStandard.qualificationStandard.code,
      name: record.qualificationStandard.qualificationStandard.name,
    },
    governingConfiguration: {
      mspPlanVersionId: record.mspPlanVersionId,
      criteriaSetId: record.criteriaSetId,
      boardDefinitionId: record.boardDefinitionId,
      bindingSetNo: record.bindingSetNo,
      resolvedAt: formatDateTime(record.bindingsResolvedAt),
      frozenAt: formatDateTime(record.bindingFrozenAt),
    },
    approvalRequestId: record.approvalRequestId,
    routeBindings: record.routeBindings.map((binding) => ({
      bindingSetNo: binding.bindingSetNo,
      checkpointCode: binding.checkpointCode,
      routeVersionId: binding.approvalRouteVersionId,
      routeCode: binding.routeVersion.routeCode,
      routeVersionNo: binding.routeVersion.versionNo,
    })),
    rebaselines: record.rebaselines.map((rebaseline) => ({
      id: rebaseline.id,
      fromMspPlanVersionId: rebaseline.fromMspPlanVersionId,
      fromCriteriaSetId: rebaseline.fromCriteriaSetId,
      fromBoardDefinitionId: rebaseline.fromBoardDefinitionId,
      toMspPlanVersionId: rebaseline.toMspPlanVersionId,
      toCriteriaSetId: rebaseline.toCriteriaSetId,
      toBoardDefinitionId: rebaseline.toBoardDefinitionId,
      reason: rebaseline.reason,
      authorityDocumentVersionId: rebaseline.authorityDocumentVersionId,
      authorizedByMembershipId: rebaseline.authorizedByMembershipId,
      createdAt: rebaseline.createdAt.toISOString(),
    })),
    status: requestStatus(record.status),
    submittedAt: formatDateTime(record.submittedAt),
    approvedAt: formatDateTime(record.approvedAt),
    closedAt: formatDateTime(record.closedAt),
    cancelledAt: formatDateTime(record.cancelledAt),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function publicationPosition(record: PublicationRecord): RequestToFillSummary['position'] {
  const version = record.request.position.currentVersion;
  if (!version) {
    throw new RecruitmentServiceError(
      'The Vacancy Publication has no current Plantilla Position version.',
      409,
      'RECRUITMENT_POSITION_VERSION_MISSING',
    );
  }
  return {
    id: record.request.position.id,
    itemNumber: record.request.position.itemNumber,
    title: version.positionTitle,
    parentheticalTitle: version.parentheticalTitle,
    salaryGrade: version.salaryGrade,
    organizationUnitId: version.organizationUnitId,
    organizationUnitCode: version.organizationUnit.code,
    organizationUnitName:
      version.organizationUnit.currentVersion?.name ?? version.organizationUnit.code,
  };
}

function publicationSummary(record: PublicationRecord): VacancyPublicationSummary {
  return {
    id: record.id,
    publicationNo: `PUB-${String(record.publicationNo).padStart(6, '0')}`,
    requestToFillId: record.requestToFillId,
    requestNo: `RTF-${String(record.request.requestNo).padStart(6, '0')}`,
    position: publicationPosition(record),
    qualificationStandard: {
      id: record.qualificationStandard.id,
      versionNo: record.qualificationStandard.versionNo,
      code: record.qualificationStandard.qualificationStandard.code,
      name: record.qualificationStandard.qualificationStandard.name,
    },
    formDocumentVersionId: record.formDocumentVersionId,
    approvalRouteVersionId: record.approvalRouteVersionId,
    approvalRequestId: record.approvalRequestId,
    openingDate: formatDate(record.openingDate),
    closingDate: formatDate(record.closingDate),
    channels: record.channels,
    positionDetails: record.positionDetails,
    applicationRequirements: record.applicationRequirements,
    contactDetails: record.contactDetails,
    hrmoCertification: record.hrmoCertification,
    certifiedByMembershipId: record.certifiedByMembershipId,
    certifiedAt: formatDateTime(record.certifiedAt),
    publishedAt: formatDateTime(record.publishedAt),
    republicationOfId: record.republicationOfId,
    republicationReason: record.republicationReason,
    republicationAuthorityDocumentVersionId: record.republicationAuthorityDocumentVersionId,
    status: publicationStatus(record.status),
    closedAt: formatDateTime(record.closedAt),
    closureReason: record.closureReason,
    closureAuthorityDocumentVersionId: record.closureAuthorityDocumentVersionId,
    cancellationReason: record.cancellationReason,
    cancellationAuthorityDocumentVersionId: record.cancellationAuthorityDocumentVersionId,
    evidence: record.evidence.map((evidence) => ({
      id: evidence.id,
      channelType: evidence.channelType,
      location: evidence.location,
      reference: evidence.reference,
      publishedAt: evidence.publishedAt.toISOString(),
      removedAt: evidence.removedAt?.toISOString() ?? null,
      evidenceDocumentVersionId: evidence.evidenceDocumentVersionId,
    })),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function safeAuditMetadata(value: Prisma.InputJsonObject): Prisma.InputJsonObject {
  const allowed = new Set([
    'requestNo',
    'requestToFillId',
    'publicationNo',
    'positionId',
    'positionVersionId',
    'qualificationStandardVersionId',
    'mspPlanVersionId',
    'criteriaSetId',
    'boardDefinitionId',
    'fromMspPlanVersionId',
    'fromCriteriaSetId',
    'fromBoardDefinitionId',
    'toMspPlanVersionId',
    'toCriteriaSetId',
    'toBoardDefinitionId',
    'authorityDocumentVersionId',
    'bindingSetNo',
    'approvalRequestId',
    'approvalRouteVersionId',
    'formDocumentVersionId',
    'republicationOfId',
    'newPublicationId',
    'channelTypes',
    'applicationId',
    'appointmentId',
    'serviceSegmentId',
    'employeeId',
  ]);
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => allowed.has(key)),
  ) as Prisma.InputJsonObject;
}

function matchesApplicability(
  value: Prisma.JsonValue,
  vacancy: Extract<RecruitableVacancyResolution, { eligible: true }>,
): boolean {
  const object = jsonObject(value);
  if (!object) return false;
  const supported = new Set([
    'positionIds',
    'organizationUnitIds',
    'itemNumbers',
    'salaryGrades',
    'employmentCategories',
  ]);
  for (const [key, expected] of Object.entries(object)) {
    if (!supported.has(key) || !Array.isArray(expected)) return false;
    const actual =
      key === 'positionIds'
        ? vacancy.positionId
        : key === 'organizationUnitIds'
          ? vacancy.organizationUnitId
          : key === 'itemNumbers'
            ? vacancy.itemNumber
            : key === 'salaryGrades'
              ? vacancy.salaryGrade
              : vacancy.employmentCategory;
    if (!expected.some((candidate) => candidate === actual)) return false;
  }
  return true;
}

function requiredBoardSeats(value: Prisma.JsonValue): string[] {
  const object = jsonObject(value);
  if (!object || !Array.isArray(object.seats)) return [];
  return object.seats.flatMap((seat) => {
    if (typeof seat !== 'object' || seat === null || Array.isArray(seat)) return [];
    const item = seat as Record<string, Prisma.JsonValue>;
    return typeof item.seatCode === 'string' && item.seatCode.trim() && item.required !== false
      ? [item.seatCode.trim()]
      : [];
  });
}

function boardSeatCodes(value: Prisma.JsonValue): string[] {
  const object = jsonObject(value);
  if (!object || !Array.isArray(object.seats)) return [];
  return object.seats.flatMap((seat) => {
    if (typeof seat !== 'object' || seat === null || Array.isArray(seat)) return [];
    const item = seat as Record<string, Prisma.JsonValue>;
    return typeof item.seatCode === 'string' && item.seatCode.trim() ? [item.seatCode.trim()] : [];
  });
}

function hasMalformedBoardSeatDefinition(value: Prisma.JsonValue): boolean {
  const object = jsonObject(value);
  if (!object || !Array.isArray(object.seats)) return true;
  return object.seats.some((seat) => {
    if (typeof seat !== 'object' || seat === null || Array.isArray(seat)) return true;
    const item = seat as Record<string, Prisma.JsonValue>;
    return (
      typeof item.seatCode !== 'string' ||
      !item.seatCode.trim() ||
      (item.required !== undefined && typeof item.required !== 'boolean')
    );
  });
}

function isAlternateAppointmentKind(value: string): boolean {
  return value.trim().toUpperCase().includes('ALTERNATE');
}

function isCsFormNo9(documentType: string): boolean {
  const normalized = documentType
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  return /^CS FORM (?:NO |NUMBER )?9$/.test(normalized);
}

function isKnownPrismaError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

@Injectable()
export class RecruitmentService {
  constructor(
    @Inject(PlantillaPositionsService)
    private readonly plantillaPositions: PlantillaPositionsService,
    @Inject(DocumentsService)
    private readonly documents: DocumentsService,
    @Inject(ApprovalsService)
    private readonly approvals: ApprovalsService,
    @Inject(ApprovalCompletionRegistry)
    private readonly completionRegistry: ApprovalCompletionRegistry,
  ) {
    this.completionRegistry.register('REQUEST_TO_FILL', (transaction, context, request) =>
      this.completeRequest(transaction, context, request),
    );
    this.completionRegistry.register('VACANCY_PUBLICATION', (transaction, context, request) =>
      this.completePublication(transaction, context, request),
    );
    this.completionRegistry.registerDecision(
      'REQUEST_TO_FILL',
      (transaction, context, request, outcome) =>
        this.decideRequest(transaction, context, request, outcome),
    );
    this.completionRegistry.registerDecision(
      'VACANCY_PUBLICATION',
      (transaction, context, request, outcome) =>
        this.decidePublication(transaction, context, request, outcome),
    );
  }

  async listRequests(
    context: RequestContext,
    filter: RequestListInput = {},
  ): Promise<RecruitmentPage<RequestToFillSummary>> {
    this.assertPermission(
      context,
      'recruitment.requests.read',
      'RECRUITMENT_REQUEST_READ_FORBIDDEN',
    );
    const records = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      transaction.requestToFill.findMany({
        where: { agencyId: context.agencyId, ...(filter.status ? { status: filter.status } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: filter.offset ?? 0,
        take: (filter.limit ?? 50) + 1,
        select: requestSelect,
      }),
    );
    const hasMore = records.length > (filter.limit ?? 50);
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;
    return {
      items: records.slice(0, limit).map(requestSummary),
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
    };
  }

  async findRequest(
    context: RequestContext,
    requestId: string,
  ): Promise<RequestToFillSummary | null> {
    this.assertPermission(
      context,
      'recruitment.requests.read',
      'RECRUITMENT_REQUEST_READ_FORBIDDEN',
    );
    const record = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      transaction.requestToFill.findFirst({
        where: { agencyId: context.agencyId, id: requestId },
        select: requestSelect,
      }),
    );
    return record ? requestSummary(record) : null;
  }

  async createRequest(
    context: RequestContext,
    input: RequestCreateInput,
    rawIdempotencyKey?: string,
  ): Promise<RequestToFillSummary> {
    this.assertPermission(
      context,
      'recruitment.requests.create',
      'RECRUITMENT_REQUEST_CREATE_FORBIDDEN',
    );
    return withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const previous = await this.idempotentEvent(
          transaction,
          context,
          'REQUEST_TO_FILL_CREATED',
          rawIdempotencyKey,
        );
        if (previous) {
          if (previous.metadata && jsonObject(previous.metadata)?.positionId !== input.positionId)
            throw this.idempotencyConflict();
          const existing = await this.requireRequest(
            transaction,
            context.agencyId,
            previous.entityId,
          );
          return requestSummary(existing);
        }
        const vacancy = await this.requireVacancyInTransaction(
          transaction,
          context,
          input.positionId,
        );
        if (input.requestingUnitId !== vacancy.organizationUnitId) {
          throw new RecruitmentServiceError(
            'The requesting office must own the Plantilla Position vacancy.',
            403,
            'RECRUITMENT_REQUESTING_UNIT_FORBIDDEN',
          );
        }
        let record: { id: string };
        try {
          record = await transaction.requestToFill.create({
            data: {
              agencyId: context.agencyId,
              positionId: input.positionId,
              requestingUnitId: input.requestingUnitId,
              requestedByMembershipId: context.membershipId,
              justification: input.justification.trim(),
              qualificationStandardVersionId: vacancy.qualificationStandardVersionId,
              status: 'DRAFT',
              createdByMembershipId: context.membershipId,
              updatedByMembershipId: context.membershipId,
            },
            select: { id: true },
          });
        } catch (error) {
          if (isKnownPrismaError(error, 'P2002')) throw this.activeRequestConflict();
          throw error;
        }
        await this.writeAudit(transaction, context, {
          action: 'REQUEST_TO_FILL_CREATED',
          entityType: 'RequestToFill',
          entityId: record.id,
          previousStatus: null,
          newStatus: 'DRAFT',
          reason: 'Draft Request to Fill created from a resolved Recruitable Vacancy.',
          metadata: safeAuditMetadata({
            positionId: input.positionId,
            qualificationStandardVersionId: vacancy.qualificationStandardVersionId,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
        return requestSummary(await this.requireRequest(transaction, context.agencyId, record.id));
      },
    );
  }

  async submitRequest(
    context: RequestContext,
    requestId: string,
    rawIdempotencyKey?: string,
  ): Promise<RequestToFillSummary> {
    this.assertPermission(
      context,
      'recruitment.requests.submit',
      'RECRUITMENT_REQUEST_SUBMIT_FORBIDDEN',
    );
    return withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const current = await this.lockRequest(transaction, context.agencyId, requestId);
        if (!current) throw this.notFound('Request to Fill');
        if (current.requestedByMembershipId !== context.membershipId)
          throw new RecruitmentServiceError(
            'Only the Request to Fill drafter can submit it.',
            403,
            'RECRUITMENT_REQUEST_DRAFTER_REQUIRED',
          );
        if (current.status !== 'DRAFT') throw this.workflowError('submit', current.status);
        const vacancy = await this.requireVacancyInTransaction(
          transaction,
          context,
          current.positionId,
        );
        if (
          current.requestingUnitId !== vacancy.organizationUnitId ||
          current.qualificationStandardVersionId !== vacancy.qualificationStandardVersionId
        ) {
          throw new RecruitmentServiceError(
            'The Plantilla Position changed after the draft was created.',
            409,
            'RECRUITMENT_POSITION_CHANGED',
          );
        }
        const updated = await transaction.requestToFill.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: requestId } },
          data: {
            status: 'SUBMITTED',
            submittedAt: new Date(),
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
          select: { id: true },
        });
        await this.writeAudit(transaction, context, {
          action: 'REQUEST_TO_FILL_SUBMITTED',
          entityType: 'RequestToFill',
          entityId: updated.id,
          previousStatus: 'DRAFT',
          newStatus: 'SUBMITTED',
          reason: 'Request to Fill submitted for controlled governing-configuration review.',
          metadata: safeAuditMetadata({ positionId: current.positionId }),
          idempotencyKey: rawIdempotencyKey,
        });
        return requestSummary(await this.requireRequest(transaction, context.agencyId, requestId));
      },
    );
  }

  async reviewRequest(
    context: RequestContext,
    requestId: string,
    rawIdempotencyKey?: string,
  ): Promise<RequestToFillSummary> {
    this.assertPermission(
      context,
      'recruitment.requests.review',
      'RECRUITMENT_REQUEST_REVIEW_FORBIDDEN',
    );
    return withDatabaseContext(
      requestDatabaseContext(context, 'approval-transition', 'recruitment-transition'),
      async (transaction) => {
        const current = await this.lockRequest(transaction, context.agencyId, requestId);
        if (!current) throw this.notFound('Request to Fill');
        if (current.status === 'FOR_REVIEW' && current.approvalRequestId)
          return requestSummary(current);
        if (current.status !== 'SUBMITTED') throw this.workflowError('review', current.status);
        const vacancy = await this.requireVacancyInTransaction(
          transaction,
          context,
          current.positionId,
        );
        const asOf = manilaToday();
        const configuration = await this.resolveConfiguration(
          transaction,
          context.agencyId,
          vacancy,
          asOf,
        );
        const currentSummary = requestSummary(current);
        this.assertRequestVacancyUnchanged(currentSummary, vacancy);
        const requestRoute = await this.approvals.resolveActiveRouteInTransaction(
          transaction,
          context,
          REQUEST_TO_FILL_ROUTE_CODE,
          asOf,
        );
        const publicationRoute = await this.approvals.resolveActiveRouteInTransaction(
          transaction,
          context,
          VACANCY_PUBLICATION_ROUTE_CODE,
          asOf,
        );
        const approval = await this.approvals.createRequestInTransaction(
          transaction,
          context,
          {
            routeCode: REQUEST_TO_FILL_ROUTE_CODE,
            subjectType: 'REQUEST_TO_FILL',
            subjectId: requestId,
            effectiveDate: asOf,
          },
          rawIdempotencyKey ? `${rawIdempotencyKey}:approval-create` : undefined,
          requestRoute.id,
        );
        await this.approvals.submitInTransaction(
          transaction,
          context,
          approval.id,
          rawIdempotencyKey ? `${rawIdempotencyKey}:approval-submit` : undefined,
        );
        const bindingSetNo = current.bindingSetNo + 1;
        const now = new Date();
        await transaction.requestToFill.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: requestId } },
          data: {
            mspPlanVersionId: configuration.planId,
            criteriaSetId: configuration.criteriaSetId,
            boardDefinitionId: configuration.boardId,
            bindingSetNo,
            bindingsResolvedAt: now,
            approvalRequestId: approval.id,
            status: 'FOR_REVIEW',
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await transaction.requestApprovalRouteBinding.createMany({
          data: [
            {
              agencyId: context.agencyId,
              requestToFillId: requestId,
              bindingSetNo,
              checkpointCode: 'REQUEST_TO_FILL_REVIEW',
              approvalRouteVersionId: requestRoute.id,
              boundByMembershipId: context.membershipId,
            },
            {
              agencyId: context.agencyId,
              requestToFillId: requestId,
              bindingSetNo,
              checkpointCode: 'VACANCY_PUBLICATION',
              approvalRouteVersionId: publicationRoute.id,
              boundByMembershipId: context.membershipId,
            },
          ],
        });
        await this.writeAudit(transaction, context, {
          action: 'REQUEST_TO_FILL_REVIEW_STARTED',
          entityType: 'RequestToFill',
          entityId: requestId,
          previousStatus: 'SUBMITTED',
          newStatus: 'FOR_REVIEW',
          reason: 'Recruitable Vacancy and governing configuration resolved exactly once.',
          metadata: safeAuditMetadata({
            positionId: current.positionId,
            qualificationStandardVersionId: vacancy.qualificationStandardVersionId,
            mspPlanVersionId: configuration.planId,
            criteriaSetId: configuration.criteriaSetId,
            boardDefinitionId: configuration.boardId,
            bindingSetNo,
            approvalRequestId: approval.id,
            approvalRouteVersionId: requestRoute.id,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
        return requestSummary(await this.requireRequest(transaction, context.agencyId, requestId));
      },
    );
  }

  async rebaselineRequest(
    context: RequestContext,
    requestId: string,
    input: RequestRebaselineInput,
    rawIdempotencyKey?: string,
  ): Promise<RequestToFillSummary> {
    this.assertPermission(
      context,
      'recruitment.requests.rebaseline',
      'RECRUITMENT_REQUEST_REBASELINE_FORBIDDEN',
    );
    return withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const locked = await this.lockRequest(transaction, context.agencyId, requestId);
        if (!locked) throw this.notFound('Request to Fill');
        if (locked.status !== 'FOR_REVIEW' || !locked.approvalRequestId || locked.bindingFrozenAt) {
          throw this.workflowError('rebaseline', locked.status);
        }
        const vacancy = await this.requireVacancyInTransaction(
          transaction,
          context,
          locked.positionId,
        );
        this.assertRequestVacancyUnchanged(requestSummary(locked), vacancy);
        const asOf = manilaToday();
        const configuration = await this.resolveConfiguration(
          transaction,
          context.agencyId,
          vacancy,
          asOf,
        );
        if (
          configuration.planId === locked.mspPlanVersionId &&
          configuration.criteriaSetId === locked.criteriaSetId &&
          configuration.boardId === locked.boardDefinitionId
        ) {
          throw new RecruitmentServiceError(
            'The replacement governing configuration must differ from the bound configuration.',
            409,
            'RECRUITMENT_REBASELINE_UNCHANGED',
          );
        }
        const currentBindings = locked.routeBindings.filter(
          (binding) => binding.bindingSetNo === locked.bindingSetNo,
        );
        const requestRoute = currentBindings.find(
          (binding) => binding.checkpointCode === 'REQUEST_TO_FILL_REVIEW',
        );
        const publicationRoute = currentBindings.find(
          (binding) => binding.checkpointCode === 'VACANCY_PUBLICATION',
        );
        if (!requestRoute || !publicationRoute) {
          throw new RecruitmentServiceError(
            'The Request to Fill has incomplete Approval Route bindings.',
            409,
            'RECRUITMENT_APPROVAL_ROUTE_INVALID',
          );
        }
        await this.requireFinalizedDocumentVersion(
          transaction,
          context,
          input.authorityDocumentVersionId,
          'RECRUITMENT_REBASELINE_AUTHORITY_INVALID',
        );
        const bindingSetNo = locked.bindingSetNo + 1;
        const now = new Date();
        await transaction.requestToFill.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: requestId } },
          data: {
            mspPlanVersionId: configuration.planId,
            criteriaSetId: configuration.criteriaSetId,
            boardDefinitionId: configuration.boardId,
            bindingSetNo,
            bindingsResolvedAt: now,
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await transaction.requestMspRebaseline.create({
          data: {
            agencyId: context.agencyId,
            requestToFillId: requestId,
            fromMspPlanVersionId: locked.mspPlanVersionId,
            fromCriteriaSetId: locked.criteriaSetId,
            fromBoardDefinitionId: locked.boardDefinitionId,
            toMspPlanVersionId: configuration.planId,
            toCriteriaSetId: configuration.criteriaSetId,
            toBoardDefinitionId: configuration.boardId,
            reason: input.reason.trim(),
            authorizedByMembershipId: context.membershipId,
            authorityDocumentVersionId: input.authorityDocumentVersionId,
          },
        });
        await transaction.requestApprovalRouteBinding.createMany({
          data: [
            {
              agencyId: context.agencyId,
              requestToFillId: requestId,
              bindingSetNo,
              checkpointCode: 'REQUEST_TO_FILL_REVIEW',
              approvalRouteVersionId: requestRoute.approvalRouteVersionId,
              boundByMembershipId: context.membershipId,
            },
            {
              agencyId: context.agencyId,
              requestToFillId: requestId,
              bindingSetNo,
              checkpointCode: 'VACANCY_PUBLICATION',
              approvalRouteVersionId: publicationRoute.approvalRouteVersionId,
              boundByMembershipId: context.membershipId,
            },
          ],
        });
        await this.writeAudit(transaction, context, {
          action: 'REQUEST_TO_FILL_REBASELINED',
          entityType: 'RequestToFill',
          entityId: requestId,
          previousStatus: 'FOR_REVIEW',
          newStatus: 'FOR_REVIEW',
          reason: input.reason.trim(),
          metadata: safeAuditMetadata({
            positionId: locked.positionId,
            fromMspPlanVersionId: locked.mspPlanVersionId,
            fromCriteriaSetId: locked.criteriaSetId,
            fromBoardDefinitionId: locked.boardDefinitionId,
            toMspPlanVersionId: configuration.planId,
            toCriteriaSetId: configuration.criteriaSetId,
            toBoardDefinitionId: configuration.boardId,
            authorityDocumentVersionId: input.authorityDocumentVersionId,
            bindingSetNo,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
        return requestSummary(await this.requireRequest(transaction, context.agencyId, requestId));
      },
    );
  }

  async approveRequest(
    context: RequestContext,
    requestId: string,
    comments?: string,
    rawIdempotencyKey?: string,
  ): Promise<RequestToFillSummary> {
    this.assertPermission(
      context,
      'recruitment.requests.approve',
      'RECRUITMENT_REQUEST_APPROVE_FORBIDDEN',
    );
    const current = await this.findRequestForCommand(context, requestId);
    if (!current?.approvalRequestId)
      throw new RecruitmentServiceError(
        'The Request to Fill has no active Approval Request.',
        409,
        'RECRUITMENT_APPROVAL_MISSING',
      );
    await this.approvals.approve(context, current.approvalRequestId, comments, rawIdempotencyKey);
    const result = await this.findRequest(context, requestId);
    if (!result) throw this.notFound('Request to Fill');
    return result;
  }

  async returnRequest(
    context: RequestContext,
    requestId: string,
    comments: string,
    rawIdempotencyKey?: string,
  ): Promise<RequestToFillSummary> {
    this.assertPermission(
      context,
      'recruitment.requests.review',
      'RECRUITMENT_REQUEST_REVIEW_FORBIDDEN',
    );
    const current = await this.requireCommandRequest(context, requestId);
    if (!current.approvalRequestId)
      throw new RecruitmentServiceError(
        'The Request to Fill has no active Approval Request.',
        409,
        'RECRUITMENT_APPROVAL_MISSING',
      );
    await this.approvals.returnRequest(
      context,
      current.approvalRequestId,
      comments,
      rawIdempotencyKey,
    );
    const result = await this.findRequest(context, requestId);
    if (!result) throw this.notFound('Request to Fill');
    return result;
  }

  async rejectRequest(
    context: RequestContext,
    requestId: string,
    comments: string,
    rawIdempotencyKey?: string,
  ): Promise<RequestToFillSummary> {
    this.assertPermission(
      context,
      'recruitment.requests.reject',
      'RECRUITMENT_REQUEST_REJECT_FORBIDDEN',
    );
    const current = await this.requireCommandRequest(context, requestId);
    if (!current.approvalRequestId)
      throw new RecruitmentServiceError(
        'The Request to Fill has no active Approval Request.',
        409,
        'RECRUITMENT_APPROVAL_MISSING',
      );
    await this.approvals.reject(context, current.approvalRequestId, comments, rawIdempotencyKey);
    const result = await this.findRequest(context, requestId);
    if (!result) throw this.notFound('Request to Fill');
    return result;
  }

  async cancelRequest(
    context: RequestContext,
    requestId: string,
    reason: string,
    rawIdempotencyKey?: string,
  ): Promise<RequestToFillSummary> {
    this.assertPermission(
      context,
      'recruitment.requests.cancel',
      'RECRUITMENT_REQUEST_CANCEL_FORBIDDEN',
    );
    const normalizedReason = reason.trim();
    if (!normalizedReason)
      throw new RecruitmentServiceError(
        'A cancellation reason is required.',
        400,
        'RECRUITMENT_REASON_REQUIRED',
      );
    const current = await this.requireCommandRequest(context, requestId);
    if (!['DRAFT', 'SUBMITTED'].includes(current.status))
      throw this.workflowError('cancel', current.status);
    await withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const locked = await this.lockRequest(transaction, context.agencyId, requestId);
        if (!locked) return;
        if (locked.status === 'CANCELLED') return;
        if (!['DRAFT', 'SUBMITTED'].includes(locked.status))
          throw this.workflowError('cancel', locked.status);
        const activePublication = await transaction.vacancyPublication.findFirst({
          where: {
            agencyId: context.agencyId,
            requestToFillId: requestId,
            status: { in: ['DRAFT', 'FOR_APPROVAL', 'PUBLISHED'] },
          },
          select: { id: true },
        });
        if (activePublication) {
          throw new RecruitmentServiceError(
            'A Request to Fill cannot be cancelled while its Vacancy Publication is active.',
            409,
            'RECRUITMENT_ACTIVE_PUBLICATION',
          );
        }
        await transaction.requestToFill.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: requestId } },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'REQUEST_TO_FILL_CANCELLED',
          entityType: 'RequestToFill',
          entityId: requestId,
          previousStatus: locked.status,
          newStatus: 'CANCELLED',
          reason: normalizedReason,
          metadata: {},
          idempotencyKey: rawIdempotencyKey,
        });
      },
    );
    const result = await this.findRequest(context, requestId);
    if (!result) throw this.notFound('Request to Fill');
    return result;
  }

  async closeRequest(
    context: RequestContext,
    requestId: string,
    reason: string,
    rawIdempotencyKey?: string,
  ): Promise<RequestToFillSummary> {
    this.assertPermission(
      context,
      'recruitment.requests.close',
      'RECRUITMENT_REQUEST_CLOSE_FORBIDDEN',
    );
    const normalizedReason = reason.trim();
    if (!normalizedReason)
      throw new RecruitmentServiceError(
        'A close reason is required.',
        400,
        'RECRUITMENT_REASON_REQUIRED',
      );
    await withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const current = await this.lockRequest(transaction, context.agencyId, requestId);
        if (!current) throw this.notFound('Request to Fill');
        if (current.status !== 'APPROVED') throw this.workflowError('close', current.status);
        const activePublication = await transaction.vacancyPublication.findFirst({
          where: {
            agencyId: context.agencyId,
            requestToFillId: requestId,
            status: { in: ['DRAFT', 'FOR_APPROVAL', 'PUBLISHED'] },
          },
          select: { id: true },
        });
        if (activePublication) {
          throw new RecruitmentServiceError(
            'A Request to Fill cannot be closed while its Vacancy Publication is active.',
            409,
            'RECRUITMENT_ACTIVE_PUBLICATION',
          );
        }
        await transaction.requestToFill.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: requestId } },
          data: {
            status: 'CLOSED',
            closedAt: new Date(),
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'REQUEST_TO_FILL_CLOSED',
          entityType: 'RequestToFill',
          entityId: requestId,
          previousStatus: 'APPROVED',
          newStatus: 'CLOSED',
          reason: normalizedReason,
          metadata: {},
          idempotencyKey: rawIdempotencyKey,
        });
      },
    );
    const result = await this.findRequest(context, requestId);
    if (!result) throw this.notFound('Request to Fill');
    return result;
  }

  /**
   * Internal contract: Appointment activation owns the transaction. The assumed
   * Appointment Contract is the closure authority, so the publication closes
   * without early-closure evidence, and the fulfilled Request to Fill closes
   * only after no other publication remains active.
   */
  async closePublicationAndRequestAfterActivationInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: {
      publicationId: string;
      appointmentId: string;
      serviceSegmentId: string;
      reason: string;
    },
    rawIdempotencyKey?: string,
  ): Promise<ActivationPublicationClosure> {
    const reason = input.reason.trim();
    if (!reason)
      throw new RecruitmentServiceError(
        'A close reason is required.',
        400,
        'RECRUITMENT_REASON_REQUIRED',
      );
    const current = await this.lockPublication(transaction, context.agencyId, input.publicationId);
    if (!current) throw this.notFound('Vacancy Publication');
    const previous = await this.idempotentEvent(
      transaction,
      context,
      'VACANCY_PUBLICATION_CLOSED',
      rawIdempotencyKey,
      current.id,
    );
    if (!previous) {
      if (current.status !== 'PUBLISHED') throw this.workflowError('close', current.status);
      await transaction.vacancyPublication.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: current.id } },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closureReason: reason,
          closureAuthorityDocumentVersionId: null,
          updatedByMembershipId: context.membershipId,
          rowVersion: { increment: 1 },
        },
      });
      await this.writeAudit(transaction, context, {
        action: 'VACANCY_PUBLICATION_CLOSED',
        entityType: 'VacancyPublication',
        entityId: current.id,
        previousStatus: 'PUBLISHED',
        newStatus: 'CLOSED',
        reason,
        metadata: safeAuditMetadata({
          publicationNo: current.publicationNo,
          requestToFillId: current.requestToFillId,
          appointmentId: input.appointmentId,
          serviceSegmentId: input.serviceSegmentId,
        }),
        idempotencyKey: rawIdempotencyKey,
      });
    }
    const request = await this.lockRequest(transaction, context.agencyId, current.requestToFillId);
    if (!request) throw this.notFound('Request to Fill');
    const previousRequest = await this.idempotentEvent(
      transaction,
      context,
      'REQUEST_TO_FILL_CLOSED',
      rawIdempotencyKey,
      request.id,
    );
    if (!previousRequest) {
      if (request.status !== 'APPROVED') throw this.workflowError('close', request.status);
      const activePublication = await transaction.vacancyPublication.findFirst({
        where: {
          agencyId: context.agencyId,
          requestToFillId: request.id,
          status: { in: ['DRAFT', 'FOR_APPROVAL', 'PUBLISHED'] },
        },
        select: { id: true },
      });
      if (activePublication) {
        throw new RecruitmentServiceError(
          'A Request to Fill cannot be closed while its Vacancy Publication is active.',
          409,
          'RECRUITMENT_ACTIVE_PUBLICATION',
        );
      }
      await transaction.requestToFill.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: request.id } },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          updatedByMembershipId: context.membershipId,
          rowVersion: { increment: 1 },
        },
      });
      await this.writeAudit(transaction, context, {
        action: 'REQUEST_TO_FILL_CLOSED',
        entityType: 'RequestToFill',
        entityId: request.id,
        previousStatus: 'APPROVED',
        newStatus: 'CLOSED',
        reason,
        metadata: safeAuditMetadata({
          requestNo: request.requestNo,
          publicationNo: current.publicationNo,
          appointmentId: input.appointmentId,
          serviceSegmentId: input.serviceSegmentId,
        }),
        idempotencyKey: rawIdempotencyKey,
      });
    }
    return { publicationId: current.id, requestToFillId: current.requestToFillId };
  }

  async listPublications(
    context: RequestContext,
    filter: PublicationListInput = {},
  ): Promise<RecruitmentPage<VacancyPublicationSummary>> {
    this.assertPermission(
      context,
      'recruitment.vacancies.read',
      'RECRUITMENT_PUBLICATION_READ_FORBIDDEN',
    );
    const records = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      transaction.vacancyPublication.findMany({
        where: { agencyId: context.agencyId, ...(filter.status ? { status: filter.status } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: filter.offset ?? 0,
        take: (filter.limit ?? 50) + 1,
        select: publicationSelect,
      }),
    );
    const limit = filter.limit ?? 50;
    return {
      items: records.slice(0, limit).map(publicationSummary),
      hasMore: records.length > limit,
      nextOffset: records.length > limit ? (filter.offset ?? 0) + limit : null,
    };
  }

  async findPublication(
    context: RequestContext,
    publicationId: string,
  ): Promise<VacancyPublicationSummary | null> {
    this.assertPermission(
      context,
      'recruitment.vacancies.read',
      'RECRUITMENT_PUBLICATION_READ_FORBIDDEN',
    );
    const record = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      transaction.vacancyPublication.findFirst({
        where: { agencyId: context.agencyId, id: publicationId },
        select: publicationSelect,
      }),
    );
    return record ? publicationSummary(record) : null;
  }

  async createPublication(
    context: RequestContext,
    input: PublicationCreateInput,
    rawIdempotencyKey?: string,
  ): Promise<VacancyPublicationSummary> {
    this.assertPermission(
      context,
      'recruitment.vacancies.create',
      'RECRUITMENT_PUBLICATION_CREATE_FORBIDDEN',
    );
    const { openingDate, closingDate } = this.publicationDates(input);
    const request = await this.requireApprovedRequest(context, input.requestToFillId);
    const routeBinding = request.routeBindings.find(
      (binding) =>
        binding.checkpointCode === 'VACANCY_PUBLICATION' &&
        binding.bindingSetNo === request.governingConfiguration.bindingSetNo,
    );
    if (!routeBinding)
      throw new RecruitmentServiceError(
        'The approved Request to Fill has no bound publication Approval Route.',
        409,
        'RECRUITMENT_APPROVAL_ROUTE_MISSING',
      );
    return withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        return this.createPublicationDraft(
          transaction,
          context,
          input,
          routeBinding.routeVersionId,
          openingDate,
          closingDate,
          rawIdempotencyKey,
        );
      },
    );
  }

  async correctPublication(
    context: RequestContext,
    publicationId: string,
    input: PublicationCorrectionInput,
    rawIdempotencyKey?: string,
  ): Promise<VacancyPublicationSummary> {
    this.assertPermission(
      context,
      'recruitment.vacancies.create',
      'RECRUITMENT_PUBLICATION_CREATE_FORBIDDEN',
    );
    const { openingDate, closingDate } = this.publicationDates(input);
    const publication = await this.requireCommandPublication(context, publicationId);
    return withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const lockedRequest = await this.lockRequest(
          transaction,
          context.agencyId,
          publication.requestToFillId,
        );
        if (!lockedRequest) throw this.notFound('Request to Fill');
        if (lockedRequest.status !== 'APPROVED')
          throw this.workflowError('correct publication', lockedRequest.status);
        const request = requestSummary(lockedRequest);
        const current = await this.lockPublication(transaction, context.agencyId, publicationId);
        if (!current) throw this.notFound('Vacancy Publication');
        if (current.status !== 'DRAFT') throw this.workflowError('correct', current.status);
        const previous = await this.idempotentEvent(
          transaction,
          context,
          'VACANCY_PUBLICATION_CORRECTED',
          rawIdempotencyKey,
          publicationId,
        );
        if (previous)
          return publicationSummary(
            await this.requirePublication(transaction, context.agencyId, publicationId),
          );
        if (current.requestToFillId !== request.id)
          throw new RecruitmentServiceError(
            'The publication correction cannot change its Request to Fill.',
            400,
            'RECRUITMENT_REPUBLICATION_REQUEST_INVALID',
          );
        await transaction.vacancyPublication.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: publicationId } },
          data: {
            formDocumentVersionId: input.formDocumentVersionId,
            openingDate,
            closingDate,
            ...(input.channels ? { channels: inputJson(input.channels) } : {}),
            positionDetails: inputJson(input.positionDetails),
            applicationRequirements: inputJson(input.applicationRequirements),
            contactDetails: inputJson(input.contactDetails),
            ...(input.hrmoCertification
              ? { hrmoCertification: inputJson(input.hrmoCertification) }
              : {}),
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        if (input.evidence) {
          this.assertUniquePublicationEvidence(input.evidence);
          await transaction.vacancyPublicationEvidence.deleteMany({
            where: { agencyId: context.agencyId, publicationId },
          });
          if (input.evidence.length) {
            await transaction.vacancyPublicationEvidence.createMany({
              data: input.evidence.map((evidence) => ({
                agencyId: context.agencyId,
                publicationId,
                channelType: evidence.channelType,
                location: evidence.location,
                reference: evidence.reference ?? null,
                publishedAt: new Date(evidence.publishedAt),
                evidenceDocumentVersionId: evidence.evidenceDocumentVersionId,
                createdByMembershipId: context.membershipId,
              })),
            });
          }
        }
        await this.writeAudit(transaction, context, {
          action: 'VACANCY_PUBLICATION_CORRECTED',
          entityType: 'VacancyPublication',
          entityId: publicationId,
          previousStatus: 'DRAFT',
          newStatus: 'DRAFT',
          reason: 'Returned Vacancy Publication details were corrected before resubmission.',
          metadata: safeAuditMetadata({
            formDocumentVersionId: input.formDocumentVersionId,
            requestNo: request.requestNo,
            ...(input.channels
              ? { channelTypes: input.channels.map((channel) => channel.type) }
              : {}),
          }),
          idempotencyKey: rawIdempotencyKey,
        });
        return publicationSummary(
          await this.requirePublication(transaction, context.agencyId, publicationId),
        );
      },
    );
  }

  async submitPublication(
    context: RequestContext,
    publicationId: string,
    rawIdempotencyKey?: string,
  ): Promise<VacancyPublicationSummary> {
    this.assertPermission(
      context,
      'recruitment.vacancies.submit',
      'RECRUITMENT_PUBLICATION_SUBMIT_FORBIDDEN',
    );
    const current = await this.findPublicationForCommand(context, publicationId);
    if (!current) throw this.notFound('Vacancy Publication');
    if (current.status !== 'DRAFT') throw this.workflowError('submit', current.status);
    await withDatabaseContext(
      requestDatabaseContext(context, 'approval-transition', 'recruitment-transition'),
      async (transaction) => {
        const request = await this.lockRequest(
          transaction,
          context.agencyId,
          current.requestToFillId,
        );
        if (!request) throw this.notFound('Request to Fill');
        const locked = await this.lockPublication(transaction, context.agencyId, publicationId);
        if (!locked) throw this.notFound('Vacancy Publication');
        if (request.status !== 'APPROVED')
          throw this.workflowError('submit publication', request.status);
        if (locked.status !== 'DRAFT') throw this.workflowError('submit', locked.status);
        const route = await this.approvals.resolveActiveRouteInTransaction(
          transaction,
          context,
          VACANCY_PUBLICATION_ROUTE_CODE,
          formatDate(locked.openingDate),
        );
        if (route.id !== locked.approvalRouteVersionId)
          throw new RecruitmentServiceError(
            'The bound publication Approval Route is no longer the exact active route for the opening date.',
            409,
            'RECRUITMENT_APPROVAL_ROUTE_CHANGED',
          );
        await this.validatePublicationForSubmission(
          transaction,
          context,
          locked,
          locked.republicationOfId !== null,
        );
        const approval = await this.approvals.createRequestInTransaction(
          transaction,
          context,
          {
            routeCode: VACANCY_PUBLICATION_ROUTE_CODE,
            subjectType: 'VACANCY_PUBLICATION',
            subjectId: publicationId,
            effectiveDate: formatDate(locked.openingDate),
          },
          rawIdempotencyKey ? `${rawIdempotencyKey}:approval-create` : undefined,
          locked.approvalRouteVersionId,
        );
        await this.approvals.submitInTransaction(
          transaction,
          context,
          approval.id,
          rawIdempotencyKey ? `${rawIdempotencyKey}:approval-submit` : undefined,
        );
        await transaction.vacancyPublication.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: publicationId } },
          data: {
            status: 'FOR_APPROVAL',
            approvalRequestId: approval.id,
            certifiedByMembershipId: context.membershipId,
            certifiedAt: new Date(),
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'VACANCY_PUBLICATION_SUBMITTED',
          entityType: 'VacancyPublication',
          entityId: publicationId,
          previousStatus: 'DRAFT',
          newStatus: 'FOR_APPROVAL',
          reason:
            'Publication dates, channels, exact CS Form No. 9 version, and evidence passed validation.',
          metadata: safeAuditMetadata({
            approvalRequestId: approval.id,
            approvalRouteVersionId: locked.approvalRouteVersionId,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
      },
    );
    const result = await this.findPublication(context, publicationId);
    if (!result) throw this.notFound('Vacancy Publication');
    return result;
  }

  async publishPublication(
    context: RequestContext,
    publicationId: string,
    comments?: string,
    rawIdempotencyKey?: string,
  ): Promise<VacancyPublicationSummary> {
    this.assertPermission(
      context,
      'recruitment.vacancies.publish',
      'RECRUITMENT_PUBLICATION_PUBLISH_FORBIDDEN',
    );
    const current = await this.findPublicationForCommand(context, publicationId);
    if (!current?.approvalRequestId)
      throw new RecruitmentServiceError(
        'The Vacancy Publication has no active Approval Request.',
        409,
        'RECRUITMENT_APPROVAL_MISSING',
      );
    await this.approvals.approve(context, current.approvalRequestId, comments, rawIdempotencyKey);
    const result = await this.findPublication(context, publicationId);
    if (!result) throw this.notFound('Vacancy Publication');
    return result;
  }

  async returnPublication(
    context: RequestContext,
    publicationId: string,
    comments: string,
    rawIdempotencyKey?: string,
  ): Promise<VacancyPublicationSummary> {
    this.assertPermission(
      context,
      'recruitment.vacancies.return',
      'RECRUITMENT_PUBLICATION_RETURN_FORBIDDEN',
    );
    const current = await this.requireCommandPublication(context, publicationId);
    if (!current.approvalRequestId)
      throw new RecruitmentServiceError(
        'The Vacancy Publication has no active Approval Request.',
        409,
        'RECRUITMENT_APPROVAL_MISSING',
      );
    await this.approvals.returnRequest(
      context,
      current.approvalRequestId,
      comments,
      rawIdempotencyKey,
    );
    const result = await this.findPublication(context, publicationId);
    if (!result) throw this.notFound('Vacancy Publication');
    return result;
  }

  async closePublication(
    context: RequestContext,
    publicationId: string,
    input: PublicationCloseInput,
    rawIdempotencyKey?: string,
  ): Promise<VacancyPublicationSummary> {
    this.assertPermission(
      context,
      'recruitment.vacancies.close',
      'RECRUITMENT_PUBLICATION_CLOSE_FORBIDDEN',
    );
    await this.transitionPublication(
      context,
      publicationId,
      'CLOSED',
      input.reason,
      rawIdempotencyKey,
      input.authorityDocumentVersionId,
    );
    const result = await this.findPublication(context, publicationId);
    if (!result) throw this.notFound('Vacancy Publication');
    return result;
  }

  async cancelPublication(
    context: RequestContext,
    publicationId: string,
    input: PublicationCancelInput,
    rawIdempotencyKey?: string,
  ): Promise<VacancyPublicationSummary> {
    this.assertPermission(
      context,
      'recruitment.vacancies.cancel',
      'RECRUITMENT_PUBLICATION_CANCEL_FORBIDDEN',
    );
    await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      this.requireFinalizedDocumentVersion(
        transaction,
        context,
        input.authorityDocumentVersionId,
        'RECRUITMENT_PUBLICATION_CANCELLATION_AUTHORITY_INVALID',
      ),
    );
    await this.transitionPublication(
      context,
      publicationId,
      'CANCELLED',
      input.reason,
      rawIdempotencyKey,
      input.authorityDocumentVersionId,
    );
    const result = await this.findPublication(context, publicationId);
    if (!result) throw this.notFound('Vacancy Publication');
    return result;
  }

  async republishPublication(
    context: RequestContext,
    publicationId: string,
    input: PublicationRepublishInput,
    rawIdempotencyKey?: string,
  ): Promise<VacancyPublicationSummary> {
    this.assertPermission(
      context,
      'recruitment.vacancies.republish',
      'RECRUITMENT_PUBLICATION_REPUBLISH_FORBIDDEN',
    );
    const source = await this.findPublicationForCommand(context, publicationId);
    if (!source) throw this.notFound('Vacancy Publication');
    if (source.status === 'REPUBLISHED') {
      const existing = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
        transaction.vacancyPublication.findFirst({
          where: { agencyId: context.agencyId, republicationOfId: publicationId },
          orderBy: { createdAt: 'desc' },
          select: publicationSelect,
        }),
      );
      if (existing) return publicationSummary(existing);
    }
    if (!['CLOSED', 'CANCELLED'].includes(source.status))
      throw this.workflowError('republish', source.status);
    const { openingDate, closingDate } = this.publicationDates(input);
    const request = await this.requireApprovedRequest(context, input.requestToFillId);
    if (request.position.id !== source.position.id)
      throw new RecruitmentServiceError(
        'A republication must retain the original Plantilla Position.',
        400,
        'RECRUITMENT_REPUBLICATION_REQUEST_INVALID',
      );
    const routeBinding = request.routeBindings.find(
      (binding) =>
        binding.checkpointCode === 'VACANCY_PUBLICATION' &&
        binding.bindingSetNo === request.governingConfiguration.bindingSetNo,
    );
    if (!routeBinding)
      throw new RecruitmentServiceError(
        'The approved Request to Fill has no bound publication Approval Route.',
        409,
        'RECRUITMENT_APPROVAL_ROUTE_MISSING',
      );
    await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      this.requireFinalizedDocumentVersion(
        transaction,
        context,
        input.authorityDocumentVersionId,
        'RECRUITMENT_REPUBLICATION_AUTHORITY_INVALID',
      ),
    );
    await withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const lockedRequest = await this.lockRequest(
          transaction,
          context.agencyId,
          input.requestToFillId,
        );
        if (!lockedRequest) throw this.notFound('Request to Fill');
        if (lockedRequest.status !== 'APPROVED')
          throw this.workflowError('republish', lockedRequest.status);
        const freshRequest = requestSummary(lockedRequest);
        if (freshRequest.position.id !== source.position.id)
          throw new RecruitmentServiceError(
            'A republication must retain the original Plantilla Position.',
            400,
            'RECRUITMENT_REPUBLICATION_REQUEST_INVALID',
          );
        const freshRouteBinding = freshRequest.routeBindings.find(
          (binding) =>
            binding.checkpointCode === 'VACANCY_PUBLICATION' &&
            binding.bindingSetNo === freshRequest.governingConfiguration.bindingSetNo,
        );
        if (!freshRouteBinding)
          throw new RecruitmentServiceError(
            'The approved Request to Fill has no bound publication Approval Route.',
            409,
            'RECRUITMENT_APPROVAL_ROUTE_MISSING',
          );
        const locked = await this.lockPublication(transaction, context.agencyId, publicationId);
        if (!locked) throw this.notFound('Vacancy Publication');
        if (locked.status === 'REPUBLISHED') {
          const existing = await this.requirePublicationByLineage(
            transaction,
            context.agencyId,
            publicationId,
          );
          if (existing) return publicationSummary(existing);
        }
        if (!['CLOSED', 'CANCELLED'].includes(locked.status))
          throw this.workflowError('republish', locked.status);
        await transaction.vacancyPublication.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: publicationId } },
          data: {
            status: 'REPUBLISHED',
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        const created = await this.createPublicationDraft(
          transaction,
          context,
          input,
          freshRouteBinding.routeVersionId,
          openingDate,
          closingDate,
          rawIdempotencyKey ? `${rawIdempotencyKey}:new` : undefined,
          publicationId,
          input.reason,
          input.authorityDocumentVersionId,
        );
        await this.writeAudit(transaction, context, {
          action: 'VACANCY_PUBLICATION_REPUBLISHED',
          entityType: 'VacancyPublication',
          entityId: publicationId,
          previousStatus: locked.status,
          newStatus: 'REPUBLISHED',
          reason: 'A corrected or renewed publication is being issued with preserved lineage.',
          metadata: safeAuditMetadata({
            republicationOfId: publicationId,
            newPublicationId: created.id,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
        return created;
      },
    );
    const child = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      this.requirePublicationByLineage(transaction, context.agencyId, publicationId),
    );
    if (!child) throw this.notFound('Vacancy Publication');
    return publicationSummary(child);
  }

  private publicationDates(input: Pick<PublicationCreateInput, 'openingDate' | 'closingDate'>): {
    openingDate: Date;
    closingDate: Date;
  } {
    const openingDate = date(input.openingDate);
    const closingDate = date(input.closingDate);
    if (closingDate < openingDate) {
      throw new RecruitmentServiceError(
        'The publication closing date cannot precede its opening date.',
        400,
        'RECRUITMENT_PUBLICATION_DATE_INVALID',
      );
    }
    return { openingDate, closingDate };
  }

  private async createPublicationDraft(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: PublicationCreateInput,
    approvalRouteVersionId: string,
    openingDate: Date,
    closingDate: Date,
    rawIdempotencyKey?: string,
    republicationOfId?: string,
    republicationReason?: string,
    republicationAuthorityDocumentVersionId?: string,
  ): Promise<VacancyPublicationSummary> {
    const previous = await this.idempotentEvent(
      transaction,
      context,
      'VACANCY_PUBLICATION_CREATED',
      rawIdempotencyKey,
    );
    if (previous) {
      const existing = await this.requirePublication(
        transaction,
        context.agencyId,
        previous.entityId,
      );
      if (
        existing.requestToFillId !== input.requestToFillId ||
        existing.approvalRouteVersionId !== approvalRouteVersionId ||
        existing.formDocumentVersionId !== input.formDocumentVersionId ||
        existing.openingDate.getTime() !== openingDate.getTime() ||
        existing.closingDate.getTime() !== closingDate.getTime() ||
        existing.republicationOfId !== (republicationOfId ?? null) ||
        existing.republicationReason !== (republicationReason ?? null) ||
        existing.republicationAuthorityDocumentVersionId !==
          (republicationAuthorityDocumentVersionId ?? null)
      ) {
        throw this.idempotencyConflict();
      }
      return publicationSummary(existing);
    }
    const lockedRequest = await this.lockRequest(
      transaction,
      context.agencyId,
      input.requestToFillId,
    );
    if (!lockedRequest) throw this.notFound('Request to Fill');
    if (lockedRequest.status !== 'APPROVED')
      throw this.workflowError('create publication', lockedRequest.status);
    const request = requestSummary(lockedRequest);
    const boundRoute = request.routeBindings.find(
      (binding) =>
        binding.checkpointCode === 'VACANCY_PUBLICATION' &&
        binding.bindingSetNo === request.governingConfiguration.bindingSetNo &&
        binding.routeVersionId === approvalRouteVersionId,
    );
    if (!boundRoute)
      throw new RecruitmentServiceError(
        'The approved Request to Fill has no bound publication Approval Route.',
        409,
        'RECRUITMENT_APPROVAL_ROUTE_INVALID',
      );
    if (!republicationOfId) {
      const prior = await transaction.vacancyPublication.findFirst({
        where: { agencyId: context.agencyId, requestToFillId: input.requestToFillId },
        orderBy: { createdAt: 'desc' },
        select: { status: true },
      });
      if (prior) {
        throw new RecruitmentServiceError(
          prior.status === 'DRAFT' ||
            prior.status === 'FOR_APPROVAL' ||
            prior.status === 'PUBLISHED'
            ? 'This Request to Fill already has an active Vacancy Publication.'
            : 'A new Vacancy Publication must be created through the linked republication flow.',
          409,
          prior.status === 'DRAFT' ||
            prior.status === 'FOR_APPROVAL' ||
            prior.status === 'PUBLISHED'
            ? 'RECRUITMENT_ACTIVE_PUBLICATION'
            : 'RECRUITMENT_REPUBLICATION_REQUIRED',
        );
      }
    }
    let record: { id: string };
    try {
      record = await transaction.vacancyPublication.create({
        data: {
          agencyId: context.agencyId,
          requestToFillId: input.requestToFillId,
          qualificationStandardVersionId: request.qualificationStandard.id,
          formDocumentVersionId: input.formDocumentVersionId,
          approvalRouteVersionId,
          openingDate,
          closingDate,
          channels: inputJson(input.channels),
          positionDetails: inputJson(
            Object.keys(input.positionDetails).length
              ? input.positionDetails
              : {
                  positionId: request.position.id,
                  itemNumber: request.position.itemNumber,
                  title: request.position.title,
                  salaryGrade: request.position.salaryGrade,
                  qualificationStandardVersionId: request.qualificationStandard.id,
                },
          ),
          applicationRequirements: inputJson(input.applicationRequirements),
          contactDetails: inputJson(input.contactDetails),
          ...(input.hrmoCertification
            ? { hrmoCertification: inputJson(input.hrmoCertification) }
            : {}),
          ...(republicationOfId ? { republicationOfId } : {}),
          ...(republicationReason ? { republicationReason } : {}),
          ...(republicationAuthorityDocumentVersionId
            ? { republicationAuthorityDocumentVersionId }
            : {}),
          status: 'DRAFT',
          createdByMembershipId: context.membershipId,
          updatedByMembershipId: context.membershipId,
        },
        select: { id: true },
      });
    } catch (error) {
      if (isKnownPrismaError(error, 'P2002')) throw this.activePublicationConflict();
      throw error;
    }
    if (input.evidence?.length) {
      this.assertUniquePublicationEvidence(input.evidence);
      await transaction.vacancyPublicationEvidence.createMany({
        data: input.evidence.map((evidence) => ({
          agencyId: context.agencyId,
          publicationId: record.id,
          channelType: evidence.channelType,
          location: evidence.location,
          reference: evidence.reference ?? null,
          publishedAt: new Date(evidence.publishedAt),
          evidenceDocumentVersionId: evidence.evidenceDocumentVersionId,
          createdByMembershipId: context.membershipId,
        })),
      });
    }
    await this.writeAudit(transaction, context, {
      action: 'VACANCY_PUBLICATION_CREATED',
      entityType: 'VacancyPublication',
      entityId: record.id,
      previousStatus: null,
      newStatus: 'DRAFT',
      reason: republicationOfId
        ? 'Draft Vacancy Publication created as a linked republication.'
        : 'Draft Vacancy Publication created from an approved Request to Fill.',
      metadata: safeAuditMetadata({
        requestToFillId: request.id,
        requestNo: request.requestNo,
        positionId: request.position.id,
        approvalRouteVersionId,
        ...(republicationOfId ? { republicationOfId } : {}),
      }),
      idempotencyKey: rawIdempotencyKey,
    });
    return publicationSummary(
      await this.requirePublication(transaction, context.agencyId, record.id),
    );
  }

  private async requireVacancy(
    context: RequestContext,
    positionId: string,
  ): Promise<Extract<RecruitableVacancyResolution, { eligible: true }>> {
    const result = await this.plantillaPositions.resolveRecruitableVacancy(
      context,
      positionId,
      manilaToday(),
    );
    if (!result) throw this.notFound('Plantilla Position');
    if (!result.eligible) {
      throw new RecruitmentServiceError(
        `The Plantilla Position is not a Recruitable Vacancy (${result.reason}).`,
        409,
        `RECRUITMENT_${result.reason}`,
      );
    }
    return result;
  }

  private async requireVacancyInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    positionId: string,
  ): Promise<Extract<RecruitableVacancyResolution, { eligible: true }>> {
    this.assertPositionReadPermission(context);
    const result = await this.plantillaPositions.resolveRecruitableVacancyInTransaction(
      transaction,
      context,
      positionId,
      manilaToday(),
    );
    if (!result) throw this.notFound('Plantilla Position');
    if (!result.eligible) {
      throw new RecruitmentServiceError(
        `The Plantilla Position is not a Recruitable Vacancy (${result.reason}).`,
        409,
        `RECRUITMENT_${result.reason}`,
      );
    }
    return result;
  }

  private assertPositionReadPermission(context: RequestContext): void {
    if (!hasPermission(context, 'positions.items.read', { agencyId: context.agencyId })) {
      throw new RecruitmentServiceError(
        'The current Agency Membership lacks Plantilla Position read permission.',
        403,
        'PLANTILLA_POSITION_READ_FORBIDDEN',
      );
    }
  }

  private async requireApprovedRequest(
    context: RequestContext,
    requestId: string,
  ): Promise<RequestToFillSummary> {
    const request = await this.findRequestForCommand(context, requestId);
    if (!request) throw this.notFound('Request to Fill');
    if (request.status !== 'APPROVED')
      throw this.workflowError('create publication', request.status);
    return request;
  }

  private assertRequestVacancyUnchanged(
    request: RequestToFillSummary,
    vacancy: Extract<RecruitableVacancyResolution, { eligible: true }>,
  ): void {
    if (
      request.position.organizationUnitId !== vacancy.organizationUnitId ||
      request.qualificationStandard.id !== vacancy.qualificationStandardVersionId
    ) {
      throw new RecruitmentServiceError(
        'The Plantilla Position changed after the Request to Fill was prepared.',
        409,
        'RECRUITMENT_POSITION_CHANGED',
      );
    }
  }

  private async findRequestForCommand(
    context: RequestContext,
    requestId: string,
  ): Promise<RequestToFillSummary | null> {
    const record = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      transaction.requestToFill.findFirst({
        where: { agencyId: context.agencyId, id: requestId },
        select: requestSelect,
      }),
    );
    return record ? requestSummary(record) : null;
  }

  private async requireCommandRequest(
    context: RequestContext,
    requestId: string,
  ): Promise<RequestToFillSummary> {
    const record = await this.findRequestForCommand(context, requestId);
    if (!record) throw this.notFound('Request to Fill');
    return record;
  }

  private async findPublicationForCommand(
    context: RequestContext,
    publicationId: string,
  ): Promise<VacancyPublicationSummary | null> {
    const record = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      transaction.vacancyPublication.findFirst({
        where: { agencyId: context.agencyId, id: publicationId },
        select: publicationSelect,
      }),
    );
    return record ? publicationSummary(record) : null;
  }

  private async requireCommandPublication(
    context: RequestContext,
    publicationId: string,
  ): Promise<VacancyPublicationSummary> {
    const record = await this.findPublicationForCommand(context, publicationId);
    if (!record) throw this.notFound('Vacancy Publication');
    return record;
  }

  private async resolveConfiguration(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    vacancy: Extract<RecruitableVacancyResolution, { eligible: true }>,
    asOfValue: string,
  ): Promise<{ planId: string; criteriaSetId: string; boardId: string }> {
    const asOf = date(asOfValue);
    const plans = await transaction.agencyMeritSelectionPlanVersion.findMany({
      where: {
        agencyId,
        status: 'ACTIVE',
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
      },
      select: {
        id: true,
        applicability: true,
        approvalDocumentVersionId: true,
      },
    });
    const applicablePlans = (
      await Promise.all(
        plans.map(async (plan) => {
          if (!plan.approvalDocumentVersionId || !matchesApplicability(plan.applicability, vacancy))
            return null;
          const approvalDocument = await this.documents.resolveFinalizedVersionInTransaction(
            transaction,
            { agencyId },
            plan.approvalDocumentVersionId,
          );
          return approvalDocument ? plan : null;
        }),
      )
    ).filter((plan): plan is (typeof plans)[number] => plan !== null);
    if (applicablePlans.length !== 1) {
      throw new RecruitmentServiceError(
        'Exactly one active applicable Agency MSP Version must resolve for the vacancy date.',
        409,
        'RECRUITMENT_MSP_RESOLUTION_FAILED',
      );
    }
    const plan = applicablePlans[0];
    if (!plan)
      throw new RecruitmentServiceError(
        'The applicable Agency MSP Version could not be resolved.',
        409,
        'RECRUITMENT_MSP_RESOLUTION_FAILED',
      );

    const criteriaSets = await transaction.meritSelectionCriteriaSet.findMany({
      where: { agencyId, planVersionId: plan.id, status: 'ACTIVE' },
      select: { id: true, applicability: true },
    });
    const applicableCriteria = criteriaSets.filter((criteria) =>
      matchesApplicability(criteria.applicability, vacancy),
    );
    if (applicableCriteria.length !== 1) {
      throw new RecruitmentServiceError(
        'Exactly one active applicable Merit Selection Criteria Set must resolve for the vacancy.',
        409,
        'RECRUITMENT_CRITERIA_RESOLUTION_FAILED',
      );
    }
    const criteria = applicableCriteria[0];
    if (!criteria)
      throw new RecruitmentServiceError(
        'The applicable Merit Selection Criteria Set could not be resolved.',
        409,
        'RECRUITMENT_CRITERIA_RESOLUTION_FAILED',
      );

    const boards = await transaction.boardDefinition.findMany({
      where: { agencyId, planVersionId: plan.id, status: 'ACTIVE' },
      select: { id: true, applicability: true, seatDefinition: true },
    });
    const applicableBoards = boards.filter((board) =>
      matchesApplicability(board.applicability, vacancy),
    );
    if (applicableBoards.length !== 1) {
      throw new RecruitmentServiceError(
        'Exactly one active applicable HRMPSB Board Definition must resolve for the vacancy.',
        409,
        'RECRUITMENT_BOARD_RESOLUTION_FAILED',
      );
    }
    const board = applicableBoards[0];
    if (!board)
      throw new RecruitmentServiceError(
        'The applicable HRMPSB Board Definition could not be resolved.',
        409,
        'RECRUITMENT_BOARD_RESOLUTION_FAILED',
      );
    const allSeats = boardSeatCodes(board.seatDefinition);
    const seats = requiredBoardSeats(board.seatDefinition);
    if (
      hasMalformedBoardSeatDefinition(board.seatDefinition) ||
      seats.length === 0 ||
      new Set(allSeats).size !== allSeats.length ||
      new Set(seats).size !== seats.length
    ) {
      throw new RecruitmentServiceError(
        'The HRMPSB Board Definition must contain unique required seats.',
        409,
        'RECRUITMENT_BOARD_INVALID',
      );
    }
    const appointments = await transaction.boardAppointment.findMany({
      where: {
        agencyId,
        boardDefinitionId: board.id,
        status: 'ACTIVE',
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
        membership: { status: 'ACTIVE' },
      },
      select: {
        seatCode: true,
        membershipId: true,
        appointmentKind: true,
        authorityDocumentVersionId: true,
      },
    });
    const resolvedAppointments = [] as typeof appointments;
    for (const seat of allSeats) {
      const matching = appointments.filter((appointment) => appointment.seatCode === seat);
      const principals = matching.filter(
        (appointment) => !isAlternateAppointmentKind(appointment.appointmentKind),
      );
      if (principals.length > 1 || (seats.includes(seat) && principals.length === 0)) {
        throw new RecruitmentServiceError(
          'Every required HRMPSB seat must resolve to exactly one principal appointment.',
          409,
          principals.length === 0
            ? 'RECRUITMENT_BOARD_APPOINTMENT_MISSING'
            : 'RECRUITMENT_BOARD_APPOINTMENT_AMBIGUOUS',
        );
      }
      resolvedAppointments.push(...principals);
      resolvedAppointments.push(
        ...matching.filter((appointment) =>
          isAlternateAppointmentKind(appointment.appointmentKind),
        ),
      );
    }
    if (
      new Set(resolvedAppointments.map((appointment) => appointment.membershipId)).size !==
      resolvedAppointments.length
    ) {
      throw new RecruitmentServiceError(
        'One HRMPSB member cannot occupy more than one seat.',
        409,
        'RECRUITMENT_BOARD_MEMBER_DUPLICATED',
      );
    }
    for (const appointment of resolvedAppointments) {
      if (
        !appointment.authorityDocumentVersionId ||
        !(await this.documents.resolveFinalizedVersionInTransaction(
          transaction,
          { agencyId },
          appointment.authorityDocumentVersionId,
        ))
      ) {
        throw new RecruitmentServiceError(
          'Every active HRMPSB appointment must have finalized authority evidence.',
          409,
          'RECRUITMENT_BOARD_APPOINTMENT_AUTHORITY_INVALID',
        );
      }
    }
    return { planId: plan.id, criteriaSetId: criteria.id, boardId: board.id };
  }

  private async validatePublicationForSubmission(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    record: Prisma.VacancyPublicationGetPayload<{ select: typeof publicationSelect }>,
    allowFrozenBindings: boolean,
  ): Promise<void> {
    const opening = record.openingDate;
    const closing = record.closingDate;
    if (dateDifferenceInDays(opening, closing) < 10)
      throw new RecruitmentServiceError(
        'A vacancy publication must remain open for at least ten calendar days.',
        409,
        'RECRUITMENT_PUBLICATION_MINIMUM_DAYS',
      );
    if (closing < date(manilaToday()))
      throw new RecruitmentServiceError(
        'A vacancy publication cannot be submitted after its closing date.',
        409,
        'RECRUITMENT_PUBLICATION_PERIOD_EXPIRED',
      );
    const maximumClosing = new Date(opening);
    maximumClosing.setUTCMonth(maximumClosing.getUTCMonth() + 9);
    if (closing > maximumClosing)
      throw new RecruitmentServiceError(
        'A vacancy publication cannot remain open longer than nine months.',
        409,
        'RECRUITMENT_PUBLICATION_MAXIMUM_DAYS',
      );
    const channels = Array.isArray(record.channels) ? record.channels : [];
    const requiredChannels = channels.flatMap((channel) => {
      if (typeof channel !== 'object' || channel === null || Array.isArray(channel)) return [];
      const value = channel as Record<string, Prisma.JsonValue>;
      const type = value.type;
      const location = value.location;
      return typeof type === 'string' &&
        typeof location === 'string' &&
        ['CSC_FIELD_OFFICE', 'CSC_JOB_PORTAL', 'AGENCY_POSTING_PLACE'].includes(type)
        ? [{ type, location }]
        : [];
    });
    const channelTypes = requiredChannels.map(({ type }) => type);
    const channelKeys = requiredChannels.map(({ type, location }) => `${type}:${location}`);
    if (
      channelTypes.filter((type) => type === 'CSC_FIELD_OFFICE').length !== 1 ||
      channelTypes.filter((type) => type === 'CSC_JOB_PORTAL').length !== 1 ||
      channelTypes.filter((type) => type === 'AGENCY_POSTING_PLACE').length < 3 ||
      new Set(channelKeys).size !== channelKeys.length ||
      new Set(
        requiredChannels
          .filter(({ type }) => type === 'AGENCY_POSTING_PLACE')
          .map(({ location }) => location),
      ).size < 3
    ) {
      throw new RecruitmentServiceError(
        'The publication must include the CSC Field Office, CSC Job Portal, and at least three agency posting places.',
        409,
        'RECRUITMENT_PUBLICATION_CHANNELS_INCOMPLETE',
      );
    }
    const evidence = await transaction.vacancyPublicationEvidence.findMany({
      where: { agencyId: context.agencyId, publicationId: record.id },
      select: {
        channelType: true,
        location: true,
        evidenceDocumentVersionId: true,
        publishedAt: true,
        removedAt: true,
      },
    });
    const requiredChannelKeySet = new Set(channelKeys);
    if (
      evidence.some(
        (item) =>
          ['CSC_FIELD_OFFICE', 'CSC_JOB_PORTAL', 'AGENCY_POSTING_PLACE'].includes(
            item.channelType,
          ) && !requiredChannelKeySet.has(`${item.channelType}:${item.location}`),
      )
    ) {
      throw new RecruitmentServiceError(
        'Publication evidence must match a declared posting channel exactly.',
        409,
        'RECRUITMENT_PUBLICATION_EVIDENCE_INCOMPLETE',
      );
    }
    for (const channel of requiredChannels) {
      const matching = evidence.filter(
        (item) =>
          item.channelType === channel.type &&
          item.location === channel.location &&
          !item.removedAt,
      );
      if (matching.length !== 1 || !matching[0]?.evidenceDocumentVersionId)
        throw new RecruitmentServiceError(
          'Every required publication channel needs one finalized evidence document at its declared location.',
          409,
          'RECRUITMENT_PUBLICATION_EVIDENCE_INCOMPLETE',
        );
    }
    const form = await this.requireFinalizedDocumentVersion(
      transaction,
      context,
      record.formDocumentVersionId,
      'RECRUITMENT_FORM_NO_9_INVALID',
    );
    if (!isCsFormNo9(form.documentType))
      throw new RecruitmentServiceError(
        'The exact finalized CS Form No. 9 Document Version is required before publication approval.',
        409,
        'RECRUITMENT_FORM_NO_9_INVALID',
      );
    const openingStart = manilaDayStart(opening);
    const closingExclusive = manilaDayEnd(closing);
    for (const item of evidence) {
      if (item.publishedAt < openingStart || item.publishedAt >= closingExclusive) {
        throw new RecruitmentServiceError(
          'Every publication evidence timestamp must fall within the declared posting period.',
          409,
          'RECRUITMENT_PUBLICATION_EVIDENCE_DATE_INVALID',
        );
      }
      if (
        (item.removedAt && item.removedAt < item.publishedAt) ||
        (item.removedAt && item.removedAt < closingExclusive)
      ) {
        throw new RecruitmentServiceError(
          'Every required publication channel must remain posted through the declared closing date.',
          409,
          'RECRUITMENT_PUBLICATION_EVIDENCE_DATE_INVALID',
        );
      }
      if (item.evidenceDocumentVersionId) {
        await this.requireFinalizedDocumentVersion(
          transaction,
          context,
          item.evidenceDocumentVersionId,
          'RECRUITMENT_PUBLICATION_EVIDENCE_INVALID',
        );
      }
    }
    const contact = jsonObject(record.contactDetails);
    if (
      !contact ||
      typeof contact.name !== 'string' ||
      !contact.name.trim() ||
      typeof contact.email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())
    )
      throw new RecruitmentServiceError(
        'A named HR contact and contact email are required.',
        409,
        'RECRUITMENT_CONTACT_INVALID',
      );
    const certification = jsonObject(record.hrmoCertification ?? null);
    if (
      !certification ||
      typeof certification.certifier !== 'string' ||
      !certification.certifier.trim() ||
      typeof certification.statement !== 'string' ||
      !certification.statement.trim()
    )
      throw new RecruitmentServiceError(
        'HRMO certification is required before publication approval.',
        409,
        'RECRUITMENT_CERTIFICATION_REQUIRED',
      );
    const request = await transaction.requestToFill.findFirst({
      where: { agencyId: context.agencyId, id: record.requestToFillId },
      select: {
        status: true,
        bindingSetNo: true,
        bindingFrozenAt: true,
        positionId: true,
        requestingUnitId: true,
        qualificationStandardVersionId: true,
        mspPlanVersionId: true,
        criteriaSetId: true,
        boardDefinitionId: true,
      },
    });
    if (
      !request ||
      request.status !== 'APPROVED' ||
      (!allowFrozenBindings && request.bindingFrozenAt)
    )
      throw new RecruitmentServiceError(
        'The Request to Fill bindings are not available for this publication.',
        409,
        'RECRUITMENT_REQUEST_BINDING_INVALID',
      );
    const vacancy = await this.plantillaPositions.resolveRecruitableVacancyInTransaction(
      transaction,
      context,
      request.positionId,
      formatDate(opening),
    );
    if (!vacancy || !vacancy.eligible) {
      throw new RecruitmentServiceError(
        'The Plantilla Position is no longer a Recruitable Vacancy for the publication opening date.',
        409,
        'RECRUITMENT_POSITION_NOT_RECRUITABLE',
      );
    }
    if (
      vacancy.organizationUnitId !== request.requestingUnitId ||
      vacancy.qualificationStandardVersionId !== request.qualificationStandardVersionId
    ) {
      throw new RecruitmentServiceError(
        'The Plantilla Position changed after the Request to Fill was approved.',
        409,
        'RECRUITMENT_POSITION_CHANGED',
      );
    }
    const configuration = await this.resolveConfiguration(
      transaction,
      context.agencyId,
      vacancy,
      formatDate(opening),
    );
    if (
      configuration.planId !== request.mspPlanVersionId ||
      configuration.criteriaSetId !== request.criteriaSetId ||
      configuration.boardId !== request.boardDefinitionId
    ) {
      throw new RecruitmentServiceError(
        'The governing Recruitment configuration changed after the Request to Fill was approved.',
        409,
        'RECRUITMENT_GOVERNING_CONFIGURATION_CHANGED',
      );
    }
    const positionDetails = jsonObject(record.positionDetails);
    if (
      !positionDetails ||
      positionDetails.positionId !== request.positionId ||
      positionDetails.itemNumber !== record.request.position.itemNumber ||
      positionDetails.title !== record.request.position.currentVersion?.positionTitle ||
      positionDetails.salaryGrade !== record.request.position.currentVersion?.salaryGrade ||
      positionDetails.qualificationStandardVersionId !== request.qualificationStandardVersionId
    )
      throw new RecruitmentServiceError(
        'The publication position details must match the approved Request to Fill and bound Qualification Standard Version.',
        409,
        'RECRUITMENT_POSITION_DETAILS_INVALID',
      );
    const binding = await transaction.requestApprovalRouteBinding.findFirst({
      where: {
        agencyId: context.agencyId,
        requestToFillId: record.requestToFillId,
        bindingSetNo: request.bindingSetNo,
        checkpointCode: 'VACANCY_PUBLICATION',
        approvalRouteVersionId: record.approvalRouteVersionId,
      },
      select: { id: true },
    });
    if (!binding)
      throw new RecruitmentServiceError(
        'The publication Approval Route is not the bound route for the approved Request to Fill.',
        409,
        'RECRUITMENT_APPROVAL_ROUTE_INVALID',
      );
  }

  private async completeRequest(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    request: ApprovalCompletionRequest,
  ): Promise<void> {
    await this.enableRecruitmentTransition(transaction, context);
    const current = await transaction.requestToFill.findFirst({
      where: { agencyId: context.agencyId, id: request.subjectId },
      select: {
        id: true,
        status: true,
        approvalRequestId: true,
        positionId: true,
        bindingSetNo: true,
      },
    });
    if (!current) throw this.notFound('Request to Fill');
    if (current.approvalRequestId !== request.approvalRequestId || current.status !== 'FOR_REVIEW')
      throw new RecruitmentServiceError(
        'The Request to Fill is not ready for Approval completion.',
        409,
        'RECRUITMENT_COMPLETION_INVALID',
      );
    const binding = await transaction.requestApprovalRouteBinding.findFirst({
      where: {
        agencyId: context.agencyId,
        requestToFillId: request.subjectId,
        bindingSetNo: current.bindingSetNo,
        checkpointCode: 'REQUEST_TO_FILL_REVIEW',
        approvalRouteVersionId: request.routeVersionId,
      },
      select: { id: true },
    });
    if (!binding)
      throw new RecruitmentServiceError(
        'The completed Approval Request is not the bound Request to Fill route.',
        409,
        'RECRUITMENT_APPROVAL_ROUTE_INVALID',
      );
    await transaction.requestToFill.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: request.subjectId } },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        updatedByMembershipId: context.membershipId,
        rowVersion: { increment: 1 },
      },
    });
    await this.writeAudit(transaction, context, {
      action: 'REQUEST_TO_FILL_APPROVED',
      entityType: 'RequestToFill',
      entityId: request.subjectId,
      previousStatus: 'FOR_REVIEW',
      newStatus: 'APPROVED',
      reason: 'The bound Approval Route completed successfully.',
      metadata: safeAuditMetadata({
        approvalRequestId: request.approvalRequestId,
        positionId: current.positionId,
      }),
      idempotencyKey: null,
    });
  }

  private async decideRequest(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    request: ApprovalCompletionRequest,
    outcome: 'RETURNED' | 'REJECTED',
  ): Promise<void> {
    await this.enableRecruitmentTransition(transaction, context);
    const current = await transaction.requestToFill.findFirst({
      where: { agencyId: context.agencyId, id: request.subjectId },
      select: { id: true, status: true, approvalRequestId: true },
    });
    if (!current || current.approvalRequestId !== request.approvalRequestId) return;
    const status = outcome === 'RETURNED' ? 'SUBMITTED' : 'REJECTED';
    await transaction.requestToFill.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: request.subjectId } },
      data: {
        status,
        approvalRequestId: null,
        updatedByMembershipId: context.membershipId,
        rowVersion: { increment: 1 },
      },
    });
    await this.writeAudit(transaction, context, {
      action: `REQUEST_TO_FILL_${outcome}`,
      entityType: 'RequestToFill',
      entityId: request.subjectId,
      previousStatus: current.status,
      newStatus: status,
      reason: `Approval Request was ${outcome.toLowerCase()}.`,
      metadata: safeAuditMetadata({ approvalRequestId: request.approvalRequestId }),
      idempotencyKey: null,
    });
  }

  private async completePublication(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    request: ApprovalCompletionRequest,
  ): Promise<void> {
    await this.enableRecruitmentTransition(transaction, context);
    const candidate = await transaction.vacancyPublication.findFirst({
      where: { agencyId: context.agencyId, id: request.subjectId },
      select: { requestToFillId: true },
    });
    if (!candidate)
      throw new RecruitmentServiceError(
        'The Vacancy Publication is not ready for Approval completion.',
        409,
        'RECRUITMENT_COMPLETION_INVALID',
      );
    const requestRecord = await this.lockRequest(
      transaction,
      context.agencyId,
      candidate.requestToFillId,
    );
    if (!requestRecord || requestRecord.status !== 'APPROVED')
      throw new RecruitmentServiceError(
        'The approved Request to Fill is missing for this publication.',
        409,
        'RECRUITMENT_REQUEST_BINDING_INVALID',
      );
    const current = await this.lockPublication(transaction, context.agencyId, request.subjectId);
    if (!current)
      throw new RecruitmentServiceError(
        'The Vacancy Publication is not ready for Approval completion.',
        409,
        'RECRUITMENT_COMPLETION_INVALID',
      );
    if (
      current.approvalRequestId !== request.approvalRequestId ||
      current.status !== 'FOR_APPROVAL'
    )
      throw new RecruitmentServiceError(
        'The Vacancy Publication is not ready for Approval completion.',
        409,
        'RECRUITMENT_COMPLETION_INVALID',
      );
    if (current.approvalRouteVersionId !== request.routeVersionId)
      throw new RecruitmentServiceError(
        'The completed Approval Request is not the bound Vacancy Publication route.',
        409,
        'RECRUITMENT_APPROVAL_ROUTE_INVALID',
      );
    await this.validatePublicationForSubmission(
      transaction,
      context,
      current,
      current.republicationOfId !== null,
    );
    const publishedAt = new Date();
    await transaction.vacancyPublication.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: request.subjectId } },
      data: {
        status: 'PUBLISHED',
        publishedAt,
        updatedByMembershipId: context.membershipId,
        rowVersion: { increment: 1 },
      },
    });
    if (!requestRecord.bindingFrozenAt) {
      await transaction.requestToFill.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: requestRecord.id } },
        data: {
          bindingFrozenAt: publishedAt,
          updatedByMembershipId: context.membershipId,
          rowVersion: { increment: 1 },
        },
      });
    }
    await this.writeAudit(transaction, context, {
      action: 'VACANCY_PUBLICATION_PUBLISHED',
      entityType: 'VacancyPublication',
      entityId: request.subjectId,
      previousStatus: 'FOR_APPROVAL',
      newStatus: 'PUBLISHED',
      reason: 'The bound Approval Route completed and publication evidence remained valid.',
      metadata: safeAuditMetadata({
        approvalRequestId: request.approvalRequestId,
        approvalRouteVersionId: request.routeVersionId,
      }),
      idempotencyKey: null,
    });
  }

  private async decidePublication(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    request: ApprovalCompletionRequest,
    outcome: 'RETURNED' | 'REJECTED',
  ): Promise<void> {
    await this.enableRecruitmentTransition(transaction, context);
    const current = await transaction.vacancyPublication.findFirst({
      where: { agencyId: context.agencyId, id: request.subjectId },
      select: { id: true, status: true, approvalRequestId: true },
    });
    if (!current || current.approvalRequestId !== request.approvalRequestId) return;
    await transaction.vacancyPublication.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: request.subjectId } },
      data: {
        status: 'DRAFT',
        approvalRequestId: null,
        updatedByMembershipId: context.membershipId,
        rowVersion: { increment: 1 },
      },
    });
    await this.writeAudit(transaction, context, {
      action: `VACANCY_PUBLICATION_${outcome}`,
      entityType: 'VacancyPublication',
      entityId: request.subjectId,
      previousStatus: current.status,
      newStatus: 'DRAFT',
      reason: `Approval Request was ${outcome.toLowerCase()}.`,
      metadata: safeAuditMetadata({ approvalRequestId: request.approvalRequestId }),
      idempotencyKey: null,
    });
  }

  private async transitionPublication(
    context: RequestContext,
    publicationId: string,
    status: 'CLOSED' | 'CANCELLED',
    reason: string,
    rawIdempotencyKey?: string,
    authorityDocumentVersionId?: string,
  ): Promise<void> {
    const normalizedReason = reason.trim();
    if (!normalizedReason)
      throw new RecruitmentServiceError(
        'A publication transition reason is required.',
        400,
        'RECRUITMENT_REASON_REQUIRED',
      );
    await withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const current = await this.lockPublication(transaction, context.agencyId, publicationId);
        if (!current) throw this.notFound('Vacancy Publication');
        if (status === 'CLOSED' && current.status !== 'PUBLISHED')
          throw this.workflowError('close', current.status);
        if (status === 'CANCELLED' && current.status !== 'PUBLISHED')
          throw this.workflowError('cancel', current.status);
        const earlyClosure = current.closingDate > date(manilaToday());
        if (status === 'CLOSED' && earlyClosure && !authorityDocumentVersionId) {
          throw new RecruitmentServiceError(
            'Early publication closure requires finalized authority evidence.',
            409,
            'RECRUITMENT_EARLY_CLOSURE_AUTHORITY_REQUIRED',
          );
        }
        if (status === 'CANCELLED' && !authorityDocumentVersionId) {
          throw new RecruitmentServiceError(
            'Publication cancellation requires finalized authority evidence.',
            409,
            'RECRUITMENT_CANCELLATION_AUTHORITY_REQUIRED',
          );
        }
        if (authorityDocumentVersionId) {
          await this.requireFinalizedDocumentVersion(
            transaction,
            context,
            authorityDocumentVersionId,
            status === 'CLOSED'
              ? 'RECRUITMENT_PUBLICATION_CLOSURE_AUTHORITY_INVALID'
              : 'RECRUITMENT_PUBLICATION_CANCELLATION_AUTHORITY_INVALID',
          );
        }
        await transaction.vacancyPublication.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: publicationId } },
          data: {
            status,
            closedAt: new Date(),
            closureReason: status === 'CLOSED' ? normalizedReason : null,
            closureAuthorityDocumentVersionId:
              status === 'CLOSED' ? (authorityDocumentVersionId ?? null) : null,
            cancellationReason: status === 'CANCELLED' ? normalizedReason : null,
            cancellationAuthorityDocumentVersionId:
              status === 'CANCELLED' ? (authorityDocumentVersionId ?? null) : null,
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: `VACANCY_PUBLICATION_${status}`,
          entityType: 'VacancyPublication',
          entityId: publicationId,
          previousStatus: current.status,
          newStatus: status,
          reason: normalizedReason,
          metadata: safeAuditMetadata({
            authorityDocumentVersionId,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
      },
    );
  }

  private async requireRequest(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    requestId: string,
  ): Promise<RequestRecord> {
    const record = await transaction.requestToFill.findUnique({
      where: { agencyId_id: { agencyId, id: requestId } },
      select: requestSelect,
    });
    if (!record) throw this.notFound('Request to Fill');
    return record;
  }

  private async lockRequest(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    requestId: string,
  ): Promise<RequestRecord | null> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "requests_to_fill" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${requestId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) return null;
    return this.requireRequest(transaction, agencyId, requestId);
  }

  private async requirePublication(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    publicationId: string,
  ): Promise<PublicationRecord> {
    const record = await transaction.vacancyPublication.findUnique({
      where: { agencyId_id: { agencyId, id: publicationId } },
      select: publicationSelect,
    });
    if (!record) throw this.notFound('Vacancy Publication');
    return record;
  }

  private async requirePublicationByLineage(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    publicationId: string,
  ): Promise<PublicationRecord | null> {
    return transaction.vacancyPublication.findFirst({
      where: { agencyId, republicationOfId: publicationId },
      orderBy: { createdAt: 'desc' },
      select: publicationSelect,
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

  private async lockPublication(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    publicationId: string,
  ): Promise<PublicationRecord | null> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "vacancy_publications" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${publicationId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) return null;
    return this.requirePublication(transaction, agencyId, publicationId);
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

  private async enableRecruitmentTransition(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
  ): Promise<void> {
    await setDatabaseContext(
      transaction,
      requestDatabaseContext(context, 'approval-transition', 'recruitment-transition'),
    );
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

  private activeRequestConflict(): RecruitmentServiceError {
    return new RecruitmentServiceError(
      'This Plantilla Position already has an active Request to Fill.',
      409,
      'RECRUITMENT_ACTIVE_REQUEST',
    );
  }

  private activePublicationConflict(): RecruitmentServiceError {
    return new RecruitmentServiceError(
      'This Request to Fill already has an active Vacancy Publication.',
      409,
      'RECRUITMENT_ACTIVE_PUBLICATION',
    );
  }

  private assertUniquePublicationEvidence(
    evidence: ReadonlyArray<{ channelType: string; location: string }>,
  ): void {
    const keys = evidence.map(({ channelType, location }) => `${channelType}:${location}`);
    if (new Set(keys).size !== keys.length) {
      throw new RecruitmentServiceError(
        'Each publication channel and location may have only one evidence record.',
        409,
        'RECRUITMENT_PUBLICATION_EVIDENCE_INCOMPLETE',
      );
    }
  }

  private idempotencyConflict(): RecruitmentServiceError {
    return new RecruitmentServiceError(
      'The Idempotency-Key was already used for a different Recruitment command.',
      409,
      'RECRUITMENT_IDEMPOTENCY_CONFLICT',
    );
  }
}
