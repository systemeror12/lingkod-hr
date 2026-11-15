import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { prisma, withDatabaseContext } from '@lingkod-hr/database';
import { log } from '@lingkod-hr/observability';
import { AttendanceDeficitChargesService } from './attendance-deficit-charges.service';

const INTERVAL_MS = 5 * 60 * 1000;

/**
 * The outbox consumer of Attendance Period Locks and Locked Attendance
 * Adjustments (ADR 0012). Attendance never calls Leave: on start and five
 * minutes after each pass ends, this charges every publication of an Agency
 * that has locked attendance and still has a TARDINESS or UNDERTIME fact owed
 * a charge. Charging is idempotent under the Leave Account lock, so several
 * API processes or a missed pass need no queue, and a fact left uncharged for
 * want of an account or authority is tried again on the next pass.
 *
 * It runs in the API process because the charge is Leave's application
 * service, which calls Attendance and Payroll through theirs.
 */
@Injectable()
export class AttendanceDeficitChargeConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;

  constructor(
    @Inject(AttendanceDeficitChargesService)
    private readonly charges: AttendanceDeficitChargesService,
  ) {}

  onApplicationBootstrap() {
    this.running = this.tick();
  }

  async onApplicationShutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  /** One pass over every Agency; each publication's failure is logged and retried next pass. */
  async runOnce(): Promise<{ publications: number; failed: number }> {
    let publications = 0;
    let failed = 0;
    for (const agencyId of await deficitChargeAgencyIds()) {
      for (const publicationId of await duePublicationIds(agencyId)) {
        try {
          await this.charges.chargePublication(
            {
              agencyId,
              requestId: `deficit-charge-consumer:${publicationId}`,
              userId: null,
              membershipId: null,
            },
            publicationId,
          );
          publications += 1;
        } catch (error: unknown) {
          failed += 1;
          log('error', 'api.attendance_deficit_charge_failed', {
            agencyId,
            publicationId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    return { publications, failed };
  }

  private async tick(): Promise<void> {
    try {
      log('info', 'api.attendance_deficit_charge_pass_finished', await this.runOnce());
    } catch (error: unknown) {
      log('error', 'api.attendance_deficit_charge_pass_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (!this.stopped) {
      this.timer = setTimeout(() => {
        this.running = this.tick();
      }, INTERVAL_MS);
    }
  }
}

/** Agencies with an Attendance Period Lock outbox event, across Agency isolation. */
export async function deficitChargeAgencyIds(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ agency_id: string }[]>`
    SELECT agency_id FROM attendance_deficit_charge_agencies()
  `;
  return rows.map((row) => row.agency_id);
}

/**
 * Publications of one Agency with a TARDINESS or UNDERTIME fact that has no
 * charge and that no later publication replaced: a fact with minutes, or an
 * adjustment fact whose earlier charge it may correct. The service decides
 * each fact; this only narrows the pass.
 */
export async function duePublicationIds(agencyId: string): Promise<string[]> {
  const rows = await withDatabaseContext(
    { agencyId },
    (transaction) => transaction.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT f."attendance_payroll_publication_id" AS "id"
      FROM "attendance_payroll_facts" f
      WHERE f."agency_id" = CAST(${agencyId} AS uuid)
        AND f."fact_type" IN ('TARDINESS', 'UNDERTIME')
        AND (f."corrected_minutes" > 0 OR f."prior_minutes" IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM "attendance_deficit_charges" c
          WHERE c."agency_id" = f."agency_id" AND c."attendance_payroll_fact_id" = f."id"
        )
        AND NOT EXISTS (
          SELECT 1 FROM "attendance_payroll_facts" later
          WHERE later."agency_id" = f."agency_id"
            AND later."stable_source_key" = f."stable_source_key"
            AND later."created_at" > f."created_at"
        )
    `,
  );
  return rows.map((row) => row.id);
}
