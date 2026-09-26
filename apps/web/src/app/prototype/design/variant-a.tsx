'use client';

// PROTOTYPE variant A — "Workbench, detail pane".
// B's enterprise taste (square panels, dense tables, slate and steel blue), but
// lists keep a detail pane on the right: select a row to inspect and act without
// leaving the list. The record is one long page with a sticky section index.

import { useState, type ReactNode } from 'react';
import { inputValue } from '../../../components/prototype-switcher';
import {
  activity,
  documents,
  employees,
  leaveBalances,
  queue,
  serviceRecord,
  type Employee,
  type Tone,
} from './fixtures';
import { LifecycleNav, type NavTheme } from './lifecycle-nav';
import { usePrototypeState } from './screen';

const navTheme: NavTheme = {
  bg: '#1b2733',
  panel: '#2a3a4a',
  line: '#2c3b4a',
  ink: '#e6ecf1',
  muted: '#98a6b4',
  hover: '#233240',
  accent: '#4fa3d1',
  radius: '2px',
};

const toneClass: Record<Tone, string> = {
  action: 'border-[#0b6e99] text-[#0b6e99]',
  waiting: 'border-[#946000] text-[#946000]',
  returned: 'border-[#a3262a] text-[#a3262a]',
  done: 'border-[#56626f] text-[#56626f]',
};

