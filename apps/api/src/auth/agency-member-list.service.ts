import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';

/** A row of the Users & Access member list. */
export interface AgencyMember {
  membershipId: string;
  userId: string;
  displayName: string | null;
  email: string;
  membershipStatus: string;
  globalStatus: string;
  /**
   * A Global User Lock as this Agency may see it: whether this Agency placed it and whether this
   * Agency may lift it. Never which other Agency placed it, or why.
   */
  lock: { byThisAgency: boolean; unlockable: boolean } | null;
  hasAuthenticator: boolean;
}

/**
 * Of the given Users, those locked by another Agency that no longer has them as an ACTIVE member,
 * whose lock the acting Agency may therefore lift (#364). Answers ids only: the locking Agency and
 * its memberships stay hidden.
 */
export async function liftedLockUserIds(
  transaction: Prisma.TransactionClient,
  userIds: string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await transaction.$queryRaw<{ user_id: string }[]>`
    SELECT "user_id"
    FROM app_agency_member_lifted_lock_user_ids(${userIds}::uuid[]) AS "user_id"`;
  return new Set(rows.map(({ user_id }) => user_id));
}

/** The Users & Access member list (#468): everyone with a membership in the acting Agency. */
@Injectable()
export class AgencyMemberListService {
  /** One page in name order; `nextCursor` is the last row's membership id while more follow. */
  async list(
    context: RequestContext,
    input: { cursor?: string | undefined; limit: number } = { limit: 50 },
  ): Promise<{ members: AgencyMember[]; nextCursor: string | null }> {
    return withDatabaseContext(context, async (transaction) => {
      const rows = await transaction.agencyMembership.findMany({
        where: { agencyId: context.agencyId },
        select: {
          id: true,
          status: true,
          user: {
            select: {
              id: true,
              displayName: true,
              emailNormalized: true,
              globalStatus: true,
              lockedByAgencyId: true,
            },
          },
        },
        orderBy: [
          { user: { displayName: 'asc' } },
          { user: { emailNormalized: 'asc' } },
          { id: 'asc' },
        ],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, input.limit);
      const userIds = page.map(({ user }) => user.id);
      const lifted = await liftedLockUserIds(
        transaction,
        page
          .filter(({ user }) => user.lockedByAgencyId && user.lockedByAgencyId !== context.agencyId)
          .map(({ user }) => user.id),
      );
      // Factor rows hold secrets, so the Agency Context learns only which members have one.
      const withFactor = new Set(
        (
          await transaction.$queryRaw<{ user_id: string }[]>`
            SELECT "user_id" FROM app_agency_member_factor_user_ids() AS "user_id"
            WHERE "user_id" = ANY(${userIds}::uuid[])`
        ).map(({ user_id }) => user_id),
      );
      return {
        members: page.map(({ id, status, user }) => {
          const byThisAgency = user.lockedByAgencyId === context.agencyId;
          return {
            membershipId: id,
            userId: user.id,
            displayName: user.displayName,
            email: user.emailNormalized,
            membershipStatus: status,
            globalStatus: user.globalStatus,
            lock: user.lockedByAgencyId
              ? {
                  byThisAgency,
                  unlockable: status === 'ACTIVE' && (byThisAgency || lifted.has(user.id)),
                }
              : null,
            hasAuthenticator: withFactor.has(user.id),
          };
        }),
        nextCursor: rows.length > input.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }
}
