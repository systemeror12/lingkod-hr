import type { RequestContext } from '@lingkod-hr/auth';
import type { DatabaseCapability, DatabaseContext } from '@lingkod-hr/database';

export function requestDatabaseContext(
  context: RequestContext,
  ...capabilities: DatabaseCapability[]
): DatabaseContext {
  return {
    agencyId: context.agencyId,
    userId: context.userId,
    membershipId: context.membershipId,
    ...(capabilities.length > 0 ? { capabilities } : {}),
  };
}
