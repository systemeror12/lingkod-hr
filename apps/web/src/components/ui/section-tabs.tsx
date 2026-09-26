'use client';

import type { ComponentPropsWithoutRef } from 'react';
import { Tabs } from 'radix-ui';
import { cn } from '../../lib/class-names';

/**
 * Wrap the page region that holds both the tab list and its panels. Put `SectionTabList` in the
 * `tabs` slot of `PageHeader` and one `SectionTabPanel` per section below it. Arrow keys, Home,
 * and End move between tabs; focus selects the tab.
 */
export const SectionTabs = Tabs.Root;

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
        <Tabs.Trigger
          key={tab.value}
          value={tab.value}
          className="cursor-pointer border-0 border-b-[3px] border-transparent bg-transparent px-4 py-2.5 text-small whitespace-nowrap text-ink-muted hover:text-ink focus-visible:outline-offset-[-3px] data-[state=active]:border-primary data-[state=active]:font-[650] data-[state=active]:text-ink"
        >
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
