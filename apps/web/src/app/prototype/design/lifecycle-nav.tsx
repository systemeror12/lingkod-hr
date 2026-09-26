'use client';

// PROTOTYPE: the lifecycle-grouped sidebar shared by every variant, so the
// comparison is about page design, not navigation. Collapses to an icon rail
// (kept in `?nav=collapsed` so it survives variant switches); in the rail, a stage
// icon opens a flyout of that stage's pages. Colours come from a per-variant theme.

import { useState, type CSSProperties } from 'react';
import { agency, nav, queue, stages, viewer, type Stage } from './fixtures';
import { usePrototypeState } from './screen';

export interface NavTheme {
  bg: string;
  panel: string;
  line: string;
  ink: string;
  muted: string;
  hover: string;
  accent: string;
  radius: string;
}

const icons: Record<Stage | 'Work queue', string> = {
  'Work queue': 'M4 5h16v4H4zM4 11h16v8H4zM8 15h8',
  Structure: 'M4 20h16M6 20V9l6-5 6 5v11M10 20v-5h4v5',
  'Merit selection': 'M9 11l2 2 4-4M5 4h14v16H5z',
  Personnel: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  'Time & attendance': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  Leave: 'M4 6h16v14H4zM8 3v5M16 3v5M4 11h16',
  Oversight: 'M12 3 20 7v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7Z',
};

