import { expect, it } from 'vitest';
import { parseConfig } from './env';

it('provides safe local defaults and rejects incomplete production configuration', () => {
  expect(parseConfig({ NODE_ENV: 'development' }).API_PORT).toBe(3001);
  expect(parseConfig({ APP_ENV: 'test' }).NODE_ENV).toBe('test');
  expect(parseConfig({ NODE_ENV: 'test' }).APP_ENV).toBe('test');
  expect(() => parseConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
  expect(() => parseConfig({ APP_ENV: 'production' })).toThrow(/DATABASE_URL/);
});
