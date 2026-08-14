'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Destination, DestinationIcon } from '../lib/navigation';
import type { ActiveSession } from '../lib/session';
import styles from './application-shell.module.css';

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
    <div className={`${styles.shell} ${collapsed ? styles.shellCollapsed : ''}`}>
      <aside className={styles.rail} data-testid="application-rail">
        <div className={styles.brandRow}>
          <Link className={styles.brand} href="/dashboard" aria-label="LingkodHR dashboard">
            <span className={styles.brandMark}>L</span>
            <span className={styles.brandName}>LingkodHR</span>
          </Link>
          <button
            className={styles.collapseButton}
            type="button"
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            onClick={() => setCollapsed((value) => !value)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={collapsed ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} />
            </svg>
          </button>
        </div>

        <nav className={styles.navigation} aria-label="Primary">
          {destinations.map((destination) => {
            const current = pathname === destination.href;
            return (
              <Link
                key={destination.href}
                className={`${styles.navLink} ${current ? styles.navLinkCurrent : ''}`}
                href={destination.href}
                aria-current={current ? 'page' : undefined}
                title={collapsed ? destination.label : undefined}
              >
                <span className={styles.navIcon}>
                  <Icon name={destination.icon} />
                </span>
                <span className={styles.navLabel}>{destination.label}</span>
                <span className={styles.tooltip} role="tooltip">
                  {destination.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div
          className={styles.profile}
          title={`${session.identity.displayName} · ${session.agency.name} · ${roleNames}`}
        >
          <span className={styles.avatar} aria-hidden="true">
            {initials(session.identity.displayName)}
          </span>
          <span className={styles.profileCopy}>
            <strong>{session.identity.displayName}</strong>
            <span>{roleNames}</span>
          </span>
        </div>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.contextBar}>
          <span className={styles.contextLabel}>Active Agency Context</span>
          <strong>{session.agency.name}</strong>
          <span className={styles.contextDivider} aria-hidden="true" />
          <span>{roleNames}</span>
        </header>
        <main className={styles.content}>{children}</main>
      </section>
    </div>
  );
}
