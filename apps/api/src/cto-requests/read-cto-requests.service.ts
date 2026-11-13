import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { AttendanceCorrectionsService } from '../attendance-corrections/attendance-corrections.service';
import { requestDatabaseContext } from '../database-context';
import { resolveEmployeeScope, scopeCovers, type EmployeeScope } from '../employee-scope';
import { findRequests, readRequest } from './cto-request.records';
import {
  CTO_REQUEST_APPROVAL_SUBJECT_TYPE,
  CtoRequestError,
  READ_PERMISSION,
  type CtoRequestDetail,
  type CtoRequestListFilter,
  type CtoRequestPendingAction,
  type CtoRequestRecord,
  type CtoRequestStatus,
  type CtoRequestSummary,
} from './cto-requests.types';

const ENTITY_TYPE = 'CtoRequest';

/**
 * Read CTO Requests with `overtime.coc.read` within the reader's scope: an Employee
 * reads their own, a Supervisor their direct reports', and an Agency grant every
 * request (hris-controls §5.19, Project Decision #545). A cancelled Work Date handed to
 * Attendance carries that correction's live status from Attendance, not the request's.
 * Reading writes nothing.
 */
@Injectable()
export class ReadCtoRequestsService {
  constructor(
    @Inject(AttendanceCorrectionsService)
    private readonly corrections: AttendanceCorrectionsService,
  ) {}

  async list(context: RequestContext, filter: CtoRequestListFilter): Promise<CtoRequestRecord[]> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const scope = await readScope(transaction, context);
      const requests = await findRequests(transaction, context.agencyId, {
        ...(filter.status ? { status: filter.status } : {}),
        ...(scope.kind === 'SCOPED' ? { employeeId: { in: scope.employeeIds } } : {}),
        ...(filter.search
          ? {
              employee: {
                OR: [
                  { legalName: { contains: filter.search, mode: 'insensitive' } },
                  { employeeNumber: { contains: filter.search, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      });
      return this.registerRecords(transaction, context.agencyId, requests);
    });
  }

  /** One request with its Approval decisions and audit history. */
  async detail(context: RequestContext, requestId: string): Promise<CtoRequestDetail> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const scope = await readScope(transaction, context);
      const request = await readRequest(transaction, context.agencyId, requestId);
      if (!scopeCovers(scope, request.employeeId)) {
        throw new CtoRequestError(
          'The Employee is outside the scope of the current Agency Membership.',
          403,
          'CTO_REQUEST_SCOPE_FORBIDDEN',
        );
      }
      const [record] = await this.registerRecords(transaction, context.agencyId, [request]);
      if (!record) throw new Error('The CTO Request record was not built.');
      const [decisions, events] = await Promise.all([
        transaction.approvalDecision.findMany({
          where: {
            agencyId: context.agencyId,
            approvalStep: {
              approvalRequest: {
                subjectType: CTO_REQUEST_APPROVAL_SUBJECT_TYPE,
                subjectId: requestId,
              },
            },
          },
          orderBy: { decidedAt: 'asc' },
          select: {
            id: true,
            decision: true,
            comments: true,
            decidedAt: true,
            approvalStep: { select: { stepNo: true } },
            decidedBy: { select: { user: { select: { displayName: true } } } },
          },
        }),
        transaction.auditEvent.findMany({
          where: { agencyId: context.agencyId, entityType: ENTITY_TYPE, entityId: requestId },
          orderBy: { occurredAt: 'asc' },
          select: {
            id: true,
            action: true,
            previousStatus: true,
            newStatus: true,
            reason: true,
            occurredAt: true,
            actorUser: { select: { displayName: true } },
          },
        }),
      ]);
      return {
        ...record,
        decisions: decisions.map((decision) => ({
          id: decision.id,
          stepNo: decision.approvalStep.stepNo,
          decision: decision.decision,
          comments: decision.comments,
          decidedByName: decision.decidedBy.user.displayName,
          decidedAt: decision.decidedAt.toISOString(),
        })),
        history: events.map((event) => ({
          id: event.id,
          action: event.action,
          previousStatus: event.previousStatus,
          newStatus: event.newStatus,
          reason: event.reason,
          actorName: event.actorUser?.displayName ?? null,
          occurredAt: event.occurredAt.toISOString(),
        })),
      };
    });
  }

  /** Add the Employee, who acts next on an open request, and each handed-off date's status. */
  private async registerRecords(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    requests: CtoRequestSummary[],
  ): Promise<CtoRequestRecord[]> {
    if (requests.length === 0) return [];
    const correctionIds = requests.flatMap((row) =>
      row.dates.flatMap((date) =>
        date.attendanceCorrectionId ? [date.attendanceCorrectionId] : [],
      ),
    );
    const [employees, approvals, handoffs] = await Promise.all([
      transaction.employee.findMany({
        where: { agencyId, id: { in: [...new Set(requests.map((row) => row.employeeId))] } },
        select: { id: true, employeeNumber: true, legalName: true },
      }),
      transaction.approvalRequest.findMany({
        where: {
          agencyId,
          subjectType: CTO_REQUEST_APPROVAL_SUBJECT_TYPE,
          subjectId: {
            in: requests
              .filter((row) => row.status === 'SUBMITTED' || row.status === 'FOR_APPROVAL')
              .map((row) => row.id),
          },
          status: 'IN_PROGRESS',
        },
        select: {
          subjectId: true,
          currentStepNo: true,
          steps: {
            select: {
              stepNo: true,
              assignedMembership: { select: { user: { select: { displayName: true } } } },
            },
          },
        },
      }),
      this.corrections.ctoInputHandoffStatusesInTransaction(transaction, agencyId, correctionIds),
    ]);
    const byId = new Map(employees.map((employee) => [employee.id, employee]));
    const assignees = new Map(
      approvals.map((approval) => [
        approval.subjectId,
        approval.steps.find((step) => step.stepNo === approval.currentStepNo)?.assignedMembership
          ?.user.displayName ?? null,
      ]),
    );
    return requests.map((request) => {
      const employee = byId.get(request.employeeId);
      return {
        ...request,
        employeeNumber: employee?.employeeNumber ?? '',
        employeeName: employee?.legalName ?? request.employeeId,
        pendingAction: pendingAction(request.status, assignees.get(request.id) ?? null),
        dates: request.dates.map((date) => ({
          ...date,
          attendanceHandoff: date.attendanceCorrectionId
            ? (handoffs.get(date.attendanceCorrectionId) ?? null)
            : null,
        })),
      };
    });
  }
}

async function readScope(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
): Promise<EmployeeScope> {
  const scope = await resolveEmployeeScope(transaction, context, READ_PERMISSION);
  if (scope.kind === 'NONE') {
    throw new CtoRequestError(
      'The current Agency Membership lacks the required permission.',
      403,
      'CTO_REQUEST_READ_FORBIDDEN',
    );
  }
  return scope;
}

function pendingAction(
  status: CtoRequestStatus,
  assigneeName: string | null,
): CtoRequestPendingAction | null {
  if (status === 'DRAFT') return { role: 'REQUESTER', assigneeName: null };
  if (status === 'SUBMITTED') return { role: 'SUPERVISOR', assigneeName };
  if (status === 'FOR_APPROVAL') return { role: 'APPROVING_OFFICIAL', assigneeName };
  return null;
}
