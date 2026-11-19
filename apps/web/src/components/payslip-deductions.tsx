import type { ReactNode } from 'react';
import { payeeCategoryLabel } from '../lib/payroll-rules';
import {
  contributionTypeLabel,
  moneyLabel,
  yearToDateFacts,
  type PayrollResultDetail,
} from '../lib/payroll-periods';
import { Facts } from './payroll-inputs-workspace';
import { StateSurface } from './state-surface';
import { Table, Td, Th, Tr } from './ui/table';

/**
 * A calculated payslip's Contribution Lines, Tax Line with its year-to-date snapshot, and Loan
 * Deduction Lines, each with its rule version. A blocked payslip has none, and Salary Computation
 * already says why, so this shows nothing for it.
 */
export function ContributionsTaxDeductions({ result }: { result: PayrollResultDetail }) {
  if (result.status !== 'CALCULATED') return null;
  const { contributions, taxLine, loanDeductions } = result;
  return (
    <>
      <Section label="Contributions">
        {contributions.length === 0 ? (
          <StateSurface compact label="No Contribution Lines">
            This payslip has no Contribution Lines.
          </StateSurface>
        ) : (
          <Table className="min-w-[760px]">
            <thead>
              <tr>
                <Th>Contribution</Th>
                <Th kind="numeric">Compensation base</Th>
                <Th kind="numeric">Employee share</Th>
                <Th kind="numeric">Employer share</Th>
                <Th>Rule version</Th>
              </tr>
            </thead>
            <tbody>
              {contributions.map((line) => (
                <Tr key={line.id}>
                  <Td>
                    <strong className="font-[600] text-ink">
                      {contributionTypeLabel[line.contributionType] ?? line.contributionType}
                    </strong>
                  </Td>
                  <Td kind="numeric">{moneyLabel(line.compensationBase)}</Td>
                  <Td kind="numeric">{moneyLabel(line.employeeShare)}</Td>
                  <Td kind="numeric">{moneyLabel(line.employerShare)}</Td>
                  <Td>
                    <RuleVersion version={line.ruleVersion} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <Section label="Withholding tax">
        {taxLine ? (
          <div className="grid gap-4">
            <Facts
              facts={[
                ['Taxable compensation', moneyLabel(taxLine.taxableCompensation)],
                ['Non-taxable compensation', moneyLabel(taxLine.nonTaxableCompensation)],
                ['Withholding tax', moneyLabel(taxLine.withholdingTax)],
                ['Rule version', <RuleVersion key="rule" version={taxLine.ruleVersion} />],
              ]}
            />
            <div className="grid gap-2">
              <h4 className="m-0 text-small font-[650] text-ink">
                Year to date before this period
              </h4>
              <YearToDate snapshot={taxLine.yearToDateSnapshot} />
            </div>
          </div>
        ) : (
          <StateSurface compact label="No Tax Line">
            This payslip has no Tax Line.
          </StateSurface>
        )}
      </Section>

      <Section label="Deductions">
        {loanDeductions.length === 0 ? (
          <StateSurface compact label="No Loan Deduction Lines">
            No Deduction Obligation was due in this period.
          </StateSurface>
        ) : (
          <Table className="min-w-[900px]">
            <thead>
              <tr>
                <Th kind="numeric">Order</Th>
                <Th>Payee</Th>
                <Th kind="numeric">Due</Th>
                <Th kind="numeric">Deducted</Th>
                <Th kind="numeric">Not deducted</Th>
                <Th>Rule version</Th>
              </tr>
            </thead>
            <tbody>
              {loanDeductions.map((line) => (
                <Tr key={line.id}>
                  <Td kind="numeric">{line.priority}</Td>
                  <Td>
                    <strong className="font-[600] text-ink">{line.payeeName}</strong>
                    <span className="block text-caption text-ink-muted">
                      {payeeCategoryLabel[line.payeeCategory] ?? line.payeeCategory} ·{' '}
                      {line.issuerReference}
                    </span>
                  </Td>
                  <Td kind="numeric">{moneyLabel(line.amountDue)}</Td>
                  <Td kind="numeric">{moneyLabel(line.deductedAmount)}</Td>
                  <Td kind="numeric">{moneyLabel(line.notDeductedAmount)}</Td>
                  <Td>
                    <RuleVersion version={line.ruleVersion} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="grid gap-2">
      <h3 className="m-0 text-panel-title text-ink">{label}</h3>
      {children}
    </section>
  );
}

function RuleVersion({ version }: { version: { code: string; name: string } }) {
  return (
    <>
      {version.code}
      <span className="block text-caption font-normal text-ink-muted">{version.name}</span>
    </>
  );
}

function YearToDate({ snapshot }: { snapshot: unknown }) {
  const facts = yearToDateFacts(snapshot);
  if (facts.length === 0) {
    return <p className="m-0 text-small text-ink-muted">The snapshot records no figures.</p>;
  }
  return <Facts facts={facts} />;
}
