import { randomUUID } from 'node:crypto';
import { metrics, trace } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogAttributes = Record<string, unknown>;

export const tracer = trace.getTracer('lingkod-hr');
export const meter = metrics.getMeter('lingkod-hr');
export const requestDuration = meter.createHistogram('http.server.duration', {
  description: 'Duration of HTTP requests handled by LingkodHR processes.',
  unit: 'ms',
});

export async function startTelemetry(serviceName: string): Promise<void> {
  process.env.OTEL_SERVICE_NAME ??= serviceName;
  const sdk = new NodeSDK();
  await Promise.resolve(sdk.start());
}

export function createRequestId(): string {
  return `req_${randomUUID()}`;
}

export function log(level: LogLevel, message: string, attributes: LogAttributes = {}): void {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: process.env.OTEL_SERVICE_NAME ?? 'lingkod-hr',
      message,
      ...attributes,
    })}\n`,
  );
}
