'use client';

import { useState } from 'react';
import { PrototypeSwitcher } from './prototype-switcher';

// PROTOTYPE: three traditional Organization hierarchy layouts on the existing /organization route.

interface DraftUnit {
  id: string;
  code: string;
  officialName: string;
  unitType: string;
  effectiveDate: string;
  status: string;
}

const units = [
  { code: 'OED', name: 'Office of the Executive Director', type: 'Office', parent: null },
  { code: 'AS', name: 'Administrative Service', type: 'Service', parent: 'OED' },
  { code: 'TSB', name: 'Technical Services Bureau', type: 'Bureau', parent: 'OED' },
  { code: 'RCO', name: 'Regional Coordination Office', type: 'Office', parent: 'OED' },
  { code: 'HRMD', name: 'Human Resource Management Division', type: 'Division', parent: 'AS' },
  { code: 'FD', name: 'Finance Division', type: 'Division', parent: 'AS' },
  { code: 'SD', name: 'Standards Division', type: 'Division', parent: 'TSB' },
  { code: 'OD', name: 'Operations Division', type: 'Division', parent: 'TSB' },
  { code: 'LD', name: 'Luzon Desk', type: 'Section', parent: 'RCO' },
  { code: 'VD', name: 'Visayas Desk', type: 'Section', parent: 'RCO' },
  { code: 'MD', name: 'Mindanao Desk', type: 'Section', parent: 'RCO' },
] as const;

function PrototypeHeader({ agencyName }: { agencyName: string }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-5 border-b border-line pb-5">
      <div className="grid max-w-[680px] gap-2">
        <p className="m-0 text-[11px] font-bold tracking-[0.09em] text-cobalt uppercase">
          Organization hierarchy · prototype
        </p>
        <h1 className="m-0 text-[clamp(28px,3vw,38px)] leading-[1.08] font-[680] tracking-[-0.035em] text-midnight">
          Organization chart
        </h1>
        <p className="m-0 text-sm leading-[1.65] text-muted">
          Traditional reporting relationships for {agencyName}. Illustrative units only.
        </p>
      </div>
      <label className="grid gap-1.5 text-xs font-[650] text-muted">
        Structure effective on
        <input
          className="min-h-10 rounded-[3px] border border-line bg-paper px-3 text-sm font-normal text-ink"
          type="date"
          defaultValue="2026-08-19"
        />
      </label>
    </header>
  );
}

