'use client';

import type { ComponentProps, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import {
  isDestinationCurrent,
  navigationCollapsedCookie,
  navigationGroups,
  type Destination,
  type LifecycleStage,
} from '../lib/navigation';
import type { ActiveSession } from '../lib/session';
import { cn } from '../lib/class-names';

const iconPaths: Record<LifecycleStage | 'Work queue', string> = {
  'Work queue': 'M4 4h6v6H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 14h6v6H4z',
  Structure: 'M8 3h8v5H8zM3 16h7v5H3zM14 16h7v5h-7zM12 8v4M6.5 16v-4h11v4',
  'Merit selection': 'M5 4h14v16H5zM9 12l2 2 4-4',
  Personnel: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  'Time & attendance': 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17ZM12 7.5V12l3 2',
  Leave: 'M4 5h16v15H4zM8 3v4M16 3v4M4 10h16',
  Oversight: 'M12 3 19 6v5c0 4.5-2.9 8-7 10-4.1-2-7-5.5-7-10V6l7-3ZM9 12l2 2 4-4',
};

function Icon({ name }: { name: keyof typeof iconPaths }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4.5 shrink-0 fill-none stroke-current stroke-[1.7] [stroke-linecap:round] [stroke-linejoin:round]"
      aria-hidden="true"
    >
      <path d={iconPaths[name]} />
    </svg>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

const row = 'flex w-full items-center gap-2.5 rounded-panel text-left text-small no-underline';
const rowState = (current: boolean) =>
  current
    ? 'bg-white/10 font-semibold text-nav-ink shadow-[inset_0_0_0_1px_rgb(255_255_255/14%)]'
    : 'text-nav-ink hover:bg-white/6';

function NavLink({
  destination,
  pathname,
  className,
  ...props
}: { destination: Destination; pathname: string } & Omit<ComponentProps<typeof Link>, 'href'>) {
  const current = isDestinationCurrent(pathname, destination.href);
  return (
    <Link
      href={destination.href}
      aria-current={current ? 'page' : undefined}
      className={cn(row, rowState(current), className)}
      {...props}
    />
  );
}

/** Remember the rail for the next server render, so reloads open without a layout flash. */
function rememberCollapsed(collapsed: boolean) {
  const browser = globalThis as unknown as { document: { cookie: string } };
  browser.document.cookie = `${navigationCollapsedCookie}=1; path=/; max-age=${collapsed ? 31_536_000 : 0}; samesite=lax`;
}

/**
 * Protected application frame. Wide viewports show the lifecycle navigation as
 * collapsible stage groups or, when collapsed, an icon rail whose stage icons open
 * menus. Below 980px the rail does not apply; a Menu button reveals the groups.
 */
export function ApplicationShell({
  session,
  destinations,
  initialCollapsed,
  children,
}: {
  session: ActiveSession;
  destinations: readonly Destination[];
  initialCollapsed: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const mainRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const browser = globalThis as unknown as {
      document: { activeElement: { isConnected: boolean } | null; body: unknown };
    };
    const active = browser.document.activeElement;
    if (!active || !active.isConnected || active === browser.document.body) {
      (mainRef.current as unknown as { focus(): void } | null)?.focus();
    }
  }, [pathname, search]);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openStages, setOpenStages] = useState<Partial<Record<LifecycleStage, boolean>>>({});

  const { workQueue, groups } = navigationGroups(destinations);
  const currentStage = destinations.find(({ href }) => isDestinationCurrent(pathname, href))?.stage;
  // Arriving on a page reopens its stage, even if it was closed by hand earlier.
  const [shownPathname, setShownPathname] = useState(pathname);
  if (shownPathname !== pathname) {
    setShownPathname(pathname);
    if (currentStage) setOpenStages((value) => ({ ...value, [currentStage]: undefined }));
  }
  const roleNames =
    session.effectiveRoles.map(({ name }) => name).join(', ') || 'No effective role';
  const closeMenu = () => setMenuOpen(false);

  return (
    <div
      className={cn(
        'min-h-dvh bg-canvas min-[980px]:grid',
        collapsed
          ? 'min-[980px]:grid-cols-[64px_minmax(0,1fr)]'
          : 'min-[980px]:grid-cols-[248px_minmax(0,1fr)]',
      )}
    >
      <aside
        aria-label="Application"
        className="flex flex-col bg-nav text-nav-ink [--color-focus:var(--color-nav-focus)] min-[980px]:sticky min-[980px]:top-0 min-[980px]:h-dvh min-[980px]:border-r min-[980px]:border-white/10"
      >
        <div
          className={cn(
            'flex min-h-14 items-center justify-between gap-3 border-b border-white/10 px-4',
            collapsed && 'min-[980px]:justify-center min-[980px]:px-0',
          )}
        >
          <Link
            className={cn(
              'flex items-center gap-2 text-[15px] font-bold tracking-[-0.01em] no-underline',
              collapsed && 'min-[980px]:hidden',
            )}
            href="/dashboard"
            aria-label="LingkodHR work queue"
          >
            <span
              className="grid size-6 place-items-center rounded-panel bg-nav-focus text-xs text-nav"
              aria-hidden="true"
            >
              L
            </span>
            <span>LingkodHR</span>
          </Link>
          <button
            type="button"
            className="hidden size-8 cursor-pointer place-items-center rounded-panel text-nav-muted hover:bg-white/6 hover:text-nav-ink min-[980px]:grid"
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            onClick={() => {
              rememberCollapsed(!collapsed);
              setCollapsed(!collapsed);
            }}
          >
            <svg
              viewBox="0 0 24 24"
              className="size-4.5 fill-none stroke-current stroke-[1.7] [stroke-linecap:round] [stroke-linejoin:round]"
              aria-hidden="true"
            >
              <path d="M4 5h16v14H4zM9 5v14" />
              <path d={collapsed ? 'm13 10 2 2-2 2' : 'm16 10-2 2 2 2'} />
            </svg>
          </button>
          <button
            type="button"
            className="cursor-pointer rounded-panel border border-white/20 px-3 py-1.5 text-small font-semibold hover:bg-white/6 min-[980px]:hidden"
            aria-expanded={menuOpen}
            aria-controls="primary-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            Menu
          </button>
        </div>

        <div
          className={cn('border-b border-white/10 px-4 py-3', collapsed && 'min-[980px]:hidden')}
        >
          <span className="block text-caption text-nav-muted">Agency context</span>
          <strong className="block text-small font-semibold">{session.agency.name}</strong>
        </div>

        {collapsed && (
          <nav
            className="hidden flex-1 flex-col gap-1 overflow-y-auto p-2 min-[980px]:flex"
            aria-label="Primary"
          >
            {workQueue.map((destination) => (
              <NavLink
                key={destination.href}
                destination={destination}
                pathname={pathname}
                aria-label={destination.label}
                title={destination.label}
                className="justify-center py-2.5"
              >
                <Icon name="Work queue" />
              </NavLink>
            ))}
            {groups.map(({ stage, destinations: members }) => (
              <DropdownMenu.Root key={stage}>
                <DropdownMenu.Trigger
                  className={cn(
                    row,
                    rowState(stage === currentStage),
                    'cursor-pointer justify-center py-2.5 data-[state=open]:bg-white/10',
                  )}
                  aria-label={stage}
                  aria-current={stage === currentStage ? 'true' : undefined}
                  title={stage}
                >
                  <Icon name={stage} />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    side="right"
                    align="start"
                    sideOffset={10}
                    collisionPadding={8}
                    aria-label={stage}
                    className="z-30 w-60 rounded-panel border border-white/10 bg-nav p-2 text-nav-ink shadow-[0_12px_32px_rgb(0_0_0/22%)] [--color-focus:var(--color-nav-focus)]"
                  >
                    <DropdownMenu.Label className="px-2 pt-1 pb-2 text-caption font-semibold text-nav-muted">
                      {stage}
                    </DropdownMenu.Label>
                    {members.map((destination) => (
                      <DropdownMenu.Item key={destination.href} asChild>
                        <NavLink
                          destination={destination}
                          pathname={pathname}
                          className="px-2 py-1.5 data-[highlighted]:bg-white/10"
                        >
                          {destination.label}
                        </NavLink>
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            ))}
          </nav>
        )}

        <nav
          id="primary-navigation"
          className={cn(
            'flex-1 flex-col overflow-y-auto px-3 py-3',
            menuOpen ? 'flex' : 'hidden',
            collapsed ? 'min-[980px]:hidden' : 'min-[980px]:flex',
          )}
          aria-label="Primary"
        >
          {workQueue.map((destination) => (
            <NavLink
              key={destination.href}
              destination={destination}
              pathname={pathname}
              onClick={closeMenu}
              className="px-2 py-1.5"
            >
              <Icon name="Work queue" />
              {destination.label}
            </NavLink>
          ))}
          {groups.map(({ stage, destinations: members }) => {
            const expanded = openStages[stage] ?? stage === currentStage;
            const listId = `navigation-stage-${stage.replace(/\W+/g, '-').toLowerCase()}`;
            return (
              <div key={stage} className="mt-2">
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={listId}
                  onClick={() => setOpenStages((value) => ({ ...value, [stage]: !expanded }))}
                  className={cn(
                    row,
                    'cursor-pointer px-2 py-1.5 font-semibold hover:text-nav-ink',
                    stage === currentStage ? 'text-nav-ink' : 'text-nav-muted',
                  )}
                >
                  <Icon name={stage} />
                  <span className="flex-1">{stage}</span>
                  <svg
                    viewBox="0 0 24 24"
                    className={cn(
                      'size-3.5 fill-none stroke-current stroke-2 transition-transform duration-150 motion-reduce:transition-none',
                      expanded && 'rotate-90',
                    )}
                    aria-hidden="true"
                  >
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </button>
                {expanded && (
                  <ul id={listId} className="m-0 list-none p-0">
                    {members.map((destination) => (
                      <li key={destination.href}>
                        <NavLink
                          destination={destination}
                          pathname={pathname}
                          onClick={closeMenu}
                          className="py-1.5 pr-2 pl-9"
                        >
                          {destination.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        <div
          className={cn(
            'items-center gap-2.5 border-t border-white/10 px-4 py-3 min-[980px]:flex',
            menuOpen ? 'flex' : 'hidden',
            collapsed && 'min-[980px]:justify-center min-[980px]:px-0',
          )}
          title={`${session.identity.displayName} · ${session.agency.name} · ${roleNames}`}
        >
          <span
            className="grid size-8 shrink-0 place-items-center rounded-full bg-nav-focus text-[11px] font-bold text-nav"
            aria-hidden="true"
          >
            {initials(session.identity.displayName)}
          </span>
          <span className={cn('min-w-0', collapsed && 'min-[980px]:hidden')}>
            <strong className="block truncate text-small font-semibold">
              {session.identity.displayName}
            </strong>
            <span className="block truncate text-caption text-nav-muted">{roleNames}</span>
          </span>
        </div>
      </aside>

      <main
        ref={mainRef}
        tabIndex={-1}
        className="workspace w-full min-w-0 px-4 py-6 min-[621px]:px-6 min-[980px]:px-8"
      >
        {children}
      </main>
    </div>
  );
}
