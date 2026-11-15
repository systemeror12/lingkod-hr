import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { prisma } from '@lingkod-hr/database';
import { log } from '@lingkod-hr/observability';
import { type CalculationJob, PayrollCalculationService } from './payroll-calculation.service';

const INTERVAL_MS = 5_000;

/**
 * The queue of payroll calculations. Starting a calculation commits the
 * period as `CALCULATING` at its new version, and that row is the queued job:
 * on start and five seconds after each pass ends, this runs every period
 * still `CALCULATING`. The run locks its period and checks the version, so
 * several API processes, a repeated pass, or a process that died mid-run need
 * no other queue.
 *
 * It runs in the API process, like the Attendance Deficit Charge consumer,
 * because each calculator is a Payroll domain service there and reads
 * Personnel through Personnel's application service.
 */
@Injectable()
export class PayrollCalculationJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;

  constructor(
    @Inject(PayrollCalculationService) private readonly calculation: PayrollCalculationService,
  ) {}

  onApplicationBootstrap() {
    this.running = this.tick();
  }

  async onApplicationShutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  /** One pass over every queued calculation. */
  async runOnce(): Promise<{ calculated: number; skipped: number }> {
    let calculated = 0;
    let skipped = 0;
    for (const job of await dueCalculations()) {
      const result = await this.calculation.run(job);
      if (result.outcome === 'SKIPPED') skipped += 1;
      else calculated += 1;
    }
    return { calculated, skipped };
  }

  private async tick(): Promise<void> {
    try {
      const pass = await this.runOnce();
      if (pass.calculated > 0) log('info', 'api.payroll_calculation_pass_finished', pass);
    } catch (error: unknown) {
      log('error', 'api.payroll_calculation_pass_failed', {
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

/** Every CALCULATING period, across Agency isolation (migration 0162). */
export async function dueCalculations(): Promise<CalculationJob[]> {
  const rows = await prisma.$queryRaw<
    { agency_id: string; payroll_period_id: string; calculation_version: number }[]
  >`SELECT agency_id, payroll_period_id, calculation_version FROM payroll_calculations_due()`;
  return rows.map((row) => ({
    agencyId: row.agency_id,
    payrollPeriodId: row.payroll_period_id,
    calculationVersion: row.calculation_version,
  }));
}
