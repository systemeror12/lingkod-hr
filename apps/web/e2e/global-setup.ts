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

  execFileSync(
    'docker',
    [
      'compose',
      '-f',
      'infrastructure/compose.yaml',
      'up',
      '-d',
      '--no-recreate',
      'postgres',
      'seaweedfs',
      'mailpit',
      '--wait',
    ],
    { cwd: repositoryRoot, stdio: 'inherit' },
  );
  execFileSync('pnpm', ['db:migrate'], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });
  await clearMailpit();
  execFileSync('pnpm', ['--filter', '@lingkod-hr/database', 'e2e:seed:shell'], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });
}
