'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import type { AuthorityOption, EmployeeOption } from '../lib/payroll-page-data';
import {
  contributionTypeLabel,
  moneyLabel,
  type ContributionBilling,
  type ContributionType,
} from '../lib/payroll-periods';
import { cn } from '../lib/class-names';
import { StateSurface } from './state-surface';
import { Button } from './ui/button';
import {
  DialogBody,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Field, FormError, inputClass, labelClass } from './ui/field';
import { StatusTag } from './ui/status-tag';
import { Table, Td, Th, Tr } from './ui/table';

/** The body `POST /payroll-periods/:periodId/contribution-billings` takes. */
export interface ContributionBillingInput {
  contributionType: ContributionType;
  evidenceDocumentId: string;
  evidenceDocumentVersionId: string;
  lines: { employeeId: string; employeeShare: string; employerShare: string }[];
}

/**
 * A period's issuer billings, current and superseded. A billing is evidence the next calculation
 * compares with its Contribution Lines; it never replaces a calculated share.
 */
export function ContributionBillingTable({
  billings,
  employeeLabel,
  evidenceLabel,
}: {
  billings: ContributionBilling[];
  employeeLabel: (employeeId: string) => ReactNode;
  evidenceLabel: (versionId: string) => ReactNode;
}) {
  if (billings.length === 0) {
    return (
      <StateSurface compact label="No contribution billing">
        No issuer billing recorded for this period.
      </StateSurface>
    );
  }
  return (
    <Table className="min-w-[880px]">
      <thead>
        <tr>
          <Th>Employee</Th>
          <Th>Contribution</Th>
          <Th kind="numeric">Employee share</Th>
          <Th kind="numeric">Employer share</Th>
          <Th>Evidence</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {billings.map((billing) => (
          <Tr key={billing.id}>
            <Td>{employeeLabel(billing.employeeId)}</Td>
            <Td>{contributionTypeLabel[billing.contributionType] ?? billing.contributionType}</Td>
            <Td kind="numeric">{moneyLabel(billing.employeeShare)}</Td>
            <Td kind="numeric">{moneyLabel(billing.employerShare)}</Td>
            <Td>{evidenceLabel(billing.evidenceDocumentVersionId)}</Td>
            <Td>
              <StatusTag tone={billing.current ? 'info' : 'neutral'}>
                {billing.current ? 'Current' : 'Superseded'}
              </StatusTag>
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

type Line = { employeeId: string; employeeShare: string; employerShare: string };
const emptyLine: Line = { employeeId: '', employeeShare: '', employerShare: '' };

function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

/**
 * The form that records one issuer billing statement for a regular period in Draft: its
 * contribution type, its finalized evidence, and the shares it bills each Employee. Recording an
 * Employee again corrects the earlier billing, which stays as superseded.
 */
export function ContributionBillingForm({
  periodCode,
  employees,
  authorities,
  busy,
  error,
  onSubmit,
}: {
  periodCode: string;
  employees: EmployeeOption[];
  authorities: AuthorityOption[];
  busy: boolean;
  error: string;
  onSubmit: (input: ContributionBillingInput) => void;
}) {
  const [contributionType, setContributionType] = useState<ContributionType>('PHILHEALTH');
  const [evidenceVersionId, setEvidenceVersionId] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine]);
  const employerOnly = contributionType === 'EMPLOYEES_COMPENSATION';

  function setLine(index: number, key: keyof Line, value: string): void {
    setLines((current) =>
      current.map((line, at) => (at === index ? { ...line, [key]: value } : line)),
    );
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const evidence = authorities.find((authority) => authority.id === evidenceVersionId);
    onSubmit({
      contributionType,
      evidenceDocumentId: evidence?.documentId ?? '',
      evidenceDocumentVersionId: evidenceVersionId,
      lines: lines.map((line) => ({
        ...line,
        // Employees' Compensation is employer-only; the issuer bills no employee share.
        employeeShare: employerOnly ? '0' : line.employeeShare,
      })),
    });
  }

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
      <DialogHeader>
        <div className="grid min-w-0 gap-1.5">
          <DialogTitle>Record contribution billing</DialogTitle>
          <DialogDescription id="payslips-form-description">
            {periodCode}. The next calculation compares each billed share with the share it
            calculates; a difference blocks the period until it is resolved or corrected.
          </DialogDescription>
        </div>
      </DialogHeader>
      <DialogBody className="grid gap-5">
        <div className="grid gap-5 min-[621px]:grid-cols-2">
          <Field htmlFor="billing-contribution-type" label="Contribution">
            <select
              className={inputClass}
              id="billing-contribution-type"
              onChange={(event) => setContributionType(targetValue(event) as ContributionType)}
              value={contributionType}
            >
              {Object.entries(contributionTypeLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field htmlFor="billing-evidence" label="Billing statement">
            <select
              className={inputClass}
              id="billing-evidence"
              onChange={(event) => setEvidenceVersionId(targetValue(event))}
              required
              value={evidenceVersionId}
            >
              <option value="">
                {authorities.length === 0
                  ? 'No Document Versions you can read'
                  : 'Choose the statement'}
              </option>
              {authorities.map((authority) => (
                <option key={authority.id} value={authority.id}>
                  {authority.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <fieldset className="m-0 grid gap-3 border-0 p-0">
          <legend className={cn(labelClass, 'mb-1')}>Billed shares</legend>
          {lines.map((line, index) => {
            const row = index + 1;
            return (
              <div
                key={index}
                className="grid items-end gap-3 min-[621px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
              >
                <Field htmlFor={`billing-employee-${row}`} label={`Employee ${row}`}>
                  <select
                    className={inputClass}
                    id={`billing-employee-${row}`}
                    onChange={(event) => setLine(index, 'employeeId', targetValue(event))}
                    required
                    value={line.employeeId}
                  >
                    <option value="">
                      {employees.length === 0 ? 'No Employees you can read' : 'Choose an Employee'}
                    </option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.employeeNumber} · {employee.legalName}
                      </option>
                    ))}
                  </select>
                </Field>
                {employerOnly ? (
                  <p className="m-0 pb-2 text-small text-ink-muted">No employee share</p>
                ) : (
                  <Field htmlFor={`billing-employee-share-${row}`} label={`Employee share ${row}`}>
                    <input
                      className={inputClass}
                      id={`billing-employee-share-${row}`}
                      inputMode="decimal"
                      onChange={(event) => setLine(index, 'employeeShare', targetValue(event))}
                      required
                      value={line.employeeShare}
                    />
                  </Field>
                )}
                <Field htmlFor={`billing-employer-share-${row}`} label={`Employer share ${row}`}>
                  <input
                    className={inputClass}
                    id={`billing-employer-share-${row}`}
                    inputMode="decimal"
                    onChange={(event) => setLine(index, 'employerShare', targetValue(event))}
                    required
                    value={line.employerShare}
                  />
                </Field>
                <Button
                  disabled={lines.length === 1}
                  onClick={() => setLines((current) => current.filter((_, at) => at !== index))}
                  type="button"
                >
                  Remove<span className="sr-only"> Employee {row}</span>
                </Button>
              </div>
            );
          })}
          <div>
            <Button onClick={() => setLines((current) => [...current, emptyLine])} type="button">
              Add an Employee
            </Button>
          </div>
        </fieldset>
        <FormError message={error} />
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button disabled={busy} type="button" variant="secondary">
            Cancel
          </Button>
        </DialogClose>
        <Button disabled={busy} type="submit" variant="primary">
          {busy ? 'Recording…' : 'Record billing'}
        </Button>
      </DialogFooter>
    </form>
  );
}
