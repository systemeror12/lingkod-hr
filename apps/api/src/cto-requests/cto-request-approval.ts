import type { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import {
  ApprovalServiceError,
  type ApprovalCompletionRegistry,
  type ApprovalRouteSummary,
  type ApprovalsService,
} from '../approvals/approval.service';
import {
  APPROVE_PERMISSION,
  CTO_REQUEST_APPROVAL_SUBJECT_TYPE,
  CTO_REQUEST_ROUTE_CODE,
  CtoRequestError,
  RECOMMEND_PERMISSION,
  REJECT_PERMISSION,
  RETURN_PERMISSION,
} from './cto-requests.types';

/**
 * Keep the generic Approval API from closing route work under a request that still
 * awaits it: cancelling is allowed only once the module has closed the request, or
 * while it sits returned as a DRAFT. The generic API cannot decide a CTO Request at
 * all (`MODULE_DECIDED_SUBJECT_TYPES`), so the only final approval is the module's
 * own, whose service takes the effect in the same transaction. Its handler has
 * nothing left to do.
 */
export function registerCtoRequestApproval(registry: ApprovalCompletionRegistry): void {
  registry.register(CTO_REQUEST_APPROVAL_SUBJECT_TYPE, async () => {});
  registry.registerCancel(
    CTO_REQUEST_APPROVAL_SUBJECT_TYPE,
    async (transaction, _context, request) => {
      const subject = await transaction.ctoRequest.findFirst({
        where: { agencyId: request.agencyId, id: request.subjectId },
        select: { status: true },
      });
      if (subject?.status !== 'DRAFT' && subject?.status !== 'CANCELLED') {
        throw new ApprovalServiceError(
          'A CTO Request Approval Request closes only when the request is withdrawn, discarded, or resubmitted.',
          409,
          'CTO_REQUEST_APPROVAL_CANCEL_FORBIDDEN',
        );
      }
    },
  );
}

/**
 * Resolve the Agency's active CTO Request route. hris-controls §5.19 has two
 * actors, so the route has exactly two steps: the Supervisor recommends and returns,
 * then the Approving Official approves, rejects, and returns.
 */
export async function resolveCtoRequestRoute(
  approvals: ApprovalsService,
  transaction: Prisma.TransactionClient,
  context: RequestContext,
): Promise<ApprovalRouteSummary> {
  const route = await approvals.resolveActiveRouteInTransaction(
    transaction,
    context,
    CTO_REQUEST_ROUTE_CODE,
  );
  const [recommend, approve, ...rest] = route.stepDefinition.steps;
  const valid =
    recommend !== undefined &&
    approve !== undefined &&
    rest.length === 0 &&
    (recommend.approvePermission ?? recommend.requiredPermission) === RECOMMEND_PERMISSION &&
    (recommend.returnPermission ?? recommend.requiredPermission) === RETURN_PERMISSION &&
    (approve.approvePermission ?? approve.requiredPermission) === APPROVE_PERMISSION &&
    (approve.rejectPermission ?? approve.requiredPermission) === REJECT_PERMISSION &&
    (approve.returnPermission ?? approve.requiredPermission) === RETURN_PERMISSION;
  if (!valid) {
    throw new CtoRequestError(
      `The ${CTO_REQUEST_ROUTE_CODE} Approval Route must have two steps: one that recommends with ${RECOMMEND_PERMISSION}, and one that approves with ${APPROVE_PERMISSION} and rejects with ${REJECT_PERMISSION}. Both return with ${RETURN_PERMISSION}.`,
      409,
      'CTO_REQUEST_ROUTE_INVALID',
    );
  }
  return route;
}
