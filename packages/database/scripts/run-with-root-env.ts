import { spawnSync } from 'node:child_process';
import { loadRootEnvironment } from './load-root-env';

const scriptName = process.argv[2];
if (!scriptName) throw new Error('A package script name is required.');

loadRootEnvironment();

const packageManagerCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const result = spawnSync(packageManagerCommand, ['run', scriptName], {
  env: process.env,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
