import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { prisma } from '@lingkod-hr/database';
import { log } from '@lingkod-hr/observability';
import { PayslipGenerationService } from './payslip-generation.service';

const INTERVAL_MS = 60_000;

/**
 * The consumer of `PAYROLL_PERIOD_FINALIZED` Outbox Events. On start and a
 * minute after each pass ends, it generates the Payslips of every finalized
 * period with a FINALIZED result whose Payslip is missing or still
 * GENERATING. Generation is idempotent, so several API processes, a repeated
 * pass, or a failed file need no other queue: what failed is due again on the
 * next pass.
 *
 * It runs in the API process, like the payroll calculation job and the
 * Attendance Deficit Charge consumer, because the file goes through the
 * shared document service there.
 */
@Injectable()
export class PayslipGenerationJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;

  constructor(
    @Inject(PayslipGenerationService) private readonly payslips: PayslipGenerationService,
  ) {}

  onApplicationBootstrap() {
    this.running = this.tick();
  }

  async onApplicationShutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  /** One pass over every period with Payslips due. */
  async runOnce(): Promise<{ ready: number; failed: number }> {
    let ready = 0;
    let failed = 0;
    for (const { agencyId, payrollPeriodId } of await duePayslipPeriods()) {
      const pass = await this.payslips.generateForPeriod(agencyId, payrollPeriodId);
      ready += pass.ready;
      failed += pass.failed;
    }
    return { ready, failed };
  }

  private async tick(): Promise<void> {
    try {
      const pass = await this.runOnce();
      if (pass.ready > 0 || pass.failed > 0) {
        log('info', 'api.payslip_generation_pass_finished', pass);
      }
    } catch (error: unknown) {
      log('error', 'api.payslip_generation_pass_failed', {
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

/** Every finalized period with a Payslip to generate, across Agency isolation (migration 0185). */
export async function duePayslipPeriods(): Promise<
  { agencyId: string; payrollPeriodId: string }[]
> {
  const rows = await prisma.$queryRaw<{ agency_id: string; payroll_period_id: string }[]>`
    SELECT agency_id, payroll_period_id FROM payslips_due()
  `;
  return rows.map((row) => ({ agencyId: row.agency_id, payrollPeriodId: row.payroll_period_id }));
}
