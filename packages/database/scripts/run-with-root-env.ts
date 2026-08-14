import { spawnSync } from 'node:child_process';
import { loadRootEnvironment } from './load-root-env';

const scriptName = process.argv[2];
if (!scriptName) throw new Error('A package script name is required.');

const packageManagerPath = process.env.npm_execpath;
if (!packageManagerPath) throw new Error('pnpm executable path is unavailable.');

loadRootEnvironment();

const result = spawnSync(process.execPath, [packageManagerPath, 'run', scriptName], {
  env: process.env,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
