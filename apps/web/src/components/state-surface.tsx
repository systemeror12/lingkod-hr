import type { ReactNode } from 'react';

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
      className="grid min-h-[54vh] place-content-center justify-items-start gap-[10px] rounded-[5px] border border-line bg-paper p-7 min-[621px]:p-10"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-busy={busy}
    >
      {children}
    </section>
  );
}

export function StateCode({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-bold tracking-[0.09em] text-cobalt uppercase">
      {children}
    </span>
  );
}
