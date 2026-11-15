import { readFile } from 'node:fs/promises';
import { Prisma, PrismaClient } from '@prisma/client';
import { createOperationalDatabaseClient } from '@lingkod-hr/database';
import { getConfig } from '@lingkod-hr/config';
import type { z } from 'zod';
import {
  listRuleVersionEffectivity,
  nationalPayrollRuleVersionFileSchema,
  sharesDateInEffect,
  type NationalPayrollRuleVersionFile,
} from './national-payroll-rule-versions';

/**
 * The `hris_operator` command that loads one National Payroll Rule Version
 * from a reviewed JSON file (ADR 0001, ADR 0013):
 *
 *   pnpm --filter @lingkod-hr/api load:payroll-rule-version -- <file.json>
 *
 * The file's values come only from the authority it cites in `docs/research/`.
 * A loaded version is never edited: a correction or a new issuance is a new
 * file whose `supersedesCode` names the version it replaces from its
 * `effectiveFrom`.
 */
export type LoadRuleVersionErrorCode =
  | 'INVALID_FILE'
  | 'CODE_EXISTS'
  | 'SUPERSEDED_VERSION_NOT_FOUND'
  | 'SUPERSEDED_VERSION_ALREADY_SUPERSEDED'
  | 'OVERLAPPING_EFFECTIVITY'
  | 'PERSISTENCE_FAILED';

export class LoadRuleVersionError extends Error {
  constructor(
    readonly code: LoadRuleVersionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LoadRuleVersionError';
  }
}

export interface LoadedRuleVersion {
  id: string;
  ruleKind: NationalPayrollRuleVersionFile['ruleKind'];
  code: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  supersedesRuleVersionId: string | null;
  salaryGradeRateCount: number;
}

const dateOf = (value: string) => new Date(`${value}T00:00:00.000Z`);

/** Validates the reviewed file and inserts the version and its rates in one transaction. */
export async function loadNationalPayrollRuleVersion(
  database: PrismaClient,
  input: unknown,
): Promise<LoadedRuleVersion> {
  const parsed = nationalPayrollRuleVersionFileSchema.safeParse(input);
  if (!parsed.success) {
    throw new LoadRuleVersionError('INVALID_FILE', describeIssues(parsed.error));
  }
  const file = parsed.data;

  try {
    return await database.$transaction(async (transaction) => {
      // One load of a kind at a time, so the overlap check sees every version.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`national_payroll_rule_versions:${file.ruleKind}`}, 0))`;

      if (await transaction.nationalPayrollRuleVersion.findUnique({ where: { code: file.code } })) {
        throw new LoadRuleVersionError('CODE_EXISTS', `Version ${file.code} is already loaded.`);
      }

      const versions = await listRuleVersionEffectivity(transaction, file.ruleKind);
      let predecessor: (typeof versions)[number] | undefined;
      if (file.supersedesCode !== null) {
        const code = file.supersedesCode.toLowerCase();
        predecessor = versions.find((version) => version.code.toLowerCase() === code);
        if (!predecessor) {
          throw new LoadRuleVersionError(
            'SUPERSEDED_VERSION_NOT_FOUND',
            `No ${file.ruleKind} version ${file.supersedesCode} is loaded to supersede.`,
          );
        }
        if (predecessor.successorEffectiveFrom !== null) {
          throw new LoadRuleVersionError(
            'SUPERSEDED_VERSION_ALREADY_SUPERSEDED',
            `Version ${predecessor.code} already has a successor; supersede that successor instead.`,
          );
        }
      }

      // The predecessor stops at this version's start, so only the others can overlap it.
      const loaded = {
        effectiveFrom: file.effectiveFrom,
        effectiveTo: file.effectiveTo,
        successorEffectiveFrom: null,
      };
      const overlapping = versions.filter(
        (version) => version !== predecessor && sharesDateInEffect(version, loaded),
      );
      if (overlapping.length > 0) {
        throw new LoadRuleVersionError(
          'OVERLAPPING_EFFECTIVITY',
          `Version ${file.code} would be in effect on the same date as ${overlapping
            .map((version) => version.code)
            .join(', ')}. Supersede the version in effect or change the effectivity.`,
        );
      }

      const version = await transaction.nationalPayrollRuleVersion.create({
        data: {
          ruleKind: file.ruleKind,
          code: file.code,
          name: file.name,
          issuingAuthority: file.issuingAuthority,
          issuanceReference: file.issuanceReference,
          sourceUrl: file.sourceUrl,
          verifiedOn: dateOf(file.verifiedOn),
          verifiedBy: file.verifiedBy,
          effectiveFrom: dateOf(file.effectiveFrom),
          effectiveTo: file.effectiveTo === null ? null : dateOf(file.effectiveTo),
          supersedesRuleVersionId: predecessor?.id ?? null,
          parameters: file.parameters,
        },
        select: { id: true },
      });
      // Only a salary schedule carries rows beside its parameters.
      const rates =
        file.ruleKind === 'SALARY_SCHEDULE'
          ? await transaction.salaryGradeRate.createMany({
              data: file.salaryGradeRates.map((rate) => ({
                ruleVersionId: version.id,
                salaryGrade: rate.salaryGrade,
                salaryStep: rate.salaryStep,
                monthlyRate: new Prisma.Decimal(rate.monthlyRate),
              })),
            })
          : { count: 0 };

      return {
        id: version.id,
        ruleKind: file.ruleKind,
        code: file.code,
        effectiveFrom: file.effectiveFrom,
        effectiveTo: file.effectiveTo,
        supersedesRuleVersionId: predecessor?.id ?? null,
        salaryGradeRateCount: rates.count,
      };
    });
  } catch (error: unknown) {
    if (error instanceof LoadRuleVersionError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new LoadRuleVersionError(
        'CODE_EXISTS',
        `Version ${file.code} or its supersession is already loaded.`,
      );
    }
    throw new LoadRuleVersionError('PERSISTENCE_FAILED', 'The rule version could not be loaded.');
  }
}

