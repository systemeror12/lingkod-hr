'use client';

// PROTOTYPE (#398). Throwaway variant switcher for UI prototypes. Do not import from product code.

import { useEffect } from 'react';

type Option = { key: string; label: string };

type KeyboardTarget = {
  addEventListener(type: 'keydown', listener: (event: KeyEvent) => void): void;
  removeEventListener(type: 'keydown', listener: (event: KeyEvent) => void): void;
};
type KeyEvent = {
  key: string;
  target: { tagName?: string; isContentEditable?: boolean } | null;
  preventDefault(): void;
};

const selectClass =
  'max-w-56 rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-caption font-[600] text-white outline-none';

/**
 * Floating bar that cycles UI variants with ← and → (ignored while typing), plus pickers for the
 * screen and the fake state. Renders nothing in production builds.
 */
export function PrototypeSwitcher({
  screens,
  screen,
  states,
  state,
  variants,
  variant,
  onChange,
}: {
  screens: Option[];
  screen: string;
  states: Option[];
  state: string;
  variants: Option[];
  variant: string;
  onChange(next: { screen?: string; state?: string; variant?: string }): void;
}) {
  const index = Math.max(
    0,
    variants.findIndex(({ key }) => key === variant),
  );
  const step = (by: number) => {
    const next = variants[(index + by + variants.length) % variants.length];
    if (next) onChange({ variant: next.key });
  };

  useEffect(() => {
    const target = globalThis as unknown as KeyboardTarget;
    const listener = (event: KeyEvent) => {
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (event.target?.isContentEditable) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        step(event.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    target.addEventListener('keydown', listener);
    return () => target.removeEventListener('keydown', listener);
  });

  if (process.env.NODE_ENV === 'production') return null;
  const current = variants[index];

  return (
    <div
      role="toolbar"
      aria-label="Prototype controls"
      className="fixed bottom-4 left-1/2 z-50 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-full bg-[#1b1033] px-3 py-2 text-caption text-white shadow-[0_8px_30px_rgb(0_0_0/35%)] ring-2 ring-fuchsia-400"
    >
      <span className="rounded-full bg-fuchsia-500 px-2 py-0.5 font-[700] tracking-wide uppercase">
        Prototype
      </span>
      <select
        aria-label="Screen"
        className={selectClass}
        value={screen}
        onChange={(event) =>
          onChange({ screen: (event.currentTarget as unknown as { value: string }).value })
        }
      >
        {screens.map(({ key, label }) => (
          <option key={key} value={key} className="text-ink">
            {label}
          </option>
        ))}
      </select>
      <select
        aria-label="Fake state"
        className={selectClass}
        value={state}
        onChange={(event) =>
          onChange({ state: (event.currentTarget as unknown as { value: string }).value })
        }
      >
        {states.map(({ key, label }) => (
          <option key={key} value={key} className="text-ink">
            {label}
          </option>
        ))}
      </select>
      <span className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous variant"
          className="grid size-7 cursor-pointer place-items-center rounded-full bg-white/10 hover:bg-white/20"
          onClick={() => step(-1)}
        >
          ←
        </button>
        <span className="min-w-36 text-center font-[650]">
          {current ? `${current.key} (${current.label})` : '—'}
        </span>
        <button
          type="button"
          aria-label="Next variant"
          className="grid size-7 cursor-pointer place-items-center rounded-full bg-white/10 hover:bg-white/20"
          onClick={() => step(1)}
        >
          →
        </button>
      </span>
    </div>
  );
}
