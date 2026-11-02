import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { log } from '@lingkod-hr/observability';
import { manilaToday, runCocExpiry } from './coc-expiry.job';

const INTERVAL_MS = 60 * 60 * 1000;

/**
 * Runs the COC expiry on start and hourly after each run ends. The database
 * makes repeats harmless, so several workers or a missed hour need no queue.
 */
@Injectable()
export class CocExpiryScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;

  onApplicationBootstrap() {
    this.running = this.tick();
  }

  async onApplicationShutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private async tick(): Promise<void> {
    try {
      log('info', 'worker.coc_expiry_finished', await runCocExpiry(manilaToday()));
    } catch (error: unknown) {
      log('error', 'worker.coc_expiry_failed', {
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
