'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { cn } from '../lib/class-names';
import { Field, inputClass } from './ui/field';
import { Button, buttonVariants } from './ui/button';
import { PageHeader } from './ui/page-header';
import { Panel } from './ui/panel';
import { RecordHeader } from './ui/record-header';
import { SectionTabList, SectionTabPanel, SectionTabs } from './ui/section-tabs';
import { StatusTag, type StatusTone } from './ui/status-tag';
import { useRecordNavigation } from './record-navigation';
import { employeeRecordSectionFor, type EmployeeRecordSection } from './employee-record-sections';
import { EmployeeDocumentsSection } from './employee-documents-client';
import { GovernmentIdentifiersSection } from './government-identifiers-client';
import { PayrollBankAccountsSection } from './payroll-bank-accounts-client';
import { SalnComplianceSection } from './saln-compliance-section';
import {
  EmployeePageTitle,
  employeeInputClass,
  formatEmployeeDate,
  titleCase,
} from './employee-directory';

export interface EmployeeMembershipSummary {
  id: string;
  displayName: string;
  email: string | null;
}

export interface EmployeeDetailData {
  id: string;
  employeeNumber: string;
  legalName: string;
  birthDate: string;
  sex: string;
  civilStatus: string;
  contactEmail: string;
  serviceStatus: string;
  membershipId: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
  linkableMemberships: EmployeeMembershipSummary[];
}

interface ErrorEnvelope {
  error?: { message?: string; fields?: Record<string, string> };
}

const serviceStatusTone: Record<string, StatusTone> = {
  PREBOARDING: 'info',
  ACTIVE: 'success',
  ON_EXTENDED_LEAVE: 'warning',
  SUSPENDED: 'danger',
  SEPARATED: 'neutral',
  DECEASED: 'neutral',
};

function humanize(value: string): string {
  return titleCase(value.replaceAll('_', ' '));
}

function membershipLabel(membership: EmployeeMembershipSummary): string {
  return membership.email
    ? `${membership.displayName} · ${membership.email}`
    : membership.displayName;
}

function targetValue(event: { target: unknown }): string {
  return (event.target as { value: string }).value;
}

