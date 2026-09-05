import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

async function clearMailpit(): Promise<void> {
  const response = await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(`Mailpit cleanup failed with status ${response.status}.`);
  }
}

export default async function globalSetup(): Promise<void> {
  const repositoryRoot = resolve(__dirname, '../../..');
  const environment = {
    ...process.env,
    OIDC_ISSUER: process.env.OIDC_ISSUER ?? 'http://127.0.0.1:4100',
  };

  execFileSync(
    'docker',
    [
      'compose',
      '-f',
      'infrastructure/compose.yaml',
      'up',
      '-d',
      'postgres',
      'seaweedfs',
      'mailpit',
      '--wait',
    ],
    { cwd: repositoryRoot, env: environment, stdio: 'inherit' },
  );
  execFileSync('pnpm', ['db:migrate'], {
    cwd: repositoryRoot,
    env: environment,
    stdio: 'inherit',
  });
  await clearMailpit();
  execFileSync('pnpm', ['--filter', '@lingkod-hr/database', 'e2e:seed:shell'], {
    cwd: repositoryRoot,
    env: environment,
    stdio: 'inherit',
  });
}
