import { expect, it } from 'vitest';
import {
  LEAVE_CALENDAR_BASES,
  LEAVE_CATALOGUE,
  LEAVE_EVALUATOR_KINDS,
  assertLeaveCatalogueIntegrity,
  findLeaveCatalogueEntry,
  parseLeaveRuleParameters,
} from './leave-catalogue';
import { evaluateLeavePolicyConfiguration } from './leave-policies.service';

function entry(code: string) {
  const found = findLeaveCatalogueEntry(code);
  if (!found) throw new Error(`The Leave catalogue is missing ${code}.`);
  return found;
}

function configuredVersion(code: string) {
  const source = entry(code);
  return {
    status: 'DRAFT' as const,
    ruleParameters: source.ruleParameters,
    applicabilityRules: { profiles: [...source.personnelProfiles], excludedProfiles: [] },
    documentRequirements: { required: [...source.requiredEvidenceKinds], additional: [] },
    authorities: [
      { authorityClass: 'NATIONAL_RULE' },
      ...(source.requiresAgencyConfigurationEvidence
        ? [{ authorityClass: 'AGENCY_CONFIGURATION' }]
        : []),
    ],
    chargedLeaveType: source.chargedLeaveTypeCode
      ? { code: source.chargedLeaveTypeCode, status: 'ACTIVE' }
      : null,
  };
}

it('keeps the fixed government leave catalogue internally consistent', () => {
  expect(() => assertLeaveCatalogueIntegrity()).not.toThrow();
  expect(LEAVE_CATALOGUE).toHaveLength(16);
  for (const source of LEAVE_CATALOGUE) {
    expect(LEAVE_EVALUATOR_KINDS).toContain(source.evaluatorKind);
    expect(source.authorityCitations.length).toBeGreaterThan(0);
  }
});

it('fixes the Vacation Leave accrual values to the national rule', () => {
  const vacation = entry('VACATION_LEAVE');
  expect(vacation.evaluatorKind).toBe('SERVICE_ACCRUAL');
  expect(vacation.ruleParameters).toMatchObject({
    earnDays: 1,
    perServiceDays: 24,
    annualCreditDays: 15,
    accumulation: 'UNLIMITED',
  });
});

it('models Leave Without Pay as a non-credit authorization rather than a credit', () => {
  const lwop = entry('LEAVE_WITHOUT_PAY');
  expect(lwop.evaluatorKind).toBe('NON_CREDIT_AUTHORIZATION');
  expect(lwop.entitlementBasis).toBe('NON_CREDIT_AUTHORIZATION');
  expect(lwop.ruleParameters).toMatchObject({ paid: false, chargesLedger: false });
});

it('keeps the source-defined two-month special leave benefit in months', () => {
  const benefits = entry('SPECIAL_LEAVE_BENEFITS_FOR_WOMEN');
  expect(benefits.ruleParameters).toMatchObject({
    qualifyingEvent: 'GYNECOLOGICAL_SURGERY',
    grantedMonths: 2,
  });
  expect(benefits.ruleParameters.grantedDays).toBeUndefined();
});

it('resolves every deterministically supported catalogue entry', () => {
  for (const source of LEAVE_CATALOGUE.filter((candidate) => !candidate.failClosed)) {
    const assessment = evaluateLeavePolicyConfiguration(source, configuredVersion(source.code));
    if (assessment.result !== 'RESOLVED') {
      throw new Error(
        `Expected ${source.code} to resolve but found ${assessment.reasons.join(', ')}`,
      );
    }
  }
});

it('fails closed for the source-defined placeholder entry', () => {
  const assessment = evaluateLeavePolicyConfiguration(
    entry('OTHER_LEAVE_UNDER_LAW'),
    configuredVersion('OTHER_LEAVE_UNDER_LAW'),
  );
  expect(assessment).toEqual({
    result: 'INDETERMINATE',
    reasons: ['FAIL_CLOSED_PLACEHOLDER'],
  });
});

it('rejects national-rule parameter substitutions', () => {
  const vacation = entry('VACATION_LEAVE');
  const assessment = evaluateLeavePolicyConfiguration(vacation, {
    ...configuredVersion('VACATION_LEAVE'),
    ruleParameters: { ...vacation.ruleParameters, annualCreditDays: 20 },
  });
  expect(assessment.reasons).toContain('NATIONAL_RULE_PARAMETERS_INVALID');
});

it('fails closed when a personnel profile is outside the accepted catalogue', () => {
  const assessment = evaluateLeavePolicyConfiguration(entry('VACATION_LEAVE'), {
    ...configuredVersion('VACATION_LEAVE'),
    applicabilityRules: { profiles: ['TEACHER'], excludedProfiles: [] },
  });
  expect(assessment).toEqual({
    result: 'INDETERMINATE',
    reasons: ['UNSUPPORTED_PERSONNEL_PROFILE:TEACHER'],
  });
});

