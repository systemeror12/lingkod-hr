'use client';

// PROTOTYPE variant C — "Workbench, folders and grid".
// B's enterprise taste on a light nav with an oxblood accent. The queue is mail-like
// folders beside a compact multi-select grid with a command toolbar; the register
// is a spreadsheet-style grid with a filter under every column; the record reads
// like a government form with labelled field groups beside an audit trail.

import { useState, type ReactNode } from 'react';
import { inputValue } from '../../../components/prototype-switcher';
import {
  activity,
  employees,
  leaveBalances,
  queue,
  recordSections,
  type Employee,
  type Tone,
  type WorkItem,
} from './fixtures';
import { LifecycleNav, type NavTheme } from './lifecycle-nav';
import { usePrototypeState } from './screen';

const navTheme: NavTheme = {
  bg: '#ffffff',
  panel: '#f6eef0',
  line: '#dcdcd8',
  ink: '#1c1f24',
  muted: '#5f6570',
  hover: '#f3f3f1',
  accent: '#7a2433',
  radius: '2px',
};

const toneText: Record<Tone, string> = {
  action: 'text-[#7a2433]',
  waiting: 'text-[#8a5a00]',
  returned: 'text-[#b0302b]',
  done: 'text-[#5f6570]',
};

const statusText: Record<Employee['status'], string> = {
  ACTIVE: 'text-[#236b3d]',
  ON_LEAVE: 'text-[#8a5a00]',
  SUSPENDED: 'text-[#b0302b]',
  SEPARATED: 'text-[#5f6570]',
};

function label(value: string) {
  const text = value.toLowerCase().replaceAll('_', ' ');
  return text[0]!.toUpperCase() + text.slice(1);
}

const tool =
  'cursor-pointer rounded-[2px] border border-[#c9cac5] bg-white px-3 py-1.5 text-[13px] font-[600] hover:bg-[#f3f3f1] disabled:cursor-default disabled:opacity-45 disabled:hover:bg-white';
const toolPrimary =
  'cursor-pointer rounded-[2px] border border-[#7a2433] bg-[#7a2433] px-3 py-1.5 text-[13px] font-[600] text-white hover:bg-[#641c29] disabled:cursor-default disabled:opacity-45';
const th =
  'border-r border-b border-[#dcdcd8] bg-[#efefec] px-2.5 py-1.5 text-left text-[12px] font-[650] whitespace-nowrap last:border-r-0';
const td = 'border-r border-[#e8e8e5] px-2.5 py-1.5 text-[13px] last:border-r-0';

export function VariantC() {
  const { screen, employee, openEmployee } = usePrototypeState();
  return (
    <div className="grid min-h-dvh grid-cols-[auto_minmax(0,1fr)] bg-[#f3f3f1] text-[14px] text-[#1c1f24] [font-variant-numeric:tabular-nums]">
      <LifecycleNav theme={navTheme} />
      <main className="min-w-0">
        {screen === 'queue' && <Queue />}
        {screen === 'employees' && <Register onOpen={openEmployee} />}
        {screen === 'record' && <Record employee={employee} />}
      </main>
    </div>
  );
}

