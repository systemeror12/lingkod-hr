import { PrismaClient } from '@prisma/client';

const OPERATIONAL_ROLE = 'hris_operator';

export function createOperationalDatabaseClient(databaseUrl: string): PrismaClient {
  let username: string;
  try {
    username = decodeURIComponent(new URL(databaseUrl).username);
  } catch {
    throw new Error('The operational database URL is invalid.');
  }
  if (username !== OPERATIONAL_ROLE) {
    throw new Error(`The operational database URL must use the ${OPERATIONAL_ROLE} role.`);
  }
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}
