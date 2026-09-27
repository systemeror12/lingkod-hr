import type { ReactNode } from 'react';

/**
 * Loading, empty, or error state. The default fills a page region; `compact` sits inside a
 * `Panel` body. Name it with `label` or `labelledBy`, and set `busy` only while data is
 * actually loading.
 */
export function StateSurface({
  label,
  labelledBy,
  busy,
  compact = false,
  children,
}: {
  label?: string;
  labelledBy?: string;
  busy?: boolean;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={
        compact
          ? 'grid justify-items-start gap-1.5 px-4 py-6 text-small text-ink-muted'
          : 'grid min-h-[54vh] place-content-center justify-items-start gap-2.5 rounded-panel border border-border bg-surface p-7 min-[621px]:p-10'
      }
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-busy={busy}
    >
      {children}
    </section>
  );
}

/** Short uppercase kicker above the state heading, such as "Loading" or "Unavailable". */
export function StateCode({ children }: { children: ReactNode }) {
  return (
    <span className="text-caption font-[650] tracking-[0.08em] text-primary uppercase">
      {children}
    </span>
  );
}
