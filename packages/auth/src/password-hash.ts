import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

/** Argon2id parameters from the password rules: m=64 MiB, t=3, p=1, 16-byte salt, 32-byte tag. */
const PARAMETERS = { memory: 65536, passes: 3, parallelism: 1 } as const;
const SALT_LENGTH = 16;
const TAG_LENGTH = 32;
const VERSION = 19;
const PHC_PATTERN =
  /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/**
 * Each hash holds 64 MiB while it runs. The limit keeps a sign-in burst from exhausting memory;
 * later callers wait for a slot.
 */
const MAX_CONCURRENT_HASHES = 4;
let activeHashes = 0;
const waiting: (() => void)[] = [];

async function withHashSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeHashes >= MAX_CONCURRENT_HASHES) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    activeHashes += 1;
  }
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else activeHashes -= 1;
  }
}

interface ParsedHash {
  memory: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  tag: Buffer;
}

function parseHash(hash: string): ParsedHash | null {
  const match = PHC_PATTERN.exec(hash);
  if (!match || Number(match[1]) !== VERSION) return null;
  const [memory, passes, parallelism] = [match[2], match[3], match[4]].map(Number);
  const salt = Buffer.from(match[5] ?? '', 'base64');
  const tag = Buffer.from(match[6] ?? '', 'base64');
  if (!memory || !passes || !parallelism || salt.length < 8 || tag.length < 16) return null;
  return { memory, passes, parallelism, salt, tag };
}

function derive(
  password: string,
  parameters: Omit<ParsedHash, 'tag'> & { tagLength: number },
): Promise<Buffer> {
  return withHashSlot(
    () =>
      new Promise((resolve, reject) => {
        argon2(
          'argon2id',
          {
            message: password.normalize('NFKC'),
            nonce: parameters.salt,
            memory: parameters.memory,
            passes: parameters.passes,
            parallelism: parameters.parallelism,
            tagLength: parameters.tagLength,
          },
          (error, tag) => (error ? reject(error) : resolve(tag)),
        );
      }),
  );
}

function unpadded(value: Buffer): string {
  return value.toString('base64').replace(/=+$/, '');
}

/** Hashes a password (NFKC-normalized) into an Argon2id PHC string with the current parameters. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const tag = await derive(password, { ...PARAMETERS, salt, tagLength: TAG_LENGTH });
  return `$argon2id$v=${VERSION}$m=${PARAMETERS.memory},t=${PARAMETERS.passes},p=${PARAMETERS.parallelism}$${unpadded(salt)}$${unpadded(tag)}`;
}

/** Verifies a password against a stored PHC string. A malformed hash never matches. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const parsed = parseHash(hash);
  if (!parsed) return false;
  const tag = await derive(password, { ...parsed, tagLength: parsed.tag.length });
  return timingSafeEqual(tag, parsed.tag);
}

/** True when a stored hash was made with parameters other than the current ones. */
export function passwordNeedsRehash(hash: string): boolean {
  const parsed = parseHash(hash);
  return (
    !parsed ||
    parsed.memory !== PARAMETERS.memory ||
    parsed.passes !== PARAMETERS.passes ||
    parsed.parallelism !== PARAMETERS.parallelism ||
    parsed.salt.length !== SALT_LENGTH ||
    parsed.tag.length !== TAG_LENGTH
  );
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the same work as a real verification when there is no stored hash, so the response time
 * doesn't reveal whether an account exists. Always false.
 */
export async function verifyPasswordAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(32).toString('base64url'));
  await verifyPassword(await dummyHash, password);
  return false;
}
