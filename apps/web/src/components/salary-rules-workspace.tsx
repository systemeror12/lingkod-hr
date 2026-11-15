'use client';

import { useEffect, useState } from 'react';
import { dateLabel } from '../lib/overtime-format';
import { decimalLabel } from '../lib/payroll-inputs';
import {
  allowedPayeeCategories,
  compareRates,
  effectivityLabel,
  payeeCategoryLabel,
  ruleKindLabel,
  supersessionDisplay,
  type RuleVersionDetail,
  type RuleVersionSummary,
} from '../lib/payroll-rules';
import { Facts } from './payroll-inputs-workspace';
import { StateSurface } from './state-surface';
import { Button } from './ui/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { FormError, inputClass, labelClass } from './ui/field';
import { PageHeader, type Breadcrumb } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag } from './ui/status-tag';
import { Table, Td, Th, Tr } from './ui/table';

const linkButtonClass =
  'w-fit cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-primary hover:underline';

/**
 * Salary Rules: the National Payroll Rule Versions the platform operator loaded, as a read-only
 * list and form. A version opens to its authority, effectivity, supersession, and values, and can
 * be compared with another version of its kind.
 */
export function SalaryRulesWorkspace({
  agencyId,
  versions,
  initialOpenId,
}: {
  agencyId: string;
  versions: RuleVersionSummary[];
  initialOpenId: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(
    versions.some(({ id }) => id === initialOpenId) ? initialOpenId : null,
  );
  const [compareId, setCompareId] = useState('');
  const [details, setDetails] = useState<Record<string, RuleVersionDetail>>({});
  const [error, setError] = useState('');
  const open = versions.find(({ id }) => id === openId);
  const compared = versions.find(({ id }) => id === compareId);

  useEffect(() => {
    const wanted = [openId, compareId].filter((id): id is string => Boolean(id) && !details[id!]);
    if (wanted.length === 0) return;
    let cancelled = false;
    void Promise.all(
      wanted.map(async (id) => {
        const response = await fetch(
          `/api/v1/agencies/${agencyId}/national-payroll-rule-versions/${encodeURIComponent(id)}`,
          { credentials: 'include' },
        );
        const value = (await response.json().catch(() => null)) as
          (RuleVersionDetail & { error?: { message?: string } }) | null;
        if (!response.ok || !value) {
          throw new Error(value?.error?.message ?? 'The rule version could not be loaded.');
        }
        return value;
      }),
    ).then(
      (loaded) => {
        if (cancelled) return;
        setDetails((current) => ({
          ...current,
          ...Object.fromEntries(loaded.map((detail) => [detail.id, detail])),
        }));
      },
      (caught: unknown) => {
        if (cancelled) return;
        setError(
          caught instanceof Error ? caught.message : 'The rule version could not be loaded.',
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [agencyId, openId, compareId, details]);

  function openVersion(id: string): void {
    setError('');
    setCompareId('');
    setOpenId(id);
  }

  const breadcrumbs: Breadcrumb[] = [
    { label: 'Payroll' },
    { label: 'Configuration' },
    { label: 'Salary Rules' },
  ];
  if (open) breadcrumbs.push({ label: open.code });
  const detail = open ? details[open.id] : undefined;
  const comparedDetail = compared ? details[compared.id] : undefined;

  return (
    <Dialog
      presentation="form"
      open={open !== undefined}
      onOpenChange={(next) => !next && setOpenId(null)}
    >
      <div className="grid gap-5">
        <PageHeader breadcrumbs={breadcrumbs} title="Salary Rules" />

        <div hidden={open !== undefined} className="grid min-w-0 gap-5">
          <p className="m-0 max-w-[760px] text-small text-ink-muted">
            National Payroll Rule Versions apply to every Agency. The platform operator loads each
            one from its issuance; none is edited here. A correction or a new issuance is a new
            version that supersedes the one before it from its own start date.
          </p>

          <Panel
            title="National Payroll Rule Versions"
            flush
            actions={
              <span className="text-caption text-ink-muted">
                {versions.length === 1 ? '1 version' : `${versions.length} versions`}
              </span>
            }
          >
            {versions.length === 0 ? (
              <StateSurface compact label="National Payroll Rule Versions">
                <strong className="text-body font-[650] text-ink">
                  No rule versions are loaded yet.
                </strong>
                <p className="m-0 max-w-[560px]">
                  Until a salary schedule is loaded, every compensation basis is indeterminate.
                </p>
              </StateSurface>
            ) : (
              <Table className="min-w-[960px]">
                <thead>
                  <tr>
                    <Th>Version</Th>
                    <Th>Kind</Th>
                    <Th>Authority</Th>
                    <Th kind="date">Effective</Th>
                    <Th>Supersession</Th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((version) => {
                    const supersession = supersessionDisplay(version);
                    return (
                      <Tr key={version.id}>
                        <Td>
                          <DialogTrigger asChild>
                            <button
                              className={linkButtonClass}
                              onClick={() => openVersion(version.id)}
                              type="button"
                            >
                              {version.code}
                            </button>
                          </DialogTrigger>
                          <span className="block text-caption text-ink-muted">{version.name}</span>
                        </Td>
                        <Td>{ruleKindLabel[version.ruleKind] ?? version.ruleKind}</Td>
                        <Td>
                          {version.issuingAuthority}
                          <span className="block text-caption text-ink-muted">
                            {version.issuanceReference}
                          </span>
                        </Td>
                        <Td kind="date">{effectivityLabel(version)}</Td>
                        <Td>
                          <StatusTag tone={supersession.tone}>{supersession.label}</StatusTag>
                          {version.supersededBy ? (
                            <span className="block text-caption text-ink-muted">
                              by {version.supersededBy.code}
                            </span>
                          ) : version.supersedes ? (
                            <span className="block text-caption text-ink-muted">
                              supersedes {version.supersedes.code}
                            </span>
                          ) : null}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        <DialogContent aria-describedby="rule-version-description" aria-busy={open && !detail}>
          {open ? (
            <>
              <DialogHeader>
                <div className="grid min-w-0 gap-1.5">
                  <DialogTitle>{open.code}</DialogTitle>
                  <DialogDescription id="rule-version-description">
                    {open.name} · {ruleKindLabel[open.ruleKind] ?? open.ruleKind}. Read-only.
                  </DialogDescription>
                </div>
                <StatusTag tone={supersessionDisplay(open).tone}>
                  {supersessionDisplay(open).label}
                </StatusTag>
              </DialogHeader>
              <DialogBody className="grid gap-6">
                <FormError message={error} />
                <Facts
                  facts={[
                    ['Issuing authority', open.issuingAuthority],
                    ['Issuance', open.issuanceReference],
                    [
                      'Source',
                      <a
                        key="source"
                        className="break-all text-primary"
                        href={open.sourceUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {open.sourceUrl}
                      </a>,
                    ],
                    ['Verified', `${dateLabel(open.verifiedOn)} by ${open.verifiedBy}`],
                    ['Effective', effectivityLabel(open)],
                    ['Loaded', dateLabel(open.loadedAt)],
                    [
                      'Supersedes',
                      open.supersedes ? (
                        <button
                          key="supersedes"
                          className={linkButtonClass}
                          onClick={() => openVersion(open.supersedes!.id)}
                          type="button"
                        >
                          {open.supersedes.code}
                        </button>
                      ) : (
                        'No earlier version'
                      ),
                    ],
                    [
                      'Superseded by',
                      open.supersededBy ? (
                        <span key="superseded">
                          <button
                            className={linkButtonClass}
                            onClick={() => openVersion(open.supersededBy!.id)}
                            type="button"
                          >
                            {open.supersededBy.code}
                          </button>{' '}
                          from {dateLabel(open.supersededBy.effectiveFrom)}
                        </span>
                      ) : (
                        'Not superseded'
                      ),
                    ],
                  ]}
                />

                <VersionValues version={open} detail={detail} failed={error !== ''} />

                <section className="grid gap-3" aria-labelledby="rule-version-compare-title">
                  <h3 className="m-0 text-panel-title text-ink" id="rule-version-compare-title">
                    Compare
                  </h3>
                  <label className={`${labelClass} max-w-[420px]`} htmlFor="rule-version-compare">
                    Compare with
                    <select
                      className={inputClass}
                      id="rule-version-compare"
                      value={compareId}
                      onChange={(event) =>
                        setCompareId((event.currentTarget as unknown as { value: string }).value)
                      }
                    >
                      <option value="">Choose another version</option>
                      {versions
                        .filter(({ id, ruleKind }) => id !== open.id && ruleKind === open.ruleKind)
                        .map((version) => (
                          <option key={version.id} value={version.id}>
                            {version.code} · {effectivityLabel(version)}
                          </option>
                        ))}
                    </select>
                  </label>
                  {compared ? (
                    <Comparison
                      left={open}
                      right={compared}
                      leftDetail={detail}
                      rightDetail={comparedDetail}
                      failed={error !== ''}
                    />
                  ) : null}
                </section>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="secondary">
                    Close
                  </Button>
                </DialogClose>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </div>
    </Dialog>
  );
}

function VersionValues({
  version,
  detail,
  failed,
}: {
  version: RuleVersionSummary;
  detail: RuleVersionDetail | undefined;
  failed: boolean;
}) {
  const title = version.ruleKind === 'SALARY_SCHEDULE' ? 'Salary Grade rates' : 'Parameters';
  return (
    <section className="grid gap-3" aria-labelledby="rule-version-values-title">
      <h3 className="m-0 text-panel-title text-ink" id="rule-version-values-title">
        {title}
      </h3>
      {!detail ? (
        failed ? null : (
          <p className="m-0 text-small text-ink-muted" role="status">
            Loading…
          </p>
        )
      ) : version.ruleKind === 'SALARY_SCHEDULE' ? (
        <Table className="min-w-[420px]">
          <thead>
            <tr>
              <Th kind="numeric">Salary Grade</Th>
              <Th kind="numeric">Step</Th>
              <Th kind="numeric">Monthly rate</Th>
            </tr>
          </thead>
          <tbody>
            {detail.salaryGradeRates.map((rate) => (
              <Tr key={`${rate.salaryGrade}:${rate.salaryStep}`}>
                <Td kind="numeric">{rate.salaryGrade}</Td>
                <Td kind="numeric">{rate.salaryStep}</Td>
                <Td kind="numeric">{decimalLabel(rate.monthlyRate)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <PayeeCategories parameters={detail.parameters} />
      )}
    </section>
  );
}

function PayeeCategories({ parameters }: { parameters: unknown }) {
  const categories = allowedPayeeCategories(parameters);
  return categories.length === 0 ? (
    <p className="m-0 text-small text-ink-muted">This version lists no payee categories.</p>
  ) : (
    <ul className="m-0 grid gap-1 pl-5 text-body text-ink" aria-label="Allowed payee categories">
      {categories.map((category) => (
        <li key={category}>{payeeCategoryLabel[category] ?? category}</li>
      ))}
    </ul>
  );
}

function Comparison({
  left,
  right,
  leftDetail,
  rightDetail,
  failed,
}: {
  left: RuleVersionSummary;
  right: RuleVersionSummary;
  leftDetail: RuleVersionDetail | undefined;
  rightDetail: RuleVersionDetail | undefined;
  failed: boolean;
}) {
  const rows: [string, string, string][] = [
    ['Issuing authority', left.issuingAuthority, right.issuingAuthority],
    ['Issuance', left.issuanceReference, right.issuanceReference],
    ['Effective', effectivityLabel(left), effectivityLabel(right)],
    ['Supersession', supersessionDisplay(left).label, supersessionDisplay(right).label],
  ];
  return (
    <div className="grid gap-4" aria-busy={!leftDetail || !rightDetail}>
      <Table className="min-w-[620px]" aria-label="Version comparison">
        <thead>
          <tr>
            <Th>Field</Th>
            <Th>{left.code}</Th>
            <Th>{right.code}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b]) => (
            <Tr key={label}>
              <Td>{label}</Td>
              <Td>{a}</Td>
              <Td>{b}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {!leftDetail || !rightDetail ? (
        failed ? null : (
          <p className="m-0 text-small text-ink-muted" role="status">
            Loading…
          </p>
        )
      ) : left.ruleKind === 'SALARY_SCHEDULE' ? (
        <Table className="min-w-[620px]" aria-label="Rate comparison">
          <thead>
            <tr>
              <Th kind="numeric">Salary Grade</Th>
              <Th kind="numeric">Step</Th>
              <Th kind="numeric">{left.code}</Th>
              <Th kind="numeric">{right.code}</Th>
              <Th>Same rate</Th>
            </tr>
          </thead>
          <tbody>
            {compareRates(leftDetail.salaryGradeRates, rightDetail.salaryGradeRates).map((rate) => (
              <Tr key={`${rate.salaryGrade}:${rate.salaryStep}`}>
                <Td kind="numeric">{rate.salaryGrade}</Td>
                <Td kind="numeric">{rate.salaryStep}</Td>
                <Td kind="numeric">{rate.left === null ? '—' : decimalLabel(rate.left)}</Td>
                <Td kind="numeric">{rate.right === null ? '—' : decimalLabel(rate.right)}</Td>
                <Td>{rate.left === rate.right ? 'Same' : 'Differs'}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <div className="grid gap-4 min-[621px]:grid-cols-2">
          {[leftDetail, rightDetail].map((version) => (
            <div key={version.id} className="grid gap-2">
              <strong className="text-small text-ink">{version.code}</strong>
              <PayeeCategories parameters={version.parameters} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
