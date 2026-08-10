import { prisma } from './client';

export type DatabaseHealth =
  { status: 'up'; durationMs: number } | { status: 'down'; durationMs: number };

export async function checkDatabase(): Promise<DatabaseHealth> {
  const startedAt = performance.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'up', durationMs: Math.round(performance.now() - startedAt) };
  } catch {
    return { status: 'down', durationMs: Math.round(performance.now() - startedAt) };
  }
}
