'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Destination, DestinationIcon } from '../lib/navigation';
import type { ActiveSession } from '../lib/session';
import { cn } from '../lib/class-names';
import { Button } from './ui/button';

function Icon({ name }: { name: DestinationIcon }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (name === 'dashboard') {
    return (
      <svg {...common}>
        <path d="M4 4h6v6H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 14h6v6H4z" />
      </svg>
    );
  }
  if (name === 'users') {
    return (
      <svg {...common}>
        <path d="M16 20v-1.6a3.4 3.4 0 0 0-3.4-3.4H6.4A3.4 3.4 0 0 0 3 18.4V20" />
        <circle cx="9.5" cy="7.5" r="3.5" />
        <path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M21 20v-1.6a3.4 3.4 0 0 0-2.5-3.3" />
      </svg>
    );
  }
  if (name === 'organization') {
    return (
      <svg {...common}>
        <rect x="8" y="3" width="8" height="5" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
        <rect x="14" y="16" width="7" height="5" rx="1" />
        <path d="M12 8v4M6.5 16v-4h11v4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M7 3h10v4H7zM5 7h14v14H5zM9 12h6M9 16h4" />
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

export function ApplicationShell({
  session,
  destinations,
  children,
}: {
  session: ActiveSession;
  destinations: readonly Destination[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const roleNames =
    session.effectiveRoles.map(({ name }) => name).join(', ') || 'No effective role';

  return (
    <div
      className={cn(
        'min-h-dvh bg-canvas min-[980px]:grid min-[980px]:transition-[grid-template-columns] min-[980px]:duration-150 min-[980px]:ease-out motion-reduce:transition-none',
        collapsed
          ? 'min-[980px]:grid-cols-[72px_minmax(0,1fr)]'
          : 'min-[980px]:grid-cols-[200px_minmax(0,1fr)]',
      )}
    >
      <aside
        aria-label="Application"
        className={cn(
          'relative flex h-auto w-full flex-col overflow-visible bg-midnight text-[#f7f9fc] min-[980px]:sticky min-[980px]:top-0 min-[980px]:h-dvh min-[980px]:border-r min-[980px]:border-white/12 min-[980px]:transition-[width] min-[980px]:duration-150 min-[980px]:ease-out motion-reduce:transition-none',
          collapsed ? 'min-[980px]:w-[72px]' : 'min-[980px]:w-[200px]',
        )}
      >
        <div
          className={cn(
            'flex min-h-[58px] items-center justify-start border-b border-white/10 px-[22px] min-[980px]:min-h-[68px] min-[980px]:justify-between min-[980px]:pr-[14px] min-[980px]:pl-[16px]',
            collapsed && 'min-[980px]:justify-center min-[980px]:px-0',
          )}
        >
          <Link
            className="flex min-w-0 items-center gap-[10px] no-underline"
            href="/dashboard"
            aria-label="LingkodHR dashboard"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-[3px] border border-white/45 text-sm font-[760] text-paper">
              L
            </span>
            <span
              className={cn(
                'text-[15px] font-[690] tracking-[-0.015em] whitespace-nowrap',
                collapsed && 'min-[980px]:hidden',
              )}
            >
              LingkodHR
            </span>
          </Link>
          <Button
            className="hidden shrink-0 min-[980px]:inline-flex"
            type="button"
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            onClick={() => setCollapsed((value) => !value)}
          >
            <svg
              className="w-[17px] fill-none stroke-current stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round]"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d={collapsed ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} />
            </svg>
          </Button>
        </div>

        <nav
          className="flex flex-none flex-row gap-0.5 overflow-x-auto border-t border-white/8 px-[14px] py-2 min-[980px]:flex-1 min-[980px]:flex-col min-[980px]:gap-1 min-[980px]:overflow-visible min-[980px]:border-0 min-[980px]:p-[18px_10px]"
          aria-label="Primary"
        >
          {destinations.map((destination) => {
            const current = pathname === destination.href;
            return (
              <Link
                key={destination.href}
                className={cn(
                  "group relative flex min-h-[42px] min-w-max items-center justify-start gap-3 rounded-[3px] px-[10px] text-[13px] font-[560] text-[#c3ccda] no-underline before:absolute before:right-[10px] before:bottom-[-8px] before:left-[10px] before:h-[3px] before:rounded-t-sm before:bg-transparent before:content-[''] hover:bg-white/7 hover:text-paper min-[980px]:min-w-0 min-[980px]:before:top-[9px] min-[980px]:before:right-auto min-[980px]:before:bottom-[9px] min-[980px]:before:left-[-10px] min-[980px]:before:h-auto min-[980px]:before:w-[3px] min-[980px]:before:rounded-[0_2px_2px_0]",
                  current && 'bg-[#416da9]/30 text-paper before:bg-[#7fa4d8]',
                  collapsed && 'min-[980px]:justify-center min-[980px]:px-0',
                )}
                href={destination.href}
                aria-current={current ? 'page' : undefined}
                title={collapsed ? destination.label : undefined}
              >
                <span className="grid w-5 shrink-0 place-items-center">
                  <Icon name={destination.icon} />
                </span>
                <span className={cn(collapsed && 'min-[980px]:hidden')}>{destination.label}</span>
                <span
                  className={cn(
                    'absolute top-1/2 left-[calc(100%+9px)] z-5 hidden w-max max-w-[180px] -translate-y-1/2 rounded-[3px] border border-line bg-paper px-2 py-1.5 text-xs font-semibold text-ink shadow-[0_8px_24px_rgb(23_32_51/16%)]',
                    collapsed &&
                      'min-[980px]:group-hover:block min-[980px]:group-focus-visible:block',
                  )}
                  role="tooltip"
                >
                  {destination.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div
          className={cn(
            'absolute top-0 right-[18px] flex min-h-[58px] items-center gap-[10px] px-0 py-[9px] min-[980px]:static min-[980px]:min-h-[76px] min-[980px]:border-t min-[980px]:border-white/10 min-[980px]:px-4 min-[980px]:py-3',
            collapsed && 'min-[980px]:justify-center min-[980px]:px-0',
          )}
          title={`${session.identity.displayName} · ${session.agency.name} · ${roleNames}`}
        >
          <span
            className="grid size-[34px] shrink-0 place-items-center rounded-full border border-white/35 bg-[#416da9]/38 text-[11px] font-[740] text-paper"
            aria-hidden="true"
          >
            {initials(session.identity.displayName)}
          </span>
          <span
            className={cn(
              'hidden min-w-0 gap-0.5 min-[980px]:grid',
              collapsed && 'min-[980px]:hidden',
            )}
          >
            <strong className="overflow-hidden text-xs font-[650] text-ellipsis whitespace-nowrap">
              {session.identity.displayName}
            </strong>
            <span className="overflow-hidden text-[10px] text-ellipsis whitespace-nowrap text-[#9fabbc]">
              {roleNames}
            </span>
          </span>
        </div>
      </aside>

      <section className="min-w-0">
        <header className="flex min-h-12 flex-wrap items-center gap-x-[10px] gap-y-[3px] border-b border-line bg-paper px-6 py-[9px] text-xs text-muted min-[621px]:flex-nowrap min-[621px]:py-0 min-[980px]:px-8">
          <span className="w-full text-[10px] font-bold tracking-[0.08em] text-cobalt uppercase min-[621px]:w-auto">
            Active Agency Context
          </span>
          <strong className="font-[650] text-ink">{session.agency.name}</strong>
          <span className="h-4 w-px bg-line" aria-hidden="true" />
          <span>{roleNames}</span>
        </header>
        <main className="mx-auto w-full max-w-[1120px] px-[18px] pt-7 pb-12 min-[621px]:px-6 min-[621px]:pt-[34px] min-[621px]:pb-14 min-[980px]:px-10 min-[980px]:pt-[42px] min-[980px]:pb-16">
          {children}
        </main>
      </section>
    </div>
  );
}