it('detects include and exclude conflicts and invalid applicability shapes', () => {
  const vacation = entry('VACATION_LEAVE');
  const conflict = evaluateLeavePolicyConfiguration(vacation, {
    ...configuredVersion('VACATION_LEAVE'),
    applicabilityRules: {
      profiles: ['ORDINARY_CIVILIAN_NGA'],
      excludedProfiles: ['ORDINARY_CIVILIAN_NGA'],
    },
  });
  expect(conflict.reasons).toContain('APPLICABILITY_CONFLICT');

  const empty = evaluateLeavePolicyConfiguration(vacation, {
    ...configuredVersion('VACATION_LEAVE'),
    applicabilityRules: { profiles: [], excludedProfiles: [] },
  });
  expect(empty.reasons).toContain('APPLICABILITY_INVALID');
});

it('requires the catalogue evidence set without duplicates', () => {
  const vacation = entry('VACATION_LEAVE');
  const missingEvidence = evaluateLeavePolicyConfiguration(vacation, {
    ...configuredVersion('VACATION_LEAVE'),
    documentRequirements: { required: [], additional: [] },
  });
  expect(missingEvidence.reasons).toContain('DOCUMENT_REQUIREMENTS_INVALID');

  const duplicate = evaluateLeavePolicyConfiguration(vacation, {
    ...configuredVersion('VACATION_LEAVE'),
    documentRequirements: {
      required: [...vacation.requiredEvidenceKinds],
      additional: [...vacation.requiredEvidenceKinds],
    },
  });
  expect(duplicate.reasons).toContain('DOCUMENT_REQUIREMENTS_INVALID');
});

it('requires a national-rule authority and, when applicable, an Agency configuration authority', () => {
  const vacation = configuredVersion('VACATION_LEAVE');
  const withoutNational = evaluateLeavePolicyConfiguration(entry('VACATION_LEAVE'), {
    ...vacation,
    authorities: [],
  });
  expect(withoutNational.reasons).toContain('MISSING_NATIONAL_RULE_AUTHORITY');

  const wellness = configuredVersion('WELLNESS_LEAVE');
  const withoutAgency = evaluateLeavePolicyConfiguration(entry('WELLNESS_LEAVE'), {
    ...wellness,
    authorities: wellness.authorities.filter(
      (authority) => authority.authorityClass === 'NATIONAL_RULE',
    ),
  });
  expect(withoutAgency.reasons).toContain('MISSING_AGENCY_CONFIGURATION_AUTHORITY');
});

it('requires the charged Leave Type for mandatory leave', () => {
  const mandatory = entry('MANDATORY_LEAVE');
  const missing = evaluateLeavePolicyConfiguration(mandatory, {
    ...configuredVersion('MANDATORY_LEAVE'),
    chargedLeaveType: null,
  });
  expect(missing.reasons).toContain('MISSING_CHARGED_LEAVE_TYPE');

  const wrong = evaluateLeavePolicyConfiguration(mandatory, {
    ...configuredVersion('MANDATORY_LEAVE'),
    chargedLeaveType: { code: 'SICK_LEAVE', status: 'ACTIVE' },
  });
  expect(wrong.reasons).toContain('INVALID_CHARGED_LEAVE_TYPE');

  const inactive = evaluateLeavePolicyConfiguration(mandatory, {
    ...configuredVersion('MANDATORY_LEAVE'),
    status: 'ACTIVE',
    chargedLeaveType: { code: 'VACATION_LEAVE', status: 'INACTIVE' },
  });
  expect(inactive.reasons).toContain('MISSING_CHARGED_LEAVE_TYPE');

  const superseded = evaluateLeavePolicyConfiguration(mandatory, {
    ...configuredVersion('MANDATORY_LEAVE'),
    status: 'SUPERSEDED',
    chargedLeaveType: { code: 'VACATION_LEAVE', status: 'INACTIVE' },
  });
  expect(superseded.result).toBe('RESOLVED');
});

it('admits every accepted calendar basis for a policy version', () => {
  expect(LEAVE_CALENDAR_BASES).toEqual([
    'WORKING_DAY',
    'CALENDAR_DAY',
    'SCHEDULED_TIME',
    'SOURCE_DEFINED',
  ]);
});

it('validates rule parameter shape strictly', () => {
  expect(parseLeaveRuleParameters({ earnDays: 1, perServiceDays: 24 }).success).toBe(true);
  expect(parseLeaveRuleParameters({ earnDays: -1 }).success).toBe(false);
  expect(parseLeaveRuleParameters({ formula: 'earned * 2' }).success).toBe(false);
});
