'use client';

import Link from 'next/link';
import type { ComponentPropsWithoutRef } from 'react';
import { Tabs } from 'radix-ui';
import { cn } from '../../lib/class-names';

/**
 * Wrap the page region that holds both the tab list and its panels. Put `SectionTabList` in the
 * `tabs` slot of `PageHeader` and one `SectionTabPanel` per section below it. Arrow keys, Home,
 * and End move between tabs; focus selects the tab.
 */
export const SectionTabs = Tabs.Root;

const tabClass =
  'cursor-pointer border-0 border-b-[3px] border-transparent bg-transparent px-4 py-2.5 text-small whitespace-nowrap text-ink-muted no-underline hover:text-ink focus-visible:outline-offset-[-3px] data-[state=active]:border-primary data-[state=active]:font-[650] data-[state=active]:text-ink aria-[current=page]:border-primary aria-[current=page]:font-[650] aria-[current=page]:text-ink';

/** The row of section tabs. `label` names the tablist for assistive technology. */
export function SectionTabList({
  label,
  tabs,
  className,
}: {
  label: string;
  tabs: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <Tabs.List aria-label={label} className={cn('-mb-px flex overflow-x-auto', className)}>
      {tabs.map((tab) => (
        <Tabs.Trigger key={tab.value} value={tab.value} className={tabClass}>
          {tab.label}
        </Tabs.Trigger>
      ))}
    </Tabs.List>
  );
}

/** Content for one section; rendered only while its tab is selected. */
export function SectionTabPanel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Tabs.Content>) {
  return <Tabs.Content className={cn('outline-none', className)} {...props} />;
}

/**
 * Tabs that switch between pages rather than panels, for sections the server loads separately.
 * Put it in the `tabs` slot of `PageHeader`; the current link is marked with `aria-current`.
 */
export function SectionTabLinks({
  label,
  tabs,
}: {
  label: string;
  tabs: { href: string; label: string; current: boolean }[];
}) {
  return (
    <nav aria-label={label} className="-mb-px flex overflow-x-auto">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.current ? 'page' : undefined}
          className={tabClass}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
