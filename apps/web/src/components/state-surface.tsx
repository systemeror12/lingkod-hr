import type { ReactNode } from 'react';

/**
 * Full-region loading, empty, or error state. Name it with `label` or `labelledBy`, and set
 * `busy` only while data is actually loading.
 */
export function StateSurface({
  label,
  labelledBy,
  busy,
  children,
}: {
  label?: string;
  labelledBy?: string;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className="grid min-h-[54vh] place-content-center justify-items-start gap-2.5 rounded-panel border border-border bg-surface p-7 min-[621px]:p-10"
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