function DraftQueue({ drafts }: { drafts: readonly DraftUnit[] }) {
  return (
    <section className="grid gap-3 border-t border-line pt-5" aria-labelledby="prototype-drafts">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="m-0 text-sm font-[680] text-midnight" id="prototype-drafts">
            Drafts awaiting placement
          </h2>
          <p className="m-0 mt-1 text-xs text-muted">
            Live local records, not included in the chart.
          </p>
        </div>
        <span className="rounded-full bg-pale-blue px-2.5 py-1 text-xs font-[650] text-cobalt">
          {drafts.length} {drafts.length === 1 ? 'Draft' : 'Drafts'}
        </span>
      </div>
      {drafts.length === 0 ? (
        <p className="m-0 rounded-[4px] border border-dashed border-line px-4 py-3 text-sm text-muted">
          No Draft Organization Units are waiting for a parent.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {drafts.map((draft) => (
            <span
              className="rounded-[3px] border border-line bg-paper px-3 py-2 text-xs text-ink"
              key={draft.id}
            >
              <strong className="font-[680]">{draft.officialName}</strong>{' '}
              <span className="font-mono text-[10px] text-muted">{draft.code}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function VariantA({ agencyName, drafts }: { agencyName: string; drafts: readonly DraftUnit[] }) {
  const branches = units.filter(({ parent }) => parent === 'OED');
  return (
    <div className="grid gap-7">
      <PrototypeHeader agencyName={agencyName} />
      <section className="overflow-x-auto rounded-[5px] border border-line bg-[#f8fafc] p-5 min-[621px]:p-8">
        <div className="mx-auto grid min-w-[820px] max-w-[980px] justify-items-center pb-3">
          <article className="relative z-10 w-[300px] rounded-[4px] border border-midnight bg-midnight px-5 py-4 text-center text-paper shadow-[0_5px_18px_rgb(23_32_51/12%)]">
            <span className="font-mono text-[10px] tracking-[0.08em] text-[#aebbd0]">
              OED · OFFICE
            </span>
            <h2 className="m-0 mt-1 text-sm font-[680]">Office of the Executive Director</h2>
            <span className="mt-2 inline-flex items-center gap-1.5 text-[10px] text-[#dbe4f1]">
              <i className="size-1.5 rounded-full bg-[#8ac29f]" /> Active
            </span>
          </article>
          <div className="h-8 w-px bg-[#aeb8c7]" aria-hidden="true" />
          <div className="grid w-[calc(100%-160px)] grid-cols-3 border-t border-[#aeb8c7] pt-8">
            {branches.map((branch) => (
              <div className="relative grid justify-items-center px-3" key={branch.code}>
                <span className="absolute -top-8 h-8 w-px bg-[#aeb8c7]" aria-hidden="true" />
                <article className="relative z-10 grid min-h-[108px] w-full content-center rounded-[4px] border border-[#8fa2bb] bg-paper px-4 py-3 text-center shadow-[0_3px_10px_rgb(23_32_51/7%)]">
                  <span className="font-mono text-[10px] font-bold text-cobalt">{branch.code}</span>
                  <h3 className="m-0 mt-1 text-[13px] leading-[1.35] font-[680] text-midnight">
                    {branch.name}
                  </h3>
                  <span className="mt-1 text-[10px] text-muted">{branch.type}</span>
                </article>
                <div className="h-6 w-px bg-[#b9c2cf]" aria-hidden="true" />
                <div className="grid w-full gap-2 border-t border-[#b9c2cf] pt-4">
                  {units
                    .filter(({ parent }) => parent === branch.code)
                    .map((child) => (
                      <article
                        className="relative rounded-[3px] border border-line bg-white px-3 py-2.5 text-left before:absolute before:-top-4 before:left-1/2 before:h-4 before:w-px before:bg-[#b9c2cf] before:content-['']"
                        key={child.code}
                      >
                        <span className="font-mono text-[9px] font-bold text-cobalt">
                          {child.code} · {child.type.toUpperCase()}
                        </span>
                        <h4 className="m-0 mt-1 text-xs leading-[1.4] font-[630] text-ink">
                          {child.name}
                        </h4>
                      </article>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <DraftQueue drafts={drafts} />
    </div>
  );
}

function VariantB({ agencyName, drafts }: { agencyName: string; drafts: readonly DraftUnit[] }) {
  const [selectedCode, setSelectedCode] = useState('TSB');
  const selected = units.find(({ code }) => code === selectedCode) ?? units[0];
  const parent = units.find(({ code }) => code === selected.parent);
  const children = units.filter(({ parent }) => parent === selected.code);

  return (
    <div className="grid gap-7">
      <PrototypeHeader agencyName={agencyName} />
      <section className="grid overflow-hidden rounded-[5px] border border-line bg-paper min-[860px]:grid-cols-[minmax(0,1fr)_320px]">
        <div className="border-b border-line p-5 min-[621px]:p-7 min-[860px]:border-r min-[860px]:border-b-0">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="m-0 text-sm font-[680] text-midnight">Reporting tree</h2>
              <p className="m-0 mt-1 text-xs text-muted">Select a unit to inspect its place.</p>
            </div>
            <span className="font-mono text-[10px] text-muted">11 ACTIVE</span>
          </div>
          <button
            className="flex w-full items-center gap-3 rounded-[3px] border border-midnight bg-midnight px-4 py-3 text-left text-paper"
            type="button"
            onClick={() => setSelectedCode('OED')}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-[2px] bg-white/10 font-mono text-[10px]">
              OED
            </span>
            <span className="grid gap-0.5">
              <strong className="text-sm font-[680]">Office of the Executive Director</strong>
              <span className="text-[10px] text-[#b7c3d5]">Root Organization Unit</span>
            </span>
          </button>
          <div className="ml-4 border-l border-[#aeb8c7] py-2 pl-6">
            {units
              .filter(({ parent }) => parent === 'OED')
              .map((branch) => (
                <div
                  className="relative py-1.5 before:absolute before:top-6 before:-left-6 before:w-5 before:border-t before:border-[#aeb8c7] before:content-['']"
                  key={branch.code}
                >
                  <button
                    className="flex w-full items-center gap-3 rounded-[3px] border border-line bg-[#fafbfd] px-3 py-2.5 text-left hover:border-[#9db0c9] data-[selected=true]:border-cobalt data-[selected=true]:bg-pale-blue"
                    data-selected={selectedCode === branch.code}
                    type="button"
                    onClick={() => setSelectedCode(branch.code)}
                  >
                    <span className="w-9 shrink-0 font-mono text-[10px] font-bold text-cobalt">
                      {branch.code}
                    </span>
                    <span className="text-xs font-[650] text-ink">{branch.name}</span>
                  </button>
                  <div className="ml-4 border-l border-line pt-1.5 pl-5">
                    {units
                      .filter(({ parent }) => parent === branch.code)
                      .map((child) => (
                        <button
                          className="relative flex w-full items-center gap-2 rounded-[3px] px-3 py-2 text-left text-xs text-muted before:absolute before:top-1/2 before:-left-5 before:w-4 before:border-t before:border-line before:content-[''] hover:bg-canvas hover:text-ink data-[selected=true]:bg-pale-blue data-[selected=true]:font-[650] data-[selected=true]:text-cobalt"
                          data-selected={selectedCode === child.code}
                          key={child.code}
                          type="button"
                          onClick={() => setSelectedCode(child.code)}
                        >
                          <span className="w-9 shrink-0 font-mono text-[9px]">{child.code}</span>
                          {child.name}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
          </div>
        </div>
        <aside className="bg-[#f7f9fc] p-5 min-[621px]:p-7" aria-live="polite">
          <p className="m-0 text-[10px] font-bold tracking-[0.08em] text-cobalt uppercase">
            Unit record
          </p>
          <span className="mt-5 grid size-11 place-items-center rounded-[3px] bg-midnight font-mono text-xs font-bold text-paper">
            {selected.code}
          </span>
          <h2 className="m-0 mt-4 text-xl leading-[1.25] font-[680] tracking-[-0.02em] text-midnight">
            {selected.name}
          </h2>
          <dl className="mt-6 grid grid-cols-[92px_1fr] gap-x-3 gap-y-3 border-y border-line py-4 text-xs">
            <dt className="text-muted">Type</dt>
            <dd className="m-0 font-[650] text-ink">{selected.type}</dd>
            <dt className="text-muted">Parent</dt>
            <dd className="m-0 font-[650] text-ink">{parent?.name ?? 'None (root)'}</dd>
            <dt className="text-muted">Children</dt>
            <dd className="m-0 font-[650] text-ink">{children.length}</dd>
            <dt className="text-muted">Effective</dt>
            <dd className="m-0 font-[650] text-ink">19 Aug 2026</dd>
            <dt className="text-muted">Status</dt>
            <dd className="m-0 font-[650] text-[#3f6754]">Active</dd>
          </dl>
          <p className="m-0 mt-5 text-xs leading-[1.6] text-muted">
            Relationship shown for the selected effective date.
          </p>
        </aside>
      </section>
      <DraftQueue drafts={drafts} />
    </div>
  );
}

function VariantC({ agencyName, drafts }: { agencyName: string; drafts: readonly DraftUnit[] }) {
  const branches = units.filter(({ parent }) => parent === 'OED');
  return (
    <div className="grid gap-7">
      <PrototypeHeader agencyName={agencyName} />
      <section className="overflow-x-auto rounded-[2px] border border-[#b8c0cb] bg-white p-4 shadow-[inset_0_0_0_3px_#f3f5f8] min-[621px]:p-7">
        <div className="min-w-[900px]">
          <div className="flex items-start justify-between gap-8 border-b-2 border-midnight pb-4">
            <div>
              <p className="m-0 font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                Official structure record
              </p>
              <h2 className="m-0 mt-1 text-xl font-[720] tracking-[-0.025em] text-midnight">
                {agencyName}
              </h2>
            </div>
            <div className="border border-midnight px-3 py-2 text-right font-mono text-[9px] leading-[1.5] text-midnight">
              EFFECTIVE SNAPSHOT
              <br />
              19 AUG 2026
              <br />
              11 ACTIVE UNITS
            </div>
          </div>
          <div className="mx-auto mt-6 w-[340px] border-2 border-midnight px-5 py-4 text-center">
            <span className="font-mono text-[9px] font-bold tracking-[0.1em] text-cobalt">
              OED / OFFICE
            </span>
            <h3 className="m-0 mt-1 text-sm font-[720] text-midnight">
              Office of the Executive Director
            </h3>
          </div>
          <div className="mx-auto h-7 w-px bg-midnight" aria-hidden="true" />
          <div className="grid grid-cols-3 border-t-2 border-midnight">
            {branches.map((branch, branchIndex) => (
              <article className="relative px-3 pt-7" key={branch.code}>
                <span className="absolute top-0 left-1/2 h-7 w-px bg-midnight" aria-hidden="true" />
                <header className="min-h-[96px] border border-midnight bg-[#f1f4f8] p-4 text-center">
                  <span className="font-mono text-[9px] font-bold text-cobalt">
                    BRANCH {branchIndex + 1} · {branch.code}
                  </span>
                  <h3 className="m-0 mt-1 text-[13px] leading-[1.4] font-[720] text-midnight">
                    {branch.name}
                  </h3>
                  <p className="m-0 mt-1 text-[10px] text-muted">{branch.type}</p>
                </header>
                <ol className="m-0 grid list-none gap-0 border-x border-b border-line p-0">
                  {units
                    .filter(({ parent }) => parent === branch.code)
                    .map((child, index) => (
                      <li
                        className="grid grid-cols-[30px_1fr] border-b border-line last:border-b-0"
                        key={child.code}
                      >
                        <span className="grid place-items-center border-r border-line bg-[#fafbfd] font-mono text-[9px] text-muted">
                          {index + 1}
                        </span>
                        <span className="grid gap-0.5 px-3 py-3">
                          <strong className="text-xs font-[650] text-ink">{child.name}</strong>
                          <span className="font-mono text-[9px] text-muted">
                            {child.code} · {child.type.toUpperCase()}
                          </span>
                        </span>
                      </li>
                    ))}
                </ol>
              </article>
            ))}
          </div>
          <footer className="mt-8 flex justify-between gap-4 border-t border-line pt-3 font-mono text-[9px] text-muted">
            <span>ILLUSTRATIVE PROTOTYPE · NOT AN AUTHORITATIVE RECORD</span>
            <span>RELATIONSHIPS AS OF 2026-08-19</span>
          </footer>
        </div>
      </section>
      <DraftQueue drafts={drafts} />
    </div>
  );
}

export function OrganizationHierarchyPrototype({
  agencyName,
  drafts,
  variant,
}: {
  agencyName: string;
  drafts: readonly DraftUnit[];
  variant: string;
}) {
  return (
    <>
      {variant === 'B' ? (
        <VariantB agencyName={agencyName} drafts={drafts} />
      ) : variant === 'C' ? (
        <VariantC agencyName={agencyName} drafts={drafts} />
      ) : (
        <VariantA agencyName={agencyName} drafts={drafts} />
      )}
      <PrototypeSwitcher current={variant} />
    </>
  );
}
