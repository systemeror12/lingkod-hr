import { expect, it } from 'vitest';
import { parseConfig } from './env';

it('provides safe local defaults and rejects incomplete production configuration', () => {
  const local = parseConfig({ NODE_ENV: 'development' });
  expect(local.API_PORT).toBe(3001);
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
  for (const field of ['OIDC_ISSUER', 'OIDC_REDIRECT_URI'] as const) {
    expect(() => parseConfig({ ...production, [field]: `http://${field}.example` })).toThrow(
      new RegExp(`${field}: Production URL must use HTTPS`),
    );
  }
});
