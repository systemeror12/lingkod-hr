'use client';

import Link from 'next/link';
import { recordHref } from '../lib/navigation';
import { usePathname, useSearchParams } from 'next/navigation';
import { buttonVariants } from './ui/button';

/** Record selection stays in the current workspace; edits stay in the owning form. */
export function useRecordNavigation() {
  const pathname = usePathname();
  const search = useSearchParams();
  function href(values: Record<string, string | null>) {
    return recordHref(pathname, search.toString(), values);
  }
  return {
    search,
    href,
    navigate(values: Record<string, string | null>) {
      const browser = globalThis as unknown as {
        history: { pushState(state: unknown, title: string, url: string): void; state: unknown };
      };
      browser.history.pushState(browser.history.state, '', href(values));
    },
  };
}

export function RecordReturn({ href, children }: { href: string; children: string }) {
  return (
    <Link className={buttonVariants({ variant: 'secondary', size: 'default' })} href={href}>
      {children}
    </Link>
  );
}
