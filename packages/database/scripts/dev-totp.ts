import { PrismaClient } from '@prisma/client';
import { openTotpSecret, totpCode, totpStep } from '@lingkod-hr/auth';
import { getConfig, parseProtectedValueKey } from '@lingkod-hr/config';
import { loadRootEnvironment } from './load-root-env';

/**
 * Prints the current TOTP code for a local User, for signing in at `/sign-in` during development:
 * `pnpm --filter @lingkod-hr/database dev:totp marisol.santos@example.test`. The API accepts each
 * step once, so when the current step is already used this waits for the next one.
 */
async function main(): Promise<void> {
  loadRootEnvironment();
  if (process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production') {
    throw new Error('dev:totp reads TOTP secrets and refuses production.');
  }
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error('Usage: pnpm --filter @lingkod-hr/database dev:totp <email>');

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url:
          process.env.DATABASE_E2E_ADMIN_URL ??
          process.env.DATABASE_MIGRATION_OWNER_URL ??
          'postgresql://hris_local:local_only@localhost:55432/hris',
      },
    },
  });
  try {
    const user = await prisma.user.findUnique({
      where: { emailNormalized: email },
      select: { id: true, totpFactor: true },
    });
    if (!user) throw new Error(`No User has the email ${email}.`);
    const factor = user.totpFactor;
    if (!factor) throw new Error(`${email} has no TOTP factor.`);

    const secret = openTotpSecret(
      Buffer.from(factor.secretEnvelope),
      parseProtectedValueKey(getConfig().DATA_ENCRYPTION_KEY),
      { userId: user.id, factorId: factor.id },
    );
    const step = Math.max(totpStep(), Number(factor.lastAcceptedStep) + 1);
    const waitMs = step * 30_000 - Date.now();
    if (waitMs > 0) {
      console.error(`This step's code was already used. Waiting ${Math.ceil(waitMs / 1000)}s.`);
      await new Promise((resolve) => setTimeout(resolve, waitMs + 250));
    }
    const at = new Date();
    const secondsLeft = Math.ceil(((step + 1) * 30_000 - at.getTime()) / 1000);
    console.log(totpCode(secret, at));
    console.error(`Valid for ${secondsLeft}s.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
