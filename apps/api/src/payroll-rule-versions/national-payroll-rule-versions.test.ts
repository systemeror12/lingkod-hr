import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createOperationalDatabaseClient, prisma as app } from '@lingkod-hr/database';
import { getConfig } from '@lingkod-hr/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LoadRuleVersionError,
  loadNationalPayrollRuleVersion,
  readRuleVersionFile,
} from './load-national-payroll-rule-version';
import {
  findSalaryGradeRate,
  isInEffectOn,
  nationalPayrollRuleVersionFileSchema,
  sharesDateInEffect,
} from './national-payroll-rule-versions';
import { ReadNationalPayrollRuleVersionsService } from './read-national-payroll-rule-versions.service';

const enabled = process.env.DATABASE_E2E === 'true';

// Test fixtures only: the rates are not from any issuance, the codes carry a
// prefix the cleanup removes, and the dates sit far past any real schedule.
const prefix = 'TEST-331-';

function scheduleFile(
  code: string,
  effectiveFrom: string,
  effectiveTo: string | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    ruleKind: 'SALARY_SCHEDULE',
    code: `${prefix}${code}`,
    name: `Test salary schedule ${code}`,
    issuingAuthority: 'Test authority',
    issuanceReference: 'Test fixture, not an issuance',
    sourceUrl: 'https://example.test/salary-schedule',
    researchRegister: 'docs/research/national-payroll-rule-versions-2027.md#S2',
    verifiedOn: '2026-11-15',
    verifiedBy: 'LingkodHR test fixture',
    effectiveFrom,
    effectiveTo,
    supersedesCode: null,
    parameters: {},
    salaryGradeRates: [{ salaryGrade: 1, salaryStep: 1, monthlyRate: '1000.0000' }],
    ...overrides,
  };
}

describe('rule version effectivity', () => {
  const version = { effectiveFrom: '2030-01-01', effectiveTo: '2030-12-31' };

  it('covers its first and last dates and nothing outside them', () => {
    const bounded = { ...version, successorEffectiveFrom: null };
    expect(isInEffectOn(bounded, '2029-12-31')).toBe(false);
    expect(isInEffectOn(bounded, '2030-01-01')).toBe(true);
    expect(isInEffectOn(bounded, '2030-12-31')).toBe(true);
    expect(isInEffectOn(bounded, '2031-01-01')).toBe(false);
  });

  it('stops the day before its successor starts', () => {
    const superseded = { ...version, successorEffectiveFrom: '2030-07-01' };
    expect(isInEffectOn(superseded, '2030-06-30')).toBe(true);
    expect(isInEffectOn(superseded, '2030-07-01')).toBe(false);
    expect(isInEffectOn({ ...version, successorEffectiveFrom: '2030-01-01' }, '2030-01-01')).toBe(
      false,
    );
  });

  it('finds a shared date only when the periods meet', () => {
    const bounded = { ...version, successorEffectiveFrom: null };
    const open = (effectiveFrom: string) => ({
      effectiveFrom,
      effectiveTo: null,
      successorEffectiveFrom: null,
    });
    expect(sharesDateInEffect(bounded, open('2030-12-31'))).toBe(true);
    expect(sharesDateInEffect(bounded, open('2031-01-01'))).toBe(false);
    expect(sharesDateInEffect(open('2029-01-01'), bounded)).toBe(true);
    expect(
      sharesDateInEffect({ ...bounded, successorEffectiveFrom: '2030-12-31' }, open('2030-12-31')),
    ).toBe(false);
  });
});