function Icon({ name }: { name: keyof typeof icons }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[18px] shrink-0 fill-none stroke-current stroke-[1.7]"
      aria-hidden="true"
    >
      <path d={icons[name]} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function LifecycleNav({ theme }: { theme: NavTheme }) {
  const { screen, go, navCollapsed: collapsed, setNavCollapsed } = usePrototypeState();
  const [open, setOpen] = useState<Record<string, boolean>>({ Personnel: true, Leave: true });
  const [flyout, setFlyout] = useState<Stage | null>(null);
  const current = screen === 'queue' ? '/dashboard' : '/employees';
  const currentStage = nav.find((item) => item.href === current)?.stage;
  const vars = {
    '--nav-bg': theme.bg,
    '--nav-panel': theme.panel,
    '--nav-line': theme.line,
    '--nav-ink': theme.ink,
    '--nav-muted': theme.muted,
    '--nav-hover': theme.hover,
    '--nav-accent': theme.accent,
    '--nav-radius': theme.radius,
  } as CSSProperties;

  function openPage(href: string) {
    setFlyout(null);
    if (href === '/dashboard') go('queue');
    if (href === '/employees') go('employees');
  }

  const rowBase =
    'flex w-full cursor-pointer items-center gap-2.5 rounded-[var(--nav-radius)] text-left text-[13px]';
  const rowState = (active: boolean) =>
    active
      ? 'bg-[var(--nav-panel)] font-[600] shadow-[0_0_0_1px_var(--nav-line)]'
      : 'hover:bg-[var(--nav-hover)]';

  return (
    <aside
      style={vars}
      className={`sticky top-0 z-20 flex h-dvh flex-col border-r border-[var(--nav-line)] bg-[var(--nav-bg)] text-[var(--nav-ink)] transition-[width] duration-150 ease-out motion-reduce:transition-none ${
        collapsed ? 'w-16' : 'w-[248px]'
      }`}
    >
      <div
        className={`flex items-center border-b border-[var(--nav-line)] ${collapsed ? 'justify-center py-4' : 'justify-between px-4 py-4'}`}
      >
        {!collapsed && (
          <div className="flex items-center gap-2 text-[15px] font-[700] tracking-[-0.01em]">
            <span className="grid size-6 place-items-center rounded-[var(--nav-radius)] bg-[var(--nav-accent)] text-[12px] text-white">
              L
            </span>
            LingkodHR
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            setFlyout(null);
            setNavCollapsed(!collapsed);
          }}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          className="grid size-8 cursor-pointer place-items-center rounded-[var(--nav-radius)] text-[var(--nav-muted)] hover:bg-[var(--nav-hover)] hover:text-[var(--nav-ink)]"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-[18px] fill-none stroke-current stroke-[1.7]"
            aria-hidden="true"
          >
            <path d="M4 5h16v14H4zM9 5v14" />
            <path
              d={collapsed ? 'm13 10 2 2-2 2' : 'm16 10-2 2 2 2'}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {!collapsed && (
        <div className="border-b border-[var(--nav-line)] px-4 py-3">
          <button
            type="button"
            className="w-full cursor-pointer rounded-[var(--nav-radius)] border border-[var(--nav-line)] bg-[var(--nav-panel)] px-3 py-2 text-left"
          >
            <span className="block text-[13px] font-[600]">{agency.name}</span>
            <span className="block text-[12px] text-[var(--nav-muted)]">Switch agency context</span>
          </button>
        </div>
      )}

      {flyout && (
        <button
          type="button"
          aria-label="Close menu"
          tabIndex={-1}
          onClick={() => setFlyout(null)}
          className="fixed inset-0 z-10 cursor-default"
        />
      )}

      <nav
        className={`relative z-20 flex-1 py-3 ${collapsed ? 'px-2' : 'overflow-y-auto px-3'}`}
        aria-label="Primary"
      >
        <button
          type="button"
          onClick={() => openPage('/dashboard')}
          aria-current={current === '/dashboard' ? 'page' : undefined}
          title={collapsed ? `Work queue (${queue.length})` : undefined}
          className={`${rowBase} ${rowState(current === '/dashboard')} relative ${collapsed ? 'justify-center py-2.5' : 'px-2 py-[7px]'}`}
        >
          <Icon name="Work queue" />
          {collapsed ? (
            <span className="absolute top-1 right-1 min-w-4 rounded-full bg-[var(--nav-accent)] px-1 text-center text-[10px] leading-4 font-[700] text-white">
              {queue.length}
            </span>
          ) : (
            <>
              <span className="flex-1">Work queue</span>
              <span className="text-[12px] font-[600] text-[var(--nav-accent)]">
                {queue.length}
              </span>
            </>
          )}
        </button>

        {stages.map((stage) => {
          const items = nav.filter((item) => item.stage === stage);
          const pending = items.reduce((sum, item) => sum + (item.count ?? 0), 0);
          const expanded = open[stage] ?? false;

          if (collapsed) {
            return (
              <div key={stage} className="relative mt-1">
                <button
                  type="button"
                  onClick={() => setFlyout(flyout === stage ? null : stage)}
                  aria-expanded={flyout === stage}
                  aria-label={stage}
                  title={stage}
                  className={`${rowBase} ${rowState(currentStage === stage)} justify-center py-2.5`}
                >
                  <Icon name={stage} />
                  {pending > 0 && (
                    <span className="absolute top-1.5 right-2 size-1.5 rounded-full bg-[var(--nav-accent)]" />
                  )}
                </button>
                {flyout === stage && (
                  <div className="absolute top-0 left-[calc(100%+10px)] z-30 w-60 rounded-[var(--nav-radius)] border border-[var(--nav-line)] bg-[var(--nav-bg)] p-2 shadow-[0_12px_32px_rgb(0_0_0/22%)]">
                    <div className="px-2 pt-1 pb-2 text-[12px] font-[650] text-[var(--nav-muted)]">
                      {stage}
                    </div>
                    {items.map((item) => (
                      <button
                        key={item.href}
                        type="button"
                        onClick={() => openPage(item.href)}
                        aria-current={current === item.href ? 'page' : undefined}
                        className={`${rowBase} ${rowState(current === item.href)} justify-between px-2 py-[7px]`}
                      >
                        {item.label}
                        {item.count !== undefined && (
                          <span className="text-[12px] font-[600] text-[var(--nav-accent)]">
                            {item.count}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          return (
            <div key={stage} className="mt-2">
              <button
                type="button"
                onClick={() => setOpen((value) => ({ ...value, [stage]: !expanded }))}
                aria-expanded={expanded}
                className={`${rowBase} px-2 py-[7px] font-[600] text-[var(--nav-muted)] hover:text-[var(--nav-ink)] ${
                  currentStage === stage ? 'text-[var(--nav-ink)]' : ''
                }`}
              >
                <Icon name={stage} />
                <span className="flex-1">{stage}</span>
                {!expanded && pending > 0 && (
                  <span className="text-[12px] text-[var(--nav-accent)]">{pending}</span>
                )}
                <span
                  className={`text-[12px] transition-transform motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`}
                  aria-hidden="true"
                >
                  ›
                </span>
              </button>
              {expanded &&
                items.map((item) => (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => openPage(item.href)}
                    aria-current={current === item.href ? 'page' : undefined}
                    className={`${rowBase} ${rowState(current === item.href)} justify-between py-[7px] pr-2 pl-[36px]`}
                  >
                    {item.label}
                    {item.count !== undefined && (
                      <span className="text-[12px] font-[600] text-[var(--nav-accent)]">
                        {item.count}
                      </span>
                    )}
                  </button>
                ))}
            </div>
          );
        })}
      </nav>

      <div
        className={`flex items-center gap-2.5 border-t border-[var(--nav-line)] py-3 ${collapsed ? 'justify-center' : 'px-4'}`}
        title={collapsed ? `${viewer.displayName}, ${viewer.roles.join(', ')}` : undefined}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--nav-accent)] text-[11px] font-[700] text-white">
          MD
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-[13px] font-[600]">{viewer.displayName}</div>
            <div className="truncate text-[12px] text-[var(--nav-muted)]">
              {viewer.roles.join(', ')}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
