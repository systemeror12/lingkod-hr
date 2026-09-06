'use client';

import Link from 'next/link';
import { recordHref } from '../lib/navigation';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { buttonVariants } from './ui/button';

/** Record selection belongs to the existing router; edits stay in the owning form. */
export function useRecordNavigation() {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  function href(values: Record<string, string | null>) {
    return recordHref(pathname, search.toString(), values);
  }
  return {
    search,
    href,
    navigate(values: Record<string, string | null>) {
      router.push(href(values), { scroll: false });
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
