import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export default function globalSetup(): void {
  const repositoryRoot = resolve(__dirname, '../../..');
  const environment = {
    ...process.env,
    OIDC_ISSUER: process.env.OIDC_ISSUER ?? 'http://127.0.0.1:4100',
  };

  execFileSync(
    'docker',
    ['compose', '-f', 'infrastructure/compose.yaml', 'up', '-d', 'postgres', '--wait'],
    { cwd: repositoryRoot, env: environment, stdio: 'inherit' },
  );
  execFileSync('pnpm', ['db:migrate'], {
    cwd: repositoryRoot,
    env: environment,
    stdio: 'inherit',
  });
  execFileSync('pnpm', ['--filter', '@lingkod-hr/database', 'e2e:seed:shell'], {
    cwd: repositoryRoot,
    env: environment,
    stdio: 'inherit',
  });
}