describe('rule version file', () => {
  const parse = (file: unknown) => nationalPayrollRuleVersionFileSchema.safeParse(file).success;

  it('accepts a salary schedule with empty parameters and rate rows', () => {
    expect(parse(scheduleFile('ok', '2030-01-01', null))).toBe(true);
  });

  it('refuses parameters, duplicate grades, bad rates, and missing evidence', () => {
    expect(parse(scheduleFile('p', '2030-01-01', null, { parameters: { divisor: 22 } }))).toBe(
      false,
    );
    const rate = { salaryGrade: 1, salaryStep: 1, monthlyRate: '1000' };
    expect(parse(scheduleFile('d', '2030-01-01', null, { salaryGradeRates: [rate, rate] }))).toBe(
      false,
    );
    for (const monthlyRate of ['0', '-1', '1000.12345', '1e3']) {
      const salaryGradeRates = [{ ...rate, monthlyRate }];
      expect(parse(scheduleFile('r', '2030-01-01', null, { salaryGradeRates }))).toBe(false);
    }
    expect(parse(scheduleFile('e', '2030-01-01', null, { salaryGradeRates: [] }))).toBe(false);
    expect(parse(scheduleFile('c', '2030-01-01', null, { researchRegister: 'a blog' }))).toBe(
      false,
    );
    expect(parse(scheduleFile('v', '2030-01-01', null, { verifiedBy: ' ' }))).toBe(false);
    expect(parse(scheduleFile('k', '2030-01-01', null, { ruleKind: 'TAX_TABLE' }))).toBe(false);
    expect(parse(scheduleFile('t', '2030-01-01', '2029-12-31'))).toBe(false);
    const withoutEffectiveTo: Record<string, unknown> = scheduleFile('m', '2030-01-01', null);
    delete withoutEffectiveTo.effectiveTo;
    expect(parse(withoutEffectiveTo)).toBe(false);
  });

  it('accepts authorized deductions that list known payee categories once', () => {
    const deductions = (parameters: unknown, extra: Record<string, unknown> = {}) => {
      const file: Record<string, unknown> = {
        ...scheduleFile('ad', '2030-01-01', null),
        ruleKind: 'AUTHORIZED_DEDUCTIONS',
        parameters,
      };
      delete file.salaryGradeRates;
      return { ...file, ...extra };
    };
    expect(parse(deductions({ allowedPayeeCategories: ['BIR', 'GSIS'] }))).toBe(true);
    expect(parse(deductions({ allowedPayeeCategories: [] }))).toBe(false);
    expect(parse(deductions({ allowedPayeeCategories: ['GSIS', 'GSIS'] }))).toBe(false);
    expect(parse(deductions({ allowedPayeeCategories: ['PAWNSHOP'] }))).toBe(false);
    expect(parse(deductions({}))).toBe(false);
    const rates = [{ salaryGrade: 1, salaryStep: 1, monthlyRate: '1000' }];
    expect(
      parse(deductions({ allowedPayeeCategories: ['BIR'] }, { salaryGradeRates: rates })),
    ).toBe(false);
  });

  it('reads exactly one JSON file argument', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rule-version-'));
    const path = join(directory, 'schedule.json');
    const file = scheduleFile('read', '2030-01-01', null);
    await writeFile(path, JSON.stringify(file));
    await expect(readRuleVersionFile(['--', path])).resolves.toEqual(file);
    await expect(readRuleVersionFile([])).rejects.toMatchObject({ code: 'INVALID_FILE' });
    await expect(readRuleVersionFile([path, path])).rejects.toMatchObject({ code: 'INVALID_FILE' });
    await expect(readRuleVersionFile([join(directory, 'missing.json')])).rejects.toMatchObject({
      code: 'INVALID_FILE',
    });
  });
});

