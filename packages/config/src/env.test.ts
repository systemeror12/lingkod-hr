import { expect, it } from 'vitest';
import { parseConfig } from './env';

it('provides safe local defaults and rejects incomplete production configuration', () => {
  const local = parseConfig({ NODE_ENV: 'development' });
  expect(local.API_PORT).toBe(3001);
  expect(parseConfig({ APP_ENV: 'test' }).NODE_ENV).toBe('test');
  expect(parseConfig({ NODE_ENV: 'test' }).APP_ENV).toBe('test');
  expect(() => parseConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
  expect(() => parseConfig({ APP_ENV: 'production' })).toThrow(/DATABASE_URL/);
  expect(() =>
    parseConfig({
      ...Object.fromEntries(Object.entries(local).map(([key, value]) => [key, String(value)])),
      NODE_ENV: 'production',
      APP_ENV: 'production',
      OIDC_ISSUER: 'http://issuer.example',
    }),
  ).toThrow(/OIDC_ISSUER: Production OIDC issuer must use HTTPS/);
});
