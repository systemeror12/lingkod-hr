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
      evidenceDocumentVersionId: evidence.evidenceDocumentVersionId,
    })),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function safeAuditMetadata(value: Prisma.InputJsonObject): Prisma.InputJsonObject {
  const allowed = new Set([
    'requestNo',
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
    return typeof item.seatCode === 'string' && item.required !== false ? [item.seatCode] : [];
  });
}

function isCsFormNo9(documentType: string): boolean {
  const normalized = documentType
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  return /^CS FORM (?:NO |NUMBER )?9$/.test(normalized);
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
    const vacancy = await this.requireVacancy(context, input.positionId);
    if (input.requestingUnitId !== vacancy.organizationUnitId) {
      throw new RecruitmentServiceError(
        'The requesting office must own the Plantilla Position vacancy.',
        403,
        'RECRUITMENT_REQUESTING_UNIT_FORBIDDEN',
      );
    }
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
        const record = await transaction.requestToFill.create({
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
    const vacancy = await this.requireRequestVacancy(context, requestId);
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
    const existing = await this.findRequestForCommand(context, requestId);
    if (!existing) throw this.notFound('Request to Fill');
    if (existing.status === 'FOR_REVIEW' && existing.approvalRequestId) return existing;
    if (existing.status !== 'SUBMITTED') throw this.workflowError('review', existing.status);
    const vacancy = await this.requireVacancy(context, existing.position.id);
    const asOf = manilaToday();
    const configuration = await withDatabaseContext(
      requestDatabaseContext(context),
      (transaction) => this.resolveConfiguration(transaction, context.agencyId, vacancy, asOf),
    );
    this.assertRequestVacancyUnchanged(existing, vacancy);
    const requestRoute = await this.approvals.resolveActiveRoute(
      context,
      REQUEST_TO_FILL_ROUTE_CODE,
      asOf,
    );
    const publicationRoute = await this.approvals.resolveActiveRoute(
      context,
      VACANCY_PUBLICATION_ROUTE_CODE,
      asOf,
    );
    const approval = await this.approvals.createRequest(
      context,
      {
        routeCode: REQUEST_TO_FILL_ROUTE_CODE,
        subjectType: 'REQUEST_TO_FILL',
        subjectId: requestId,
        effectiveDate: asOf,
      },
      rawIdempotencyKey ? `${rawIdempotencyKey}:approval-create` : undefined,
    );
    await this.approvals.submit(
      context,
      approval.id,
      rawIdempotencyKey ? `${rawIdempotencyKey}:approval-submit` : undefined,
    );
    return withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const current = await this.lockRequest(transaction, context.agencyId, requestId);
        if (!current) throw this.notFound('Request to Fill');
        if (current.status === 'FOR_REVIEW' && current.approvalRequestId === approval.id)
          return requestSummary(current);
        if (current.status !== 'SUBMITTED') throw this.workflowError('review', current.status);
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
    const current = await this.requireCommandRequest(context, requestId);
    if (current.status !== 'FOR_REVIEW') throw this.workflowError('rebaseline', current.status);
    if (!current.approvalRequestId || current.governingConfiguration.frozenAt) {
      throw new RecruitmentServiceError(
        'Only an unfrozen Request to Fill under active review can be rebaselined.',
        409,
        'RECRUITMENT_REBASELINE_NOT_ALLOWED',
      );
    }
    const vacancy = await this.requireVacancy(context, current.position.id);
    const asOf = manilaToday();
    const configuration = await withDatabaseContext(
      requestDatabaseContext(context),
      (transaction) => this.resolveConfiguration(transaction, context.agencyId, vacancy, asOf),
    );
    this.assertRequestVacancyUnchanged(current, vacancy);
    const requestRoute = await this.approvals.resolveActiveRoute(
      context,
      REQUEST_TO_FILL_ROUTE_CODE,
      asOf,
    );
    const publicationRoute = await this.approvals.resolveActiveRoute(
      context,
      VACANCY_PUBLICATION_ROUTE_CODE,
      asOf,
    );
    if (
      configuration.planId === current.governingConfiguration.mspPlanVersionId &&
      configuration.criteriaSetId === current.governingConfiguration.criteriaSetId &&
      configuration.boardId === current.governingConfiguration.boardDefinitionId
    ) {
      throw new RecruitmentServiceError(
        'The replacement governing configuration must differ from the bound configuration.',
        409,
        'RECRUITMENT_REBASELINE_UNCHANGED',
      );
    }
    return withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const locked = await this.lockRequest(transaction, context.agencyId, requestId);
        if (!locked) throw this.notFound('Request to Fill');
        if (locked.status !== 'FOR_REVIEW' || !locked.approvalRequestId || locked.bindingFrozenAt) {
          throw this.workflowError('rebaseline', locked.status);
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
    const current = await this.requireCommandRequest(context, requestId);
    if (!['DRAFT', 'SUBMITTED'].includes(current.status))
      throw this.workflowError('cancel', current.status);
    await withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const locked = await this.lockRequest(transaction, context.agencyId, requestId);
        if (!locked || ['CANCELLED', 'CLOSED', 'REJECTED'].includes(locked.status)) return;
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
          reason: reason.trim(),
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
          request,
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
    const request = await this.requireApprovedRequest(
      context,
      (await this.requireCommandPublication(context, publicationId)).requestToFillId,
    );
    return withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
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
    const route = await this.approvals.resolveActiveRoute(
      context,
      VACANCY_PUBLICATION_ROUTE_CODE,
      current.openingDate,
    );
    if (route.id !== current.approvalRouteVersionId)
      throw new RecruitmentServiceError(
        'The bound publication Approval Route is no longer the exact active route for the opening date.',
        409,
        'RECRUITMENT_APPROVAL_ROUTE_CHANGED',
      );
    await withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const locked = await this.lockPublication(transaction, context.agencyId, publicationId);
        if (!locked) throw this.notFound('Vacancy Publication');
        await this.validatePublicationForSubmission(
          transaction,
          context,
          locked,
          locked.republicationOfId !== null,
        );
      },
    );
    const approval = await this.approvals.createRequest(
      context,
      {
        routeCode: VACANCY_PUBLICATION_ROUTE_CODE,
        subjectType: 'VACANCY_PUBLICATION',
        subjectId: publicationId,
        effectiveDate: current.openingDate,
      },
      rawIdempotencyKey ? `${rawIdempotencyKey}:approval-create` : undefined,
    );
    await this.approvals.submit(
      context,
      approval.id,
      rawIdempotencyKey ? `${rawIdempotencyKey}:approval-submit` : undefined,
    );
    await withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const locked = await this.lockPublication(transaction, context.agencyId, publicationId);
        if (!locked) throw this.notFound('Vacancy Publication');
        if (locked.status === 'FOR_APPROVAL' && locked.approvalRequestId === approval.id) return;
        if (locked.status !== 'DRAFT') throw this.workflowError('submit', locked.status);
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
    if (input.requestToFillId !== source.requestToFillId)
      throw new RecruitmentServiceError(
        'A republication must retain the original Request to Fill.',
        400,
        'RECRUITMENT_REPUBLICATION_REQUEST_INVALID',
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
          request,
          routeBinding.routeVersionId,
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
    request: RequestToFillSummary,
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
    if (previous)
      return publicationSummary(
        await this.requirePublication(transaction, context.agencyId, previous.entityId),
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
    const record = await transaction.vacancyPublication.create({
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
    if (input.evidence?.length) {
      await transaction.vacancyPublicationEvidence.createMany({
        data: input.evidence.map((evidence) => ({
          agencyId: context.agencyId,
          publicationId: record.id,
          channelType: evidence.channelType,
          location: evidence.location,
          reference: evidence.reference ?? null,
          publishedAt: new Date(evidence.publishedAt),
          evidenceDocumentVersionId: evidence.evidenceDocumentVersionId ?? null,
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

  private async requireRequestVacancy(
    context: RequestContext,
    requestId: string,
  ): Promise<Extract<RecruitableVacancyResolution, { eligible: true }>> {
    const request = await this.findRequestForCommand(context, requestId);
    if (!request) throw this.notFound('Request to Fill');
    return this.requireVacancy(context, request.position.id);
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
    const seats = requiredBoardSeats(board.seatDefinition);
    if (seats.length === 0) {
      throw new RecruitmentServiceError(
        'The HRMPSB Board Definition has no valid required seats.',
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
      select: { seatCode: true },
    });
    for (const seat of seats) {
      const count = appointments.filter((appointment) => appointment.seatCode === seat).length;
      if (count !== 1) {
        throw new RecruitmentServiceError(
          'Every required HRMPSB seat must resolve to exactly one active appointment.',
          409,
          count === 0
            ? 'RECRUITMENT_BOARD_APPOINTMENT_MISSING'
            : 'RECRUITMENT_BOARD_APPOINTMENT_AMBIGUOUS',
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
      },
    });
    for (const channel of requiredChannels) {
      if (
        evidence.filter(
          (item) =>
            item.channelType === channel.type &&
            item.location === channel.location &&
            item.evidenceDocumentVersionId,
        ).length !== 1
      )
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
    for (const item of evidence) {
      const closingExclusive = new Date(closing);
      closingExclusive.setUTCDate(closingExclusive.getUTCDate() + 1);
      if (item.publishedAt < opening || item.publishedAt >= closingExclusive) {
        throw new RecruitmentServiceError(
          'Every publication evidence timestamp must fall within the declared posting period.',
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
    const current = await transaction.vacancyPublication.findFirst({
      where: { agencyId: context.agencyId, id: request.subjectId },
      select: publicationSelect,
    });
    if (
      !current ||
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
    const requestRecord = await transaction.requestToFill.findFirst({
      where: { agencyId: context.agencyId, id: current.requestToFillId, status: 'APPROVED' },
      select: { id: true, bindingFrozenAt: true },
    });
    if (!requestRecord)
      throw new RecruitmentServiceError(
        'The approved Request to Fill is missing for this publication.',
        409,
        'RECRUITMENT_REQUEST_BINDING_INVALID',
      );
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

  private idempotencyConflict(): RecruitmentServiceError {
    return new RecruitmentServiceError(
      'The Idempotency-Key was already used for a different Recruitment command.',
      409,
      'RECRUITMENT_IDEMPOTENCY_CONFLICT',
    );
  }
}
