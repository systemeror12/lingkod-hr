import { prisma, withDatabaseContext } from '@lingkod-hr/database';
import { log } from '@lingkod-hr/observability';

/** Today in Asia/Manila, the date COC validity is counted by. */
export function manilaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Expire all COC whose Valid Until is before `asOf`, across Agencies, each
 * account in its own transaction and Agency Context. One account's failure is
 * logged and left for the next run, which finds it due again.
 */
export async function runCocExpiry(asOf: string): Promise<{ posted: number; failed: number }> {
  const due = await prisma.$queryRaw<
    { agency_id: string; coc_account_id: string; valid_until: string }[]
  >`
    SELECT agency_id, coc_account_id, valid_until::text AS valid_until
    FROM coc_expiries_due(CAST(${asOf} AS date))
  `;

  let posted = 0;
  let failed = 0;
  for (const {
    agency_id: agencyId,
    coc_account_id: cocAccountId,
    valid_until: validUntil,
  } of due) {
    try {
      const [row] = await withDatabaseContext(
        { agencyId },
        (transaction) =>
          transaction.$queryRaw<{ id: string | null }[]>`
          SELECT post_coc_expiry(
            CAST(${agencyId} AS uuid),
            CAST(${cocAccountId} AS uuid),
            CAST(${validUntil} AS date),
            CAST(${asOf} AS date)
          ) AS "id"
        `,
      );
      if (row?.id) posted += 1;
    } catch (error: unknown) {
      failed += 1;
      log('error', 'worker.coc_expiry_account_failed', {
        agencyId,
        cocAccountId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { posted, failed };
}
