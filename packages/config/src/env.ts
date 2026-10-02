import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { parseProtectedValueKey } from './protected-values';

loadDotenv({ path: resolve(__dirname, '../../../.env') });

const localDefaults = {
  API_PORT: '3001',
  WORKER_PORT: '3002',
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:3001',
  DATABASE_URL: 'postgresql://hris_app:local_app@localhost:55432/hris',
  DATABASE_DIRECT_URL: 'postgresql://hris_migrator:local_migrator@localhost:55432/hris',
  DATABASE_OPERATIONAL_URL: 'postgresql://hris_operator:local_operator@localhost:55432/hris',
  REDIS_URL: 'redis://localhost:6379',
  OIDC_ISSUER: 'http://127.0.0.1:4100',
  OIDC_CLIENT_ID: 'local-client',
  OIDC_CLIENT_SECRET: 'local-client-secret',
  OIDC_REDIRECT_URI: 'http://localhost:3001/api/v1/auth/callback',
  SESSION_SECRET: 'local-development-session-secret-change-me',
  S3_ENDPOINT: 'http://localhost:8333',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'hris-local',
  S3_ACCESS_KEY_ID: 'lingkod_local',
  S3_SECRET_ACCESS_KEY: 'lingkod_local_secret',
  EXTERNAL_EVIDENCE_MAX_SIZE_BYTES: '10485760',
  EXTERNAL_EVIDENCE_ALLOWED_MIME_TYPES: 'application/pdf,image/jpeg,image/png,text/plain',
  EXTERNAL_EVIDENCE_SIGNED_URL_TTL_SECONDS: '300',
  EMAIL_FROM: 'lingkod-hr@localhost.test',
  EMAIL_HOST: 'localhost',
  EMAIL_PORT: '1025',
  EMAIL_SECURE: 'false',
  EMAIL_PROVIDER_API_KEY: 'local-only',
  DATA_ENCRYPTION_KEY: '07'.repeat(32),
  BLIND_INDEX_KEY: 'local-development-blind-index-key-change-me',
};

const emptyStringAsUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
const optionalString = z.preprocess(emptyStringAsUndefined, z.string().min(1).optional());
const optionalUrl = z.preprocess(emptyStringAsUndefined, z.string().url().optional());

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url(),
  API_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive(),
  WORKER_PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().url(),
  DATABASE_DIRECT_URL: z.string().url(),
  DATABASE_OPERATIONAL_URL: z.string().url().optional(),
  REDIS_URL: z.string().url(),
  OIDC_ISSUER: z.string().url(),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  OIDC_REDIRECT_URI: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  EXTERNAL_EVIDENCE_MAX_SIZE_BYTES: z.coerce.number().int().positive().max(104857600),
  EXTERNAL_EVIDENCE_ALLOWED_MIME_TYPES: z.string().min(1),
  EXTERNAL_EVIDENCE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(900),
  OPENAI_API_KEY: optionalString,
  AI_DEFAULT_MODEL: optionalString,
  AI_EMBEDDING_MODEL: optionalString,
  AI_FEATURES_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  EMAIL_FROM: z.string().email(),
  EMAIL_HOST: z.string().min(1),
  EMAIL_PORT: z.coerce.number().int().positive(),
  EMAIL_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  EMAIL_PROVIDER_API_KEY: z.string().min(1),
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
  ERROR_TRACKING_DSN: optionalUrl,
  DATA_ENCRYPTION_KEY: z.string().refine(isProtectedValueKey, {
    message: 'Must be a 32-byte key as 64 hex characters or canonical base64.',
  }),
  BLIND_INDEX_KEY: z.string().min(32),
});

function isProtectedValueKey(value: string): boolean {
  try {
    parseProtectedValueKey(value);
    return true;
  } catch {
    return false;
  }
}

/** Drops blank values so a key left empty in `.env` falls back to its local default. */
function withoutBlankValues(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(([, value]) => emptyStringAsUndefined(value) !== undefined),
  );
}

export type AppConfig = z.infer<typeof configSchema>;

export function parseConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const deploymentEnvironment = environment.APP_ENV ?? environment.NODE_ENV ?? 'development';
  const normalizedEnvironment = {
    ...environment,
    NODE_ENV: deploymentEnvironment,
    APP_ENV: deploymentEnvironment,
  };
  const values =
    deploymentEnvironment === 'production'
      ? normalizedEnvironment
      : { ...localDefaults, ...withoutBlankValues(normalizedEnvironment) };
  const parsed = configSchema.safeParse(values);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid application configuration: ${details}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    for (const field of ['OIDC_ISSUER', 'OIDC_REDIRECT_URI'] as const) {
      if (new URL(parsed.data[field]).protocol !== 'https:') {
        throw new Error(
          `Invalid application configuration: ${field}: Production URL must use HTTPS.`,
        );
      }
    }
  }

  return parsed.data;
}

let cachedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
  cachedConfig ??= parseConfig();
  return cachedConfig;
}