function Band({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border-b border-[#dcdcd8] bg-white">
      <div className="px-6 pt-4 pb-3">
        <h1 className="m-0 text-[20px] leading-[1.2] font-[650]">{title}</h1>
      </div>
      {children && (
        <div className="flex items-center gap-2 border-t border-[#ececea] bg-[#fafaf9] px-6 py-2">
          {children}
        </div>
      )}
    </div>
  );
}

const folders: { name: string; match: (item: WorkItem) => boolean }[] = [
  { name: 'Waiting on me', match: (item) => item.tone === 'action' },
  { name: 'Waiting on others', match: (item) => item.tone === 'waiting' },
  { name: 'Needs information', match: (item) => item.tone === 'returned' },
  { name: 'All open', match: () => true },
];

function FolderButton({
  name,
  count,
  current,
  onChoose,
}: {
  name: string;
  count: number;
  current: boolean;
  onChoose: (name: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChoose(name)}
      aria-current={current ? 'true' : undefined}
      className={`flex w-full cursor-pointer items-center justify-between px-3 py-1.5 text-left text-[13px] ${
        current
          ? 'bg-[#f6eef0] font-[650] text-[#7a2433] shadow-[inset_3px_0_0_#7a2433]'
          : 'hover:bg-[#f3f3f1]'
      }`}
    >
      {name}
      <span className="text-[12px] text-[#5f6570]">{count}</span>
    </button>
  );
}

function Queue() {
  const kinds = [...new Set(queue.map((item) => item.kind))];
  const [folder, setFolder] = useState(folders[0]!.name);
  const [picked, setPicked] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const match =
    folders.find((f) => f.name === folder)?.match ?? ((item: WorkItem) => item.kind === folder);
  const rows = queue.filter(match);
  const selected = rows.filter((item) => picked.includes(item.id));
  const certifiable =
    selected.length > 0 && selected.every((item) => item.action === 'Certify credits');

  function choose(name: string) {
    setFolder(name);
    setPicked([]);
    setNotice(null);
  }

  return (
    <>
      <Band title="Work queue">
        <button
          type="button"
          className={toolPrimary}
          disabled={!certifiable}
          onClick={() =>
            setNotice(`Certify credits for ${selected.length} item(s): prototype only.`)
          }
        >
          Certify credits
        </button>
        <button
          type="button"
          className={tool}
          disabled={selected.length === 0}
          onClick={() => setNotice('Return: a reason is required. Prototype only.')}
        >
          Return with reason
        </button>
        <button type="button" className={tool} disabled={selected.length === 0}>
          Reassign
        </button>
        <span className="mx-1 h-5 w-px bg-[#dcdcd8]" />
        <button type="button" className={tool}>
          Export
        </button>
        <span className="ml-auto text-[12px] text-[#5f6570]">
          {notice ??
            (selected.length
              ? `${selected.length} selected`
              : 'Select items to act on them together')}
        </span>
      </Band>

      <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-4 p-6">
        <nav
          className="self-start border border-[#dcdcd8] bg-white py-2"
          aria-label="Queue folders"
        >
          {folders.map(({ name, match: m }) => (
            <FolderButton
              key={name}
              name={name}
              count={queue.filter(m).length}
              current={folder === name}
              onChoose={choose}
            />
          ))}
          <div className="mx-3 mt-3 mb-1 border-t border-[#ececea] pt-3 text-[12px] font-[650] text-[#5f6570]">
            By record type
          </div>
          {kinds.map((kind) => (
            <FolderButton
              key={kind}
              name={kind}
              count={queue.filter((item) => item.kind === kind).length}
              current={folder === kind}
              onChoose={choose}
            />
          ))}
        </nav>

        <div className="overflow-hidden border border-[#dcdcd8] bg-white">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${th} w-9`}>
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    className="accent-[#7a2433]"
                    checked={rows.length > 0 && selected.length === rows.length}
                    onChange={() =>
                      setPicked(selected.length === rows.length ? [] : rows.map((item) => item.id))
                    }
                  />
                </th>
                <th className={th}>Reference</th>
                <th className={th}>Type</th>
                <th className={th}>Subject</th>
                <th className={th}>Employee or office</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Age</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item, index) => {
                const on = picked.includes(item.id);
                return (
                  <tr
                    key={item.id}
                    className={on ? 'bg-[#f6eef0]' : index % 2 ? 'bg-[#fafaf9]' : 'bg-white'}
                  >
                    <td className={td}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.id}`}
                        className="accent-[#7a2433]"
                        checked={on}
                        onChange={() =>
                          setPicked(
                            on ? picked.filter((id) => id !== item.id) : [...picked, item.id],
                          )
                        }
                      />
                    </td>
                    <td className={`${td} whitespace-nowrap text-[#7a2433] underline`}>
                      {item.id}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{item.kind}</td>
                    <td className={`${td} font-[600]`}>{item.subject}</td>
                    <td className={`${td} whitespace-nowrap`}>{item.employee}</td>
                    <td className={`${td} font-[600] whitespace-nowrap ${toneText[item.tone]}`}>
                      {label(item.state)}
                    </td>
                    <td className={`${td} text-right whitespace-nowrap`}>{item.age}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-[#dcdcd8] bg-[#fafaf9] px-3 py-1.5 text-[12px] text-[#5f6570]">
            {rows.length} items in {folder}
          </div>
        </div>
      </div>
    </>
  );
}

const columns: { key: keyof Employee; title: string }[] = [
  { key: 'employeeNumber', title: 'Employee no.' },
  { key: 'legalName', title: 'Name' },
  { key: 'position', title: 'Position' },
  { key: 'salaryGrade', title: 'SG' },
  { key: 'unit', title: 'Division' },
  { key: 'appointment', title: 'Appointment' },
  { key: 'status', title: 'Status' },
];

function Register({ onOpen }: { onOpen: (id: string) => void }) {
  const [filters, setFilters] = useState<Partial<Record<keyof Employee, string>>>({});
  const rows = employees.filter((row) =>
    columns.every(({ key }) => {
      const needle = filters[key]?.toLowerCase();
      if (!needle) return true;
      return key === 'status'
        ? row.status === filters[key]
        : String(row[key]).toLowerCase().includes(needle);
    }),
  );
  const active = Object.values(filters).filter(Boolean).length;

  return (
    <>
      <Band title="Employees">
        <button type="button" className={toolPrimary}>
          Add employee
        </button>
        <button type="button" className={tool}>
          Export
        </button>
        <button type="button" className={tool}>
          Columns
        </button>
        <button
          type="button"
          className={tool}
          disabled={active === 0}
          onClick={() => setFilters({})}
        >
          Clear filters{active ? ` (${active})` : ''}
        </button>
        <span className="ml-auto text-[12px] text-[#5f6570]">
          {rows.length} of {employees.length} employees
        </span>
      </Band>

      <div className="p-6">
        <div className="overflow-auto border border-[#dcdcd8] bg-white">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {columns.map(({ key, title }) => (
                  <th key={key} className={th}>
                    {title}
                  </th>
                ))}
              </tr>
              <tr>
                {columns.map(({ key, title }) => (
                  <th key={key} className={`${th} bg-white p-1 font-[400]`}>
                    {key === 'status' ? (
                      <select
                        aria-label={`Filter ${title}`}
                        value={filters.status ?? ''}
                        onChange={(event) => setFilters({ ...filters, status: inputValue(event) })}
                        className="w-full rounded-[2px] border border-[#dcdcd8] px-1.5 py-1 text-[12px]"
                      >
                        <option value="">Any</option>
                        {['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'SEPARATED'].map((s) => (
                          <option key={s} value={s}>
                            {label(s)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        aria-label={`Filter ${title}`}
                        value={filters[key] ?? ''}
                        onChange={(event) => setFilters({ ...filters, [key]: inputValue(event) })}
                        placeholder="Filter"
                        className="w-full min-w-[70px] rounded-[2px] border border-[#dcdcd8] px-1.5 py-1 text-[12px] outline-none focus:border-[#7a2433]"
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.id}
                  onClick={() => onOpen(row.id)}
                  className={`cursor-pointer hover:bg-[#f6eef0] ${index % 2 ? 'bg-[#fafaf9]' : 'bg-white'}`}
                >
                  <td className={`${td} whitespace-nowrap`}>{row.employeeNumber}</td>
                  <td className={`${td} font-[600] whitespace-nowrap text-[#7a2433]`}>
                    {row.legalName}
                  </td>
                  <td className={td}>{row.position}</td>
                  <td className={`${td} whitespace-nowrap`}>{row.salaryGrade}</td>
                  <td className={td}>{row.unit}</td>
                  <td className={td}>{row.appointment}</td>
                  <td className={`${td} font-[600] whitespace-nowrap ${statusText[row.status]}`}>
                    {label(row.status)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-3 py-6 text-center text-[13px] text-[#5f6570]"
                  >
                    No employees match these filters. Clear a filter to widen the list.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function FieldGroup({ title, fields }: { title: string; fields: [string, string][] }) {
  return (
    <fieldset className="m-0 min-w-0 border border-[#dcdcd8] bg-white p-0">
      <legend className="sr-only">{title}</legend>
      <div className="flex items-center justify-between border-b border-[#dcdcd8] bg-[#efefec] px-3 py-1.5">
        <span className="text-[13px] font-[650]">{title}</span>
        <span className="text-[12px] text-[#5f6570]">Changes go through a personnel action</span>
      </div>
      <div className="grid grid-cols-2">
        {fields.map(([name, value]) => (
          <div key={name} className="border-b border-[#ececea] px-3 py-2 odd:border-r">
            <div className="text-[11px] text-[#5f6570]">{name}</div>
            <div className="text-[13px] font-[600]">{value}</div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

function Record({ employee }: { employee: Employee }) {
  const [tab, setTab] = useState('Summary');
  return (
    <>
      <div className="border-b border-[#dcdcd8] bg-white px-6 pt-4">
        <p className="m-0 text-[12px] text-[#5f6570]">
          Personnel / Employees / {employee.employeeNumber}
        </p>
        <div className="mt-1 flex items-start justify-between gap-6">
          <div>
            <h1 className="m-0 text-[22px] leading-[1.2] font-[650]">{employee.legalName}</h1>
            <p className="m-0 mt-1 text-[13px] text-[#5f6570]">
              {employee.position}, {employee.salaryGrade} ·{' '}
              <span className={`font-[650] ${statusText[employee.status]}`}>
                {label(employee.status)}
              </span>
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" className={tool}>
              Print service record
            </button>
            <button type="button" className={toolPrimary}>
              New personnel action
            </button>
          </div>
        </div>
        <nav className="-mb-px mt-3 flex" aria-label="Record sections">
          {recordSections.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setTab(name)}
              className={`cursor-pointer border border-b-0 px-3.5 py-1.5 text-[13px] [&+&]:-ml-px ${
                tab === name
                  ? 'relative z-1 border-[#dcdcd8] border-t-[#7a2433] bg-[#f3f3f1] font-[650] shadow-[inset_0_2px_0_#7a2433]'
                  : 'border-transparent text-[#5f6570] hover:text-[#1c1f24]'
              }`}
            >
              {name}
            </button>
          ))}
        </nav>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4 p-6">
        <div className="grid gap-4">
          <FieldGroup
            title="Identification"
            fields={[
              ['Employee number', employee.employeeNumber],
              ['Legal name', employee.legalName],
              ['Service status', label(employee.status)],
              ['In service since', employee.since],
            ]}
          />
          <FieldGroup
            title="Current position"
            fields={[
              ['Plantilla item', employee.itemNumber],
              ['Position title', employee.position],
              ['Salary grade and step', employee.salaryGrade],
              ['Nature of appointment', employee.appointment],
              ['Organization unit', employee.unit],
            ]}
          />
          <fieldset className="m-0 min-w-0 border border-[#dcdcd8] bg-white p-0">
            <legend className="sr-only">Leave credits</legend>
            <div className="border-b border-[#dcdcd8] bg-[#efefec] px-3 py-1.5 text-[13px] font-[650]">
              Leave credits, as of Sep 30, 2026
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={`${th} bg-white`}>Type</th>
                  <th className={`${th} bg-white text-right`}>Posted</th>
                  <th className={`${th} bg-white text-right`}>Committed</th>
                </tr>
              </thead>
              <tbody>
                {leaveBalances.map((row) => (
                  <tr key={row.type} className="border-t border-[#ececea]">
                    <td className={td}>{row.type}</td>
                    <td className={`${td} text-right font-[650]`}>{row.posted}</td>
                    <td className={`${td} text-right`}>{row.committed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </fieldset>
        </div>

        <aside className="border border-[#dcdcd8] bg-white">
          <div className="border-b border-[#dcdcd8] bg-[#efefec] px-3 py-1.5 text-[13px] font-[650]">
            Audit trail
          </div>
          <ol className="m-0 list-none p-0">
            {activity.map((entry) => (
              <li key={entry.at} className="border-b border-[#ececea] px-3 py-2.5 last:border-b-0">
                <div className="text-[12px] text-[#5f6570]">{entry.at}</div>
                <div className="text-[13px]">
                  <span className="font-[650]">{entry.actor}</span>: {entry.summary}
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </>
  );
}
