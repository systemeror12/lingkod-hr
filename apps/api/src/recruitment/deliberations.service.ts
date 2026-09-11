import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import {
  applicationSelect,
  applicationSummary,
  type ApplicationSummary,
} from './applications.service';
import { RecruitmentServiceError } from './recruitment.service';
import {
  BOARD_ROLES,
  SELECTION_BOARD_SESSION_STATUSES,
  type BoardAttendanceStatus,
  type BoardRole,
  type BoardRecommendationValue,
  type SelectionBoardSessionStatus,
} from './deliberations.schemas';
import { parseSelectionPlan } from './selection-plan';

type SessionCreateInput = {
  vacancyPublicationId: string;
  sessionDate: string;
};

type SessionListInput = {
  vacancyPublicationId?: string | undefined;
  status?: SelectionBoardSessionStatus | undefined;
  limit: number;
  offset: number;
};

type BoardParticipationInput = {
  rosterSnapshotMemberId: string;
  attendanceStatus: BoardAttendanceStatus;
  signedAt?: string | undefined;
};

type ConflictDeclarationInput = {
  participationId: string;
  applicationId: string;
  hasConflict: boolean;
  details?: string | undefined;
};

type BoardRecommendationInput = {
  applicationId: string;
  recommendation: BoardRecommendationValue;
  rankNo?: number | undefined;
  compositeScore?: number | undefined;
  reason?: string | undefined;
};

type CandidateEvaluationReportInput = {
  reportDocumentVersionId: string;
  reason?: string | undefined;
};

type SessionCompletionInput = {
  minutesDocumentVersionId?: string | undefined;
  reason?: string | undefined;
};

export interface BoardSeatDefinition {
  seatCode: string;
  required: boolean;
  boardRole: BoardRole;
  voting: boolean;
}

interface ResolvedRosterRow {
  boardAppointmentId: string;
  membershipId: string;
  seatCode: string;
  boardRole: BoardRole;
  appointmentKind: string;
  isVoting: boolean;
}

interface ResolvedRoster {
  boardCode: string;
  boardVersionNo: number;
  rows: ResolvedRosterRow[];
  votingSeats: number;
  nationalFloor: number;
  configuredMinimum: number;
}

const SESSION_WRITE_PERMISSION = 'recruitment.deliberations.submit';
const SESSION_RECOMMEND_PERMISSION = 'recruitment.deliberations.recommend';

const rosterMemberSelect = {
  id: true,
  boardAppointmentId: true,
  membershipId: true,
  seatCode: true,
  boardRole: true,
  appointmentKind: true,
  isVoting: true,
  membership: { select: { user: { select: { displayName: true } } } },
} as const;