function describeIssues(error: z.ZodError): string {
  return `The rule version file is invalid: ${error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '<file>'}: ${issue.message}`)
    .join('; ')}`;
}

/** Reads the reviewed file named by the only argument. */
export async function readRuleVersionFile(args: readonly string[]): Promise<unknown> {
  const paths = args[0] === '--' ? args.slice(1) : args;
  if (paths.length !== 1 || !paths[0] || paths[0].startsWith('--')) {
    throw new LoadRuleVersionError(
      'INVALID_FILE',
      'Pass exactly one reviewed rule version file: load:payroll-rule-version -- <file.json>.',
    );
  }
  try {
    return JSON.parse(await readFile(paths[0], 'utf8')) as unknown;
  } catch {
    throw new LoadRuleVersionError('INVALID_FILE', `${paths[0]} is not a readable JSON file.`);
  }
}

export async function runLoadNationalPayrollRuleVersionCommand(
  args: readonly string[] = process.argv.slice(2),
): Promise<number> {
  let database: PrismaClient | undefined;
  try {
    const file = await readRuleVersionFile(args);
    const databaseUrl = getConfig().DATABASE_OPERATIONAL_URL;
    if (!databaseUrl) {
      throw new LoadRuleVersionError(
        'PERSISTENCE_FAILED',
        'Loading a rule version requires DATABASE_OPERATIONAL_URL.',
      );
    }
    database = createOperationalDatabaseClient(databaseUrl);
    const loaded = await loadNationalPayrollRuleVersion(database, file);
    process.stdout.write(
      [
        `Rule version loaded: ${loaded.ruleKind} ${loaded.code} (${loaded.id})`,
        `In effect from ${loaded.effectiveFrom} to ${loaded.effectiveTo ?? 'its successor'}.`,
        `Salary Grade rates: ${loaded.salaryGradeRateCount}.`,
      ].join('\n') + '\n',
    );
    return 0;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'The rule version could not be loaded.';
    process.stderr.write(`Rule version load failed: ${message}\n`);
    return 1;
  } finally {
    await database?.$disconnect();
  }
}

if (require.main === module) {
  void runLoadNationalPayrollRuleVersionCommand().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
