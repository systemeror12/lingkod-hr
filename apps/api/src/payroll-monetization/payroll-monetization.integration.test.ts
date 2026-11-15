import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import type { PayrollInputSubmission } from '../payroll-inputs/payroll-inputs.schemas';
import { PayrollInputsService } from '../payroll-inputs/payroll-inputs.service';
import { PersonnelSalaryFactsService } from '../personnel-salary-facts/personnel-salary-facts.service';
import {
  PayrollMonetizationCalculator,
  unresolvedMonetizationValuationRules,
  type MonetizationCompensationBasis,
  type MonetizationValuationRules,
} from './payroll-monetization.calculator';

const enabled = process.env.DATABASE_E2E === 'true';
const migrations = resolve(__dirname, '../../../../packages/database/prisma/migrations');

async function createAdminClient(): Promise<PrismaClient> {
  const databaseUrl =
    process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!databaseUrl) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

async function createTenant(admin: Prisma.TransactionClient | PrismaClient, suffix: string) {
  const agency = await admin.agency.create({
    data: {
      code: `PMN-${suffix}`,
      name: 'Payroll Monetization Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      emailNormalized: `payroll-monetization-${suffix}@example.test`,
      displayName: 'Payroll Monetization User',
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const employee = await admin.employee.create({
    data: {
      agencyId: agency.id,
      employeeNumber: `EMP-PMN-${suffix}`,
      legalName: 'Employee Monetization',
      birthDate: new Date('1990-01-01'),
      sex: 'FEMALE',
      civilStatus: 'SINGLE',
      contactEmail: `payroll-monetization-employee-${suffix}@example.test`,
      serviceStatus: 'ACTIVE',
      createdByMembershipId: membership.id,
      updatedByMembershipId: membership.id,
    },
  });
  const scope = { agencyId: agency.id, userId: user.id, membershipId: membership.id };
  return { agency, user, membership, employee, scope };
}

// Test fixtures only. Personnel records no pay basis yet (#619), so a real
// compensation basis never resolves, and no recorded rule settles the salary,
// the valuation date, or centavo rounding (#614).
const resolvedBasis: MonetizationCompensationBasis = {
  async resolveInTransaction(_transaction, _agencyId, employeeId, from, to) {
    return {
      employeeId,
      from,
      to,
      status: 'RESOLVED',
      stretches: [
        {
          status: 'RESOLVED',
          from,
          to,
          personnel: {
            serviceSegmentId: '00000000-0000-4000-8000-000000000339',
            salaryGrade: 11,
            salaryStep: 1,
            payBasis: 'MONTHLY_FULL_TIME',
            employmentFraction: '1',
          },
          salarySchedule: {
            ruleVersionId: '00000000-0000-4000-8000-000000000331',
            ruleVersionCode: 'TEST-339-SCHEDULE',
            monthlyRate: '27000.50',
          },
          rate: { monthlyRate: '27000.50', dailyRate: '1227.29545454', derivation: 'fixture' },
        },
      ],
    };
  },
};
const testRules: MonetizationValuationRules = {
  async resolve() {
    return {
      salaryRule: { fixture: 'integration-test' },
      valuationDateRule: { fixture: 'integration-test' },
      rounding: { kind: 'HALF_UP_2DP', authority: { fixture: 'integration-test' } },
    };
  },
};
// Every rule but the salary rule: a resolved basis alone is no salary source.
const noSalaryRule: MonetizationValuationRules = {
  async resolve() {
    return {
      salaryRule: null,
      valuationDateRule: { fixture: 'integration-test' },
      rounding: { kind: 'HALF_UP_2DP', authority: { fixture: 'integration-test' } },
    };
  },
};
const realBasis = new CompensationBasisService(new PersonnelSalaryFactsService());

it.skipIf(!enabled)(
  'accepts, replays, and refuses Monetization Earning Inputs in the Payroll Input inbox',
  async () => {
    const admin = await createAdminClient();
    const tenant = await createTenant(admin, `${Date.now()}`);
    const versionId = randomUUID();
    const submission = (
      overrides: Partial<PayrollInputSubmission> = {},
      payload: Record<string, string> = {},
    ): PayrollInputSubmission => ({
      agencyId: tenant.agency.id,
      employeeId: tenant.employee.id,
      sourceModule: 'LEAVE',
      inputKind: 'MONETIZATION_EARNING',
      sourceKey: `MONETIZATION:${versionId}`,
      sourceType: 'MONETIZATION_POSTING',
      sourceId: versionId,
      effectiveDate: '2026-11-13',
      quantity: '12.5000',
      payload: {
        postingKey: `MONETIZATION:${versionId}`,
        calculatorKind: 'MCL_FIXED_FACTOR_0_0481927',
        factor: '0.0481927',
        valuationDate: '2026-11-13',
        ...payload,
      },
      ...overrides,
    });
    const accept = (
      basis: MonetizationCompensationBasis,
      rules: MonetizationValuationRules,
      request: PayrollInputSubmission,
    ) =>
      withDatabaseContext(tenant.scope, (transaction) =>
        new PayrollInputsService(
          new PayrollMonetizationCalculator(basis, rules),
        ).acceptInTransaction(transaction, request),
      );
    const count = () => admin.payrollInput.count({ where: { agencyId: tenant.agency.id } });

    try {
      // The production binding: no rule settles the salary, valuation date, or
      // rounding, and the real basis has no pay basis, so each fact is named.
      await expect(
        accept(realBasis, unresolvedMonetizationValuationRules, submission()),
      ).resolves.toEqual({
        outcome: 'RETRYABLE_FAILURE',
        code: 'PAYROLL_MONETIZATION_AUTHORITY_MISSING',
        reason: expect.any(String),
        missingFacts: ['AUTHORITATIVE_SALARY_SOURCE', 'ROUNDING_RULE', 'VALUATION_DATE_RULE'],
      });
      await expect(
        accept(resolvedBasis, unresolvedMonetizationValuationRules, submission()),
      ).resolves.toMatchObject({
        missingFacts: ['AUTHORITATIVE_SALARY_SOURCE', 'ROUNDING_RULE', 'VALUATION_DATE_RULE'],
      });
      // A resolved basis without a salary rule still names the salary source.
      await expect(accept(resolvedBasis, noSalaryRule, submission())).resolves.toEqual({
        outcome: 'RETRYABLE_FAILURE',
        code: 'PAYROLL_MONETIZATION_AUTHORITY_MISSING',
        reason: expect.any(String),
        missingFacts: ['AUTHORITATIVE_SALARY_SOURCE'],
      });
      // Under a salary rule, a basis that does not resolve is still no salary.
      await expect(accept(realBasis, testRules, submission())).resolves.toMatchObject({
        outcome: 'RETRYABLE_FAILURE',
        code: 'PAYROLL_SALARY_SOURCE_MISSING',
        missingFacts: ['AUTHORITATIVE_SALARY_SOURCE'],
      });

      // Leave may name only Payroll's own calculator and factor.
      await expect(
        accept(resolvedBasis, testRules, submission({}, { factor: '0.0478087' })),
      ).resolves.toMatchObject({
        outcome: 'REJECTED',
        code: 'PAYROLL_MONETIZATION_CALCULATOR_MISMATCH',
      });
      await expect(
        accept(resolvedBasis, testRules, submission({ effectiveDate: '2026-11-14' })),
      ).resolves.toMatchObject({
        outcome: 'REJECTED',
        code: 'PAYROLL_MONETIZATION_PAYLOAD_INVALID',
      });
      expect(await count()).toBe(0);

      // Accepted: 27,000.50 × 12.5 × 0.0481927 = 16,265.337454375 rounds to 16,265.34.
      const first = await accept(resolvedBasis, testRules, submission());
      expect(first).toEqual({
        outcome: 'ACCEPTED',
        payrollInputId: expect.any(String),
        amount: '16265.34',
      });
      const stored = await admin.payrollInput.findFirstOrThrow({
        where: { agencyId: tenant.agency.id },
      });
      expect(stored.amount?.toFixed(4)).toBe('16265.3400');
      expect(stored.quantity?.toFixed(4)).toBe('12.5000');
      expect(stored.payloadSnapshot).toMatchObject({
        postingKey: `MONETIZATION:${versionId}`,
        payrollValuation: {
          factor: '0.0481927',
          salary: { source: 'COMPENSATION_BASIS', monthlySalary: '27000.50' },
          rounding: { kind: 'HALF_UP_2DP' },
          calculation: { unrounded: '16265.337454375', rounded: '16265.34' },
        },
      });

      // Repeated: the same request answers the stored input and amount without
      // valuing it again, even when the rules have since gone.
      await expect(
        accept(realBasis, unresolvedMonetizationValuationRules, submission()),
      ).resolves.toEqual({
        outcome: 'ALREADY_ACCEPTED',
        payrollInputId: first.outcome === 'ACCEPTED' ? first.payrollInputId : '',
        amount: '16265.34',
      });

      // Rejected: the same key with another quantity.
      await expect(
        accept(resolvedBasis, testRules, submission({ quantity: '10' })),
      ).resolves.toMatchObject({ outcome: 'REJECTED', code: 'PAYROLL_INPUT_SOURCE_KEY_CONFLICT' });
      expect(await count()).toBe(1);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.payrollInput.deleteMany({ where: { agencyId: tenant.agency.id } });
        await transaction.employee.deleteMany({ where: { agencyId: tenant.agency.id } });
        await transaction.agencyMembership.deleteMany({ where: { agencyId: tenant.agency.id } });
        await transaction.agency.delete({ where: { id: tenant.agency.id } });
        await transaction.user.delete({ where: { id: tenant.user.id } });
      });
      await admin.$disconnect();
    }
  },
);

/** A migration file's statements; `$$` bodies keep their semicolons. */
function statementsOf(migration: string): string[] {
  const sql = readFileSync(resolve(migrations, migration, 'migration.sql'), 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  const statements: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < sql.length; index += 1) {
    if (sql.startsWith('$$', index)) {
      quoted = !quoted;
      current += '$$';
      index += 1;
    } else if (sql[index] === ';' && !quoted) {
      if (current.trim()) statements.push(current.trim());
      current = '';
    } else {
      current += sql[index];
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

class RolledBack extends Error {}

const REPLAY_ATTEMPTS = 20;

/** A lock timeout (55P03) or a deadlock (40P01): the replay yielded its locks. */
function isLockConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { meta?: { code?: unknown } }).meta?.code;
  return code === '55P03' || code === '40P01' || /\b(55P03|40P01)\b/.test(error.message);
}

/**
 * Rebuild 0091's `payroll_monetization_earning_inputs` inside one transaction
 * the test rolls back, fill it, and run 0161 over it. Nothing stays behind.
 *
 * The replay's DDL takes strong locks on tables other test files write to at
 * the same time, such as `agency_memberships` and `employees`, which the old
 * table's foreign keys reference. A 50 ms lock timeout, well below the 1 s
 * deadlock timeout, makes the replay give up a lock wait and roll back before
 * it can close a deadlock cycle; it then retries from the start.
 */
async function withOldTable(
  admin: PrismaClient,
  fill: (
    transaction: Prisma.TransactionClient,
    tenant: Awaited<ReturnType<typeof createTenant>>,
  ) => Promise<void>,
  check: (
    transaction: Prisma.TransactionClient,
    tenant: Awaited<ReturnType<typeof createTenant>>,
  ) => Promise<void>,
): Promise<void> {
  const oldTable = statementsOf('0091_leave_monetization').filter(
    (statement) =>
      /payroll_monetization_earning_inputs|guard_payroll_monetization_input_mutation/.test(
        statement,
      ) && !statement.startsWith('CREATE TABLE "payroll_monetization_adjustment_outcomes"'),
  );
  const move = statementsOf('0161_payroll_monetization_inputs');
  for (let attempt = 1; ; attempt += 1) {
    try {
      await replay();
      return;
    } catch (error) {
      if (error instanceof RolledBack) return;
      if (!isLockConflict(error)) throw error;
      if (attempt === REPLAY_ATTEMPTS) {
        throw new Error(`The 0161 replay could not take its locks in ${REPLAY_ATTEMPTS} tries.`, {
          cause: error,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 25 + Math.random() * 50));
    }
  }

  function replay() {
    return admin.$transaction(
      async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL lock_timeout = '50ms'");
        const tenant = await createTenant(transaction, `${Date.now()}-${randomUUID()}`);
        for (const statement of oldTable) await transaction.$executeRawUnsafe(statement);
        // Outcomes already moved by 0161 stay valid; only new rows are checked.
        await transaction.$executeRawUnsafe(`
          ALTER TABLE "payroll_monetization_adjustment_outcomes"
            DROP CONSTRAINT "payroll_monetization_outcomes_input_fkey",
            DROP CONSTRAINT "payroll_monetization_outcomes_linked_fkey",
            ADD CONSTRAINT "payroll_monetization_outcomes_input_fkey"
              FOREIGN KEY ("agency_id", "earning_input_id")
              REFERENCES "payroll_monetization_earning_inputs"("agency_id", "id") NOT VALID,
            ADD CONSTRAINT "payroll_monetization_outcomes_linked_fkey"
              FOREIGN KEY ("agency_id", "linked_input_id")
              REFERENCES "payroll_monetization_earning_inputs"("agency_id", "id") NOT VALID`);
        await transaction.$executeRaw`SELECT set_config('app.agency_id', ${tenant.agency.id}, true)`;
        await fill(transaction, tenant);
        for (const statement of move) await transaction.$executeRawUnsafe(statement);
        await check(transaction, tenant);
        throw new RolledBack();
      },
      { timeout: 60_000 },
    );
  }
}

async function insertOldInput(
  transaction: Prisma.TransactionClient,
  tenant: Awaited<ReturnType<typeof createTenant>>,
  input: {
    id: string;
    sourceType: string;
    sourceVersionKey: string;
    status: 'PENDING' | 'CONSUMED' | 'CANCELLED' | 'SUPERSEDED';
    quantity: string;
    amount: string;
    supersedesInputId?: string;
  },
) {
  await transaction.$executeRaw`
    INSERT INTO payroll_monetization_earning_inputs (
      id, agency_id, employee_id, source_type, source_id, source_version_key, status,
      quantity, amount, effective_date, valuation_date, calculator_kind, factor,
      salary_source_snapshot, rounding_snapshot, calculation_snapshot, payload_snapshot,
      supersedes_input_id, created_by_membership_id, created_at
    ) VALUES (
      ${input.id}::uuid, ${tenant.agency.id}::uuid, ${tenant.employee.id}::uuid,
      ${input.sourceType}, ${randomUUID()}::uuid, ${input.sourceVersionKey}, 'PENDING',
      ${input.quantity}::numeric, ${input.amount}::numeric, '2026-03-02', '2026-03-02',
      'MCL_FIXED_FACTOR_0_0481927', 0.0481927,
      '{"source":"integration-test","monthlySalary":"30000.00"}'::jsonb,
      '{"kind":"HALF_UP_2DP"}'::jsonb,
      ${JSON.stringify({ rounded: input.amount })}::jsonb,
      ${JSON.stringify({ postingKey: input.sourceVersionKey, reason: 'fixture' })}::jsonb,
      ${input.supersedesInputId ?? null}::uuid, ${tenant.membership.id}::uuid,
      '2026-03-02T01:02:03.000Z'
    )`;
  if (input.status !== 'PENDING') {
    await transaction.$executeRaw`
      UPDATE payroll_monetization_earning_inputs SET status = ${input.status}
      WHERE id = ${input.id}::uuid`;
  }
}

it.skipIf(!enabled)(
  'moves every Monetization Earning Input into the inbox with its identifiers and history',
  async () => {
    const admin = await createAdminClient();
    const original = randomUUID();
    const replacement = randomUUID();
    const cancelled = randomUUID();
    const pending = randomUUID();
    const outcome = randomUUID();
    const adjustment = randomUUID();
    try {
      await withOldTable(
        admin,
        async (transaction, tenant) => {
          await insertOldInput(transaction, tenant, {
            id: original,
            sourceType: 'MONETIZATION_POSTING',
            sourceVersionKey: `MONETIZATION:${original}`,
            status: 'SUPERSEDED',
            quantity: '10',
            amount: '14457.81',
          });
          await insertOldInput(transaction, tenant, {
            id: replacement,
            sourceType: 'MONETIZATION_ADJUSTMENT',
            sourceVersionKey: `MONETIZATION_ADJUSTMENT:${adjustment}:REPLACEMENT`,
            status: 'PENDING',
            quantity: '4',
            amount: '5783.12',
            supersedesInputId: original,
          });
          await insertOldInput(transaction, tenant, {
            id: cancelled,
            sourceType: 'MONETIZATION_POSTING',
            sourceVersionKey: `MONETIZATION:${cancelled}`,
            status: 'CANCELLED',
            quantity: '10',
            amount: '14457.81',
          });
          await insertOldInput(transaction, tenant, {
            id: pending,
            sourceType: 'MONETIZATION_POSTING',
            sourceVersionKey: `MONETIZATION:${pending}`,
            status: 'PENDING',
            quantity: '15',
            amount: '21686.72',
          });
          // Its Monetization Adjustment is not built here, so only this insert
          // runs without foreign-key triggers.
          await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
          await transaction.$executeRaw`
            INSERT INTO payroll_monetization_adjustment_outcomes (
              id, agency_id, monetization_adjustment_id, earning_input_id, result,
              linked_input_id, payload_snapshot, recorded_by_membership_id, recorded_at
            ) VALUES (
              ${outcome}::uuid, ${tenant.agency.id}::uuid, ${adjustment}::uuid,
              ${original}::uuid, 'ACCEPTED', ${replacement}::uuid,
              '{"scope":"PARTIAL"}'::jsonb, ${tenant.membership.id}::uuid, now()
            )`;
          await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
        },
        async (transaction, tenant) => {
          const moved = await transaction.payrollInput.findMany({
            where: { agencyId: tenant.agency.id },
          });
          const byId = new Map(moved.map((input) => [input.id, input]));
          expect([...byId.keys()].sort()).toEqual(
            [original, replacement, cancelled, pending].sort(),
          );
          const common = {
            employeeId: tenant.employee.id,
            sourceModule: 'LEAVE',
            inputKind: 'MONETIZATION_EARNING',
            effectiveDate: new Date('2026-03-02T00:00:00.000Z'),
            acceptedAt: new Date('2026-03-02T01:02:03.000Z'),
            consumedByPayrollPeriodId: null,
          };
          // Superseded becomes CANCELLED, and its successor names it as replaced.
          expect(byId.get(original)).toMatchObject({
            ...common,
            sourceKey: `MONETIZATION:${original}`,
            sourceType: 'MONETIZATION_POSTING',
            status: 'CANCELLED',
            replacesPayrollInputId: null,
            payloadSnapshot: {
              postingKey: `MONETIZATION:${original}`,
              reason: 'fixture',
              payrollValuation: {
                calculatorKind: 'MCL_FIXED_FACTOR_0_0481927',
                factor: '0.0481927',
                valuationDate: '2026-03-02',
                salary: { source: 'integration-test', monthlySalary: '30000.00' },
                rounding: { kind: 'HALF_UP_2DP' },
                calculation: { rounded: '14457.81' },
              },
              movedFrom: {
                table: 'payroll_monetization_earning_inputs',
                status: 'SUPERSEDED',
                sourceVersionKey: `MONETIZATION:${original}`,
                supersedesInputId: null,
                createdByMembershipId: tenant.membership.id,
              },
            },
          });
          expect(byId.get(original)?.amount?.toFixed(4)).toBe('14457.8100');
          expect(byId.get(original)?.quantity?.toFixed(4)).toBe('10.0000');
          expect(byId.get(replacement)).toMatchObject({
            ...common,
            sourceType: 'MONETIZATION_ADJUSTMENT',
            status: 'PENDING',
            replacesPayrollInputId: original,
            payloadSnapshot: { movedFrom: { status: 'PENDING', supersedesInputId: original } },
          });
          expect(byId.get(cancelled)).toMatchObject({
            status: 'CANCELLED',
            payloadSnapshot: { movedFrom: { status: 'CANCELLED' } },
          });
          expect(byId.get(pending)).toMatchObject({ status: 'PENDING' });
          expect(byId.get(pending)?.amount?.toFixed(2)).toBe('21686.72');
          for (const input of moved) expect(input.payloadHash).toMatch(/^[0-9a-f]{64}$/);

          // The outcome keeps its identifiers, now against the inbox.
          await expect(
            transaction.payrollMonetizationAdjustmentOutcome.findUniqueOrThrow({
              where: { id: outcome },
            }),
          ).resolves.toMatchObject({ earningInputId: original, linkedInputId: replacement });
          const references = await transaction.$queryRaw<{ conname: string; target: string }[]>`
            SELECT conname, confrelid::regclass::text AS target FROM pg_constraint
            WHERE conrelid = 'payroll_monetization_adjustment_outcomes'::regclass
              AND conname IN ('payroll_monetization_outcomes_input_fkey',
                              'payroll_monetization_outcomes_linked_fkey')
            ORDER BY conname`;
          expect(references.map(({ target }) => target)).toEqual([
            'payroll_inputs',
            'payroll_inputs',
          ]);
          const [table] = await transaction.$queryRaw<{ name: string | null }[]>`
            SELECT to_regclass('public.payroll_monetization_earning_inputs')::text AS name`;
          expect(table?.name).toBeNull();

          // The inbox guard still holds over moved rows.
          await expect(
            transaction.$executeRaw`DELETE FROM payroll_inputs WHERE id = ${pending}::uuid`,
          ).rejects.toThrow(/retained and cannot be deleted/);
        },
      );
    } finally {
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'stops the move on a consumed input, which has no consuming period',
  async () => {
    const admin = await createAdminClient();
    try {
      await expect(
        withOldTable(
          admin,
          async (transaction, tenant) => {
            const id = randomUUID();
            await insertOldInput(transaction, tenant, {
              id,
              sourceType: 'MONETIZATION_POSTING',
              sourceVersionKey: `MONETIZATION:${id}`,
              status: 'CONSUMED',
              quantity: '10',
              amount: '14457.81',
            });
          },
          async () => {},
        ),
      ).rejects.toThrow(/no consuming Payroll Period/);
    } finally {
      await admin.$disconnect();
    }
  },
);
