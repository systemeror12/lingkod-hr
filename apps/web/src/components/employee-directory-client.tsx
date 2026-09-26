'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Field, FormError, inputClass } from './ui/field';
import { PageHeader } from './ui/page-header';
import { Panel } from './ui/panel';
import { Button, buttonVariants } from './ui/button';
import { EmployeeDocumentsSection } from './employee-documents-client';
import { GovernmentIdentifiersSection } from './government-identifiers-client';
import { PayrollBankAccountsSection } from './payroll-bank-accounts-client';
import { SalnComplianceSection } from './saln-compliance-section';
import {
  EmployeeInitials,
  EmployeePageTitle,
  EmployeeStatus,
  employeeInputClass,
  employeeLabelClass,
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
      <PageHeader
        breadcrumbs={[{ label: 'Employees', href: '/employees' }, { label: 'Create employee' }]}
        title="Create preboarding employee"
      />
      <form onSubmit={submit} className="grid gap-4">
        <FormError message={error ?? ''} />
        <Panel title="Stable identity record">
          <p className="mt-0 mb-4 text-body text-ink-muted">
            Add the stable identity record only. Service and appointment details come later.
          </p>
          <div className="grid gap-4 min-[620px]:grid-cols-2">
            <Field label="Employee number" error={fieldError('employeeNumber')}>
              <input
                className={inputClass}
                name="employeeNumber"
                value={values.employeeNumber}
                onChange={change('employeeNumber')}
                required
                maxLength={80}
              />
            </Field>
            <Field label="Legal name" error={fieldError('legalName')}>
              <input
                className={inputClass}
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
                className={inputClass}
                name="birthDate"
                type="date"
                value={values.birthDate}
                onChange={change('birthDate')}
                required
              />
            </Field>
            <Field label="Sex" error={fieldError('sex')}>
              <select
                className={inputClass}
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
                className={inputClass}
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
                className={inputClass}
                name="contactEmail"
                type="email"
                value={values.contactEmail}
                onChange={change('contactEmail')}
                placeholder="name@example.com"
                required
                maxLength={320}
              />
            </Field>
            <p className="m-0 border-l-2 border-info bg-canvas px-3 py-2.5 text-small text-ink-muted min-[620px]:col-span-2">
              Email is contact information. It will not link or replace an Agency Membership.
            </p>
          </div>
        </Panel>
        <div className="flex flex-col-reverse gap-2 min-[620px]:flex-row min-[620px]:justify-end">
          <Link href="/employees" className={buttonVariants({ variant: 'secondary' })}>
            Cancel
          </Link>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create employee'}
          </Button>
        </div>
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

  return (
    <>
      <Link
        href="/employees"
        className="mb-6 inline-block text-xs font-[650] text-cobalt no-underline"
      >
        ← Employee directory
      </Link>
      <header className="mb-7 flex flex-col gap-5 min-[700px]:flex-row min-[700px]:items-end min-[700px]:justify-between">
        <EmployeePageTitle
          eyebrow="Personnel records"
          title={detail.legalName}
          description={`Stable identity record · ${detail.employeeNumber}`}
        />
        <div className="flex flex-wrap items-center gap-3">
          <EmployeeStatus linked={Boolean(detail.membershipId)} />
          {canReadPds && (
            <Link
              href={`/employees/${detail.id}/pds`}
              className={buttonVariants({ variant: 'secondary', size: 'default' })}
            >
              Maintain PDS
            </Link>
          )}
        </div>
      </header>
      <article className="overflow-hidden rounded-[4px] border border-line bg-paper">
        <div className="flex items-center gap-5 border-b border-line px-6 py-6 min-[700px]:px-8">
          <EmployeeInitials name={detail.legalName} large />
          <div>
            <p className="m-0 text-[10px] font-bold tracking-[.08em] text-muted uppercase">
              Service status
            </p>
            <strong className="mt-1 block text-sm text-ink">{detail.serviceStatus}</strong>
          </div>
        </div>
        <dl className="grid gap-x-10 gap-y-6 px-6 py-7 min-[620px]:grid-cols-2 min-[700px]:px-8">
          {[
            ['Legal name', detail.legalName],
            ['Birth date', formatEmployeeDate(detail.birthDate)],
            ['Sex', titleCase(detail.sex)],
            ['Civil status', titleCase(detail.civilStatus)],
            ['Contact email', detail.contactEmail],
            ['Employee number', detail.employeeNumber],
            ['Created', formatEmployeeDate(detail.createdAt)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-[10px] font-bold tracking-[.08em] text-muted uppercase">
                {label}
              </dt>
              <dd className="mt-1 ml-0 text-sm font-[560] text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-line px-6 py-5 min-[700px]:px-8">
          <p className="m-0 text-[10px] font-bold tracking-[.08em] text-muted uppercase">
            Agency membership
          </p>
          <strong className="mt-1 block text-sm text-ink">
            {linked ? membershipLabel(linked) : 'Not linked'}
          </strong>
          {canUpdate && (
            <div className="mt-4 flex flex-col gap-3 min-[620px]:flex-row min-[620px]:items-center">
              {detail.membershipId ? (
                <Button variant="secondary" size="default" onClick={unlink} disabled={busy}>
                  Unlink membership
                </Button>
              ) : detail.linkableMemberships.length > 0 ? (
                <>
                  <label className={`${employeeLabelClass} min-[620px]:max-w-96 min-[620px]:grow`}>
                    Agency Membership
                    <select
                      className={employeeInputClass}
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
                  </label>
                  <Button
                    variant="primary"
                    size="default"
                    disabled={busy}
                    onClick={() => {
                      if (selectedMembershipId) void link(selectedMembershipId);
                    }}
                  >
                    Link membership
                  </Button>
                </>
              ) : (
                <p className="m-0 text-xs text-muted">
                  No Agency Memberships are available to link.
                </p>
              )}
            </div>
          )}
          <p
            role="status"
            className={`mb-0 mt-3 min-h-5 text-xs ${messageTone === 'ok' ? 'text-[#27633b]' : 'text-[#8f2d2d]'}`}
          >
            {message}
          </p>
        </div>
        <EmployeeDocumentsSection
          agencyId={agencyId}
          employeeId={detail.id}
          canRead={canReadDocuments}
          canManage={canManageDocuments}
          canUploadOwn={canUploadOwnDocuments}
          canBrowseSource={canBrowseSourceDocuments}
          canRemoveOwn={canUploadOwnDocuments}
        />
        <GovernmentIdentifiersSection
          agencyId={agencyId}
          employeeId={detail.id}
          canRead={canReadIdentifiers}
          canManage={canManageIdentifiers}
          canReveal={canRevealIdentifiers}
          canReadHistory={canReadIdentifierHistory}
        />
        <PayrollBankAccountsSection
          agencyId={agencyId}
          employeeId={detail.id}
          canReadEvidence={canReadDocuments}
          canRead={canReadBankAccounts}
          canManage={canManageBankAccounts}
          canReveal={canRevealBankAccounts}
          canReadHistory={canReadBankAccountHistory}
        />
        <SalnComplianceSection
          agencyId={agencyId}
          employeeId={detail.id}
          canRead={canReadSaln}
          canManage={canManageSaln}
          canCorrect={canCorrectSaln}
          canReadHistory={canReadSalnHistory}
          canReadEvidence={canReadDocuments}
        />
        <div className="border-t border-line bg-pale-blue px-6 py-4 text-xs leading-5 text-[#34557e] min-[700px]:px-8">
          Appointments, positions, salary, supervisors, separation, and retirement remain outside
          this record.
        </div>
      </article>
    </>
  );
}
