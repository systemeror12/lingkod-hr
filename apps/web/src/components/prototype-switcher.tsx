'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

const variants = [
  { key: 'A', name: 'Classic pyramid' },
  { key: 'B', name: 'Administrative tree' },
  { key: 'C', name: 'Landscape board' },
] as const;

interface PrototypeKeyEvent {
  key: string;
  target: { closest?(selector: string): unknown } | null;
  preventDefault(): void;
}

const browser = globalThis as typeof globalThis & {
  addEventListener(type: 'keydown', listener: (event: PrototypeKeyEvent) => void): void;
  removeEventListener(type: 'keydown', listener: (event: PrototypeKeyEvent) => void): void;
};

export function PrototypeSwitcher({ current }: { current: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const index = Math.max(
    0,
    variants.findIndex(({ key }) => key === current),
  );
  const activeVariant = variants[index] ?? variants[0];

  function move(offset: number): void {
    const next = variants[(index + offset + variants.length) % variants.length];
    if (!next) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('variant', next.key);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  useEffect(() => {
    function onKeyDown(event: PrototypeKeyEvent): void {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) {
        return;
      }
      event.preventDefault();
      move(event.key === 'ArrowLeft' ? -1 : 1);
    }
    browser.addEventListener('keydown', onKeyDown);
    return () => browser.removeEventListener('keydown', onKeyDown);
  });

  if (process.env.NODE_ENV === 'production') return null;

  return (
    <nav
      aria-label="Organization hierarchy prototype variants"
      className="fixed bottom-[max(18px,env(safe-area-inset-bottom))] left-1/2 z-50 flex -translate-x-1/2 items-center overflow-hidden rounded-full border border-white/15 bg-midnight text-paper shadow-[0_14px_40px_rgb(23_32_51/30%)]"
    >
      <button
        aria-label="Previous prototype variant"
        className="grid size-11 place-items-center border-r border-white/15 text-lg hover:bg-white/10"
        type="button"
        onClick={() => move(-1)}
      >
        ←
      </button>
      <span className="min-w-[190px] px-4 text-center text-xs font-[650]" aria-live="polite">
        {activeVariant.key} · {activeVariant.name}
      </span>
      <button
        aria-label="Next prototype variant"
        className="grid size-11 place-items-center border-l border-white/15 text-lg hover:bg-white/10"
        type="button"
        onClick={() => move(1)}
      >
        →
      </button>
    </nav>
  );
}
