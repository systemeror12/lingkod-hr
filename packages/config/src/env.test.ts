import { expect, it } from 'vitest';
import { parseConfig } from './env';

it('provides safe local defaults and rejects incomplete production configuration', () => {
  const local = parseConfig({ NODE_ENV: 'development' });
  expect(local.API_PORT).toBe(3001);
  expect(local.DATABASE_URL).toContain('@localhost:55432/');
  expect(local.DATABASE_DIRECT_URL).toContain('@localhost:55432/');
  expect(local.DATABASE_OPERATIONAL_URL).toContain('@localhost:55432/');
  expect(local.EMAIL_PORT).toBe(1025);
  expect(parseConfig({ APP_ENV: 'test' }).NODE_ENV).toBe('test');
  expect(parseConfig({ NODE_ENV: 'test' }).APP_ENV).toBe('test');
  expect(() => parseConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
  expect(() => parseConfig({ APP_ENV: 'production' })).toThrow(/DATABASE_URL/);
  const production = {
    ...Object.fromEntries(Object.entries(local).map(([key, value]) => [key, String(value)])),
    NODE_ENV: 'production',
    APP_ENV: 'production',
    APP_URL: 'https://app.example',
    API_URL: 'https://api.example',
    OIDC_ISSUER: 'https://issuer.example',
    OIDC_REDIRECT_URI: 'https://api.example/auth/callback',
  };
  expect(parseConfig(production).NODE_ENV).toBe('production');
  const productionWithoutOperationalUrl = Object.fromEntries(
    Object.entries(production).filter(([key]) => key !== 'DATABASE_OPERATIONAL_URL'),
  );
  expect(parseConfig(productionWithoutOperationalUrl).DATABASE_OPERATIONAL_URL).toBeUndefined();
  for (const field of ['OIDC_ISSUER', 'OIDC_REDIRECT_URI'] as const) {
    expect(() => parseConfig({ ...production, [field]: `http://${field}.example` })).toThrow(
      new RegExp(`${field}: Production URL must use HTTPS`),
    );
  }
});

it('treats blank optional environment values as unset', () => {
  const config = parseConfig({
    NODE_ENV: 'development',
    OPENAI_API_KEY: '',
    AI_DEFAULT_MODEL: '',
    AI_EMBEDDING_MODEL: '',
    OTEL_EXPORTER_OTLP_ENDPOINT: '',
    ERROR_TRACKING_DSN: '',
    DATA_ENCRYPTION_KEY: '',
    BLIND_INDEX_KEY: '',
  });

  expect(config.OPENAI_API_KEY).toBeUndefined();
  expect(config.AI_DEFAULT_MODEL).toBeUndefined();
  expect(config.AI_EMBEDDING_MODEL).toBeUndefined();
  expect(config.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
  expect(config.ERROR_TRACKING_DSN).toBeUndefined();
  expect(config.DATA_ENCRYPTION_KEY).toBeUndefined();
  expect(config.BLIND_INDEX_KEY).toBeUndefined();
});