const sessionSelect = {
  id: true,
  agencyId: true,
  vacancyPublicationId: true,
  boardDefinitionId: true,
  sessionDate: true,
  status: true,
  rosterFrozenAt: true,
  startedAt: true,
  completedAt: true,
  cancelledAt: true,
  cancellationReason: true,
  minutesDocumentVersionId: true,
  createdByMembershipId: true,
  createdAt: true,
  updatedAt: true,
  rowVersion: true,
  publication: {
    select: {
      id: true,
      publicationNo: true,
      status: true,
      openingDate: true,
      closingDate: true,
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
  boardDefinition: {
    select: {
      id: true,
      boardCode: true,
      versionNo: true,
      seatDefinition: true,
      quorumDefinition: true,
    },
  },
  rosterMembers: {
    orderBy: { seatCode: 'asc' as const },
    select: rosterMemberSelect,
  },
  participations: {
    orderBy: { recordedAt: 'asc' as const },
    select: {
      id: true,
      rosterSnapshotMemberId: true,
      membershipId: true,
      boardRole: true,
      attendanceStatus: true,
      signedAt: true,
      recordedAt: true,
    },
  },
  conflicts: {
    orderBy: { declaredAt: 'asc' as const },
    select: {
      id: true,
      participationId: true,
      applicationId: true,
      hasConflict: true,
      details: true,
      declaredAt: true,
      participation: { select: { membershipId: true } },
    },
  },
  quorumSnapshots: {
    orderBy: { frozenAt: 'asc' as const },
    select: {
      id: true,
      applicationId: true,
      votingSeats: true,
      nationalFloor: true,
      eligibleVotingMembers: true,
      requiredVotingMembers: true,
      presentVotingMembers: true,
      satisfied: true,
      frozenAt: true,
      application: {
        select: {
          id: true,
          applicationNo: true,
          status: true,
          applicant: {
            select: { firstName: true, middleName: true, lastName: true, suffix: true },
          },
        },
      },
    },
  },
  recommendations: {
    orderBy: { recordedAt: 'asc' as const },
    select: {
      id: true,
      applicationId: true,
      rankNo: true,
      recommendation: true,
      compositeScore: true,
      reason: true,
      recordedByMembershipId: true,
      recordedAt: true,
      application: {
        select: {
          id: true,
          applicationNo: true,
          applicant: {
            select: { firstName: true, middleName: true, lastName: true, suffix: true },
          },
        },
      },
    },
  },
  reportVersions: {
    orderBy: { versionNo: 'asc' as const },
    select: {
      id: true,
      versionNo: true,
      reportDocumentVersionId: true,
      reason: true,
      issuedByMembershipId: true,
      issuedAt: true,
    },
  },
  selectionDecisions: {
    orderBy: { decidedAt: 'asc' as const },
    select: {
      id: true,
      applicationId: true,
      decision: true,
      reason: true,
      decidedByMembershipId: true,
      decidedAt: true,
    },
  },
} as const;

type SessionRecord = Prisma.SelectionBoardSessionGetPayload<{ select: typeof sessionSelect }>;

function jsonObject(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, Prisma.JsonValue>;
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

function date(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
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

function sessionStatus(value: string): SelectionBoardSessionStatus {
  if (SELECTION_BOARD_SESSION_STATUSES.includes(value as SelectionBoardSessionStatus)) {
    return value as SelectionBoardSessionStatus;
  }
  throw new RecruitmentServiceError(
    'The stored Selection Board Session status is invalid.',
    500,
    'RECRUITMENT_DATA_INVALID',
  );
}

function boardRole(value: string): BoardRole {
  if (BOARD_ROLES.includes(value as BoardRole)) return value as BoardRole;
  throw new RecruitmentServiceError(
    'The stored board role is invalid.',
    500,
    'RECRUITMENT_DATA_INVALID',
  );
}

function isAlternateAppointment(kind: string): boolean {
  return kind.trim().toUpperCase().includes('ALTERNATE');
}

/** Parses the configured Board Definition seats. Voting is explicit or implied by the role. */
export function parseBoardSeatDefinition(value: Prisma.JsonValue): BoardSeatDefinition[] {
  const object = jsonObject(value);
  if (!object || !Array.isArray(object.seats)) return [];
  const seats: BoardSeatDefinition[] = [];
  for (const entry of object.seats) {
    const seat = jsonObject(entry);
    if (!seat || typeof seat.seatCode !== 'string' || !seat.seatCode.trim()) return [];
    if (seat.required !== undefined && typeof seat.required !== 'boolean') return [];
    if (seat.boardRole !== undefined && typeof seat.boardRole !== 'string') return [];
    if (seat.voting !== undefined && typeof seat.voting !== 'boolean') return [];
    const role = (typeof seat.boardRole === 'string' ? seat.boardRole : 'MEMBER') as BoardRole;
    if (!BOARD_ROLES.includes(role)) return [];
    seats.push({
      seatCode: seat.seatCode.trim(),
      required: seat.required !== false,
      boardRole: role,
      voting:
        typeof seat.voting === 'boolean'
          ? seat.voting
          : !['SECRETARIAT', 'OBSERVER'].includes(role),
    });
  }
  return seats;
}

/** Reads the Agency quorum configuration without weakening the national majority floor. */
export function configuredQuorumMinimum(value: Prisma.JsonValue): number {
  const object = jsonObject(value);
  if (!object || object.minimum === undefined) return 0;
  if (
    typeof object.minimum !== 'number' ||
    !Number.isInteger(object.minimum) ||
    object.minimum < 1
  ) {
    throw new RecruitmentServiceError(
      'The Board Definition quorum configuration is not a positive member count.',
      409,
      'RECRUITMENT_BOARD_QUORUM_INVALID',
    );
  }
  return object.minimum;
}

export function nationalQuorumFloor(votingSeats: number): number {
  return Math.floor(votingSeats / 2) + 1;
}

function safeDeliberationAuditMetadata(value: Prisma.InputJsonObject): Prisma.InputJsonObject {
  const allowed = new Set([
    'sessionId',
    'publicationId',
    'boardDefinitionId',
    'sessionDate',
    'rosterSnapshotMemberId',
    'membershipId',
    'attendanceStatus',
    'participationId',
    'applicationId',
    'hasConflict',
    'recommendationId',
    'rankNo',
    'recommendation',
    'reportVersionId',
    'reportDocumentVersionId',
    'versionNo',
    'minutesDocumentVersionId',
    'seatCount',
    'votingSeats',
    'includedApplicationCount',
  ]);
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => allowed.has(key)),
  ) as Prisma.InputJsonObject;
}

function decisionSummary(record: SessionRecord['selectionDecisions'][number]) {
  return {
    id: record.id,
    applicationId: record.applicationId,
    decision: record.decision,
    reason: record.reason,
    decidedByMembershipId: record.decidedByMembershipId,
    decidedAt: record.decidedAt.toISOString(),
  };
}

function recommendationSummary(record: SessionRecord['recommendations'][number]) {
  return {
    id: record.id,
    applicationId: record.applicationId,
    applicationNo: `APP-${String(record.application.applicationNo).padStart(6, '0')}`,
    applicantName: fullName(record.application.applicant),
    rankNo: record.rankNo,
    recommendation: record.recommendation,
    compositeScore: record.compositeScore === null ? null : Number(record.compositeScore),
    reason: record.reason,
    recordedByMembershipId: record.recordedByMembershipId,
    recordedAt: record.recordedAt.toISOString(),
  };
}

function quorumSummary(record: SessionRecord['quorumSnapshots'][number]) {
  return {
    id: record.id,
    applicationId: record.applicationId,
    applicationNo: `APP-${String(record.application.applicationNo).padStart(6, '0')}`,
    applicantName: fullName(record.application.applicant),
    applicationStatus: record.application.status,
    votingSeats: record.votingSeats,
    nationalFloor: record.nationalFloor,
    eligibleVotingMembers: record.eligibleVotingMembers,
    requiredVotingMembers: record.requiredVotingMembers,
    presentVotingMembers: record.presentVotingMembers,
    satisfied: record.satisfied,
    frozenAt: record.frozenAt.toISOString(),
  };
}

export function sessionSummary(record: SessionRecord) {
  const version = record.publication.request.position.currentVersion;
  return {
    id: record.id,
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
      title: version?.positionTitle ?? null,
      salaryGrade: version?.salaryGrade ?? null,
      organizationUnitId: version?.organizationUnitId ?? null,
    },
    boardDefinitionId: record.boardDefinitionId,
    boardCode: record.boardDefinition.boardCode,
    boardVersionNo: record.boardDefinition.versionNo,
    sessionDate: formatDate(record.sessionDate),
    status: sessionStatus(record.status),
    rosterFrozenAt: formatDateTime(record.rosterFrozenAt),
    startedAt: formatDateTime(record.startedAt),
    completedAt: formatDateTime(record.completedAt),
    cancelledAt: formatDateTime(record.cancelledAt),
    cancellationReason: record.cancellationReason,
    minutesDocumentVersionId: record.minutesDocumentVersionId,
    roster: record.rosterMembers.map((member) => ({
      id: member.id,
      boardAppointmentId: member.boardAppointmentId,
      membershipId: member.membershipId,
      memberName: member.membership.user.displayName,
      seatCode: member.seatCode,
      boardRole: boardRole(member.boardRole),
      appointmentKind: member.appointmentKind,
      isAlternate: isAlternateAppointment(member.appointmentKind),
      isVoting: member.isVoting,
    })),
    participations: record.participations.map((participation) => ({
      id: participation.id,
      rosterSnapshotMemberId: participation.rosterSnapshotMemberId,
      membershipId: participation.membershipId,
      boardRole: boardRole(participation.boardRole),
      attendanceStatus: participation.attendanceStatus,
      signedAt: formatDateTime(participation.signedAt),
      recordedAt: participation.recordedAt.toISOString(),
    })),
    conflicts: record.conflicts.map((conflict) => ({
      id: conflict.id,
      participationId: conflict.participationId,
      membershipId: conflict.participation.membershipId,
      applicationId: conflict.applicationId,
      hasConflict: conflict.hasConflict,
      details: conflict.details,
      declaredAt: conflict.declaredAt.toISOString(),
    })),
    quorum: record.quorumSnapshots.map(quorumSummary),
    recommendations: record.recommendations.map(recommendationSummary),
    reports: record.reportVersions.map((report) => ({
      id: report.id,
      versionNo: report.versionNo,
      reportDocumentVersionId: report.reportDocumentVersionId,
      reason: report.reason,
      issuedByMembershipId: report.issuedByMembershipId,
      issuedAt: report.issuedAt.toISOString(),
    })),
    decisions: record.selectionDecisions.map(decisionSummary),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export type SessionSummary = ReturnType<typeof sessionSummary>;

@Injectable()
export class DeliberationsService {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  async listSessions(
    context: RequestContext,
    filter: SessionListInput,
  ): Promise<{ items: SessionSummary[]; hasMore: boolean; nextOffset: number | null }> {
    this.assertPermission(
      context,
      'recruitment.deliberations.read',
      'RECRUITMENT_DELIBERATION_READ_FORBIDDEN',
    );
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const records = await transaction.selectionBoardSession.findMany({
        where: {
          agencyId: context.agencyId,
          ...(filter.vacancyPublicationId
            ? { vacancyPublicationId: filter.vacancyPublicationId }
            : {}),
          ...(filter.status ? { status: filter.status } : {}),
        },
        orderBy: { sessionDate: 'desc' as const },
        take: filter.limit + 1,
        skip: filter.offset,
        select: sessionSelect,
      });
      const hasMore = records.length > filter.limit;
      const items = (hasMore ? records.slice(0, filter.limit) : records).map(sessionSummary);
      return { items, hasMore, nextOffset: hasMore ? filter.offset + filter.limit : null };
    });
  }

  async findSession(context: RequestContext, sessionId: string): Promise<SessionSummary | null> {
    this.assertPermission(
      context,
      'recruitment.deliberations.read',
      'RECRUITMENT_DELIBERATION_READ_FORBIDDEN',
    );
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const record = await transaction.selectionBoardSession.findFirst({
        where: { agencyId: context.agencyId, id: sessionId },
        select: sessionSelect,
      });
      return record ? sessionSummary(record) : null;
    });
  }

  async createSession(
    context: RequestContext,
    input: SessionCreateInput,
    rawIdempotencyKey?: string,
  ): Promise<SessionSummary> {
    this.assertPermission(
      context,
      SESSION_WRITE_PERMISSION,
      'RECRUITMENT_DELIBERATION_SUBMIT_FORBIDDEN',
    );
    return withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const previous = await this.idempotentEvent(
          transaction,
          context,
          'SELECTION_BOARD_SESSION_CREATED',
          rawIdempotencyKey,
        );
        if (previous) {
          if (
            jsonObject(previous.metadata)?.publicationId !== input.vacancyPublicationId ||
            jsonObject(previous.metadata)?.sessionDate !== input.sessionDate
          ) {
            throw this.idempotencyConflict();
          }
          return sessionSummary(
            await this.requireSession(transaction, context.agencyId, previous.entityId),
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
            'A Selection Board Session requires a published vacancy.',
            409,
            'RECRUITMENT_DELIBERATION_PUBLICATION_INVALID',
          );
        }
        if (!publication.request.boardDefinitionId) {
          throw new RecruitmentServiceError(
            'The Recruitment Case has no bound HRMPSB Board Definition.',
            409,
            'RECRUITMENT_BOARD_RESOLUTION_FAILED',
          );
        }
        const roster = await this.resolveRoster(
          transaction,
          context,
          publication.request.boardDefinitionId,
          input.sessionDate,
        );
        const session = await transaction.selectionBoardSession.create({
          data: {
            agencyId: context.agencyId,
            vacancyPublicationId: publication.id,
            boardDefinitionId: publication.request.boardDefinitionId,
            sessionDate: date(input.sessionDate),
            status: 'DRAFT',
            createdByMembershipId: context.membershipId,
            updatedByMembershipId: context.membershipId,
          },
          select: { id: true },
        });
        await transaction.boardRosterSnapshotMember.createMany({
          data: roster.rows.map((member) => ({
            agencyId: context.agencyId,
            sessionId: session.id,
            boardAppointmentId: member.boardAppointmentId,
            membershipId: member.membershipId,
            seatCode: member.seatCode,
            boardRole: member.boardRole,
            appointmentKind: member.appointmentKind,
            isVoting: member.isVoting,
          })),
        });
        await this.writeAudit(transaction, context, {
          action: 'SELECTION_BOARD_SESSION_CREATED',
          entityType: 'SelectionBoardSession',
          entityId: session.id,
          previousStatus: null,
          newStatus: 'DRAFT',
          reason: `Roster snapshotted from Board Definition ${roster.boardCode} v${roster.boardVersionNo} for ${input.sessionDate}.`,
          metadata: safeDeliberationAuditMetadata({
            sessionId: session.id,
            publicationId: publication.id,
            boardDefinitionId: publication.request.boardDefinitionId,
            sessionDate: input.sessionDate,
            seatCount: roster.rows.length,
            votingSeats: roster.votingSeats,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
        return sessionSummary(await this.requireSession(transaction, context.agencyId, session.id));
      },
    );
  }

  async recordParticipation(
    context: RequestContext,
    sessionId: string,
    input: BoardParticipationInput,
    rawIdempotencyKey?: string,
  ): Promise<SessionSummary> {
    this.assertPermission(
      context,
      SESSION_WRITE_PERMISSION,
      'RECRUITMENT_DELIBERATION_SUBMIT_FORBIDDEN',
    );
    return this.runSessionCommand(
      context,
      'BOARD_PARTICIPATION_RECORDED',
      rawIdempotencyKey,
      sessionId,
      async (transaction, session, previous) => {
        if (previous) {
          if (
            jsonObject(previous.metadata)?.rosterSnapshotMemberId !==
              input.rosterSnapshotMemberId ||
            jsonObject(previous.metadata)?.attendanceStatus !== input.attendanceStatus
          ) {
            throw this.idempotencyConflict();
          }
          return;
        }
        if (session.status !== 'DRAFT') {
          throw this.workflowError('record participation', session.status);
        }
        const member = session.rosterMembers.find(({ id }) => id === input.rosterSnapshotMemberId);
        if (!member) {
          throw new RecruitmentServiceError(
            'The participant is not part of the frozen Board roster.',
            409,
            'RECRUITMENT_BOARD_MEMBER_NOT_IN_ROSTER',
          );
        }
        const existing = session.participations.find(
          ({ membershipId }) => membershipId === member.membershipId,
        );
        if (existing) {
          throw new RecruitmentServiceError(
            'Participation for this Board member is already recorded.',
            409,
            'RECRUITMENT_BOARD_PARTICIPATION_DUPLICATE',
          );
        }
        await transaction.boardMemberParticipation.create({
          data: {
            agencyId: context.agencyId,
            sessionId,
            rosterSnapshotMemberId: member.id,
            membershipId: member.membershipId,
            boardRole: member.boardRole,
            attendanceStatus: input.attendanceStatus,
            signedAt: input.signedAt ? new Date(input.signedAt) : null,
            recordedByMembershipId: context.membershipId,
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'BOARD_PARTICIPATION_RECORDED',
          entityType: 'SelectionBoardSession',
          entityId: sessionId,
          previousStatus: session.status,
          newStatus: session.status,
          reason: `${member.boardRole} participation recorded as ${input.attendanceStatus}.`,
          metadata: safeDeliberationAuditMetadata({
            sessionId,
            rosterSnapshotMemberId: member.id,
            membershipId: member.membershipId,
            attendanceStatus: input.attendanceStatus,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
      },
    );
  }

  async declareConflict(
    context: RequestContext,
    sessionId: string,
    input: ConflictDeclarationInput,
    rawIdempotencyKey?: string,
  ): Promise<SessionSummary> {
    const canAdminister = hasPermission(context, SESSION_WRITE_PERMISSION);
    const canRecommend = hasPermission(context, SESSION_RECOMMEND_PERMISSION);
    if (!canAdminister && !canRecommend) {
      throw new RecruitmentServiceError(
        'Recording a board conflict declaration is not permitted.',
        403,
        'RECRUITMENT_DELIBERATION_RECOMMEND_FORBIDDEN',
      );
    }
    return this.runSessionCommand(
      context,
      'BOARD_CONFLICT_DECLARED',
      rawIdempotencyKey,
      sessionId,
      async (transaction, session, previous) => {
        if (previous) {
          if (
            jsonObject(previous.metadata)?.participationId !== input.participationId ||
            jsonObject(previous.metadata)?.applicationId !== input.applicationId ||
            jsonObject(previous.metadata)?.hasConflict !== input.hasConflict
          ) {
            throw this.idempotencyConflict();
          }
          return;
        }
        if (session.status !== 'DRAFT') {
          throw this.workflowError('record a conflict declaration', session.status);
        }
        const participation = session.participations.find(({ id }) => id === input.participationId);
        if (!participation) {
          throw new RecruitmentServiceError(
            'The conflict declaration requires a recorded Board participation.',
            409,
            'RECRUITMENT_BOARD_PARTICIPATION_MISSING',
          );
        }
        if (!canAdminister && participation.membershipId !== context.membershipId) {
          throw new RecruitmentServiceError(
            'An HRMPSB member may only declare their own conflict of interest.',
            403,
            'RECRUITMENT_DELIBERATION_RECOMMEND_FORBIDDEN',
          );
        }
        const snapshot = session.quorumSnapshots.some(
          ({ applicationId }) => applicationId === input.applicationId,
        );
        if (snapshot) {
          throw new RecruitmentServiceError(
            'The applicant quorum is already frozen for deliberation.',
            409,
            'RECRUITMENT_QUORUM_FROZEN',
          );
        }
        await transaction.conflictDeclaration.create({
          data: {
            agencyId: context.agencyId,
            sessionId,
            participationId: participation.id,
            applicationId: input.applicationId,
            hasConflict: input.hasConflict,
            details: input.details ?? null,
            declaredByMembershipId: context.membershipId,
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'BOARD_CONFLICT_DECLARED',
          entityType: 'SelectionBoardSession',
          entityId: sessionId,
          previousStatus: session.status,
          newStatus: session.status,
          reason: input.hasConflict
            ? 'A participant declared a conflict of interest for one applicant.'
            : 'A participant declared no conflict of interest for one applicant.',
          metadata: safeDeliberationAuditMetadata({
            sessionId,
            participationId: participation.id,
            membershipId: participation.membershipId,
            applicationId: input.applicationId,
            hasConflict: input.hasConflict,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
      },
    );
  }

  async startSession(
    context: RequestContext,
    sessionId: string,
    rawIdempotencyKey?: string,
  ): Promise<SessionSummary> {
    this.assertPermission(
      context,
      SESSION_WRITE_PERMISSION,
      'RECRUITMENT_DELIBERATION_SUBMIT_FORBIDDEN',
    );
    return this.runSessionCommand(
      context,
      'SELECTION_BOARD_SESSION_STARTED',
      rawIdempotencyKey,
      sessionId,
      async (transaction, session, previous) => {
        if (previous) return;
        if (session.status !== 'DRAFT')
          throw this.workflowError('start deliberation', session.status);
        if (session.publication.status !== 'PUBLISHED') {
          throw new RecruitmentServiceError(
            'Deliberation requires a published vacancy.',
            409,
            'RECRUITMENT_DELIBERATION_PUBLICATION_INVALID',
          );
        }
        if (formatDate(session.publication.closingDate) >= manilaToday()) {
          throw new RecruitmentServiceError(
            'Deliberation cannot begin until the publication period has elapsed.',
            409,
            'RECRUITMENT_DELIBERATION_PUBLICATION_OPEN',
          );
        }
        const criteriaSet = await transaction.meritSelectionCriteriaSet.findFirst({
          where: {
            agencyId: context.agencyId,
            id: await this.publicationCriteriaSetId(
              transaction,
              context,
              session.vacancyPublicationId,
            ),
          },
          select: { criteriaDefinition: true },
        });
        const plan = criteriaSet ? parseSelectionPlan(criteriaSet.criteriaDefinition) : null;
        if (!plan) {
          throw new RecruitmentServiceError(
            'The Recruitment Case has no supported bound Merit Selection Criteria Set.',
            409,
            'RECRUITMENT_SELECTION_PLAN_INVALID',
          );
        }
        const applications = await transaction.application.findMany({
          where: { agencyId: context.agencyId, vacancyPublicationId: session.vacancyPublicationId },
          select: {
            id: true,
            status: true,
            assessments: { select: { stageCode: true, status: true } },
            interviews: { select: { stageCode: true, status: true } },
          },
          orderBy: { applicationNo: 'asc' as const },
        });
        const included = applications.filter((application) =>
          this.isDeliberationCandidate(application.status),
        );
        const pending = applications.filter(
          (application) =>
            !this.isDeliberationCandidate(application.status) &&
            !this.isRetainedApplication(application.status),
        );
        if (pending.length > 0) {
          throw new RecruitmentServiceError(
            'Deliberation cannot begin until every open Application is screened and every configured stage is complete.',
            409,
            'RECRUITMENT_DELIBERATION_SCREENING_INCOMPLETE',
          );
        }
        const incomplete = included.find(
          (application) =>
            !plan.stages.every((stage) =>
              [...application.assessments, ...application.interviews].some(
                (record) => record.stageCode === stage.stageCode && record.status === 'COMPLETED',
              ),
            ),
        );
        if (incomplete) {
          throw new RecruitmentServiceError(
            'Deliberation cannot begin until every configured selection stage is complete.',
            409,
            'RECRUITMENT_DELIBERATION_STAGE_INCOMPLETE',
          );
        }
        if (included.length === 0) {
          throw new RecruitmentServiceError(
            'No screened Application is ready for deliberation.',
            409,
            'RECRUITMENT_DELIBERATION_NO_APPLICANTS',
          );
        }
        const roster = this.resolvedRosterFromSession(session);
        if (roster.votingSeats === 0) {
          throw new RecruitmentServiceError(
            'The HRMPSB Board Definition must include at least one voting seat.',
            409,
            'RECRUITMENT_BOARD_INVALID',
          );
        }
        const activeSession = await transaction.selectionBoardSession.findFirst({
          where: {
            agencyId: context.agencyId,
            vacancyPublicationId: session.vacancyPublicationId,
            status: 'IN_PROGRESS',
          },
          select: { id: true },
        });
        if (activeSession) {
          throw new RecruitmentServiceError(
            'Another Selection Board Session for this vacancy is already under deliberation.',
            409,
            'RECRUITMENT_DELIBERATION_SESSION_ACTIVE',
          );
        }
        const startedAt = new Date();
        try {
          await transaction.selectionBoardSession.update({
            where: { agencyId_id: { agencyId: context.agencyId, id: sessionId } },
            data: {
              status: 'IN_PROGRESS',
              rosterFrozenAt: startedAt,
              startedAt,
              updatedByMembershipId: context.membershipId,
              rowVersion: { increment: 1 },
            },
          });
        } catch (error: unknown) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw new RecruitmentServiceError(
              'Another Selection Board Session for this vacancy is already under deliberation.',
              409,
              'RECRUITMENT_DELIBERATION_SESSION_ACTIVE',
            );
          }
          throw error;
        }
        for (const application of included) {
          if (application.status !== 'FOR_DELIBERATION') {
            await transaction.application.update({
              where: {
                agencyId_id: { agencyId: context.agencyId, id: application.id },
              },
              data: {
                status: 'FOR_DELIBERATION',
                updatedByMembershipId: context.membershipId,
                rowVersion: { increment: 1 },
              },
            });
          }
          const quorum = this.computeQuorum(session, roster, application.id);
          await transaction.applicantQuorumSnapshot.create({
            data: {
              agencyId: context.agencyId,
              sessionId,
              applicationId: application.id,
              votingSeats: quorum.votingSeats,
              nationalFloor: quorum.nationalFloor,
              eligibleVotingMembers: quorum.eligibleVotingMembers,
              requiredVotingMembers: quorum.requiredVotingMembers,
              presentVotingMembers: quorum.presentVotingMembers,
              satisfied: quorum.satisfied,
              frozenByMembershipId: context.membershipId,
              frozenAt: startedAt,
            },
          });
        }
        await this.writeAudit(transaction, context, {
          action: 'SELECTION_BOARD_SESSION_STARTED',
          entityType: 'SelectionBoardSession',
          entityId: sessionId,
          previousStatus: 'DRAFT',
          newStatus: 'IN_PROGRESS',
          reason: 'The Board roster and applicant-specific quorum were frozen for deliberation.',
          metadata: safeDeliberationAuditMetadata({
            sessionId,
            publicationId: session.vacancyPublicationId,
            includedApplicationCount: included.length,
            votingSeats: roster.votingSeats,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
      },
    );
  }

  async recordRecommendation(
    context: RequestContext,
    sessionId: string,
    input: BoardRecommendationInput,
    rawIdempotencyKey?: string,
  ): Promise<SessionSummary> {
    this.assertPermission(
      context,
      SESSION_RECOMMEND_PERMISSION,
      'RECRUITMENT_DELIBERATION_RECOMMEND_FORBIDDEN',
    );
    return this.runSessionCommand(
      context,
      'BOARD_RECOMMENDATION_RECORDED',
      rawIdempotencyKey,
      sessionId,
      async (transaction, session, previous) => {
        if (previous) {
          if (
            jsonObject(previous.metadata)?.applicationId !== input.applicationId ||
            jsonObject(previous.metadata)?.recommendation !== input.recommendation
          ) {
            throw this.idempotencyConflict();
          }
          return;
        }
        if (session.status !== 'IN_PROGRESS') {
          throw this.workflowError('record a Board Recommendation', session.status);
        }
        const quorum = session.quorumSnapshots.find(
          ({ applicationId }) => applicationId === input.applicationId,
        );
        if (!quorum) {
          throw new RecruitmentServiceError(
            'The Application is not part of this Session deliberation.',
            409,
            'RECRUITMENT_DELIBERATION_APPLICATION_NOT_INCLUDED',
          );
        }
        if (!quorum.satisfied) {
          throw new RecruitmentServiceError(
            'A satisfied applicant-specific quorum is required before recommending.',
            409,
            'RECRUITMENT_QUORUM_NOT_SATISFIED',
          );
        }
        const existing = session.recommendations.find(
          ({ applicationId }) => applicationId === input.applicationId,
        );
        if (existing) {
          throw new RecruitmentServiceError(
            'A Board Recommendation for this Application is already recorded.',
            409,
            'RECRUITMENT_BOARD_RECOMMENDATION_DUPLICATE',
          );
        }
        const application = await transaction.application.findFirst({
          where: { agencyId: context.agencyId, id: input.applicationId },
          select: { status: true, vacancyPublicationId: true },
        });
        if (!application || application.vacancyPublicationId !== session.vacancyPublicationId) {
          throw this.notFound('Application');
        }
        if (application.status !== 'FOR_DELIBERATION') {
          throw this.workflowError('record a Board Recommendation', application.status);
        }
        const recommendation = await transaction.boardRecommendation.create({
          data: {
            agencyId: context.agencyId,
            sessionId,
            applicationId: input.applicationId,
            rankNo: input.rankNo ?? null,
            recommendation: input.recommendation,
            compositeScore:
              input.compositeScore === undefined ? null : new Prisma.Decimal(input.compositeScore),
            reason: input.reason ?? null,
            recordedByMembershipId: context.membershipId,
          },
          select: { id: true },
        });
        await transaction.application.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: input.applicationId } },
          data: {
            status: input.recommendation === 'RECOMMENDED' ? 'RECOMMENDED' : 'NOT_RECOMMENDED',
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'BOARD_RECOMMENDATION_RECORDED',
          entityType: 'BoardRecommendation',
          entityId: recommendation.id,
          previousStatus: 'FOR_DELIBERATION',
          newStatus: input.recommendation,
          reason:
            input.reason ??
            `The Board recorded ${input.recommendation.toLowerCase().replace('_', ' ')} for the Application.`,
          metadata: safeDeliberationAuditMetadata({
            sessionId,
            applicationId: input.applicationId,
            recommendationId: recommendation.id,
            rankNo: input.rankNo,
            recommendation: input.recommendation,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
      },
    );
  }

  async issueReport(
    context: RequestContext,
    sessionId: string,
    input: CandidateEvaluationReportInput,
    rawIdempotencyKey?: string,
  ): Promise<SessionSummary> {
    this.assertPermission(
      context,
      SESSION_WRITE_PERMISSION,
      'RECRUITMENT_DELIBERATION_SUBMIT_FORBIDDEN',
    );
    return this.runSessionCommand(
      context,
      'CANDIDATE_EVALUATION_REPORT_ISSUED',
      rawIdempotencyKey,
      sessionId,
      async (transaction, session, previous) => {
        if (previous) {
          if (
            jsonObject(previous.metadata)?.reportDocumentVersionId !== input.reportDocumentVersionId
          ) {
            throw this.idempotencyConflict();
          }
          return;
        }
        if (session.status !== 'IN_PROGRESS' && session.status !== 'COMPLETED') {
          throw this.workflowError(
            'issue the Comprehensive Candidate Evaluation Report',
            session.status,
          );
        }
        const evidence = await this.requireFinalizedDocumentVersion(
          transaction,
          context,
          input.reportDocumentVersionId,
          'RECRUITMENT_REPORT_EVIDENCE_INVALID',
        );
        const included = session.quorumSnapshots.map(({ applicationId }) => applicationId);
        const missing = included.find(
          (applicationId) =>
            !session.recommendations.some(
              (recommendation) => recommendation.applicationId === applicationId,
            ),
        );
        if (missing) {
          throw new RecruitmentServiceError(
            'The evaluation report requires a Board Recommendation for every deliberated Application.',
            409,
            'RECRUITMENT_REPORT_INCOMPLETE',
          );
        }
        const nextVersion =
          session.reportVersions.reduce((latest, report) => Math.max(latest, report.versionNo), 0) +
          1;
        if (nextVersion > 1 && !input.reason) {
          throw new RecruitmentServiceError(
            'A corrected evaluation report requires a reason.',
            409,
            'RECRUITMENT_REPORT_REASON_REQUIRED',
          );
        }
        const reportData = await this.buildReportData(transaction, context, session);
        const report = await transaction.candidateEvaluationReportVersion.create({
          data: {
            agencyId: context.agencyId,
            sessionId,
            versionNo: nextVersion,
            reportDocumentVersionId: evidence.id,
            reportData,
            reason: input.reason ?? null,
            issuedByMembershipId: context.membershipId,
          },
          select: { id: true },
        });
        await this.writeAudit(transaction, context, {
          action: 'CANDIDATE_EVALUATION_REPORT_ISSUED',
          entityType: 'CandidateEvaluationReportVersion',
          entityId: report.id,
          previousStatus: session.status,
          newStatus: session.status,
          reason:
            input.reason ?? 'The advisory Comprehensive Candidate Evaluation Report was issued.',
          metadata: safeDeliberationAuditMetadata({
            sessionId,
            reportVersionId: report.id,
            reportDocumentVersionId: evidence.id,
            versionNo: nextVersion,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
      },
    );
  }

  async completeSession(
    context: RequestContext,
    sessionId: string,
    input: SessionCompletionInput,
    rawIdempotencyKey?: string,
  ): Promise<SessionSummary> {
    this.assertPermission(
      context,
      SESSION_WRITE_PERMISSION,
      'RECRUITMENT_DELIBERATION_SUBMIT_FORBIDDEN',
    );
    return this.runSessionCommand(
      context,
      'SELECTION_BOARD_SESSION_COMPLETED',
      rawIdempotencyKey,
      sessionId,
      async (transaction, session, previous) => {
        if (previous) return;
        if (session.status !== 'IN_PROGRESS') {
          throw this.workflowError('complete deliberation', session.status);
        }
        const included = session.quorumSnapshots.map(({ applicationId }) => applicationId);
        const missing = included.find(
          (applicationId) =>
            !session.recommendations.some(
              (recommendation) => recommendation.applicationId === applicationId,
            ),
        );
        if (missing) {
          throw new RecruitmentServiceError(
            'Every deliberated Application requires a Board Recommendation before completion.',
            409,
            'RECRUITMENT_DELIBERATION_INCOMPLETE',
          );
        }
        if (session.reportVersions.length === 0) {
          throw new RecruitmentServiceError(
            'The Comprehensive Candidate Evaluation Report must be issued before completion.',
            409,
            'RECRUITMENT_REPORT_REQUIRED',
          );
        }
        let minutesDocumentVersionId: string | null = null;
        if (input.minutesDocumentVersionId) {
          minutesDocumentVersionId = (
            await this.requireFinalizedDocumentVersion(
              transaction,
              context,
              input.minutesDocumentVersionId,
              'RECRUITMENT_MINUTES_EVIDENCE_INVALID',
            )
          ).id;
        }
        await transaction.selectionBoardSession.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: sessionId } },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            ...(minutesDocumentVersionId ? { minutesDocumentVersionId } : {}),
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'SELECTION_BOARD_SESSION_COMPLETED',
          entityType: 'SelectionBoardSession',
          entityId: sessionId,
          previousStatus: 'IN_PROGRESS',
          newStatus: 'COMPLETED',
          reason:
            input.reason ?? 'The Board completed deliberation for every included Application.',
          metadata: safeDeliberationAuditMetadata({
            sessionId,
            publicationId: session.vacancyPublicationId,
            includedApplicationCount: included.length,
            ...(minutesDocumentVersionId ? { minutesDocumentVersionId } : {}),
          }),
          idempotencyKey: rawIdempotencyKey,
        });
      },
    );
  }

  async cancelSession(
    context: RequestContext,
    sessionId: string,
    reason: string,
    rawIdempotencyKey?: string,
  ): Promise<SessionSummary> {
    this.assertPermission(
      context,
      SESSION_WRITE_PERMISSION,
      'RECRUITMENT_DELIBERATION_SUBMIT_FORBIDDEN',
    );
    return this.runSessionCommand(
      context,
      'SELECTION_BOARD_SESSION_CANCELLED',
      rawIdempotencyKey,
      sessionId,
      async (transaction, session, previous) => {
        if (previous) return;
        if (session.status !== 'DRAFT') {
          throw new RecruitmentServiceError(
            'Only a draft Session can be cancelled; a started deliberation must complete.',
            409,
            'RECRUITMENT_DELIBERATION_CANCEL_NOT_ALLOWED',
          );
        }
        await transaction.selectionBoardSession.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: sessionId } },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancellationReason: reason,
            updatedByMembershipId: context.membershipId,
            rowVersion: { increment: 1 },
          },
        });
        await this.writeAudit(transaction, context, {
          action: 'SELECTION_BOARD_SESSION_CANCELLED',
          entityType: 'SelectionBoardSession',
          entityId: sessionId,
          previousStatus: 'DRAFT',
          newStatus: 'CANCELLED',
          reason,
          metadata: safeDeliberationAuditMetadata({
            sessionId,
            publicationId: session.vacancyPublicationId,
          }),
          idempotencyKey: rawIdempotencyKey,
        });
      },
    );
  }

  private isDeliberationCandidate(status: string): boolean {
    return ['QUALIFIED', 'FOR_ASSESSMENT', 'FOR_INTERVIEW', 'FOR_DELIBERATION'].includes(status);
  }

  private isRetainedApplication(status: string): boolean {
    return [
      'WITHDRAWN',
      'CLOSED',
      'NOT_QUALIFIED',
      'NOT_RECOMMENDED',
      'RECOMMENDED',
      'SELECTED',
      'NOT_SELECTED',
    ].includes(status);
  }

  private async publicationCriteriaSetId(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    publicationId: string,
  ): Promise<string> {
    const publication = await transaction.vacancyPublication.findFirst({
      where: { agencyId: context.agencyId, id: publicationId },
      select: { request: { select: { criteriaSetId: true } } },
    });
    if (!publication?.request.criteriaSetId) {
      throw new RecruitmentServiceError(
        'The Recruitment Case has no bound Merit Selection Criteria Set.',
        409,
        'RECRUITMENT_SELECTION_PLAN_MISSING',
      );
    }
    return publication.request.criteriaSetId;
  }

  private resolvedRosterFromSession(session: SessionRecord): ResolvedRoster {
    const votingSeats = new Set(
      session.rosterMembers.filter(({ isVoting }) => isVoting).map(({ seatCode }) => seatCode),
    ).size;
    return {
      boardCode: session.boardDefinition.boardCode,
      boardVersionNo: session.boardDefinition.versionNo,
      rows: session.rosterMembers.map((member) => ({
        boardAppointmentId: member.boardAppointmentId,
        membershipId: member.membershipId,
        seatCode: member.seatCode,
        boardRole: boardRole(member.boardRole),
        appointmentKind: member.appointmentKind,
        isVoting: member.isVoting,
      })),
      votingSeats,
      nationalFloor: nationalQuorumFloor(votingSeats),
      configuredMinimum: configuredQuorumMinimum(session.boardDefinition.quorumDefinition),
    };
  }

  private computeQuorum(
    session: SessionRecord,
    roster: ResolvedRoster,
    applicationId: string,
  ): {
    votingSeats: number;
    nationalFloor: number;
    eligibleVotingMembers: number;
    requiredVotingMembers: number;
    presentVotingMembers: number;
    satisfied: boolean;
  } {
    const participation = new Map(
      session.participations.map((record) => [record.membershipId, record]),
    );
    const conflicted = new Set(
      session.conflicts
        .filter((conflict) => conflict.applicationId === applicationId && conflict.hasConflict)
        .map((conflict) => conflict.participation.membershipId),
    );
    const votingRows = roster.rows.filter(({ isVoting }) => isVoting);
    const seatCodes = [...new Set(votingRows.map(({ seatCode }) => seatCode))];
    let eligible = 0;
    let present = 0;
    for (const seatCode of seatCodes) {
      const candidates = votingRows
        .filter((row) => row.seatCode === seatCode)
        .sort(
          (left, right) =>
            Number(isAlternateAppointment(left.appointmentKind)) -
            Number(isAlternateAppointment(right.appointmentKind)),
        );
      const eligibleCandidates = candidates.filter((candidate) => {
        const record = participation.get(candidate.membershipId);
        return record?.attendanceStatus !== 'RECUSED' && !conflicted.has(candidate.membershipId);
      });
      if (eligibleCandidates.length > 0) eligible += 1;
      const acting = eligibleCandidates.find(
        (candidate) => participation.get(candidate.membershipId)?.attendanceStatus === 'PRESENT',
      );
      if (acting) present += 1;
    }
    const required = Math.max(roster.nationalFloor, roster.configuredMinimum);
    return {
      votingSeats: seatCodes.length,
      nationalFloor: roster.nationalFloor,
      eligibleVotingMembers: eligible,
      requiredVotingMembers: required,
      presentVotingMembers: present,
      satisfied: present >= required,
    };
  }

  private async resolveRoster(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    boardDefinitionId: string,
    sessionDate: string,
  ): Promise<ResolvedRoster> {
    const board = await transaction.boardDefinition.findFirst({
      where: { agencyId: context.agencyId, id: boardDefinitionId },
      select: {
        id: true,
        boardCode: true,
        versionNo: true,
        seatDefinition: true,
        quorumDefinition: true,
      },
    });
    if (!board) throw this.notFound('Board Definition');
    const seats = parseBoardSeatDefinition(board.seatDefinition);
    if (
      seats.length === 0 ||
      new Set(seats.map(({ seatCode }) => seatCode)).size !== seats.length
    ) {
      throw new RecruitmentServiceError(
        'The HRMPSB Board Definition must contain unique configured seats.',
        409,
        'RECRUITMENT_BOARD_INVALID',
      );
    }
    const asOf = date(sessionDate);
    const appointments = await transaction.boardAppointment.findMany({
      where: {
        agencyId: context.agencyId,
        boardDefinitionId,
        status: 'ACTIVE',
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
        membership: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        seatCode: true,
        membershipId: true,
        appointmentKind: true,
        authorityDocumentVersionId: true,
      },
      orderBy: { createdAt: 'asc' as const },
    });
    const rows: ResolvedRosterRow[] = [];
    for (const seat of seats) {
      const seatAppointments = appointments.filter(
        (appointment) => appointment.seatCode === seat.seatCode,
      );
      const principals = seatAppointments.filter(
        (appointment) => !isAlternateAppointment(appointment.appointmentKind),
      );
      if (principals.length > 1) {
        throw new RecruitmentServiceError(
          'Every HRMPSB seat must resolve to exactly one principal appointment.',
          409,
          'RECRUITMENT_BOARD_APPOINTMENT_AMBIGUOUS',
        );
      }
      if (seat.required && principals.length === 0) {
        throw new RecruitmentServiceError(
          'Every required HRMPSB seat must resolve to an active appointment.',
          409,
          'RECRUITMENT_BOARD_APPOINTMENT_MISSING',
        );
      }
      for (const appointment of [
        ...principals,
        ...seatAppointments.filter((candidate) =>
          isAlternateAppointment(candidate.appointmentKind),
        ),
      ]) {
        rows.push({
          boardAppointmentId: appointment.id,
          membershipId: appointment.membershipId,
          seatCode: seat.seatCode,
          boardRole: seat.boardRole,
          appointmentKind: appointment.appointmentKind,
          isVoting: seat.voting,
        });
      }
    }
    if (new Set(rows.map(({ membershipId }) => membershipId)).size !== rows.length) {
      throw new RecruitmentServiceError(
        'One HRMPSB member cannot occupy more than one seat or act as both voting member and secretariat.',
        409,
        'RECRUITMENT_BOARD_MEMBER_DUPLICATED',
      );
    }
    for (const row of rows) {
      const appointment = appointments.find(({ id }) => id === row.boardAppointmentId);
      if (
        !appointment?.authorityDocumentVersionId ||
        !(await this.documents.resolveFinalizedVersionInTransaction(
          transaction,
          { agencyId: context.agencyId },
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
    const votingSeats = new Set(
      rows.filter(({ isVoting }) => isVoting).map(({ seatCode }) => seatCode),
    ).size;
    const configuredMinimum = configuredQuorumMinimum(board.quorumDefinition);
    const nationalFloor = nationalQuorumFloor(votingSeats);
    const required = Math.max(nationalFloor, configuredMinimum);
    if (votingSeats === 0 || required > votingSeats) {
      throw new RecruitmentServiceError(
        'The HRMPSB quorum configuration cannot exceed its voting seats and must never fall below the national majority floor.',
        409,
        'RECRUITMENT_BOARD_QUORUM_INVALID',
      );
    }
    return {
      boardCode: board.boardCode,
      boardVersionNo: board.versionNo,
      rows,
      votingSeats,
      nationalFloor,
      configuredMinimum,
    };
  }

  private async buildReportData(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    session: SessionRecord,
  ): Promise<Prisma.InputJsonValue> {
    const applications: ApplicationSummary[] = [];
    for (const quorum of session.quorumSnapshots) {
      const record = await transaction.application.findFirst({
        where: { agencyId: context.agencyId, id: quorum.applicationId },
        select: applicationSelect,
      });
      if (record) applications.push(applicationSummary(record));
    }
    return {
      session: {
        id: session.id,
        sessionDate: formatDate(session.sessionDate),
        status: session.status,
        publicationId: session.vacancyPublicationId,
        publicationNo: `PUB-${String(session.publication.publicationNo).padStart(6, '0')}`,
        requestNo: `RTF-${String(session.publication.request.requestNo).padStart(6, '0')}`,
        itemNumber: session.publication.request.position.itemNumber,
        boardCode: session.boardDefinition.boardCode,
        boardVersionNo: session.boardDefinition.versionNo,
      },
      roster: session.rosterMembers.map((member) => ({
        seatCode: member.seatCode,
        boardRole: member.boardRole,
        appointmentKind: member.appointmentKind,
        isVoting: member.isVoting,
        membershipId: member.membershipId,
      })),
      participation: session.participations.map((participation) => ({
        membershipId: participation.membershipId,
        boardRole: participation.boardRole,
        attendanceStatus: participation.attendanceStatus,
        signedAt: formatDateTime(participation.signedAt),
      })),
      conflicts: session.conflicts.map((conflict) => ({
        membershipId: conflict.participation.membershipId,
        applicationId: conflict.applicationId,
        hasConflict: conflict.hasConflict,
        details: conflict.details,
      })),
      quorum: session.quorumSnapshots.map(quorumSummary),
      recommendations: session.recommendations.map(recommendationSummary),
      applications: applications.map((application) => ({
        applicationId: application.id,
        applicationNo: application.applicationNo,
        applicantName: application.applicant.fullName,
        status: application.status,
        selectionPlan: application.selectionPlan,
        assessments: application.assessments.map((assessment) => ({
          stageCode: assessment.stageCode,
          status: assessment.status,
          aggregate: assessment.aggregate,
        })),
        interviews: application.interviews.map((interview) => ({
          stageCode: interview.stageCode,
          status: interview.status,
          aggregate: interview.aggregate,
        })),
      })),
    } as unknown as Prisma.InputJsonValue;
  }

  private async runSessionCommand(
    context: RequestContext,
    action: string,
    rawIdempotencyKey: string | undefined,
    sessionId: string,
    command: (
      transaction: Prisma.TransactionClient,
      session: SessionRecord,
      previous: { entityId: string; metadata: Prisma.JsonValue } | null,
    ) => Promise<void>,
  ): Promise<SessionSummary> {
    return withDatabaseContext(
      requestDatabaseContext(context, 'recruitment-transition'),
      async (transaction) => {
        const session = await this.lockSession(transaction, context.agencyId, sessionId);
        if (!session) throw this.notFound('Selection Board Session');
        const previous = await this.idempotentEvent(
          transaction,
          context,
          action,
          rawIdempotencyKey,
        );
        await command(transaction, session, previous);
        return sessionSummary(await this.requireSession(transaction, context.agencyId, sessionId));
      },
    );
  }

  private async lockSession(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    sessionId: string,
  ): Promise<SessionRecord | null> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "selection_board_sessions" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${sessionId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) return null;
    return this.requireSession(transaction, agencyId, sessionId);
  }

  private async requireSession(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    sessionId: string,
  ): Promise<SessionRecord> {
    const record = await transaction.selectionBoardSession.findFirst({
      where: { agencyId, id: sessionId },
      select: sessionSelect,
    });
    if (!record) throw this.notFound('Selection Board Session');
    return record;
  }

  private async lockPublication(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    publicationId: string,
  ): Promise<{
    id: string;
    status: string;
    request: { boardDefinitionId: string | null; criteriaSetId: string | null };
  } | null> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "vacancy_publications" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${publicationId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) return null;
    return transaction.vacancyPublication.findFirst({
      where: { agencyId, id: publicationId },
      select: {
        id: true,
        status: true,
        request: { select: { boardDefinitionId: true, criteriaSetId: true } },
      },
    });
  }

  private async requireFinalizedDocumentVersion(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    documentVersionId: string,
    errorCode: string,
  ): Promise<{ id: string }> {
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
    return { id: version.id };
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

  private workflowError(action: string, status: string): RecruitmentServiceError {
    return new RecruitmentServiceError(
      `A Session in ${status} cannot ${action}.`,
      409,
      'RECRUITMENT_DELIBERATION_TRANSITION_NOT_ALLOWED',
    );
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
