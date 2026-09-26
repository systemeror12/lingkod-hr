'use client';

// PROTOTYPE: floating variant switcher for throwaway `?variant=` prototypes.
// Never rendered in production builds.

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export interface WindowKey {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  target: unknown;
  preventDefault(): void;
}

interface KeyTarget {
  addEventListener(type: 'keydown', handler: (event: WindowKey) => void): void;
  removeEventListener(type: 'keydown', handler: (event: WindowKey) => void): void;
}

/** Window-level keydown without DOM lib types (the web tsconfig is ES-only). */
export function useWindowKey(handler: (event: WindowKey) => void) {
  useEffect(() => {
    const target = globalThis as unknown as KeyTarget;
    target.addEventListener('keydown', handler);
    return () => target.removeEventListener('keydown', handler);
  });
}

/** Reads an input's value from a change event without DOM lib types. */
export function inputValue(event: { target: unknown }): string {
  return (event.target as { value: string }).value;
}

export function PrototypeSwitcher({
  variants,
}: {
  variants: readonly { key: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const currentKey = params.get('variant') ?? variants[0]?.key;
  const index = Math.max(
    0,
    variants.findIndex(({ key }) => key === currentKey),
  );
  const current = variants[index];

  function go(offset: number) {
    const next = variants[(index + offset + variants.length) % variants.length];
    if (!next) return;
    const search = new URLSearchParams(params.toString());
    search.set('variant', next.key);
    router.replace(`${pathname}?${search}`, { scroll: false });
  }

  useWindowKey((event) => {
    const target = event.target as { closest?(selector: string): unknown } | null;
    if (target?.closest?.('input, textarea, select, [contenteditable]')) return;
    if (event.key === 'ArrowLeft') go(-1);
    if (event.key === 'ArrowRight') go(1);
  });

  if (process.env.NODE_ENV === 'production' || !current) return null;

  const arrow =
    'grid size-8 cursor-pointer place-items-center rounded-full text-white hover:bg-white/15';
  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#ff2d8a] px-1.5 py-1.5 text-[13px] font-semibold text-white shadow-[0_10px_30px_rgb(0_0_0/35%)]">
      <button type="button" className={arrow} onClick={() => go(-1)} aria-label="Previous variant">
        ←
      </button>
      <span className="min-w-[220px] px-2 text-center">
        {current.key} ({current.name}) · {index + 1}/{variants.length}
      </span>
      <button type="button" className={arrow} onClick={() => go(1)} aria-label="Next variant">
        →
      </button>
    </div>
  );
}