export function EmployeeCreateForm({ agencyId }: { agencyId: string }) {
  const router = useRouter();
  const [values, setValues] = useState({
    employeeNumber: '',
    legalName: '',
    birthDate: '',
    sex: 'FEMALE',
    civilStatus: 'SINGLE',
    contactEmail: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  function change(name: keyof typeof values) {
    return (event: { target: unknown }) => {
      const value = targetValue(event);
      setValues((current) => ({ ...current, [name]: value }));
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setFields({});
    try {
      const response = await fetch(`/api/v1/agencies/${agencyId}/employees`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...values,
          employeeNumber: values.employeeNumber.trim(),
          legalName: values.legalName.trim(),
          contactEmail: values.contactEmail.trim(),
        }),
      });
      const value: unknown = await response.json().catch(() => null);
      if (
        response.ok &&
        value &&
        typeof value === 'object' &&
        typeof (value as { id?: unknown }).id === 'string'
      ) {
        router.push(`/employees/${(value as { id: string }).id}`);
        return;
      }
      setSubmitting(false);
      const envelope = (value ?? {}) as ErrorEnvelope;
      setFields(envelope.error?.fields ?? {});
      setError(envelope.error?.message ?? 'The Employee record could not be saved.');
    } catch {
      setError('The Employee record could not be saved. Check the connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function fieldError(name: string): string | undefined {
    return fields[name];
  }

  return (
    <>
      <Link
        href="/employees"
        className="mb-6 inline-block text-xs font-[650] text-cobalt no-underline"
      >
        ← Employee directory
      </Link>
      <header className="mb-7">
        <EmployeePageTitle
          eyebrow="Personnel records"
          title="Create preboarding employee"
          description="Add the stable identity record only. Service and appointment details come later."
        />
      </header>
      <form onSubmit={submit} className="overflow-hidden rounded-[4px] border border-line bg-paper">
        {error && (
          <p
            role="alert"
            className="m-0 border-b border-line bg-[#fdeeee] px-6 py-4 text-sm text-[#8f2d2d] min-[620px]:px-8"
          >
            {error}
          </p>
        )}
        <div className="grid gap-5 px-6 py-7 min-[620px]:grid-cols-2 min-[700px]:px-8">
          <Field label="Employee number" error={fieldError('employeeNumber')}>
            <input
              className={employeeInputClass}
              name="employeeNumber"
              value={values.employeeNumber}
              onChange={change('employeeNumber')}
              required
              maxLength={80}
            />
          </Field>
          <Field label="Legal name" error={fieldError('legalName')}>
            <input
              className={employeeInputClass}
              name="legalName"
              value={values.legalName}
              onChange={change('legalName')}
              placeholder="Given, middle, family name"
              required
              maxLength={300}
            />
          </Field>
          <Field label="Birth date" error={fieldError('birthDate')}>
            <input
              className={employeeInputClass}
              name="birthDate"
              type="date"
              value={values.birthDate}
              onChange={change('birthDate')}
              required
            />
          </Field>
          <Field label="Sex" error={fieldError('sex')}>
            <select
              className={employeeInputClass}
              name="sex"
              value={values.sex}
              onChange={change('sex')}
              required
            >
              <option value="FEMALE">Female</option>
              <option value="MALE">Male</option>
            </select>
          </Field>
          <Field label="Civil status" error={fieldError('civilStatus')}>
            <select
              className={employeeInputClass}
              name="civilStatus"
              value={values.civilStatus}
              onChange={change('civilStatus')}
              required
            >
              <option value="SINGLE">Single</option>
              <option value="MARRIED">Married</option>
              <option value="WIDOWED">Widowed</option>
              <option value="SEPARATED">Separated</option>
            </select>
          </Field>
          <Field label="Contact email" error={fieldError('contactEmail')}>
            <input
              className={employeeInputClass}
              name="contactEmail"
              type="email"
              value={values.contactEmail}
              onChange={change('contactEmail')}
              placeholder="name@example.com"
              required
              maxLength={320}
            />
          </Field>
          <p className="mb-0 border-l-2 border-[#d99a32] bg-[#fff9ec] p-4 text-xs leading-5 text-[#70490f] min-[620px]:col-span-2">
            Email is contact information. It will not link or replace an Agency Membership.
          </p>
        </div>
        <footer className="flex flex-col-reverse gap-3 border-t border-line px-6 py-5 min-[620px]:flex-row min-[620px]:justify-end min-[700px]:px-8">
          <Link
            href="/employees"
            className="inline-flex min-h-11 items-center justify-center rounded-[3px] bg-canvas px-4 text-sm font-[650] text-ink no-underline hover:bg-[#e8edf3]"
          >
            Cancel
          </Link>
          <Button type="submit" variant="primary" size="default" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create employee'}
          </Button>
        </footer>
      </form>
    </>
  );
}

export function EmployeeDetailView({
  agencyId,
  initial,
  canUpdate,
  canReadPds,
  canReadDocuments,
  canManageDocuments,
  canUploadOwnDocuments,
  canBrowseSourceDocuments,
  canReadIdentifiers,
  canManageIdentifiers,
  canRevealIdentifiers,
  canReadIdentifierHistory,
  canReadBankAccounts,
  canManageBankAccounts,
  canRevealBankAccounts,
  canReadBankAccountHistory,
  canReadSaln,
  canManageSaln,
  canCorrectSaln,
  canReadSalnHistory,
}: {
  agencyId: string;
  initial: EmployeeDetailData;
  canUpdate: boolean;
  canReadPds: boolean;
  canReadDocuments: boolean;
  canManageDocuments: boolean;
  canUploadOwnDocuments: boolean;
  canBrowseSourceDocuments: boolean;
  canReadIdentifiers: boolean;
  canManageIdentifiers: boolean;
  canRevealIdentifiers: boolean;
  canReadIdentifierHistory: boolean;
  canReadBankAccounts: boolean;
  canManageBankAccounts: boolean;
  canRevealBankAccounts: boolean;
  canReadBankAccountHistory: boolean;
  canReadSaln: boolean;
  canManageSaln: boolean;
  canCorrectSaln: boolean;
  canReadSalnHistory: boolean;
}) {
  const [detail, setDetail] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [selectedMembershipId, setSelectedMembershipId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'ok' | 'error'>('ok');
  const { search } = useRecordNavigation();
  const selection = employeeRecordSectionFor(search);
  const [section, setSection] = useState<EmployeeRecordSection>(selection ?? 'details');
  useEffect(() => {
    if (selection) setSection(selection);
  }, [selection]);
  const linked = detail.membershipId
    ? (detail.linkableMemberships.find((membership) => membership.id === detail.membershipId) ??
      null)
    : null;

  async function respond(response: Response, success: string): Promise<void> {
    const value: unknown = await response.json().catch(() => null);
    if (
      response.ok &&
      value &&
      typeof value === 'object' &&
      Array.isArray((value as EmployeeDetailData).linkableMemberships)
    ) {
      setDetail(value as EmployeeDetailData);
      setMessageTone('ok');
      setMessage(success);
      return;
    }
    const envelope = (value ?? {}) as ErrorEnvelope;
    setMessageTone('error');
    setMessage(envelope.error?.message ?? 'The request could not be completed.');
  }

  async function link(membershipId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/v1/agencies/${agencyId}/employees/${detail.id}/membership-link`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ membershipId }),
        },
      );
      await respond(response, 'Agency Membership linked to this Employee.');
    } catch {
      setMessageTone('error');
      setMessage(
        'The membership change could not be confirmed. Check the connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function unlink(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/v1/agencies/${agencyId}/employees/${detail.id}/membership-link`,
        { method: 'DELETE', credentials: 'include' },
      );
      await respond(response, 'Agency Membership unlinked from this Employee.');
    } catch {
      setMessageTone('error');
      setMessage(
        'The membership change could not be confirmed. Check the connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const sections: [EmployeeRecordSection, string, boolean][] = [
    ['details', 'Details', true],
    ['documents', 'Documents', canReadDocuments],
    [
      'identifiers',
      'Government identifiers',
      canReadIdentifiers ||
        canManageIdentifiers ||
        canRevealIdentifiers ||
        canReadIdentifierHistory,
    ],
    [
      'bank-accounts',
      'Payroll bank accounts',
      canReadBankAccounts ||
        canManageBankAccounts ||
        canRevealBankAccounts ||
        canReadBankAccountHistory,
    ],
    ['saln', 'SALN compliance', canReadSaln || canManageSaln],
  ];
  const tabs = sections
    .filter(([, , visible]) => visible)
    .map(([value, label]) => ({ value, label }));
  const selected = tabs.some((tab) => tab.value === section) ? section : 'details';

  function panel(value: EmployeeRecordSection) {
    // Hidden sections stay mounted so each keeps loading and holding its state as before.
    return { value, forceMount: true as const, hidden: selected !== value };
  }

  return (
    <SectionTabs
      value={selected}
      onValueChange={(value) => setSection(value as EmployeeRecordSection)}
    >
      <PageHeader
        breadcrumbs={[
          { label: 'Personnel' },
          { label: 'Employee directory', href: '/employees' },
          { label: detail.legalName },
        ]}
        tabs={<SectionTabList label="Employee record sections" tabs={tabs} />}
      >
        <RecordHeader
          name={detail.legalName}
          status={
            <StatusTag tone={serviceStatusTone[detail.serviceStatus] ?? 'neutral'}>
              {humanize(detail.serviceStatus)}
            </StatusTag>
          }
          facts={[
            { label: 'Employee no.', value: detail.employeeNumber },
            {
              label: 'Agency membership',
              value: detail.membershipId ? (
                <StatusTag tone="success">LINKED</StatusTag>
              ) : (
                <StatusTag tone="warning">UNLINKED</StatusTag>
              ),
            },
            { label: 'Created', value: formatEmployeeDate(detail.createdAt) },
          ]}
          actions={
            canReadPds ? (
              <Link
                href={`/employees/${detail.id}/pds`}
                className={buttonVariants({ variant: 'secondary' })}
              >
                Maintain PDS
              </Link>
            ) : null
          }
        />
      </PageHeader>
      <SectionTabPanel {...panel('details')} className="grid gap-5">
        <Panel title="Identity">
          <dl className="m-0 grid gap-x-10 gap-y-4 min-[620px]:grid-cols-2">
            {[
              ['Legal name', detail.legalName],
              ['Birth date', formatEmployeeDate(detail.birthDate)],
              ['Sex', titleCase(detail.sex)],
              ['Civil status', titleCase(detail.civilStatus)],
              ['Contact email', detail.contactEmail],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-caption text-ink-muted">{label}</dt>
                <dd className="m-0 text-body font-[600] text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title="Membership link">
          <p className="m-0 text-caption text-ink-muted">Linked Agency Membership</p>
          <p className="m-0 text-body font-[600] text-ink">
            {linked ? membershipLabel(linked) : 'Not linked'}
          </p>
          {canUpdate && (
            <div className="mt-4 flex flex-col gap-3 min-[620px]:flex-row min-[620px]:items-end">
              {detail.membershipId ? (
                <Button variant="secondary" onClick={unlink} disabled={busy}>
                  Unlink membership
                </Button>
              ) : detail.linkableMemberships.length > 0 ? (
                <>
                  <div className="min-[620px]:max-w-96 min-[620px]:grow">
                    <Field label="Agency Membership">
                      <select
                        className={inputClass}
                        value={selectedMembershipId}
                        onChange={(event) => setSelectedMembershipId(targetValue(event))}
                      >
                        <option value="" disabled>
                          Select the membership that represents this Employee
                        </option>
                        {detail.linkableMemberships.map((membership) => (
                          <option key={membership.id} value={membership.id}>
                            {membershipLabel(membership)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => {
                      if (selectedMembershipId) void link(selectedMembershipId);
                    }}
                  >
                    Link membership
                  </Button>
                </>
              ) : (
                <p className="m-0 text-small text-ink-muted">
                  No Agency Memberships are available to link.
                </p>
              )}
            </div>
          )}
          <p
            role="status"
            className={cn(
              'mb-0 mt-3 min-h-5 text-small',
              messageTone === 'ok' ? 'text-success' : 'text-danger',
            )}
          >
            {message}
          </p>
        </Panel>
        <p className="m-0 text-small text-ink-muted">
          Appointments, positions, salary, supervisors, separation, and retirement remain outside
          this record.
        </p>
      </SectionTabPanel>
      <SectionTabPanel {...panel('documents')}>
        <EmployeeDocumentsSection
          agencyId={agencyId}
          employeeId={detail.id}
          canRead={canReadDocuments}
          canManage={canManageDocuments}
          canUploadOwn={canUploadOwnDocuments}
          canBrowseSource={canBrowseSourceDocuments}
          canRemoveOwn={canUploadOwnDocuments}
        />
      </SectionTabPanel>
      <SectionTabPanel {...panel('identifiers')}>
        <GovernmentIdentifiersSection
          agencyId={agencyId}
          employeeId={detail.id}
          canRead={canReadIdentifiers}
          canManage={canManageIdentifiers}
          canReveal={canRevealIdentifiers}
          canReadHistory={canReadIdentifierHistory}
        />
      </SectionTabPanel>
      <SectionTabPanel {...panel('bank-accounts')}>
        <PayrollBankAccountsSection
          agencyId={agencyId}
          employeeId={detail.id}
          canReadEvidence={canReadDocuments}
          canRead={canReadBankAccounts}
          canManage={canManageBankAccounts}
          canReveal={canRevealBankAccounts}
          canReadHistory={canReadBankAccountHistory}
        />
      </SectionTabPanel>
      <SectionTabPanel {...panel('saln')}>
        <SalnComplianceSection
          agencyId={agencyId}
          employeeId={detail.id}
          canRead={canReadSaln}
          canManage={canManageSaln}
          canCorrect={canCorrectSaln}
          canReadHistory={canReadSalnHistory}
          canReadEvidence={canReadDocuments}
        />
      </SectionTabPanel>
    </SectionTabs>
  );
}
