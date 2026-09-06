'use client';

import { useEffect, type KeyboardEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from './ui/button';

// Throwaway comparison control. Keep on the prototype branch.
export function PrototypeSwitcher({ variants }: { variants: Record<string, string> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const keys = Object.keys(variants);
  const current = keys.includes(params.get('variant') ?? '') ? params.get('variant')! : keys[0]!;

  useEffect(() => {
    type KeyEvent = Pick<
      KeyboardEvent,
      'key' | 'defaultPrevented' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'preventDefault'
    > & { target: { closest?(selector: string): unknown } | null };
    const browser = globalThis as unknown as {
      addEventListener(name: 'keydown', listener: (event: KeyEvent) => void): void;
      removeEventListener(name: 'keydown', listener: (event: KeyEvent) => void): void;
    };
    function onKey(event: KeyEvent) {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      if (
        event.target?.closest?.(
          'input, textarea, select, [contenteditable], [role="slider"], [role="tablist"], [role="menu"], [role="dialog"]',
        )
      )
        return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const next = new URLSearchParams(params.toString());
      next.set(
        'variant',
        keys[
          (keys.indexOf(current) + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) %
            keys.length
        ]!,
      );
      router.replace(`${pathname}?${next}`, { scroll: false });
    }
    browser.addEventListener('keydown', onKey);
    return () => browser.removeEventListener('keydown', onKey);
  }, [current, keys, params, pathname, router]);

  function cycle(direction: number) {
    const next = new URLSearchParams(params.toString());
    next.set('variant', keys[(keys.indexOf(current) + direction + keys.length) % keys.length]!);
    router.replace(`${pathname}?${next}`, { scroll: false });
  }

  if (process.env.NODE_ENV === 'production') return null;
  return (
    <nav
      aria-label="Prototype variants"
      className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-3 rounded-full border border-white/20 bg-midnight p-2 text-paper shadow-xl"
    >
      <Button
        aria-label="Previous variant"
        className="min-h-11 min-w-11 rounded-full"
        onClick={() => cycle(-1)}
      >
        ←
      </Button>
      <span className="min-w-0 text-center text-xs" aria-live="polite">
        Prototype {current}
        <br />
        <strong>{variants[current]}</strong>
      </span>
      <Button
        aria-label="Next variant"
        className="min-h-11 min-w-11 rounded-full"
        onClick={() => cycle(1)}
      >
        →
      </Button>
    </nav>
  );
}
