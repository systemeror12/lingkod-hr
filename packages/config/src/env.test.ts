import { describe, expect, it } from 'vitest';
import { parseConfig } from './env';

const keys = {
  DATA_ENCRYPTION_KEY: '07'.repeat(32),
  BLIND_INDEX_KEY: 'test-only-blind-index-key-0123456789',
};

it('provides safe local defaults and rejects incomplete production configuration', () => {
  const local = parseConfig({ NODE_ENV: 'development', ...keys });
  expect(local.API_PORT).toBe(3001);
  expect(local.DATABASE_URL).toContain('@localhost:55432/');
  expect(local.DATABASE_DIRECT_URL).toContain('@localhost:55432/');
  expect(local.DATABASE_OPERATIONAL_URL).toContain('@localhost:55432/');
  expect(local.EMAIL_PORT).toBe(1025);
  expect(parseConfig({ APP_ENV: 'test', ...keys }).NODE_ENV).toBe('test');
  expect(parseConfig({ NODE_ENV: 'test', ...keys }).APP_ENV).toBe('test');
  expect(() => parseConfig({ NODE_ENV: 'production', ...keys })).toThrow(/DATABASE_URL/);
  expect(() => parseConfig({ APP_ENV: 'production', ...keys })).toThrow(/DATABASE_URL/);
  const production = {
    ...Object.fromEntries(Object.entries(local).map(([key, value]) => [key, String(value)])),
    NODE_ENV: 'production',
    APP_ENV: 'production',
    APP_URL: 'https://app.example',
    API_URL: 'https://api.example',
  };
  expect(parseConfig(production).NODE_ENV).toBe('production');
  const productionWithoutOperationalUrl = Object.fromEntries(
    Object.entries(production).filter(([key]) => key !== 'DATABASE_OPERATIONAL_URL'),
  );
  expect(parseConfig(productionWithoutOperationalUrl).DATABASE_OPERATIONAL_URL).toBeUndefined();
});

it('treats blank optional environment values as unset', () => {
  const config = parseConfig({
    NODE_ENV: 'development',
    ...keys,
    OPENAI_API_KEY: '',
    AI_DEFAULT_MODEL: '',
    AI_EMBEDDING_MODEL: '',
    OTEL_EXPORTER_OTLP_ENDPOINT: '',
    ERROR_TRACKING_DSN: '',
  });

  expect(config.OPENAI_API_KEY).toBeUndefined();
  expect(config.AI_DEFAULT_MODEL).toBeUndefined();
  expect(config.AI_EMBEDDING_MODEL).toBeUndefined();
  expect(config.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
  expect(config.ERROR_TRACKING_DSN).toBeUndefined();
});

describe.each(['development', 'test', 'production'])('in %s', (environment) => {
  const complete = {
    ...Object.fromEntries(
      Object.entries(parseConfig({ NODE_ENV: 'development', ...keys })).map(([key, value]) => [
        key,
        String(value),
      ]),
    ),
    NODE_ENV: environment,
    APP_ENV: environment,
  };

  it.each(['DATA_ENCRYPTION_KEY', 'BLIND_INDEX_KEY'])('requires %s', (field) => {
    expect(parseConfig(complete)[field as keyof typeof keys]).toBe(
      keys[field as keyof typeof keys],
    );
    const withoutField = Object.fromEntries(
      Object.entries(complete).filter(([key]) => key !== field),
    );
    expect(() => parseConfig(withoutField)).toThrow(new RegExp(field));
    expect(() => parseConfig({ ...complete, [field]: '' })).toThrow(new RegExp(field));
    expect(() => parseConfig({ ...complete, [field]: '   ' })).toThrow(new RegExp(field));
    expect(() => parseConfig({ ...complete, [field]: ' '.repeat(32) })).toThrow(new RegExp(field));
    expect(() => parseConfig({ ...complete, [field]: 'too-short' })).toThrow(new RegExp(field));
  });
});
