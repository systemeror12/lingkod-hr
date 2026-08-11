import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { getConfig } from '@lingkod-hr/config';
import {
  createRequestId,
  log,
  requestDuration,
  startTelemetry,
  tracer,
} from '@lingkod-hr/observability';
import { AppModule } from './app.module';

async function bootstrap() {
  const config = getConfig();
  await startTelemetry('lingkod-hr-api');
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: new URL(config.APP_URL).origin, credentials: true });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const requestId = request.header('x-request-id') ?? createRequestId();
    request.headers['x-request-id'] = requestId;
    const startedAt = performance.now();
    const span = tracer.startSpan(`${request.method} ${request.path}`);

    response.setHeader('x-request-id', requestId);
    response.on('finish', () => {
      const durationMs = Math.round(performance.now() - startedAt);
      requestDuration.record(durationMs, {
        'http.request.method': request.method,
        'http.response.status_code': response.statusCode,
      });
      span.setAttribute('http.response.status_code', response.statusCode);
      span.setAttribute('http.request.id', requestId);
      span.end();
      log('info', 'request.completed', {
        requestId,
        method: request.method,
        route: request.path,
        statusCode: response.statusCode,
        durationMs,
      });
    });
    next();
  });

  await app.listen(config.API_PORT, '0.0.0.0');
  log('info', 'api.listening', { port: config.API_PORT });
}

void bootstrap().catch((error: unknown) => {
  log('error', 'api.startup_failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
