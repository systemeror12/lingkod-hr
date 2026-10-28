import type { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import {
  ApprovalServiceError,
  type ApprovalCompletionRegistry,
  type ApprovalEffectContext,
  type ApprovalRouteSummary,
  type ApprovalsService,
} from '../approvals/approval.service';
import {
  OVERTIME_AUTHORITY_APPROVAL_EFFECT_KIND,
  OVERTIME_AUTHORITY_APPROVAL_SUBJECT_TYPE,
  OVERTIME_AUTHORITY_ROUTE_CODE,
  OvertimeAuthorityServiceError,
} from './overtime-authorities.types';

const APPROVE = 'overtime.authorities.approve';
const REJECT = 'overtime.authorities.reject';

export const overtimeAuthorityEffect: ApprovalEffectContext = {
  kind: OVERTIME_AUTHORITY_APPROVAL_EFFECT_KIND,
  payload: null,
};

/**
 * Make the generic Approval API fail closed for Overtime Authorities: approval
 * and rejection must go through the Overtime module, which moves the authority
 * with its request in one transaction. Cancelling the request is refused
 * outright, since nothing could then move the authority out of FOR_REVIEW.
 */
export function registerOvertimeAuthorityApproval(registry: ApprovalCompletionRegistry): void {
  const guard = async (
    _transaction: Prisma.TransactionClient,
    _context: RequestContext,
    request: { effectContext?: ApprovalEffectContext },
  ) => {
    if (request.effectContext?.kind !== OVERTIME_AUTHORITY_APPROVAL_EFFECT_KIND) {
      throw new ApprovalServiceError(
        'Decide an Overtime Authority through the Overtime module.',
        409,
        'OVERTIME_AUTHORITY_APPROVAL_EFFECT_REQUIRED',
      );
    }
  };
  registry.register(OVERTIME_AUTHORITY_APPROVAL_SUBJECT_TYPE, guard);
  registry.registerDecision(OVERTIME_AUTHORITY_APPROVAL_SUBJECT_TYPE, guard);
  registry.registerCancel(OVERTIME_AUTHORITY_APPROVAL_SUBJECT_TYPE, async () => {
    throw new ApprovalServiceError(
      'An Overtime Authority Approval Request cannot be cancelled; approve or reject the authority.',
      409,
      'OVERTIME_AUTHORITY_APPROVAL_CANCEL_FORBIDDEN',
    );
  });
}

/**
 * Resolve the Agency's active Overtime Authority route. hris-controls §5.16
 * names one Approving Official, so the route has exactly one step, which
 * approves with `overtime.authorities.approve` and rejects with `.reject`.
 */
export async function resolveOvertimeAuthorityRoute(
  approvals: ApprovalsService,
  transaction: Prisma.TransactionClient,
  context: RequestContext,
): Promise<ApprovalRouteSummary> {
  const route = await approvals.resolveActiveRouteInTransaction(
    transaction,
    context,
    OVERTIME_AUTHORITY_ROUTE_CODE,
  );
  const [step, ...rest] = route.stepDefinition.steps;
  const valid =
    step !== undefined &&
    rest.length === 0 &&
    (step.approvePermission ?? step.requiredPermission) === APPROVE &&
    (step.rejectPermission ?? step.requiredPermission) === REJECT;
  if (!valid) {
    throw new OvertimeAuthorityServiceError(
      `The ${OVERTIME_AUTHORITY_ROUTE_CODE} Approval Route must have one step that approves with ${APPROVE} and rejects with ${REJECT}.`,
      409,
      'OVERTIME_AUTHORITY_ROUTE_INVALID',
    );
  }
  return route;
}
