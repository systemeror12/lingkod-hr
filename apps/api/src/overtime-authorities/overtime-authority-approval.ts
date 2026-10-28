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
 * with its request in one transaction.
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
}

/**
 * Resolve the Agency's active Overtime Authority route. Every step must
 * approve with `overtime.authorities.approve` and reject with `.reject`, so
 * the route cannot hand the decision to another permission.
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
  const valid = route.stepDefinition.steps.every(
    (step) =>
      (step.approvePermission ?? step.requiredPermission) === APPROVE &&
      (step.rejectPermission ?? step.requiredPermission) === REJECT,
  );
  if (!valid) {
    throw new OvertimeAuthorityServiceError(
      `Every step of the ${OVERTIME_AUTHORITY_ROUTE_CODE} Approval Route must approve with ${APPROVE} and reject with ${REJECT}.`,
      409,
      'OVERTIME_AUTHORITY_ROUTE_INVALID',
    );
  }
  return route;
}
