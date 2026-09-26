'use client';

// PROTOTYPE variant B — "Enterprise workbench".
// Formal and dense: the shared lifecycle nav in navy, a white page-header band over a grey
// canvas, square titled panels, faceted data tables, and an object-page record.

import { useState, type ReactNode } from 'react';
import { inputValue } from '../../../components/prototype-switcher';
import {
  documents,
  employees,
  leaveBalances,
  queue,
  recordSections,
  serviceRecord,
  type Employee,
  type Tone,
} from './fixtures';
import { LifecycleNav, type NavTheme } from './lifecycle-nav';
import { usePrototypeState } from './screen';

const navTheme: NavTheme = {
  bg: '#0f2240',
  panel: '#1d3a63',
  line: '#223a5e',
  ink: '#e8eef7',
  muted: '#93a3bd',
  hover: '#17304f',
  accent: '#6fa3ec',
  radius: '2px',
};

const toneClass: Record<Tone, string> = {
  action: 'border-[#1a4fa0] text-[#1a4fa0]',
  waiting: 'border-[#9a6200] text-[#9a6200]',
  returned: 'border-[#a4262c] text-[#a4262c]',
  done: 'border-[#566175] text-[#566175]',
};

const statusClass: Record<Employee['status'], string> = {
  ACTIVE: 'border-[#1e6b3a] text-[#1e6b3a]',
  ON_LEAVE: 'border-[#9a6200] text-[#9a6200]',
  SUSPENDED: 'border-[#a4262c] text-[#a4262c]',
  SEPARATED: 'border-[#566175] text-[#566175]',
};

function label(value: string) {
  const text = value.toLowerCase().replaceAll('_', ' ');
  return text[0]!.toUpperCase() + text.slice(1);
}

function Tag({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span
      className={`inline-block rounded-[2px] border px-1.5 py-px text-[12px] font-[600] whitespace-nowrap ${className}`}
    >
      {children}
    </span>
  );
}

