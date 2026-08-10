import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getConfig } from '@lingkod-hr/config';
import { log, startTelemetry } from '@lingkod-hr/observability';
import { AppModule } from './app.module';

async function bootstrap() {
  const config = getConfig();
  await startTelemetry('lingkod-hr-worker');
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  await app.listen(config.WORKER_PORT, '0.0.0.0');
  log('info', 'worker.listening', { port: config.WORKER_PORT });
}

void bootstrap().catch((error: unknown) => {
  log('error', 'worker.startup_failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