describe.skipIf(!enabled)('National Payroll Rule Versions in PostgreSQL', () => {
  let admin: PrismaClient;
  let operator: PrismaClient;

  async function cleanup(): Promise<void> {
    await admin.$transaction(async (transaction) => {
      // The immutability triggers are the point of the tables; only the test lifts them.
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.$executeRaw`DELETE FROM salary_grade_rates WHERE rule_version_id IN (SELECT id FROM national_payroll_rule_versions WHERE code LIKE ${`${prefix}%`})`;
      await transaction.$executeRaw`DELETE FROM national_payroll_rule_versions WHERE code LIKE ${`${prefix}%`}`;
    });
  }

  const load = (file: unknown) => loadNationalPayrollRuleVersion(operator, file);
  const lookup = (on: string, salaryGrade = 1, salaryStep = 1) =>
    findSalaryGradeRate(app, { salaryGrade, salaryStep, on });

  beforeAll(async () => {
    const adminUrl = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
    const operationalUrl = getConfig().DATABASE_OPERATIONAL_URL;
    if (!adminUrl || !operationalUrl) {
      throw new Error('DATABASE_E2E_ADMIN_URL and DATABASE_OPERATIONAL_URL are required.');
    }
    admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    operator = createOperationalDatabaseClient(operationalUrl);
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await Promise.all([admin.$disconnect(), operator.$disconnect()]);
  });

  it('applies a version from its first date through its last and on no other date', async () => {
    const loaded = await load(scheduleFile('BOUNDARY', '2901-01-01', '2901-12-31'));
    expect(loaded).toMatchObject({ salaryGradeRateCount: 1, supersedesRuleVersionId: null });

    expect(await lookup('2900-12-31')).toEqual({
      status: 'MISSING_RULE',
      ruleKind: 'SALARY_SCHEDULE',
      on: '2900-12-31',
    });
    for (const on of ['2901-01-01', '2901-12-31']) {
      const found = await lookup(on);
      expect(found).toMatchObject({ status: 'FOUND', ruleVersionId: loaded.id });
      expect(found.status === 'FOUND' && found.monthlyRate.toFixed(4)).toBe('1000.0000');
    }
    expect(await lookup('2902-01-01')).toMatchObject({ status: 'MISSING_RULE' });
    expect(await lookup('2901-06-15', 2, 1)).toMatchObject({
      status: 'MISSING_RATE',
      ruleVersionId: loaded.id,
    });
  });

  it('refuses a version that would leave two in effect on one date', async () => {
    await load(scheduleFile('OVERLAP-A', '2902-01-01', '2902-12-31'));
    for (const [code, from, to] of [
      ['OVERLAP-B', '2902-12-31', null],
      ['OVERLAP-C', '2901-06-01', '2902-01-01'],
      ['OVERLAP-D', '2902-03-01', '2902-03-31'],
    ] as const) {
      await expect(load(scheduleFile(code, from, to))).rejects.toMatchObject({
        code: 'OVERLAPPING_EFFECTIVITY',
      });
    }
    // The day after is not an overlap.
    await expect(
      load(scheduleFile('OVERLAP-E', '2903-01-01', '2903-12-31')),
    ).resolves.toMatchObject({ salaryGradeRateCount: 1 });
    await expect(load(scheduleFile('OVERLAP-E', '2950-01-01', null))).rejects.toMatchObject({
      code: 'CODE_EXISTS',
    });
    const refused = await admin.nationalPayrollRuleVersion.count({
      where: { code: { in: ['B', 'C', 'D'].map((code) => `${prefix}OVERLAP-${code}`) } },
    });
    expect(refused).toBe(0);
  });

  it('replaces a superseded version from its successor start and never falls back', async () => {
    const tranche = await load(
      scheduleFile('TRANCHE-1', '2904-01-01', null, {
        salaryGradeRates: [
          { salaryGrade: 1, salaryStep: 1, monthlyRate: '1000' },
          { salaryGrade: 1, salaryStep: 2, monthlyRate: '1010' },
        ],
      }),
    );
    await expect(load(scheduleFile('UNCHAINED', '2905-01-01', null))).rejects.toMatchObject({
      code: 'OVERLAPPING_EFFECTIVITY',
    });

    const next = await load(
      scheduleFile('TRANCHE-2', '2904-07-01', null, {
        supersedesCode: `${prefix}tranche-1`,
        salaryGradeRates: [{ salaryGrade: 1, salaryStep: 1, monthlyRate: '1100' }],
      }),
    );
    expect(next.supersedesRuleVersionId).toBe(tranche.id);
    expect(await lookup('2904-06-30')).toMatchObject({ ruleVersionId: tranche.id });
    expect(await lookup('2904-07-01')).toMatchObject({ ruleVersionId: next.id });
    // The successor lacks step 2; the superseded tranche does not answer for it.
    expect(await lookup('2904-07-01', 1, 2)).toMatchObject({
      status: 'MISSING_RATE',
      ruleVersionId: next.id,
    });

    // A correction from the same start replaces the version it corrects entirely.
    const correction = await load(
      scheduleFile('TRANCHE-2-CORRECTED', '2904-07-01', null, {
        supersedesCode: `${prefix}TRANCHE-2`,
        salaryGradeRates: [{ salaryGrade: 1, salaryStep: 1, monthlyRate: '1105.5' }],
      }),
    );
    const corrected = await lookup('2999-12-31');
    expect(corrected).toMatchObject({ status: 'FOUND', ruleVersionId: correction.id });
    expect(corrected.status === 'FOUND' && corrected.monthlyRate.toFixed(4)).toBe('1105.5000');

    await expect(
      load(
        scheduleFile('SECOND-SUCCESSOR', '2906-01-01', null, {
          supersedesCode: `${prefix}TRANCHE-1`,
        }),
      ),
    ).rejects.toMatchObject({ code: 'SUPERSEDED_VERSION_ALREADY_SUPERSEDED' });
    await expect(
      load(scheduleFile('ORPHAN', '2906-01-01', null, { supersedesCode: `${prefix}NOT-LOADED` })),
    ).rejects.toMatchObject({ code: 'SUPERSEDED_VERSION_NOT_FOUND' });
    await expect(
      load(scheduleFile('INVALID', '2906-01-01', null, { parameters: { divisor: 22 } })),
    ).rejects.toBeInstanceOf(LoadRuleVersionError);
  });

  it('reads versions with authority, effectivity, supersession, and rates as the application', async () => {
    const reader = new ReadNationalPayrollRuleVersionsService();
    const context = {
      requestId: 'rule-version-read',
      userId: '00000000-0000-4000-8000-000000000002',
      agencyId: '00000000-0000-4000-8000-000000000001',
      membershipId: '00000000-0000-4000-8000-000000000003',
      primaryOrganizationUnitId: null,
      permissions: [{ code: 'payroll.compensation.read', scopePolicy: 'AGENCY' as const }],
    };
    const first = await load(
      scheduleFile('READ-1', '2897-01-01', '2897-12-31', {
        salaryGradeRates: [
          { salaryGrade: 2, salaryStep: 1, monthlyRate: '2000' },
          { salaryGrade: 1, salaryStep: 2, monthlyRate: '1010.5' },
          { salaryGrade: 1, salaryStep: 1, monthlyRate: '1000' },
        ],
      }),
    );
    const second = await load(
      scheduleFile('READ-2', '2897-07-01', '2897-12-31', { supersedesCode: `${prefix}READ-1` }),
    );

    const { versions } = await reader.list(context);
    const byCode = new Map(versions.map((version) => [version.code, version]));
    expect(byCode.get(`${prefix}READ-1`)).toEqual({
      id: first.id,
      ruleKind: 'SALARY_SCHEDULE',
      code: `${prefix}READ-1`,
      name: 'Test salary schedule READ-1',
      issuingAuthority: 'Test authority',
      issuanceReference: 'Test fixture, not an issuance',
      sourceUrl: 'https://example.test/salary-schedule',
      verifiedOn: '2026-11-15',
      verifiedBy: 'LingkodHR test fixture',
      effectiveFrom: '2897-01-01',
      effectiveTo: '2897-12-31',
      loadedAt: expect.any(String),
      supersedes: null,
      supersededBy: { id: second.id, code: `${prefix}READ-2`, effectiveFrom: '2897-07-01' },
      salaryGradeRateCount: 3,
    });
    expect(byCode.get(`${prefix}READ-2`)).toMatchObject({
      supersedes: { id: first.id, code: `${prefix}READ-1` },
      supersededBy: null,
    });
    // Latest effective first within a kind.
    const ids = versions.map((version) => version.id);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));

    const detail = await reader.get(context, first.id);
    expect(detail.parameters).toEqual({});
    expect(detail.salaryGradeRates).toEqual([
      { salaryGrade: 1, salaryStep: 1, monthlyRate: '1000.0000' },
      { salaryGrade: 1, salaryStep: 2, monthlyRate: '1010.5000' },
      { salaryGrade: 2, salaryStep: 1, monthlyRate: '2000.0000' },
    ]);
    await expect(reader.get(context, '00000000-0000-4000-8000-000000000331')).rejects.toMatchObject(
      { statusCode: 404, code: 'RULE_VERSION_NOT_FOUND' },
    );
  });

  it('rejects every edit and delete of a loaded version and its rates', async () => {
    const { id } = await load(scheduleFile('IMMUTABLE', '2899-01-01', '2899-01-31'));
    const statements = [
      `UPDATE national_payroll_rule_versions SET name = 'Edited' WHERE id = '${id}'`,
      `UPDATE national_payroll_rule_versions SET effective_to = effective_from WHERE id = '${id}'`,
      `DELETE FROM national_payroll_rule_versions WHERE id = '${id}'`,
      `UPDATE salary_grade_rates SET monthly_rate = 1 WHERE rule_version_id = '${id}'`,
      `DELETE FROM salary_grade_rates WHERE rule_version_id = '${id}'`,
    ];
    for (const statement of statements) {
      // Even the table owner meets the trigger.
      await expect(admin.$executeRawUnsafe(statement)).rejects.toThrow(/immutable from load/);
      // The operator only inserts; the application role only reads.
      await expect(operator.$executeRawUnsafe(statement)).rejects.toThrow(/permission denied/);
      await expect(app.$executeRawUnsafe(statement)).rejects.toThrow(/permission denied/);
    }
    // A loaded schedule cannot gain a rate in a later load.
    await expect(
      operator.salaryGradeRate.create({
        data: { ruleVersionId: id, salaryGrade: 9, salaryStep: 1, monthlyRate: '1' },
      }),
    ).rejects.toThrow(/only in the load that inserts the version/);
    expect(await admin.salaryGradeRate.count({ where: { ruleVersionId: id } })).toBe(1);
  });

  it('refuses every insert from the application role', async () => {
    await expect(
      app.nationalPayrollRuleVersion.create({
        data: {
          ruleKind: 'SALARY_SCHEDULE',
          code: `${prefix}APP-INSERT`,
          name: 'Application insert',
          issuingAuthority: 'Test authority',
          issuanceReference: 'Test fixture',
          sourceUrl: 'https://example.test',
          verifiedOn: new Date('2026-11-15'),
          verifiedBy: 'Test',
          effectiveFrom: new Date('2907-01-01'),
        },
      }),
    ).rejects.toThrow(/permission denied/);
    const version = await load(scheduleFile('APP-RATE', '2898-01-01', '2898-01-31'));
    await expect(
      app.salaryGradeRate.create({
        data: { ruleVersionId: version.id, salaryGrade: 9, salaryStep: 1, monthlyRate: '1' },
      }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      app.payComponent.create({
        data: {
          code: `${prefix}APP-COMPONENT`,
          name: 'Application component',
          category: 'EARNING',
          isConditional: false,
          isGaaRevalidated: false,
          acceptsAuthorizedInput: false,
        },
      }),
    ).rejects.toThrow(/permission denied/);
    // Reading needs no Agency Context: the tables have no Agency policy.
    await expect(app.payComponent.count()).resolves.toBeGreaterThanOrEqual(0);
  });
});
