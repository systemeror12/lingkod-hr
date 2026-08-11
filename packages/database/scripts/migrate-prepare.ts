import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for database migration preparation.`);
  return value;
}

function rolePassword(urlValue: string, role: string): string {
  const url = new URL(urlValue);
  if (url.username !== role) throw new Error(`${role} must be the user in its database URL.`);
  if (!url.password) throw new Error(`${role} database URL must include a password.`);
  return decodeURIComponent(url.password);
}

function sqlIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function ensureRole(database: PrismaClient, role: string, password: string): Promise<void> {
  const roles = await database.$queryRaw<Array<{ rolname: string }>>`
    SELECT rolname FROM pg_roles WHERE rolname = ${role}
  `;
  if (roles.length > 0) return;
  await database.$executeRawUnsafe(
    `CREATE ROLE ${sqlIdentifier(role)} LOGIN PASSWORD ${sqlLiteral(password)} NOSUPERUSER NOBYPASSRLS`,
  );
}

async function main(): Promise<void> {
  const ownerUrl = required('DATABASE_MIGRATION_OWNER_URL');
  const appUrl = required('DATABASE_URL');
  const migratorUrl = required('DATABASE_DIRECT_URL');
  const ownerDatabase = new URL(ownerUrl);
  const database = new PrismaClient({ datasources: { db: { url: ownerUrl } } });

  try {
    await ensureRole(database, 'hris_migrator', rolePassword(migratorUrl, 'hris_migrator'));
    await ensureRole(database, 'hris_app', rolePassword(appUrl, 'hris_app'));
    const databaseName = decodeURIComponent(ownerDatabase.pathname.slice(1));
    await database.$executeRawUnsafe('GRANT hris_migrator TO current_user');
    await database.$executeRawUnsafe(
      `GRANT CONNECT ON DATABASE ${sqlIdentifier(databaseName)} TO hris_migrator, hris_app`,
    );
    await database.$executeRawUnsafe('GRANT USAGE, CREATE ON SCHEMA public TO hris_migrator');
    await database.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO hris_app');
    await database.$executeRawUnsafe(
      'ALTER DEFAULT PRIVILEGES FOR ROLE hris_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO hris_app',
    );
    await database.$executeRawUnsafe(
      'ALTER DEFAULT PRIVILEGES FOR ROLE hris_migrator IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO hris_app',
    );
    await database.$executeRawUnsafe(
      'ALTER DEFAULT PRIVILEGES FOR ROLE hris_migrator IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO hris_app',
    );
    await database.$executeRawUnsafe(
      await readFile(resolve(process.cwd(), 'prisma/migration-preflight.sql'), 'utf8'),
    );
  } finally {
    await database.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
