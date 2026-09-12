import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import {
  PlantillaPositionsService,
  PlantillaPositionServiceError,
} from '../plantilla-positions/plantilla-positions.service';
import { RecruitmentServiceError } from './recruitment.service';
import { SELECTION_DECISION_VALUES, type SelectionDecisionValue } from './deliberations.schemas';

type SelectionDecisionInput = {
  decision: SelectionDecisionValue;
  reason: string;
  authorityDocumentVersionId?: string | undefined;
};

type SelectionDecisionListInput = {
  applicationId?: string | undefined;
  sessionId?: string | undefined;
  decision?: SelectionDecisionValue | undefined;
  limit: number;
  offset: number;
};

const decisionSelect = {
  id: true,
  agencyId: true,
  applicationId: true,
  sessionId: true,
  boardRecommendationId: true,
  decision: true,
  reason: true,
  authorityDocumentVersionId: true,
  decidedByMembershipId: true,
  decidedAt: true,
  application: {
    select: {
      id: true,
      applicationNo: true,
      status: true,
      applicant: {
        select: { firstName: true, middleName: true, lastName: true, suffix: true },
      },
      publication: {
        select: {
          id: true,
          publicationNo: true,
          requestToFillId: true,
          request: {
            select: {
              requestNo: true,
              position: {
                select: {
                  id: true,
                  itemNumber: true,
                  currentVersion: {
                    select: {
                      positionTitle: true,
                      salaryGrade: true,
                      organizationUnitId: true,
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
  session: {
    select: {
      id: true,
      sessionDate: true,
      status: true,
      boardDefinition: { select: { boardCode: true, versionNo: true } },
      reportVersions: {
        orderBy: { versionNo: 'desc' as const },
        take: 1,
        select: { id: true, versionNo: true, reportDocumentVersionId: true },
      },
    },
  },
  boardRecommendation: {
    select: {
      id: true,
      recommendation: true,
      rankNo: true,
      compositeScore: true,
      reason: true,
    },
  },
  handoff: {
    select: {
      id: true,
      positionId: true,
      selectionPackage: true,
      handedOffAt: true,
      acceptedAt: true,
      position: { select: { itemNumber: true } },
    },
  },
} as const;

type DecisionRecord = Prisma.SelectionDecisionGetPayload<{ select: typeof decisionSelect }>;

const applicationSelect = {
  id: true,
  applicationNo: true,
  status: true,
  agencyId: true,
  vacancyPublicationId: true,
  qualificationStandardVersionId: true,
  applicant: {
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      suffix: true,
      emailNormalized: true,
      mobileNumber: true,
    },
  },
  documents: {
    select: {
      id: true,
      documentId: true,
      documentVersionId: true,
      purpose: true,
      document: { select: { documentType: true } },
    },
  },
  publication: {
    select: {
      id: true,
      publicationNo: true,
      requestToFillId: true,
      qualificationStandardVersionId: true,
      request: {
        select: {
          requestNo: true,
          mspPlanVersionId: true,
          criteriaSetId: true,
          boardDefinitionId: true,
          position: { select: { id: true, itemNumber: true } },
        },
      },
    },
  },
} as const;

type SelectionApplicationRecord = Prisma.ApplicationGetPayload<{
  select: typeof applicationSelect;
}>;

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

function fullName(person: {
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
}): string {
  return [person.firstName, person.middleName?.trim(), person.lastName, person.suffix?.trim()]
    .filter(Boolean)
    .join(' ');
}

function selectionDecision(value: string): SelectionDecisionValue {
  if (SELECTION_DECISION_VALUES.includes(value as SelectionDecisionValue)) {
    return value as SelectionDecisionValue;
  }
  throw new RecruitmentServiceError(
    'The stored Selection Decision is invalid.',
    500,
    'RECRUITMENT_DATA_INVALID',
  );
}

function jsonObject(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, Prisma.JsonValue>;
}

function safeSelectionAuditMetadata(value: Prisma.InputJsonObject): Prisma.InputJsonObject {
  const allowed = new Set([
    'selectionDecisionId',
    'applicationId',
    'sessionId',
    'recommendationId',
    'decision',
    'authorityDocumentVersionId',
    'handoffId',
    'positionId',
    'positionVersionId',
  ]);
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => allowed.has(key)),
  ) as Prisma.InputJsonObject;
}

export function selectionDecisionSummary(record: DecisionRecord) {
  const version = record.application.publication.request.position.currentVersion;
  return {
    id: record.id,
    applicationId: record.applicationId,
    applicationNo: `APP-${String(record.application.applicationNo).padStart(6, '0')}`,
    applicantName: fullName(record.application.applicant),
    applicationStatus: record.application.status,
    decision: selectionDecision(record.decision),
    reason: record.reason,
    authorityDocumentVersionId: record.authorityDocumentVersionId,
    decidedByMembershipId: record.decidedByMembershipId,
    decidedAt: record.decidedAt.toISOString(),
    sessionId: record.sessionId,
    sessionStatus: record.session.status,
    boardDefinitionCode: record.session.boardDefinition.boardCode,
    boardDefinitionVersionNo: record.session.boardDefinition.versionNo,
    boardRecommendation: {
      id: record.boardRecommendation.id,
      recommendation: record.boardRecommendation.recommendation,
      rankNo: record.boardRecommendation.rankNo,
      compositeScore:
        record.boardRecommendation.compositeScore === null
          ? null
          : Number(record.boardRecommendation.compositeScore),
      reason: record.boardRecommendation.reason,
    },
    report: record.session.reportVersions[0]
      ? {
          id: record.session.reportVersions[0].id,
          versionNo: record.session.reportVersions[0].versionNo,
          reportDocumentVersionId: record.session.reportVersions[0].reportDocumentVersionId,
        }
      : null,
    position: {
      id: record.application.publication.request.position.id,
      itemNumber: record.application.publication.request.position.itemNumber,
      title: version?.positionTitle ?? null,
      salaryGrade: version?.salaryGrade ?? null,
      organizationUnitId: version?.organizationUnitId ?? null,
    },
    handoff: record.handoff
      ? {
          id: record.handoff.id,
          positionId: record.handoff.positionId,
          itemNumber: record.handoff.position.itemNumber,
          handedOffAt: record.handoff.handedOffAt.toISOString(),
          acceptedAt: record.handoff.acceptedAt?.toISOString() ?? null,
          selectionPackage: record.handoff.selectionPackage,
        }
      : null,
  };
}

export type SelectionDecisionSummary = ReturnType<typeof selectionDecisionSummary>;

export interface HandoffPackageSummary {
  handoffId: string;
  selectionDecisionId: string;
  applicationId: string;
  positionId: string;
  selectionPackage: Prisma.JsonValue;
  handedOffAt: Date;
  acceptedAt: Date | null;
}

@Injectable()
export class SelectionService {
  constructor(
    @Inject(PlantillaPositionsService)
    private readonly plantillaPositions: PlantillaPositionsService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
  ) {}

  async listDecisions(
    context: RequestContext,
    filter: SelectionDecisionListInput,
  ): Promise<{ items: SelectionDecisionSummary[]; hasMore: boolean; nextOffset: number | null }> {
    this.assertPermission(
      context,
      'recruitment.deliberations.read',
      'RECRUITMENT_SELECTION_READ_FORBIDDEN',
    );
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const records = await transaction.selectionDecision.findMany({
        where: {
          agencyId: context.agencyId,
          ...(filter.applicationId ? { applicationId: filter.applicationId } : {}),
          ...(filter.sessionId ? { sessionId: filter.sessionId } : {}),
          ...(filter.decision ? { decision: filter.decision } : {}),
        },
        orderBy: { decidedAt: 'desc' as const },
        take: filter.limit + 1,
        skip: filter.offset,
        select: decisionSelect,
      });
      const hasMore = records.length > filter.limit;
      const items = (hasMore ? records.slice(0, filter.limit) : records).map(
        selectionDecisionSummary,
      );
      return { items, hasMore, nextOffset: hasMore ? filter.offset + filter.limit : null };
    });
  }

  async findDecision(
    context: RequestContext,
    decisionId: string,
  ): Promise<SelectionDecisionSummary | null> {
    this.assertPermission(
      context,
      'recruitment.deliberations.read',
      'RECRUITMENT_SELECTION_READ_FORBIDDEN',
    );
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const record = await transaction.selectionDecision.findFirst({
        where: { agencyId: context.agencyId, id: decisionId },
        select: decisionSelect,
      });
      return record ? selectionDecisionSummary(record) : null;
    });
  }

  async recordDecision(
    context: RequestContext,
    applicationId: string,
    input: SelectionDecisionInput,
    rawIdempotencyKey?: string,
  ): Promise<SelectionDecisionSummary> {
    if (input.decision === 'SELECTED') {
      this.assertPermission(
        context,
        'recruitment.selection.select',
        'RECRUITMENT_SELECTION_SELECT_FORBIDDEN',
      );
    } else {
      this.assertPermission(
        context,
        'recruitment.selection.decide',
        'RECRUITMENT_SELECTION_DECIDE_FORBIDDEN',
      );
    }
    return withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition', 'plantilla-position-transition'),
      async (transaction) => {
        const application = await this.lockApplication(
          transaction,
          context.agencyId,
          applicationId,
        );
        if (!application) throw this.notFound('Application');
        const previous = await this.idempotentEvent(
          transaction,
          context,
          'SELECTION_DECISION_RECORDED',
          rawIdempotencyKey,
        );
        if (previous) {
          if (
            jsonObject(previous.metadata)?.applicationId !== applicationId ||
            jsonObject(previous.metadata)?.decision !== input.decision
          ) {
            throw this.idempotencyConflict();
          }
          const decisionId = jsonObject(previous.metadata)?.selectionDecisionId;
          if (typeof decisionId !== 'string') throw this.idempotencyConflict();
          return this.requireDecisionSummary(transaction, context.agencyId, decisionId);
        }
        if (application.status !== 'RECOMMENDED') {
          throw new RecruitmentServiceError(
            `A Selection Decision requires a recommended Application (current: ${application.status}).`,
            409,
            'RECRUITMENT_SELECTION_NOT_READY',
          );
        }
        const recommendation = await transaction.boardRecommendation.findFirst({
          where: { agencyId: context.agencyId, applicationId },
          orderBy: { recordedAt: 'desc' as const },
          select: {
            id: true,
            sessionId: true,
            recommendation: true,
            rankNo: true,
            compositeScore: true,
            reason: true,
          },
        });
        if (!recommendation) {
          throw new RecruitmentServiceError(
            'A Selection Decision requires a Board Recommendation.',
            409,
            'RECRUITMENT_SELECTION_RECOMMENDATION_MISSING',
          );
        }
        const session = await transaction.selectionBoardSession.findFirst({
          where: { agencyId: context.agencyId, id: recommendation.sessionId },
          select: {
            id: true,
            status: true,
            vacancyPublicationId: true,
            boardDefinitionId: true,
            reportVersions: {
              orderBy: { versionNo: 'desc' as const },
              take: 1,
              select: { id: true, versionNo: true, reportDocumentVersionId: true },
            },
          },
        });
        if (!session || session.status !== 'COMPLETED') {
          throw new RecruitmentServiceError(
            'A Selection Decision requires a completed Board Session.',
            409,
            'RECRUITMENT_SELECTION_SESSION_INCOMPLETE',
          );
        }
        if (session.vacancyPublicationId !== application.vacancyPublicationId) {
          throw new RecruitmentServiceError(
            'The Board Session does not belong to the Application vacancy.',
            409,
            'RECRUITMENT_SELECTION_SESSION_MISMATCH',
          );
        }
        const report = session.reportVersions[0];
        if (!report) {
          throw new RecruitmentServiceError(
            'A Selection Decision requires the advisory Comprehensive Candidate Evaluation Report.',
            409,
            'RECRUITMENT_SELECTION_REPORT_REQUIRED',
          );
        }
        if (
          (input.decision === 'SELECTED' || input.decision === 'NOT_SELECTED') &&
          recommendation.recommendation !== 'RECOMMENDED'
        ) {
          throw new RecruitmentServiceError(
            'Only a recommended Board output can be selected or declined.',
            409,
            'RECRUITMENT_SELECTION_RECOMMENDATION_INVALID',
          );
        }
        let authorityDocumentVersionId: string | null = null;
        if (input.authorityDocumentVersionId) {
          const version = await this.documents.resolveFinalizedVersionInTransaction(
            transaction,
            context,
            input.authorityDocumentVersionId,
          );
          if (!version) {
            throw new RecruitmentServiceError(
              'A finalized appointing authority Document Version is required as evidence.',
              409,
              'RECRUITMENT_SELECTION_AUTHORITY_INVALID',
            );
          }
          authorityDocumentVersionId = version.id;
        }
        if (input.decision === 'SELECTED' && !authorityDocumentVersionId) {
          throw new RecruitmentServiceError(
            'A selection requires the appointing authority evidence.',
            409,
            'RECRUITMENT_SELECTION_AUTHORITY_REQUIRED',
          );
        }
        const positionId = application.publication.request.position.id;
        let reservedVersionId: string | null = null;
        if (input.decision === 'SELECTED') {
          const resolution = await this.plantillaPositions.resolveRecruitableVacancyInTransaction(
            transaction,
            context,
            positionId,
            manilaToday(),
          );
          if (!resolution) throw this.notFound('Plantilla Position');
          if (!resolution.eligible) {
            throw new RecruitmentServiceError(
              `The selected Plantilla Position is not available for reservation (${resolution.reason}).`,
              409,
              'RECRUITMENT_SELECTION_POSITION_UNAVAILABLE',
            );
          }
          try {
            const reserved = await this.plantillaPositions.reserveInTransaction(
              transaction,
              context,
              positionId,
              manilaToday(),
              `Reserved for the Selection Decision on Application ${application.applicationNo}.`,
              rawIdempotencyKey ? `${rawIdempotencyKey}:position` : undefined,
            );
            reservedVersionId = reserved.currentVersion?.id ?? null;
          } catch (error: unknown) {
            if (error instanceof PlantillaPositionServiceError) {
              throw new RecruitmentServiceError(
                `The selected Plantilla Position could not be reserved (${error.code}).`,
                409,
                'RECRUITMENT_SELECTION_POSITION_UNAVAILABLE',
              );
            }
            throw error;
          }
        }
        const decidedAt = new Date();
        const decision = await transaction.selectionDecision.create({
          data: {
            agencyId: context.agencyId,
            applicationId,
            sessionId: session.id,
            boardRecommendationId: recommendation.id,
            decision: input.decision,
            reason: input.reason,
            authorityDocumentVersionId,
            decidedByMembershipId: context.membershipId,
            decidedAt,
          },
          select: { id: true },
        });
        const applicationStatus =
          input.decision === 'SELECTED'
            ? 'SELECTED'
            : input.decision === 'NOT_SELECTED'
              ? 'NOT_SELECTED'
              : 'FOR_DELIBERATION';
        await transaction.application.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: applicationId } },
          data: {
            status: applicationStatus,
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        let handoffId: string | null = null;
        if (input.decision === 'SELECTED') {
          const packageData = await this.buildSelectionPackage(transaction, context, application, {
            decisionId: decision.id,
            decidedAt,
            authorityDocumentVersionId,
            recommendation,
            report,
            positionVersionId: reservedVersionId,
          });
          const handoff = await transaction.recruitmentAppointmentHandoff.create({
            data: {
              agencyId: context.agencyId,
              selectionDecisionId: decision.id,
              applicationId,
              positionId,
              selectionPackage: packageData,
              idempotencyKey: rawIdempotencyKey ?? `selection-${decision.id}`,
              handedOffAt: decidedAt,
            },
            select: { id: true },
          });
          handoffId = handoff.id;
        }
        await this.writeAudit(transaction, context, {
          action: 'SELECTION_DECISION_RECORDED',
          entityType: 'SelectionDecision',
          entityId: decision.id,
          previousStatus: 'RECOMMENDED',
          newStatus: input.decision,
          reason: input.reason,
          metadata: safeSelectionAuditMetadata({
            selectionDecisionId: decision.id,
            applicationId,
            sessionId: session.id,
            recommendationId: recommendation.id,
            decision: input.decision,
            ...(authorityDocumentVersionId ? { authorityDocumentVersionId } : {}),
            ...(handoffId ? { handoffId } : {}),
            ...(input.decision === 'SELECTED' ? { positionId } : {}),
            ...(reservedVersionId ? { positionVersionId: reservedVersionId } : {}),
          }),
          idempotencyKey: rawIdempotencyKey,
        });
        return this.requireDecisionSummary(transaction, context.agencyId, decision.id);
      },
    );
  }

  /**
   * Internal contract: Appointment resolves the immutable selected-candidate
   * package by Selection Decision without reading Recruitment tables.
   */
  async resolveHandoffPackageInTransaction(
    transaction: Prisma.TransactionClient,
    context: Pick<RequestContext, 'agencyId'>,
    selectionDecisionId: string,
  ): Promise<HandoffPackageSummary | null> {
    const handoff = await transaction.recruitmentAppointmentHandoff.findFirst({
      where: { agencyId: context.agencyId, selectionDecisionId },
      select: {
        id: true,
        selectionDecisionId: true,
        applicationId: true,
        positionId: true,
        selectionPackage: true,
        handedOffAt: true,
        acceptedAt: true,
      },
    });
    if (!handoff) return null;
    return {
      handoffId: handoff.id,
      selectionDecisionId: handoff.selectionDecisionId,
      applicationId: handoff.applicationId,
      positionId: handoff.positionId,
      selectionPackage: handoff.selectionPackage,
      handedOffAt: handoff.handedOffAt,
      acceptedAt: handoff.acceptedAt,
    };
  }

  /**
   * Internal contract: Appointment lists the immutable selected-candidate
   * packages available for preparation without reading Recruitment tables.
   */
  async listHandoffPackagesInTransaction(
    transaction: Prisma.TransactionClient,
    context: Pick<RequestContext, 'agencyId'>,
    limit = 100,
  ): Promise<{ packages: HandoffPackageSummary[]; hasMore: boolean }> {
    const handoffs = await transaction.recruitmentAppointmentHandoff.findMany({
      where: { agencyId: context.agencyId },
      orderBy: { handedOffAt: 'desc' },
      take: limit + 1,
      select: {
        id: true,
        selectionDecisionId: true,
        applicationId: true,
        positionId: true,
        selectionPackage: true,
        handedOffAt: true,
        acceptedAt: true,
      },
    });
    const hasMore = handoffs.length > limit;
    return {
      packages: (hasMore ? handoffs.slice(0, limit) : handoffs).map((handoff) => ({
        handoffId: handoff.id,
        selectionDecisionId: handoff.selectionDecisionId,
        applicationId: handoff.applicationId,
        positionId: handoff.positionId,
        selectionPackage: handoff.selectionPackage,
        handedOffAt: handoff.handedOffAt,
        acceptedAt: handoff.acceptedAt,
      })),
      hasMore,
    };
  }

  private async buildSelectionPackage(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    application: SelectionApplicationRecord,
    facts: {
      decisionId: string;
      decidedAt: Date;
      authorityDocumentVersionId: string | null;
      recommendation: {
        id: string;
        recommendation: string;
        rankNo: number | null;
        compositeScore: Prisma.Decimal | null;
        reason: string | null;
      };
      report: { id: string; versionNo: number; reportDocumentVersionId: string };
      positionVersionId: string | null;
    },
  ): Promise<Prisma.InputJsonValue> {
    const position = await transaction.plantillaPosition.findFirst({
      where: { agencyId: context.agencyId, id: application.publication.request.position.id },
      select: {
        id: true,
        itemNumber: true,
        status: true,
        currentVersion: {
          select: {
            id: true,
            positionTitle: true,
            salaryGrade: true,
            organizationUnitId: true,
          },
        },
      },
    });
    if (!position) throw this.notFound('Plantilla Position');
    const packageData = {
      selectionDecisionId: facts.decisionId,
      decision: 'SELECTED',
      decidedAt: facts.decidedAt.toISOString(),
      decidedByMembershipId: context.membershipId,
      applicationId: application.id,
      applicationNo: `APP-${String(application.applicationNo).padStart(6, '0')}`,
      applicant: {
        id: application.applicant.id,
        fullName: fullName(application.applicant),
        email: application.applicant.emailNormalized,
        mobileNumber: application.applicant.mobileNumber,
      },
      publicationId: application.publication.id,
      publicationNo: `PUB-${String(application.publication.publicationNo).padStart(6, '0')}`,
      requestToFillId: application.publication.requestToFillId,
      requestNo: `RTF-${String(application.publication.request.requestNo).padStart(6, '0')}`,
      qualificationStandardVersionId: application.qualificationStandardVersionId,
      mspPlanVersionId: application.publication.request.mspPlanVersionId,
      criteriaSetId: application.publication.request.criteriaSetId,
      boardDefinitionId: application.publication.request.boardDefinitionId,
      boardRecommendation: {
        id: facts.recommendation.id,
        recommendation: facts.recommendation.recommendation,
        rankNo: facts.recommendation.rankNo,
        compositeScore:
          facts.recommendation.compositeScore === null
            ? null
            : Number(facts.recommendation.compositeScore),
        reason: facts.recommendation.reason,
      },
      report: {
        id: facts.report.id,
        versionNo: facts.report.versionNo,
        reportDocumentVersionId: facts.report.reportDocumentVersionId,
      },
      authorityDocumentVersionId: facts.authorityDocumentVersionId,
      position: {
        id: position.id,
        itemNumber: position.itemNumber,
        status: position.status,
        positionVersionId: position.currentVersion?.id ?? facts.positionVersionId,
        title: position.currentVersion?.positionTitle ?? null,
        salaryGrade: position.currentVersion?.salaryGrade ?? null,
        organizationUnitId: position.currentVersion?.organizationUnitId ?? null,
      },
      documents: application.documents.map((document) => ({
        applicationDocumentId: document.id,
        documentId: document.documentId,
        documentVersionId: document.documentVersionId,
        purpose: document.purpose,
        documentType: document.document.documentType,
      })),
      reservedOn: manilaToday(),
    };
    return packageData as unknown as Prisma.InputJsonValue;
  }

  private async requireDecisionSummary(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    decisionId: string,
  ): Promise<SelectionDecisionSummary> {
    const record = await transaction.selectionDecision.findFirst({
      where: { agencyId, id: decisionId },
      select: decisionSelect,
    });
    if (!record) throw this.notFound('Selection Decision');
    return selectionDecisionSummary(record);
  }

  private async lockApplication(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    applicationId: string,
  ): Promise<SelectionApplicationRecord | null> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "applications" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${applicationId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) return null;
    const record = await transaction.application.findFirst({
      where: { agencyId, id: applicationId },
      select: applicationSelect,
    });
    if (!record) throw this.notFound('Application');
    return record;
  }

  private async idempotentEvent(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    action: string,
    idempotencyKey?: string,
  ): Promise<{ entityId: string; metadata: Prisma.JsonValue } | null> {
    const key = idempotencyKey?.trim();
    if (!key) return null;
    return transaction.auditEvent.findFirst({
      where: { agencyId: context.agencyId, action, idempotencyKey: key },
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

  private assertPermission(context: RequestContext, permission: string, errorCode: string): void {
    if (!hasPermission(context, permission)) {
      throw new RecruitmentServiceError(
        'The requested Recruitment action is not permitted.',
        403,
        errorCode,
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

  private notFound(record: string): RecruitmentServiceError {
    return new RecruitmentServiceError(
      `The ${record} could not be found.`,
      404,
      'RECRUITMENT_NOT_FOUND',
    );
  }
}