function Panel({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border border-[#d4d9e1] bg-white">
      <header className="flex min-h-11 items-center justify-between border-b border-[#d4d9e1] px-4">
        <h2 className="m-0 text-[14px] font-[650]">{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

function PageBand({
  trail,
  title,
  actions,
  children,
}: {
  trail: string;
  title?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="border-b border-[#d4d9e1] bg-white px-8 pt-5">
      <p className="m-0 text-[12px] text-[#566175]">{trail}</p>
      {title && (
        <div className="flex items-start justify-between gap-6 pb-5">
          <h1 className="m-0 mt-1 text-[22px] leading-[1.2] font-[650] tracking-[-0.01em]">
            {title}
          </h1>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

const primary =
  'cursor-pointer rounded-[2px] bg-[#1a4fa0] px-4 py-2 text-[13px] font-[600] text-white hover:bg-[#153f80]';
const secondary =
  'cursor-pointer rounded-[2px] border border-[#1a4fa0] px-4 py-2 text-[13px] font-[600] text-[#1a4fa0] hover:bg-[#eaf0fa]';
const th = 'border-b border-[#d4d9e1] bg-[#f5f7fa] px-4 py-2 text-left text-[12px] font-[650]';
const td = 'border-b border-[#e6e9ee] px-4 py-2.5';
const nowrap = 'whitespace-nowrap';

export function VariantB() {
  const { screen, employee, openEmployee } = usePrototypeState();
  return (
    <div className="grid min-h-dvh grid-cols-[auto_minmax(0,1fr)] bg-[#f2f4f7] text-[14px] text-[#121a26] [font-variant-numeric:tabular-nums]">
      <LifecycleNav theme={navTheme} />
      <main className="min-w-0">
        {screen === 'queue' && <Overview />}
        {screen === 'employees' && <Register onOpen={openEmployee} />}
        {screen === 'record' && <ObjectPage employee={employee} />}
      </main>
    </div>
  );
}

function Overview() {
  const kinds = ['All', ...new Set(queue.map((item) => item.kind))];
  const [kind, setKind] = useState('All');
  const rows = queue.filter((item) => kind === 'All' || item.kind === kind);
  const count = (tone: Tone) => queue.filter((item) => item.tone === tone).length;
  const tiles = [
    { label: 'For your action', value: count('action'), bar: 'shadow-[inset_4px_0_0_#1a4fa0]' },
    { label: 'Waiting on others', value: count('waiting'), bar: 'shadow-[inset_4px_0_0_#9a6200]' },
    { label: 'Needs information', value: count('returned'), bar: 'shadow-[inset_4px_0_0_#a4262c]' },
  ];
  return (
    <>
      <PageBand trail="Reference Agency — Central Office" title="Work queue" />
      <div className="grid gap-5 p-8">
        <div className="grid grid-cols-3 divide-x divide-[#d4d9e1] border border-[#d4d9e1] bg-white">
          {tiles.map((tile) => (
            <div key={tile.label} className={`px-5 py-4 ${tile.bar}`}>
              <div className="text-[13px] text-[#566175]">{tile.label}</div>
              <div className="mt-1 text-[26px] font-[650]">{tile.value}</div>
            </div>
          ))}
        </div>

        <Panel
          title="Work items"
          actions={
            <div className="flex">
              {kinds.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setKind(name)}
                  className={`cursor-pointer border border-[#d4d9e1] px-3 py-1 text-[12px] font-[600] [&+&]:-ml-px ${
                    kind === name
                      ? 'relative z-1 border-[#1a4fa0] bg-[#1a4fa0] text-white'
                      : 'bg-white text-[#3a4558] hover:bg-[#f5f7fa]'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          }
        >
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Reference</th>
                <th className={th}>Subject</th>
                <th className={th}>Employee or office</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Age</th>
                <th className={th}>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id} className="hover:bg-[#f7f9fc]">
                  <td className={`${td} text-[13px] text-[#1a4fa0] underline`}>{item.id}</td>
                  <td className={td}>
                    <div className="font-[600]">{item.subject}</div>
                    <div className="text-[12px] text-[#566175]">{item.kind}</div>
                  </td>
                  <td className={td}>{item.employee}</td>
                  <td className={td}>
                    <Tag className={toneClass[item.tone]}>{label(item.state)}</Tag>
                  </td>
                  <td className={`${td} text-right text-[13px]`}>{item.age}</td>
                  <td className={`${td} text-right`}>
                    {item.tone === 'action' ? (
                      <button type="button" className={primary}>
                        {item.action}
                      </button>
                    ) : (
                      <span className="text-[13px] text-[#566175]">{item.action}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <footer className="px-4 py-2.5 text-[12px] text-[#566175]">
            {rows.length} of {queue.length} items
          </footer>
        </Panel>
      </div>
    </>
  );
}

const facets: { title: string; key: keyof Employee }[] = [
  { title: 'Service status', key: 'status' },
  { title: 'Appointment', key: 'appointment' },
  { title: 'Division', key: 'unit' },
];

function Register({ onOpen }: { onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const rows = employees.filter(
    (row) =>
      `${row.legalName} ${row.employeeNumber}`.toLowerCase().includes(query.toLowerCase()) &&
      facets.every(({ key }) => !picked[key]?.length || picked[key]!.includes(String(row[key]))),
  );

  function toggle(key: string, value: string) {
    setPicked((current) => {
      const values = current[key] ?? [];
      return {
        ...current,
        [key]: values.includes(value) ? values.filter((v) => v !== value) : [...values, value],
      };
    });
  }

  return (
    <>
      <PageBand
        trail="Personnel"
        title="Employees"
        actions={
          <div className="flex gap-2">
            <button type="button" className={secondary}>
              Export list
            </button>
            <button type="button" className={primary}>
              Add employee
            </button>
          </div>
        }
      />
      <div className="grid grid-cols-[240px_minmax(0,1fr)] gap-5 p-8">
        <aside className="self-start border border-[#d4d9e1] bg-white">
          <div className="border-b border-[#d4d9e1] px-4 py-3 text-[14px] font-[650]">Filters</div>
          {facets.map(({ title, key }) => {
            const values = [...new Set(employees.map((row) => String(row[key])))].sort();
            return (
              <div
                key={key}
                role="group"
                aria-label={title}
                className="border-b border-[#e6e9ee] px-4 py-3"
              >
                <div className="mb-1.5 text-[12px] font-[650] text-[#566175]">{title}</div>
                {values.map((value) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-2 py-1 text-[13px]"
                  >
                    <input
                      type="checkbox"
                      className="accent-[#1a4fa0]"
                      checked={picked[key]?.includes(value) ?? false}
                      onChange={() => toggle(key, value)}
                    />
                    <span className="flex-1">{key === 'status' ? label(value) : value}</span>
                    <span className="text-[12px] text-[#566175]">
                      {employees.filter((row) => String(row[key]) === value).length}
                    </span>
                  </label>
                ))}
              </div>
            );
          })}
        </aside>

        <Panel
          title={`Results (${rows.length})`}
          actions={
            <input
              value={query}
              onChange={(event) => setQuery(inputValue(event))}
              placeholder="Search name or employee number"
              className="w-[280px] rounded-[2px] border border-[#b9c1cd] px-2.5 py-1.5 text-[13px] outline-none focus:border-[#1a4fa0] focus:shadow-[inset_0_0_0_1px_#1a4fa0]"
            />
          }
        >
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${th} ${nowrap}`}>Employee no. ▲</th>
                <th className={th}>Name</th>
                <th className={th}>Position</th>
                <th className={th}>SG</th>
                <th className={th}>Division</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {[...rows]
                .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber))
                .map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => onOpen(row.id)}
                    className="cursor-pointer hover:bg-[#f7f9fc]"
                  >
                    <td className={`${td} ${nowrap} text-[13px]`}>{row.employeeNumber}</td>
                    <td className={`${td} ${nowrap} font-[600] text-[#1a4fa0]`}>{row.legalName}</td>
                    <td className={td}>{row.position}</td>
                    <td className={`${td} ${nowrap} text-[13px]`}>{row.salaryGrade}</td>
                    <td className={`${td} text-[13px] text-[#3a4558]`}>{row.unit}</td>
                    <td className={td}>
                      <Tag className={statusClass[row.status]}>{label(row.status)}</Tag>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <footer className="flex justify-between px-4 py-2.5 text-[12px] text-[#566175]">
            <span>
              1–{rows.length} of {rows.length}
            </span>
            <span>Rows per page: 25</span>
          </footer>
        </Panel>
      </div>
    </>
  );
}

function ObjectPage({ employee }: { employee: Employee }) {
  const [section, setSection] = useState('Summary');
  const facts = [
    ['Employee no.', employee.employeeNumber],
    ['Plantilla item', employee.itemNumber],
    ['Salary grade', employee.salaryGrade],
    ['Appointment', employee.appointment],
    ['In service since', employee.since],
  ];
  return (
    <>
      <PageBand trail={`Personnel / Employees / ${employee.employeeNumber}`}>
        <div className="mt-3 flex items-start gap-5 pb-5">
          <span className="grid size-16 shrink-0 place-items-center bg-[#0f2240] text-[20px] font-[650] text-white">
            {employee.legalName
              .split(' ')
              .filter((part) => !part.endsWith('.'))
              .map((part) => part[0])
              .join('')}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <h1 className="m-0 text-[24px] leading-[1.2] font-[650]">{employee.legalName}</h1>
              <Tag className={statusClass[employee.status]}>{label(employee.status)}</Tag>
            </div>
            <p className="m-0 mt-1 text-[#3a4558]">
              {employee.position}, {employee.unit}
            </p>
            <dl className="m-0 mt-4 flex flex-wrap gap-x-10 gap-y-2">
              {facts.map(([name, value]) => (
                <div key={name}>
                  <dt className="text-[12px] text-[#566175]">{name}</dt>
                  <dd className="m-0 font-[600]">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex gap-2">
            <button type="button" className={secondary}>
              Print service record
            </button>
            <button type="button" className={primary}>
              New personnel action
            </button>
          </div>
        </div>
        <nav className="-mb-px flex" aria-label="Record sections">
          {recordSections.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setSection(name)}
              className={`cursor-pointer border-b-[3px] px-4 py-2.5 text-[13px] ${
                section === name
                  ? 'border-[#1a4fa0] font-[650] text-[#121a26]'
                  : 'border-transparent text-[#566175] hover:text-[#121a26]'
              }`}
            >
              {name}
            </button>
          ))}
        </nav>
      </PageBand>

      <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-5 p-8">
        <Panel
          title="Service record"
          actions={
            <span className="text-[12px] text-[#566175]">Effective-dated, newest first</span>
          }
        >
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={th}>From</th>
                <th className={th}>To</th>
                <th className={th}>Designation</th>
                <th className={th}>Status</th>
                <th className={`${th} ${nowrap} text-right`}>Monthly salary</th>
                <th className={th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {serviceRecord.map((row) => (
                <tr key={row.from}>
                  <td className={`${td} ${nowrap}`}>{row.from}</td>
                  <td className={`${td} ${nowrap}`}>{row.to ?? 'Present'}</td>
                  <td className={td}>{row.designation}</td>
                  <td className={td}>{row.status}</td>
                  <td className={`${td} text-right`}>{row.salary}</td>
                  <td className={td}>
                    {row.to === null ? (
                      <Tag className={toneClass.waiting}>{row.action}</Tag>
                    ) : (
                      row.action
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <div className="grid content-start gap-5">
          <Panel
            title="Leave credits"
            actions={<span className="text-[12px] text-[#566175]">As of Sep 30, 2026</span>}
          >
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Type</th>
                  <th className={`${th} text-right`}>Posted</th>
                  <th className={`${th} text-right`}>Committed</th>
                </tr>
              </thead>
              <tbody>
                {leaveBalances.map((row) => (
                  <tr key={row.type}>
                    <td className={td}>{row.type}</td>
                    <td className={`${td} text-right font-[600]`}>{row.posted}</td>
                    <td className={`${td} text-right`}>{row.committed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title="Documents">
            <ul className="m-0 list-none p-0 text-[13px]">
              {documents.map((doc) => (
                <li
                  key={doc.name}
                  className="border-b border-[#e6e9ee] px-4 py-2.5 last:border-b-0"
                >
                  <div className="font-[600] text-[#1a4fa0]">{doc.name}</div>
                  <div className="text-[12px] text-[#566175]">
                    {doc.version}, {doc.date}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