const statusClass: Record<Employee['status'], string> = {
  ACTIVE: 'border-[#1f6b3b] text-[#1f6b3b]',
  ON_LEAVE: 'border-[#946000] text-[#946000]',
  SUSPENDED: 'border-[#a3262a] text-[#a3262a]',
  SEPARATED: 'border-[#56626f] text-[#56626f]',
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

const primary =
  'cursor-pointer rounded-[2px] bg-[#0b6e99] px-4 py-2 text-[13px] font-[600] text-white hover:bg-[#095a7d]';
const secondary =
  'cursor-pointer rounded-[2px] border border-[#0b6e99] bg-white px-4 py-2 text-[13px] font-[600] text-[#0b6e99] hover:bg-[#e8f2f7]';
const th =
  'sticky top-0 border-b border-[#d3d9df] bg-[#f5f7f9] px-3 py-2 text-left text-[12px] font-[650] whitespace-nowrap';
const td = 'border-b border-[#e5e9ed] px-3 py-2.5';

export function VariantA() {
  const { screen, employee, go, openEmployee } = usePrototypeState();
  return (
    <div className="grid h-dvh grid-cols-[auto_minmax(0,1fr)] bg-[#eef1f4] text-[14px] text-[#14202b] [font-variant-numeric:tabular-nums]">
      <LifecycleNav theme={navTheme} />
      <main className="flex min-h-0 min-w-0 flex-col">
        {screen === 'queue' && <Queue />}
        {screen === 'employees' && <Register onOpen={openEmployee} />}
        {screen === 'record' && <Record employee={employee} onBack={() => go('employees')} />}
      </main>
    </div>
  );
}

function Band({ trail, title, children }: { trail: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-end justify-between gap-6 border-b border-[#d3d9df] bg-white px-6 py-4">
      <div>
        <p className="m-0 text-[12px] text-[#56626f]">{trail}</p>
        <h1 className="m-0 mt-0.5 text-[20px] leading-[1.2] font-[650]">{title}</h1>
      </div>
      {children}
    </div>
  );
}

/** List on the left, detail pane on the right; both scroll independently. */
function Split({ list, pane }: { list: ReactNode; pane: ReactNode }) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-h-0 overflow-auto border-r border-[#d3d9df] bg-white">{list}</div>
      <aside className="min-h-0 overflow-auto bg-white">{pane}</aside>
    </div>
  );
}

function PaneSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-[#d3d9df] px-5 py-4">
      <h3 className="m-0 mb-2 text-[12px] font-[650] text-[#56626f]">{title}</h3>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="m-0 grid grid-cols-[140px_minmax(0,1fr)] gap-y-1.5 text-[13px]">
      {rows.map(([name, value]) => (
        <div key={name} className="contents">
          <dt className="text-[#56626f]">{name}</dt>
          <dd className="m-0 font-[600]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Queue() {
  const [selectedId, setSelectedId] = useState(queue[0]!.id);
  const [mine, setMine] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const rows = queue.filter((item) => !mine || item.tone === 'action');
  const selected = queue.find((item) => item.id === selectedId)!;
  const at = selected.route.indexOf(selected.state);

  return (
    <>
      <Band trail="Reference Agency — Central Office" title="Work queue">
        <label className="flex cursor-pointer items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            className="accent-[#0b6e99]"
            checked={mine}
            onChange={() => setMine(!mine)}
          />
          Only items waiting on me
        </label>
      </Band>
      <Split
        list={
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Reference</th>
                <th className={th}>Subject</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Age</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => {
                    setSelectedId(item.id);
                    setNotice(null);
                  }}
                  aria-selected={item.id === selectedId}
                  className={`cursor-pointer ${
                    item.id === selectedId
                      ? 'bg-[#e3f0f6] shadow-[inset_3px_0_0_#0b6e99]'
                      : 'hover:bg-[#f6f8fa]'
                  }`}
                >
                  <td className={`${td} text-[13px] whitespace-nowrap text-[#56626f]`}>
                    {item.id}
                  </td>
                  <td className={td}>
                    <div className="font-[600]">{item.subject}</div>
                    <div className="text-[12px] text-[#56626f]">
                      {item.kind}, {item.employee}
                    </div>
                  </td>
                  <td className={td}>
                    <Tag className={toneClass[item.tone]}>{label(item.state)}</Tag>
                  </td>
                  <td className={`${td} text-right text-[13px] whitespace-nowrap`}>{item.age}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
        pane={
          <>
            <div className="px-5 py-4">
              <p className="m-0 text-[12px] text-[#56626f]">
                {selected.kind} {selected.id}
              </p>
              <h2 className="m-0 mt-0.5 text-[17px] leading-[1.3] font-[650]">
                {selected.subject}
              </h2>
              <p className="m-0 mt-1 text-[13px] text-[#56626f]">{selected.employee}</p>
              <div className="mt-2">
                <Tag className={toneClass[selected.tone]}>{label(selected.state)}</Tag>
              </div>
            </div>
            <PaneSection title="Details">
              <Facts rows={selected.detail.map(({ label: name, value }) => [name, value])} />
            </PaneSection>
            <PaneSection title="Route">
              <ol className="m-0 list-none p-0 text-[13px]">
                {selected.route.map((step, index) => (
                  <li key={step} className="flex items-center gap-2 py-0.5">
                    <span
                      className={`grid size-4 place-items-center rounded-[2px] text-[10px] font-[700] ${
                        index < at
                          ? 'bg-[#0b6e99] text-white'
                          : index === at
                            ? 'border-2 border-[#0b6e99]'
                            : 'border border-[#b6c0ca]'
                      }`}
                      aria-hidden="true"
                    >
                      {index < at ? '✓' : ''}
                    </span>
                    <span
                      className={index === at ? 'font-[650]' : index > at ? 'text-[#56626f]' : ''}
                    >
                      {label(step)}
                    </span>
                  </li>
                ))}
              </ol>
            </PaneSection>
            <div className="sticky bottom-0 flex gap-2 border-t border-[#d3d9df] bg-[#f5f7f9] px-5 py-3">
              {selected.tone === 'action' ? (
                <>
                  <button
                    type="button"
                    className={primary}
                    onClick={() => setNotice(`${selected.action}: prototype only, nothing saved.`)}
                  >
                    {selected.action}
                  </button>
                  <button
                    type="button"
                    className={secondary}
                    onClick={() => setNotice('Return: a reason is required. Prototype only.')}
                  >
                    Return with reason
                  </button>
                </>
              ) : (
                <span className="text-[13px] text-[#56626f]">
                  {selected.action}. No action for you yet.
                </span>
              )}
            </div>
            {notice && <p className="m-0 px-5 py-2 text-[12px] text-[#56626f]">{notice}</p>}
          </>
        }
      />
    </>
  );
}

function Register({ onOpen }: { onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(employees[0]!.id);
  const rows = employees.filter((row) =>
    `${row.legalName} ${row.employeeNumber} ${row.position}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const selected = employees.find((row) => row.id === selectedId)!;

  return (
    <>
      <Band trail="Personnel" title="Employees">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(inputValue(event))}
            placeholder="Search name, number, or position"
            className="w-[280px] rounded-[2px] border border-[#b6c0ca] px-2.5 py-1.5 text-[13px] outline-none focus:border-[#0b6e99] focus:shadow-[inset_0_0_0_1px_#0b6e99]"
          />
          <button type="button" className={primary}>
            Add employee
          </button>
        </div>
      </Band>
      <Split
        list={
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Employee no.</th>
                <th className={th}>Name</th>
                <th className={th}>Position</th>
                <th className={th}>SG</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedId(row.id)}
                  onDoubleClick={() => onOpen(row.id)}
                  aria-selected={row.id === selectedId}
                  className={`cursor-pointer ${
                    row.id === selectedId
                      ? 'bg-[#e3f0f6] shadow-[inset_3px_0_0_#0b6e99]'
                      : 'hover:bg-[#f6f8fa]'
                  }`}
                >
                  <td className={`${td} text-[13px] whitespace-nowrap`}>{row.employeeNumber}</td>
                  <td className={`${td} font-[600] whitespace-nowrap`}>{row.legalName}</td>
                  <td className={td}>{row.position}</td>
                  <td className={`${td} text-[13px] whitespace-nowrap`}>{row.salaryGrade}</td>
                  <td className={td}>
                    <Tag className={statusClass[row.status]}>{label(row.status)}</Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        }
        pane={
          <>
            <div className="px-5 py-4">
              <p className="m-0 text-[12px] text-[#56626f]">{selected.employeeNumber}</p>
              <h2 className="m-0 mt-0.5 text-[17px] font-[650]">{selected.legalName}</h2>
              <p className="m-0 mt-1 text-[13px] text-[#56626f]">
                {selected.position}, {selected.unit}
              </p>
              <button
                type="button"
                className={`${primary} mt-3`}
                onClick={() => onOpen(selected.id)}
              >
                Open record
              </button>
            </div>
            <PaneSection title="Position">
              <Facts
                rows={[
                  ['Plantilla item', selected.itemNumber],
                  ['Salary grade', selected.salaryGrade],
                  ['Appointment', selected.appointment],
                  ['In service since', selected.since],
                  [
                    'Status',
                    <Tag key="s" className={statusClass[selected.status]}>
                      {label(selected.status)}
                    </Tag>,
                  ],
                ]}
              />
            </PaneSection>
            <PaneSection title="Leave credits, as of Sep 30">
              <Facts rows={leaveBalances.map((row) => [row.type, `${row.posted} days`])} />
            </PaneSection>
          </>
        }
      />
    </>
  );
}

const sections = ['Summary', 'Service record', 'Leave credits', 'Documents', 'History'];

function sectionId(name: string) {
  return `a-${name.toLowerCase().replaceAll(' ', '-')}`;
}

function Section({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section id={sectionId(name)} className="scroll-mt-4 border border-[#d3d9df] bg-white">
      <h2 className="m-0 border-b border-[#d3d9df] px-4 py-2.5 text-[14px] font-[650]">{name}</h2>
      {children}
    </section>
  );
}

function Record({ employee, onBack }: { employee: Employee; onBack: () => void }) {
  const [active, setActive] = useState('Summary');
  return (
    <>
      <div className="shrink-0 border-b border-[#d3d9df] bg-white px-6 py-4">
        <button
          type="button"
          onClick={onBack}
          className="cursor-pointer text-[12px] text-[#0b6e99] hover:underline"
        >
          Personnel / Employees
        </button>
        <div className="mt-1 flex items-start justify-between gap-6">
          <div className="flex items-center gap-3">
            <h1 className="m-0 text-[22px] leading-[1.2] font-[650]">{employee.legalName}</h1>
            <Tag className={statusClass[employee.status]}>{label(employee.status)}</Tag>
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
        <p className="m-0 mt-1 text-[13px] text-[#56626f]">
          {employee.employeeNumber} · {employee.position}, {employee.salaryGrade} · {employee.unit}
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)] overflow-auto">
        <nav className="sticky top-0 self-start p-4" aria-label="Record sections">
          {sections.map((name) => (
            <a
              key={name}
              href={`#${sectionId(name)}`}
              onClick={() => setActive(name)}
              className={`block border-l-[3px] px-3 py-1.5 text-[13px] no-underline ${
                active === name
                  ? 'border-[#0b6e99] font-[650] text-[#14202b]'
                  : 'border-[#d3d9df] text-[#56626f] hover:text-[#14202b]'
              }`}
            >
              {name}
            </a>
          ))}
        </nav>

        <div className="grid content-start gap-4 py-4 pr-6">
          <Section name="Summary">
            <div className="grid grid-cols-3 gap-x-8 gap-y-3 p-4 text-[13px]">
              {[
                ['Employee no.', employee.employeeNumber],
                ['Plantilla item', employee.itemNumber],
                ['Salary grade', employee.salaryGrade],
                ['Position', employee.position],
                ['Appointment', employee.appointment],
                ['In service since', employee.since],
              ].map(([name, value]) => (
                <div key={name}>
                  <div className="text-[12px] text-[#56626f]">{name}</div>
                  <div className="font-[600]">{value}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section name="Service record">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={th}>From</th>
                  <th className={th}>To</th>
                  <th className={th}>Designation</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Monthly salary</th>
                  <th className={th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {serviceRecord.map((row) => (
                  <tr key={row.from}>
                    <td className={`${td} whitespace-nowrap`}>{row.from}</td>
                    <td className={`${td} whitespace-nowrap`}>{row.to ?? 'Present'}</td>
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
          </Section>

          <Section name="Leave credits">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Type</th>
                  <th className={`${th} text-right`}>Posted</th>
                  <th className={`${th} text-right`}>Committed</th>
                  <th className={`${th} text-right`}>Available</th>
                </tr>
              </thead>
              <tbody>
                {leaveBalances.map((row) => (
                  <tr key={row.type}>
                    <td className={td}>{row.type}</td>
                    <td className={`${td} text-right`}>{row.posted}</td>
                    <td className={`${td} text-right`}>{row.committed}</td>
                    <td className={`${td} text-right font-[650]`}>
                      {(Number(row.posted) - Number(row.committed)).toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section name="Documents">
            <table className="w-full border-collapse text-[13px]">
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.name}>
                    <td className={`${td} font-[600] text-[#0b6e99]`}>{doc.name}</td>
                    <td className={td}>{doc.version}</td>
                    <td className={`${td} text-right whitespace-nowrap`}>{doc.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section name="History">
            <table className="w-full border-collapse text-[13px]">
              <tbody>
                {activity.map((entry) => (
                  <tr key={entry.at}>
                    <td className={`${td} w-[170px] whitespace-nowrap text-[#56626f]`}>
                      {entry.at}
                    </td>
                    <td className={`${td} w-[170px] font-[600]`}>{entry.actor}</td>
                    <td className={td}>{entry.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>
      </div>
    </>
  );
}
