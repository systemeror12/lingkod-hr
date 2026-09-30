import type { ReactNode } from 'react';

/**
 * Branded page for invitation routes, which sit outside the protected shell. `labelledBy`
 * must match the id of the heading rendered inside `children`.
 */
export function InvitationLayout({
  labelledBy,
  showMark = false,
  children,
}: {
  labelledBy: string;
  showMark?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-5 py-10 text-ink">
      <section
        className="grid w-full max-w-[540px] gap-4 rounded-panel border border-border bg-surface p-7 min-[621px]:p-10"
        aria-labelledby={labelledBy}
      >
        {showMark ? (
          <div
            aria-hidden="true"
            className="grid size-9 place-items-center rounded-control bg-nav text-small font-bold text-nav-ink"
          >
            L
          </div>
        ) : null}
        {children}
      </section>
    </main>
  );
}

export function InvitationKicker({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 text-caption font-[650] tracking-[0.08em] text-primary uppercase">
      {children}
    </p>
  );
}

export function InvitationTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h1 className="m-0 text-page-title text-ink" id={id}>
      {children}
    </h1>
  );
}
